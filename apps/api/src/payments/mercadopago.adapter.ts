import { Logger } from '@nestjs/common';

export type MercadoPagoStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED';

export interface MercadoPagoAdapter {
  createCheckout(input: {
    amountCents: number;
    invoiceRef: string;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    buildingName?: string;
  }): Promise<{ checkoutRef: string; checkoutUrl: string }>;
  getPaymentStatus(paymentId: string): Promise<{
    status: MercadoPagoStatus;
    /** external_reference from the preference (our invoice id). */
    externalReference?: string | null;
  }>;
}

export const MERCADOPAGO_ADAPTER = Symbol('MERCADOPAGO_ADAPTER');

interface MercadoPagoPreferenceResponse {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
}

/**
 * Mercado Pago Checkout Pro adapter (P0-2). Covers BR (PIX), MX (SPEI/OXXO),
 * AR/CL/CO/PE via Mercado Pago's hosted checkout. Amounts in cents; the SDK
 * expects decimal amounts, so we convert at the boundary (÷100).
 */
export class RealMercadoPagoAdapter implements MercadoPagoAdapter {
  private readonly logger = new Logger(RealMercadoPagoAdapter.name);

  constructor(
    private readonly accessToken: string,
    private readonly baseUrl = 'https://api.mercadopago.com',
  ) {}

  async createCheckout(input: {
    amountCents: number;
    invoiceRef: string;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    buildingName?: string;
  }): Promise<{ checkoutRef: string; checkoutUrl: string }> {
    const res = await fetch(`${this.baseUrl}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [
          {
            id: input.invoiceRef,
            title: input.buildingName
              ? `PolykatoikiaOS ${input.buildingName}`
              : 'PolykatoikiaOS',
            quantity: 1,
            unit_price: input.amountCents / 100,
            currency_id: input.currency,
          },
        ],
        back_urls: { success: input.successUrl, failure: input.cancelUrl },
        auto_return: 'approved',
        external_reference: input.invoiceRef,
        notification_url: `${process.env.APP_BASE_URL ?? 'http://localhost:4200'}/api/payments/webhook/mercadopago`,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Mercado Pago preference creation failed (${res.status}) for invoice ${input.invoiceRef}`,
      );
    }
    const data = (await res.json()) as MercadoPagoPreferenceResponse;
    if (!data.id || !data.init_point) {
      throw new Error(
        `Mercado Pago returned no preference for invoice ${input.invoiceRef}`,
      );
    }
    this.logger.log(
      `Created Mercado Pago preference ${data.id} for invoice ${input.invoiceRef}`,
    );
    return { checkoutRef: data.id, checkoutUrl: data.init_point };
  }

  async getPaymentStatus(paymentId: string): Promise<{
    status: MercadoPagoStatus;
    externalReference?: string | null;
  }> {
    const res = await fetch(`${this.baseUrl}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(
        `Mercado Pago status check failed (${res.status}) for ${paymentId}`,
      );
    }
    const data = (await res.json().catch(() => null)) as unknown;
    const raw =
      ((data as { status?: unknown } | null)?.status ?? '') as string;
    const externalReference = (
      data as { external_reference?: unknown } | null
    )?.external_reference;
    // MP statuses: approved → COMPLETED; pending/in_process → PENDING;
    // rejected/cancelled → FAILED; expired → EXPIRED.
    let status: MercadoPagoStatus;
    switch (raw.toLowerCase()) {
      case 'approved':
        status = 'COMPLETED';
        break;
      case 'pending':
      case 'in_process':
        status = 'PENDING';
        break;
      case 'expired':
        status = 'EXPIRED';
        break;
      default:
        status = 'FAILED';
    }
    return {
      status,
      externalReference:
        typeof externalReference === 'string' ? externalReference : null,
    };
  }
}

/** Local development adapter when Mercado Pago credentials are missing. */
export class MockMercadoPagoAdapter implements MercadoPagoAdapter {
  async createCheckout(input: {
    amountCents: number;
    invoiceRef: string;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    buildingName?: string;
  }): Promise<{ checkoutRef: string; checkoutUrl: string }> {
    const checkoutRef = `MP-MOCK-${input.invoiceRef}-${Date.now()}`;
    const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:4200';
    return {
      checkoutRef,
      checkoutUrl: `${appBaseUrl}/balance?mockOrder=${checkoutRef}`,
    };
  }

  async getPaymentStatus(
    _paymentId: string,
  ): Promise<{
    status: MercadoPagoStatus;
    externalReference?: string | null;
  }> {
    return { status: 'COMPLETED' };
  }
}

export function createMercadoPagoAdapter(): MercadoPagoAdapter {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (accessToken) {
    return new RealMercadoPagoAdapter(accessToken);
  }
  return new MockMercadoPagoAdapter();
}