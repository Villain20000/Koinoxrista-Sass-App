import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hand-rolled RFC-6238 TOTP (HMAC-SHA1) + RFC-4648 base32 helpers.
 * Deliberately dependency-free (node:crypto only).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 10 ** 6; // 6-digit codes
const SECRET_BYTES = 20; // 160-bit secret, per RFC 4226 §4 recommendation

/** Encodes bytes as unpadded RFC-4648 base32 (A–Z, 2–7). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decodes unpadded/padded base32; throws on characters outside the alphabet. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generates a random base32-encoded TOTP secret (160 bits of entropy). */
export function generateSecret(numBytes = SECRET_BYTES): string {
  return base32Encode(randomBytes(numBytes));
}

/** RFC-4226 HOTP digest for a counter, rendered as 6 decimal digits. */
function hotp(secretBytes: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secretBytes).update(message).digest();
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % DIGITS).padStart(6, '0');
}

/** TOTP at a point in time (ms epoch); `timeSec` injection kept for tests. */
export function totpAt(
  base32Secret: string,
  timeMs: number,
  stepSeconds = STEP_SECONDS,
): string {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  return hotp(base32Decode(base32Secret), counter);
}

/**
 * Verifies a 6-digit token against the current ±`window` steps.
 * Accepts spaces/dashes in the input and is length-checked before comparing.
 */
export function verifyTotp(
  base32Secret: string,
  token: string,
  window = 1,
  stepSeconds = STEP_SECONDS,
): boolean {
  const normalized = token.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(base32Secret);
  } catch {
    return false;
  }

  const nowCounter = Math.floor(Date.now() / 1000 / stepSeconds);
  const provided = Buffer.from(normalized, 'utf8');
  for (let delta = -window; delta <= window; delta++) {
    const candidate = Buffer.from(hotp(secretBytes, nowCounter + delta), 'utf8');
    if (timingSafeEqual(candidate, provided)) return true;
  }
  return false;
}

/** Builds the otpauth:// URI that authenticator apps encode as a QR code. */
export function buildOtpauthUri(options: {
  email: string;
  secret: string;
  issuer?: string;
}): string {
  const issuer = options.issuer ?? 'PolykatoikiaOS';
  const label = encodeURIComponent(`${issuer}:${options.email}`);
  return (
    `otpauth://totp/${label}` +
    `?secret=${options.secret}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    '&algorithm=SHA1&digits=6&period=30'
  );
}
