import { checkMillesimalTables } from './domain';

describe('checkMillesimalTables', () => {
  it('accepts a millimes table summing to 1000 and skips unused shareFraction', () => {
    const checks = checkMillesimalTables([{ millimes: 600 }, { millimes: 400, shareFraction: null }]);
    expect(checks).toHaveLength(1);
    expect(checks[0].ok).toBe(true);
  });

  it('reports the difference when millimes do not sum to 1000', () => {
    const [check] = checkMillesimalTables([{ millimes: 600 }, { millimes: 390 }]);
    expect(check.ok).toBe(false);
    expect(check.total).toBe(990);
    expect(check.message).toContain('διαφορά 10‰');
  });

  it('requires shareFraction on every unit once used, summing to 1000', () => {
    const partial = checkMillesimalTables([
      { millimes: 500, shareFraction: 500 },
      { millimes: 500, shareFraction: null },
    ]);
    expect(partial[1]).toMatchObject({ table: 'shareFraction', ok: false, unitsWithValue: 1 });
    const full = checkMillesimalTables([
      { millimes: 500, shareFraction: 450 },
      { millimes: 500, shareFraction: 550 },
    ]);
    expect(full[1].ok).toBe(true);
  });

  it('fails an empty building', () => {
    expect(checkMillesimalTables([])[0].ok).toBe(false);
  });
});
