import { describe, beforeEach, expect, it, vi } from 'vitest';
import {
  ANONYMOUS_DISTINCT_ID,
  AnalyticsService,
} from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let sendBeacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    service = new AnalyticsService();
    service.apiKey = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a full no-op when no key is configured (default env)', () => {
    service.capture('login_success');
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(service.enabled()).toBe(false);
  });

  it('becomes enabled only via a configured key', () => {
    service.apiKey = 'phk_test';
    expect(service.enabled()).toBe(true);
  });

  it('posts a beacon with the PostHog capture payload shape when enabled', () => {
    service.apiKey = 'phk_test';
    service.host = 'https://eu.i.posthog.com';
    service.identify('user-42');

    service.capture('vote_cast', { voteId: 'v-1' });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, raw0] = sendBeacon.mock.calls[0] as [string, string];
    expect(url).toBe('https://eu.i.posthog.com/capture/');
    return Promise.resolve(raw0).then((raw) => {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      expect(payload['api_key']).toBe('phk_test');
      expect(payload['event']).toBe('vote_cast');
      expect(payload['distinct_id']).toBe('user-42');
      expect(typeof payload['timestamp']).toBe('string');
      const props = payload['properties'] as Record<string, unknown>;
      expect(props['voteId']).toBe('v-1');
      // $set identity is attached exactly once per page load.
      expect(payload['$set']).toBeDefined();
    });
  });

  it('falls back to an anonymous distinct id and sends $set once', async () => {
    service.apiKey = 'phk_test';

    service.capture('plan_viewed');
    service.capture('invoice_pay_started');

    const first = JSON.parse(sendBeacon.mock.calls[0][1] as string) as Record<
      string,
      unknown
    >;
    const second = JSON.parse(sendBeacon.mock.calls[1][1] as string) as Record<
      string,
      unknown
    >;

    expect(first['distinct_id']).toBe(ANONYMOUS_DISTINCT_ID);
    expect(second['distinct_id']).toBe(ANONYMOUS_DISTINCT_ID);
    expect(first['$set']).toBeDefined();
    expect(second['$set']).toBeUndefined();
  });
});
