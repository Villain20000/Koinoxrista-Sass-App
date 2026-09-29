import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService, sortFeaturedFirst } from './providers.service';

const profile = (overrides: Record<string, unknown> = {}) => ({
  userId: 'provider-1',
  trade: 'Υδραυλικός',
  certs: ['Άδεια εργολάβου'],
  rating: 4.5,
  city: 'Thessaloniki',
  bio: '20 χρόνια εμπειρία',
  hourlyRateCents: 3000,
  user: { id: 'provider-1', firstName: 'Δημήτρης', lastName: 'Αναστασιάδης' },
  ...overrides,
});

function makePrisma() {
  return {
    providerProfile: {
      findMany: jest.fn().mockResolvedValue([profile()]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    bid: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    featuredSlot: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('ProvidersService', () => {
  let service: ProvidersService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ProvidersService(prisma as unknown as PrismaService);
  });

  describe('search', () => {
    it('maps all filters onto the prisma where clause', async () => {
      await service.search({
        trade: 'Υδραυλικός',
        city: 'Thessaloniki',
        minRating: 4,
        q: 'Δημήτρης',
      });

      expect(prisma.providerProfile.findMany).toHaveBeenCalledWith({
        where: {
          trade: { contains: 'Υδραυλικός', mode: 'insensitive' },
          city: { contains: 'Thessaloniki', mode: 'insensitive' },
          rating: { gte: 4 },
          OR: [
            {
              user: {
                firstName: { contains: 'Δημήτρης', mode: 'insensitive' },
              },
            },
            {
              user: { lastName: { contains: 'Δημήτρης', mode: 'insensitive' } },
            },
            { trade: { contains: 'Δημήτρης', mode: 'insensitive' } },
          ],
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });

    it('builds an empty where clause when no filters are given', async () => {
      await service.search({});

      const [{ where }] = prisma.providerProfile.findMany.mock.calls[0];
      expect(where).toEqual({});
    });

    it('computes completedJobs from ACCEPTED bids and avgRating over ALL rated bids', async () => {
      prisma.bid.findMany.mockResolvedValue([
        { providerUserId: 'provider-1', status: 'ACCEPTED', ratingStars: 5 },
        { providerUserId: 'provider-1', status: 'ACCEPTED', ratingStars: 3 },
        { providerUserId: 'provider-1', status: 'SUBMITTED', ratingStars: 4 },
        { providerUserId: 'provider-1', status: 'REJECTED', ratingStars: null },
      ]);

      const [item] = await service.search({});

      expect(item).toEqual({
        userId: 'provider-1',
        firstName: 'Δημήτρης',
        lastName: 'Αναστασιάδης',
        trade: 'Υδραυλικός',
        certs: ['Άδεια εργολάβου'],
        rating: 4.5,
        city: 'Thessaloniki',
        bio: '20 χρόνια εμπειρία',
        hourlyRateCents: 3000,
        completedJobs: 2,
        avgRating: 4,
        featuredUntil: null,
      });
      // Directory items never leak contact details.
      expect(item).not.toHaveProperty('email');
      expect(item).not.toHaveProperty('phone');
    });

    it('rounds avgRating to two decimals and skips unrated bids only for the average', async () => {
      prisma.bid.findMany.mockResolvedValue([
        { providerUserId: 'provider-1', status: 'ACCEPTED', ratingStars: 4 },
        { providerUserId: 'provider-1', status: 'ACCEPTED', ratingStars: null },
        { providerUserId: 'provider-1', status: 'REJECTED', ratingStars: 3 },
      ]);

      const [item] = await service.search({});

      expect(item.completedJobs).toBe(2);
      expect(item.avgRating).toBe(3.5); // (4 + 3) / 2
    });

    it('falls back to completedJobs 0 and avgRating null without any bids', async () => {
      const [item] = await service.search({});

      expect(prisma.bid.findMany).toHaveBeenCalledWith({
        where: { providerUserId: { in: ['provider-1'] } },
        select: { providerUserId: true, status: true, ratingStars: true },
      });
      expect(item.completedJobs).toBe(0);
      expect(item.avgRating).toBeNull();
    });

    it('returns [] and skips the bid stats query on empty results', async () => {
      prisma.providerProfile.findMany.mockResolvedValue([]);

      await expect(service.search({ city: 'Nowhere' })).resolves.toEqual([]);
      expect(prisma.bid.findMany).not.toHaveBeenCalled();
    });
  });

  describe('featured placement (search)', () => {
    it('batch-loads active slots and exposes featuredUntil as ISO', async () => {
      prisma.featuredSlot.findMany.mockResolvedValue([
        {
          providerId: 'provider-1',
          endsAt: new Date('2026-10-01T00:00:00Z'),
        },
      ]);

      const [item] = await service.search({});

      expect(prisma.featuredSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            startsAt: { lte: expect.any(Date) },
            endsAt: { gt: expect.any(Date) },
          },
          select: { providerId: true, endsAt: true },
        }),
      );
      expect(item.featuredUntil).toBe('2026-10-01T00:00:00.000Z');
    });

    it('sorts featured providers first, preserving order within each group', async () => {
      prisma.providerProfile.findMany.mockResolvedValue([
        profile({ userId: 'a-plain', user: { id: 'a-plain', firstName: 'A', lastName: 'Plain' } }),
        profile({ userId: 'b-feat', user: { id: 'b-feat', firstName: 'B', lastName: 'Featured' } }),
        profile({ userId: 'c-plain', user: { id: 'c-plain', firstName: 'C', lastName: 'Plain' } }),
        profile({ userId: 'd-feat', user: { id: 'd-feat', firstName: 'D', lastName: 'Featured2' } }),
      ]);
      prisma.featuredSlot.findMany.mockResolvedValue([
        { providerId: 'd-feat', endsAt: new Date('2026-10-01T00:00:00Z') },
        { providerId: 'b-feat', endsAt: new Date('2026-09-01T00:00:00Z') },
      ]);

      const items = await service.search({});

      expect(items.map((i) => i.userId)).toEqual([
        'b-feat',
        'd-feat',
        'a-plain',
        'c-plain',
      ]);
    });

    it('keeps the latest endsAt when a provider has several active slots', async () => {
      prisma.featuredSlot.findMany.mockResolvedValue([
        { providerId: 'provider-1', endsAt: new Date('2026-09-01T00:00:00Z') },
        { providerId: 'provider-1', endsAt: new Date('2027-01-01T00:00:00Z') },
      ]);

      const [item] = await service.search({});
      expect(item.featuredUntil).toBe('2027-01-01T00:00:00.000Z');
    });

    it('detail() is never flagged featured (no slot lookup context)', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue({
        ...profile(),
        user: {
          id: 'provider-1',
          firstName: 'Δημήτρης',
          lastName: 'Αναστασιάδης',
          email: 'provider@demo.gr',
          phone: '+306912345678',
        },
      });

      const result = await service.detail('provider-1', Role.ADMIN);
      expect(result.featuredUntil).toBeNull();
    });
  });

  describe('sortFeaturedFirst', () => {
    it('is a stable partition that does not mutate the input', () => {
      const input = [
        { id: 'a', featuredUntil: null },
        { id: 'b', featuredUntil: '2026-01-01' },
        { id: 'c', featuredUntil: null },
      ];
      const sorted = sortFeaturedFirst(input);

      expect(sorted.map((i) => i.id)).toEqual(['b', 'a', 'c']);
      expect(input.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('detail', () => {
    it('exposes contact details to ADMIN callers', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue({
        ...profile(),
        user: {
          id: 'provider-1',
          firstName: 'Δημήτρης',
          lastName: 'Αναστασιάδης',
          email: 'provider@demo.gr',
          phone: '+306912345678',
        },
      });

      const result = await service.detail('provider-1', Role.ADMIN);

      expect(result.contact).toEqual({
        phone: '+306912345678',
        email: 'provider@demo.gr',
      });
      expect(result.completedJobs).toBe(0);
      expect(result.avgRating).toBeNull();
    });

    it('hides contact details from RESIDENT callers', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue({
        ...profile(),
        user: {
          id: 'provider-1',
          firstName: 'Δημήτρης',
          lastName: 'Αναστασιάδης',
          email: 'provider@demo.gr',
          phone: '+306912345678',
        },
      });

      const result = await service.detail('provider-1', Role.RESIDENT);

      expect(result.contact).toBeNull();
    });

    it('throws NotFound when the provider has no profile', async () => {
      await expect(service.detail('missing-user', Role.ADMIN)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
