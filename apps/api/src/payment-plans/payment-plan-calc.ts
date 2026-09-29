export const MS_PER_DAY = 86_400_000;

/** One planned installment produced by the splitter (pure data, no ids). */
export interface PlannedInstallment {
  seq: number;
  dueDate: Date;
  amountCents: number;
}

/** Minimal installment state the allocator works on. */
export interface PlanInstallmentState {
  id: string;
  seq: number;
  amountCents: number;
  paidCents: number;
  paidAt: Date | null;
}

/** Money applied to one installment by a recorded plan payment. */
export interface PlanPaymentAllocation {
  installmentId: string;
  seq: number;
  appliedCents: number;
}

export interface ApplyPaymentResult {
  allocations: PlanPaymentAllocation[];
  /** Updated installment states; untouched rows are returned as-is. */
  installments: PlanInstallmentState[];
  /** Sum actually allocated — never more than the plan's remaining balance. */
  appliedCents: number;
  /** True when every installment is fully settled after this payment. */
  completed: boolean;
}

/**
 * Pure splitter: divides `totalCents` into `installmentCount` integer parts.
 * The remainder (`totalCents % n`) is distributed one cent at a time to the
 * EARLIEST installments. Due dates step `intervalDays` apart from
 * `firstDueDate` (UTC-safe millisecond arithmetic).
 */
export function splitIntoInstallments(
  totalCents: number,
  installmentCount: number,
  firstDueDate: Date,
  intervalDays: number,
): PlannedInstallment[] {
  const base = Math.floor(totalCents / installmentCount);
  let remainder = totalCents % installmentCount;

  return Array.from({ length: installmentCount }, (_, index) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return {
      seq: index + 1,
      dueDate: new Date(firstDueDate.getTime() + index * intervalDays * MS_PER_DAY),
      amountCents: base + extra,
    };
  });
}

/** Remaining cents of a single installment. */
export function installmentRemaining(installment: PlanInstallmentState): number {
  return Math.max(0, installment.amountCents - installment.paidCents);
}

/**
 * Pure allocator: applies `amountCents` to a seq-ordered schedule OLDEST-FIRST
 * (lowest `seq` wins). Partially-paid mid-plan installments are topped up
 * before later ones receive money. Excess above the plan's remaining balance is
 * ignored (callers validate beforehand). An installment's `paidAt` is stamped
 * with `now` the moment it becomes fully settled and is preserved otherwise.
 */
export function applyPaymentToPlan(
  installments: PlanInstallmentState[],
  amountCents: number,
  now: Date = new Date(),
): ApplyPaymentResult {
  const ordered = [...installments].sort((a, b) => a.seq - b.seq);
  let pool = Math.max(0, Math.floor(amountCents));

  const allocations: PlanPaymentAllocation[] = [];
  const updated: PlanInstallmentState[] = [];

  for (const installment of ordered) {
    if (pool <= 0) {
      updated.push(installment);
      continue;
    }
    const applied = Math.min(pool, installmentRemaining(installment));
    if (applied <= 0) {
      updated.push(installment);
      continue;
    }

    const paidCents = installment.paidCents + applied;
    const settled = paidCents >= installment.amountCents;
    updated.push({
      ...installment,
      paidCents,
      paidAt: settled ? (installment.paidAt ?? now) : installment.paidAt,
    });
    allocations.push({
      installmentId: installment.id,
      seq: installment.seq,
      appliedCents: applied,
    });
    pool -= applied;
  }

  return {
    allocations,
    installments: updated,
    appliedCents: Math.max(0, Math.floor(amountCents)) - pool,
    completed: updated.every((i) => i.paidCents >= i.amountCents),
  };
}
