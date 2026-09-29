import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateSecret,
  totpAt,
  verifyTotp,
} from './totp';

/** RFC-6238 test secret: ASCII "12345678901234567890". */
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const STEP_MS = 30 * 1000;

describe('totp (RFC-6238, HMAC-SHA1, 6 digits)', () => {
  describe('base32', () => {
    it.each([
      [new Uint8Array(0), ''],
      [new Uint8Array([0x00]), 'AA'],
      [new Uint8Array([0xff]), '74'],
      [Buffer.from('foo'), 'MZXW6==='],
      [Buffer.from('foobar'), 'MZXW6YTBOI======'],
    ])('round-trips %j → %s', (bytes, expected) => {
      expect(base32Encode(bytes)).toBe(expected.replace(/=+$/, ''));
      expect(base32Decode(expected).equals(Buffer.from(bytes))).toBe(true);
    });

    it('decodes case-insensitively and ignores separators/padding', () => {
      // 'MZXW6YTB' is 40 bits = 5 bytes ('fooba'); the 6th byte needs OI.
      expect(base32Decode('mzxw6-ytb')).toEqual(Buffer.from('fooba'));
      expect(base32Decode('MZXW6YTBOI======').equals(Buffer.from('foobar'))).toBe(
        true,
      );
    });

    it('throws on characters outside the alphabet', () => {
      expect(() => base32Decode('ABC1')).toThrow(/Invalid base32/);
      expect(() => base32Decode('hello!!')).toThrow(/Invalid base32/);
    });

    it('handles odd byte lengths without losing bits', () => {
      const bytes = Buffer.from([1, 2, 3, 4, 5, 6, 7]);
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    });
  });

  describe('generateSecret', () => {
    it('produces valid unique base32 secrets with ≥128 bits of entropy', () => {
      const a = generateSecret();
      const b = generateSecret();
      expect(a).toMatch(/^[A-Z2-7]+$/);
      expect(a.length).toBeGreaterThanOrEqual(26);
      expect(a).not.toBe(b);
      // Decoding must succeed (round-trip sanity).
      expect(base32Decode(a).length).toBe(20);
    });
  });

  describe('totpAt — RFC-6238 appendix B vectors (SHA1, truncated to 6 digits)', () => {
    it.each([
      [59, '287082'], // full 8-digit vector: 94287082
      [1111111109, '081804'], // 07081804
      [1111111111, '050471'],
      [1234567890, '005924'], // 89005924
      [2000000000, '279037'],
    ])('t=%is produces %s', (timeSec, expected) => {
      expect(totpAt(RFC_SECRET_BASE32, timeSec * 1000)).toBe(expected);
    });
  });

  describe('verifyTotp', () => {
    const fixedNow = 59 * 1000; // aligns with the first RFC vector

    it('accepts the code for the current step', () => {
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      try {
        expect(verifyTotp(RFC_SECRET_BASE32, '287082', 0)).toBe(true);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('cross-verifies codes freshly generated from generateSecret', () => {
      const secret = generateSecret();
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        expect(verifyTotp(secret, totpAt(secret, now), 0)).toBe(true);
        // Previous/next-step codes verify inside the default ±1 window.
        expect(verifyTotp(secret, totpAt(secret, now - STEP_MS))).toBe(true);
        expect(verifyTotp(secret, totpAt(secret, now + STEP_MS))).toBe(true);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('rejects codes outside the configured window', () => {
      const secret = generateSecret();
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        expect(verifyTotp(secret, totpAt(secret, now - 2 * STEP_MS), 1)).toBe(
          false,
        );
        expect(verifyTotp(secret, totpAt(secret, now + 2 * STEP_MS), 1)).toBe(
          false,
        );
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('rejects garbage: non-numeric, wrong length, invalid secret', () => {
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      try {
        expect(verifyTotp(RFC_SECRET_BASE32, 'abcdef')).toBe(false);
        expect(verifyTotp(RFC_SECRET_BASE32, '12345')).toBe(false);
        expect(verifyTotp(RFC_SECRET_BASE32, '1234567')).toBe(false);
        expect(verifyTotp(RFC_SECRET_BASE32, '')).toBe(false);
        expect(verifyTotp(RFC_SECRET_BASE32, '28708!')).toBe(false);
        expect(verifyTotp('not-base32!!!', '287082')).toBe(false);
        expect(verifyTotp('', '287082')).toBe(false);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('tolerates spaces/dashes typed between digits', () => {
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      try {
        expect(verifyTotp(RFC_SECRET_BASE32, '287 082')).toBe(true);
        expect(verifyTotp(RFC_SECRET_BASE32, '287-082')).toBe(true);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  describe('buildOtpauthUri', () => {
    it('builds a standards-compliant otpauth URI for QR scanning', () => {
      expect(
        buildOtpauthUri({
          email: 'admin@demo.gr',
          secret: 'JBSWY3DPEHPK3PXP',
        }),
      ).toBe(
        'otpauth://totp/PolykatoikiaOS%3Aadmin%40demo.gr' +
          '?secret=JBSWY3DPEHPK3PXP&issuer=PolykatoikiaOS' +
          '&algorithm=SHA1&digits=6&period=30',
      );
    });
  });
});
