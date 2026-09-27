// Search result tabs (owner item 93). The search itself still covers the whole graph (item 92); the UI shows it in
// manageable pieces. While a search is active in Discover's All view, the type chips give way to result tabs, and a tab
// exists only when it has results for the current term:
//   Top Results = the activity row + a short preview of at most TOP_KIND_LIMIT kinds, TOP_PER_KIND items each
//   Places      = Nearby businesses + Places
//   Activities  = the activity/category row + communities (not "Things To Do": that is the Discover mode itself)
//   Plans       = gatherings (events are gatherings)
//   Offers      = perks
// Kinds in Top follow a fixed order (plans, places, offers, activities) so the preview never reshuffles as lists load.
export const TOP_KIND_LIMIT = 3;
export const TOP_PER_KIND = 2;

export const RESULT_TABS = [
  { key: 'top', label: 'Top Results' },
  { key: 'places', label: 'Places' },
  { key: 'activities', label: 'Activities' },
  { key: 'plans', label: 'Plans' },
  { key: 'offers', label: 'Offers' },
];

const TOP_ORDER = ['plans', 'places', 'offers', 'activities'];

// counts: { plans, places, offers, activities } (numbers of ELIGIBLE results for the current term).
// settled: every source has answered for the current term. Until then no category tab or section exists (Top Results
// shows one loader), so nothing stale or empty is presented as a result and nothing appears one by one.
const available = (counts, key) => Number(counts?.[key] ?? 0) > 0;

export function searchResultTabs(counts = {}, { settled = true } = {}) {
  return RESULT_TABS.filter((t) => t.key === 'top' || (settled && available(counts, t.key)))
    .map((t) => ({ ...t, count: t.key === 'top' ? null : Number(counts?.[t.key] ?? 0) }));
}

export function topResultKinds(counts = {}, { settled = true } = {}) {
  if (!settled) return [];
  return TOP_ORDER.filter((k) => available(counts, k)).slice(0, TOP_KIND_LIMIT);
}

// The tab actually shown: the chosen one while it still exists, else Top Results.
export function effectiveResultTab(chosen, tabs) {
  return (tabs ?? []).some((t) => t.key === chosen) ? chosen : 'top';
}

// Is a kind visible, and how many of it? { show, cap } -- cap null = the whole list.
export function resultKindView(kind, tab, topKinds) {
  if (tab === kind) return { show: true, cap: null };
  if (tab === 'top' && (topKinds ?? []).includes(kind)) return { show: true, cap: TOP_PER_KIND };
  return { show: false, cap: 0 };
}
