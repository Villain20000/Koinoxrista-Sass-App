import { throttleDefaults } from './throttle.config';

describe('throttleDefaults', () => {
  const originalLimit = process.env.THROTTLE_LIMIT;
  const originalTtl = process.env.THROTTLE_TTL_MS;

  afterEach(() => {
    if (originalLimit === undefined) delete process.env.THROTTLE_LIMIT;
    else process.env.THROTTLE_LIMIT = originalLimit;
    if (originalTtl === undefined) delete process.env.THROTTLE_TTL_MS;
    else process.env.THROTTLE_TTL_MS = originalTtl;
    jest.resetModules();
  });

  it('falls back to 100 req / 60000 ms when env vars are unset', () => {
    jest.resetModules();
    jest.isolateModules(() => {
      delete process.env.THROTTLE_LIMIT;
      delete process.env.THROTTLE_TTL_MS;
      const { throttleDefaults: fresh } =
        require('./throttle.config') as typeof import('./throttle.config');
      expect(fresh.globalLimit).toBe(100);
      expect(fresh.globalTtlMs).toBe(60_000);
    });
  });

  it('parses env overrides as numbers', () => {
    process.env.THROTTLE_LIMIT = '250';
    process.env.THROTTLE_TTL_MS = '30000';
    jest.resetModules();
    jest.isolateModules(() => {
      const { throttleDefaults: fresh } =
        require('./throttle.config') as typeof import('./throttle.config');
      expect(fresh.globalLimit).toBe(250);
      expect(fresh.globalTtlMs).toBe(30_000);
    });
  });

  it('defaults auth budgets to 10 / min and login to 5 / 15 min', () => {
    expect(throttleDefaults.authLimit).toBe(10);
    expect(throttleDefaults.authTtlMs).toBe(60_000);
    jest.resetModules();
    jest.isolateModules(() => {
      delete process.env.RATE_LOGIN_LIMIT;
      delete process.env.RATE_LOGIN_TTL_MS;
      const { routes } =
        require('./throttle.config') as typeof import('./throttle.config');
      expect(routes.login.limit).toBe(5);
      expect(routes.login.ttlMs).toBe(15 * 60 * 1000);
    });
  });

  it('lets test environments raise login/auth budgets via env', () => {
    process.env.RATE_LOGIN_LIMIT = '1000';
    process.env.RATE_AUTH_LIMIT = '500';
    jest.resetModules();
    try {
      jest.isolateModules(() => {
        const fresh =
          require('./throttle.config') as typeof import('./throttle.config');
        expect(fresh.routes.login.limit).toBe(1000);
        expect(fresh.throttleDefaults.authLimit).toBe(500);
      });
    } finally {
      delete process.env.RATE_LOGIN_LIMIT;
      delete process.env.RATE_AUTH_LIMIT;
    }
  });
});
