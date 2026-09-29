import { BadRequestException } from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { GdprController } from './gdpr.controller';
import type { GdprExportDto } from './gdpr.dto';

const user = (): AuthenticatedUser => ({
  id: 'user-1',
  email: 'maria@demo.gr',
  role: 'RESIDENT' as AuthenticatedUser['role'],
  buildingId: 'building-1',
});

function makeService() {
  return {
    exportUserData: jest.fn().mockResolvedValue({
      exportedAt: '2026-08-24T10:00:00.000Z',
      profile: {
        id: 'user-1',
        email: 'maria@demo.gr',
        firstName: 'Μαρία',
        lastName: 'Παπαδοπούλου',
        phone: '6944123456',
        role: 'RESIDENT' as GdprExportDto['profile']['role'],
        createdAt: '2025-01-15T09:00:00.000Z',
      },
      ownerships: [],
      invoicesOfOwnedUnits: [],
      ballots: [],
      bids: [],
      workLogs: [],
      providerProfile: null,
      documents: [],
    } satisfies Partial<GdprExportDto>),
    deleteAccount: jest.fn().mockResolvedValue({ anonymized: true }),
  };
}

function makeHeaderSetter(): {
  setHeader(name: string, value: string): unknown;
  headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader: (name: string, value: string) => void headers.set(name, value),
  };
}

async function readStream(file: StreamableFile): Promise<string> {
  let raw = '';
  for await (const chunk of file.getStream() as unknown as AsyncIterable<
    Uint8Array
  >) {
    raw += Buffer.from(chunk).toString('utf8');
  }
  return raw;
}

describe('GdprController', () => {
  let controller: GdprController;
  let service: ReturnType<typeof makeService>;

  beforeEach(() => {
    service = makeService();
    controller = new GdprController(
      service as unknown as ConstructorParameters<typeof GdprController>[0],
    );
  });

  describe('GET /gdpr/export', () => {
    it('streams the payload as a JSON attachment', async () => {
      const res = makeHeaderSetter();

      const file = await controller.export(user(), res);

      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(res.headers.get('Content-Disposition')).toBe(
        'attachment; filename="gdpr-export.json"',
      );
      expect(file).toBeInstanceOf(StreamableFile);
      const body = JSON.parse(await readStream(file));
      expect(body.profile.email).toBe('maria@demo.gr');
      expect(service.exportUserData).toHaveBeenCalledWith('user-1');
    });
  });

  describe('POST /gdpr/delete-me', () => {
    it('requires the literal DELETE confirmation', async () => {
      await expect(
        controller.deleteMe(user(), { confirm: 'delete' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.deleteMe(user(), { confirm: '' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.deleteMe(user(), undefined as never),
      ).rejects.toThrow(BadRequestException);
      expect(service.deleteAccount).not.toHaveBeenCalled();
    });

    it('erases the account on the exact confirmation', async () => {
      await expect(
        controller.deleteMe(user(), { confirm: 'DELETE' }),
      ).resolves.toEqual({ anonymized: true });
      expect(service.deleteAccount).toHaveBeenCalledWith('user-1');
    });
  });
});
