import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser, HttpRequest } from '../auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<HttpRequest>();
    return request.user as AuthenticatedUser;
  },
);
