/** Current schema version of the building transfer (backup) payload. */
export const BUILDING_TRANSFER_VERSION = 1;

/** All `AllocationStrategy` enum values accepted in a transfer payload. */
export type TransferStrategy =
  | 'MILIMES'
  | 'UNITS'
  | 'CUSTOM'
  | 'RADIATORS'
  | 'ELEVATOR_FLOORS'
  | 'METERS'
  | 'SQUARE_METERS'
  | 'SHARE_FRACTION'
  | 'HEADCOUNT';

/** All `ComplianceKind` enum values accepted in a transfer payload. */
export type TransferComplianceKind =
  | 'INSURANCE'
  | 'ELEVATOR_CERTIFICATE'
  | 'FIRE_SAFETY'
  | 'OTHER';

export interface TransferBuildingDto {
  name: string;
  address: string;
  city: string;
}

export interface TransferUnitDto {
  label: string;
  floor: number | null;
  millimes: number;
  radiatorCount: number;
  squareMeters?: number | null;
  shareFraction?: number | null;
}

/** Ownership keyed to an owner email; import re-links via existing users only. */
export interface TransferOwnershipDto {
  unitLabel: string;
  email: string;
  shareMillimes: number;
}

export interface TransferCategoryDto {
  name: string;
  strategy: TransferStrategy;
}

export interface TransferRecurringExpenseDto {
  name: string;
  amountCents: number;
  strategy: TransferStrategy;
  active: boolean;
  categoryName: string | null;
  /** Last billed `YYYY-MM` period; null = never billed. */
  lastPeriod: string | null;
}

export interface TransferBudgetLineDto {
  year: number;
  name: string;
  plannedCents: number;
  categoryName: string | null;
}

export interface TransferComplianceItemDto {
  kind: TransferComplianceKind;
  title: string;
  providerName: string | null;
  policyNumber: string | null;
  premiumCents: number | null;
  /** ISO date-time strings. */
  startsOn: string;
  endsOn: string;
  notes: string | null;
}

/** Full building backup produced by `GET /buildings/:id/transfer/export`. */
export interface BuildingExportPayload {
  version: number;
  exportedAt: string;
  building: TransferBuildingDto;
  units: TransferUnitDto[];
  ownerships: TransferOwnershipDto[];
  categories: TransferCategoryDto[];
  recurringExpenses: TransferRecurringExpenseDto[];
  budgetLines: TransferBudgetLineDto[];
  complianceItems: TransferComplianceItemDto[];
}

/** Counts of rows created per entity during `POST /transfer/import`. */
export interface BuildingImportCreatedCounts {
  units: number;
  ownerships: number;
  categories: number;
  recurringExpenses: number;
  budgetLines: number;
  complianceItems: number;
}

/**
 * Items that could not be imported, identified by email / name / title:
 * unknown owner emails, recurring templates & budget lines whose category
 * name is missing, compliance items with invalid dates or kinds.
 */
export interface BuildingImportSkippedReport {
  ownerships: string[];
  recurring: string[];
  budgetLines: string[];
  complianceItems: string[];
}

/** Result of `POST /transfer/import` (a NEW building is always created). */
export interface BuildingImportResult {
  buildingId: string;
  created: BuildingImportCreatedCounts;
  skipped: BuildingImportSkippedReport;
}
