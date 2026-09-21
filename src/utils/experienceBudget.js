import { budgetTier } from './budgetTier';

// Budget-aware ordering for a cross-category experience ("a cheap date tonight"). Only REAL prices count: a gathering's
// own price_level. A business posting carries a price with no per-person flag, so it stays "unknown" (never guessed).
// Ranking only: an over-budget item sinks below the others, nothing is hidden, and with no stated budget nothing changes.
const RANK = { free: 0, $: 1, $$: 2, $$$: 3 };

export function askedPriceRank(ask) {
  const { priceLevel = null, budgetMax = null } = ask ?? {};
  if (priceLevel && RANK[priceLevel] != null) return RANK[priceLevel];
  const tier = budgetTier(budgetMax);
  return tier ? RANK[tier] : null;
}

export function itemPriceRank(item) {
  return item?.priceLevel && RANK[item.priceLevel] != null ? RANK[item.priceLevel] : null;
}

// 0 = known to fit, 1 = unknown, 2 = known to be over the stated budget.
export function budgetFit(item, ask) {
  const limit = askedPriceRank(ask);
  const price = itemPriceRank(item);
  if (limit == null || price == null) return 1;
  return price <= limit ? 0 : 2;
}

export function orderByBudget(items, ask) {
  if (askedPriceRank(ask) == null) return items;
  return items
    .map((item, index) => ({ item, index, fit: budgetFit(item, ask) }))
    .sort((a, b) => a.fit - b.fit || a.index - b.index)
    .map((x) => x.item);
}

const LABEL = { free: 'Free', $: '$', $$: '$$', $$$: '$$$' };
export function priceChipLabel(item) {
  return itemPriceRank(item) == null ? null : LABEL[item.priceLevel];
}
