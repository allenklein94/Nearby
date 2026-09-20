import { MUTUAL_FREE_TONIGHT_LINE } from './freeTonight';
// Item 77: a Dating candidate is explained the same way every other recommendation is -- why, where, when -- from real
// fields only, never a bare "Suggested Match". WHY = the interests you both really have; with none, Browse says the one
// true thing (they fit the person's own dating preferences) and Crossed Paths lets the crossing itself be the reason.
// WHERE/WHEN = the real crossing (about 35 ft + how long ago), the shared gathering, or -- for Browse, which is only
// bounded to the person's ~7-mile area buckets and carries no distance -- "In your area". No availability, mileage or
// "available tonight" is stated unless BOTH people opted in to "Free tonight" (`mutualFreeTonight`, decided by the server).
// Exact distance is never stated here: it is shown only after a match (Matches screen).
export function datingCardFacts(item, { mode = 'crossedPaths', gatheringText = null, crossedPathsTime = null, mutualFreeTonight = false } = {}) {
  const shared = (item?.sharedInterests ?? []).filter(Boolean);
  let reason = null;
  if (shared.length > 0) reason = { kind: 'shared_interests', tags: shared };
  else if (mode === 'browse') reason = { kind: 'preferences', text: 'Fits your dating preferences' };

  let where;
  if (mode === 'browse') where = '📍 In your area';
  else if (gatheringText) where = `🗓️ ${gatheringText}`;
  else where = `📍 Within about 35 feet${crossedPathsTime ? ` · ${crossedPathsTime}` : ''}`;
  return { reason, where, availability: mutualFreeTonight === true ? MUTUAL_FREE_TONIGHT_LINE : null };
}
