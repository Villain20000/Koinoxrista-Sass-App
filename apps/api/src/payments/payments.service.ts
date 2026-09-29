import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentOrderState,
  PaymentStatus,
} from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  VIVA_ADAPTER,
  VivaAdapter,
} from './viva.adapter';
import {
  STRIPE_JP_ADAPTER,
  StripeJpAdapter,
} from './stripejp.adapter';
import {
  STRIPE_ADAPTER,
  StripeAdapter,
} from './stripe.adapter';
import {
  MERCADOPAGO_ADAPTER,
  MercadoPagoAdapter,
} from './mercadopago.adapter';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(VIVA_ADAPTER) private readonly viva: VivaAdapter,
    @Optional() @Inject(STRIPE_JP_ADAPTER)
    private readonly stripeJp?: StripeJpAdapter,
    @Optional() @Inject(STRIPE_ADAPTER)
    private readonly stripe?: StripeAdapter,
    @Optional() @Inject(MERCADOPAGO_ADAPTER)
    private readonly mercadopago?: MercadoPagoAdapter,
  ) {}

  async startCheckout(invoiceId: string, user: AuthenticatedUser) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        unit: {
          include: {
            building: {
              select: {
                pspProvider: true,
                name: true,
                currency: true,
              },
            },
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    await this.assertAccess(invoice.buildingId, invoice.unitId, user);

    const outstandingCents = invoice.totalCents - invoice.paidCents;
    if (invoice.status === PaymentStatus.PAID || outstandingCents <= 0) {
      throw new BadRequestException('Invoice is already paid');
    }

    const provider = invoice.unit.building.pspProvider ?? 'viva';
    const currency = invoice.unit.building.currency ?? 'EUR';
    const appUrl = process.env.APP_BASE_URL ?? 'http://localhost:4200';

    let orderCode: string;
    let checkoutUrl: string;
    if (provider === 'stripe' && this.stripe) {
      const checkout = await this.stripe.createCheckout({
        amountCents: outstandingCents,
        invoiceRef: invoice.id,
        currency,
        successUrl: `${appUrl}/balance?stripe=success`,
        cancelUrl: `${appUrl}/balance?stripe=cancelled`,
        buildingName: invoice.unit.building.name,
      });
      orderCode = checkout.paymentIntentRef;
      checkoutUrl = checkout.checkoutUrl;
    } else if (provider === 'mercadopago' && this.mercadopago) {
      const checkout = await this.mercadopago.createCheckout({
        amountCents: outstandingCents,
        invoiceRef: invoice.id,
        currency,
        successUrl: `${appUrl}/balance?stripe=success`,
        cancelUrl: `${appUrl}/balance?stripe=cancelled`,
        buildingName: invoice.unit.building.name,
      });
      orderCode = checkout.checkoutRef;
      checkoutUrl = checkout.checkoutUrl;
    } else if (provider === 'stripejp' && this.stripeJp) {
      const checkout = await this.stripeJp.createCheckout({
        amountCents: outstandingCents,
        invoiceRef: invoice.id,
        successUrl: `${appUrl}/balance?stripe=success`,
        cancelUrl: `${appUrl}/balance?stripe=cancelled`,
        buildingName: invoice.unit.building.name,
      });
      orderCode = checkout.paymentIntentRef;
      checkoutUrl = checkout.checkoutUrl;
    } else if (provider === 'gmo') {
      // GMO Payment Gateway integration is a follow-up; fall back to Viva for now.
      const viva = await this.viva.createOrder(outstandingCents, invoice.id);
      orderCode = viva.orderCode;
      checkoutUrl = viva.checkoutUrl;
    } else {
      const viva = await this.viva.createOrder(outstandingCents, invoice.id);
      orderCode = viva.orderCode;
      checkoutUrl = viva.checkoutUrl;
    }

    const order = await this.prisma.paymentOrder.create({
      data: {
        invoiceId: invoice.id,
        orderCode,
        amountCents: outstandingCents,
        status: PaymentOrderState.PENDING,
        checkoutUrl,
      },
    });
    this.audit.record({
      buildingId: invoice.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'payment.checkout',
      entity: 'paymentOrder',
      entityId: order.id,
      metadata: { invoiceId: invoice.id, amountCents: outstandingCents, provider },
    });
    return { order, provider };
  }

  async getOrder(orderId: string, user: AuthenticatedUser) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
      include: {
        invoice: { select: { buildingId: true, unitId: true } },
      },
    });
    if (!order) {
      throw new NotFoundException('Payment order not found');
    }
    await this.assertAccess(
      order.invoice.buildingId,
      order.invoice.unitId,
      user,
    );
    return order;
  }

  async getInvoiceDetail(invoiceId: string, user: AuthenticatedUser) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true, orders: true, unit: { select: { label: true } } },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    await this.assertAccess(invoice.buildingId, invoice.unitId, user);
    return invoice;
  }

  /** Public PSP webhook. Server-side status is verified before any write. */
  async handleWebhook(body: { orderCode: string; transactionId?: string }) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderCode: body.orderCode },
    });
    if (!order) {
      return { ok: false };
    }
    if (order.status === PaymentOrderState.COMPLETED) {
      return { ok: true };
    }

    const pspStatus = await this.viva.getOrderStatus(order.orderCode);
    if (pspStatus !== PaymentOrderState.COMPLETED) {
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentOrderState.FAILED },
      });
      return { ok: false };
    }

    await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: order.invoiceId },
      });
      if (!invoice) {
        return;
      }
      const paidCents = invoice.paidCents + order.amountCents;
      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          method: PaymentMethod.CARD,
          pspRef: body.transactionId ?? order.orderCode,
          amountCents: order.amountCents,
          status: PaymentStatus.PAID,
        },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidCents: { increment: order.amountCents },
          status:
            paidCents >= invoice.totalCents
              ? PaymentStatus.PAID
              : PaymentStatus.PENDING,
        },
      });
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentOrderState.COMPLETED },
      });
      this.audit.record({
        buildingId: invoice.buildingId,
        action: 'payment.webhook',
        entity: 'paymentOrder',
        entityId: order.id,
        metadata: {
          orderCode: order.orderCode,
          amountCents: order.amountCents,
          pspRef: body.transactionId ?? null,
        },
      });
    });
    return { ok: true };
  }

  /**
   * Stripe webhook handler: signature already validated by the adapter. Finds
   * the pending PaymentOrder by its stored checkout-session/ref (orderCode)
   * and settles the invoice with the same transition as the Viva path.
   */
  async handleStripeWebhook(body: {
    object?: string;
    paymentIntent?: { id?: string } | null;
    invoiceRef?: string;
  }): Promise<{ ok: boolean }> {
    const orderCode =
      body.invoiceRef ?? // not used for lookup; kept for clarity
      undefined;
    void orderCode;
    const ref = body.paymentIntent?.id ?? body.invoiceRef;
    if (!ref) {
      return { ok: false };
    }
    const order = await this.prisma.paymentOrder.findFirst({
      where: { orderCode: ref },
    });
    if (!order) {
      return { ok: false };
    }
    if (order.status === PaymentOrderState.COMPLETED) {
      return { ok: true };
    }

    await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: order.invoiceId },
      });
      if (!invoice) return;
      const paidCents = invoice.paidCents + order.amountCents;
      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          method: PaymentMethod.CARD,
          pspRef: body.paymentIntent?.id ?? ref,
          amountCents: order.amountCents,
          status: PaymentStatus.PAID,
        },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidCents: { increment: order.amountCents },
          status:
            paidCents >= invoice.totalCents
              ? PaymentStatus.PAID
              : PaymentStatus.PENDING,
        },
      });
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentOrderState.COMPLETED },
      });
      this.audit.record({
        buildingId: invoice.buildingId,
        action: 'payment.webhook.stripe',
        entity: 'paymentOrder',
        entityId: order.id,
        metadata: { ref, amountCents: order.amountCents },
      });
    });
    return { ok: true };
  }

  /**
   * Mercado Pago webhook handler: looks up the pending PaymentOrder by its
   * stored checkout ref and verifies the payment server-side before settling,
   * with the same idempotent transition as the Viva/Stripe paths.
   */
  async handleMercadoPagoWebhook(body: {
    type?: string;
    data?: { id?: string } | null;
  }): Promise<{ ok: boolean }> {
    if (body.type !== 'payment' && body.type !== 'merchant_order') {
      return { ok: false };
    }
    const paymentId = body.data?.id;
    if (!paymentId) {
      return { ok: false };
    }
    if (!this.mercadopago) {
      return { ok: false };
    }

    const pspStatus = await this.mercadopago.getPaymentStatus(paymentId);
    if (pspStatus.status !== 'COMPLETED') {
      return { ok: false };
    }

    // MP payment ids differ from our stored preference refs; resolve the
    // PaymentOrder through the external_reference (= invoice id) that the
    // preference carried, falling back to a direct orderCode match (e.g. the
    // mock adapter which stores its ref as the orderCode).
    const invoiceRef = pspStatus.externalReference;
    const order = invoiceRef
      ? await this.prisma.paymentOrder.findFirst({
          where: { invoiceId: invoiceRef },
          orderBy: { createdAt: 'desc' },
        })
      : await this.prisma.paymentOrder.findUnique({
          where: { orderCode: paymentId },
        });
    if (!order) {
      return { ok: false };
    }
    if (order.status === PaymentOrderState.COMPLETED) {
      return { ok: true };
    }

    await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: order.invoiceId },
      });
      if (!invoice) return;
      const paidCents = invoice.paidCents + order.amountCents;
      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          method: PaymentMethod.PIX,
          pspRef: paymentId,
          amountCents: order.amountCents,
          status: PaymentStatus.PAID,
        },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidCents: { increment: order.amountCents },
          status:
            paidCents >= invoice.totalCents
              ? PaymentStatus.PAID
              : PaymentStatus.PENDING,
        },
      });
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentOrderState.COMPLETED },
      });
      this.audit.record({
        buildingId: invoice.buildingId,
        action: 'payment.webhook.mercadopago',
        entity: 'paymentOrder',
        entityId: order.id,
        metadata: { paymentId, amountCents: order.amountCents },
      });
    });
    return { ok: true };
  }

  private async assertAccess(
    buildingId: string,
    unitId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    assertSameBuilding(user, buildingId);
    if (user.role === 'ADMIN' || user.role === 'BUILDING_OWNER') {
      return;
    }
    const ownership = await this.prisma.ownership.findFirst({
      where: { userId: user.id, unitId },
    });
    if (!ownership) {
      throw new ForbiddenException('You do not own this unit');
    }
  }
}
