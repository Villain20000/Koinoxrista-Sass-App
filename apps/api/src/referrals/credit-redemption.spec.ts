import { redeemReferralCredits } from './credit-redemption';

function makeDeps() {
  const prisma = {
    referralCredit: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const audit = { record: jest.fn() };
  return { prisma, audit };
}

const row = (id: string) => ({
  id,
  buildingId: 'b1',
  code: 'BLD-ABC234',
  months: 1,
  reason: 'REFERRED',
  usedAt: null as Date | null,
  usedPeriod: null as string | null,
  createdAt: new Date(2026, 0, Number(id)),
});

describe('redeemReferralCredits', () => {
  it('consumes the oldest unused credits and stamps usedAt/usedPeriod', async () => {
    const { prisma, audit } = makeDeps();
    prisma.referralCredit.findMany.mockResolvedValue([
      row('3'),
      row('1'),
      row('2'),
    ]);
    prisma.referralCredit.updateMany.mockResolvedValue({ count: 2 });

    const discount = await redeemReferralCredits(prisma, audit, {
      buildingId: 'b1',
      period: '2026-09',
      tier: 'BASIC',
      units: 4, // €6/month
      chargeCents: 1200,
    });

    expect(discount).toBe(1200);
    expect(prisma.referralCredit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['3', '1'] }, usedAt: null },
      data: { usedAt: expect.any(Date), usedPeriod: '2026-09' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'referral.credit.redeemed',
        metadata: {
          period: '2026-09',
          monthsConsumed: 2,
          discountCents: 1200,
        },
      }),
    );
  });

  it('returns 0 without writing when no credits cover the charge', async () => {
    const { prisma, audit } = makeDeps();
    prisma.referralCredit.findMany.mockResolvedValue([row('1')]);

    // Charge below one monthly fee → no partial burn.
    await expect(
      redeemReferralCredits(prisma, audit, {
        buildingId: 'b1',
        period: '2026-09',
        tier: 'BASIC',
        units: 4,
        chargeCents: 500,
      }),
    ).resolves.toBe(0);
    expect(prisma.referralCredit.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns 0 when there are no credits at all (zero-charge trials included)', async () => {
    const { prisma } = makeDeps();
    prisma.referralCredit.findMany.mockResolvedValue([]);

    await expect(
      redeemReferralCredits(prisma, { record: jest.fn() }, {
        buildingId: 'b1',
        period: '2026-09',
        tier: 'BASIC',
        units: 4,
        chargeCents: 0,
      }),
    ).resolves.toBe(0);
    expect(prisma.referralCredit.updateMany).not.toHaveBeenCalled();
  });
});
