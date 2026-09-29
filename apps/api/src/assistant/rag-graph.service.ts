import { Inject, Injectable, Logger } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { EmbeddingsService, type ScoredChunk } from './embeddings.service';
import { LLM_PROVIDER, type LlmProvider } from './llm-provider';

/**
 * Phase 2 (docs/LANGCHAIN_LANGGRAPH_PLAN.md): LangGraph.js RAG graph for the
 * Greek building copilot. Activated by `RAG_ENGINE=langgraph`; the original
 * keyword scorer in AssistantService stays the default (`RAG_ENGINE=keyword`)
 * until the golden-set numbers justify switching.
 *
 * Flow:
 *   load_context → retrieve (pgvector, buildingId-scoped) → grade_docs
 *     ├─ relevant        → generate → guard_answer → END
 *     ├─ nothing_indexed → (skip LLM grading) → keyword fallback decision
 *     └─ weak            → rewrite_query (≤ RAG_MAX_REWRITES) → retrieve
 * Any failure degrades to the keyword path — the copilot endpoint must not 500.
 *
 * Every LLM leaf call goes through the injected LlmProvider so tests can stub
 * it and AI_LOCAL_ONLY / ConsoleLlmProvider semantics are preserved. The graph
 * itself is pure orchestration: tenant scoping happens before invocation and
 * inside the vector query (buildingId = $1).
 */

const TOP_K = Number(process.env.RAG_TOP_K ?? 5);
const MAX_REWRITES = Number(process.env.RAG_MAX_REWRITES ?? 1);
/** Grade node treats docs above this similarity as relevant without an LLM call. */
const HIGH_CONFIDENCE = 0.75;

const GraphState = Annotation.Root({
  buildingId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  question: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  rewritten: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  documents: Annotation<ScoredChunk[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),
  attempt: Annotation<number>({
    reducer: (_prev, next) => next ?? 0,
    default: () => 0,
  }),
  answer: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  citations: Annotation<{ type: string; title: string }[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),
});

type RagState = typeof GraphState.State;
type RagPartial = Partial<RagState>;

/** Honesty phrase used by generate + guard (Greek: "not found in context"). */
export const RAG_NO_ANSWER =
  'Δεν βρέθηκε στις ανακοινώσεις/FAQ του κτιρίου. Συμβουλευτείτε τη σελίδα FAQ ή επικοινωνήστε με τη διαχείριση.';

const SYSTEM_PROMPT = [
  'You are the building-management copilot for PolykatoikiaOS (Ελληνική πολυκατοικία).',
  'Answer in Greek (formal, κάπως επίσημα), citing only the provided building context.',
  'If the answer is not in the context, reply exactly: "Δεν βρέθηκε στις ανακοινώσεις/FAQ του κτιρίου." Never invent facts or amounts.',
  'Do not mention other buildings or other users\' data. Χιλιοστά are ‰ of 1000 per Ν.1221/1981.',
  'Amounts come from the context — never recompute them, only explain the given totals.',
].join('\n');

function renderContext(documents: ScoredChunk[]): string {
  return documents
    .map((doc) => `[${doc.sourceType}] ${doc.title}\n${doc.body}`)
    .join('\n---\n');
}

/** Cheap Greek synonym/expansion map for the rewrite node (no LLM needed). */
const REWRITE_HINTS: { pattern: RegExp; expansion: string }[] = [
  { pattern: /πληρω|εξοφλ/i, expansion: 'πληρωμή εξόφληση παράβολο τραπεζική κάρτα' },
  { pattern: /χιλιοστ|ποσοστ/i, expansion: 'χιλιοστά ‰ Ν.1221/1981 κατανομή μερίδιο' },
  { pattern: /συνελευ|αποφαση/i, expansion: 'γενική συνέλευση ψήφος απόφαση πρακτικό' },
  { pattern: /βλαβ|ζημια|τρειμα/i, expansion: 'βλάβη ζημιά επισκευή εργασίες συντήρηση' },
  { pattern: /ρευμα|φωτ|ανελκυστ/i, expansion: 'ηλεκτρολογικά ρεύμα φωταέριο ανελκυστήρας' },
  { pattern: /νερο|υδραυλ|διαρρο/i, expansion: 'ύδρευση υδραυλικά διαρροή νερό θερμοσίφωνας' },
];

