/**
 * Global and per-route rate-limit budgets (Feature 12).
 *
 * All limits are expressed as requests-per-TTL-ms and can be overridden with
 * env vars for deployment-specific tuning without a code change.
 */
export const throttleDefaults = {
  globalLimit: Number(process.env.THROTTLE_LIMIT ?? 100),
  globalTtlMs: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
  authLimit: 10,
  authTtlMs: 60_000,
};

/** Per-route named budgets applied via `@Throttle({ default: {...} })`. */
export const routes = {
  login: {
    limit: Number(process.env.RATE_LOGIN_LIMIT ?? 5),
    ttlMs: Number(process.env.RATE_LOGIN_TTL_MS ?? 15 * 60 * 1000), // 5 / 15 min / IP
  },
  register: {
    limit: Number(process.env.RATE_REGISTER_LIMIT ?? 3),
    ttlMs: Number(process.env.RATE_REGISTER_TTL_MS ?? 60 * 60 * 1000), // 3 / hour / IP
  },
  checkout: {
    limit: Number(process.env.RATE_CHECKOUT_LIMIT ?? 10),
    ttlMs: Number(process.env.RATE_CHECKOUT_TTL_MS ?? 60_000), // 10 / min / user
  },
  webhook: {
    limit: Number(process.env.RATE_WEBHOOK_LIMIT ?? 100),
    ttlMs: Number(process.env.RATE_WEBHOOK_TTL_MS ?? 60_000), // 100 / min (PSP origin)
  },
  publicApi: {
    limit: Number(process.env.RATE_PUBLIC_API_LIMIT ?? 60),
    ttlMs: Number(process.env.RATE_PUBLIC_API_TTL_MS ?? 60_000), // 60 / min / key
  },
} as const;

/** Number of consecutive failed logins that triggers a lockout. */
export const LOGIN_LOCKOUT_THRESHOLD = 5;
/** Lockout window in ms (sliding). */
export const LOGIN_LOCKOUT_TTL_MS = 15 * 60 * 1000;