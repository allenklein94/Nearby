// Item 40: a business's own declared price_level ('free' | '$' | '$$' | '$$$') against the ask's priceLevel (the same
// vocabulary, extracted from words like "free" or "cheap"). Ranking only, same flat weight a gathering's price match earns
// (priceAndPartyBonus); a business with no declared level, or an ask with no price, is untouched. Never hides anything.
export function applyBusinessPriceToCandidates(candidates, levelByPartnerId, askedLevel, weight) {
  if (!askedLevel || !levelByPartnerId) return candidates;
  return candidates.map((c) => {
    const level = c?.partnerId ? levelByPartnerId.get(c.partnerId) : null;
    return level && level === askedLevel ? { ...c, score: (c.score ?? 0) + weight } : c;
  });
}
