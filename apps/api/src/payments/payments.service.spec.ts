import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentOrderState,
  PaymentStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from './payments.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { VivaAdapter } from './viva.adapter';
import type { StripeAdapter } from './stripe.adapter';
import type { MercadoPagoAdapter } from './mercadopago.adapter';

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

const admin = (): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
});

const resident = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'resident-1',
  email: 'resident@demo.gr',
  role: 'RESIDENT',
  buildingId: 'building-1',
  ...overrides,
});

const invoiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'invoice-1',
  buildingId: 'building-1',
  unitId: 'unit-a',
  periodYearMonth: '2026-07',
  totalCents: 10_000,
  paidCents: 2_000,
  status: PaymentStatus.PENDING,
  // Feature 2: startCheckout routes by Building.pspProvider (default "viva").
  unit: {
    id: 'unit-a',
    building: { pspProvider: 'viva', name: 'Ηλέκτρα' },
  },
  ...overrides,
});

function makeTx(invoice = invoiceRow()) {
  return {
    invoice: {
      findUnique: jest.fn().mockResolvedValue(invoice),
      update: jest.fn().mockResolvedValue({}),
    },
    payment: { create: jest.fn().mockResolvedValue({}) },
    paymentOrder: { update: jest.fn().mockResolvedValue({}) },
  };
}

function makePrisma(tx = makeTx()) {
  return {
    invoice: {
      findUnique: jest.fn().mockResolvedValue(invoiceRow()),
    },
    ownership: {
      findFirst: jest.fn().mockResolvedValue({ id: 'own-1' }),
    },
    paymentOrder: {
      create: jest
        .fn()
        .mockImplementation(async ({ data }: { data: object }) => ({
          id: 'order-1',
          ...data,
        })),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (fn: (client: unknown) => Promise<void>) =>
      fn(tx),
    ),
    __tx: tx,
  };
}

type PrismaMock = ReturnType<typeof makePrisma>;

function makeAdapter(): VivaAdapter {
  return {
    createOrder: jest
      .fn()
      .mockResolvedValue({ orderCode: 'OC-123', checkoutUrl: 'https://psp/oc' }),
    getOrderStatus: jest.fn().mockResolvedValue('COMPLETED'),
  };
}

