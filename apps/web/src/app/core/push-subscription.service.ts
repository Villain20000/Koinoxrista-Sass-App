import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

interface PushSubscriptionJson {
  endpoint?: string | null;
  keys?: { p256dh?: string; auth?: string };
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

@Injectable({ providedIn: 'root' })
export class PushSubscriptionService {
  private readonly http = inject(HttpClient);

  readonly isEnabled = signal(false);

  async enable(): Promise<void> {
    try {
      if (!environment.pushPublicKey) return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(environment.pushPublicKey),
        }));
      const json = subscription.toJSON() as PushSubscriptionJson;
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/push/subscriptions`, {
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
        }),
      );
      this.isEnabled.set(true);
    } catch (err) {
      console.warn('[push] subscription failed', err);
    }
  }

  async disable(): Promise<void> {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      await firstValueFrom(
        this.http.delete(`${environment.apiUrl}/push/subscriptions`, {
          body: { endpoint: subscription.endpoint },
        }),
      );
      await subscription.unsubscribe();
      this.isEnabled.set(false);
    } catch (err) {
      console.warn('[push] unsubscription failed', err);
    }
  }
}
