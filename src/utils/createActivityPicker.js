import { quickPickForActivity } from './timeContext';
import { ACTIVITY_REFINEMENTS, NO_PREFERENCE } from '../constants/activityRefinements';

// Device test 2026-11-27 (item 7): Create's What step shows an activity the person already gave (quick pick, typed ask,
// Start Something) as one compact row with "Adjust", never the whole category list again. The full list shows when nothing
// is known yet, when the person opens it, or when the carried category was cleared.
export function compactActivityPicker(activityFromContext, interestTag, listOpen) {
  return !!activityFromContext && !!interestTag && !listOpen;
}

// A label is a stored activity only when it is one of the Quick Picks for that category (gatherings.activity's pairs).
export function quickPickActivityFor(item) {
  return quickPickForActivity(item?.category, item?.label) ? item.label : null;
}

// Item 7: the optional refinements Create offers for a known activity (Dinner -> cuisines), or none.
export function refinementOptions(activity) {
  return (activity && ACTIVITY_REFINEMENTS[activity]) || null;
}

// A refinement only names the title, so it is offered while the title is still a prefill: empty, the activity's own word,
// another refinement's word, or the title Create was handed (a typed ask's own words; labelOf = the person's-language
// label). A title the person wrote is never replaced, and then the row is not shown (it would do nothing).
function prefillTitles(activity, labelOf, handedTitle) {
  const opts = refinementOptions(activity) || [];
  return new Set(['', String(handedTitle ?? '').trim(), labelOf(activity), ...opts.filter((o) => o.label !== NO_PREFERENCE).map((o) => labelOf(o.label))]);
}
export function refinementsOffered(activity, title, labelOf, handedTitle = null) {
  return !!refinementOptions(activity) && prefillTitles(activity, labelOf, handedTitle).has(String(title ?? '').trim());
}
// The title after a pick: the cuisine's word, or the activity's own word for "Doesn't matter".
export function titleForRefinement(activity, pickLabel, labelOf) {
  return pickLabel === NO_PREFERENCE ? labelOf(activity) : labelOf(pickLabel);
}
export function refinementSelected(activity, pickLabel, title, labelOf) {
  return String(title ?? '').trim() === titleForRefinement(activity, pickLabel, labelOf);
}
