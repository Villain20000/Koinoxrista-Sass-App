import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MyDataController } from './mydata.controller';
import type { MyDataService } from './mydata.service';

const admin = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
  ...overrides,
});

function makeService() {
  return {
    generateForPeriod: jest.fn().mockResolvedValue({ created: 1, skipped: 0 }),
    listForPeriod: jest.fn().mockResolvedValue([]),
    xmlForPeriod: jest.fn().mockResolvedValue({
      body: '<InvoicesDoc></InvoicesDoc>',
      contentType: 'text/xml;charset=utf-8',
      filename: 'mydata-2026-07.xml',
    }),
    reconcile: jest
      .fn()
      .mockResolvedValue({ checked: 2, accepted: 1, rejected: 1 }),
  };
}

describe('MyDataController', () => {
  let service: ReturnType<typeof makeService>;
  let controller: MyDataController;
  const res = { setHeader: jest.fn() };

  beforeEach(() => {
    service = makeService();
    controller = new MyDataController(service as unknown as MyDataService);
  });

  it('is ADMIN-only with auth guards wired', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      MyDataController,
    ) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);

    for (const handler of [
      controller.generate,
      controller.list,
      controller.xml,
      controller.reconcile,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([Role.ADMIN]);
    }
  });

  it('scopes generate/list/xml/reconcile to the admin building', async () => {
    await controller.generate({ periodYearMonth: '2026-07' }, admin());
    await controller.list('2026-07', admin());
    await controller.xml('2026-07', admin(), res);
    await expect(
      controller.reconcile({ periodYearMonth: '2026-07' }, admin()),
    ).resolves.toEqual({ checked: 2, accepted: 1, rejected: 1 });

    expect(service.generateForPeriod).toHaveBeenCalledWith(
      'building-1',
      '2026-07',
    );
    expect(service.listForPeriod).toHaveBeenCalledWith('building-1', '2026-07');
    expect(service.xmlForPeriod).toHaveBeenCalledWith('building-1', '2026-07');
    expect(service.reconcile).toHaveBeenCalledWith('building-1', '2026-07');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="mydata-2026-07.xml"',
    );
  });

  it('forbids users without a building tenant', async () => {
    const floating = admin({ buildingId: null });
    expect(() =>
      controller.generate({ periodYearMonth: '2026-07' }, floating),
    ).toThrow(ForbiddenException);
    expect(() => controller.list(undefined, floating)).toThrow(
      ForbiddenException,
    );
    await expect(controller.xml(undefined, floating, res)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
