import { Logger } from '@nestjs/common';

export interface Mailer {
  send(to: string | string[], subject: string, html: string): Promise<void>;
}

export const MAILER = Symbol('MAILER');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(
    to: string | string[],
    subject: string,
    html: string,
  ): Promise<void> {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, to, subject, html }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed (${res.status})`);
    }
  }
}

export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger(ConsoleMailer.name);

  async send(
    to: string | string[],
    subject: string,
    html: string,
  ): Promise<void> {
    const recipients = Array.isArray(to) ? to.join(', ') : to;
    this.logger.log(`Email → ${recipients} | ${subject}\n${html}`);
  }
}

/** Resend when configured, otherwise log to console (local development). */
export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return new ResendMailer(
      apiKey,
      process.env.MAIL_FROM ?? 'KoinoxristaOS <onboarding@resend.dev>',
    );
  }
  return new ConsoleMailer();
}
