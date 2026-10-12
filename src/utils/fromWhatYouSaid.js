// Item 187 + owner item 82 (2026-10-12): the "From what you said" card in Create. When Create opens from a typed ask
// ("Create it yourself"), the facts the words gave (createParamsFromAsk's inferredSummary) are shown as soon as Create opens:
// on step 1 (What) at the top, and on step 2 (When & where) as before. ONE rule for which rows show and where; the screen only
// renders it through components/FromWhatYouSaidCard.js.
// Rules: only the rows the ask's own words gave (activity, purpose, time, people); never a location or setting: "near me" is
// Create's default, not something read from the ask. One Hide for the card on both steps. The step-2 guidance line ("Pick a
// time, then a place") belongs to step 2 only. The card settles in once (item 45's small pattern) only on the step Create
// opened on; Reduce Motion or step 2 = already there.

export const SUMMARY_LAYERS = ['activity', 'purpose', 'time', 'people'];
export const FROM_WHAT_YOU_SAID_STEPS = ['what', 'whenWhere'];

export function fromWhatYouSaidRows(params) {
  const rows = Array.isArray(params?.inferredSummary) ? params.inferredSummary : [];
  return rows.filter((r) => r && SUMMARY_LAYERS.includes(r.layer));
}

export function fromWhatYouSaidOnStep(stepKey, rows, dismissed) {
  return !dismissed && Array.isArray(rows) && rows.length > 0 && FROM_WHAT_YOU_SAID_STEPS.includes(stepKey);
}

export function fromWhatYouSaidGuidance(stepKey) {
  return stepKey === 'whenWhere';
}

// The one settle: on the step Create opened on (the first step, What), the first time that card shows in this Create.
export function fromWhatYouSaidSettles(stepKey, openedOnStepKey) {
  return stepKey === 'what' && openedOnStepKey === 'what';
}

// Owner item 84 (2026-10-12): the same card on the request screen when it opens from a typed ask ("Ask Nearby Businesses").
// Only what the ask itself gave AND the request form really carries: the activity (its category), the day its words said, and
// People only when the words stated a number (statedPartySize). Never purpose/who-it's-with (a request never carries it to a
// business), budget, radius, or a default.
export const REQUEST_CARRIED_DAYS = ['now', 'today', 'tonight', 'tomorrow', 'weekend', 'flexible'];
export function requestCarriedRows({ category = null, dateWindow = null, statedPartySize = null } = {}) {
  const rows = [];
  if (typeof category === 'string' && category) rows.push({ layer: 'activity', key: category });
  if (REQUEST_CARRIED_DAYS.includes(dateWindow)) rows.push({ layer: 'time', key: dateWindow });
  if (Number.isInteger(statedPartySize) && statedPartySize > 0) rows.push({ layer: 'people', key: statedPartySize });
  return rows;
}
