import type { Role } from './domain';

/** Invite row as returned by the API (never exposes the token hash). */
export interface InviteDto {
  id: string;
  email: string;
  role: Role;
  buildingId: string | null;
  unitId: string | null;
  /** Label of the target unit (RESIDENT invites). */
  unit?: { label: string } | null;
  expiresAt: string;
  acceptedAt: string | null;
  invitedById: string;
  createdAt: string;
}

export interface CreateInviteDto {
  email: string;
  role: Role;
  unitId?: string;
  expiresInDays?: number;
}

/** Creation response carrying the one-time plain token inside `inviteUrl`. */
export interface InviteWithTokenResponse extends InviteDto {
  inviteUrl: string;
}

/** Optional invite token merged into the register payload (`POST /auth/register`). */
export interface RegisterWithInviteDto {
  inviteToken?: string;
}
