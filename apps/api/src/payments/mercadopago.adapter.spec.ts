import {
  MockMercadoPagoAdapter,
  RealMercadoPagoAdapter,
} from './mercadopago.adapter';

describe('RealMercadoPagoAdapter (P0-2 BR/MX/AR/CL/CO/PE)', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('creates a Checkout Pro preference with cents→decimal conversion', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'pref-123',
        init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-123',
      }),
    });

    const adapter = new RealMercadoPagoAdapter('TEST-TOKEN', 'https://api.mercadopago.com');
    const result = await adapter.createCheckout({
      amountCents: 12_345,
      invoiceRef: 'invoice-1',
      currency: 'BRL',
      successUrl: 'https://app/balance?stripe=success',
      cancelUrl: 'https://app/balance?stripe=cancelled',
      buildingName: 'Condomínio Verde',
    });

    expect(result.checkoutRef).toBe('pref-123');
    expect(result.checkoutUrl).toContain('pref-123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
    expect(init.headers.Authorization).toBe('Bearer TEST-TOKEN');
    const body = JSON.parse(init.body);
    expect(body.items[0].unit_price).toBe(123.45);
    expect(body.items[0].currency_id).toBe('BRL');
    expect(body.external_reference).toBe('invoice-1');
  });

  it('maps MP statuses to our enum', async () => {
    const adapter = new RealMercadoPagoAdapter('TEST-TOKEN');
    const cases: Array<[string, string]> = [
      ['approved', 'COMPLETED'],
      ['pending', 'PENDING'],
      ['in_process', 'PENDING'],
      ['rejected', 'FAILED'],
      ['expired', 'EXPIRED'],
    ];
    for (const [mp, expected] of cases) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: mp,
          external_reference: 'invoice-9',
        }),
      });
      const result = await adapter.getPaymentStatus('pay-1');
      expect(result.status).toBe(expected);
      expect(result.externalReference).toBe('invoice-9');
    }
  });

  it('throws when the preference creation fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });

    const adapter = new RealMercadoPagoAdapter('TEST-TOKEN');
    await expect(
      adapter.createCheckout({
        amountCents: 100,
        invoiceRef: 'invoice-1',
        currency: 'BRL',
        successUrl: 'https://app/balance',
        cancelUrl: 'https://app/balance',
      }),
    ).rejects.toThrow('Mercado Pago preference creation failed (400)');
  });
});

describe('MockMercadoPagoAdapter', () => {
  it('returns a sandbox checkout URL and COMPLETED status', async () => {
    const adapter = new MockMercadoPagoAdapter();
    const result = await adapter.createCheckout({
      amountCents: 8_000,
      invoiceRef: 'invoice-1',
      currency: 'BRL',
      successUrl: 'https://app/balance',
      cancelUrl: 'https://app/balance',
    });
    expect(result.checkoutRef).toContain('MP-MOCK');
    expect(result.checkoutUrl).toContain('mockOrder=');
    await expect(adapter.getPaymentStatus('any')).resolves.toEqual({
      status: 'COMPLETED',
    });
  });
});