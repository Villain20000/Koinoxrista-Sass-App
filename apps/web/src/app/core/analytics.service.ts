import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export const DEFAULT_ANALYTICS_HOST = 'https://eu.i.posthog.com';
export const ANONYMOUS_DISTINCT_ID = 'anonymous';

/**
 * Zero-dependency funnel analytics. Events are posted with
 * navigator.sendBeacon to a PostHog-compatible /capture/ endpoint.
 *
 * Fully disabled (every capture call is a no-op) unless
 * `environment.analyticsKey` is non-empty — the app never ships with a key.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  /** Test/ops seam: overridable so specs can enable capture without env swaps. */
  apiKey: string = environment.analyticsKey;
  host: string = environment.analyticsHost || DEFAULT_ANALYTICS_HOST;

  private distinctId: string | null = null;
  /** Person properties ($set) are attached once per page load, then never again. */
  private identitySent = false;

  enabled(): boolean {
    return this.apiKey.trim().length > 0;
  }

  /** Attributes subsequent events to the signed-in user id. */
  identify(userId: string): void {
    this.distinctId = userId;
  }

  capture(event: string, props?: Record<string, unknown>): void {
    if (!this.enabled()) return;
    const distinctId = this.distinctId ?? ANONYMOUS_DISTINCT_ID;
    const timestamp = new Date().toISOString();
    const payload: Record<string, unknown> = {
      api_key: this.apiKey,
      event,
      distinct_id: distinctId,
      timestamp,
      properties: { ...props, $lib: 'polykatoikiaos-web' },
    };
    if (!this.identitySent) {
      payload['$set'] = { polykatoikiaos_first_seen: timestamp };
      this.identitySent = true;
    }
    try {
      // A plain string keeps sendBeacon usable in every environment (jsdom
      // Blob.text() is unreliable); browsers serialize it identically.
      navigator.sendBeacon?.(`${this.host}/capture/`, JSON.stringify(payload));
    } catch {
      // Analytics must never break the UX.
    }
  }
}
