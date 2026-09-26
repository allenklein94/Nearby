import { businessPriceFits } from '../constants/businessPrice';

// Items 40 + 82: a business's own declared price against the ask. Ranking only, never a filter; unknown = untouched.
//  * tier: the ask's priceLevel (Cheap $, Moderate $$, Special occasion $$$) lifts a business whose tier fits (+weight).
//  * typical spend: a stated budget ("under $30") lifts a business whose typical spend per person fits (+weight) and sinks one
//    clearly over it (more than 25% over, -weight); a little over is neutral.
//  * "not too expensive" sinks a $$$ / $$$$ business (-weight).
// priceByPartnerId: Map partnerId -> { level, spend }.
export function applyBusinessPriceToCandidates(candidates, priceByPartnerId, ask, weight) {
  const { priceLevel = null, budgetMax = null, pricey = false } = ask ?? {};
  if ((!priceLevel && !budgetMax && !pricey) || !priceByPartnerId) return candidates;
  return candidates.map((c) => {
    const p = c?.partnerId ? priceByPartnerId.get(c.partnerId) : null;
    if (!p) return c;
    let delta = 0;
    if (priceLevel && businessPriceFits(priceLevel, p.level)) delta += weight;
    if (budgetMax > 0 && p.spend > 0) {
      if (p.spend <= budgetMax) delta += weight;
      else if (p.spend > budgetMax * 1.25) delta -= weight;
    }
    if (pricey && (p.level === '$$$' || p.level === '$$$$')) delta -= weight;
    return delta ? { ...c, score: (c.score ?? 0) + delta } : c;
  });
}
