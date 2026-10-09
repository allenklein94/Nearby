// The gathering filters (screen-reduction audit B3, owner 2026-10-09): the separate Gatherings feed folded into Discover ->
// Gatherings, keeping its useful filters inside Discover's existing results instead of on another screen. ONE pure filter
// step, the same wherever gatherings are narrowed; the ORDER then comes from Discover's one ranking ladder (compareDiscover),
// so the same criteria never rank differently by entry point.
//   when      = the shared date filter (utils/gatheringDateFilter.js), incl. tonight / morning / afternoon from Home
//   category  = one canonical tag, or For You = the person's For You categories (they replace each other)
//   trending  = at least TRENDING_ATTENDANCE_MIN people going (the SAME rule as Discover's Trending Near You section; the old
//               feed's extra "top 20 in your stored profile area" cut is gone, so Trending means one measurable thing)
//   price     = the host's declared price level (free / $ / $$ / $$$); undeclared is left out while a price is chosen
//   planKind  = the host's declared party_type; undeclared is left out while a kind is chosen
//   term      = a word an entry carried (a Home Quick Pick's "volleyball" inside Sports): the title or description contains it
//   local     = within LOCAL_FILTER_MILES (the feed's "Local" tier); off = everything Discover loaded (its wide tier)
// Outdoor / Indoor stays Discover's own environment filter (one rule, constants/environmentMatch.js), not a copy here.
import { EXPERIENCE_PARTY_TYPE_OPTIONS } from '../constants/businessAttributes';
import { matchesDateFilter, DATE_OPTIONS } from './gatheringDateFilter';
import { attendeeTotal } from './gatheringFullness';
import { TRENDING_ATTENDANCE_MIN } from '../constants/trending';

export const LOCAL_FILTER_MILES = 1;
export const PRICE_FILTER_OPTIONS = [null, 'free', '$', '$$', '$$$'];
export const PLAN_KIND_FILTER_OPTIONS = [null, ...EXPERIENCE_PARTY_TYPE_OPTIONS.filter((o) => o.key).map((o) => o.key)];

export const GATHERING_FILTER_DEFAULTS = Object.freeze({
  when: 'anytime', category: null, term: null, forYou: false, trending: false, price: null, planKind: null, local: false,
});

export function hasActiveGatheringFilters(f) {
  if (!f) return false;
  return Object.keys(GATHERING_FILTER_DEFAULTS).some((k) => f[k] !== GATHERING_FILTER_DEFAULTS[k]);
}

// The filters an entry point carries in (Home Quick Picks, "N gatherings today", pushes). Anything not given = default; an
// unknown value is ignored rather than turning into a filter nobody can see.
export function gatheringFiltersFromParams(p = {}) {
  return {
    ...GATHERING_FILTER_DEFAULTS,
    ...(p && DATE_OPTIONS.some((o) => o.key === p.when) ? { when: p.when } : {}),
    ...(p && typeof p.category === 'string' && p.category ? { category: p.category } : {}),
    ...(p && typeof p.term === 'string' && p.term.trim() ? { term: p.term.trim() } : {}),
  };
}

// Where every "show me gatherings" entry goes now that the separate feed is retired: Discover -> Gatherings, carrying only
// the filters that entry really implies (a fresh params object each time, so Discover applies it once).
export const GATHERINGS_TAB = Object.freeze({ initialMode: 'things', initialTypeTab: 'gatherings' });
export function gatheringsTabParams(filters = null) {
  return filters ? { ...GATHERINGS_TAB, gatheringFilters: { ...filters } } : { ...GATHERINGS_TAB };
}

export function applyGatheringFilters(list, f, { forYouCategories = [] } = {}) {
  const filters = { ...GATHERING_FILTER_DEFAULTS, ...(f ?? {}) };
  return (list ?? []).filter((g) => {
    if (!g) return false;
    if (filters.forYou ? !forYouCategories.includes(g.interest_tag) : (filters.category && g.interest_tag !== filters.category)) return false;
    if (filters.trending && attendeeTotal(g) < TRENDING_ATTENDANCE_MIN) return false;
    if (!matchesDateFilter(g.scheduled_at, filters.when)) return false;
    if (filters.term && !`${g.title ?? ''} ${g.description ?? ''}`.toLowerCase().includes(filters.term.toLowerCase())) return false;
    if (filters.price && g.price_level !== filters.price) return false;
    if (filters.planKind && g.party_type !== filters.planKind) return false;
    if (filters.local && !(typeof g.distanceMiles === 'number' && g.distanceMiles <= LOCAL_FILTER_MILES)) return false;
    return true;
  });
}

// For You and a single category replace each other (as on the old feed).
export function toggleForYou(f) {
  return f.forYou ? { ...f, forYou: false } : { ...f, forYou: true, category: null };
}
export function selectCategory(f, tag) {
  return { ...f, category: f.category === tag ? null : tag, forYou: false };
}
