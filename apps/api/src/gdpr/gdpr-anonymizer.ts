import { createHash, randomBytes } from 'node:crypto';

import { ANONYMIZED_EMAIL_DOMAIN, ANONYMIZED_NAME } from '@org/shared';

export { ANONYMIZED_EMAIL_DOMAIN, ANONYMIZED_NAME };

/** Deterministic pseudonym — reruns of erasure never collide with a real user. */
export function anonymizedEmail(email: string): string {
  const hash = createHash('sha1').update(email).digest('hex').slice(0, 10);
  return `deleted+${hash}@${ANONYMIZED_EMAIL_DOMAIN}`;
}

export function anonymizeName(): string {
  return ANONYMIZED_NAME;
}

/** Unusable credential; login as the erased account is impossible.
 * NOTE: revoking already-issued refresh tokens needs a tokenVersion column later.
 */
export function randomPasswordHash(): string {
  return createHash('sha256').update(randomBytes(32)).digest('hex');
}
