import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * HTTP 423 Locked — raised by the login lockout guard. Carries a `Retry-After`
 * header so clients (and the throttler integration) know when to retry.
 */
export class ThrottlerExceptionLike extends HttpException {
  constructor(retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.LOCKED,
        message: 'Too many failed login attempts. Try again later.',
        error: 'Locked',
      },
      HttpStatus.LOCKED,
      {
        cause: { retryAfterSeconds },
        description: 'Account temporarily locked after repeated failed logins',
      },
    );
  }

  /** Overridable accessor matching class-validator's `getResponse()` shape. */
  getRetryAfter(): number {
    const response = super.getResponse();
    if (response && typeof response === 'object' && 'cause' in response) {
      const cause = (response as { cause?: { retryAfterSeconds?: number } }).cause;
      if (cause?.retryAfterSeconds != null) return cause.retryAfterSeconds;
    }
    return 15 * 60;
  }
}