import { BadRequestException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import {
  createMyDataProvider,
  MyDataProvider,
  MyDataSubmitResult,
  OfflineMyDataProvider,
} from './mydata.adapter';
import { LiveAadeMyDataProvider, SubmissionError } from './mydata.live';
import { computeNetVat, MyDataService } from './mydata.service';
import { buildMyDataXml } from './mydata.xml';

const sha1Mark = (invoiceId: string): string =>
  `4000${createHash('sha1').update(invoiceId).digest('hex').slice(0, 12).toUpperCase()}`;

const paidInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'invoice-1',
  paidCents: 12_400,
  payments: [{ method: PaymentMethod.CARD }],
  myData: null,
  ...overrides,
});

function makePrisma() {
  const tx = {
    myDataInvoice: {
      count: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: `mydata-${data.invoiceId}`, ...data }),
        ),
    },
  };
  return {
    tx,
    invoice: {
      findMany: jest.fn().mockResolvedValue([paidInvoice()]),
    },
    myDataInvoice: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
}

describe('computeNetVat', () => {
  it.each([
    [0, 0, 0],
    [100, 81, 19],
    [124, 100, 24],
    [1_240, 1_000, 240],
    [12_400, 10_000, 2_400],
    [9_999, 8_064, 1_935],
    [123_456, 99_561, 23_895],
  ])('splits %i cents into net %i + vat %i exactly', (paid, net, vat) => {
    expect(computeNetVat(paid)).toEqual({
      netAmountCents: net,
      vatAmountCents: vat,
    });
  });

  it('never loses a cent for arbitrary amounts', () => {
    for (let paid = 0; paid <= 500; paid += 7) {
      const { netAmountCents, vatAmountCents } = computeNetVat(paid);
      expect(netAmountCents + vatAmountCents).toBe(paid);
      expect(netAmountCents).toBeGreaterThanOrEqual(0);
      expect(vatAmountCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('MyDataService.generateForPeriod', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: MyDataService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new MyDataService(
      prisma as unknown as PrismaService,
      new OfflineMyDataProvider(),
    );
  });

  it('creates SUBMITTED records with deterministic MARKs and running seqNo', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      paidInvoice({ id: 'invoice-a', paidCents: 12_400 }),
      paidInvoice({
        id: 'invoice-b',
        paidCents: 9_999,
        payments: [{ method: PaymentMethod.IRIS }],
      }),
    ]);
    prisma.tx.myDataInvoice.count.mockResolvedValue(5);

    await expect(
      service.generateForPeriod('building-1', '2026-07'),
    ).resolves.toEqual({ created: 2, skipped: 0 });

    const creates = prisma.tx.myDataInvoice.create.mock.calls.map(
      ([call]) => call.data,
    );
    expect(creates).toHaveLength(2);
    expect(creates[0].seqNo).toBe(6);
    expect(creates[1].seqNo).toBe(7);
    expect(creates[0].mark).toMatch(/^4000[0-9A-F]{12}$/);
    expect(creates[0].mark).toBe(sha1Mark('invoice-a'));
    expect(creates[1].mark).toBe(sha1Mark('invoice-b'));
    expect(creates.every((data) => data.status === 'SUBMITTED')).toBe(true);
    expect(creates[0].netAmountCents).toBe(10_000);
    expect(creates[0].vatAmountCents).toBe(2_400);
    expect(creates[1].paymentMethodCode).toBe('9');
    expect(JSON.parse(creates[0].responseRaw)).toEqual(
      expect.objectContaining({ invoiceId: 'invoice-a', seqNo: 6 }),
    );
  });

  it('is idempotent — already exported invoices are skipped, nothing created', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      paidInvoice({ id: 'invoice-a', myData: { id: 'mydata-1' } }),
      paidInvoice({ id: 'invoice-b', myData: { id: 'mydata-2' } }),
    ]);

    await expect(
      service.generateForPeriod('building-1', '2026-07'),
    ).resolves.toEqual({ created: 0, skipped: 2 });
    expect(prisma.tx.myDataInvoice.create).not.toHaveBeenCalled();
  });

  it('retries once after a unique conflict, then resyncs seqNo', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      paidInvoice({ id: 'invoice-a' }),
      paidInvoice({ id: 'invoice-b' }),
    ]);
    let calls = 0;
    prisma.tx.myDataInvoice.create.mockImplementation(({ data }) => {
      calls += 1;
      if (calls === 1) {
        throw { code: 'P2002' };
      }
      return Promise.resolve(data);
    });

    await expect(
      service.generateForPeriod('building-1', '2026-07'),
    ).resolves.toEqual({ created: 2, skipped: 0 });
    expect(prisma.tx.myDataInvoice.count).toHaveBeenCalledTimes(2); // initial + resync
  });

  it('propagates non-conflict errors', async () => {
    prisma.tx.myDataInvoice.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.generateForPeriod('building-1', '2026-07'),
    ).rejects.toThrow('db down');
  });

  it('records a REJECTED row instead of failing when AADE rejects a submission', async () => {
    const rejecting = new (class implements MyDataProvider {
      async submit(): Promise<MyDataSubmitResult> {
        throw new SubmissionError('AADE rejected invoice', {
          detail: '<errors><error><message>bad doc</message></error></errors>',
          permanent: true,
        });
      }
    })();
    const rejectingService = new MyDataService(
      prisma as unknown as PrismaService,
      rejecting,
    );

    await expect(
      rejectingService.generateForPeriod('building-1', '2026-07'),
    ).resolves.toEqual({ created: 0, skipped: 0 });

    expect(prisma.tx.myDataInvoice.create).toHaveBeenCalledTimes(1);
    const data = prisma.tx.myDataInvoice.create.mock.calls[0][0].data;
    expect(data.status).toBe('REJECTED');
    expect(data.mark).toMatch(/^REJ-[0-9A-F]{16}$/);
    expect(data.responseRaw).toContain('AADE rejected invoice');
  });

  it('rejects a malformed period with 400', async () => {
    await expect(
      service.generateForPeriod('building-1', '26-07'),
    ).rejects.toThrow(BadRequestException);
    await expect(service.generateForPeriod('building-1', '')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('MyDataService.xmlForPeriod', () => {
  it('renders stored records into a downloadable XML document', async () => {
    const prisma = makePrisma();
    prisma.myDataInvoice.findMany.mockResolvedValue([
      {
        mark: '4000ABCDEF123456',
        series: 'A',
        seqNo: 3,
        issueDate: new Date('2026-08-01T10:00:00.000Z'),
        paymentMethodCode: '3',
        classificationCategory: 'category1_1',
        classificationType: 'E3_561_001',
        netAmountCents: 10_000,
        vatAmountCents: 2_400,
        invoice: { periodYearMonth: '2026-07', unit: { label: 'Α1' } },
      },
    ]);
    const service = new MyDataService(
      prisma as unknown as PrismaService,
      new OfflineMyDataProvider(),
    );

    const file = await service.xmlForPeriod('building-1', '2026-07');

    expect(file.contentType).toBe('text/xml;charset=utf-8');
    expect(file.filename).toBe('mydata-2026-07.xml');
    expect(file.body).toContain('<InvoicesDoc>');
    expect(file.body).toContain('<mark>4000ABCDEF123456</mark>');
    expect(file.body).toContain('<aa>3</aa>');
    expect(file.body).toBe(
      buildMyDataXml([
        {
          mark: '4000ABCDEF123456',
          series: 'A',
          seqNo: 3,
          issueDate: new Date('2026-08-01T10:00:00.000Z'),
          paymentMethodCode: '3',
          classificationCategory: 'category1_1',
          classificationType: 'E3_561_001',
          netAmountCents: 10_000,
          vatAmountCents: 2_400,
        },
      ]),
    );
  });
});

describe('createMyDataProvider', () => {
  const envKeys = [
    'MYDATA_MODE',
    'MYDATA_USER_ID',
    'MYDATA_SUBSCRIPTION_KEY',
  ] as const;

  afterEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  it('defaults to the offline provider and honors offline mode', () => {
    expect(createMyDataProvider()).toBeInstanceOf(OfflineMyDataProvider);
    expect(createMyDataProvider('offline')).toBeInstanceOf(
      OfflineMyDataProvider,
    );
  });

  it('live mode fails fast without credentials', () => {
    expect(() => createMyDataProvider('live')).toThrow(/MYDATA_USER_ID/);
    process.env.MYDATA_USER_ID = 'user';
    expect(() => createMyDataProvider('live')).toThrow(
      /MYDATA_SUBSCRIPTION_KEY/,
    );
  });

  it('live mode builds a live provider once credentials are present', () => {
    process.env.MYDATA_MODE = 'live';
    process.env.MYDATA_USER_ID = 'user';
    process.env.MYDATA_SUBSCRIPTION_KEY = 'key';
    expect(createMyDataProvider()).toBeInstanceOf(LiveAadeMyDataProvider);
  });
});

describe('MyDataService.reconcile', () => {
  const uidRaw =
    '<ResponseDoc><response><uid>4001</uid><authenticationCode>AC1</authenticationCode></response></ResponseDoc>';

  function serviceWith(provider: MyDataProvider) {
    const prisma = makePrisma();
    prisma.myDataInvoice.findMany.mockResolvedValue([
      { id: 'mydata-1', mark: '4001' },
      { id: 'mydata-2', mark: '4002' },
      { id: 'mydata-3', mark: '4003' },
    ]);
    return {
      prisma,
      service: new MyDataService(prisma as unknown as PrismaService, provider),
    };
  }

  it('settles SUBMITTED records to ACCEPTED/REJECTED and skips PENDING', async () => {
    const provider: MyDataProvider = {
      submit: jest.fn(),
      pollStatus: jest
        .fn()
        .mockResolvedValueOnce({ state: 'ACCEPTED', raw: uidRaw })
        .mockResolvedValueOnce({
          state: 'REJECTED',
          raw: '<ResponseDoc><errors><error><message>mismatch</message></error></errors></ResponseDoc>',
        })
        .mockResolvedValueOnce({ state: 'PENDING', raw: '<ResponseDoc/>' }),
    };
    const { prisma, service } = serviceWith(provider);

    await expect(service.reconcile('building-1', '2026-07')).resolves.toEqual({
      checked: 3,
      accepted: 1,
      rejected: 1,
    });

    expect(provider.pollStatus).toHaveBeenCalledWith('4001');
    expect(prisma.myDataInvoice.update).toHaveBeenCalledTimes(2);
    expect(
      prisma.myDataInvoice.update.mock.calls.map(([call]) => call),
    ).toEqual([
      {
        where: { id: 'mydata-1' },
        data: { status: 'ACCEPTED', responseRaw: uidRaw },
      },
      {
        where: { id: 'mydata-2' },
        data: {
          status: 'REJECTED',
          responseRaw: expect.stringContaining('mismatch'),
        },
      },
    ]);
  });

  it('leaves records untouched when AADE keeps erroring after retries', async () => {
    const provider: MyDataProvider = {
      submit: jest.fn(),
      pollStatus: jest
        .fn()
        .mockRejectedValue(
          new SubmissionError('still failing', { status: 503 }),
        ),
    };
    const { prisma, service } = serviceWith(provider);

    await expect(service.reconcile('building-1', '2026-07')).resolves.toEqual({
      checked: 3,
      accepted: 0,
      rejected: 0,
    });
    expect(prisma.myDataInvoice.update).not.toHaveBeenCalled();
  });

  it('reconciles nothing with the offline provider', async () => {
    const prisma = makePrisma();
    const service = new MyDataService(
      prisma as unknown as PrismaService,
      new OfflineMyDataProvider(),
    );

    await expect(service.reconcile('building-1', '2026-07')).resolves.toEqual({
      checked: 0,
      accepted: 0,
      rejected: 0,
    });
    expect(prisma.myDataInvoice.findMany).not.toHaveBeenCalled();
  });
});
