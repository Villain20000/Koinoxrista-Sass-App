import { firstValueFrom, toArray } from 'rxjs';

import { RealtimeService } from './realtime.service';

describe('RealtimeService', () => {
  let service: RealtimeService;

  beforeEach(() => {
    service = new RealtimeService();
  });

  it('delivers published events to a subscriber on the same channel', async () => {
    const received = firstValueFrom(
      service
        .subscribe('user:u1', 'u1')
        .pipe(toArray()),
    );
    service.publishToUser('u1', 'notification.created', { title: 'Γεια' });
    service.disconnect('u1');
    await expect(received).resolves.toEqual([
      { type: 'notification.created', data: { title: 'Γεια' } },
    ]);
  });

  it('routes building events only to that building channel', async () => {
    const received = firstValueFrom(
      service
        .subscribe('building:b1', 'u1')
        .pipe(toArray()),
    );
    // Wrong building — must not leak.
    service.publishToBuilding('b2', 'vote.updated', { voteId: 'v9' });
    service.publishToBuilding('b1', 'vote.updated', { voteId: 'v1' });
    service.disconnect('u1');
    await expect(received).resolves.toEqual([
      { type: 'vote.updated', data: { voteId: 'v1' } },
    ]);
  });

  it('does not deliver after disconnect', async () => {
    const received: unknown[] = [];
    service
      .subscribe('user:u1', 'u1')
      .subscribe((event) => received.push(event));
    service.publishToUser('u1', 'a', 1);
    service.disconnect('u1');
    service.publishToUser('u1', 'b', 2);
    expect(received).toEqual([{ type: 'a', data: 1 }]);
  });

  it('publish to an empty channel is a no-op', () => {
    expect(() => service.publishToBuilding('b-none', 'x', {})).not.toThrow();
  });

  it('exposes channel key helpers', () => {
    expect(RealtimeService.userChannel('u1')).toBe('user:u1');
    expect(RealtimeService.buildingChannel('b1')).toBe('building:b1');
  });
});
