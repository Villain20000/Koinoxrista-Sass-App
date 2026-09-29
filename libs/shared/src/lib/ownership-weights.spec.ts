import {
  DEFAULT_OWNERSHIP_BASIS,
  resolveOwnershipBasis,
  totalOwnershipWeight,
  unitOwnershipWeight,
} from './ownership-weights';

describe('ownership weights (P0-3)', () => {
  it('defaults to millimes for Greek buildings', () => {
    const units = [
      { id: 'a', millimes: 600 },
      { id: 'b', millimes: 400 },
    ];
    expect(DEFAULT_OWNERSHIP_BASIS).toBe('MILLIMES');
    expect(resolveOwnershipBasis(units)).toBe('MILLIMES');
    expect(unitOwnershipWeight(units[0])).toBe(600);
    expect(totalOwnershipWeight(units)).toBe(1000);
  });

  it('prefers shareFraction over squareMeters when both are present', () => {
    const units = [
      { id: 'a', millimes: 500, squareMeters: 100, shareFraction: 600 },
      { id: 'b', millimes: 500, squareMeters: 60, shareFraction: 400 },
    ];
    expect(resolveOwnershipBasis(units)).toBe('SHARE_FRACTION');
    expect(unitOwnershipWeight(units[0], 'SHARE_FRACTION')).toBe(600);
    expect(totalOwnershipWeight(units, 'SHARE_FRACTION')).toBe(1000);
  });

  it('falls back to square meters when no shareFraction is set', () => {
    const units = [
      { id: 'a', millimes: 500, squareMeters: 85.5 },
      { id: 'b', millimes: 500, squareMeters: 64.25 },
    ];
    expect(resolveOwnershipBasis(units)).toBe('SQUARE_METERS');
    // Scaled ×100 to integer hundredths.
    expect(unitOwnershipWeight(units[0], 'SQUARE_METERS')).toBe(8550);
    expect(totalOwnershipWeight(units, 'SQUARE_METERS')).toBe(14975);
  });

  it('ignores a single stray squareMeters for basis resolution when no others exist', () => {
    const units = [{ id: 'a', millimes: 1000 }];
    expect(resolveOwnershipBasis(units)).toBe('MILLIMES');
  });

  it('treats zero/null weights as absent', () => {
    const units = [
      { id: 'a', millimes: 500, squareMeters: 0, shareFraction: null },
      { id: 'b', millimes: 500, squareMeters: null, shareFraction: 0 },
    ];
    expect(resolveOwnershipBasis(units)).toBe('MILLIMES');
  });
});