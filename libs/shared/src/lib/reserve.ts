/** Reserve Fund & Extraordinary Levies (Αποθεματικό) domain types per building. */

export type ReserveContributionSource = 'MANUAL' | 'LEVY' | 'INTEREST';
export type LevyStatus = 'DRAFT' | 'ISSUED' | 'CLOSED';
export type LevyStrategy =
  | 'MILIMES'
  | 'UNITS'
  | 'CUSTOM'
  | 'SQUARE_METERS'
  | 'SHARE_FRACTION';

export interface ReserveFundDto {
  id: string;
  buildingId: string;
  targetCents: number;
  balanceCents: number;
  /** Derived coverage percent (balance / target * 100), 0 when target is 0. */
  coveragePercent?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveContributionDto {
  id: string;
  fundId: string;
  buildingId: string;
  amountCents: number;
  source: ReserveContributionSource;
  levyId?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ReserveDrawdownDto {
  id: string;
  fundId: string;
  buildingId: string;
  amountCents: number;
  reason: string;
  expenseId?: string | null;
  createdAt: string;
}

export interface LevyShareDto {
  id: string;
  levyId: string;
  unitId: string;
  amountCents: number;
  paidCents: number;
  unitLabel?: string | null;
}

export interface ExtraordinaryLevyDto {
  id: string;
  buildingId: string;
  title: string;
  totalCents: number;
  strategy: LevyStrategy;
  status: LevyStatus;
  voteId?: string | null;
  createdAt: string;
  shares?: LevyShareDto[];
}

export interface CreateReserveTargetDto {
  targetCents: number;
}

export interface CreateContributionDto {
  amountCents: number;
  source: ReserveContributionSource;
  notes?: string;
  levyId?: string;
}

export interface CreateDrawdownDto {
  amountCents: number;
  reason: string;
  expenseId?: string;
}

export interface CreateLevyDto {
  title: string;
  totalCents: number;
  strategy: LevyStrategy;
  customWeights?: { unitId: string; weight: number }[];
  voteId?: string;
}

/** Greek label for levy strategy. */
export function levyStrategyLabel(strategy: string): string {
  switch (strategy) {
    case 'MILIMES':
      return 'Χιλιοστά';
    case 'UNITS':
      return 'Ισόποσα';
    case 'CUSTOM':
      return 'Προσαρμοσμένη';
    case 'SQUARE_METERS':
      return 'Τετραγωνικά μέτρα';
    case 'SHARE_FRACTION':
      return 'Μερίδιο ιδιοκτησίας (‰)';
    default:
      return strategy;
  }
}

/** Greek label for levy status. */
export function levyStatusLabel(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'Προσχέδιο';
    case 'ISSUED':
      return 'Εκδοθείσα';
    case 'CLOSED':
      return 'Κλειστή';
    default:
      return status;
  }
}

/** Greek label for contribution source. */
export function contributionSourceLabel(source: string): string {
  switch (source) {
    case 'MANUAL':
      return 'Χειροκίνητη';
    case 'LEVY':
      return 'Έκτακτη εισφορά';
    case 'INTEREST':
      return 'Τόκοι';
    default:
      return source;
  }
}
