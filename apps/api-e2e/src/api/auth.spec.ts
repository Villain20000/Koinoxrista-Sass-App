import axios from 'axios';

import {
  SEED_ADMIN,
  SEED_RESIDENT,
  login,
  adminHeaders,
  closePrisma,
} from './helpers';

describe('auth', () => {
  afterAll(async () => {
    await closePrisma();
  });

  it('logs in as the seeded admin and returns an access token', async () => {
    const res = await axios.post('/api/auth/login', {
      email: SEED_ADMIN.email,
      password: SEED_ADMIN.password,
    });
    expect(res.status).toBe(200);
    expect(typeof res.data.accessToken).toBe('string');
    expect(res.data.accessToken.length).toBeGreaterThan(20);
  });

  it('rejects bad credentials with 401', async () => {
    await expect(
      axios.post('/api/auth/login', {
        email: SEED_ADMIN.email,
        password: 'wrong-password',
      }),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });

  it('returns the current user with role and memberships', async () => {
    const res = await axios.get('/api/auth/me', {
      headers: await adminHeaders(),
    });
    expect(res.data.email).toBe(SEED_ADMIN.email);
    expect(res.data.role).toBe('ADMIN');
    expect(Array.isArray(res.data.memberships)).toBe(true);
  });

  it('refreshes the access token via the refresh cookie', async () => {
    const loginRes = await axios.post('/api/auth/login', {
      email: SEED_RESIDENT.email,
      password: SEED_RESIDENT.password,
    });
    const setCookie = loginRes.headers['set-cookie'] as unknown as
      | string[]
      | undefined;
    expect(Array.isArray(setCookie)).toBe(true);

    const refreshCookie = (setCookie ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');
    const refreshRes = await axios.post(
      '/api/auth/refresh',
      {},
      { headers: { Cookie: refreshCookie } },
    );
    expect(refreshRes.status).toBe(200);
    expect(typeof refreshRes.data.accessToken).toBe('string');
  });

  it('rejects unauthenticated access to a guarded route', async () => {
    await expect(axios.get('/api/buildings/mine')).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  it('returns the resident profile with their active building', async () => {
    const token = await login(SEED_RESIDENT.email, SEED_RESIDENT.password);
    const res = await axios.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.data.role).toBe('RESIDENT');
    expect(res.data.buildingId).toBeTruthy();
    expect(Array.isArray(res.data.memberships)).toBe(true);
  });
});
