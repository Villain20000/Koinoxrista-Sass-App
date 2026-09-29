import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type {
  ProviderDetailDto,
  ProviderDirectoryItemDto,
  ProviderSearchFilters,
} from '@org/shared';

import { PrismaService } from '../prisma/prisma.service';

interface ProfileWithUser {
  userId: string;
  trade: string;
  certs: string[];
  rating: number | null;
  city: string | null;
  bio: string | null;
  hourlyRateCents: number | null;
  user: { id: string; firstName: string; lastName: string };
}

interface ProviderStats {
  completedJobs: number;
  ratingSum: number;
  ratedCount: number;
}

/**
 * Stable partition: featured providers first, original order preserved
 * inside each group (Array#sort is stable per ES2019+).
 */
export function sortFeaturedFirst<
  T extends { featuredUntil?: string | null },
>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(b.featuredUntil != null) - Number(a.featuredUntil != null),
  );
}

@Injectable()
export class ProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    filters: ProviderSearchFilters,
  ): Promise<ProviderDirectoryItemDto[]> {
    const where: Prisma.ProviderProfileWhereInput = {};
    if (filters.trade) {
      where.trade = { contains: filters.trade, mode: 'insensitive' };
    }
    if (filters.city) {
      where.city = { contains: filters.city, mode: 'insensitive' };
    }
    if (filters.minRating !== undefined) {
      where.rating = { gte: filters.minRating };
    }
    if (filters.q) {
      where.OR = [
        { user: { firstName: { contains: filters.q, mode: 'insensitive' } } },
        { user: { lastName: { contains: filters.q, mode: 'insensitive' } } },
        { trade: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const [profiles, featuredUntilById] = await Promise.all([
      this.prisma.providerProfile.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.activeFeaturedUntilByProvider(),
    ]);

    const items = await this.toDirectoryItems(profiles, featuredUntilById);
    return sortFeaturedFirst(items);
  }

  async detail(userId: string, callerRole: Role): Promise<ProviderDetailDto> {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });
    if (!profile) throw new NotFoundException('Provider not found');

    const [item] = await this.toDirectoryItems([profile]);
    return {
      ...item,
      contact:
        callerRole === Role.ADMIN
          ? { phone: profile.user.phone, email: profile.user.email }
          : null,
    };
  }

  private async toDirectoryItems(
    profiles: ProfileWithUser[],
    featuredUntilById: Map<string, string> = new Map(),
  ): Promise<ProviderDirectoryItemDto[]> {
    const stats = await this.computeStats(profiles.map((p) => p.userId));

    return profiles.map((profile) => {
      const stat = stats.get(profile.userId);
      return {
        userId: profile.userId,
        firstName: profile.user.firstName,
        lastName: profile.user.lastName,
        trade: profile.trade,
        certs: profile.certs,
        rating: profile.rating,
        city: profile.city,
        bio: profile.bio,
        hourlyRateCents: profile.hourlyRateCents,
        completedJobs: stat?.completedJobs ?? 0,
        avgRating:
          stat && stat.ratedCount > 0
            ? Math.round((stat.ratingSum / stat.ratedCount) * 100) / 100
            : null,
        featuredUntil: featuredUntilById.get(profile.userId) ?? null,
      };
    });
  }

  /**
   * One batched lookup over ALL currently-active featured slots (any
   * building): providerId → latest `endsAt` (ISO). Route through Date.now()
   * so clocks are mockable in tests.
   */
  private async activeFeaturedUntilByProvider(): Promise<Map<string, string>> {
    const now = new Date(Date.now());
    const slots = await this.prisma.featuredSlot.findMany({
      where: { startsAt: { lte: now }, endsAt: { gt: now } },
      select: { providerId: true, endsAt: true },
    });

    const map = new Map<string, string>();
    for (const slot of slots) {
      const iso = slot.endsAt.toISOString();
      const current = map.get(slot.providerId);
      if (!current || current < iso) map.set(slot.providerId, iso);
    }
    return map;
  }

  private async computeStats(
    userIds: string[],
  ): Promise<Map<string, ProviderStats>> {
    const stats = new Map<string, ProviderStats>();
    if (userIds.length === 0) return stats;

    const bids = await this.prisma.bid.findMany({
      where: { providerUserId: { in: userIds } },
      select: { providerUserId: true, status: true, ratingStars: true },
    });

    for (const bid of bids) {
      const entry = stats.get(bid.providerUserId) ?? {
        completedJobs: 0,
        ratingSum: 0,
        ratedCount: 0,
      };
      if (bid.status === 'ACCEPTED') entry.completedJobs += 1;
      if (bid.ratingStars !== null && bid.ratingStars !== undefined) {
        entry.ratingSum += bid.ratingStars;
        entry.ratedCount += 1;
      }
      stats.set(bid.providerUserId, entry);
    }
    return stats;
  }
}
