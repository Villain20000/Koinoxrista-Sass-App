/**
 * Pure model for the Greek monthly ειδοποιητήριο κοινοχρήστων: one column
 * per expense category (Γενικά, Ανελκυστήρας, Θέρμανση, …) with the unit's
 * allocation coefficient, the building total of the column and the unit's
 * share. Kept free of Prisma/pdfkit so it is unit-testable.
 */

export type NoticePayer = 'OCCUPANT' | 'OWNER';

export interface NoticeUnit {
  id: string;
  label: string;
  floor: number | null;
  millimes: number;
  radiatorCount: number;
  squareMeters: number | null;
  shareFraction: number | null;
}

export interface NoticeExpense {
  description: string;
  totalCents: number;
  chargeTo?: NoticePayer | null;
  category: { id: string; name: string; strategy: string };
  /** Shares of THIS unit only (0 or 1 row). */
  shares: Array<{ amountCents: number }>;
}

export interface NoticeLine {
  description: string;
  buildingCents: number;
  unitCents: number;
}

export interface NoticeColumn {
  categoryId: string;
  name: string;
  strategy: string;
  strategyLabel: string;
  coefficient: string;
  buildingCents: number;
  unitCents: number;
  lines: NoticeLine[];
}

export interface MonthlyNotice {
  payer: NoticePayer;
  columns: NoticeColumn[];
  periodCents: number;
  previousBalanceCents: number;
  paidCents: number;
  dueCents: number;
}

export const STRATEGY_LABELS: Record<string, string> = {
  MILIMES: 'Χιλιοστά',
  UNITS: 'Ισόποσα ανά διαμέρισμα',
  CUSTOM: 'Ειδική κατανομή',
  RADIATORS: 'Θερμαντικά σώματα',
  ELEVATOR_FLOORS: 'Όροφοι (ανελκυστήρας)',
  METERS: 'Ενδείξεις μετρητών',
  SQUARE_METERS: 'Τετραγωνικά μέτρα',
  SHARE_FRACTION: 'Ποσοστό συνιδιοκτησίας',
  HEADCOUNT: 'Ανά άτομο',
};

export const PAYER_LABELS: Record<NoticePayer, string> = {
  OCCUPANT: 'Ένοικος / χρήστης',
  OWNER: 'Ιδιοκτήτης',
};

/** The unit's coefficient for a column, as printed on the notice. */
export function unitCoefficient(unit: NoticeUnit, strategy: string): string {
  switch (strategy) {
    case 'MILIMES':
      return `${unit.millimes}‰`;
    case 'RADIATORS':
      return `${unit.radiatorCount} σώματα`;
    case 'ELEVATOR_FLOORS':
      return unit.floor === null ? '—' : `${unit.floor}ος όροφος`;
    case 'SQUARE_METERS':
      return unit.squareMeters === null ? '—' : `${unit.squareMeters} τ.μ.`;
    case 'SHARE_FRACTION':
      return unit.shareFraction === null ? '—' : `${unit.shareFraction}‰`;
    case 'UNITS':
      return '1';
    default:
      return '—';
  }
}

export function buildMonthlyNotice(input: {
  unit: NoticeUnit;
  payer: NoticePayer;
  expenses: NoticeExpense[];
  invoiceTotalCents: number;
  paidCents: number;
  previousBalanceCents: number;
}): MonthlyNotice {
  const columns = new Map<string, NoticeColumn>();
  for (const expense of input.expenses) {
    if ((expense.chargeTo ?? 'OCCUPANT') !== input.payer) continue;
    const unitCents = expense.shares[0]?.amountCents ?? 0;
    const { id, name, strategy } = expense.category;
    const column = columns.get(id) ?? {
      categoryId: id,
      name,
      strategy,
      strategyLabel: STRATEGY_LABELS[strategy] ?? strategy,
      coefficient: unitCoefficient(input.unit, strategy),
      buildingCents: 0,
      unitCents: 0,
      lines: [],
    };
    column.buildingCents += expense.totalCents;
    column.unitCents += unitCents;
    column.lines.push({
      description: expense.description,
      buildingCents: expense.totalCents,
      unitCents,
    });
    columns.set(id, column);
  }
  const ordered = [...columns.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'el'),
  );
  const periodCents = input.invoiceTotalCents;
  const previousBalanceCents = Math.max(0, input.previousBalanceCents);
  return {
    payer: input.payer,
    columns: ordered,
    periodCents,
    previousBalanceCents,
    paidCents: input.paidCents,
    dueCents: periodCents - input.paidCents + previousBalanceCents,
  };
}
