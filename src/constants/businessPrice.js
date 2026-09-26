// Item 82: a business's price, deliberately coarse. The owner picks one tier ($ .. $$$$) and may add a typical spend per person
// (whole dollars, optional). Both are owner-declared, NULL = not said; neither is ever derived from the other or from anything else.
// People speak in three words: Cheap -> $, Moderate -> $$, Special occasion -> $$$ (fits a $$$ or $$$$ business).
// Gatherings and experiences keep their own free/$/$$/$$$ list (EXPERIENCE_PRICE_OPTIONS); this list is business-only.
export const BUSINESS_PRICE_LEVELS = ['$', '$$', '$$$', '$$$$'];
export const TYPICAL_SPEND_MAX = 1000;

// Which business tiers fit a price the person asked for. 'free' has no business tier, so it fits none.
const FITS = { $: ['$'], $$: ['$$'], $$$: ['$$$', '$$$$'] };
export function businessPriceFits(asked, level) {
  return !!asked && !!level && (FITS[asked] ?? []).includes(level);
}

// '' / null = clear (not said). Returns an error message or null.
export function typicalSpendProblem(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > TYPICAL_SPEND_MAX) return `Enter whole dollars between $1 and $${TYPICAL_SPEND_MAX}, or leave it blank.`;
  return null;
}

// "$$ · Typically about $25 per person" -- each part only when the owner said it; nothing at all = null (hidden).
export function businessPriceLine(level, spend) {
  const parts = [];
  if (BUSINESS_PRICE_LEVELS.includes(level)) parts.push(level);
  if (Number.isInteger(spend) && spend > 0) parts.push(`Typically about $${spend} per person`);
  return parts.length ? parts.join(' · ') : null;
}
