import {
  ANONYMIZED_EMAIL_DOMAIN,
  ANONYMIZED_NAME,
  anonymizeName,
  anonymizedEmail,
  randomPasswordHash,
} from './gdpr-anonymizer';

describe('gdpr anonymizer', () => {
  it('derives a deterministic pseudonymous email from the original', () => {
    const first = anonymizedEmail('maria@demo.gr');
    const second = anonymizedEmail('maria@demo.gr');

    expect(first).toBe(second);
    expect(first).toMatch(
      new RegExp(`^deleted\\+[0-9a-f]{10}@${ANONYMIZED_EMAIL_DOMAIN}$`),
    );
  });

  it('produces different pseudonyms for different emails', () => {
    expect(anonymizedEmail('a@demo.gr')).not.toBe(anonymizedEmail('b@demo.gr'));
  });

  it('replaces names with the Greek anonymous label', () => {
    expect(anonymizeName()).toBe(ANONYMIZED_NAME);
  });

  it('returns a fresh unusable sha256 password hash per call', () => {
    const first = randomPasswordHash();
    const second = randomPasswordHash();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});
