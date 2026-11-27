import { quickPickForActivity } from './timeContext';

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
