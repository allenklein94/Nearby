// Interested straight from a card (owner, 2026-10-25: a narrow exception to item 200, see components/CardInterestedStar.js).
// The rules only; the state lives in hooks/useCardInterested.js. Interested itself is unchanged: the private "maybe"
// (set_gathering_interested), never a commitment, never shown to anyone but the person (the host's anonymous count aside).

// The ☆ shows only beside a JOIN action (Join / Request to Join / Join Waitlist: the viewer has no relation yet and
// may still join), and only once the person's Interested set is known (unknown = no star, never a guessed "off").
export function cardInterestedEligible(action, interestedSet) {
  return action?.kind === 'join' && interestedSet instanceof Set;
}

// The server's Interested ids (array or Set; null = unknown) with this surface's taps not yet reflected by a reload.
export function interestedSetWith(ids, override = {}) {
  if (ids == null) return null;
  const set = new Set(ids);
  Object.entries(override).forEach(([id, on]) => (on ? set.add(id) : set.delete(id)));
  return set;
}

// A fresh read is the truth: drop every tap override except a save still in flight (its own result settles it).
export function overridesAfterRefresh(override, busyIds) {
  const kept = {};
  Object.entries(override).forEach(([id, on]) => { if (busyIds.has(id)) kept[id] = on; });
  return kept;
}

// Idea "356": the one-time explanation of the OPTIONAL anonymous sharing follows the person's first Interested wherever it was
// tapped, worded by their current choice (missing = off), until acknowledged. null = nothing to explain.
export function firstInterestedDisclosureKey(prefs) {
  if (!prefs || prefs.acknowledged) return null;
  return prefs.share === true ? 'ui.gatheringDetail.demandDisclosure' : 'ui.gatheringDetail.demandDisclosureOptional';
}
