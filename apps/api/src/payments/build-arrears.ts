import { formatPeriod, parsePeriod } from '@org/shared';
import type { ArrearsReport, ArrearsRow } from '@org/shared';

export interface ArrearsUnitInput {
  id: string;
  label: string;
}

export interface ArrearsOwnershipInput {
  unitId: string;
  user: { firstName: string; lastName: string };
}

export interface ArrearsInvoiceInput {
  unitId: string;
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
}

export type ArrearsBucketKey =
  | 'bucketCurrentCents'
  | 'bucket30Cents'
  | 'bucket60Cents'
  | 'bucket90PlusCents';

/** Whole months between `period` (older) and `current` (newer), both YYYY-MM. */
export function monthsBack(period: string, current: string): number {
  const older = parsePeriod(period);
  const newer = parsePeriod(current);
  return (newer.year - older.year) * 12 + (newer.month - older.month);
}

export function bucketKeyFor(months: number): ArrearsBucketKey {
  if (months <= 0) return 'bucketCurrentCents';
  if (months === 1) return 'bucket30Cents';
  if (months === 2) return 'bucket60Cents';
  return 'bucket90PlusCents';
}

/**
 * Pure helper: builds the aging report. Only units with at least one invoice
 * where totalCents > paidCents appear; each invoice's remainder lands in the
 * bucket matching its age from the current YYYY-MM period.
 */
export function buildArrears(
  buildingId: string,
  units: ArrearsUnitInput[],
  ownerships: ArrearsOwnershipInput[],
  invoices: ArrearsInvoiceInput[],
  now: Date,
): ArrearsReport {
  const currentPeriod = formatPeriod(now);

  const ownerNamesByUnitId = new Map<string, string[]>();
  for (const ownership of ownerships) {
    const names = ownerNamesByUnitId.get(ownership.unitId) ?? [];
    names.push(`${ownership.user.firstName} ${ownership.user.lastName}`.trim());
    ownerNamesByUnitId.set(ownership.unitId, names);
  }

  const invoicesByUnitId = new Map<string, ArrearsInvoiceInput[]>();
  for (const invoice of invoices) {
    const list = invoicesByUnitId.get(invoice.unitId) ?? [];
    list.push(invoice);
    invoicesByUnitId.set(invoice.unitId, list);
  }

  const rows: ArrearsRow[] = [];
  for (const unit of [...units].sort((a, b) =>
    a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
  )) {
    const unitInvoices = invoicesByUnitId.get(unit.id);
    if (!unitInvoices || unitInvoices.length === 0) continue;

    let outstandingCents = 0;
    let oldestUnpaidPeriod: string | null = null;
    const buckets: Record<ArrearsBucketKey, number> = {
      bucketCurrentCents: 0,
      bucket30Cents: 0,
      bucket60Cents: 0,
      bucket90PlusCents: 0,
    };

    for (const invoice of unitInvoices) {
      const remainingCents = invoice.totalCents - invoice.paidCents;
      if (remainingCents <= 0) continue;
      outstandingCents += remainingCents;
      buckets[bucketKeyFor(monthsBack(invoice.periodYearMonth, currentPeriod))] +=
        remainingCents;
      if (
        !oldestUnpaidPeriod ||
        invoice.periodYearMonth < oldestUnpaidPeriod
      ) {
        oldestUnpaidPeriod = invoice.periodYearMonth;
      }
    }

    if (outstandingCents <= 0) continue;

    rows.push({
      unitId: unit.id,
      unitLabel: unit.label,
      ownerNames: ownerNamesByUnitId.get(unit.id) ?? [],
      outstandingCents,
      ...buckets,
      oldestUnpaidPeriod,
    });
  }

  return {
    buildingId,
    generatedAt: now.toISOString(),
    totalOutstandingCents: rows.reduce(
      (sum, row) => sum + row.outstandingCents,
      0,
    ),
    rows,
  };
}
