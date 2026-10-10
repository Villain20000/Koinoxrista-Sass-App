import { buildMonthlyNotice, unitCoefficient, NoticeUnit } from './monthly-notice';

const unit: NoticeUnit = {
  id: 'u1',
  label: 'Α1',
  floor: 1,
  millimes: 85,
  radiatorCount: 6,
  squareMeters: 72,
  shareFraction: null,
};

const general = { id: 'c-gen', name: 'Γενικά', strategy: 'MILIMES' };
const heating = { id: 'c-heat', name: 'Θέρμανση', strategy: 'RADIATORS' };
const elevator = { id: 'c-elev', name: 'Ανελκυστήρας', strategy: 'ELEVATOR_FLOORS' };

describe('buildMonthlyNotice', () => {
  const expenses = [
    { description: 'Καθαριότητα', totalCents: 12000, category: general, shares: [{ amountCents: 1020 }] },
    { description: 'ΔΕΗ κοινοχρήστων', totalCents: 8000, category: general, shares: [{ amountCents: 680 }] },
    { description: 'Πετρέλαιο', totalCents: 50000, category: heating, chargeTo: 'OCCUPANT' as const, shares: [{ amountCents: 4100 }] },
    { description: 'Συντήρηση ανελκυστήρα', totalCents: 6000, category: elevator, shares: [{ amountCents: 450 }] },
    { description: 'Στεγάνωση ταράτσας', totalCents: 100000, category: general, chargeTo: 'OWNER' as const, shares: [{ amountCents: 8500 }] },
  ];

  it('groups occupant charges into one column per category with coefficients', () => {
    const notice = buildMonthlyNotice({
      unit,
      payer: 'OCCUPANT',
      expenses,
      invoiceTotalCents: 6250,
      paidCents: 0,
      previousBalanceCents: 1000,
    });

    expect(notice.columns.map((c) => c.name)).toEqual(['Ανελκυστήρας', 'Γενικά', 'Θέρμανση']);
    const gen = notice.columns.find((c) => c.name === 'Γενικά')!;
    expect(gen).toMatchObject({ coefficient: '85‰', buildingCents: 20000, unitCents: 1700, strategyLabel: 'Χιλιοστά' });
    expect(gen.lines).toHaveLength(2);
    expect(notice.columns.find((c) => c.name === 'Θέρμανση')!.coefficient).toBe('6 σώματα');
    expect(notice.columns.find((c) => c.name === 'Ανελκυστήρας')!.coefficient).toBe('1ος όροφος');
    const columnSum = notice.columns.reduce((s, c) => s + c.unitCents, 0);
    expect(columnSum).toBe(6250);
    expect(notice.dueCents).toBe(7250);
  });

  it('keeps owner-borne charges on the owner notice only', () => {
    const notice = buildMonthlyNotice({
      unit,
      payer: 'OWNER',
      expenses,
      invoiceTotalCents: 8500,
      paidCents: 8500,
      previousBalanceCents: 0,
    });
    expect(notice.columns).toHaveLength(1);
    expect(notice.columns[0].lines[0].description).toBe('Στεγάνωση ταράτσας');
    expect(notice.dueCents).toBe(0);
  });
});

describe('unitCoefficient', () => {
  it('renders missing data as a dash', () => {
    expect(unitCoefficient({ ...unit, floor: null }, 'ELEVATOR_FLOORS')).toBe('—');
    expect(unitCoefficient(unit, 'METERS')).toBe('—');
    expect(unitCoefficient(unit, 'SQUARE_METERS')).toBe('72 τ.μ.');
  });
});
