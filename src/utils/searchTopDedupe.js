// Top Results dedupe (item 134: one object, once per surface). While a typed search's found block is showing on
// Discover's Top Results tab, the Plans / Offers / Places previews below it leave out anything the found block already
// shows. The found block wins: it is the answer to what was typed and carries the reasons. Presentation only: the
// result tabs, their counts, the search results themselves and ranking are untouched. Matching is by object id within
// a type: a gathering by its id, a perk by its id, a business by its brand_partners id.
import { displayedIntentResults } from './typedAskAudit';

const BUSINESS_TYPES = new Set(['business_availability', 'business_policy_match', 'business_occasion_package']);

function emptyShown() {
  return { plans: new Set(), offers: new Set(), places: new Set() };
}

// result = the Discover typed-ask result (intentSearch). Reads the rows actually rendered (the same layout the
// typed-ask audit records), so an id counts only when it is really on screen.
export function foundBlockShownIds(result) {
  const shown = emptyShown();
  for (const { item } of displayedIntentResults('discover', result)) {
    if (!item || item.id == null) continue;
    if (item.type === 'gathering') shown.plans.add(String(item.id));
    else if (item.type === 'perk') shown.offers.add(String(item.id));
    else if (BUSINESS_TYPES.has(item.type)) {
      const partner = item.partnerId ?? item.id;
      if (partner != null) shown.places.add(String(partner));
    }
  }
  return shown;
}

// kind 'plans' | 'offers' | 'places'. shown = foundBlockShownIds(...) or null (no found block = list unchanged).
export function withoutFoundBlock(list, kind, shown) {
  const ids = shown?.[kind];
  if (!Array.isArray(list) || !ids || ids.size === 0) return list ?? [];
  return list.filter((x) => x?.id == null || !ids.has(String(x.id)));
}
