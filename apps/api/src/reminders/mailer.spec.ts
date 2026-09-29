import { ConsoleMailer, createMailer, ResendMailer } from './mailer';

describe('ConsoleMailer', () => {
  it('logs the recipient, subject and body', async () => {
    const logger = { log: jest.fn() };
    const mailer = new ConsoleMailer();
    (mailer as unknown as { logger: unknown }).logger = logger;

    await mailer.send(['a@x.gr', 'b@x.gr'], 'Γεια', '<p>Γεια</p>');

    expect(logger.log).toHaveBeenCalledTimes(1);
    const message = logger.log.mock.calls[0][0] as string;
    expect(message).toContain('a@x.gr, b@x.gr');
    expect(message).toContain('Γεια');
    expect(message).toContain('<p>Γεια</p>');
  });

  it('accepts a single recipient string', async () => {
    const logger = { log: jest.fn() };
    const mailer = new ConsoleMailer();
    (mailer as unknown as { logger: unknown }).logger = logger;

    await mailer.send('a@x.gr', 'Θέμα', 'Σώμα');

    expect(logger.log.mock.calls[0][0]).toContain('a@x.gr');
  });
});

describe('ResendMailer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the payload to the Resend API with a bearer token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);

    const mailer = new ResendMailer('key-1', 'Koinos <no-reply@koinos.gr>');
    await mailer.send('a@x.gr', 'Θέμα', '<p>1</p>');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer key-1',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      from: 'Koinos <no-reply@koinos.gr>',
      to: 'a@x.gr',
      subject: 'Θέμα',
      html: '<p>1</p>',
    });
  });

  it('throws when the Resend API responds with an error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 422 }));

    const mailer = new ResendMailer('key-1', 'from');
    await expect(mailer.send('a@x.gr', 'Θέμα', '')).rejects.toThrow(
      /Resend send failed \(422\)/,
    );
  });
});

describe('createMailer', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('falls back to ConsoleMailer without RESEND_API_KEY', () => {
    expect(createMailer()).toBeInstanceOf(ConsoleMailer);
  });

  it('uses ResendMailer when RESEND_API_KEY is set', () => {
    process.env.RESEND_API_KEY = 'key';
    expect(createMailer()).toBeInstanceOf(ResendMailer);
  });
});
