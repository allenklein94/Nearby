// Client-side mirror of the server's max_discount_pct rule (migration 20261230,
// `_discount_cap_violation`). The DATABASE is the enforcement point; this only lets the form
// say the same thing before a round trip. Cap = the business's ACTIVE fulfillment policy's
// max_discount_pct; no policy / paused / null cap = no limit and no required percentage.

import { tr } from '../i18n/translate';

export function activeDiscountCap(policy) {
  if (!policy || policy.active === false) return null;
  const cap = Number(policy.max_discount_pct);
  return policy.max_discount_pct != null && Number.isFinite(cap) ? cap : null;
}

export function parseDiscountPct(input) {
  const t = String(input ?? '').trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// Returns a message when the offer/posting would be refused, else null.
export function discountCapProblem({ offerType, pctInput, cap }) {
  const pct = parseDiscountPct(pctInput);
  if (pct != null && (pct < 0 || pct > 100)) return tr('ui.bizHelp.discount.range');
  if (cap == null) return null;
  if (pct == null) {
    return offerType === 'discount' ? tr('ui.bizHelp.discount.enterPct', { cap }) : null;
  }
  return pct > cap ? tr('ui.bizHelp.discount.overCap', { pct, cap }) : null;
}
