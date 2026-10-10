import axios from 'axios';

import {
  prisma,
  seedBuilding,
  adminHeaders,
  residentHeaders,
  uniqueSuffix,
  closePrisma,
} from './helpers';

/**
 * Greek MVP core: χιλιοστά check, occupant vs owner invoices and the
 * monthly ειδοποιητήριο PDF streamed as real application/pdf bytes.
 */
describe('greek core billing', () => {
  // Distinct far-future period so it never collides with billing.spec.
  const period = `20${70 + (Date.now() % 29)}-${String(1 + (Date.now() % 12)).padStart(2, '0')}`;
  let buildingId: string;
  let categoryId: string;
  const expenseIds: string[] = [];

  beforeAll(async () => {
    const building = await seedBuilding();
    buildingId = building.id;
    const cat = await axios.post(
      `/api/buildings/${buildingId}/categories`,
      { name: `Γενικά E2E ${uniqueSuffix()}`, strategy: 'MILIMES' },
      { headers: await adminHeaders() },
    );
    categoryId = cat.data.id;
    for (const [description, totalCents, chargeTo] of [
      ['Καθαριότητα', 10000, 'OCCUPANT'],
      ['Στεγάνωση ταράτσας', 50000, 'OWNER'],
    ] as const) {
      const res = await axios.post(
        `/api/buildings/${buildingId}/expenses`,
        { categoryId, description, totalCents, periodYearMonth: period, chargeTo },
        { headers: await adminHeaders() },
      );
      expect(res.data.chargeTo).toBe(chargeTo);
      expenseIds.push(res.data.id);
    }
  });

  it('reports the seeded χιλιοστά table as complete (1000‰)', async () => {
    const res = await axios.get(`/api/buildings/${buildingId}/units/millimes-check`, {
      headers: await adminHeaders(),
    });
    expect(res.data.ok).toBe(true);
    expect(res.data.checks[0].total).toBe(1000);
  });

  it('issues separate occupant and owner invoices that add up to the expenses', async () => {
    const run = await axios.post(
      `/api/buildings/${buildingId}/invoices/run`,
      { periodYearMonth: period },
      { headers: await adminHeaders() },
    );
    const invoices = run.data as Array<{ payer: string; totalCents: number }>;
    const sum = (payer: string) =>
      invoices.filter((i) => i.payer === payer).reduce((s, i) => s + i.totalCents, 0);
    expect(sum('OCCUPANT')).toBe(10000);
    expect(sum('OWNER')).toBe(50000);
  });

  it('streams the monthly ειδοποιητήριο as a real PDF', async () => {
    const mine = await axios.get(`/api/invoices/mine?periodYearMonth=${period}`, {
      headers: await residentHeaders(),
    });
    expect(mine.data.length).toBeGreaterThan(0);
    const pdf = await axios.get(`/api/invoices/${mine.data[0].id}/pdf`, {
      headers: await residentHeaders(),
      responseType: 'arraybuffer',
    });
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('eidopoiitirio-');
    const body = Buffer.from(pdf.data);
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.toString('latin1')).toContain('NotoSans');
  });

  afterAll(async () => {
    const invoices = await prisma.invoice.findMany({ where: { buildingId, periodYearMonth: period } });
    await prisma.paymentOrder.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
    await prisma.invoice.deleteMany({ where: { buildingId, periodYearMonth: period } });
    await prisma.share.deleteMany({ where: { expenseId: { in: expenseIds } } });
    await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
    await prisma.expenseCategory.deleteMany({ where: { id: categoryId } });
    await closePrisma();
  });
});
