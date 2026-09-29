import {
  MAX_SMS_LENGTH,
  buildArrearsReminderSms,
  buildInvoiceIssuedSms,
  buildNotificationSms,
  buildVoteOpenedSms,
  truncateSms,
} from './sms-templates';

describe('sms templates', () => {
  it('builds the invoice issued text with the period', () => {
    expect(buildInvoiceIssuedSms('2026-08')).toBe(
      'ΠολυκατοικίαOS: Νέο κοινόχρηστο για τον μήνα 2026-08. Ανοίξτε την εφαρμογή για εξόφληση.',
    );
  });

  it('embeds the vote topic and truncates long ones to 160 chars', () => {
    expect(buildVoteOpenedSms('Ανελκυστήρας')).toBe(
      'ΠολυκατοικίαOS: Νέα ψηφοφορία «Ανελκυστήρας». Ανοίξτε την εφαρμογή για να ψηφίσετε.',
    );
    const long = buildVoteOpenedSms('θ'.repeat(400));
    expect(long.length).toBeLessThanOrEqual(MAX_SMS_LENGTH);
    expect(long).toContain('…');
  });

  it('builds the arrears reminder with and without a period', () => {
    expect(buildArrearsReminderSms('2026-08')).toBe(
      'ΠολυκατοικίαOS: Υπενθύμιση οφειλών κοινόχρηστων για τον μήνα 2026-08. Ανοίξτε την εφαρμογή για εξόφληση.',
    );
    expect(buildArrearsReminderSms()).toBe(
      'ΠολυκατοικίαOS: Υπενθύμιση οφειλών κοινόχρηστων. Ανοίξτε την εφαρμογή για εξόφληση.',
    );
  });

  it('keeps every builder within the 160-char limit', () => {
    const texts = [
      buildInvoiceIssuedSms('2026-08'),
      buildVoteOpenedSms('θ'.repeat(300)),
      buildArrearsReminderSms('2026-08'),
      truncateSms('x'.repeat(500)),
    ];
    for (const text of texts) {
      expect(text.length).toBeLessThanOrEqual(MAX_SMS_LENGTH);
    }
    expect(truncateSms('short')).toBe('short');
  });

  describe('buildNotificationSms', () => {
    it('maps known kinds to their template output', () => {
      expect(
        buildNotificationSms('invoice.issued', {
          kind: 'invoice.issued',
          periodKey: '2026-08',
        }),
      ).toBe(buildInvoiceIssuedSms('2026-08'));
      expect(
        buildNotificationSms('vote.opened', {
          kind: 'vote.opened',
          topic: 'Λέβητας',
        }),
      ).toBe(buildVoteOpenedSms('Λέβητας'));
      expect(buildNotificationSms('arrears.reminder', undefined)).toBe(
        buildArrearsReminderSms(),
      );
    });

    it('returns null for unknown kinds or missing required context', () => {
      expect(buildNotificationSms('bid.received', { kind: 'bid.received' })).toBeNull();
      expect(buildNotificationSms('invoice.issued', { kind: 'invoice.issued' })).toBeNull();
      expect(buildNotificationSms('vote.opened', { kind: 'vote.opened' })).toBeNull();
      expect(buildNotificationSms('invoice.issued')).toBeNull();
    });
  });
});
