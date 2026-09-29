import axios from 'axios';

import {
  prisma,
  seedBuilding,
  adminHeaders,
  uniqueSuffix,
  uniquePeriod,
  createExpenseAndRun,
  closePrisma,
} from './helpers';

/**
 * Smoke tests for the newest feature modules (maintenance, reserve, treasury,
 * supplier-invoices, legal, tenancy). Each module creates its own data with
 * unique labels and cleans up afterwards, so reruns are safe.
 */
describe('new feature modules', () => {
  let building: Awaited<ReturnType<typeof seedBuilding>>;
  const suffix = uniqueSuffix();

  beforeAll(async () => {
    building = await seedBuilding();
  });

  describe('maintenance', () => {
    let assetId: string;
    let scheduleId: string;

    it('creates an asset and a maintenance schedule', async () => {
      const asset = await axios.post(
        `/api/buildings/${building.id}/assets`,
        { name: `E2E Ανελκυστήρας ${suffix}`, category: 'ELEVATOR' },
        { headers: await adminHeaders() },
      );
      expect(asset.data.id).toBeTruthy();
      assetId = asset.data.id;

      const schedule = await axios.post(
        `/api/buildings/${building.id}/maintenance/schedules`,
        { assetId, title: `E2E Συντήρηση ${suffix}`, intervalMonths: 12 },
        { headers: await adminHeaders() },
      );
      expect(schedule.data.id).toBeTruthy();
      expect(schedule.data.nextDueAt).toBeTruthy();
      scheduleId = schedule.data.id;
    });

    it('generate-jobs is a no-op when nothing is due', async () => {
      const res = await axios.post(
        `/api/buildings/${building.id}/maintenance/generate-jobs`,
        {},
        { headers: await adminHeaders() },
      );
      expect(res.data).toEqual({ created: 0, skipped: 0 });
    });

    it('marks a schedule done and advances the next due date', async () => {
      const res = await axios.post(
        `/api/buildings/${building.id}/maintenance/schedules/${scheduleId}/done`,
        { notes: 'e2e completed' },
        { headers: await adminHeaders() },
      );
      expect(res.data.lastDoneAt).toBeTruthy();
      expect(res.data.daysLeft).toBeGreaterThan(0);
    });

    it('lists the maintenance calendar', async () => {
      const res = await axios.get(
        `/api/buildings/${building.id}/maintenance/calendar`,
        { headers: await adminHeaders() },
      );
      expect(Array.isArray(res.data.events)).toBe(true);
      expect(Array.isArray(res.data.assets)).toBe(true);
    });

    afterAll(async () => {
      await prisma.maintenanceSchedule.deleteMany({ where: { id: scheduleId } });
      await prisma.buildingAsset.deleteMany({ where: { id: assetId } });
    });
  });

  describe('reserve fund', () => {
    let fundId: string;
    let contributionId: string;
    let levyId: string;

    it('creates the fund and accepts a contribution', async () => {
      // Fund auto-creates on first access; PATCH target sets the goal.
      const fund = await axios.patch(
        `/api/buildings/${building.id}/reserve/target`,
        { targetCents: 500_000 },
        { headers: await adminHeaders() },
      );
      expect(fund.data.id).toBeTruthy();
      expect(fund.data.targetCents).toBe(500_000);
      fundId = fund.data.id;

      const contrib = await axios.post(
        `/api/buildings/${building.id}/reserve/contribute`,
        { amountCents: 10_000, source: 'MANUAL', notes: 'e2e' },
        { headers: await adminHeaders() },
      );
      expect(contrib.data.contribution.id).toBeTruthy();
      expect(contrib.data.fund.balanceCents).toBe(10_000);
      contributionId = contrib.data.contribution.id;
    });

    it('issues an extraordinary levy and funds the reserve', async () => {
      const levy = await axios.post(
        `/api/buildings/${building.id}/reserve/levies`,
        { title: `E2E Έκτακτη εισφορά ${suffix}`, totalCents: 20_000, strategy: 'MILIMES' },
        { headers: await adminHeaders() },
      );
      expect(levy.data.id).toBeTruthy();
      levyId = levy.data.id;

      const issued = await axios.post(
        `/api/buildings/${building.id}/reserve/levies/${levyId}/issue`,
        {},
        { headers: await adminHeaders() },
      );
      // issueLevy returns the updated levy itself
      expect(issued.data.status).toBe('ISSUED');

      const fund = await axios.get(
        `/api/buildings/${building.id}/reserve/fund`,
        { headers: await adminHeaders() },
      );
      // 10_000 contribution + 20_000 levy
      expect(fund.data.balanceCents).toBeGreaterThanOrEqual(30_000);
    });

    afterAll(async () => {
      await prisma.levyShare.deleteMany({ where: { levyId } });
      await prisma.extraordinaryLevy.deleteMany({ where: { id: levyId } });
      await prisma.reserveContribution.deleteMany({ where: { id: contributionId } });
      await prisma.reserveDrawdown.deleteMany({ where: { fundId } });
      await prisma.reserveFund.deleteMany({ where: { id: fundId } });
    });
  });

  describe('treasury', () => {
    let accountId: string;
    let entryId: string;

    it('creates an account and posts an entry', async () => {
      const account = await axios.post(
        `/api/buildings/${building.id}/treasury/accounts`,
        { name: `E2E Ταμείο ${suffix}`, type: 'BANK', iban: 'GR1601101250000000012300695' },
        { headers: await adminHeaders() },
      );
      expect(account.data.id).toBeTruthy();
      accountId = account.data.id;

      const entry = await axios.post(
        `/api/buildings/${building.id}/treasury/entries`,
        { accountId, amountCents: 5_000, direction: 'IN', method: 'BANK', reference: 'e2e' },
        { headers: await adminHeaders() },
      );
      expect(entry.data.id).toBeTruthy();
      entryId = entry.data.id;
    });

    it('reports a balance that reflects the entry', async () => {
      const res = await axios.get(
        `/api/buildings/${building.id}/treasury/balance`,
        { headers: await adminHeaders() },
      );
      expect(res.data.totalCents).toBeGreaterThanOrEqual(5_000);
    });

    afterAll(async () => {
      await prisma.treasuryEntry.deleteMany({ where: { id: entryId } });
      await prisma.treasuryAccount.deleteMany({ where: { id: accountId } });
    });
  });

  describe('supplier invoices', () => {
    let invoiceId: string;

    it('creates a manual supplier invoice and lists it', async () => {
      const invoice = await axios.post(
        `/api/buildings/${building.id}/supplier-invoices/manual`,
        {
          issuerName: `E2E Προμηθευτής ${suffix}`,
          issuerAfm: '123456789',
          issueDate: new Date().toISOString().slice(0, 10),
          netCents: 10_000,
          vatCents: 2_400,
          totalCents: 12_400,
        },
        { headers: await adminHeaders() },
      );
      expect(invoice.data.id).toBeTruthy();
      invoiceId = invoice.data.id;

      const list = await axios.get(
        `/api/buildings/${building.id}/supplier-invoices`,
        { headers: await adminHeaders() },
      );
      expect(
        list.data.items.some((inv: { id: string }) => inv.id === invoiceId),
      ).toBe(true);
    });

    it('returns supplier invoice stats', async () => {
      const res = await axios.get(
        `/api/buildings/${building.id}/supplier-invoices/stats`,
        { headers: await adminHeaders() },
      );
      expect(res.data.totalCount).toBeGreaterThanOrEqual(1);
    });

    afterAll(async () => {
      await prisma.supplierInvoice.deleteMany({ where: { id: invoiceId } });
    });
  });

  describe('legal cases', () => {
    const period = uniquePeriod();
    let invoiceId: string;
    let categoryId: string;
    let expenseId: string;
    let caseId: string;

    it('creates a legal case from an unpaid invoice', async () => {
      const unitId = building.units[0].id;
      const created = await createExpenseAndRun(building.id, period);
      categoryId = created.categoryId;
      expenseId = created.expenseId;
      const invoice = created.invoices.find((inv) => inv.unitId === unitId);
      if (!invoice) throw new Error('No invoice for legal case fixture');
      invoiceId = invoice.id;

      const legalCase = await axios.post(
        `/api/buildings/${building.id}/legal/cases`,
        {
          unitId,
          invoiceIds: [invoiceId],
          title: `E2E Υπόθεση ${suffix}`,
          lawyerName: 'Δικηγόρος Ε2Ε',
        },
        { headers: await adminHeaders() },
      );
      expect(legalCase.data.id).toBeTruthy();
      expect(legalCase.data.stage).toBe('NOTICE');
      caseId = legalCase.data.id;
    });

    it('adds a note and lists cases', async () => {
      await axios.post(
        `/api/buildings/${building.id}/legal/cases/${caseId}/note`,
        { note: 'e2e note' },
        { headers: await adminHeaders() },
      );
      const cases = await axios.get(
        `/api/buildings/${building.id}/legal/cases`,
        { headers: await adminHeaders() },
      );
      expect(cases.data.some((c: { id: string }) => c.id === caseId)).toBe(
        true,
      );
    });

    it('renders the exodik HTML document', async () => {
      const res = await axios.get(
        `/api/buildings/${building.id}/legal/cases/${caseId}/exodik`,
        { headers: await adminHeaders() },
      );
      expect(res.status).toBe(200);
      expect(typeof res.data).toBe('string');
      expect(res.data.length).toBeGreaterThan(100);
    });

    afterAll(async () => {
      await prisma.legalEvent.deleteMany({ where: { caseId } });
      await prisma.legalCase.deleteMany({ where: { id: caseId } });
      await prisma.payment.deleteMany({ where: { invoiceId } });
      await prisma.paymentOrder.deleteMany({ where: { invoiceId } });
      await prisma.invoice.deleteMany({ where: { id: invoiceId } });
      await prisma.share.deleteMany({ where: { expenseId } });
      await prisma.expense.delete({ where: { id: expenseId } });
      await prisma.expenseCategory.delete({ where: { id: categoryId } });
    });
  });

  describe('tenancy', () => {
    it('lists occupancy for a unit', async () => {
      const unitId = building.units[0].id;
      const res = await axios.get(
        `/api/buildings/${building.id}/occupancy/${unitId}`,
        { headers: await adminHeaders() },
      );
      expect(res.data).toBeDefined();
      expect(Array.isArray(res.data.occupants ?? res.data)).toBe(true);
    });

    it('lists eligibility rules', async () => {
      const res = await axios.get(
        `/api/buildings/${building.id}/eligibility-rules`,
        { headers: await adminHeaders() },
      );
      expect(Array.isArray(res.data)).toBe(true);
    });
  });

  afterAll(async () => {
    await closePrisma();
  });
});
