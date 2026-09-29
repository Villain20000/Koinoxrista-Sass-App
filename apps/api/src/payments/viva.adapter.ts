import { Logger } from '@nestjs/common';

export type VivaOrderStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export interface VivaAdapter {
  createOrder(
    amountCents: number,
    invoiceRef: string,
  ): Promise<{ orderCode: string; checkoutUrl: string }>;
  getOrderStatus(orderCode: string): Promise<VivaOrderStatus>;
}

export const VIVA_ADAPTER = Symbol('VIVA_ADAPTER');

const STATUSES: readonly VivaOrderStatus[] = [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
];

interface VivaOrderResponse {
  orderCode?: number | string;
}

/** Viva Wallet Smart Checkout adapter (amounts already in cents). */
export class RealVivaAdapter implements VivaAdapter {
  private readonly logger = new Logger(RealVivaAdapter.name);

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
  }

  async createOrder(
    amountCents: number,
    invoiceRef: string,
  ): Promise<{ orderCode: string; checkoutUrl: string }> {
    const res = await fetch(`${this.baseUrl}/api/checkout/v1/orders`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amountCents }),
    });
    if (!res.ok) {
      throw new Error(
        `Viva order creation failed (${res.status}) for invoice ${invoiceRef}`,
      );
    }
    const data = (await res.json()) as VivaOrderResponse;
    if (!data.orderCode) {
      throw new Error(`Viva returned no orderCode for invoice ${invoiceRef}`);
    }
    const orderCode = String(data.orderCode);
    this.logger.log(`Created Viva order ${orderCode} for invoice ${invoiceRef}`);
    return {
      orderCode,
      checkoutUrl: `${this.baseUrl}/web/checkout?ref=${orderCode}`,
    };
  }

  async getOrderStatus(orderCode: string): Promise<VivaOrderStatus> {
    const res = await fetch(
      `${this.baseUrl}/api/checkout/v1/orders/${orderCode}`,
      { headers: { Authorization: this.authHeader() } },
    );
    if (!res.ok) {
      throw new Error(`Viva status check failed (${res.status}) for ${orderCode}`);
    }
    const data = (await res.json().catch(() => null)) as unknown;
    const raw =
      typeof data === 'string'
        ? data
        : ((data as { status?: unknown } | null)?.status ?? '');
    const normalized = String(raw).toUpperCase();
    return STATUSES.find((status) => status === normalized) ?? 'PENDING';
  }
}

/** Local development adapter when PSP credentials are not configured. */
export class MockVivaAdapter implements VivaAdapter {
  async createOrder(
    _amountCents: number,
    invoiceRef: string,
  ): Promise<{ orderCode: string; checkoutUrl: string }> {
    const orderCode = `MOCK-${invoiceRef}-${Date.now()}`;
    const appBaseUrl =
      process.env.APP_BASE_URL ?? 'http://localhost:4200';
    return {
      orderCode,
      checkoutUrl: `${appBaseUrl}/balance?mockOrder=${orderCode}`,
    };
  }

  async getOrderStatus(): Promise<VivaOrderStatus> {
    return 'COMPLETED';
  }
}

export function createVivaAdapter(): VivaAdapter {
  const clientId = process.env.PSP_VIVA_CLIENT_ID;
  const clientSecret = process.env.PSP_VIVA_CLIENT_SECRET;
  if (clientId && clientSecret) {
    const baseUrl =
      process.env.PSP_VIVA_BASE_URL ?? 'https://demo.vivapayments.com';
    return new RealVivaAdapter(baseUrl, clientId, clientSecret);
  }
  return new MockVivaAdapter();
}