describe('PaymentsService.startCheckout', () => {
  let service: PaymentsService;
  let prisma: PrismaMock;
  let adapter: VivaAdapter;

  beforeEach(() => {
    prisma = makePrisma();
    adapter = makeAdapter();
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      auditStub(),
      adapter,
    );
  });

  it('creates a PENDING order for the outstanding amount', async () => {
    const { order } = await service.startCheckout('invoice-1', resident());

    expect(adapter.createOrder).toHaveBeenCalledWith(8_000, 'invoice-1');
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'invoice-1',
        orderCode: 'OC-123',
        amountCents: 8_000,
        status: PaymentOrderState.PENDING,
        checkoutUrl: 'https://psp/oc',
      }),
    });
    expect(order.amountCents).toBe(8_000);
  });

  it('rejects a fully paid invoice with 400', async () => {
    prisma.invoice.findUnique.mockResolvedValue(
      invoiceRow({ paidCents: 10_000, status: PaymentStatus.PAID }),
    );

    await expect(
      service.startCheckout('invoice-1', resident()),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('rejects an overpaid invoice (outstanding <= 0) even if not marked PAID', async () => {
    prisma.invoice.findUnique.mockResolvedValue(
      invoiceRow({ paidCents: 12_000 }),
    );

    await expect(
      service.startCheckout('invoice-1', resident()),
    ).rejects.toThrow(new BadRequestException('Invoice is already paid'));
  });

  it('rejects a resident who does not own the unit', async () => {
    prisma.ownership.findFirst.mockResolvedValue(null);

    await expect(
      service.startCheckout('invoice-1', resident()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects any user whose building differs from the invoice building', async () => {
    await expect(
      service.startCheckout('invoice-1', resident({ buildingId: 'building-9' })),
    ).rejects.toThrow(ForbiddenException);

    prisma.invoice.findUnique.mockResolvedValue(
      invoiceRow({ buildingId: 'building-2' }),
    );
    await expect(service.startCheckout('invoice-1', admin())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s when the invoice does not exist', async () => {
    prisma.invoice.findUnique.mockResolvedValue(null);

    await expect(service.startCheckout('missing', admin())).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('PaymentsService.startCheckout (P0-2 market-aware PSP routing)', () => {
  let service: PaymentsService;
  let prisma: PrismaMock;
  let adapter: VivaAdapter;
  let stripe: StripeAdapter;
  let mercadopago: MercadoPagoAdapter;

  beforeEach(() => {
    prisma = makePrisma();
    adapter = makeAdapter();
    stripe = {
      createCheckout: jest.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_1',
        paymentIntentRef: 'cs_1',
      }),
      verifyWebhook: jest.fn(),
    };
    mercadopago = {
      createCheckout: jest.fn().mockResolvedValue({
        checkoutRef: 'pref-mp-1',
        checkoutUrl: 'https://mp/checkout/pref-mp-1',
      }),
      getPaymentStatus: jest.fn(),
    };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      auditStub(),
      adapter,
      undefined,
      stripe,
      mercadopago,
    );
  });

  it('routes stripe buildings through the market-aware Stripe adapter with the building currency', async () => {
    prisma.invoice.findUnique.mockResolvedValue(
      invoiceRow({
        unit: {
          id: 'unit-a',
          building: { pspProvider: 'stripe', name: 'Maple Condos', currency: 'USD' },
        },
      }),
    );

    await service.startCheckout('invoice-1', resident());

    expect(stripe.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 8_000,
        invoiceRef: 'invoice-1',
        currency: 'USD',
      }),
    );
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderCode: 'cs_1',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_1',
      }),
    });
  });

  it('routes mercadopago buildings through the Mercado Pago adapter', async () => {
    prisma.invoice.findUnique.mockResolvedValue(
      invoiceRow({
        unit: {
          id: 'unit-a',
          building: { pspProvider: 'mercadopago', name: 'Condomínio Verde', currency: 'BRL' },
        },
      }),
    );

    await service.startCheckout('invoice-1', resident());

    expect(mercadopago.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'BRL', invoiceRef: 'invoice-1' }),
    );
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderCode: 'pref-mp-1' }),
    });
  });

  it('keeps the Viva default when pspProvider is unset (GR regression)', async () => {
    await service.startCheckout('invoice-1', resident());
    expect(adapter.createOrder).toHaveBeenCalledWith(8_000, 'invoice-1');
    expect(stripe.createCheckout).not.toHaveBeenCalled();
    expect(mercadopago.createCheckout).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.handleMercadoPagoWebhook', () => {
  let service: PaymentsService;
  let prisma: PrismaMock;
  let adapter: VivaAdapter;
  let mercadopago: MercadoPagoAdapter;

  beforeEach(() => {
    prisma = makePrisma();
    adapter = makeAdapter();
    mercadopago = {
      createCheckout: jest.fn(),
      getPaymentStatus: jest.fn(),
    };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      auditStub(),
      adapter,
      undefined,
      undefined,
      mercadopago,
    );
  });

  it('settles via external_reference with the same idempotent transition', async () => {
    prisma.paymentOrder.findFirst = jest.fn().mockResolvedValue({
      id: 'order-mp',
      orderCode: 'pref-mp-1',
      invoiceId: 'invoice-1',
      amountCents: 8_000,
      status: PaymentOrderState.PENDING,
    });
    mercadopago.getPaymentStatus = jest
      .fn()
      .mockResolvedValue({ status: 'COMPLETED', externalReference: 'invoice-1' });

    await expect(
      service.handleMercadoPagoWebhook({
        type: 'payment',
        data: { id: 'pay-123' },
      }),
    ).resolves.toEqual({ ok: true });

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        method: PaymentMethod.PIX,
        pspRef: 'pay-123',
        amountCents: 8_000,
      }),
    });
    expect(prisma.__tx.paymentOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-mp' },
      data: { status: PaymentOrderState.COMPLETED },
    });
  });

  it('does not settle when the PSP status is not COMPLETED', async () => {
    prisma.paymentOrder.findFirst = jest.fn().mockResolvedValue({
      id: 'order-mp',
      orderCode: 'pref-mp-1',
      invoiceId: 'invoice-1',
      amountCents: 8_000,
      status: PaymentOrderState.PENDING,
    });
    mercadopago.getPaymentStatus = jest
      .fn()
      .mockResolvedValue({ status: 'PENDING', externalReference: 'invoice-1' });

    await expect(
      service.handleMercadoPagoWebhook({
        type: 'payment',
        data: { id: 'pay-123' },
      }),
    ).resolves.toEqual({ ok: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is idempotent once the order is COMPLETED', async () => {
    prisma.paymentOrder.findFirst = jest.fn().mockResolvedValue({
      id: 'order-mp',
      orderCode: 'pref-mp-1',
      invoiceId: 'invoice-1',
      amountCents: 8_000,
      status: PaymentOrderState.COMPLETED,
    });
    mercadopago.getPaymentStatus = jest
      .fn()
      .mockResolvedValue({ status: 'COMPLETED', externalReference: 'invoice-1' });

    await expect(
      service.handleMercadoPagoWebhook({
        type: 'payment',
        data: { id: 'pay-123' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.getOrder / getInvoiceDetail', () => {
  let service: PaymentsService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      auditStub(),
      makeAdapter(),
    );
  });

  it('returns the order to the owning resident', async () => {
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderCode: 'OC-1',
      invoice: { buildingId: 'building-1', unitId: 'unit-a' },
    });

    const order = await service.getOrder('order-1', resident());
    expect(order.id).toBe('order-1');
    expect(prisma.ownership.findFirst).toHaveBeenCalledWith({
      where: { userId: 'resident-1', unitId: 'unit-a' },
    });
  });

  it('forbids a resident who does not own the unit behind the order', async () => {
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      invoice: { buildingId: 'building-1', unitId: 'unit-b' },
    });
    prisma.ownership.findFirst.mockResolvedValue(null);

    await expect(service.getOrder('order-1', resident())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the building admin and includes payments and orders', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      ...invoiceRow(),
      payments: [{ id: 'payment-1' }],
      orders: [],
    });

    const detail = await service.getInvoiceDetail('invoice-1', admin());
    expect(detail.payments).toHaveLength(1);
    expect(detail.orders).toEqual([]);
  });
});

