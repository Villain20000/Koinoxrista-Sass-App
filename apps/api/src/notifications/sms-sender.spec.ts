import {
  ConsoleSmsSender,
  createSmsSenderFromEnv,
  HttpSmsSender,
} from './sms-sender';

const ENV_KEYS = ['SMS_MODE', 'SMS_HTTP_URL', 'SMS_HTTP_AUTH'];

describe('createSmsSenderFromEnv', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (original[key] !== undefined) {
        process.env[key] = original[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('defaults to the console driver when SMS_MODE is unset', () => {
    expect(createSmsSenderFromEnv()).toBeInstanceOf(ConsoleSmsSender);
  });

  it('selects the HTTP driver only when mode is http and a URL is configured', () => {
    process.env.SMS_MODE = 'http';
    expect(createSmsSenderFromEnv()).toBeInstanceOf(ConsoleSmsSender);

    process.env.SMS_HTTP_URL = 'https://sms.example.gr/send';
    expect(createSmsSenderFromEnv()).toBeInstanceOf(HttpSmsSender);

    process.env.SMS_MODE = 'console';
    expect(createSmsSenderFromEnv()).toBeInstanceOf(ConsoleSmsSender);
  });

  it('reads an explicit env object without touching process.env', () => {
    const sender = createSmsSenderFromEnv({
      SMS_MODE: 'http',
      SMS_HTTP_URL: 'https://gw.example.gr/{{to}}',
      SMS_HTTP_AUTH: 'Bearer tok',
    });
    expect(sender).toBeInstanceOf(HttpSmsSender);
  });
});

describe('ConsoleSmsSender', () => {
  it('logs one structured line per message', async () => {
    const logger = { log: jest.fn() };
    const sender = new ConsoleSmsSender();
    (sender as unknown as { logger: unknown }).logger = logger;

    const result = await sender.send('+306912345678', 'Γεια σου');

    expect(result).toEqual({ ok: true });
    expect(logger.log).toHaveBeenCalledTimes(1);
    const line = String(logger.log.mock.calls[0][0]);
    expect(line).toContain('SMS → +306912345678');
    expect(line).toContain('Γεια σου');
  });
});

describe('HttpSmsSender', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts JSON to the gateway and returns ok with the provider id', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg-42' }), { status: 200 }),
    );
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
    const sender = new HttpSmsSender({
      urlTemplate: 'https://sms.example.gr/send',
      authHeader: 'Bearer tok-1',
    });

    const result = await sender.send('+306912345678', 'Καλημέρα');

    expect(result).toEqual({ ok: true, providerId: 'msg-42' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sms.example.gr/send');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      to: '+306912345678',
      text: 'Καλημέρα',
    });
  });

  it('substitutes URL-template placeholders with encoded values', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
    const sender = new HttpSmsSender({
      urlTemplate: 'https://sms.example.gr/{to}/messages?body={text}',
    });

    const result = await sender.send('+30 691 234', 'κείμενο&περισσότερο');

    expect(result).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://sms.example.gr/${encodeURIComponent('+30 691 234')}/messages?body=${encodeURIComponent('κείμενο&περισσότερο')}`,
    );
  });

  it('reports non-ok gateway responses as failures', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 401 }));
    const sender = new HttpSmsSender({ urlTemplate: 'https://sms.example.gr' });

    const result = await sender.send('+306900000000', 'text');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
    expect(result.providerId).toBeUndefined();
  });

  it('survives network errors and unparseable bodies', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
    const sender = new HttpSmsSender({ urlTemplate: 'https://sms.example.gr' });

    await expect(sender.send('+306900000000', 't')).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('ECONNREFUSED'),
    });
    await expect(sender.send('+306900000000', 't')).resolves.toEqual({
      ok: true,
    });
  });
});
