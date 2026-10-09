// The destination contract (owner item 136, 2026-10-01; extends item 34 and global rule 4). What a recommendation SAYS decides
// where tapping it goes: a claim about a person goes to People, a gathering to that gathering, an offer to that offer. A
// recommendation never lands on a generic screen when a specific one exists, and a claim about several specific things shows
// THOSE things (inline, global rule 5) rather than a whole browse list that merely contains them.
//
// The producers (recommendationContext.js `intentResultDestination`, homeDashboard.js `getHomeInsight`, meetTonight.js) build
// destinations; this table is what they must satisfy, and `destinationContract.test.js` runs each producer against it.
// A new kind of claim is added here first, then to its producer.
//
// Destination shapes (services/openDestination.js follows them):
//   { kind: 'navigate', screen, params }   a screen
//   { kind: 'url', url }                   the OS (maps / directions)
//   { kind: 'inline', items }              the exact objects, listed in place; each item carries its own destination

export const DESTINATION_CONTRACT = {
  // "Meet someone new tonight", "N people nearby to meet" -> People (Discover in people mode), never the things list
  meet_people: { kind: 'navigate', screen: 'Discover', params: { initialMode: 'people' } },
  // "Join a gathering", any gathering card -> that gathering's detail
  gathering: { kind: 'navigate', screen: 'GatheringDetail', requires: ['gatheringId'] },
  // "Coastal Coffee made you an offer" -> the request's detail, opened ON that offer
  business_offer: { kind: 'navigate', screen: 'BusinessRequestDetail', requires: ['requestId', 'focusOfferId'] },
  business_request: { kind: 'navigate', screen: 'BusinessRequestDetail', requires: ['requestId'] },
  business: { kind: 'navigate', screen: 'BusinessProfile', requires: ['partnerId'] },
  // a perk -> Discover's Perks with that perk selected in place (its redemption controls open under its card)
  perk: { kind: 'navigate', screen: 'Discover', params: { initialMode: 'things', initialTypeTab: 'perks' }, requires: ['selectPerkId'] },
  community: { kind: 'navigate', screen: 'CommunityDetail', requires: ['communityId'] },
  friend_request: { kind: 'navigate', screen: 'ViewProfile', requires: ['userId'] },
  place: { kind: 'url' },
  // Home Quick Stats: "3 gatherings today" -> Discover -> Gatherings narrowed to today (exactly the set counted; the separate
  // Gatherings feed folded into Discover, screen-reduction audit B3);
  // "You crossed paths with Sam" -> Sam's profile
  gatherings_today: { kind: 'navigate', screen: 'Discover', params: { initialMode: 'things', initialTypeTab: 'gatherings', gatheringFilters: { when: 'today' } } },
  crossed_paths: { kind: 'navigate', screen: 'ViewProfile', requires: ['userId'] },
  // "2 of your friends are making plans", "3 things start in the next 30 minutes": one thing -> its detail; several -> those
  // exact gatherings inline, each to its own detail. Never the whole Discover list.
  gathering_set: { kind: 'set', item: 'gathering' },
};

// Does `destination` honor the contract for `claim`? null destination = nothing happens on tap, which is always allowed (a
// card with no real destination is never a wrong screen).
export function satisfiesContract(claim, destination) {
  const rule = DESTINATION_CONTRACT[claim];
  if (!rule) return false;
  if (destination == null) return true;
  if (rule.kind === 'set') {
    if (destination.kind === 'inline') {
      return Array.isArray(destination.items) && destination.items.length > 1
        && destination.items.every((it) => satisfiesContract(rule.item, it?.destination));
    }
    return satisfiesContract(rule.item, destination);
  }
  if (destination.kind !== rule.kind) return false;
  if (rule.kind === 'url') return typeof destination.url === 'string' && destination.url.length > 0;
  if (destination.screen !== rule.screen) return false;
  const params = destination.params ?? {};
  for (const [k, v] of Object.entries(rule.params ?? {})) {
    const same = v && typeof v === 'object' ? JSON.stringify(params[k]) === JSON.stringify(v) : params[k] === v;
    if (!same) return false;
  }
  return (rule.requires ?? []).every((k) => params[k] != null);
}
