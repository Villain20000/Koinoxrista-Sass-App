import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import type { AuthenticatedUser, HttpRequest } from '../auth/auth.types';
import { REFRESH_COOKIE_NAME } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  SessionsService,
  SessionView,
  hashRefreshToken,
} from './sessions.service';

/** Reads the raw refresh token from the request cookies (undefined if absent). */
export function readRefreshCookie(req: HttpRequest): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === REFRESH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

/**
 * "Your active sessions" — list/revoke refresh-token sessions. The current
 * session is identified server-side by hashing the refresh cookie the browser
 * presents with every authenticated request.
 */
@Controller('auth/sessions')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: HttpRequest,
  ): Promise<SessionView[]> {
    return this.sessionsService.list(user.id, this.currentHash(req));
  }

  @Delete(':id')
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
    @Req() req: HttpRequest,
  ): Promise<void> {
    return this.sessionsService.revoke(user.id, sessionId, this.currentHash(req));
  }

  @Post('revoke-others')
  @HttpCode(200)
  revokeOthers(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: HttpRequest,
  ): Promise<{ revoked: number }> {
    return this.sessionsService.revokeOthers(user.id, this.currentHash(req));
  }

  private currentHash(req: HttpRequest): string | undefined {
    const raw = readRefreshCookie(req);
    return raw ? hashRefreshToken(raw) : undefined;
  }
}
