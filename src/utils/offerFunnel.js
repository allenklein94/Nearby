import { tr } from '../i18n/translate';
import { bizMoney } from '../i18n/bizFormat';

// Item 150: the business's month at a glance, one row per funnel stage:
// Opportunities -> Offers sent -> Offers accepted -> Redemptions, then the value of the offers redeemed.
// Counts come from get_partner_offer_funnel (each stage by the real moment it happened this calendar month); the money
// row comes from get_partner_offer_value (prices the business set on offers really redeemed), so Redemptions and the
// value describe the same offers. Never "revenue" or "earnings" (item 149): Nearby does not know what customers spent.
// A failed or missing funnel = null (nothing shown, never invented zeros); a loaded month with no activity shows real 0s.
export function offerFunnelView(funnel, value) {
  if (!funnel) return null;
  const n = (x) => {
    const v = Number(x);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  const stages = [
    ['opportunities', funnel.opportunities],
    ['offersSent', funnel.offers_sent],
    ['accepted', funnel.accepted],
    ['redemptions', funnel.redemptions],
  ].map(([key, count]) => ({ key, label: tr(`ui.bizHelp.funnel.${key}`), count: n(count) }));
  if (stages.some((s) => s.count == null)) return null;

  const redeemed = n(value?.month_redemptions) ?? 0;
  const unpriced = n(value?.month_unpriced) ?? 0;
  const amount = Number(value?.month_value);
  const priced = redeemed - unpriced;
  const valueRow = value && redeemed > 0 && priced > 0 && Number.isFinite(amount)
    ? { key: 'value', label: tr('ui.bizHelp.funnel.value'), amount: bizMoney(amount) }
    : null;
  const note = !valueRow ? null
    : unpriced > 0 ? tr('ui.bizHelp.value.noteUnpriced', { count: unpriced }) : tr('ui.bizHelp.value.note');
  return { title: tr('ui.bizHelp.funnel.title'), stages, valueRow, note };
}
