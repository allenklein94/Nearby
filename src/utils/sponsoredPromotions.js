// Owner-facing wording for a sponsored placement, from its real stored state (global rule 7): nothing here claims a
// state the database did not report. Figures are approximate (client-reported) and shown only for the owner's own rows.
import { tr } from '../i18n/translate';
import { bizIsEnglish, bizLanguage, bizNumber } from '../i18n/bizFormat';
import { vocabValue } from '../i18n/format';

const S = (key, vars) => tr(`ui.bizHelp.sponsored.${key}`, vars);

export function placementStatusLine(p, now = new Date()) {
  const paid = p.payment_status === 'paid';
  switch (p.status) {
    case 'awaiting_payment': return S('awaitingPayment');
    case 'expired_unpaid': return S('expiredUnpaid');
    case 'cancelled': return S('cancelled');
    case 'scheduled': return paid ? S('paidStarts', { day: dayLabel(p.starts_at) }) : S('scheduled');
    case 'active': {
      const days = Math.max(0, Math.ceil((new Date(p.ends_at) - now) / 86400000));
      return S('liveDaysLeft', { count: days });
    }
    case 'completed': return S('finished', { day: dayLabel(p.ends_at) });
    case 'paused': return S('paused');
    case 'refunded': return S('refunded');
    default: return null; // unknown state: say nothing rather than guess
  }
}

export function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (!bizIsEnglish()) return S('monthDay', { month: (vocabValue(bizLanguage(), 'date.months') ?? [])[d.getUTCMonth()] ?? '', day: d.getUTCDate() });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function statsLine(p) {
  if (p.impressions == null || p.taps == null) return null;
  if (!['active', 'completed', 'paused', 'refunded'].includes(p.status)) return null;
  const parts = [S('views', { count: p.impressions }), S('taps', { count: p.taps })];
  if (p.impressions > 0) parts.push(S('tappedPct', { pct: Math.round((p.taps / p.impressions) * 100) }));
  return parts.join(' · ');
}

export function priceLabel(cents, currency = 'usd') {
  if (!Number.isFinite(cents)) return null;
  const n = cents / 100;
  const s = Number.isInteger(n) ? bizNumber(n) : (bizIsEnglish() ? n.toFixed(2) : bizNumber(Number(n.toFixed(2))));
  return (currency || 'usd').toLowerCase() === 'usd' ? `$${s}` : `${s} ${String(currency).toUpperCase()}`;
}

// Whole UTC days from tomorrow: the server accepts tomorrow to 60 days out.
export function startDateOptions(now = new Date(), count = 14) {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: count }, (_, i) => new Date(base + (i + 1) * 86400000).toISOString().slice(0, 10));
}

// A getter so the wording follows the current language.
export const problemText = (code) => ({ not_a_business_owner: S('notOwner') }[code] ?? null);
