// Refine without restarting (owner item 107, 2026-09-27). After a typed ask on Home shows results, a few chips let the person
// narrow it in place: who it is for (With friends / Date / Solo, one at a time) and a budget (Under $25). A tap re-runs the SAME
// search with the same words and one value changed: no new AI call, no retyping, no new screen. The chips only set values the
// resolver already reads (partyType; priceLevel + budgetMax, the $ tier's 25 ceiling), so they change nothing about how
// results are ranked, only what was asked. Budget stays ranking-only (never hides anything, locked).
// A chip starts selected when the ask already says it ("with my friends" = With friends on), so the row reflects what Nearby
// understood; tapping a selected chip clears it.

export const UNDER_BUDGET = { priceLevel: '$', budgetMax: 25 };

// The chips, in display order. `label` may depend on the ask (a date "tonight" reads Date night, otherwise just Date, so the
// label never promises an evening the person did not ask for).
export function refinementChips(classify) {
  const c = classify ?? {};
  const evening = c.dateWindow === 'tonight' || c.dateWindow === 'now';
  return [
    { key: 'friends', label: 'With friends', selected: c.partyType === 'friends' },
    { key: 'date', label: evening ? 'Date night' : 'Date', selected: c.partyType === 'date' },
    { key: 'solo', label: 'Solo', selected: c.partyType === 'solo' },
    { key: 'under_25', label: 'Under $25', selected: c.budgetMax != null && c.budgetMax <= UNDER_BUDGET.budgetMax },
  ];
}

// Returns the classification with one chip toggled. Who-for chips are one choice; budget is independent. The Date chip sets only
// the party type: the resolver already counts a date as two people when no size was said (item 85), so no size is invented here.
export function applyRefinement(classify, key) {
  const c = { ...(classify ?? {}) };
  if (key === 'friends' || key === 'date' || key === 'solo') {
    c.partyType = c.partyType === key ? null : key;
    return c;
  }
  if (key === 'under_25') {
    const on = c.budgetMax != null && c.budgetMax <= UNDER_BUDGET.budgetMax;
    c.budgetMax = on ? null : UNDER_BUDGET.budgetMax;
    c.priceLevel = on ? null : UNDER_BUDGET.priceLevel;
    return c;
  }
  return c;
}

// Asks the chips make sense for: a search that went through the resolver (not a community lookup or a business proposal).
export function canRefine(classify) {
  return !!classify && classify.intent !== 'community' && classify.intent !== 'business_partner';
}
