import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * Real-time event pushed over the SSE stream. `channel` routes the event:
 *  - `user:{userId}`        — personal events (notifications)
 *  - `building:{buildingId}` — shared events (vote tallies, announcements,
 *    assembly quorum) visible to every connected member of the building.
 */
export interface RealtimeEvent<T = unknown> {
  type: string;
  data: T;
}

interface ChannelSubscriber {
  userId: string;
  channel: string;
  subject: Subject<RealtimeEvent>;
}

/**
 * In-memory pub/sub hub backing the /realtime/events SSE stream.
 *
 * One `Subject` per (connection, channel) pair; the hub tracks them in a Map
 * so a disconnected user can drop every subject they own in one call. Events
 * are delivered synchronously to currently-connected clients only — the DB
 * remains the source of truth for late joiners (the UI refetches on mount).
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  /** channel -> subscribers (userId + subject). */
  private readonly byChannel = new Map<string, ChannelSubscriber[]>();

  static userChannel(userId: string): string {
    return `user:${userId}`;
  }

  static buildingChannel(buildingId: string): string {
    return `building:${buildingId}`;
  }

  /** Subscribe to a channel; returns an observable of future events. */
  subscribe(channel: string, userId: string): Observable<RealtimeEvent> {
    const subject = new Subject<RealtimeEvent>();
    const entry: ChannelSubscriber = { userId, channel, subject };
    const list = this.byChannel.get(channel) ?? [];
    list.push(entry);
    this.byChannel.set(channel, list);
    return subject.asObservable();
  }

  /** Unsubscribe every channel the user is connected to (SSE close). */
  disconnect(userId: string): void {
    let removed = 0;
    for (const [channel, list] of this.byChannel) {
      const kept = list.filter((sub) => {
        if (sub.userId !== userId) return true;
        sub.subject.complete();
        removed += 1;
        return false;
      });
      if (kept.length === 0) this.byChannel.delete(channel);
      else this.byChannel.set(channel, kept);
    }
    if (removed > 0) {
      this.logger.debug(`realtime: dropped ${removed} subscription(s) for ${userId}`);
    }
  }

  /** Push an event to one channel (user-scoped or building-scoped). */
  publish<T>(channel: string, type: string, data: T): void {
    const subs = this.byChannel.get(channel);
    if (!subs || subs.length === 0) return;
    for (const sub of subs) {
      sub.subject.next({ type, data });
    }
  }

  /** Convenience: push to a user's personal channel. */
  publishToUser<T>(userId: string, type: string, data: T): void {
    this.publish(RealtimeService.userChannel(userId), type, data);
  }

  /** Convenience: push to every connected member of a building. */
  publishToBuilding<T>(buildingId: string, type: string, data: T): void {
    this.publish(RealtimeService.buildingChannel(buildingId), type, data);
  }

  /**
   * Merge several channels into one observable (the SSE handler subscribes to
   * the user channel plus the active building channel).
   */
  merge(
    channels: Array<Observable<RealtimeEvent>>,
  ): Observable<RealtimeEvent> {
    // No channels (not logged in) — emit nothing forever.
    if (channels.length === 0) return new Observable<RealtimeEvent>();
    return new Observable<RealtimeEvent>((observer) => {
      const subs = channels.map((ch) =>
        ch.pipe(filter(() => true)).subscribe(observer),
      );
      return () => subs.forEach((s) => s.unsubscribe());
    });
  }
}
