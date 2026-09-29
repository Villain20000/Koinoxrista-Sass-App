import { Logger } from '@nestjs/common';

/**
 * Market-aware Stripe adapter (P0-2, docs/INTERNATIONAL_PLAN §4). Serves
 * US/CA/MX/BRL/EU card + bank rails via Stripe Checkout sessions, taking the
 * building's currency + locale per checkout. Selected per building via
 * `Building.pspProvider = 'stripe'`; default remains Viva.
 */
export interface StripeAdapter {
  createCheckout(input: {
    amountCents: number;
    invoiceRef: string;
    currency: string;
    locale?: string;
    successUrl: string;
    cancelUrl: string;
    buildingName?: string;
  }): Promise<{ checkoutUrl: string; paymentIntentRef: string }>;
  verifyWebhook(
    payload: string,
    signatureHeader: string,
  ): Promise<StripeWebhookClaim | null>;
}

export interface StripeWebhookClaim {
  object: string;
  paymentIntent: { id: string } | null;
  invoiceRef?: string;
}

export const STRIPE_ADAPTER = Symbol('STRIPE_ADAPTER');

/** Minimal structural shape of the Stripe client we depend on. */
export interface StripeLike {
  checkout: {
    sessions: {
      create(input: {
        mode: string;
        line_items: unknown[];
        success_url: string;
        cancel_url: string;
        metadata: Record<string, string>;
      }): Promise<{ url: string | null; id: string }>;
    };
  };
  webhooks: {
    constructEvent(
      payload: string,
      signatureHeader: string,
      secret: string,
    ): { object: string; data?: { object?: unknown } };
  };
}

/** Real adapter backed by the stripe SDK (imported lazily to keep typing loose). */
export class RealStripeAdapter implements StripeAdapter {
  private readonly logger = new Logger(RealStripeAdapter.name);
  private readonly stripe: StripeLike;

  constructor(secretKey: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe') as new (
      secret: string,
      options?: { apiVersion?: string },
    ) => StripeLike;
    this.stripe = new Stripe(secretKey, { apiVersion: '2024-11-20.acacia' });
  }

  async createCheckout(input: {
    amountCents: number;
    invoiceRef: string;
    currency: string;
    locale?: string;
    successUrl: string;
    cancelUrl: string;
    buildingName?: string;
  }): Promise<{ checkoutUrl: string; paymentIntentRef: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            // Stripe amounts are in the currency's minor unit. For zero-decimal
            // currencies (JPY/CLP/…) the minor unit IS the whole unit — reuse
            // the same convention as the JP adapter: pass cents through and let
            // the caller scale for zero-decimal currencies at the PSP boundary.
            unit_amount: input.amountCents,
            product_data: {
              name: input.buildingName
                ? `PolykatoikiaOS ${input.buildingName}`
                : 'PolykatoikiaOS',
              description: `Invoice ${input.invoiceRef}`,
            },
          },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { invoiceRef: input.invoiceRef },
    });
    if (!session.url) {
      throw new Error('Stripe returned no checkout URL');
    }
    this.logger.log(
      `Created Stripe checkout ${session.id} for invoice ${input.invoiceRef}`,
    );
    return { checkoutUrl: session.url, paymentIntentRef: session.id };
  }

  async verifyWebhook(
    payload: string,
    signatureHeader: string,
  ): Promise<StripeWebhookClaim | null> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      // No webhook secret → only allow unsigned in non-production.
      if (process.env.NODE_ENV === 'production') return null;
      return this.parseUnsigned(payload);
    }
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signatureHeader,
        secret,
      );
      return {
        object: event.object,
        paymentIntent: this.idOf(event.data?.object),
        invoiceRef: this.invoiceRefOf(event.data?.object),
      };
    } catch {
      return null;
    }
  }

  private idOf(obj: unknown): { id: string } | null {
    if (obj && typeof obj === 'object' && 'id' in obj) {
      const id = (obj as { id: unknown }).id;
      if (typeof id === 'string') return { id };
    }
    return null;
  }

  private invoiceRefOf(obj: unknown): string | undefined {
    if (
      obj &&
      typeof obj === 'object' &&
      'metadata' in obj &&
      (obj as { metadata?: unknown }).metadata &&
      typeof (obj as { metadata: unknown }).metadata === 'object'
    ) {
      const metadata = (obj as { metadata?: Record<string, unknown> }).metadata;
      if (typeof metadata?.invoiceRef === 'string') {
        return metadata.invoiceRef;
      }
    }
    return undefined;
  }

  private parseUnsigned(payload: string): StripeWebhookClaim | null {
    try {
      const parsed = JSON.parse(payload) as {
        type?: string;
        data?: { object?: unknown };
      };
      return {
        object: parsed.type ?? 'checkout.session.completed',
        paymentIntent: this.idOf(parsed.data?.object),
        invoiceRef: this.invoiceRefOf(parsed.data?.object),
      };
    } catch {
      return null;
    }
  }
}

/** Factory used by the DI container. Requires STRIPE_SECRET_KEY when called. */
export function createStripeAdapter(): StripeAdapter {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is required when Building.pspProvider = "stripe"',
    );
  }
  return new RealStripeAdapter(secretKey);
}