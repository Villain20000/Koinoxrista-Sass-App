import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { SubscriptionsController } from './subscriptions.controller';
import type { SubscriptionsService } from './subscriptions.service';

const user = (buildingId: string | null): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId,
});

function makeService(): jest.Mocked<SubscriptionsService> {
  return {
    getOrCreate: jest.fn().mockResolvedValue({ id: 'sub-1', tier: 'BASIC' }),
    changeTier: jest.fn().mockResolvedValue({ id: 'sub-1', tier: 'PRO' }),
    activatePeriod: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    cancel: jest.fn().mockResolvedValue({ status: 'CANCELLED' }),
    features: jest.fn().mockResolvedValue({ voting: false }),
  } as unknown as jest.Mocked<SubscriptionsService>;
}

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;
  let service: jest.Mocked<SubscriptionsService>;

  beforeEach(() => {
    service = makeService();
    controller = new SubscriptionsController(service);
  });

  it('scopes every endpoint to the admin building', async () => {
    const dto = { tier: 'PRO' as const, billingCycle: 'MONTHLY' as const };

    const admin = user('b1');
    await controller.mine(admin);
    await controller.changeTier(dto, admin);
    await controller.activate(null, admin);
    await controller.cancel(admin);
    await controller.features(admin);

    expect(service.getOrCreate).toHaveBeenCalledWith('b1');
    expect(service.changeTier).toHaveBeenCalledWith('b1', dto, admin);
    expect(service.activatePeriod).toHaveBeenCalledWith('b1', undefined);
    expect(service.cancel).toHaveBeenCalledWith('b1');
    expect(service.features).toHaveBeenCalledWith('b1');
  });

  it('refuses admins without a building link', () => {
    expect(() => controller.mine(user(null))).toThrow(ForbiddenException);
    expect(() => controller.features(user(null))).toThrow(ForbiddenException);
    expect(service.getOrCreate).not.toHaveBeenCalled();
  });
});
