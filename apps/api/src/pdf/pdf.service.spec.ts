import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { PDF_CONTENT_TYPE, PdfService } from './pdf.service';

type PrismaMock = {
  invoice: {
    findUnique: jest.Mock;
    findMany?: jest.Mock;
  };
  expense: {
    findMany: jest.Mock;
  };
  ownership: {
    findFirst: jest.Mock;
    findMany?: jest.Mock;
  };
  unit: {
    findUnique: jest.Mock;
  };
};

const admin = (): AuthenticatedUser => ({
  id: 'user-admin',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
});

const resident = (): AuthenticatedUser => ({
  id: 'user-1',
  email: 'resident@demo.gr',
  role: 'RESIDENT',
  buildingId: 'building-1',
});

const invoiceRow = () => ({
  id: 'invoice-1',
  buildingId: 'building-1',
  unitId: 'unit-1',
  periodYearMonth: '2026-08',
  totalCents: 6000,
  paidCents: 0,
  status: 'PENDING',
  payer: 'OCCUPANT',
  unit: {
    id: 'unit-1',
    label: 'A1',
    floor: 1,
    millimes: 85,
    radiatorCount: 6,
    squareMeters: 72,
    shareFraction: null,
    building: {
      id: 'building-1',
      name: 'Ηλέκτρα',
      address: 'Τσιμισκή 10',
      city: 'Θεσσαλονίκη',
      invoiceRegistrationNo: 'T1234567890123',
      branding: null,
    },
  },
});

function buildService(prisma: Partial<PrismaMock>): PdfService {
  if (prisma.invoice && !prisma.invoice.findMany) prisma.invoice.findMany = jest.fn().mockResolvedValue([]);
  if (prisma.ownership && !prisma.ownership.findMany) prisma.ownership.findMany = jest.fn().mockResolvedValue([]);
  return new PdfService(prisma as unknown as PrismaService);
}

describe('PdfService', () => {
  it('renders a non-empty PDF for an invoice the admin may fetch', async () => {
    const prisma: PrismaMock = {
      invoice: { findUnique: jest.fn().mockResolvedValue(invoiceRow()) },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
      ownership: { findFirst: jest.fn() },
      unit: { findUnique: jest.fn() },
    };
    const service = buildService(prisma);

    const file = await service.invoicePdf('invoice-1', admin());

    expect(file.contentType).toBe(PDF_CONTENT_TYPE);
    expect(file.filename).toBe('eidopoiitirio-2026-08-A1.pdf');
    expect(file.body.length).toBeGreaterThan(500);
    expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Greek-capable font must be embedded (Helvetica/WinAnsi cannot encode Greek).
    expect(file.body.toString('latin1')).toContain('NotoSans');
  });

  it('returns 403 for a resident who does not own the unit', async () => {
    const prisma: PrismaMock = {
      invoice: { findUnique: jest.fn().mockResolvedValue(invoiceRow()) },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
      ownership: { findFirst: jest.fn().mockResolvedValue(null) },
      unit: { findUnique: jest.fn() },
    };
    const service = buildService(prisma);

    await expect(service.invoicePdf('invoice-1', resident())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws 404 for a missing invoice', async () => {
    const prisma: PrismaMock = {
      invoice: { findUnique: jest.fn().mockResolvedValue(null) },
      expense: { findMany: jest.fn() },
      ownership: { findFirst: jest.fn() },
      unit: { findUnique: jest.fn() },
    };
    const service = buildService(prisma);

    await expect(service.invoicePdf('invoice-9', admin())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('renders the per-column notice with previous balance for a Greek building', async () => {
    const prisma: PrismaMock = {
      invoice: {
        findUnique: jest.fn().mockResolvedValue({ ...invoiceRow(), totalCents: 2150 }),
        findMany: jest.fn().mockResolvedValue([{ totalCents: 1000, paidCents: 400 }]),
      },
      expense: {
        findMany: jest.fn().mockResolvedValue([
          { description: 'Καθαριότητα', totalCents: 12000, chargeTo: 'OCCUPANT', category: { id: 'g', name: 'Γενικά', strategy: 'MILIMES' }, shares: [{ amountCents: 1020 }] },
          { description: 'Πετρέλαιο', totalCents: 20000, chargeTo: 'OCCUPANT', category: { id: 'h', name: 'Θέρμανση', strategy: 'RADIATORS' }, shares: [{ amountCents: 1130 }] },
          { description: 'Ταράτσα', totalCents: 50000, chargeTo: 'OWNER', category: { id: 'g', name: 'Γενικά', strategy: 'MILIMES' }, shares: [{ amountCents: 4250 }] },
        ]),
      },
      ownership: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { occupantType: 'OWNER', user: { firstName: 'Μαρία', lastName: 'Ιωάννου' } },
        ]),
      },
      unit: { findUnique: jest.fn() },
    };
    const file = await buildService(prisma).invoicePdf('invoice-1', admin());

    expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ unitId: 'unit-1', payer: 'OCCUPANT', status: { not: 'PAID' } }),
      }),
    );
  });
});
