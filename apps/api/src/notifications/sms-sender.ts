import { Logger } from '@nestjs/common';

/** Mirrors Mailer/PushSender console-fallback conventions (see mailer.ts, push-sender.ts). */
export interface SmsSendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

export interface SmsSender {
  send(to: string, text: string): Promise<SmsSendResult>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger(ConsoleSmsSender.name);

  async send(to: string, text: string): Promise<SmsSendResult> {
    this.logger.log(`SMS → ${to} | ${text}`);
    return { ok: true };
  }
}

export interface HttpSmsOptions {
  /** URL template; optional `{to}` / `{text}` placeholders are substituted URL-encoded. */
  urlTemplate: string;
  /** Raw value for the `Authorization` header when set. */
  authHeader?: string;
}

export class HttpSmsSender implements SmsSender {
  constructor(private readonly options: HttpSmsOptions) {}

  async send(to: string, text: string): Promise<SmsSendResult> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.options.authHeader) {
        headers.Authorization = this.options.authHeader;
      }

      const res = await fetch(this.buildUrl(to, text), {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, text }),
      });
      if (!res.ok) {
        return { ok: false, error: `gateway responded ${res.status}` };
      }
      return { ok: true, ...(await extractProviderId(res)) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private buildUrl(to: string, text: string): string {
    return this.options.urlTemplate
      .split('{to}')
      .join(encodeURIComponent(to))
      .split('{text}')
      .join(encodeURIComponent(text));
  }
}

async function extractProviderId(res: Response): Promise<{ providerId?: string }> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const candidate =
      data.id ?? data.messageId ?? data.message_id ?? data.providerId;
    return typeof candidate === 'string' && candidate.length > 0
      ? { providerId: candidate }
      : {};
  } catch {
    return {};
  }
}

/**
 * `SMS_MODE=http` + `SMS_HTTP_URL` → generic HTTP gateway; anything else
 * (including http without a URL) falls back to the console driver.
 */
export function createSmsSenderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SmsSender {
  if ((env.SMS_MODE ?? '').trim().toLowerCase() === 'http') {
    const urlTemplate = env.SMS_HTTP_URL?.trim();
    if (urlTemplate) {
      return new HttpSmsSender({
        urlTemplate,
        ...(env.SMS_HTTP_AUTH ? { authHeader: env.SMS_HTTP_AUTH } : {}),
      });
    }
  }
  return new ConsoleSmsSender();
}
