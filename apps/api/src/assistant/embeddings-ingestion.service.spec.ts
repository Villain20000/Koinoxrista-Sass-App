import { EmbeddingsIngestionService } from './embeddings-ingestion.service';
import { EmbeddingsService } from './embeddings.service';

type PrismaStub = {
  announcement: { findUnique: jest.Mock; findMany: jest.Mock };
  complianceItem: { findMany: jest.Mock };
  expenseCategory: { findMany: jest.Mock };
};

function makePrisma(): PrismaStub {
  return {
    announcement: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    complianceItem: { findMany: jest.fn().mockResolvedValue([]) },
    expenseCategory: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeEmbeddings(): { upsertChunks: jest.Mock; deleteBySource: jest.Mock } {
  return {
    upsertChunks: jest.fn().mockResolvedValue({ ok: true, embedded: 1, skipped: 0, deleted: 0 }),
    deleteBySource: jest.fn().mockResolvedValue(2),
  };
}

describe('EmbeddingsIngestionService', () => {
  let prisma: PrismaStub;
  let embeddings: ReturnType<typeof makeEmbeddings>;
  let service: EmbeddingsIngestionService;

  beforeEach(() => {
    prisma = makePrisma();
    embeddings = makeEmbeddings();
    service = new EmbeddingsIngestionService(
      prisma as never,
      embeddings as unknown as EmbeddingsService,
    );
  });

  describe('syncAnnouncement (on-write hook)', () => {
    it('upserts one announcement chunk', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        id: 'ann-1',
        title: 'Διακοπή νερού',
        body: 'Την Παρασκευή.',
      });

      await service.syncAnnouncement('building-1', 'ann-1');

      expect(embeddings.upsertChunks).toHaveBeenCalledWith(
        'building-1',
        'announcement',
        'ann-1',
        [{ title: 'Διακοπή νερού', body: 'Την Παρασκευή.' }],
      );
    });

    it('swallows errors (fire-and-forget hook must not throw)', async () => {
      prisma.announcement.findUnique.mockRejectedValue(new Error('db down'));
      await expect(
        service.syncAnnouncement('building-1', 'ann-1'),
      ).resolves.toBeUndefined();
      expect(embeddings.upsertChunks).not.toHaveBeenCalled();
    });
  });

  describe('removeAnnouncement (on-delete hook)', () => {
    it('deletes by source and swallows errors', async () => {
      await service.removeAnnouncement('building-1', 'ann-1');
      expect(embeddings.deleteBySource).toHaveBeenCalledWith(
        'building-1',
        'announcement',
        'ann-1',
      );

      embeddings.deleteBySource.mockRejectedValue(new Error('db down'));
      await expect(
        service.removeAnnouncement('building-1', 'ann-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('syncBuilding', () => {
    it('syncs announcements, compliance, categories and skips empties', async () => {
      prisma.announcement.findMany.mockResolvedValue([
        { id: 'ann-1', title: 'Τίτλος', body: 'Σώμα' },
      ]);
      prisma.complianceItem.findMany.mockResolvedValue([
        { id: 'comp-1', title: 'Πυρασφάλεια', notes: 'Λήγει 30/9', kind: 'INSURANCE' },
      ]);
      prisma.expenseCategory.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'Καθαριότητα', strategy: 'MILIMES' },
      ]);

      const result = await service.syncBuilding('building-1');

      expect(result.failed).toBe(0);
      expect(result.sources).toBeGreaterThanOrEqual(3);
      expect(embeddings.upsertChunks).toHaveBeenCalledWith(
        'building-1',
        'announcement',
        'ann-1',
        [{ title: 'Τίτλος', body: 'Σώμα' }],
      );
      expect(embeddings.upsertChunks).toHaveBeenCalledWith(
        'building-1',
        'compliance',
        'comp-1',
        [{ title: 'Πυρασφάλεια', body: expect.stringContaining('Λήγει 30/9') }],
      );
      expect(embeddings.upsertChunks).toHaveBeenCalledWith(
        'building-1',
        'expense_category',
        'cat-1',
        [expect.objectContaining({ title: 'Καθαριότητα' })],
      );
    });

    it('counts failures per source without aborting the run', async () => {
      prisma.announcement.findMany.mockResolvedValue([
        { id: 'ann-1', title: 'Τ', body: 'Σ' },
      ]);
      embeddings.upsertChunks.mockResolvedValue({
        ok: false,
        embedded: 0,
        skipped: 0,
        deleted: 0,
        error: 'pgvector unavailable',
      });

      const result = await service.syncBuilding('building-1');

      expect(result.failed).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]).toContain('pgvector unavailable');
    });
  });
});
