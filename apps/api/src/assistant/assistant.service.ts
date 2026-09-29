import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER, LlmProvider } from './llm-provider';

interface SourceChunk {
  type: 'announcement' | 'faq' | 'static';
  title: string;
  body: string;
}

export interface AssistantAnswer {
  answer: string;
  sources: { type: string; title: string }[];
}

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * Building-scoped RAG-lite: retrieves relevant announcement/static chunks for
   * the building, then asks the LLM to answer using ONLY that context. All
   * retrieval is filtered by buildingId ⇒ no cross-building leakage.
   */
  async query(
    buildingId: string,
    question: string,
    user: AuthenticatedUser,
  ): Promise<AssistantAnswer> {
    assertSameBuilding(user, buildingId);

    const redactedQuestion = this.redactPii(question);
    const chunks = await this.retrieve(buildingId, redactedQuestion);
    const contextText = this.renderContext(chunks);

    const isLocalOnly = (process.env.AI_LOCAL_ONLY ?? '').toLowerCase() === 'true';
    const system = [
      'You are the building-management copilot for PolykatoikiaOS (Ελληνική πολυκατοικία).',
      'Answer in Greek (formal, κάπως επίσημα), citing only the provided building context.',
      'If the answer is not in the context, say so honestly: "Δεν βρέθηκε στις ανακοινώσεις/FAQ του κτιρίου." Never invent facts or amounts.',
      'Do not mention other buildings or users\' data. Millimes are ‰ of 1000 per Ν.1221/1981.',
      'Amounts are rendered via formatMoney — never recompute them, only explain the given totals.',
      isLocalOnly
        ? 'Local AI mode: data never leaves the EU host. If context is empty, link to FAQ instead of guessing.'
        : 'If context is empty, suggest checking the Announcements feed and FAQ.',
    ].join('\n');

    const userPrompt = [
      `Building context:\n${contextText || '(no announcements available)'}`,
      '',
      `Question: ${redactedQuestion}`,
    ].join('\n');

    let answer: string;
    try {
      answer = await this.llm.complete(system, userPrompt);
    } catch {
      answer = 'Η απάντηση δεν είναι διαθέσιμη προς το παρόν. Συμβουλευτείτε τη σελίδα FAQ.';
    }

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'assistant.query',
      entity: 'building',
      entityId: buildingId,
      metadata: { questionLength: question.length, sources: chunks.length },
    });

    return {
      answer,
      sources: chunks.slice(0, 5).map((chunk) => ({
        type: chunk.type,
        title: chunk.title,
      })),
    };
  }

  /** Token-preserving RAG retrieval: relevant announcements via keyword overlap + Greek FAQ. */
  private async retrieve(
    buildingId: string,
    question: string,
  ): Promise<SourceChunk[]> {
    const terms = this.terms(question);
    const announcements = await this.prisma.announcement.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const scored = announcements
      .map((a) => ({
        score: this.score([a.title, a.body].join(' '), terms),
        chunk: { type: 'announcement' as const, title: a.title, body: a.body },
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((entry) => entry.chunk);

    if (scored.length > 0) return scored;

    // No announcement matched — fall back to Greek FAQ chunks scored by the same terms.
    // pgvector (BGE-M3) would replace this keyword scorer when PGVECTOR_ENABLED=true.
    const faqChunks = this.loadFaqChunks();
    const faqScored = faqChunks
      .map((chunk) => ({ score: this.score(`${chunk.title} ${chunk.body}`, terms), chunk }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.chunk);

    return faqScored.length > 0 ? faqScored : faqChunks.slice(0, 1);
  }

  private cachedFaq: SourceChunk[] | null = null;

  private loadFaqChunks(): SourceChunk[] {
    if (this.cachedFaq) return this.cachedFaq;
    try {
      const candidates = [
        path.join(__dirname, 'assets', 'faq.el.md'),
        path.join(process.cwd(), 'apps/api/src/assets/faq.el.md'),
        path.join(process.cwd(), 'apps/api/src/assets/faq.el.md'),
      ];
      let raw: string | null = null;
      for (const p of candidates) {
        try {
          raw = fs.readFileSync(p, 'utf-8');
          if (raw) break;
        } catch {
          // try next
        }
      }
      if (!raw) throw new Error('faq not found');
      const chunks: SourceChunk[] = [];
      const sections = raw.split(/^##\s+/m).slice(1);
      for (const sec of sections) {
        const lines = sec.split('\n');
        const title = (lines[0] ?? '').trim();
        const body = lines.slice(1).join('\n').trim().slice(0, 1200);
        if (title && body) chunks.push({ type: 'faq' as const, title, body });
      }
      this.cachedFaq = chunks.length ? chunks : this.fallbackFaq();
      return this.cachedFaq;
    } catch {
      this.cachedFaq = this.fallbackFaq();
      return this.cachedFaq;
    }
  }

  private fallbackFaq(): SourceChunk[] {
    return [
      {
        type: 'static',
        title: 'Τρόποι πληρωμής (FAQ)',
        body: 'Οι χρεώσεις εξοφλούνται online (κάρτα ή τραπεζική κατάθεση) με βάση το παράβολο που εκδίδει η διαχείριση της πολυκατοικίας. Προθεσμία εξόφλησης, πρόστιμα και ιστορικό πληρωμών φαίνονται στην οθόνη "Οικονομικά / Υπόλοιπο".',
      },
      {
        type: 'faq',
        title: 'Χιλιοστά Ν.1221/1981',
        body: 'Τα χιλιοστά είναι ‰ με άθροισμα 1000. Η κατανομή γίνεται με largest-remainder ώστε το άθροισμα των μεριδίων να ισούται με το σύνολο.',
      },
    ];
  }

  private redactPii(text: string): string {
    return text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\+?\d[\d\s\-()]{7,}\d/g, '[τηλ]')
      .slice(0, 1000);
  }

  private terms(question: string): string[] {
    return question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .map((w) => w.toLowerCase());
  }

  private score(text: string, terms: string[]): number {
    const lower = text.toLowerCase();
    return terms.reduce((sum, term) => (lower.includes(term) ? sum + 1 : sum), 0);
  }

  private renderContext(chunks: SourceChunk[]): string {
    return chunks
      .map((chunk) => `[${chunk.type}] ${chunk.title}\n${chunk.body}`)
      .join('\n---\n');
  }
}

export function assertQuestion(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 4) {
    throw new NotFoundException('Question is too short');
  }
  return trimmed.slice(0, 1000);
}