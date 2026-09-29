import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import type { PushSender } from './push-sender';
import type { SmsSender } from './sms-sender';

function makePrisma() {
  return {
    notification: {
      create: jest.fn().mockImplementation(async (args) => args.data),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pushSubscription: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation(async (args) => args.create),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
}

const sub = (endpoint: string) => ({
  userId: 'user-1',
  endpoint,
  p256dh: `p256dh-${endpoint}`,
  auth: `auth-${endpoint}`,
});

function goneError(status: number): Error {
  return Object.assign(new Error(`gone (${status})`), { statusCode: status });
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: ReturnType<typeof makePrisma>;
  let sender: { send: jest.Mock };
  let smsSender: { send: jest.Mock };

  beforeEach(() => {
    prisma = makePrisma();
    sender = { send: jest.fn().mockResolvedValue(undefined) };
    smsSender = {
      send: jest.fn().mockResolvedValue({ ok: true, providerId: 'sms-1' }),
    };
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      sender as unknown as PushSender,
      smsSender as unknown as SmsSender,
      {
        publishToUser: jest.fn(),
        publishToBuilding: jest.fn(),
        publish: jest.fn(),
        subscribe: jest.fn(),
        disconnect: jest.fn(),
        merge: jest.fn(),
      } as unknown as import('../realtime/realtime.service').RealtimeService,
    );
  });

  describe('create', () => {
    const input = {
      userId: 'user-1',
      type: 'invoice.issued',
      title: 'Νέο κοινοχρήστους λόγος',
      linkPath: '/balance',
    };

    it('persists the row and pushes to every subscription of the user', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        sub('https://fcm/1'),
        sub('https://fcm/2'),
      ]);

      await service.create(input);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'invoice.issued',
          title: 'Νέο κοινοχρήστους λόγος',
          body: null,
          linkPath: '/balance',
        },
      });
      expect(sender.send).toHaveBeenCalledTimes(2);
      expect(sender.send).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'https://fcm/1' }),
        { title: input.title, url: '/balance' },
      );
    });

    it('never rejects when a push fails and removes gone (410) endpoints', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([sub('https://fcm/gone')]);
      sender.send.mockRejectedValue(goneError(410));

      await expect(service.create(input)).resolves.toBeUndefined();

      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'https://fcm/gone' },
      });
    });

    it('removes 404 endpoints but keeps other failures in place', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        sub('https://fcm/404'),
        sub('https://fcm/500'),
      ]);
      sender.send
        .mockRejectedValueOnce(goneError(404))
        .mockRejectedValueOnce(goneError(500));

      await expect(service.create(input)).resolves.toBeUndefined();

      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'https://fcm/404' },
      });
    });

    it('swallows persistence errors so the host flow never breaks', async () => {
      prisma.notification.create.mockRejectedValue(new Error('db down'));

      await expect(service.create(input)).resolves.toBeUndefined();
      expect(sender.send).not.toHaveBeenCalled();
    });
  });

  describe('createForUsers', () => {
    it('batch-creates one row per distinct user and pushes per user', async () => {
      prisma.pushSubscription.findMany.mockImplementation(async (args) =>
        args.where.userId === 'user-1' ? [sub('https://fcm/1')] : [],
      );

      await service.createForUsers(['user-1', 'user-1', 'user-2'], {
        type: 'vote.opened',
        title: 'Νέα ψηφοφορία: Ανελκυστήρας',
        linkPath: '/votes',
      });

      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ userId: 'user-1' }),
          expect.objectContaining({ userId: 'user-2' }),
        ],
      });
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for an empty audience', async () => {
      await service.createForUsers([], { type: 'vote.opened', title: 'x' });

      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('texts each distinct user that has a phone when an sms context is given', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ phone: '+306911111111' })
        .mockResolvedValueOnce(null);

      await service.createForUsers(['user-1', 'user-1', 'user-2'], {
        type: 'invoice.issued',
        title: 'Νέο κοινοχρήστους λόγος',
        linkPath: '/balance',
        sms: { kind: 'invoice.issued', periodKey: '2026-08' },
      });

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
      expect(smsSender.send).toHaveBeenCalledTimes(1);
      expect(smsSender.send).toHaveBeenCalledWith('+306911111111', expect.any(String));
    });
  });

  describe('sms channel', () => {
    const input = {
      userId: 'user-1',
      type: 'invoice.issued',
      title: 'Νέο κοινοχρήστους λόγος',
      linkPath: '/balance',
      sms: { kind: 'invoice.issued', periodKey: '2026-08' },
    };
    const nextPeriodSms = { kind: 'invoice.issued', periodKey: '2026-09' };

    it('sends the templated Greek text when the user has a phone', async () => {
      prisma.user.findUnique.mockResolvedValue({ phone: '+306912345678' });

      await service.create(input);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { phone: true },
      });
      expect(smsSender.send).toHaveBeenCalledTimes(1);
      expect(smsSender.send).toHaveBeenCalledWith(
        '+306912345678',
        'ΠολυκατοικίαOS: Νέο κοινόχρηστο για τον μήνα 2026-08. Ανοίξτε την εφαρμογή για εξόφληση.',
      );
    });

    it('skips silently when the user has no phone or the lookup fails', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await service.create(input);
      expect(smsSender.send).not.toHaveBeenCalled();

      prisma.user.findUnique.mockRejectedValue(new Error('db down'));
      await expect(service.create(input)).resolves.toBeUndefined();
      expect(smsSender.send).not.toHaveBeenCalled();
    });

    it('dedupes (kind,userId,periodKey) within the run but re-sends for a new period', async () => {
      prisma.user.findUnique.mockResolvedValue({ phone: '+306912345678' });

      await service.create(input);
      await service.create(input);
      expect(smsSender.send).toHaveBeenCalledTimes(1);

      await service.create({ ...input, sms: nextPeriodSms });
      expect(smsSender.send).toHaveBeenCalledTimes(2);
    });

    it('does not send SMS for notifications without an sms context', async () => {
      prisma.user.findUnique.mockResolvedValue({ phone: '+306912345678' });

      await service.create({
        userId: 'user-1',
        type: 'bid.received',
        title: 'Νέα προσφορά για εργασία',
      });

      expect(smsSender.send).not.toHaveBeenCalled();
    });

    it('never rejects when the gateway fails', async () => {
      prisma.user.findUnique.mockResolvedValue({ phone: '+306912345678' });
      smsSender.send.mockRejectedValue(new Error('gateway down'));

      await expect(service.create(input)).resolves.toBeUndefined();
    });
  });

  describe('sendSmsToUsers', () => {
    const sms = { kind: 'arrears.reminder', periodKey: '2026-07' };

    it('texts only recipients with a phone, once each', async () => {
      await service.sendSmsToUsers(
        [
          { userId: 'user-1', phone: '+306911111111' },
          { userId: 'user-2', phone: null },
          { userId: 'user-3', phone: '+306933333333' },
        ],
        sms,
      );

      expect(smsSender.send).toHaveBeenCalledTimes(2);
      expect(smsSender.send).toHaveBeenCalledWith(
        '+306911111111',
        'ΠολυκατοικίαOS: Υπενθύμιση οφειλών κοινόχρηστων για τον μήνα 2026-07. Ανοίξτε την εφαρμογή για εξόφληση.',
      );
      expect(smsSender.send).toHaveBeenCalledWith('+306933333333', expect.any(String));
    });

    it('is a no-op for an empty audience or an unmapped kind', async () => {
      await service.sendSmsToUsers([], sms);
      await service.sendSmsToUsers([{ userId: 'u', phone: '+3' }], {
        kind: 'bid.received',
      });

      expect(smsSender.send).not.toHaveBeenCalled();
    });
  });

  describe('listForUser', () => {
    it('pages newest-first and reports the unread total', async () => {
      prisma.notification.findMany.mockResolvedValue([{ id: 'n-2' }]);
      prisma.notification.count.mockResolvedValue(3);

      const page = await service.listForUser('user-1', { skip: 10, take: 5 });

      expect(page).toEqual({ items: [{ id: 'n-2' }], totalUnread: 3 });
      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 5,
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
    });

    it('filters unread-only rows and clamps take to 50', async () => {
      await service.listForUser('user-1', { unreadOnly: true, take: 500 });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', readAt: null },
          take: 50,
        }),
      );
    });
  });

  describe('markRead / markAllRead', () => {
    it('marks only own notifications read', async () => {
      await service.markRead('user-1', 'n-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n-1', userId: 'user-1' },
        data: { readAt: expect.any(Date) },
      });
    });

    it('throws NotFound for a foreign or unknown id', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markRead('user-1', 'foreign')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('marks all unread rows read in one statement', async () => {
      await service.markAllRead('user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('push subscriptions', () => {
    it('upserts by endpoint, moving the row to the current user', async () => {
      await service.upsertSubscription('user-1', {
        endpoint: 'https://fcm/1',
        p256dh: 'p',
        auth: 'a',
      });

      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: 'https://fcm/1' },
        update: { userId: 'user-1', p256dh: 'p', auth: 'a' },
        create: {
          userId: 'user-1',
          endpoint: 'https://fcm/1',
          p256dh: 'p',
          auth: 'a',
        },
      });
    });

    it('deletes only the caller-owned row for that endpoint', async () => {
      await service.removeSubscription('user-1', 'https://fcm/1');

      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'https://fcm/1', userId: 'user-1' },
      });
    });
  });
});
