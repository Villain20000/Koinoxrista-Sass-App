import { ThrottlerExceptionLike } from './throttle.types';
import { LoginLockoutService } from './login-lockout.service';
import { LOGIN_LOCKOUT_TTL_MS } from './throttle.config';

describe('LoginLockoutService', () => {
  let service: LoginLockoutService;
  const now = () => Date.now();

  beforeEach(() => {
    service = new LoginLockoutService();
  });

  it('allows attempts below the threshold', () => {
    expect(service.isLocked('a@b.gr')).toBe(false);
    for (let i = 0; i < 4; i++) {
      const res = service.recordFailure('a@b.gr', now() + i);
      expect(res.locked).toBe(false);
    }
    expect(() => service.assertOpen('a@b.gr')).not.toThrow();
  });

  it('locks after the threshold and throws 423', () => {
    for (let i = 0; i < 5; i++) service.recordFailure('a@b.gr', now() + i);
    expect(service.isLocked('a@b.gr')).toBe(true);
    expect(() => service.assertOpen('a@b.gr')).toThrow(ThrottlerExceptionLike);
  });

  it('resets the counter on success', () => {
    for (let i = 0; i < 2; i++) service.recordFailure('a@b.gr', now() + i);
    service.reset('a@b.gr');
    expect(service.isLocked('a@b.gr')).toBe(false);
    for (let i = 0; i < 5; i++) service.recordFailure('a@b.gr', now() + i);
    expect(service.isLocked('a@b.gr')).toBe(true);
  });

  it('unlocks automatically after the TTL window', () => {
    const start = now();
    for (let i = 0; i < 5; i++) service.recordFailure('a@b.gr', start + i);
    expect(service.isLocked('a@b.gr', start)).toBe(true);
    // lockedUntil = lastFailure(start+4) + TTL, so test just past that.
    expect(service.isLocked('a@b.gr', start + LOGIN_LOCKOUT_TTL_MS + 10)).toBe(false);
  });

  it('is case-insensitive on the key', () => {
    service.recordFailure('A@B.GR', now());
    expect(service.isLocked('a@b.gr')).toBe(false); // only 1 failure
    for (let i = 0; i < 4; i++) service.recordFailure('a@b.gr', now() + i);
    expect(service.isLocked('A@B.GR')).toBe(true);
  });
});