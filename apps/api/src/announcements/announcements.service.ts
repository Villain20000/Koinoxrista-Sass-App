import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import type { SmsContext } from '../notifications/sms-templates';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

export const ANNOUNCEMENT_CREATED_TYPE = 'announcement.created';
export const ANNOUNCEMENT_FEED_LINK_PATH = '/feed';

/** Hard cap shared with the CommentDto validator (defence in depth). */
export const MAX_COMMENT_LENGTH = 1000;

const ANNOUNCEMENT_INCLUDE = Prisma.validator<Prisma.AnnouncementInclude>()({
  author: { select: { firstName: true, lastName: true, email: true } },
  _count: { select: { comments: true } },
});
type AnnouncementRow = Prisma.AnnouncementGetPayload<{
  include: typeof ANNOUNCEMENT_INCLUDE;
}>;

const COMMENT_INCLUDE = Prisma.validator<Prisma.AnnouncementCommentInclude>()({
  author: { select: { firstName: true, lastName: true, email: true } },
});
type CommentRow = Prisma.AnnouncementCommentGetPayload<{
  include: typeof COMMENT_INCLUDE;
}>;

/** Feed + admin list order: pinned first, then newest within each group. */
const ANNOUNCEMENT_ORDER = [{ pinned: 'desc' }, { createdAt: 'desc' }] as const;

