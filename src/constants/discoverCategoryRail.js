// Discover's category rail (owner item 34, 2026-09-21). The BACKEND keeps every major (19 today: the owner's 16 plus
// Health & Personal Care, Education & Classes and Attractions, which stay majors until supply says otherwise); the
// UI must not read as a directory. Discover leads with a short "What are you into?" rail and tucks the long tail
// behind "More", which expands in place (global rule 5: exploring populates inline). Labels here are display-only
// shorthands; the tapped group is always the real canonical group.
export const DISCOVER_RAIL_PRIMARY = [
  { key: 'food_drink', label: 'Food & Drink' },
  { key: 'activities_recreation', label: 'Activities' },
  { key: 'entertainment_nightlife', label: 'Entertainment' },
  { key: 'outdoors_nature', label: 'Outdoors' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'wellness_beauty', label: 'Wellness' },
  { key: 'family_kids', label: 'Family' },
];

// { primary, more }: primary keeps the curated order and short labels; more is every other real group, in taxonomy
// order, so a group added later is reachable under More without touching this file.
export function railGroups(groups) {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const primary = DISCOVER_RAIL_PRIMARY
    .filter((p) => byKey.has(p.key))
    .map((p) => ({ group: byKey.get(p.key), label: p.label }));
  const shown = new Set(primary.map((p) => p.group.key));
  const more = groups.filter((g) => !shown.has(g.key)).map((g) => ({ group: g, label: g.label }));
  return { primary, more };
}
