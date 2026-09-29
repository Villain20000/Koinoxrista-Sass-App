import { bootstrapApplication } from '@angular/platform-browser';
import { Injector } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';
import { PushSubscriptionService } from './app/core/push-subscription.service';

if (environment.sentryDsn) {
  Sentry.init({
    dsn: environment.sentryDsn,
    tracesSampleRate: 0.1,
  });
}

bootstrapApplication(App, appConfig)
  .then((appRef) => {
    registerServiceWorker();
    void bootstrapPush(appRef.injector);
  })
  .catch((err) => {
    if (environment.sentryDsn) Sentry.captureException(err);
    console.error(err);
  });

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('[sw] registration failed', err);
    });
  });
}

async function bootstrapPush(injector: Injector): Promise<void> {
  try {
    // v1: attempted unconditionally after boot; API 401s for guests are harmless.
    await injector.get(PushSubscriptionService).enable();
  } catch (err) {
    console.warn('[push] init failed', err);
  }
}
