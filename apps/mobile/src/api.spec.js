import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

// Native/Expo modules are not resolvable in a plain Node test environment, so
// mock them by name. vi.mock factories bypass real module resolution entirely,
// so the packages do not need to be installed.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    multiRemove: vi.fn(),
  },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'https://test.example.com/api' } } },
}));

const BASE_URL = 'https://test.example.com/api';
const storage = AsyncStorage;

/** Build a minimal fetch Response-like object the client can consume. */
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Return the URL and RequestInit captured by the (single) fetch call. */
function lastRequest(fetchMock) {
  const [url, init] = fetchMock.mock.calls.at(-1);
  return { url, init };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('mobile api client', () => {
  it('attaches the bearer token when one is stored', async () => {
    storage.getItem.mockResolvedValue('jwt-token');
    globalThis.fetch.mockResolvedValue(jsonResponse(200, { ok: true }));

    await api.invoices();

    const { url, init } = lastRequest(globalThis.fetch);
    expect(url).toBe(`${BASE_URL}/invoices/mine`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
  });

  it('omits the Authorization header when no token is stored', async () => {
    storage.getItem.mockResolvedValue(null);
    globalThis.fetch.mockResolvedValue(jsonResponse(200, { ok: true }));

    await api.invoices();

    const { init } = lastRequest(globalThis.fetch);
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('sends login credentials as a JSON POST to /auth/login', async () => {
    storage.getItem.mockResolvedValue(null);
    globalThis.fetch.mockResolvedValue(
      jsonResponse(200, { token: 'jwt', user: { id: 'u1' } }),
    );

    const res = await api.login({ email: 'a@b.gr', password: 'pw' });

    expect(res).toEqual({ token: 'jwt', user: { id: 'u1' } });
    const { url, init } = lastRequest(globalThis.fetch);
    expect(url).toBe(`${BASE_URL}/auth/login`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.gr', password: 'pw' });
  });

  it('returns the parsed JSON body on success', async () => {
    storage.getItem.mockResolvedValue(null);
    globalThis.fetch.mockResolvedValue(jsonResponse(200, { items: [1, 2] }));

    await expect(api.announcements()).resolves.toEqual({ items: [1, 2] });
  });

  it('throws the server-provided message on an error response', async () => {
    storage.getItem.mockResolvedValue(null);
    globalThis.fetch.mockResolvedValue(
      jsonResponse(401, { message: 'Invalid credentials.' }),
    );

    await expect(api.login({})).rejects.toThrow('Invalid credentials.');
  });

  it('falls back to a status-based message when the body is not JSON', async () => {
    storage.getItem.mockResolvedValue(null);
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(api.invoices()).rejects.toThrow(
      'Request failed: 503',
    );
  });

  it('surfaces the HTTP status code on the thrown error', async () => {
    storage.getItem.mockResolvedValue(null);
    globalThis.fetch.mockResolvedValue(
      jsonResponse(500, { message: 'boom' }),
    );

    try {
      await api.invoices();
      expect.unreachable();
    } catch (e) {
      expect(e.message).toBe('boom');
      expect(e.status).toBe(500);
    }
  });
});