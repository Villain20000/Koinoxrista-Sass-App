// Deterministic JWT secrets for unit tests (imported by every auth spec
// before any token signing/verification happens).
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret';

export {};
