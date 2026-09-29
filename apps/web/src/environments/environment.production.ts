export const environment = {
  production: true,
  apiUrl: '/api',
  pushPublicKey: '',
  sentryDsn: '',
  /** PostHog project API key (phk_…); empty = analytics fully disabled. */
  analyticsKey: '',
  /** PostHog host, e.g. https://eu.i.posthog.com; empty falls back to EU host. */
  analyticsHost: '',
} as const;
