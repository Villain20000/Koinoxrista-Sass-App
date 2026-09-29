/** Partner lead categories (mirrors the API `PartnerLead.category` values). */
export const PARTNER_CATEGORIES = ['INSURANCE', 'ELEVATOR', 'ENERGY', 'OTHER'] as const;

export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

/**
 * A referral of the building to a partner (insurance broker per Ν.4756/2020,
 * elevator maintenance company, energy auditor, …) with the agreed revenue
 * share. Commissions are integer cents.
 */
export interface PartnerLeadDto {
  id: string;
  buildingId: string;
  partnerName: string;
  category: PartnerCategory | string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  expectedCommissionCents: number;
  /** Realized commission; set when (and after) a lead is marked WON. */
  actualCommissionCents: number | null;
  /** NEW | CONTACTED | QUOTED | WON | LOST */
  status: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePartnerLeadDto {
  partnerName: string;
  category: PartnerCategory | string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  expectedCommissionCents: number;
  notes?: string;
}

/** Partial edit; omitted fields keep their current value. */
export interface UpdatePartnerLeadDto {
  partnerName?: string;
  category?: PartnerCategory | string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  expectedCommissionCents?: number;
  actualCommissionCents?: number;
  notes?: string;
}

/** Body of `POST /partner-leads/:id/status`. */
export interface LeadStatusDto {
  status: string;
  /** Required when `status` is `WON` (realized commission in cents, ≥ 0). */
  actualCommissionCents?: number;
}

/** Won-commission rollup for one year. Months are `YYYY-MM` keys (UTC). */
export interface PartnerSummaryDto {
  byCategory: { category: string; wonCount: number; commissionCents: number }[];
  byMonth: { month: string; commissionCents: number }[];
  totalWonCents: number;
}