describe('PaymentsService.handleWebhook', () => {
  let service: PaymentsService;
  let prisma: PrismaMock;
  let adapter: VivaAdapter;

  beforeEach(() => {
    prisma = makePrisma();
    adapter = makeAdapter();
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      auditStub(),
      adapter,
    );
  });

  it('is idempotent once the order is COMPLETED (no PSP call, no writes)', async () => {
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderCode: 'OC-1',
      invoiceId: 'invoice-1',
      amountCents: 8_000,
      status: PaymentOrderState.COMPLETED,
    });

    await expect(service.handleWebhook({ orderCode: 'OC-1' })).resolves.toEqual(
      { ok: true },
    );
    expect(adapter.getOrderStatus).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('marks the order FAILED and answers ok:false when PSP status is not COMPLETED', async () => {
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderCode: 'OC-1',
      invoiceId: 'invoice-1',
      amountCents: 8_000,
      status: PaymentOrderState.PENDING,
    });
    adapter.getOrderStatus = jest.fn().mockResolvedValue('PENDING');

    await expect(service.handleWebhook({ orderCode: 'OC-1' })).resolves.toEqual(
      { ok: false },
    );
    expect(adapter.getOrderStatus).toHaveBeenCalledWith('OC-1');
    expect(prisma.paymentOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: PaymentOrderState.FAILED },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records the payment, increments paidCents, flips invoice PAID and completes the order', async () => {
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderCode: 'OC-1',
      invoiceId: 'invoice-1',
      amountCents: 8_000,
      status: PaymentOrderState.PENDING,
    });

    await expect(
      service.handleWebhook({ orderCode: 'OC-1', transactionId: 'TX-9' }),
    ).resolves.toEqual({ ok: true });

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith({
      data: {
        invoiceId: 'invoice-1',
        method: PaymentMethod.CARD,
        pspRef: 'TX-9',
        amountCents: 8_000,
        status: PaymentStatus.PAID,
      },
    });
    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-1' },
      data: {
        paidCents: { increment: 8_000 },
        status: PaymentStatus.PAID,
      },
    });
    expect(prisma.__tx.paymentOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: PaymentOrderState.COMPLETED },
    });
  });

  it('keeps the invoice PENDING when the payment only partially settles it', async () => {
    prisma.__tx.invoice.findUnique.mockResolvedValue(
      invoiceRow({ paidCents: 2_000, totalCents: 20_000 }),
    );
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderCode: 'OC-1',
      invoiceId: 'invoice-1',
      amountCents: 5_000,
      status: PaymentOrderState.PENDING,
    });

    await expect(service.handleWebhook({ orderCode: 'OC-1' })).resolves.toEqual(
      { ok: true },
    );

    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-1' },
      data: {
        paidCents: { increment: 5_000 },
        status: PaymentStatus.PENDING,
      },
    });
  });

  it('falls back to the orderCode as pspRef when no transactionId is given', async () => {
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderCode: 'OC-77',
      invoiceId: 'invoice-1',
      amountCents: 8_000,
      status: PaymentOrderState.PENDING,
    });

    await service.handleWebhook({ orderCode: 'OC-77' });

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pspRef: 'OC-77' }),
    });
  });

  it('answers ok:false without PSP calls or writes for unknown orderCodes', async () => {
    prisma.paymentOrder.findUnique.mockResolvedValue(null);

    await expect(
      service.handleWebhook({ orderCode: 'UNKNOWN' }),
    ).resolves.toEqual({ ok: false });
    expect(adapter.getOrderStatus).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
