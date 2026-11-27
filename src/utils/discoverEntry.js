// Device test (owner, 2026-11-27): Home's "Explore Nearby" opened Discover with an earlier Coffee pick still selected.
// Discover is a mounted tab; `navigate('Discover')` with no params keeps the PREVIOUS params object, so nothing re-applied
// and whatever the last entry or ask set stayed on screen. Three kinds of arrival, one rule each:
//   - a general entry ("Explore Nearby", "Explore things to do", Create's "Browse what's already out there") = a NEW
//     discovery session: no activity, category, time, Outdoor/Indoor, Open now, typed ask or category view carried over;
//   - a contextual entry (a Home tile, a weather card, a perk link) = exactly the context it carries (existing params);
//   - returning (Back from a detail screen, the tab bar) = no new params object, so the session is kept as it was.
// A general entry always sends a NEW params object (freshDiscovery = the time of the tap), so a second tap applies again.
export function exploreDiscoverParams(now = Date.now()) {
  return { initialMode: 'things', initialTypeTab: 'all', freshDiscovery: now };
}

export function openExploreDiscover(navigation, now = Date.now()) {
  navigation.navigate('Discover', exploreDiscoverParams(now));
}

export function isFreshDiscoverEntry(params) {
  return typeof params?.freshDiscovery === 'number';
}

// The saved typed-ask session (device + account sync) from BEFORE a clean entry is never restored afterwards; one the
// person started after it (on any device) still syncs as before.
export function sessionPredatesFreshEntry(session, freshSince) {
  if (!session || !freshSince) return false;
  return (session.updatedAt ?? 0) <= freshSince;
}
