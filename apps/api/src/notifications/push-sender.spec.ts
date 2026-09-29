import {
  ConsolePushSender,
  createPushSender,
  WebPushSender,
} from './push-sender';

const ENV_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];

describe('createPushSender', () => {
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
      }
    }
  });

  it('selects the Web Push driver when both VAPID keys are configured', () => {
    process.env.VAPID_PUBLIC_KEY = 'B-public-key';
    process.env.VAPID_PRIVATE_KEY = 'private-key';

    expect(createPushSender()).toBeInstanceOf(WebPushSender);
  });

  it('falls back to the console driver when either VAPID key is missing', () => {
    expect(createPushSender()).toBeInstanceOf(ConsolePushSender);

    process.env.VAPID_PUBLIC_KEY = 'B-public-key';
    expect(createPushSender()).toBeInstanceOf(ConsolePushSender);

    delete process.env.VAPID_PUBLIC_KEY;
    process.env.VAPID_PRIVATE_KEY = 'private-key';
    expect(createPushSender()).toBeInstanceOf(ConsolePushSender);
  });
});
