// Owner-facing wording for a sponsored placement, from its real stored state (global rule 7): nothing here claims a
// state the database did not report. Figures are approximate (client-reported) and shown only for the owner's own rows.
export function placementStatusLine(p, now = new Date()) {
  const paid = p.payment_status === 'paid';
  switch (p.status) {
    case 'awaiting_payment': return 'Waiting for payment. Your slot is held for 24 hours.';
    case 'expired_unpaid': return 'Not paid. The slot was released.';
    case 'cancelled': return 'Cancelled before payment.';
    case 'scheduled': return paid ? 'Paid. Starts ' + dayLabel(p.starts_at) + '.' : 'Scheduled.';
    case 'active': {
      const days = Math.max(0, Math.ceil((new Date(p.ends_at) - now) / 86400000));
      return `Live now. ${days} ${days === 1 ? 'day' : 'days'} left.`;
    }
    case 'completed': return 'Finished ' + dayLabel(p.ends_at) + '.';
    case 'paused': return 'Paused. Contact support if you did not expect this.';
    case 'refunded': return 'Refunded.';
    default: return null; // unknown state: say nothing rather than guess
  }
}

export function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function statsLine(p) {
  if (p.impressions == null || p.taps == null) return null;
  if (!['active', 'completed', 'paused', 'refunded'].includes(p.status)) return null;
  const rate = p.impressions > 0 ? ` · about ${Math.round((p.taps / p.impressions) * 100)}% tapped` : '';
  return `About ${p.impressions} ${p.impressions === 1 ? 'view' : 'views'} · ${p.taps} ${p.taps === 1 ? 'tap' : 'taps'}${rate}`;
}

export function priceLabel(cents, currency = 'usd') {
  if (!Number.isFinite(cents)) return null;
  const n = cents / 100;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return (currency || 'usd').toLowerCase() === 'usd' ? `$${s}` : `${s} ${String(currency).toUpperCase()}`;
}

// Whole UTC days from tomorrow: the server accepts tomorrow to 60 days out.
export function startDateOptions(now = new Date(), count = 14) {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: count }, (_, i) => new Date(base + (i + 1) * 86400000).toISOString().slice(0, 10));
}

export const PROBLEM_TEXT = {
  not_a_business_owner: 'Only a business owner can promote.',
};
