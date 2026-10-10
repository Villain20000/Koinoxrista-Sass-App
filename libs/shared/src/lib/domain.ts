/** Role / strategy / status unions mirroring the Prisma enums. */
export type Role =
  | 'ADMIN'
  | 'RESIDENT'
  | 'PROVIDER'
  | 'ACCOUNTANT'
  | 'PLATFORM_ADMIN'
  | 'BUILDING_OWNER';

export type AllocationStrategy =
  | 'MILIMES'
  | 'UNITS'
  | 'CUSTOM'
  | 'RADIATORS'
  | 'ELEVATOR_FLOORS'
  | 'SQUARE_METERS'
  | 'SHARE_FRACTION'
  | 'HEADCOUNT';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export const TOTAL_MILLIMES = 1000;

export interface Unit {
  id: string;
  buildingId: string;
  label: string;
  floor?: number | null;
  millimes: number;
  radiatorCount: number;
  /** P0-3: usable area in m² (SQUARE_METERS strategy, EU/NA). */
  squareMeters?: number | null;
  /** P0-3: ownership share as integer ‰ of 1000 (SHARE_FRACTION, NA HOA). */
  shareFraction?: number | null;
}

export interface CreateUnitDto {
  label: string;
  floor?: number;
  millimes: number;
  radiatorCount?: number;
  squareMeters?: number;
  shareFraction?: number;
}

export interface Ownership {
  id: string;
  unitId: string;
  userId: string;
  shareMillimes: number;
  periodStart?: string | null;
}

export interface CreateOwnershipDto {
  userId: string;
  shareMillimes: number;
  periodStart?: string;
}

export interface ExpenseCategory {
  id: string;
  buildingId: string;
  name: string;
  strategy: AllocationStrategy;
}

export interface CreateExpenseCategoryDto {
  name: string;
  strategy: AllocationStrategy;
}

export interface Share {
  id: string;
  expenseId: string;
  unitId: string;
  amountCents: number;
}

/** Who bears a charge: occupant (ένοικος) or owner (ιδιοκτήτης). */
export type ChargePayer = 'OCCUPANT' | 'OWNER';

export const CHARGE_PAYER_LABELS: Record<ChargePayer, string> = {
  OCCUPANT: 'Ένοικος',
  OWNER: 'Ιδιοκτήτης',
};

export interface Expense {
  id: string;
  buildingId: string;
  categoryId: string;
  description: string;
  totalCents: number;
  periodYearMonth: string;
  createdById: string;
  createdAt?: string;
  chargeTo?: ChargePayer;
  shares?: Share[];
}

export interface CreateExpenseDto {
  categoryId: string;
  description: string;
  totalCents: number;
  periodYearMonth: string;
  chargeTo?: ChargePayer;
}

export interface Invoice {
  id: string;
  buildingId: string;
  unitId: string;
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
  status: PaymentStatus;
  payer?: ChargePayer;
}

export interface RunInvoicesDto {
  periodYearMonth: string;
}

export interface MillesimalTableCheck {
  table: 'millimes' | 'shareFraction';
  /** Sum over units that have a value for this table. */
  total: number;
  /** Units with a value (shareFraction is optional per unit). */
  unitsWithValue: number;
  unitCount: number;
  ok: boolean;
  message: string;
}

/**
 * Validates that the χιλιοστά tables of a building sum to exactly 1000‰.
 * The general millimes table is mandatory; the shareFraction table is only
 * checked when at least one unit uses it (then every unit must have it).
 */
export function checkMillesimalTables(
  units: Array<{ millimes: number; shareFraction?: number | null }>,
): MillesimalTableCheck[] {
  const millimesTotal = units.reduce((sum, u) => sum + u.millimes, 0);
  const checks: MillesimalTableCheck[] = [
    {
      table: 'millimes',
      total: millimesTotal,
      unitsWithValue: units.length,
      unitCount: units.length,
      ok: units.length > 0 && millimesTotal === TOTAL_MILLIMES,
      message:
        millimesTotal === TOTAL_MILLIMES
          ? 'Ο πίνακας γενικών χιλιοστών αθροίζει 1000‰.'
          : `Ο πίνακας γενικών χιλιοστών αθροίζει ${millimesTotal}‰ αντί για ${TOTAL_MILLIMES}‰ (διαφορά ${TOTAL_MILLIMES - millimesTotal}‰).`,
    },
  ];
  const withShare = units.filter(
    (u) => u.shareFraction !== null && u.shareFraction !== undefined,
  );
  if (withShare.length > 0) {
    const total = withShare.reduce((sum, u) => sum + (u.shareFraction ?? 0), 0);
    const complete = withShare.length === units.length;
    const ok = complete && total === TOTAL_MILLIMES;
    checks.push({
      table: 'shareFraction',
      total,
      unitsWithValue: withShare.length,
      unitCount: units.length,
      ok,
      message: ok
        ? 'Ο πίνακας ποσοστών συνιδιοκτησίας αθροίζει 1000‰.'
        : !complete
          ? `Λείπει ποσοστό συνιδιοκτησίας σε ${units.length - withShare.length} διαμέρισμα(τα).`
          : `Ο πίνακας ποσοστών συνιδιοκτησίας αθροίζει ${total}‰ αντί για ${TOTAL_MILLIMES}‰.`,
    });
  }
  return checks;
}
