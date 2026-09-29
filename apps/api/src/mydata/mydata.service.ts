import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MyDataStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

import { requireValidPeriod } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import {
  MYDATA_PROVIDER,
  MyDataProvider,
  MyDataPollResult,
} from './mydata.adapter';
import { SubmissionError } from './mydata.live';
import { buildMyDataXml, MyDataXmlRecord } from './mydata.xml';

// Greek VAT 24%; all math stays in integer cents.
const VAT_RATE = 1.24;

/** Splits a gross paid amount into net + VAT without losing a single cent. */
export function computeNetVat(paidCents: number): {
  netAmountCents: number;
  vatAmountCents: number;
} {
  const netAmountCents = Math.round(paidCents / VAT_RATE);
  return { netAmountCents, vatAmountCents: paidCents - netAmountCents };
}

/** Invoice series; configurable later. */
const SERIES = 'A';
// AADE invoice-type code 2.1 (service provision); configurable later.
const INVOICE_TYPE = '2.1';
// AADE income classification for service income; configurable later.
const CLASSIFICATION_CATEGORY = 'category1_1';
const CLASSIFICATION_TYPE = 'E3_561_001';
// myDATA payment-method codes: '3' = card/POS, '9' = IRIS transfer.
// Partial by design: GR only ever writes CARD | IRIS; international rails
// (PIX/ACH/SPEI/SEPA_DD/INTERAC) are not myDATA-classified → default '3'.
const PAYMENT_METHOD_CODES: Partial<Record<PaymentMethod, string>> = {
  [PaymentMethod.CARD]: '3',
  [PaymentMethod.IRIS]: '9',
};

function myDataPaymentCode(method: PaymentMethod): string {
  return PAYMENT_METHOD_CODES[method] ?? '3';
}

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/** Synthetic MARK for rows AADE never registered (mark column is required). */
const REJECTED_MARK_PREFIX = 'REJ-';

