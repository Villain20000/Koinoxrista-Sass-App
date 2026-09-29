import { EmbeddingsService, EMBEDDING_DIM, hashContent, cosineSimilarity } from './embeddings.service';

type PrismaStub = {
  embeddingChunk: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  $executeRawUnsafe: jest.Mock;
  $queryRawUnsafe: jest.Mock;
};

function makePrisma(): PrismaStub {
  return {
    embeddingChunk: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  };
}

/** Deterministic fake embedder: hashes text to a normalized EMBEDDING_DIM vector. */
function fakeEmbed(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    vector[text.charCodeAt(i) % EMBEDDING_DIM] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

function mockFetchEmbeddings(handler: (body: { input: string[] }) => number[][]) {
  return jest.fn().mockImplementation(async (_url: string, init?: { body: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as { input: string[] };
    const embeddings = handler(body);
    return {
      ok: true,
      json: async () => ({ embeddings }),
    } as unknown as Response;
  });
}

/** Typed host so jest.spyOn resolves the real embedBatch signature. */
type EmbedBatchHost = { embedBatch: (texts: string[]) => Promise<number[][]> };

function stubEmbedder(service: EmbeddingsService): void {
  jest
    .spyOn(service as unknown as EmbedBatchHost, 'embedBatch')
    .mockImplementation(async (texts) => texts.map(fakeEmbed));
}

describe('hashContent / cosineSimilarity', () => {
  it('hashes deterministically and differs on content change', () => {
    expect(hashContent('Τίτλος', 'Σώμα')).toBe(hashContent('Τίτλος', 'Σώμα'));
    expect(hashContent('Τίτλος', 'Σώμα')).not.toBe(hashContent('Τίτλος', 'Άλλο σώμα'));
  });

  it('computes cosine similarity matching intuition', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const c = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
    expect(cosineSimilarity(a, c)).toBeCloseTo(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('EmbeddingsService', () => {
  let prisma: PrismaStub;

  beforeEach(() => {
    prisma = makePrisma();
    process.env.PGVECTOR_ENABLED = 'true';
    process.env.EMBEDDING_MODEL = 'test-model';
    process.env.EMBEDDING_API_URL = 'http://ollama.test/api/embed';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.PGVECTOR_ENABLED;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_API_URL;
  });

  it('ensureReady is false when PGVECTOR_ENABLED=false', async () => {
    process.env.PGVECTOR_ENABLED = 'false';
    const service = new EmbeddingsService(prisma as never);
    await expect(service.ensureReady()).resolves.toBe(false);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('ensureReady self-heals the vector schema and caches the result', async () => {
    const service = new EmbeddingsService(prisma as never);
    await expect(service.ensureReady()).resolves.toBe(true);
    await expect(service.ensureReady()).resolves.toBe(true);

    const statements = prisma.$executeRawUnsafe.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes('CREATE EXTENSION'))).toBe(true);
    expect(statements.some((sql) => sql.includes('ADD COLUMN IF NOT EXISTS'))).toBe(true);
    expect(statements.some((sql) => sql.includes('hnsw'))).toBe(true);
    // cached: exactly 3 statements despite two ensureReady calls
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    expect(service.isReady()).toBe(true);
  });

  it('degrades gracefully when pgvector is missing (no throw)', async () => {
    prisma.$executeRawUnsafe.mockRejectedValue(new Error('type vector does not exist'));
    const service = new EmbeddingsService(prisma as never);
    await expect(service.ensureReady()).resolves.toBe(false);
    await expect(
      service.search('building-1', 'πώς πληρώνω;', 5),
    ).resolves.toEqual([]);
  });

  it('upserts new chunks: hashes, embeds and writes a vector literal', async () => {
    const service = new EmbeddingsService(prisma as never);
    stubEmbedder(service);

    const result = await service.upsertChunks('building-1', 'announcement', 'ann-1', [
      { title: 'Διακοπή νερού', body: 'Την Παρασκευή από τις 09:00.' },
    ]);

    expect(result).toMatchObject({ ok: true, embedded: 1, skipped: 0 });
    const insert = prisma.$executeRawUnsafe.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes('INSERT INTO'));
    expect(insert).toBeDefined();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      'building-1',
      'announcement',
      'ann-1',
      'Διακοπή νερού',
      expect.any(String),
      expect.any(String),
      'test-model',
      0,
      expect.stringMatching(/^\[[-0-9.,]+\]$/),
    );
  });

  it('skips unchanged chunks via content hash and deletes stale ones', async () => {
    prisma.embeddingChunk.findMany.mockResolvedValue([
      { id: 'chunk-keep', chunkIndex: 0, contentHash: hashContent('Τίτλος', 'Σώμα'), embeddingModel: 'test-model' },
      { id: 'chunk-stale', chunkIndex: 5, contentHash: hashContent('Παλιος', 'Τιτλος'), embeddingModel: 'test-model' },
    ]);
    const service = new EmbeddingsService(prisma as never);
    stubEmbedder(service);

    const result = await service.upsertChunks('building-1', 'announcement', 'ann-1', [
      { title: 'Τίτλος', body: 'Σώμα' },
    ]);

    expect(result).toMatchObject({ ok: true, embedded: 0, skipped: 1, deleted: 1 });
    expect(prisma.embeddingChunk.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['chunk-stale'] } },
    });
  });

  it('returns ok:false when the embed endpoint is down (no insert)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    const service = new EmbeddingsService(prisma as never);

    const result = await service.upsertChunks('building-1', 'faq', 'faq:x', [
      { title: 'Τ', body: 'Σ' },
    ]);

    expect(result.ok).toBe(false);
    expect(
      prisma.$executeRawUnsafe.mock.calls.some((call) => String(call[0]).includes('INSERT')),
    ).toBe(false);
  });

  it('search filters by buildingId parameter and maps scores', async () => {
    const service = new EmbeddingsService(prisma as never);
    stubEmbedder(service);
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        sourceType: 'announcement',
        sourceId: 'ann-9',
        title: 'Συνέλευση',
        body: 'Η ετήσια συνέλευση.',
        embedding: '[0.1,0.2]',
        score: '0.873',
      },
    ]);

    const results = await service.search('building-7', 'πότε είναι η συνέλευση;', 3);

    expect(results[0]).toMatchObject({
      sourceId: 'ann-9',
      score: 0.873,
    });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"buildingId" = $1'),
      'building-7',
      expect.stringMatching(/^\[[-0-9.,]+\]$/),
      3,
    );
  });
});