function displayName(author: {
  firstName: string;
  lastName: string;
  email: string;
}): string {
  const name = [author.firstName, author.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || author.email;
}

function excerpt(text: string, max = 140): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** ADMIN: creates an announcement and notifies the audience in-app. */
  async create(
    buildingId: string,
    dto: CreateAnnouncementDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);

    const created = await this.prisma.announcement.create({
      data: {
        buildingId,
        authorId: user.id,
        title: dto.title,
        body: dto.body,
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
        ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
      },
      include: ANNOUNCEMENT_INCLUDE,
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'announcement.created',
      entity: 'announcement',
      entityId: created.id,
      metadata: { title: created.title, pinned: created.pinned },
    });

    // Fire-and-forget: a slow/broken notification path must never block or
    // fail the announcement itself.
    void this.notifyAudience(buildingId, created.audience, {
      type: ANNOUNCEMENT_CREATED_TYPE,
      title: `Νέα ανακοίνωση: ${created.title}`,
      body: excerpt(created.body),
      linkPath: ANNOUNCEMENT_FEED_LINK_PATH,
      sms: { kind: 'announcement', topic: created.title },
    });

    this.realtime.publishToBuilding(buildingId, 'announcement.created', {
      id: created.id,
      title: created.title,
      pinned: created.pinned,
      createdAt: created.createdAt.toISOString(),
    });

    return this.toDto(created);
  }

  /** ADMIN: every announcement of the building with comment counts. */
  async listAdmin(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const items = await this.prisma.announcement.findMany({
      where: { buildingId },
      include: ANNOUNCEMENT_INCLUDE,
      orderBy: [...ANNOUNCEMENT_ORDER],
    });
    return items.map((item) => this.toDto(item));
  }

  /** RESIDENT/ADMIN newsfeed: pinned first, then newest (see ANNOUNCEMENT_ORDER). */
  async feed(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const residentOnly = user.role !== Role.RESIDENT && user.role !== Role.ADMIN;
    const items = await this.prisma.announcement.findMany({
      where: {
        buildingId,
        ...(residentOnly ? { audience: 'ALL' } : {}),
      },
      include: ANNOUNCEMENT_INCLUDE,
      orderBy: [...ANNOUNCEMENT_ORDER],
    });
    return items.map((item) => this.toDto(item));
  }

  /** ADMIN: partial update; pin/unpin rides on the same endpoint. */
  async update(id: string, dto: UpdateAnnouncementDto, user: AuthenticatedUser) {
    const item = await this.findOwned(user, id);

    const updated = await this.prisma.announcement.update({
      where: { id: item.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
        ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
      },
      include: ANNOUNCEMENT_INCLUDE,
    });

    this.audit.record({
      buildingId: updated.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'announcement.updated',
      entity: 'announcement',
      entityId: updated.id,
      metadata: {
        title: updated.title,
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
      },
    });
    return this.toDto(updated);
  }

  /** ADMIN: deletes the announcement together with its comments (CASCADE). */
  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const item = await this.findOwned(user, id);
    await this.prisma.announcement.delete({ where: { id: item.id } });
    this.audit.record({
      buildingId: item.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'announcement.deleted',
      entity: 'announcement',
      entityId: item.id,
      metadata: { title: item.title },
    });
  }

  /** RESIDENT/ADMIN: comment thread of one announcement, oldest first. */
  async listComments(announcementId: string, user: AuthenticatedUser) {
    const announcement = await this.findVisible(announcementId, user);
    const comments = await this.prisma.announcementComment.findMany({
      where: { announcementId: announcement.id },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return comments.map((comment) => this.toCommentDto(comment));
  }

  /** RESIDENT/ADMIN: posts a Q&A reply; returns the stored comment. */
  async addComment(
    announcementId: string,
    dto: { body: string },
    user: AuthenticatedUser,
  ) {
    const announcement = await this.findVisible(announcementId, user);
    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException('Comment body must not be empty');
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      throw new BadRequestException(
        `Comment body must be at most ${MAX_COMMENT_LENGTH} characters`,
      );
    }

    const created = await this.prisma.announcementComment.create({
      data: {
        announcementId: announcement.id,
        authorId: user.id,
        body,
      },
      include: COMMENT_INCLUDE,
    });
    return this.toCommentDto(created);
  }

  /**
   * Author may delete their own comment; an ADMIN may delete any. Auditing
   * covers only the moderation case (delete-by-admin).
   */
  async removeComment(
    announcementId: string,
    commentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const announcement = await this.findVisible(announcementId, user);
    const comment = await this.prisma.announcementComment.findFirst({
      where: { id: commentId, announcementId: announcement.id },
      select: { id: true, authorId: true },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    if (user.role !== Role.ADMIN && comment.authorId !== user.id) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.prisma.announcementComment.delete({ where: { id: comment.id } });

    if (user.role === Role.ADMIN && comment.authorId !== user.id) {
      this.audit.record({
        buildingId: announcement.buildingId,
        actorId: user.id,
        actorRole: user.role,
        action: 'announcement.comment_deleted',
        entity: 'announcement_comment',
        entityId: comment.id,
        metadata: { announcementId: announcement.id, authorId: comment.authorId },
      });
    }
  }

  private toDto(item: AnnouncementRow) {
    return {
      id: item.id,
      buildingId: item.buildingId,
      authorId: item.authorId,
      authorName: displayName(item.author),
      title: item.title,
      body: item.body,
      pinned: item.pinned,
      audience: item.audience as 'ALL' | 'RESIDENTS',
      commentsCount: item._count.comments,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toCommentDto(comment: CommentRow) {
    return {
      id: comment.id,
      announcementId: comment.announcementId,
      authorId: comment.authorId,
      authorName: displayName(comment.author),
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  /** Admin mutations hide foreign-building rows behind a 404. */
  private findOwned(user: AuthenticatedUser, id: string) {
    if (!user.buildingId) {
      throw new ForbiddenException('User is not attached to a building');
    }
    return this.prisma.announcement
      .findFirst({ where: { id, buildingId: user.buildingId } })
      .then((item) => {
        if (!item) {
          throw new NotFoundException('Announcement not found');
        }
        return item;
      });
  }

  /** Resident-facing reads scope by tenancy with a 403 for foreign buildings. */
  private async findVisible(announcementId: string, user: AuthenticatedUser) {
    if (!user.buildingId) {
      throw new ForbiddenException('User is not attached to a building');
    }
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: { id: true, buildingId: true },
    });
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }
    assertSameBuilding(user, announcement.buildingId);
    return announcement;
  }

  /**
   * In-app fan-out to the building audience. `sms.kind = 'announcement'` has
   * no SMS template yet, so the dispatcher drops it gracefully (in-app only).
   */
  private async notifyAudience(
    buildingId: string,
    audience: string,
    notification: {
      type: string;
      title: string;
      body?: string;
      linkPath?: string;
      sms?: SmsContext;
    },
  ): Promise<void> {
    const roles: Role[] =
      audience === 'RESIDENTS'
        ? [Role.RESIDENT]
        : [Role.RESIDENT, Role.PROVIDER, Role.ACCOUNTANT];
    const users = await this.prisma.user.findMany({
      where: { buildingId, role: { in: roles } },
      select: { id: true },
    });
    await this.notifications.createForUsers(
      users.map((user) => user.id),
      notification,
    );
  }
}
