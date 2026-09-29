/**
 * Formats an integer amount of cents in the given ISO-4217 currency + BCP47
 * locale via `Intl.NumberFormat`. Defaults to EUR/el-GR so call sites that only
 * pass cents behave exactly like the legacy function.
 */
export function formatMoney(
  cents: number,
  opts: { currency?: string; locale?: string } = {},
): string {
  const { currency = 'EUR', locale = 'el-GR' } = opts;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // Unknown currency/locale → fall back to the legacy Greek-euro rendering.
    return legacyFormatEuros(cents);
  }
}

/** Formats an integer amount of cents as a Greek euro string, e.g. 12345 → "123,45 €". */
export function formatEuros(cents: number): string {
  return legacyFormatEuros(cents);
}

/** Legacy exact Greek-euro renderer (kept byte-identical for existing specs). */
function legacyFormatEuros(cents: number): string {
  return `${(cents / 100).toLocaleString('el-GR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

/** Converts a euro decimal string/number to integer cents (client-side ×100). */
export function eurosToCents(euros: number | string): number {
  const value =
    typeof euros === 'string' ? Number(euros.replace(',', '.')) : euros;
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

/** Owner display name from an owner-like payload entry. */
export function ownerName(owner: {
  email?: string;
  firstName?: string;
  lastName?: string;
}): string {
  const name = [owner.firstName, owner.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || owner.email || '—';
}

/** Formats a byte count as a human-readable size, e.g. 1536 → "1,5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toLocaleString('el-GR', { maximumFractionDigits: 1 })} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toLocaleString('el-GR', { maximumFractionDigits: 1 })} MB`;
}

/** Shortens a reference string for table display, e.g. "PAY-9F3A…" (pure). */
export function shortRef(ref: string | null | undefined): string {
  if (!ref) return '—';
  return ref.length <= 10 ? ref : `${ref.slice(0, 10)}…`;
}
