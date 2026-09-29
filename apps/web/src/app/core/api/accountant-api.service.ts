import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { ArrearsReport, PayoutSummaryDto } from '@org/shared';
import { environment } from '../../../environments/environment';

// NOTE: these DTO mirrors live here until the integrator adds
// `export * from './lib/accountant'` to libs/shared/src/index.ts, after which
// they can be swapped for the canonical @org/shared types.

/** An ACCOUNTANT seat: read-only financial access to one building. */
export interface AccountantAccessDto {
  id: string;
  accountantId: string;
  accountantEmail: string;
  accountantFirstName?: string | null;
  accountantLastName?: string | null;
  buildingId: string;
  grantedById: string;
  createdAt: string;
}

/** Building the accountant has been granted access to. */
export interface AccountantBuildingDto {
  buildingId: string;
  name: string;
  address: string;
}

export interface ApologismosCategoryTotal {
  categoryId: string | null;
  categoryName: string;
  chargedCents: number;
}

export interface ApologismosCostRow {
  categoryId: string | null;
  categoryName: string;
  plannedCents: number;
  actualCents: number;
}

export interface ApologismosMonthlyPoint {
  periodYearMonth: string;
  invoicedCents: number;
  collectedCents: number;
  arrearsCents: number;
}

export interface ApologismosUnitBalance {
  unitId: string;
  unitLabel: string;
  ownerName?: string;
  invoicedCents: number;
  paidCents: number;
  balanceCents: number;
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
  totals: {
    chargedCents: number;
    plannedCents: number;
    actualCents: number;
    invoicedCents: number;
    collectedCents: number;
    arrearsCents: number;
    /** collected − actual costs; positive = πλεόνασμα, negative = έλλειμμα. */
    surplusDeficitCents: number;
  };
}

export interface ReportPeriodPoint {
  periodYearMonth: string;
  invoicedCents: number;
  collectedCents: number;
  arrearsCents: number;
}

export interface ReportCategoryTotal {
  categoryName: string;
  totalCents: number;
}

export interface AccountantReportSummary {
  periods: ReportPeriodPoint[];
  expensesByCategory: ReportCategoryTotal[];
  totals: {
    invoicedCents: number;
    collectedCents: number;
    arrearsCents: number;
    collectionRatePct: number;
  };
}

export interface AccountantStatementRow {
  periodYearMonth: string;
  description: string;
  invoicedCents: number;
  paidCents: number;
}

export interface AccountantStatement {
  buildingName: string;
  unitLabel: string;
  ownerName?: string;
  year: string;
  rows: AccountantStatementRow[];
  totals: {
    invoicedCents: number;
    paidCents: number;
    balanceCents: number;
  };
}

/**
 * READ-ONLY accountant endpoints (`/accountant/**`) plus the admin grant
 * management endpoints (`/buildings/:id/accountants`).
 */
@Injectable({ providedIn: 'root' })
export class AccountantApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/accountant`;

  // ── ACCOUNTANT reads ─────────────────────────────────────────────────────

  buildings(): Observable<AccountantBuildingDto[]> {
    return this.http.get<AccountantBuildingDto[]>(`${this.base}/buildings`);
  }

  summary(
    buildingId: string,
    months?: number,
  ): Observable<AccountantReportSummary> {
    const params: Record<string, string> = {};
    if (months) params['months'] = String(months);
    return this.http.get<AccountantReportSummary>(
      `${this.base}/buildings/${buildingId}/summary`,
      { params },
    );
  }

  statement(
    buildingId: string,
    year: string,
    unitId: string,
  ): Observable<AccountantStatement> {
    return this.http.get<AccountantStatement>(
      `${this.base}/buildings/${buildingId}/statements`,
      { params: { year, unitId } },
    );
  }

  payoutsSummary(
    buildingId: string,
    year?: number,
  ): Observable<PayoutSummaryDto> {
    const params: Record<string, string> = {};
    if (year) params['year'] = String(year);
    return this.http.get<PayoutSummaryDto>(
      `${this.base}/buildings/${buildingId}/payouts-summary`,
      { params },
    );
  }

  arrears(buildingId: string): Observable<ArrearsReport> {
    return this.http.get<ArrearsReport>(
      `${this.base}/buildings/${buildingId}/arrears`,
    );
  }

  apologismos(buildingId: string, year?: number): Observable<ApologismosDto> {
    const params: Record<string, string> = {};
    if (year) params['year'] = String(year);
    return this.http.get<ApologismosDto>(
      `${this.base}/buildings/${buildingId}/apologismos`,
      { params },
    );
  }

  // ── ADMIN seat administration ────────────────────────────────────────────

  listAccesses(buildingId: string): Observable<AccountantAccessDto[]> {
    return this.http.get<AccountantAccessDto[]>(
      `${environment.apiUrl}/buildings/${buildingId}/accountants`,
    );
  }

  grant(buildingId: string, email: string): Observable<AccountantAccessDto> {
    return this.http.post<AccountantAccessDto>(
      `${environment.apiUrl}/buildings/${buildingId}/accountants`,
      { email },
    );
  }

  revoke(buildingId: string, accessId: string): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiUrl}/buildings/${buildingId}/accountants/${accessId}`,
    );
  }
}
