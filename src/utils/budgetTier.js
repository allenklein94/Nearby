// ONE contract for budget (locked 2026-09-19): business_requests.budget_max is the maximum spend PER PERSON, in whole
// dollars. party_size is a separate field. The $ / $$ / $$$ shorthand is a deterministic function of that per-person
// number only (never the party total, never AI, never the business's own pricing); the dollar figure stays
// authoritative and the tier is only a secondary shorthand.
//   null / missing  -> no budget, no tier (valid: "no preference")
//   <= 0            -> invalid (rejected at input; $0 is not a spending ceiling)
//   0 < x <= 25     -> $      25 < x <= 75 -> $$      x > 75 -> $$$
// Decimals are compared as-is (25.00 is $, 25.01 is $$, 75.00 is $$, 75.01 is $$$).
export const BUDGET_TIER_CUTOFFS = { low: 25, mid: 75 };

export function isValidBudget(max) {
  return max == null || (typeof max === 'number' && Number.isFinite(max) && max > 0);
}

export const INVALID_BUDGET_MESSAGE = 'Budget must be more than $0.';

export function budgetTier(max) {
  if (max == null || !isValidBudget(Number(max)) || Number(max) <= 0) return null;
  const n = Number(max);
  if (n <= BUDGET_TIER_CUTOFFS.low) return '$';
  if (n <= BUDGET_TIER_CUTOFFS.mid) return '$$';
  return '$$$';
}

// Party total is strictly budget_max x party_size, and only when both are real.
export function partyBudgetTotal(max, partySize) {
  const n = Number(max);
  const p = Number(partySize);
  if (max == null || partySize == null || !(n > 0) || !Number.isInteger(p) || p < 1) return null;
  return Math.round(n * p * 100) / 100;
}

// "Up to $60/person · $360 for the party · $$" -- each part only when real.
export function formatBudgetLine(max, partySize) {
  const tier = budgetTier(max);
  if (!tier) return null;
  const total = partyBudgetTotal(max, partySize);
  return [`Up to $${Number(max)}/person`, total != null ? `$${total} for the party` : null, tier].filter(Boolean).join(' · ');
}

// Both figures are per person, so the comparison never involves party size.
export function budgetMeetsMinSpend(budgetMax, minSpendPerPerson) {
  if (budgetMax == null || minSpendPerPerson == null) return false;
  const b = Number(budgetMax);
  const m = Number(minSpendPerPerson);
  return b > 0 && m > 0 && b >= m;
}
