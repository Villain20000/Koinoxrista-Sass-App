import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ANNOUNCEMENT_CREATED_TYPE,
  ANNOUNCEMENT_FEED_LINK_PATH,
  AnnouncementsService,
} from './announcements.service';
import { CommentDto } from './dto/comment.dto';

const NOW = new Date('2026-08-25T10:00:00.000Z');

const admin = { id: 'admin-1', email: 'admin@b.gr', role: Role.ADMIN, buildingId: 'building-1' };
const resident = { id: 'res-1', email: 'res@b.gr', role: Role.RESIDENT, buildingId: 'building-1' };

const author = { firstName: 'Ελένη', lastName: 'Παπαδοπούλου', email: 'admin@b.gr' };

const announcement = (overrides: Record<string, unknown> = {}) => ({
  id: 'ann-1',
  buildingId: 'building-1',
  authorId: 'admin-1',
  author,
  title: 'Διακοπή νερού',
  body: 'Την Παρασκευή 28/8 θα διακοπεί η υδροδότηση από τις 09:00.',
  pinned: false,
  audience: 'ALL',
  createdAt: new Date('2026-08-20T09:00:00.000Z'),
  updatedAt: new Date('2026-08-20T09:00:00.000Z'),
  _count: { comments: 2 },
  ...overrides,
});

const comment = (overrides: Record<string, unknown> = {}) => ({
  id: 'com-1',
  announcementId: 'ann-1',
  authorId: 'res-1',
  author: { firstName: 'Νίκος', lastName: 'Ιωάννου', email: 'res@b.gr' },
  body: 'Ισχύει και για το ισόγειο;',
  createdAt: new Date('2026-08-20T10:00:00.000Z'),
  ...overrides,
});

