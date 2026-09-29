import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

import type { HttpRequest } from '../../auth/auth.types';

export interface ApiKeyPrincipal {
  id: string;
  buildingId: string;
  userId: string;
  name: string;
  scopes: string[];
}

export interface HttpRequestWithApiKey extends HttpRequest {
  headers: HttpRequest['headers'] & { 'x-api-key'?: string };
  apiKey?: ApiKeyPrincipal;
}

export const API_KEY_SCOPE_KEY = 'apiKeyScope';

export const ApiKeyScope = (scope: string) =>
  SetMetadata(API_KEY_SCOPE_KEY, scope);

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeyPrincipal => {
    const request = ctx.switchToHttp().getRequest<HttpRequestWithApiKey>();
    return request.apiKey as ApiKeyPrincipal;
  },
);
