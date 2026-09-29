import axios from 'axios';

import {
  prisma,
  seedBuilding,
  residentHeaders,
  adminHeaders,
  uniquePeriod,
  createExpenseAndRun,
  closePrisma,
} from './helpers';

/**
 * Full money flow against the seeded demo building:
 * admin creates an expense -> runs invoices -> resident starts checkout ->
 * PSP webhook marks the invoice paid.
 */
describe('billing lifecycle', () => {
  const period = uniquePeriod();
  let building: Awaited<ReturnType<typeof seedBuilding>>;
  let unitId: string;
  let categoryId: string;
  let expenseId: string;
  let invoiceId: string;

  beforeAll(async () => {
    building = await seedBuilding();
    unitId = building.units[0].id; // Α1 — owned by maria@demo.gr (seed)
    const created = await createExpenseAndRun(building.id, period);
    categoryId = created.categoryId;
    expenseId = created.expenseId;
    const invoice = created.invoices.find((inv) => inv.unitId === unitId);
    if (!invoice) throw new Error('No invoice produced for resident unit');
    invoiceId = invoice.id;
  });

  it('creates one invoice per unit for the period', async () => {
    const res = await axios.get(
      `/api/buildings/${building.id}/invoices?periodYearMonth=${period}`,
      { headers: await adminHeaders() },
    );
    expect(res.data.length).toBe(building.units.length);
    const first = res.data[0];
    expect(first.unitId).toBeTruthy();
    expect(first.totalCents).toBeGreaterThan(0);
  });

  it('resident sees the invoice in their balance', async () => {
    const res = await axios.get(
      `/api/invoices/mine?periodYearMonth=${period}`,
      { headers: await residentHeaders() },
    );
    const found = res.data.find(
      (inv: { id: string }) => inv.id === invoiceId,
    );
    expect(found).toBeTruthy();
    expect(found.status).toBe('PENDING');
  });

  it('resident starts checkout and the webhook marks the invoice paid', async () => {
    const checkout = await axios.post(
      `/api/invoices/${invoiceId}/pay`,
      {},
      { headers: await residentHeaders() },
    );
    const orderCode = checkout.data.order.orderCode as string;
    expect(orderCode).toBeTruthy();
    expect(checkout.data.order.status).toBe('PENDING');

    const webhook = await axios.post('/api/payments/webhook', { orderCode });
    expect(webhook.data.ok).toBe(true);

    const detail = await axios.get(`/api/invoices/${invoiceId}`, {
      headers: await residentHeaders(),
    });
    expect(detail.data.status).toBe('PAID');
    expect(detail.data.paidCents).toBe(detail.data.totalCents);
    expect(detail.data.payments.length).toBe(1);
  });

  it('blocks paying an already-paid invoice', async () => {
    await expect(
      axios.post(
        `/api/invoices/${invoiceId}/pay`,
        {},
        { headers: await residentHeaders() },
      ),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.paymentOrder.deleteMany({ where: { invoiceId } });
    await prisma.invoice.deleteMany({
      where: { periodYearMonth: period, buildingId: building.id },
    });
    await prisma.share.deleteMany({ where: { expenseId } });
    await prisma.expense.delete({ where: { id: expenseId } });
    await prisma.expenseCategory.delete({ where: { id: categoryId } });
    await closePrisma();
  });
});
