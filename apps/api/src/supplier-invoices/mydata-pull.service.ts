import { Injectable } from '@nestjs/common';

/**
 * Stub for live myDATA pull — in production this would call AADE myDATA
 * RequestDocs / RequestTransmittedDocs endpoints with the building's
 * myDATA credentials. For offline/tests we return deterministic sample
 * invoices so that pullMyData + dedupe logic can be exercised.
 */

export interface MyDataPullInvoice {
  issuerName: string;
  issuerAfm?: string;
  issueDate: string; // YYYY-MM-DD
  netCents: number;
  vatCents: number;
  totalCents: number;
  currency?: string;
  mydataMark: string;
  classification?: string;
  rawJson?: unknown;
}

@Injectable()
export class MyDataPullService {
  /**
   * Fetches inbound supplier invoices for a building from the external
   * myDATA provider. Stub returns 2–3 sample documents and deduplication
   * is handled by the caller (SupplierInvoicesService) on mydataMark.
   */
  async pullForBuilding(buildingId: string): Promise<MyDataPullInvoice[]> {
    // In live mode we could switch on MYDATA_MODE / credentials.
    // For now always return deterministic stub data derived from buildingId.
    const suffix = buildingId.slice(-4).toUpperCase() || 'ABCD';
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Deterministic marks: MARK-<suffix>-001 etc — stable across calls for dedupe testing.
    return [
      {
        issuerName: 'ΔΕΗ Α.Ε.',
        issuerAfm: '094162110',
        issueDate: yest,
        netCents: 10000,
        vatCents: 2400,
        totalCents: 12400,
        currency: 'EUR',
        mydataMark: `MARK-${suffix}-001`,
        classification: 'category1_1',
        rawJson: {
          source: 'myDATA',
          mark: `MARK-${suffix}-001`,
          issuer: { name: 'ΔΕΗ Α.Ε.', vatNumber: '094162110' },
          invoiceDetails: { netValue: 100.0, vatAmount: 24.0, total: 124.0 },
          issueDate: yest,
        },
      },
      {
        issuerName: 'ΕΥΔΑΠ Α.Ε.',
        issuerAfm: '094079589',
        issueDate: today,
        netCents: 5000,
        vatCents: 1200,
        totalCents: 6200,
        currency: 'EUR',
        mydataMark: `MARK-${suffix}-002`,
        classification: 'category1_2',
        rawJson: {
          source: 'myDATA',
          mark: `MARK-${suffix}-002`,
          issuer: { name: 'ΕΥΔΑΠ Α.Ε.', vatNumber: '094079589' },
          invoiceDetails: { netValue: 50.0, vatAmount: 12.0, total: 62.0 },
          issueDate: today,
        },
      },
    ];
  }

  /**
   * Helper for tests to build a single custom pull entry.
   */
  static fakeInvoice(overrides: Partial<MyDataPullInvoice> & { mydataMark: string }): MyDataPullInvoice {
    return {
      issuerName: 'ΔΕΗ Α.Ε.',
      issuerAfm: '094162110',
      issueDate: new Date().toISOString().slice(0, 10),
      netCents: 10000,
      vatCents: 2400,
      totalCents: 12400,
      currency: 'EUR',
      classification: 'category1_1',
      rawJson: { mark: overrides.mydataMark },
      ...overrides,
    };
  }
}