function makePrisma() {
  return {
    announcement: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    announcementComment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('CommentDto', () => {
  const make = (body: string) =>
    validate(plainToInstance(CommentDto, { body })).then((errors) =>
      errors.map((error) => error.property),
    );

  it('accepts a non-empty comment of up to 1000 characters', async () => {
    await expect(make('Καλημέρα, ισχύει;')).resolves.toEqual([]);
    await expect(make('x'.repeat(1000))).resolves.toEqual([]);
  });

  it('rejects an empty and an over-long comment body', async () => {
    await expect(make('')).resolves.toEqual(['body']);
    await expect(make('x'.repeat(1001))).resolves.toEqual(['body']);
  });
});

describe('AnnouncementsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { record: jest.Mock };
  let notifications: { createForUsers: jest.Mock };
  let service: AnnouncementsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = makePrisma();
    audit = { record: jest.fn() };
    notifications = { createForUsers: jest.fn().mockResolvedValue(undefined) };
    service = new AnnouncementsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
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

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('ordering (pin-first)', () => {
    it.each(['feed', 'listAdmin'])(
      '%s orders pinned first then newest and exposes commentsCount',
      async (method) => {
        prisma.announcement.findMany.mockResolvedValue([
          announcement({
            id: 'ann-pinned',
            title: 'Καρφιτσωμένη',
            pinned: true,
            createdAt: new Date('2026-08-19T09:00:00.000Z'),
          }),
          announcement({ id: 'ann-new' }),
          announcement({
            id: 'ann-old',
            title: 'Παλιά',
            createdAt: new Date('2026-08-01T09:00:00.000Z'),
          }),
        ]);

        const items =
          method === 'feed'
            ? await service.feed('building-1', resident)
            : await service.listAdmin('building-1', admin);

        expect(items.map((item: { id: string }) => item.id)).toEqual([
          'ann-pinned',
          'ann-new',
          'ann-old',
        ]);
        expect(items[0]).toMatchObject({
          pinned: true,
          commentsCount: 2,
          authorName: 'Ελένη Παπαδοπούλου',
          audience: 'ALL',
          createdAt: '2026-08-19T09:00:00.000Z',
        });
        expect(prisma.announcement.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { buildingId: 'building-1' },
            orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
          }),
        );
      },
    );
  });

  describe('tenancy isolation', () => {
    it('rejects a foreign building on feed/list/create with 403', async () => {
      await expect(service.feed('building-9', resident)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.listAdmin('building-9', admin),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.create(
          'building-9',
          { title: 'Τίτλος', body: 'Σώμα ανακοίνωσης.' },
          admin,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.announcement.create).not.toHaveBeenCalled();
    });

    it('hides foreign announcements behind a 404 on admin mutations', async () => {
      prisma.announcement.findFirst.mockResolvedValue(null);
      await expect(
        service.update('ann-x', { pinned: true }, admin),
      ).rejects.toThrow(NotFoundException);
      await expect(service.remove('ann-x', admin)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.announcement.update).not.toHaveBeenCalled();
      expect(prisma.announcement.delete).not.toHaveBeenCalled();
    });

    it('rejects comments on a foreign announcement with 403', async () => {
      prisma.announcement.findUnique.mockResolvedValue(
        announcement({ buildingId: 'building-9' }),
      );
      await expect(
        service.addComment(
          'ann-x',
          { body: 'Σχόλιο από άλλη πολυκατοικία;' },
          resident,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.listComments('ann-x', resident),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create', () => {
    const dto = {
      title: 'Γενική συνέλευση',
      body: 'Η ετήσια γενική συνέλευση θα γίνει στις 15/9 στο λόμπι.',
      pinned: true,
    };

    it('creates the announcement with tenancy, defaults and an audit entry', async () => {
      prisma.announcement.create.mockResolvedValue(announcement({ ...dto }));

      const result = await service.create('building-1', dto, admin);

      expect(result).toMatchObject({ title: dto.title, pinned: true });
      expect(prisma.announcement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          authorId: 'admin-1',
          title: dto.title,
          body: dto.body,
          pinned: true,
        }),
        include: expect.objectContaining({
          _count: expect.objectContaining({ select: expect.anything() }),
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'announcement.created',
          entity: 'announcement',
        }),
      );
    });

    it('fans out one in-app notification per resident (stubbed)', async () => {
      prisma.announcement.create.mockResolvedValue(announcement(dto));
      prisma.user.findMany.mockResolvedValue([
        { id: 'res-1' },
        { id: 'res-2' },
      ]);

      await service.create('building-1', dto, admin);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          buildingId: 'building-1',
          role: { in: [Role.RESIDENT, Role.PROVIDER, Role.ACCOUNTANT] },
        },
        select: { id: true },
      });
      expect(notifications.createForUsers).toHaveBeenCalledWith(['res-1', 'res-2'], {
        type: ANNOUNCEMENT_CREATED_TYPE,
        title: `Νέα ανακοίνωση: ${dto.title}`,
        linkPath: ANNOUNCEMENT_FEED_LINK_PATH,
        sms: { kind: 'announcement', topic: dto.title },
        body: expect.any(String),
      });
    });

    it('targets only residents when the audience is RESIDENTS', async () => {
      prisma.announcement.create.mockResolvedValue(
        announcement({ ...dto, audience: 'RESIDENTS' }),
      );

      await service.create(
        'building-1',
        { ...dto, audience: 'RESIDENTS' },
        admin,
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          buildingId: 'building-1',
          role: { in: [Role.RESIDENT] },
        },
        select: { id: true },
      });
    });
  });

  describe('update / remove (audited admin mutations)', () => {
    it('pins/unpins through the partial update and audits it', async () => {
      prisma.announcement.findFirst.mockResolvedValue(announcement());
      prisma.announcement.update.mockResolvedValue(
        announcement({ pinned: true }),
      );

      const result = await service.update('ann-1', { pinned: true }, admin);

      expect(result.pinned).toBe(true);
      expect(prisma.announcement.update).toHaveBeenCalledWith({
        where: { id: 'ann-1' },
        data: { pinned: true },
        include: expect.anything(),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'announcement.updated' }),
      );
    });

    it('deletes an owned announcement (comments cascade) and audits it', async () => {
      prisma.announcement.findFirst.mockResolvedValue(announcement());

      await service.remove('ann-1', admin);

      expect(prisma.announcement.delete).toHaveBeenCalledWith({
        where: { id: 'ann-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'announcement.deleted' }),
      );
    });
  });

  describe('comments', () => {
    it('lists the thread oldest first with author names', async () => {
      prisma.announcement.findUnique.mockResolvedValue(
        announcement({ id: 'ann-1' }),
      );
      prisma.announcementComment.findMany.mockResolvedValue([
        comment(),
        comment({
          id: 'com-2',
          authorId: 'admin-1',
          author,
          body: 'Ναι, σε όλους τους ορόφους.',
          createdAt: new Date('2026-08-20T11:00:00.000Z'),
        }),
      ]);

      const items = await service.listComments('ann-1', resident);

      expect(items.map((item: { id: string }) => item.id)).toEqual([
        'com-1',
        'com-2',
      ]);
      expect(items[0]).toMatchObject({
        authorName: 'Νίκος Ιωάννου',
        announcementId: 'ann-1',
      });
    });

    it('stores a trimmed comment by a RESIDENT or ADMIN and returns it', async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement());
      prisma.announcementComment.create.mockImplementation(({ data }) =>
        Promise.resolve({
          ...comment(),
          body: data.body,
        }),
      );

      const result = await service.addComment(
        'ann-1',
        { body: '  Ισχύει για τα ισόγεια;  ' },
        resident,
      );

      expect(result.body).toBe('Ισχύει για τα ισόγεια;');
      expect(prisma.announcementComment.create).toHaveBeenCalledWith({
        data: {
          announcementId: 'ann-1',
          authorId: 'res-1',
          body: 'Ισχύει για τα ισόγεια;',
        },
        include: expect.anything(),
      });

      await expect(
        service.addComment('ann-1', { body: 'Ερώτηση διαχειριστή;' }, admin),
      ).resolves.toBeDefined();
    });

    it('enforces the 1000-character limit at service level', async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement());

      await expect(
        service.addComment('ann-1', { body: 'x'.repeat(1001) }, resident),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.addComment('ann-1', { body: '   ' }, resident),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.announcementComment.create).not.toHaveBeenCalled();
    });

    it('lets authors delete their own comment without auditing', async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement());
      prisma.announcementComment.findFirst.mockResolvedValue(comment());

      await service.removeComment('ann-1', 'com-1', resident);

      expect(prisma.announcementComment.delete).toHaveBeenCalledWith({
        where: { id: 'com-1' },
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("blocks deleting somebody else's comment as a RESIDENT", async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement());
      prisma.announcementComment.findFirst.mockResolvedValue(
        comment({ authorId: 'someone-else' }),
      );

      await expect(
        service.removeComment('ann-1', 'com-1', resident),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.announcementComment.delete).not.toHaveBeenCalled();
    });

    it('lets an ADMIN delete any comment and audits only that moderation case', async () => {
      prisma.announcement.findUnique.mockResolvedValue(announcement());
      prisma.announcementComment.findFirst.mockResolvedValue(
        comment({ authorId: 'res-1' }),
      );

      await service.removeComment('ann-1', 'com-1', admin);

      expect(prisma.announcementComment.delete).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'announcement.comment_deleted' }),
      );

      // Admin deleting their own comment is not a moderation event.
      prisma.announcementComment.findFirst.mockResolvedValue(
        comment({ authorId: 'admin-1' }),
      );
      audit.record.mockClear();
      await service.removeComment('ann-1', 'com-1', admin);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
