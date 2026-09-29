import {
  Controller,
  Logger,
  Req,
  Res,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable, interval, map } from 'rxjs';

import { JWT_REFRESH_SECRET, REFRESH_COOKIE_NAME } from '../auth/auth.types';
import type { HttpRequest, HttpResponse } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealtimeEvent,
  RealtimeService,
} from './realtime.service';

const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events endpoint. EventSource cannot set Authorization headers,
 * so authentication reuses the HttpOnly refresh cookie (same-origin through
 * the web proxy) exactly like POST /auth/refresh does — no token rotation.
 *
 * The stream emits:
 *  - `heartbeat` events every 25s (keeps proxies from idling the socket)
 *  - user-scoped events: `notification.created`
 *  - building-scoped events: `vote.updated`, `vote.closed`,
 *    `announcement.created`, `assembly.attendance`
 */
@Controller('realtime')
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse('events')
  async events(
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<Observable<MessageEvent>> {
    const user = await this.resolveUserFromCookie(req);
    if (!user) throw new UnauthorizedException('Invalid session');

    const channels = [RealtimeService.userChannel(user.id)];
    if (user.buildingId) {
      channels.push(RealtimeService.buildingChannel(user.buildingId));
    }
    const events = this.realtime.merge(
      channels.map((channel) => this.realtime.subscribe(channel, user.id)),
    );

    const subscription = events.subscribe({
      next: (event: RealtimeEvent) => {
        res.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
        );
      },
      error: (err: unknown) => {
        this.logger.warn(`realtime stream error: ${String(err)}`);
        res.end();
      },
      complete: () => res.end(),
    });

    req.on('close', () => {
      subscription.unsubscribe();
      this.realtime.disconnect(user.id);
    });

    // Heartbeat so intermediaries don't kill the idle connection.
    return interval(HEARTBEAT_MS).pipe(
      map(
        () =>
          ({
            type: 'heartbeat',
            data: { ts: Date.now() },
          }) as MessageEvent,
      ),
    );
  }

  /** Verify the refresh cookie and load the live user row (like /auth/refresh). */
  private async resolveUserFromCookie(req: HttpRequest): Promise<{
    id: string;
    buildingId: string | null;
  } | null> {
    const token = this.readRefreshCookie(req);
    if (!token) return null;

    let payload: { sub: string; type: string };
    try {
      payload = this.jwt.verify<{ sub: string; type: string }>(token, {
        secret: JWT_REFRESH_SECRET,
      });
    } catch {
      return null;
    }
    if (payload.type !== 'refresh' || !payload.sub) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) return null;
    return { id: user.id, buildingId: user.buildingId };
  }

  private readRefreshCookie(req: HttpRequest): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      const name = part.slice(0, separator).trim();
      if (name === REFRESH_COOKIE_NAME) {
        return part.slice(separator + 1).trim();
      }
    }
    return undefined;
  }
}
