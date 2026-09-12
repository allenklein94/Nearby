// Item 62 (CLAUDE.md): "For each person: Sarah / Birthday / Anniversary /
// Graduation" -- a pure regrouping of the flat rows getMyOccasions() already
// returns, same "regroup what's already real, nothing new fetched" shape
// this codebase already uses elsewhere (e.g. groupIntentResultsByType).
// Grouping key prefers a real connected friend id (who_for_friend_id) over
// a hand-typed name (case/whitespace-insensitive, so "Sarah" and "sarah "
// land in the same bucket) over an "unlinked" bucket for anything with
// neither -- personal milestones ("My Promotion") and any occasion saved
// before this feature existed both land there, which is honest: Nearby
// doesn't know a person to attach them to.
export function groupOccasionsByPerson(occasions) {
  const groups = new Map();
  const order = [];
  const UNLINKED_KEY = '__unlinked__';

  for (const o of occasions ?? []) {
    let key;
    if (o.who_for_friend_id) key = `friend:${o.who_for_friend_id}`;
    else if (o.who_for_name && o.who_for_name.trim()) key = `name:${o.who_for_name.trim().toLowerCase()}`;
    else key = UNLINKED_KEY;

    if (!groups.has(key)) {
      groups.set(key, { key, label: o.who_for_name?.trim() || null, occasions: [] });
      order.push(key);
    }
    groups.get(key).occasions.push(o);
  }

  const linked = order.filter((k) => k !== UNLINKED_KEY).map((k) => groups.get(k));
  const unlinked = groups.has(UNLINKED_KEY) ? [groups.get(UNLINKED_KEY)] : [];
  return [...linked, ...unlinked];
}
