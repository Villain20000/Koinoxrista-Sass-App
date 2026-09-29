/** Treasury (Ταμείο) domain types for cash-box accounting per building. */

export type TreasuryAccountType = 'CASH' | 'BANK';
export type TreasuryDirection = 'IN' | 'OUT';
export type TreasuryMethod = 'CASH' | 'BANK' | 'CHECK' | 'CARD';

export interface TreasuryAccountDto {
  id: string;
  buildingId: string;
  name: string;
  type: TreasuryAccountType;
  iban?: string | null;
  balanceCents: number;
  createdAt: string;
}

export interface CreateTreasuryAccountDto {
  name: string;
  type: TreasuryAccountType;
  iban?: string;
}

export interface TreasuryEntryDto {
  id: string;
  accountId: string;
  buildingId: string;
  amountCents: number;
  direction: TreasuryDirection;
  method: TreasuryMethod;
  reference?: string | null;
  notes?: string | null;
  receiptUrl?: string | null;
  createdById?: string | null;
  createdAt: string;
  /** Denormalized account name for list views. */
  accountName?: string | null;
}

export interface CreateTreasuryEntryDto {
  accountId: string;
  amountCents: number;
  direction: TreasuryDirection;
  method: TreasuryMethod;
  reference?: string;
  notes?: string;
  receiptUrl?: string;
}

export interface TreasuryBalanceDto {
  totalCents: number;
  cashCents: number;
  bankCents: number;
  byAccount: { accountId: string; name: string; type: TreasuryAccountType; balanceCents: number }[];
  byMonth: { month: string; inCents: number; outCents: number; netCents: number }[];
}

export interface TreasuryEntriesResponseDto {
  items: TreasuryEntryDto[];
  total: number;
}
