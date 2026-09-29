import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BrandingService, DEFAULT_BRANDING } from './branding.service';

const user = {
  id: 'admin-1',
  email: 'a@b.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

const brandingRow = (overrides: Record<string, unknown> = {}) => ({
  buildingId: 'building-1',
  logoUrl: null,
  primaryColor: '#1e40af',
  accentColor: '#0ea5e9',
  orgName: null,
  footerText: null,
  customDomain: null,
  updatedAt: new Date('2026-08-25T10:00:00.000Z'),
  ...overrides,
});

function makePrisma() {
  return {
    buildingBranding: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
  };
}

describe('BrandingService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { record: jest.Mock };
  let service: BrandingService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = { record: jest.fn() };
    service = new BrandingService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('get', () => {
    it('returns built-in defaults when no row exists', async () => {
      const result = await service.get('building-1', user);

      expect(result).toEqual({
        buildingId: 'building-1',
        logoUrl: null,
        primaryColor: DEFAULT_BRANDING.primaryColor,
        accentColor: DEFAULT_BRANDING.accentColor,
        orgName: null,
        footerText: null,
        customDomain: null,
        updatedAt: '1970-01-01T00:00:00.000Z',
      });
    });

    it('maps a stored row with ISO updatedAt', async () => {
      prisma.buildingBranding.findUnique.mockResolvedValue(
        brandingRow({ orgName: 'Διαχειριστική Κασσάνδρας' }),
      );

      const result = await service.get('building-1', user);

      expect(result.orgName).toBe('Διαχειριστική Κασσάνδρας');
      expect(result.updatedAt).toBe('2026-08-25T10:00:00.000Z');
    });

    it('hides foreign buildings behind a 404', async () => {
      await expect(service.get('building-9', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.buildingBranding.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('upserts the merged settings and writes an audit entry', async () => {
      prisma.buildingBranding.upsert.mockResolvedValue(
        brandingRow({ orgName: 'Κοινότητα Ακρόπολις' }),
      );

      const result = await service.update(
        'building-1',
        {
          orgName: 'Κοινότητα Ακρόπολις',
          primaryColor: '#7c3aed',
          accentColor: '#f59e0b',
          footerText: 'Εκτυπώθηκε από την πλατφόρμα',
        },
        user,
      );

      expect(result.orgName).toBe('Κοινότητα Ακρόπολις');
      expect(prisma.buildingBranding.upsert).toHaveBeenCalledWith({
        where: { buildingId: 'building-1' },
        create: expect.objectContaining({
          buildingId: 'building-1',
          orgName: 'Κοινότητα Ακρόπολις',
          primaryColor: '#7c3aed',
        }),
        update: expect.objectContaining({ primaryColor: '#7c3aed' }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          buildingId: 'building-1',
          actorId: 'admin-1',
          actorRole: Role.ADMIN,
          action: 'branding.update',
          entity: 'building_branding',
          entityId: 'building-1',
        }),
      );
    });

    it('keeps stored values for omitted fields (partial merge)', async () => {
      prisma.buildingBranding.findUnique.mockResolvedValue(
        brandingRow({
          orgName: 'Παλιά επωνυμία',
          primaryColor: '#111111',
          logoUrl: 'https://cdn.example.gr/logo.png',
        }),
      );
      prisma.buildingBranding.upsert.mockResolvedValue(brandingRow());

      await service.update('building-1', { accentColor: '#22d3ee' }, user);

      const arg = prisma.buildingBranding.upsert.mock.calls[0][0];
      expect(arg.create).toMatchObject({
        orgName: 'Παλιά επωνυμία',
        primaryColor: '#111111',
        accentColor: '#22d3ee',
        logoUrl: 'https://cdn.example.gr/logo.png',
      });
      expect(arg.update).toMatchObject({ accentColor: '#22d3ee' });
    });

    it('falls back to defaults when updating a never-configured building', async () => {
      prisma.buildingBranding.upsert.mockResolvedValue(
        brandingRow({ primaryColor: '#123456' }),
      );

      await service.update('building-1', { primaryColor: '#123456' }, user);

      const arg = prisma.buildingBranding.upsert.mock.calls[0][0];
      expect(arg.create).toMatchObject({
        primaryColor: '#123456',
        accentColor: DEFAULT_BRANDING.accentColor,
        logoUrl: null,
      });
    });

    it('clears optional fields on explicit null', async () => {
      prisma.buildingBranding.findUnique.mockResolvedValue(
        brandingRow({ customDomain: 'brand.example.gr' }),
      );
      prisma.buildingBranding.upsert.mockResolvedValue(brandingRow());

      await service.update('building-1', { customDomain: null }, user);

      expect(
        prisma.buildingBranding.upsert.mock.calls[0][0].create,
      ).toMatchObject({ customDomain: null });
    });

    it('maps a customDomain unique violation to a 409 conflict', async () => {
      prisma.buildingBranding.upsert.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.update('building-1', { customDomain: 'taken.example.gr' }, user),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a foreign building with 404 and does not write', async () => {
      await expect(
        service.update('building-9', { primaryColor: '#000000' }, user),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.buildingBranding.upsert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('getPublic', () => {
    it('serves only the safe display subset (no customDomain key)', async () => {
      prisma.buildingBranding.findUnique.mockResolvedValue(
        brandingRow({ customDomain: 'brand.example.gr' }),
      );

      const result = await service.getPublic('building-1');

      expect(result).toEqual({
        buildingId: 'building-1',
        logoUrl: null,
        primaryColor: '#1e40af',
        accentColor: '#0ea5e9',
        orgName: null,
        footerText: null,
      });
      expect(result).not.toHaveProperty('customDomain');
      // Shape guard: only display fields are ever exposed publicly.
      expect(Object.keys(result).sort()).toEqual(
        [
          'accentColor',
          'buildingId',
          'footerText',
          'logoUrl',
          'orgName',
          'primaryColor',
        ].sort(),
      );
    });

    it('returns defaults for an unknown building', async () => {
      const result = await service.getPublic('missing-building');

      expect(result.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
      expect(result.accentColor).toBe(DEFAULT_BRANDING.accentColor);
      expect(result.logoUrl).toBeNull();
    });
  });
});
