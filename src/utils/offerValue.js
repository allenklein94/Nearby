import { moneyLabel } from './outcomeDisplay';
import { countLabel } from './plural';

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
  const head = countLabel(n, 'redemption') ?? `${n} redemptions`;
  const dollars = priced > 0 && Number.isFinite(value) ? `${moneyLabel(value)} in offers redeemed` : null;
  const note = priced > 0
    ? `Based on the prices you set on your offers${unpriced > 0 ? `; ${countLabel(unpriced, 'redemption')} had no price to count` : ''}. Not a measure of what customers spent.`
    : 'None of these offers had a price to count.';
  return { headline: dollars ? `${head} \u00b7 ${dollars}` : head, note };
}
