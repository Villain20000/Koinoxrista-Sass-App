import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless "second factor pending" tickets for the login flow.
 *
 * After a correct password, users with 2FA enabled receive an opaque ticket
 * instead of tokens: base64url(payload).base64url(HMAC-SHA256(payload)).
 * The payload is {sub, exp}; there is no server-side session state.
 */

export const TWO_FACTOR_TICKET_TTL_MS = 5 * 60 * 1000;

interface TicketPayload {
  sub: string;
  /** Epoch ms after which the ticket is invalid. */
  exp: number;
}

function ticketSecret(): string {
  return process.env.JWT_SECRET ?? 'dev-only-two-factor-ticket-secret';
}

function hmac(payload: string): string {
  return createHmac('sha256', ticketSecret()).update(payload).digest('base64url');
}

/** Signs a short-lived login ticket for the given user. */
export function signLoginTicket(userId: string, nowMs = Date.now()): string {
  const payload: TicketPayload = {
    sub: userId,
    exp: nowMs + TWO_FACTOR_TICKET_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  return `${encoded}.${hmac(encoded)}`;
}

/**
 * Validates signature + expiry; returns the userId or null when the ticket is
 * malformed, tampered with, or expired.
 */
export function verifyLoginTicket(ticket: string, nowMs = Date.now()): string | null {
  const separator = ticket.indexOf('.');
  if (separator === -1) return null;
  const encoded = ticket.slice(0, separator);
  const signature = ticket.slice(separator + 1);

  const expected = Buffer.from(hmac(encoded), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  let payload: TicketPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof payload?.sub !== 'string' ||
    payload.sub.length === 0 ||
    typeof payload?.exp !== 'number' ||
    payload.exp <= nowMs
  ) {
    return null;
  }
  return payload.sub;
}
