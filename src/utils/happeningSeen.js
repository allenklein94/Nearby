// Owner item 26 (2026-10-11): "Something is happening near you". ONE record, shared by Home's Nearby Right Now and
// Discover's Happening Now, of which gatherings a happening-now section has already shown this session. A gathering
// counts as new once across BOTH surfaces: seen on Home, it does not arrive again on Discover (and vice versa), and
// switching tabs or coming Back never replays. Session-scoped on purpose (module memory, not storage): a fresh app start
// may greet what is happening once more. Only stable gathering ids go in; nothing else is kept.
const seen = new Set();

// Marks every id as seen and returns the ones that were not seen before (empty = nothing new, no ripple).
export function takeNewHappening(ids, store = seen) {
  const fresh = [];
  for (const id of ids ?? []) {
    if (id == null || store.has(id)) continue;
    store.add(id);
    fresh.push(id);
  }
  return fresh;
}

// Idea "207": whether takeNewHappening would find something new, without marking anything (Home's one-moment-per-visit rule asks).
export function hasNewHappening(ids, store = seen) {
  return (ids ?? []).some((id) => id != null && !store.has(id));
}

export function resetHappeningSeen(store = seen) {
  store.clear();
}
