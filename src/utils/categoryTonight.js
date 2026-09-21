import { gatheringTimeBadge } from './gatheringTimeLabel';

// "Happening tonight" inside a Discover category view: a slice of the gatherings that view ALREADY has (no second query),
// judged by the same time badge every card uses. A gathering moves into the slice and OUT of the list it came from, so it
// is never shown twice. Omitted when the view is itself a tonight context (it already is that list) or nothing qualifies.
const TONIGHT_BADGES = ['TONIGHT']; // a right-now start at 2 PM is not "tonight": it keeps its own badge in the main list
const TONIGHT_CONTEXTS = ['RIGHT NOW', 'TONIGHT']; // views that are already a today/now list

export function isTonightGathering(g, now = new Date()) {
  return TONIGHT_BADGES.includes(gatheringTimeBadge(g?.scheduled_at, now));
}

export function splitTonight(mainList, otherTimeList, contextTimeBucket = null, now = new Date()) {
  const main = Array.isArray(mainList) ? mainList : [];
  const other = Array.isArray(otherTimeList) ? otherTimeList : [];
  if (TONIGHT_CONTEXTS.includes(contextTimeBucket)) return { tonight: [], main, other };
  const seen = new Set();
  const tonight = [];
  for (const g of [...main, ...other]) {
    if (!g || seen.has(g.id) || !isTonightGathering(g, now)) continue;
    seen.add(g.id);
    tonight.push(g);
  }
  return {
    tonight,
    main: main.filter((g) => !seen.has(g.id)),
    other: other.filter((g) => !seen.has(g.id)),
  };
}
