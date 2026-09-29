import { AssemblyService } from './assembly.service';

function makePrisma(vote: any, agenda: any[], units: any[], attendance: any[], ballots: any[]) {
  return {
    vote: { findUnique: jest.fn().mockResolvedValue(vote) },
    agendaItem: { findMany: jest.fn().mockResolvedValue(agenda) },
    unit: { findMany: jest.fn().mockResolvedValue(units) },
    attendance: { findMany: jest.fn().mockResolvedValue(attendance) },
    ballot: { findMany: jest.fn().mockResolvedValue(ballots) },
    agendaItem_aggregate: jest.fn(),
  };
}

const user = { id: 'u1', buildingId: 'b1', role: 'ADMIN' } as any;

describe('AssemblyService.draftPraktiko (Greek local AI)', () => {
  it('returns structured praktiko + LLM draft with disclaimer', async () => {
    const vote = {
      id: 'v1',
      buildingId: 'b1',
      topic: 'Επισκευή ταράτσας',
      description: null,
      thresholdType: 'MILLIMES_MAJORITY',
      opensAt: new Date('2026-08-01'),
      closesAt: new Date('2026-08-02'),
      result: null,
      building: { id: 'b1', name: 'Πολυκατοικία', address: 'Εγνατία 12', city: 'Thessaloniki' },
    };
    const prisma = {
      vote: { findUnique: jest.fn().mockResolvedValue(vote) },
      agendaItem: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', position: 1, title: 'Έγκριση προϋπολογισμού', body: null }]) },
      unit: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', millimes: 500, label: 'A1' }, { id: 'u2', millimes: 500, label: 'A2' }]) },
      attendance: { findMany: jest.fn().mockResolvedValue([{ unitId: 'u1', present: true }, { unitId: 'u2', present: true }]) },
      ballot: { findMany: jest.fn().mockResolvedValue([{ unitId: 'u1', choice: 'yes' }, { unitId: 'u2', choice: 'no' }]) },
    };
    const llm = { name: 'test', complete: jest.fn().mockResolvedValue('ΣΧΕΔΙΟ ΠΡΑΚΤΙΚΟΥ — TEST') };
    const svc = new AssemblyService(prisma as any, { record: jest.fn() } as any, { publishToBuilding: jest.fn() } as any, llm as any);
    const res = await svc.draftPraktiko('v1', user);
    expect(res.praktiko.vote.topic).toBe('Επισκευή ταράτσας');
    expect(res.draft).toBe('ΣΧΕΔΙΟ ΠΡΑΚΤΙΚΟΥ — TEST');
    expect(res.disclaimer).toContain('δεν αποτελεί');
    expect(llm.complete).toHaveBeenCalled();
  });

  it('falls back to deterministic template when LLM fails', async () => {
    const vote = {
      id: 'v1',
      buildingId: 'b1',
      topic: 'Καθαριότητα',
      description: null,
      thresholdType: 'HEADCOUNT',
      opensAt: new Date('2026-08-01'),
      closesAt: new Date('2026-08-02'),
      result: null,
      building: { id: 'b1', name: 'Κτίριο', address: 'Οδός', city: 'Athens' },
    };
    const prisma = {
      vote: { findUnique: jest.fn().mockResolvedValue(vote) },
      agendaItem: { findMany: jest.fn().mockResolvedValue([]) },
      unit: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', millimes: 500, label: 'A1' }]) },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      ballot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const llm = { name: 'console', complete: jest.fn().mockRejectedValue(new Error('down')) };
    const svc = new AssemblyService(prisma as any, { record: jest.fn() } as any, { publishToBuilding: jest.fn() } as any, llm as any);
    const res = await svc.draftPraktiko('v1', user);
    expect(res.draft).toContain('ΠΡΑΚΤΙΚΟ ΓΕΝΙΚΗΣ ΣΥΝΕΛΕΥΣΗΣ');
    expect(res.draft).toContain('Καθαριότητα');
  });
});
