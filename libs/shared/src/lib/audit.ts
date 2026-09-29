import type { Role } from './domain';

/** Registry of auditable mutation actions (append-only audit trail, PLAN.md §5). */
export const AUDIT_ACTIONS = [
  'expense.created',
  'invoice.run',
  'payment.checkout',
  'payment.webhook',
  'vote.created',
  'vote.ballot',
  'vote.closed',
  'subscription.changed',
  'gdpr.deleted',
  'apikey.created',
  'apikey.revoked',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditLogDto {
  id: string;
  buildingId: string | null;
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditQueryDto {
  action?: string;
  entity?: string;
  entityId?: string;
  fromISO?: string;
  toISO?: string;
  skip?: number;
  take?: number;
}

export interface AuditLogPage {
  items: AuditLogDto[];
  total: number;
}
