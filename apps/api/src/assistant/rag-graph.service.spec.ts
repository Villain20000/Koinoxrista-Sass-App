import { RagGraphService, RAG_NO_ANSWER } from './rag-graph.service';
import { EmbeddingsService } from './embeddings.service';
import { PrismaService } from '../prisma/prisma.service';
import type { LlmProvider } from './llm-provider';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Role } from '@prisma/client';

const user: AuthenticatedUser = {
  id: 'u1',
  email: 'a@b.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

function makeEmbeddings(searchResults: unknown[]) {
  return {
    ensureReady: jest.fn().mockResolvedValue(true),
    search: jest.fn().mockResolvedValue(searchResults),
  } as unknown as EmbeddingsService;
}

function makeLlm(overrides: Partial<jest.Mocked<LlmProvider>> = {}): LlmProvider {
  const complete = jest.fn().mockResolvedValue('Απάντηση με πηγή: Διακοπή νερού.');
  return { name: 'fake', complete, ...overrides } as unknown as LlmProvider;
}

function makePrisma() {
  return {
    announcement: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

describe('RagGraphService', () => {
  it('answers from the graph when a document is relevant and cited', async () => {
    const embeddings = makeEmbeddings([
      { sourceType: 'announcement', sourceId: 'ann-1', title: 'Διακοπή νερού', body: 'Παρασκευή 09:00.', score: 0.9 },
    ]);
    const llm = makeLlm();
    const service = new RagGraphService(makePrisma(), embeddings, llm);

    const result = await service.query('building-1', 'πότε θα επιστρέψει το νερό;', user);

    expect(result.answer).toContain('Διακοπή νερού');
    expect(result.sources[0]).toEqual({ type: 'announcement', title: 'Διακοπή νερού' });
    expect(embeddings.search).toHaveBeenCalledWith('building-1', expect.any(String), 5);
  });

  it('rewrites once and still answers when scores are weak', async () => {
    const embeddings = makeEmbeddings([
      { sourceType: 'faq', sourceId: 'faq:x', title: 'Τρόποι πληρωμής', body: 'Κάρτα ή κατάθεση.', score: 0.5 },
    ]);
    // The canned answer must cite the actually-retrieved doc, or the guard
    // correctly forces the honest refusal.
    const llm = makeLlm({
      complete: jest.fn().mockResolvedValue('Η εξόφληση γίνεται όπως περιγράφεται στο: Τρόποι πληρωμής.'),
    });
    const service = new RagGraphService(makePrisma(), embeddings, llm);

    const result = await service.query('building-1', 'πώς πληρώνω το παράβολο;', user);

    // Weak score ⇒ one rewrite ⇒ retrieve ran twice before generating.
    expect(embeddings.search).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain('Τρόποι πληρωμής');
    expect(result.sources[0].type).toBe('faq');
  });

  it('returns the honest refusal when nothing is indexed for the building', async () => {
    const embeddings = makeEmbeddings([]);
    const llm = makeLlm();
    const service = new RagGraphService(makePrisma(), embeddings, llm);

    const result = await service.query('building-1', 'τι λέει ανακοίνωση;', user);

    expect(result.answer).toBe(RAG_NO_ANSWER);
    expect(result.sources).toEqual([]);
  });

  it('guard forces the refusal when the LLM answer cites nothing', async () => {
    const embeddings = makeEmbeddings([
      { sourceType: 'announcement', sourceId: 'ann-2', title: 'Συνέλευση 15/9', body: 'Στο λόμπι.', score: 0.9 },
    ]);
    const llm = makeLlm({ complete: jest.fn().mockResolvedValue('Το νερό θα έρθει αύριο σίγουρα.') });
    const service = new RagGraphService(makePrisma(), embeddings, llm);

    const result = await service.query('building-1', 'πότε θα επιστρέψει το νερό;', user);

    expect(result.answer).toBe(RAG_NO_ANSWER);
    expect(result.sources).toEqual([]);
  });

  it('falls back to keyword scoring when pgvector is not ready', async () => {
    const embeddings = {
      ensureReady: jest.fn().mockResolvedValue(false),
      search: jest.fn(),
    } as unknown as EmbeddingsService;
    const prisma = makePrisma();
    (prisma.announcement.findMany as jest.Mock).mockResolvedValue([
      { id: 'ann-1', buildingId: 'building-1', title: 'Διακοπή νερού', body: 'Την Παρασκευή.' },
    ]);
    const llm = makeLlm();
    const service = new RagGraphService(prisma, embeddings, llm);

    const result = await service.query('building-1', 'νερό;', user);

    expect(embeddings.search).not.toHaveBeenCalled();
    expect(result.answer).toContain('Διακοπή νερού');
    expect(result.sources[0]).toEqual({ type: 'announcement', title: 'Διακοπή νερού' });
  });

  it('falls back to keyword scoring when the graph throws', async () => {
    const embeddings = makeEmbeddings([{
      sourceType: 'announcement', sourceId: 'ann-1', title: 'Διακοπή νερού', body: 'x', score: 0.9,
    }]);
    (embeddings.search as jest.Mock).mockRejectedValue(new Error('boom'));
    const prisma = makePrisma();
    (prisma.announcement.findMany as jest.Mock).mockResolvedValue([
      { id: 'ann-1', buildingId: 'building-1', title: 'Διακοπή νερού', body: 'Την Παρασκευή.' },
    ]);
    const service = new RagGraphService(prisma, embeddings, makeLlm());

    const result = await service.query('building-1', 'νερό;', user);

    expect(result.answer).toContain('Διακοπή νερού');
  });

  it('rejects a foreign building before touching the graph', async () => {
    const embeddings = makeEmbeddings([]);
    const llm = makeLlm();
    const service = new RagGraphService(makePrisma(), embeddings, llm);

    await expect(
      service.query('building-9', 'νερό;', user),
    ).rejects.toThrow();
    expect(embeddings.search).not.toHaveBeenCalled();
  });
});
