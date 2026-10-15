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
    { key: 'friends', step: 'who', label: 'With friends', selected: c.partyType === 'friends' },
    { key: 'date', step: 'who', label: evening ? 'Date night' : 'Date', selected: c.partyType === 'date' },
    { key: 'solo', step: 'who', label: 'Solo', selected: c.partyType === 'solo' },
    { key: 'under_25', step: 'budget', label: 'Under $25', selected: c.budgetMax != null && c.budgetMax <= UNDER_BUDGET.budgetMax },
  ];
}

// Owner item 46 (2026-10-11, owner chose: keep the row, highlight the next step): the same four chips stay; only the next
// useful refinement step is quietly emphasized -- Who first, then Budget. A step counts as answered when the ask already holds
// it, from the words or a tap: any party type (family, a big group... included) answers Who; any budget or price tier answers
// Budget. Both answered = no emphasis. No time step (a search never asks; item 107 stays locked: no new chips, no new values).
export const REFINEMENT_STEPS = ['who', 'budget'];
export function nextRefinementStep(classify) {
  const c = classify ?? {};
  if (!c.partyType) return 'who';
  if (c.budgetMax == null && !c.priceLevel) return 'budget';
  return null;
}

// Returns the classification with one chip toggled. Who-for chips are one choice; budget is independent. The Date chip sets only
// the party type: the resolver already counts a date as two people when no size was said (item 85), so no size is invented here.
export function applyRefinement(classify, key) {
  const c = { ...(classify ?? {}) };
  if (key === 'friends' || key === 'date' || key === 'solo') {
    const was = c.partyType;
    c.partyType = c.partyType === key ? null : key;
    // Owner (2026-10-15): Date turned off (cleared or switched to another chip), or any who-for chip cleared, stays off: partner
    // words in the unchanged ask ("with my girlfriend") must not make the re-run date-shaped again. The resolver reads
    // `partnerWordsOff` like a removed understood WHO (services/intentResolver.js); turning Date back on ends it.
    if (c.partyType === 'date') delete c.partnerWordsOff;
    else if (c.partyType === null || was === 'date') c.partnerWordsOff = true;
    // the date-shaped quality the Date party carried (askFacets attributesFromAsk) goes with it; one asked for in words is re-read
    if (was === 'date' && c.partyType !== 'date' && Array.isArray(c.attributes)) c.attributes = c.attributes.filter((a) => a !== 'date_friendly');
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
