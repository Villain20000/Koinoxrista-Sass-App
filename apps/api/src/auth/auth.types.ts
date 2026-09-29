import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  buildingId: string | null;
}

export interface AccessTokenPayload
  extends Omit<AuthenticatedUser, 'id'> {
  sub: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

export const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'change-me';
export const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'change-me-too';
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '7d';
export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimal structural HTTP types (avoids a hard @types/express dependency). */
export interface HttpRequest {
  headers: {
    cookie?: string;
    authorization?: string;
    'user-agent'?: string;
  };
  ip?: string;
  user?: AuthenticatedUser;
  on(event: 'close', listener: () => void): this;
}

export interface HttpResponse {
  cookie(
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      maxAge?: number;
      path?: string;
      secure?: boolean;
    },
  ): this;
  write(chunk: string): boolean;
  end(): void;
}
