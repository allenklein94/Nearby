// Client-side mirror of the server's max_discount_pct rule (migration 20261230,
// `_discount_cap_violation`). The DATABASE is the enforcement point; this only lets the form
// say the same thing before a round trip. Cap = the business's ACTIVE fulfillment policy's
// max_discount_pct; no policy / paused / null cap = no limit and no required percentage.

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
  if (pct != null && (pct < 0 || pct > 100)) return 'Discount percent must be between 0 and 100.';
  if (cap == null) return null;
  if (pct == null) {
    return offerType === 'discount' ? `Enter the discount percentage -- your policy caps discounts at ${cap}%.` : null;
  }
  return pct > cap ? `This discount (${pct}%) is above your maximum discount of ${cap}%.` : null;
}
