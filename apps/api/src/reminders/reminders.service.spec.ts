import { ForbiddenException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from './reminders.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { NotificationsService } from '../notifications/notifications.service';
import type { Mailer } from './mailer';

const admin = (): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
});

function makePrisma() {
  return {
    invoice: {
      findMany: jest.fn().mockResolvedValue([
        {
          unitId: 'unit-a',
          periodYearMonth: '2026-06',
          totalCents: 10_000,
          paidCents: 3_000,
        },
        {
          unitId: 'unit-a',
          periodYearMonth: '2026-07',
          totalCents: 10_000,
          paidCents: 10_000,
        },
        {
          unitId: 'unit-b',
          periodYearMonth: '2026-07',
          totalCents: 8_000,
          paidCents: 0,
        },
      ]),
    },
    unit: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'unit-a', label: 'Α1' },
          { id: 'unit-b', label: 'Β1' },
        ]),
    },
    ownership: {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'owner-1', unitId: 'unit-a', user: { email: 'Owner@Demo.gr', phone: '+306911111111' } },
        // Same owner, second unit — must not produce a duplicate email.
        { userId: 'owner-1', unitId: 'unit-b', user: { email: 'owner@demo.gr', phone: '+306911111111' } },
      ]),
    },
  };
}

function makeMailer(): Mailer & { send: jest.Mock } {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

const notificationsStub = (): NotificationsService =>
  ({
    sendSmsToUsers: jest.fn().mockResolvedValue(undefined),
  }) as unknown as NotificationsService;

describe('RemindersService', () => {
  let service: RemindersService;
  let prisma: ReturnType<typeof makePrisma>;
  let mailer: ReturnType<typeof makeMailer>;
  let notifications: NotificationsService;

  beforeEach(() => {
    prisma = makePrisma();
    mailer = makeMailer();
    notifications = notificationsStub();
    service = new RemindersService(
      prisma as unknown as PrismaService,
      mailer as Mailer,
      notifications,
    );
  });

  it('sends one deduplicated Greek email per recipient with their unpaid periods', async () => {
    const result = await service.send('building-1', undefined, admin());

    expect(result).toEqual({ sent: 1 });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const [to, subject, html] = mailer.send.mock.calls[0];
    expect(to).toBe('owner@demo.gr');
    expect(subject).toContain('Υπενθύμιση οφειλών κοινόχρηστων');
    expect(html).toContain('Διαμ. Α1');
    expect(html).toContain('Διαμ. Β1');
    expect(html).toContain('2026-06'); // unit-a outstanding
    expect(html).toContain('2026-07'); // unit-b outstanding
    expect(html).toContain('Σύνολο οφειλής');
    expect(html).toContain('150,00 €'); // 7000 + 8000 cents total
    expect(notifications.sendSmsToUsers).toHaveBeenCalledWith(
      [{ userId: 'owner-1', phone: '+306911111111' }],
      { kind: 'arrears.reminder', periodKey: undefined },
    );
  });

  it('filters by period when one is provided', async () => {
    await service.send('building-1', '2026-07', admin());

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildingId: 'building-1', periodYearMonth: '2026-07' },
      }),
    );
    const [, subject] = mailer.send.mock.calls[0];
    expect(subject).toContain('2026-07');
  });

  it('previews recipients and subject without sending anything', async () => {
    const preview = await service.preview('building-1', undefined, admin());

    expect(preview).toEqual({
      recipients: ['owner@demo.gr'],
      subject: 'Υπενθύμιση οφειλών κοινόχρηστων',
    });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('returns sent:0 and skips the mailer when nobody owes anything', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { unitId: 'unit-a', periodYearMonth: '2026-07', totalCents: 500, paidCents: 500 },
    ]);

    await expect(service.send('building-1', undefined, admin())).resolves.toEqual({
      sent: 0,
    });
    expect(mailer.send).not.toHaveBeenCalled();
    expect(notifications.sendSmsToUsers).not.toHaveBeenCalled();
  });

  it('enforces tenant scope', async () => {
    await expect(
      service.send('building-2', undefined, admin()),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.preview('building-2', undefined, admin()),
    ).rejects.toThrow(ForbiddenException);
    expect(mailer.send).not.toHaveBeenCalled();
  });
});
