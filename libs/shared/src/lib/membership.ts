import type { Role } from './domain';

/** Multi-building tenancy (Phase 4): membership of a user in a building. */

export interface MembershipBuilding {
  id: string;
  name: string;
  address?: string;
  city?: string;
  /** Synthetic region code (GR/EU/US/MX/BR…) — defaults to GR. */
  market?: string;
  /** ISO-4217 currency for the building — defaults to EUR. */
  currency?: string;
  pspProvider?: string | null;
}

export interface MembershipDto {
  id: string;
  role: Role;
  isDefault: boolean;
  building: MembershipBuilding;
}

export interface SwitchBuildingDto {
  buildingId: string;
}