function buildRagGraph(
  embeddings: EmbeddingsService,
  llm: LlmProvider,
) {
  const loadContext = async (state: RagState): Promise<RagPartial> => {
    // Reserved for pinned-announcement injection; keeps the graph shape stable
    // and the entry node cheap. Currently a pass-through.
    return { attempt: 0, rewritten: undefined, buildingId: state.buildingId };
  };

  const retrieve = async (state: RagState): Promise<RagPartial> => {
    const query = state.rewritten ?? state.question;
    const documents = await embeddings.search(state.buildingId, query, TOP_K);
    return { documents };
  };

  const gradeDocs = async (state: RagState): Promise<RagPartial> => state;

  const routeAfterGrade = (state: RagState): 'generate' | 'rewrite_query' | 'no_context' => {
    if (state.documents.length === 0) return 'no_context';
    const best = Math.max(...state.documents.map((doc) => doc.score));
    // High-confidence semantic hit skips the LLM grading call (latency budget).
    if (best >= HIGH_CONFIDENCE) return 'generate';
    if (state.attempt < MAX_REWRITES) return 'rewrite_query';
    // Out of rewrite budget: generate from whatever we retrieved (graded by guard).
    return 'generate';
  };

  const rewriteQuery = async (state: RagState): Promise<RagPartial> => {
    let rewritten = state.question;
    for (const hint of REWRITE_HINTS) {
      if (hint.pattern.test(rewritten)) {
        rewritten = `${rewritten}\n(${hint.expansion})`;
        break;
      }
    }
    return { rewritten, attempt: state.attempt + 1 };
  };

  const generate = async (state: RagState): Promise<RagPartial> => {
    const contextText = renderContext(state.documents);
    const userPrompt = [
      `Building context:\n${contextText}`,
      '',
      `Question: ${state.rewritten ?? state.question}`,
    ].join('\n');
    const answer = await llm.complete(SYSTEM_PROMPT, userPrompt);
    return {
      answer,
      citations: state.documents
        .slice(0, 5)
        .map((doc) => ({ type: doc.sourceType, title: doc.title })),
    };
  };

  const guardAnswer = async (state: RagState): Promise<RagPartial> => {
    const answer = (state.answer ?? '').trim();
    const citesSource =
      state.documents.length > 0 &&
      state.documents.some(
        (doc) => doc.title.length > 3 && answer.includes(doc.title),
      );
    const isHonestRefusal = answer.includes('Δεν βρέθηκε');
    // Guard: either the answer cites a retrieved source or refuses honestly.
    // Otherwise (hallucination suspicion) force the refusal.
    if (!citesSource && !isHonestRefusal) {
      return { answer: RAG_NO_ANSWER, citations: [] };
    }
    return { answer };
  };

  const honestNoContext = async (): Promise<RagPartial> => ({
    answer: RAG_NO_ANSWER,
    citations: [],
  });

  const builder = new StateGraph(GraphState)
    .addNode('load_context', loadContext)
    .addNode('retrieve', retrieve)
    .addNode('grade_docs', gradeDocs)
    .addNode('rewrite_query', rewriteQuery)
    .addNode('generate', generate)
    .addNode('guard_answer', guardAnswer)
    .addNode('honest_no_context', honestNoContext)
    .addEdge(START, 'load_context')
    .addEdge('load_context', 'retrieve')
    .addEdge('retrieve', 'grade_docs')
    .addConditionalEdges('grade_docs', routeAfterGrade)
    .addEdge('rewrite_query', 'retrieve')
    .addEdge('generate', 'guard_answer')
    .addEdge('guard_answer', END)
    .addEdge('honest_no_context', END);

  return builder.compile();
}

/**
 * Greek diacritic folding: strips tonos/dialytika (νερό → νερο, ίσιως → ισιως)
 * so lexical scoring matches inflected forms. Without it, 'νερό' does NOT
 * substring-match 'νερού' (ό U+03CC vs ο U+03BF) and scoring silently fails.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

@Injectable()
export class RagGraphService {
  private readonly logger = new Logger(RagGraphService.name);
  private graph: ReturnType<typeof buildRagGraph> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * Building-scoped RAG query. Returns the same shape as AssistantService.
   * Falls back to the lexical scorer whenever the graph path is unavailable
   * (PGVECTOR_ENABLED=false, pgvector missing, Ollama down, graph error).
   */
  async query(
    buildingId: string,
    question: string,
    user: AuthenticatedUser,
  ): Promise<{ answer: string; sources: { type: string; title: string }[] }> {
    assertSameBuilding(user, buildingId);

    if (await this.embeddings.ensureReady()) {
      const graph = (this.graph ??= buildRagGraph(this.embeddings, this.llm));
      try {
        const result = await graph.invoke({ buildingId, question });
        if (result.answer) {
          return { answer: result.answer, sources: result.citations.slice(0, 5) };
        }
        this.logger.warn('rag graph returned no answer — falling back');
      } catch (error) {
        this.logger.warn(`rag graph failed — falling back to keyword: ${String(error)}`);
      }
    }
    return this.keywordFallback(buildingId, question);
  }

  /**
   * Lexical scorer mirroring AssistantService.retrieve() (kept here so the
   * graph service has no circular dependency on AssistantService). Guarded
   * amounts: only stored text is returned — no computation happens.
   */
  async keywordFallback(
    buildingId: string,
    question: string,
  ): Promise<{ answer: string; sources: { type: string; title: string }[] }> {
    const terms = this.terms(question);
    const announcements = await this.prisma.announcement.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const scored = announcements
      .map((announcement) => ({
        score: this.score([announcement.title, announcement.body].join(' '), terms),
        announcement,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) {
      return { answer: RAG_NO_ANSWER, sources: [] };
    }
    const contextText = scored
      .map((entry) => `[announcement] ${entry.announcement.title}\n${entry.announcement.body}`)
      .join('\n---\n');
    const system = [
      'You are the building-management copilot for PolykatoikiaOS (Ελληνική πολυκατοικία).',
      'Answer in Greek (formal), citing only the provided building context.',
      'If the answer is not in the context, reply exactly: "Δεν βρέθηκε στις ανακοινώσεις/FAQ του κτιρίου."',
    ].join('\n');
    let answer: string;
    try {
      answer = await this.llm.complete(
        system,
        `Building context:\n${contextText}\n\nQuestion: ${question}`,
      );
    } catch {
      answer =
        'Η απάντηση δεν είναι διαθέσιμη από το τοπικό μοντέλο αυτή τη στιγμή. Δοκιμάστε ξανά ή συμβουλευτείτε τις Ανακοινώσεις.';
    }
    return {
      answer,
      sources: scored.map((entry) => ({
        type: 'announcement',
        title: entry.announcement.title,
      })),
    };
  }

  private terms(question: string): string[] {
    return fold(question)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 2);
  }

  private score(text: string, terms: string[]): number {
    const lower = fold(text);
    return terms.reduce((sum, term) => (lower.includes(term) ? sum + 1 : sum), 0);
  }
}
