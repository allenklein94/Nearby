// The activity a new gathering stores (owner, 2026-10-27; migration 20270346). Activity != Category != Title:
//   carried  = the Home Quick Pick Create was opened from ("Dinner"), kept while the chosen category is still that pick's;
//   else     = the pick the draft's own words name inside its category (the same reading Discover's pick filter uses),
//              read ONCE at publish so later title edits never change it;
//   else     = none (the category alone speaks for it).
// Stored as the pick's label key; shown through quickOptionLabel in the person's language. The server keeps only a pick that
// belongs to the category and never lets it change afterwards.
import { quickPickForActivity, quickPickForGathering } from './timeContext';

export function gatheringActivityAtPublish({ carried = null, interestTag = null, title = '', description = '' } = {}) {
  if (!interestTag) return null;
  if (quickPickForActivity(interestTag, carried)) return carried;
  return quickPickForGathering({ interest_tag: interestTag, title, description })?.label ?? null;
}
