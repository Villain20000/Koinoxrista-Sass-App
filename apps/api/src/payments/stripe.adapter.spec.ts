import { RealStripeAdapter, StripeLike } from './stripe.adapter';

function makeStripe(): StripeLike {
  return {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          url: 'https://checkout.stripe.com/c/pay/cs_test_123',
          id: 'cs_test_123',
        }),
      },
    },
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        object: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            metadata: { invoiceRef: 'invoice-1' },
          },
        },
      }),
    },
  } as unknown as StripeLike;
}

describe('RealStripeAdapter (P0-2 market-aware)', () => {
  it('creates a checkout in the building currency', async () => {
    const stripe = makeStripe();
    const adapter = new RealStripeAdapter('sk_test_xyz');
    (adapter as unknown as { stripe: StripeLike }).stripe = stripe;

    const result = await adapter.createCheckout({
      amountCents: 12_345,
      invoiceRef: 'invoice-1',
      currency: 'USD',
      successUrl: 'https://app/balance?stripe=success',
      cancelUrl: 'https://app/balance?stripe=cancelled',
      buildingName: 'Maple Condos',
    });

    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
    expect(result.paymentIntentRef).toBe('cs_test_123');
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              currency: 'usd',
              unit_amount: 12_345,
              product_data: expect.objectContaining({
                name: 'PolykatoikiaOS Maple Condos',
              }),
            }),
          }),
        ],
        metadata: { invoiceRef: 'invoice-1' },
      }),
    );
  });

  it('keeps EUR default behavior and non-JP descriptions', async () => {
    const stripe = makeStripe();
    const adapter = new RealStripeAdapter('sk_test_xyz');
    (adapter as unknown as { stripe: StripeLike }).stripe = stripe;

    await adapter.createCheckout({
      amountCents: 8_000,
      invoiceRef: 'invoice-1',
      currency: 'EUR',
      successUrl: 'https://app/balance?stripe=success',
      cancelUrl: 'https://app/balance?stripe=cancelled',
    });

    const call = (stripe.checkout.sessions.create as jest.Mock).mock.calls[0][0];
    expect(call.line_items[0].price_data.currency).toBe('eur');
    expect(call.line_items[0].price_data.product_data.description).toBe(
      'Invoice invoice-1',
    );
  });

  it('verifies a signed webhook and extracts the invoice ref', async () => {
    const stripe = makeStripe();
    const adapter = new RealStripeAdapter('sk_test_xyz');
    (adapter as unknown as { stripe: StripeLike }).stripe = stripe;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    const claim = await adapter.verifyWebhook('payload', 'signature');

    expect(claim).toEqual({
      object: 'checkout.session.completed',
      // data.object.id is the checkout session id, exposed as the ref we use
      // for the orderCode lookup (same convention as the JP adapter).
      paymentIntent: { id: 'cs_test_123' },
      invoiceRef: 'invoice-1',
    });
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      'payload',
      'signature',
      'whsec_test',
    );
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('rejects signed webhooks in production when the secret is missing', async () => {
    const stripe = makeStripe();
    const adapter = new RealStripeAdapter('sk_test_xyz');
    (adapter as unknown as { stripe: StripeLike }).stripe = stripe;
    const previous = process.env.NODE_ENV;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';

    await expect(
      adapter.verifyWebhook('payload', 'signature'),
    ).resolves.toBeNull();
    process.env.NODE_ENV = previous ?? '';
  });
});