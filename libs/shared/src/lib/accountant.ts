/** An ACCOUNTANT seat: read-only financial access to one building. */
export interface AccountantAccessDto {
  id: string;
  accountantId: string;
  accountantEmail: string;
  accountantFirstName?: string | null;
  accountantLastName?: string | null;
  buildingId: string;
  grantedById: string;
  /** ISO datetime. */
  createdAt: string;
}

/** ADMIN request body: grant a seat to an EXISTING user by email (404 if unknown). */
export interface GrantAccountantDto {
  email: string;
}

/** Building the accountant has been granted access to. */
export interface AccountantBuildingDto {
  buildingId: string;
  name: string;
  address: string;
}

/** Income side of the απολογισμός: what residents were charged, per category. */
export interface ApologismosCategoryTotal {
  categoryId: string | null;
  categoryName: string;
  chargedCents: number;
}

/** Costs vs budget plan, one row per category (mirrors budget compare rows). */
export interface ApologismosCostRow {
  categoryId: string | null;
  categoryName: string;
  plannedCents: number;
  actualCents: number;
}

/** Calendar-month point: invoiced to residents vs actually collected. */
export interface ApologismosMonthlyPoint {
  periodYearMonth: string;
  invoicedCents: number;
  collectedCents: number;
  arrearsCents: number;
}

/** Year-end closing balance for one unit, from the statements engine. */
export interface ApologismosUnitBalance {
  unitId: string;
  unitLabel: string;
  ownerName?: string;
  invoicedCents: number;
  paidCents: number;
  balanceCents: number;
}

export interface ApologismosTotals {
  chargedCents: number;
  plannedCents: number;
  actualCents: number;
  invoicedCents: number;
  collectedCents: number;
  arrearsCents: number;
  /** collected − actual costs; positive = πλεόνασμα, negative = έλλειμμα. */
  surplusDeficitCents: number;
}

/** The year-end annual financial statement pack for one building/year. */
export interface ApologismosDto {
  buildingId: string;
  buildingName: string;
  year: string;
  generatedAt: string;
  incomeByCategory: ApologismosCategoryTotal[];
  costsByCategory: ApologismosCostRow[];
  monthly: ApologismosMonthlyPoint[];
  unitBalances: ApologismosUnitBalance[];
  totals: ApologismosTotals;
}
