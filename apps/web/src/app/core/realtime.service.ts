import {
  Injectable,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface RealtimeEvent {
  type: string;
  data: unknown;
}

/** Callbacks keyed by event type; the layout and feature pages subscribe. */
type Handler = (data: never) => void;

/**
 * Thin EventSource wrapper for /api/realtime/events.
 *
 * - Opens a connection as soon as a user is signed in (the HttpOnly refresh
 *   cookie authenticates the stream — EventSource cannot set headers).
 * - Auto-reconnects on error/close with a capped backoff.
 * - Exposes `on(type, handler)` for typed subscription and `off(type, handler)`.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** True while a connection is open. */
  readonly connected = signal(false);

  private source: EventSource | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private retryDelay = 2_000;
  private disposed = false;

  constructor() {
    // (Re)open the stream on login; close it on logout. currentUser is a
    // signal, so react to it with an effect rather than a subscription.
    effect(() => {
      const user = this.auth.currentUser();
      if (user && !this.source) {
        this.connect();
      } else if (!user && this.source) {
        this.close();
      }
    });
  }

  on<T>(type: string, handler: (data: T) => void): void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(type, set);
  }

  off<T>(type: string, handler: (data: T) => void): void {
    this.handlers.get(type)?.delete(handler as Handler);
  }

  /** One-shot: resolve with the first event of `type` (used by tests). */
  once<T>(type: string, timeoutMs = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(type, handler);
        reject(new Error(`Realtime timeout waiting for ${type}`));
      }, timeoutMs);
      const handler = (data: T) => {
        clearTimeout(timer);
        this.off(type, handler);
        resolve(data);
      };
      this.on(type, handler);
    });
  }

  private connect(): void {
    if (this.source || this.disposed) return;
    const source = new EventSource(`${environment.apiUrl}/realtime/events`);
    this.source = source;
    this.connected.set(true);

    source.onmessage = () => {
      // Heartbeats arrive as unnamed messages; nothing to do.
    };

    source.addEventListener('notification.created', (event) =>
      this.dispatch('notification.created', event),
    );
    source.addEventListener('vote.updated', (event) =>
      this.dispatch('vote.updated', event),
    );
    source.addEventListener('vote.closed', (event) =>
      this.dispatch('vote.closed', event),
    );
    source.addEventListener('announcement.created', (event) =>
      this.dispatch('announcement.created', event),
    );
    source.addEventListener('assembly.attendance', (event) =>
      this.dispatch('assembly.attendance', event),
    );

    source.onerror = () => {
      this.connected.set(false);
      // EventSource auto-closes on error; schedule a reconnect with backoff.
      if (this.source === source) {
        this.source = null;
        const delay = this.retryDelay;
        this.retryDelay = Math.min(delay * 2, 30_000);
        if (!this.disposed) {
          setTimeout(() => {
            if (!this.source) this.connect();
          }, delay);
        }
      }
    };

    source.onopen = () => {
      this.retryDelay = 2_000;
      this.connected.set(true);
    };
  }

  private dispatch(type: string, event: MessageEvent): void {
    let data: unknown;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      data = event.data;
    }
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(data as never);
      } catch (err) {
        console.error(`realtime handler for ${type} failed`, err);
      }
    }
  }

  private close(): void {
    this.source?.close();
    this.source = null;
    this.connected.set(false);
  }
}
