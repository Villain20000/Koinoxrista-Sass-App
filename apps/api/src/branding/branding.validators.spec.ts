import { isCustomDomain, isHexColor, isHttpsUrl } from './dto/branding.validators';

describe('branding validators', () => {
  describe('isHexColor', () => {
    it.each(['#1e40af', '#0af', '#ABCDEF', '#0EA5E9'])(
      'accepts %s',
      (value) => {
        expect(isHexColor(value)).toBe(true);
      },
    );

    it.each([
      '1e40af',
      '#12345',
      '#1234567',
      '#12g',
      'blue',
      '',
      '#',
    ])('rejects %s', (value) => {
      expect(isHexColor(value)).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(isHexColor(null)).toBe(false);
      expect(isHexColor(0x1e40af)).toBe(false);
    });
  });

  describe('isCustomDomain', () => {
    it.each([
      'building.example.gr',
      'polykatoikiaos.example.co',
      'a-b.example-domain.io',
    ])('accepts %s', (value) => {
      expect(isCustomDomain(value)).toBe(true);
    });

    it.each([
      '-leadinghyphen.example.com',
      'nodot',
      'double..dot.com',
      '.starts.with.dot',
      'with space.example.com',
      'https://brand.example.gr',
      'brand.example.gr/path',
    ])('rejects %s', (value) => {
      expect(isCustomDomain(value)).toBe(false);
    });
  });

  describe('isHttpsUrl', () => {
    it.each([
      'https://cdn.example.gr/logo.png',
      'https://brand.example.gr/assets/logo.svg#anchor',
    ])('accepts %s', (value) => {
      expect(isHttpsUrl(value)).toBe(true);
    });

    it.each([
      'http://cdn.example.gr/logo.png',
      'ftp://cdn.example.gr/logo.png',
      'cdn.example.gr/logo.png',
      '//cdn.example.gr/logo.png',
      '',
    ])('rejects %s', (value) => {
      expect(isHttpsUrl(value)).toBe(false);
    });

    it('rejects a URL string that does not round-trip (embedded whitespace)', () => {
      expect(isHttpsUrl('https://cdn.example.gr/a b.png')).toBe(false);
    });
  });
});