function rejectedMark(invoiceId: string): string {
  return (
    REJECTED_MARK_PREFIX +
    createHash('sha1')
      .update(invoiceId)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase()
  );
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

export interface MyDataFile {
  body: string;
  contentType: string;
  filename: string;
}

@Injectable()
export class MyDataService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MYDATA_PROVIDER) private readonly provider: MyDataProvider,
  ) {}

  async generateForPeriod(
    buildingId: string,
    periodYearMonth: string,
  ): Promise<{ created: number; skipped: number }> {
    const period = requireValidPeriod(periodYearMonth);

    const paid = await this.prisma.invoice.findMany({
      where: {
        buildingId,
        periodYearMonth: period,
        status: PaymentStatus.PAID,
      },
      select: {
        id: true,
        paidCents: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          select: { method: true },
        },
        myData: { select: { id: true } },
      },
      orderBy: { unitId: 'asc' },
    });
    const pending = paid.filter((invoice) => !invoice.myData);

    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      let seqNo = await tx.myDataInvoice.count({ where: { buildingId } });
      for (const invoice of pending) {
        let attempts = 0;
        for (;;) {
          seqNo += 1;
          try {
            const recorded = await this.submitOne(
              tx,
              buildingId,
              invoice,
              seqNo,
            );
            if (recorded === MyDataStatus.SUBMITTED) {
              created += 1;
            }
            break;
          } catch (error) {
            attempts += 1;
            if (attempts > 1 || !isUniqueConflict(error)) {
              throw error;
            }
            // A concurrent run won the unique race — resync and retry once.
            seqNo = await tx.myDataInvoice.count({ where: { buildingId } });
          }
        }
      }
    });

    return { created, skipped: paid.length - pending.length };
  }

  async listForPeriod(buildingId: string, periodYearMonth: string | undefined) {
    const period =
      periodYearMonth !== undefined
        ? requireValidPeriod(periodYearMonth)
        : undefined;

    return this.prisma.myDataInvoice.findMany({
      where: {
        buildingId,
        ...(period ? { invoice: { periodYearMonth: period } } : {}),
      },
      include: {
        invoice: {
          select: { unit: { select: { label: true } }, periodYearMonth: true },
        },
      },
      orderBy: { seqNo: 'desc' },
    });
  }

  async xmlForPeriod(
    buildingId: string,
    periodYearMonth: string | undefined,
  ): Promise<MyDataFile> {
    const records = await this.listForPeriod(buildingId, periodYearMonth);
    const xmlRecords = records.map<MyDataXmlRecord>((record) => ({
      mark: record.mark,
      series: record.series,
      seqNo: record.seqNo,
      issueDate: record.issueDate,
      paymentMethodCode: record.paymentMethodCode,
      classificationCategory: record.classificationCategory,
      classificationType: record.classificationType,
      netAmountCents: record.netAmountCents,
      vatAmountCents: record.vatAmountCents,
    }));
    const suffix = periodYearMonth
      ? `-${requireValidPeriod(periodYearMonth)}`
      : '-all';
    return {
      body: buildMyDataXml(xmlRecords),
      contentType: 'text/xml;charset=utf-8',
      filename: `mydata${suffix}.xml`,
    };
  }

  /**
   * Re-queries AADE for records still marked SUBMITTED and settles them to
   * ACCEPTED/REJECTED from the RequestDocs response. Providers without a
   * pollStatus (offline) reconcile nothing.
   */
  async reconcile(
    buildingId: string,
    periodYearMonth: string,
  ): Promise<{ checked: number; accepted: number; rejected: number }> {
    const period = requireValidPeriod(periodYearMonth);
    if (!this.provider.pollStatus) {
      return { checked: 0, accepted: 0, rejected: 0 };
    }

    const records = await this.prisma.myDataInvoice.findMany({
      where: {
        buildingId,
        status: MyDataStatus.SUBMITTED,
        invoice: { periodYearMonth: period },
        responseRaw: { contains: '<uid>' },
      },
      select: { id: true, mark: true },
      orderBy: { seqNo: 'asc' },
    });

    let accepted = 0;
    let rejected = 0;
    for (const record of records) {
      let result: MyDataPollResult;
      try {
        result = await this.provider.pollStatus(record.mark);
      } catch (error) {
        // Exhausted retries — leave the record for the next reconciliation run.
        if (!(error instanceof SubmissionError)) {
          throw error;
        }
        continue;
      }
      if (result.state === 'PENDING') {
        continue;
      }
      await this.prisma.myDataInvoice.update({
        where: { id: record.id },
        data: {
          status:
            result.state === 'ACCEPTED'
              ? MyDataStatus.ACCEPTED
              : MyDataStatus.REJECTED,
          responseRaw: result.raw,
        },
      });
      if (result.state === 'ACCEPTED') {
        accepted += 1;
      } else {
        rejected += 1;
      }
    }

    return { checked: records.length, accepted, rejected };
  }

  private async submitOne(
    tx: Tx,
    buildingId: string,
    invoice: {
      id: string;
      paidCents: number;
      payments: { method: PaymentMethod }[];
    },
    seqNo: number,
  ): Promise<'SUBMITTED' | 'REJECTED'> {
    const method = invoice.payments[0]?.method ?? PaymentMethod.CARD;
    const { netAmountCents, vatAmountCents } = computeNetVat(invoice.paidCents);
    const now = new Date();
    const input = {
      invoiceId: invoice.id,
      series: SERIES,
      seqNo,
      issueDate: now.toISOString().slice(0, 10),
      invoiceType: INVOICE_TYPE,
      paymentMethodCode: myDataPaymentCode(method),
      netAmountCents,
      vatAmountCents,
      classificationCategory: CLASSIFICATION_CATEGORY,
      classificationType: CLASSIFICATION_TYPE,
    };

    let mark: string;
    let raw: string;
    let status: 'SUBMITTED' | 'REJECTED';
    try {
      const result = await this.provider.submit(input);
      mark = result.mark;
      raw = result.raw;
      status = MyDataStatus.SUBMITTED;
    } catch (error) {
      // AADE said no — persist the rejection without failing the whole run.
      if (!(error instanceof SubmissionError)) {
        throw error;
      }
      mark = rejectedMark(input.invoiceId);
      raw = error.message;
      status = MyDataStatus.REJECTED;
    }

    await tx.myDataInvoice.create({
      data: {
        invoiceId: input.invoiceId,
        buildingId,
        mark,
        series: SERIES,
        seqNo,
        issueDate: now,
        paymentMethodCode: input.paymentMethodCode,
        classificationCategory: CLASSIFICATION_CATEGORY,
        classificationType: CLASSIFICATION_TYPE,
        netAmountCents,
        vatAmountCents,
        status,
        responseRaw: raw,
      },
    });
    return status;
  }
}
