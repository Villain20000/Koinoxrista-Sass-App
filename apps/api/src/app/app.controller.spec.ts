import { PrismaService } from '../prisma/prisma.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';

function makePrisma() {
  return { $queryRaw: jest.fn() };
}

describe('AppController GET /health', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let controller: AppController;

  beforeEach(() => {
    prisma = makePrisma();
    const service = new AppService(prisma as unknown as PrismaService);
    controller = new AppController(service);
  });

  it('reports ok with db up', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const report = await controller.health();

    expect(report.db).toBe('up');
    expect(report.status).toBe('ok');
    expect(typeof report.uptimeSeconds).toBe('number');
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof report.version).toBe('string');
    expect(report.version.length).toBeGreaterThan(0);
  });

  it('degrades to status "degraded" (still answering) when the DB is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const report = await controller.health();

    expect(report.db).toBe('down');
    expect(report.status).toBe('degraded');
  });
});
