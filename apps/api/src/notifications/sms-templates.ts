/** Single-segment SMS limit (GSM-03.38); every builder clamps to this. */
export const MAX_SMS_LENGTH = 160;

const BRAND = 'ΠολυκατοικίαOS';

export function truncateSms(text: string, max: number = MAX_SMS_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function buildInvoiceIssuedSms(periodYearMonth: string): string {
  return truncateSms(
    `${BRAND}: Νέο κοινόχρηστο για τον μήνα ${periodYearMonth}. Ανοίξτε την εφαρμογή για εξόφληση.`,
  );
}

export function buildVoteOpenedSms(topic: string): string {
  return truncateSms(
    `${BRAND}: Νέα ψηφοφορία «${topic}». Ανοίξτε την εφαρμογή για να ψηφίσετε.`,
  );
}

export function buildArrearsReminderSms(periodYearMonth?: string): string {
  return truncateSms(
    `${BRAND}: Υπενθύμιση οφειλών κοινόχρηστων${
      periodYearMonth ? ` για τον μήνα ${periodYearMonth}` : ''
    }. Ανοίξτε την εφαρμογή για εξόφληση.`,
  );
}

export interface SmsContext {
  /** Dedupe + template selector, e.g. `invoice.issued`, `vote.opened`, `arrears.reminder`. */
  kind: string;
  /** Dedupe period, e.g. `2026-08` or a vote id; omit for run-scoped kinds. */
  periodKey?: string;
  topic?: string;
}

/** Maps a notification kind to its SMS text; null → no SMS for that kind/context. */
export function buildNotificationSms(
  kind: string,
  context?: SmsContext,
): string | null {
  switch (kind) {
    case 'invoice.issued':
      return context?.periodKey
        ? buildInvoiceIssuedSms(context.periodKey)
        : null;
    case 'vote.opened':
      return context?.topic ? buildVoteOpenedSms(context.topic) : null;
    case 'arrears.reminder':
      return buildArrearsReminderSms(context?.periodKey);
    default:
      return null;
  }
}
