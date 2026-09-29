import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER, LlmProvider } from './llm-provider';

/**
 * Local NL→SQL copilot for Greek ops questions.
 * - SELECT-only, buildingId-scoped, audited, 10/day/user.
 * - Local-first: tries Ollama/Meltemi when AI_LOCAL_ONLY or LLM_API_URL set,
 *   otherwise falls back to deterministic Greek templates (no data leaves host).
 */

export interface NlSqlResult {
  sql: string;
  rows: Record<string, unknown>[];
  via: string;
  disclaimer: string;
}

const RATE_LIMIT = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;

const ALLOWED_TABLES = new Set(['Invoice', 'Unit', 'Expense', 'Payment', 'Job', 'Vote']);

const GREEK_TEMPLATES: { pattern: RegExp; sql: (buildingId: string) => string }[] = [
  {
    // ποιος δεν πλήρωσε / οφειλέτες / καθυστερήσεις
    pattern: /(ποιοι|ποιος|οφειλ|καθυστερ|δεν πληρωσ|ανεξοφλητ)/i,
    sql: (b) =>
      `SELECT u.label as unit, i."periodYearMonth" as period, (i."totalCents" - i."paidCents") as "overdueCents" FROM "Invoice" i JOIN "Unit" u ON u.id = i."unitId" WHERE i."buildingId" = '${b}' AND (i."totalCents" - i."paidCents") > 0 ORDER BY "overdueCents" DESC LIMIT 20`,
  },
  {
    // πόσα οφείλονται / σύνολο οφειλών
    pattern: /(ποσα|συνολο|αθροισμα).*οφειλ/i,
    sql: (b) =>
      `SELECT SUM(i."totalCents" - i."paidCents") as "totalOverdueCents", COUNT(*) as "overdueInvoices" FROM "Invoice" i WHERE i."buildingId" = '${b}' AND (i."totalCents" - i."paidCents") > 0`,
  },
  {
    // έξοδα ανά κατηγορία / που πήγαν τα λεφτά
    pattern: /(εξοδα|δαπανη|κατηγορι)/i,
    sql: (b) =>
      `SELECT c.name as category, SUM(e."totalCents") as "totalCents" FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId" WHERE e."buildingId" = '${b}' GROUP BY c.name ORDER BY "totalCents" DESC`,
  },
  {
    // ψήφοι / συνελεύσεις
    pattern: /(ψηφ|συνελευση|αποφαση)/i,
    sql: (b) =>
      `SELECT v.topic, v."thresholdType", v."closesAt", v.result FROM "Vote" v WHERE v."buildingId" = '${b}' ORDER BY v."closesAt" DESC LIMIT 10`,
  },
  {
    // βλάβες / jobs
    pattern: /(βλαβ|ζημια|εργασι|job)/i,
    sql: (b) =>
      `SELECT j.title, j.status, j."createdAt" FROM "Job" j WHERE j."buildingId" = '${b}' ORDER BY j."createdAt" DESC LIMIT 20`,
  },
];

function isSelectOnly(sql: string): boolean {
  const t = sql.trim().toLowerCase();
  if (!t.startsWith('select')) return false;
  // Block DDL/DML keywords
  const blocked = ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'create ', 'truncate ', 'grant ', 'revoke ', ';--', '/*', '*/', 'pg_sleep', 'copy '];
  return !blocked.some((kw) => t.includes(kw));
}

function containsBuildingFilter(sql: string, buildingId: string): boolean {
  return sql.includes(buildingId) && /buildingId/i.test(sql);
}

@Injectable()
export class NlSqlService {
  private readonly logger = new Logger(NlSqlService.name);
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const arr = this.hits.get(userId) ?? [];
    const recent = arr.filter((t) => now - t < WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      throw new BadRequestException(`Όριο 10 ερωτήσεων/ημέρα — δοκιμάστε αύριο (x-ratelimit: ${RATE_LIMIT}/day)`);
    }
    recent.push(now);
    this.hits.set(userId, recent);
  }

  private templateFor(question: string, buildingId: string): string | null {
    for (const { pattern, sql } of GREEK_TEMPLATES) {
      if (pattern.test(question)) return sql(buildingId);
    }
    return null;
  }

  async query(
    buildingId: string,
    question: string,
    userId: string,
    userRole: string,
  ): Promise<NlSqlResult> {
    this.checkRateLimit(userId);

    const trimmed = question.trim().slice(0, 500);
    if (trimmed.length < 4) throw new BadRequestException('Ερώτηση πολύ σύντομη');

    let sql: string | null = this.templateFor(trimmed, buildingId);
    let via = 'template';

    // Try LLM translation when a local-compatible endpoint is configured.
    // In AI_LOCAL_ONLY mode this is still Ollama/Meltemi (on-host), not hosted.
    if (!sql) {
      try {
        const system = [
          'You are a Greek NL→SQL translator for PolykatoikiaOS. Output ONLY a single SELECT statement.',
          'Rules: SELECT-only, must filter by buildingId = \'' + buildingId + '\', use double-quoted identifiers ("Invoice", "buildingId"), limit 20 rows, no DDL.',
          'Allowed tables: Invoice, Unit, Expense, ExpenseCategory, Job, Vote. Never use * without buildingId filter.',
          'Example: SELECT u.label FROM "Unit" u WHERE u."buildingId" = \'' + buildingId + '\' LIMIT 20',
        ].join('\n');
        const llmSql = await this.llm.complete(system, trimmed);
        const cleaned = llmSql.replace(/```sql|```/gi, '').trim().split(';')[0] ?? '';
        if (isSelectOnly(cleaned) && containsBuildingFilter(cleaned, buildingId)) {
          sql = cleaned;
          via = this.llm.name;
        } else {
          this.logger.warn(`LLM SQL rejected (not SELECT/buildingId): ${cleaned.slice(0, 200)}`);
        }
      } catch (e) {
        this.logger.warn(`LLM NL→SQL failed, falling back to template: ${String(e)}`);
      }
    }

    if (!sql) {
      // Fallback generic: list units
      sql = `SELECT u.label as unit, u.millimes FROM "Unit" u WHERE u."buildingId" = '${buildingId}' ORDER BY u.label LIMIT 20`;
      via = 'fallback';
    }

    if (!isSelectOnly(sql)) throw new BadRequestException('Μόνο SELECT επιτρέπεται');
    if (!containsBuildingFilter(sql, buildingId)) throw new BadRequestException('Το SQL πρέπει να φιλτράρει με buildingId');

    let rows: Record<string, unknown>[] = [];
    try {
      rows = (await this.prisma.$queryRawUnsafe(sql)) as Record<string, unknown>[];
    } catch (e) {
      this.logger.warn(`NL→SQL exec failed: ${String(e)} — sql: ${sql}`);
      throw new BadRequestException('Το ερώτημα απέτυχε — δοκιμάστε πιο απλή διατύπωση');
    }

    this.audit.record({
      buildingId,
      actorId: userId,
      actorRole: userRole as any,
      action: 'assistant.nl_sql',
      entity: 'building',
      entityId: buildingId,
      metadata: { questionLength: trimmed.length, via, sql: sql.slice(0, 500) },
    });

    return {
      sql,
      rows: Array.isArray(rows) ? rows.slice(0, 20) : [],
      via,
      disclaimer: 'Αποτέλεσμα από τοπικό μοντέλο — επαληθεύστε με τα επίσημα στοιχεία.',
    };
  }

  // For tests
  _clearRateLimit(userId: string) {
    this.hits.delete(userId);
  }
}
