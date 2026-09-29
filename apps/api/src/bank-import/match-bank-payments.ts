import type {
  BankMatchConfidence,
  BankMatchSuggestionDto,
  ParsedBankRowDto,
} from '@org/shared';

/** A PENDING payment of the building, candidate for statement matching. */
export interface PendingBankPayment {
  paymentId: string;
  amountCents: number;
  invoicePeriodYearMonth: string;
  createdAtIso: string;
  unitLabel: string;
}

const DAY_MS = 86_400_000;
const WINDOW_MS = 5 * DAY_MS;

const RANK: Record<BankMatchConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function withinWindow(rowDateIso: string, createdAtIso: string): boolean {
  const rowMs = Date.parse(`${rowDateIso}T12:00:00Z`);
  const createdMs = Date.parse(createdAtIso);
  if (Number.isNaN(rowMs) || Number.isNaN(createdMs)) return false;
  return Math.abs(rowMs - createdMs) <= WINDOW_MS;
}

function refContains(reference: string, needle: string): boolean {
  const haystack = reference.toLowerCase().replace(/\s+/g, '');
  if (!haystack || !needle) return false;
  return haystack.includes(needle.toLowerCase().replace(/\s+/g, ''));
}

function confidenceOf(
  row: ParsedBankRowDto,
  payment: PendingBankPayment,
): BankMatchConfidence {
  const near = withinWindow(row.dateIso, payment.createdAtIso);
  if (!near) return 'low';
  const refHit =
    refContains(row.reference, payment.paymentId) ||
    refContains(row.reference, payment.unitLabel);
  return refHit ? 'high' : 'medium';
}

/**
 * Greedy one-to-one matcher between statement rows and pending payments.
 * Candidates are ranked high → medium → low; each row and each payment is
 * used at most once. Rows without a usable candidate get no suggestion entry.
 */
export function suggestMatches(
  rows: ParsedBankRowDto[],
  pendingPayments: PendingBankPayment[],
): BankMatchSuggestionDto[] {
  interface Candidate {
    rowIndex: number;
    paymentIndex: number;
    confidence: BankMatchConfidence;
  }

  const candidates: Candidate[] = [];
  rows.forEach((row, rowIndex) => {
    pendingPayments.forEach((payment, paymentIndex) => {
      if (payment.amountCents !== row.amountCents) return;
      candidates.push({
        rowIndex,
        paymentIndex,
        confidence: confidenceOf(row, payment),
      });
    });
  });

  candidates.sort(
    (a, b) =>
      RANK[a.confidence] - RANK[b.confidence] ||
      a.rowIndex - b.rowIndex ||
      a.paymentIndex - b.paymentIndex,
  );

  const takenRows = new Set<number>();
  const takenPayments = new Set<number>();
  const suggestions: BankMatchSuggestionDto[] = [];
  for (const c of candidates) {
    if (takenRows.has(c.rowIndex) || takenPayments.has(c.paymentIndex)) {
      continue;
    }
    takenRows.add(c.rowIndex);
    takenPayments.add(c.paymentIndex);
    suggestions.push({
      rowIndex: c.rowIndex,
      paymentId: pendingPayments[c.paymentIndex].paymentId,
      confidence: c.confidence,
    });
  }
  return suggestions.sort((a, b) => a.rowIndex - b.rowIndex);
}
