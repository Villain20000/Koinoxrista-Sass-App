import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from './embeddings.service';

/**
 * Phase 1 (docs/LANGCHAIN_LANGGRAPH_PLAN.md): builds the building-scoped RAG
 * corpus from Greek sources and feeds it to EmbeddingsService:
 *
 *   - `announcement`  → per-announcement chunk (create/update/delete hooks)
 *   - `compliance`    → ComplianceItem title + notes
 *   - `faq`           → `assets/faq.el.md` sections (static, building-shared)
 *   - `expense_category` → allocation strategy notes per category
 *
 * Sync is idempotent: content hashes skip unchanged rows, so the weekly cron
 * and manual triggers are cheap. Every failure is non-fatal (ok:false count)
 * — retrieval degrades to the keyword scorer until the next successful sync.
 */

export const FAQ_SOURCE_PREFIX = 'faq:';

export interface SyncResult {
  sources: number;
  embedded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

@Injectable()
export class EmbeddingsIngestionService {
  private readonly logger = new Logger(EmbeddingsIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Single announcement upsert (on-write hook from AnnouncementsService). */
  async syncAnnouncement(buildingId: string, announcementId: string): Promise<void> {
    try {
      const announcement = await this.prisma.announcement.findUnique({
        where: { id: announcementId },
        select: { id: true, title: true, body: true },
      });
      if (!announcement) return;
      await this.embeddings.upsertChunks(
        buildingId,
        'announcement',
        announcement.id,
        [{ title: announcement.title, body: announcement.body }],
      );
    } catch (error) {
      this.logger.warn(
        `syncAnnouncement(${announcementId}) failed: ${String(error)}`,
      );
    }
  }

  /** Single announcement removal (on-delete hook). */
  async removeAnnouncement(buildingId: string, announcementId: string): Promise<void> {
    try {
      await this.embeddings.deleteBySource(buildingId, 'announcement', announcementId);
    } catch (error) {
      this.logger.warn(
        `removeAnnouncement(${announcementId}) failed: ${String(error)}`,
      );
    }
  }

  /** Building sources only (FAQ static is shared and lives on the null fake id). */
  async syncBuilding(buildingId: string): Promise<SyncResult> {
    const result: SyncResult = {
      sources: 0,
      embedded: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    const push = async (
      sourceType: string,
      sourceId: string,
      chunks: { title: string; body: string }[],
    ) => {
      if (chunks.length === 0) return;
      result.sources += 1;
      try {
        const outcome = await this.embeddings.upsertChunks(
          buildingId,
          sourceType,
          sourceId,
          chunks,
        );
        if (outcome.ok) {
          result.embedded += outcome.embedded;
          result.skipped += outcome.skipped;
        } else {
          result.failed += 1;
          result.errors.push(`${sourceType}:${sourceId}: ${outcome.error ?? 'unknown'}`);
        }
      } catch (error) {
        result.failed += 1;
        result.errors.push(`${sourceType}:${sourceId}: ${String(error)}`);
      }
    };

    const announcements = await this.prisma.announcement.findMany({
      where: { buildingId },
      select: { id: true, title: true, body: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    for (const announcement of announcements) {
      await push('announcement', announcement.id, [
        { title: announcement.title, body: announcement.body },
      ]);
    }

    const complianceItems = await this.prisma.complianceItem.findMany({
      where: { buildingId },
      select: { id: true, title: true, notes: true, kind: true },
      take: 200,
    });
    for (const item of complianceItems) {
      await push('compliance', item.id, [
        {
          title: item.title,
          body: [item.kind, item.notes].filter(Boolean).join('\n'),
        },
      ]);
    }

    const categories = await this.prisma.expenseCategory.findMany({
      where: { buildingId },
      select: { id: true, name: true, strategy: true },
      take: 200,
    });
    for (const category of categories) {
      await push('expense_category', category.id, [
        {
          title: category.name,
          body: `Κατηγορία εξόδου: ${category.name}. Στρατηγική κατανομής: ${category.strategy}.`,
        },
      ]);
    }

    for (const faq of this.loadFaqChunks()) {
      await push('faq', `${FAQ_SOURCE_PREFIX}${faq.id}`, [
        { title: faq.title, body: faq.body },
      ]);
    }

    return result;
  }

  /** Greek FAQ sections from `assets/faq.el.md` (## headings), stable ids. */
  private loadFaqChunks(): { id: string; title: string; body: string }[] {
    try {
      // Mirrors the candidate list in AssistantService.loadFaqChunks() so the
      // file resolves both from the webpack bundle and from a source checkout.
      const candidates = [
        path.join(__dirname, 'assets', 'faq.el.md'),
        path.join(process.cwd(), 'apps/api/src/assets/faq.el.md'),
      ];
      let text: string | null = null;
      for (const candidate of candidates) {
        try {
          text = fs.readFileSync(candidate, 'utf-8');
          if (text) break;
        } catch {
          // try next candidate
        }
      }
      if (!text) return [];
      return (text as string)
        .split(/^##\s+/m)
        .slice(1)
        .map((section: string) => {
          const [titleLine, ...rest] = section.split('\n');
          return {
            id: titleLine.trim(),
            title: titleLine.trim(),
            body: rest.join('\n').trim().slice(0, 1200),
          };
        })
        .filter((chunk: { title: string; body: string }) => chunk.title && chunk.body);
    } catch {
      return [];
    }
  }
}
