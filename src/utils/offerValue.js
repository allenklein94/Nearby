import { tr } from '../i18n/translate';
import { bizMoney } from '../i18n/bizFormat';

// "1 redemption \u00b7 $12 in offers redeemed". The dollars are the owner's own prices on offers that were really redeemed
// (a per-person price x the request's real party size); an unpriced redemption is counted but adds no dollars and is
// said so, never guessed. Nothing renders for a business with no redemptions yet (no invented zero-dollar claim).
// row = one get_partner_offer_value row.
export function offerValueLines(row, period = 'month') {
  const n = Number(period === 'month' ? row?.month_redemptions : row?.all_redemptions);
  if (!row || !Number.isFinite(n) || n <= 0) return null;
  const value = Number(period === 'month' ? row.month_value : row.all_value);
  const unpriced = Number(period === 'month' ? row.month_unpriced : row.all_unpriced) || 0;
  const priced = n - unpriced;
  const head = tr('ui.bizHelp.value.redemptions', { count: n });
  const dollars = priced > 0 && Number.isFinite(value) ? tr('ui.bizHelp.value.dollars', { amount: bizMoney(value) }) : null;
  const note = priced > 0
    ? (unpriced > 0 ? tr('ui.bizHelp.value.noteUnpriced', { count: unpriced }) : tr('ui.bizHelp.value.note'))
    : tr('ui.bizHelp.value.noneHadPrice');
  return { headline: dollars ? `${head} \u00b7 ${dollars}` : head, note };
}
