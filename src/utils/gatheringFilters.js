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
//   term      = a word an entry carried (a Home Quick Pick's "volleyball" inside Sports): the title or description contains it,
//               or the gathering was started from the pick that word belongs to (its stored activity, owner 2026-10-27)
//   local     = within LOCAL_FILTER_MILES (the feed's "Local" tier); off = everything Discover loaded (its wide tier)
//   pick      = the Home Quick Pick the person tapped ("Dinner"), owner 2026-10-26: shown as ONE chip in its own words while
//               category + term stay the internal matching (Foodie + "dinner"); removing it clears all three together
// Outdoor / Indoor stays Discover's own environment filter (one rule, constants/environmentMatch.js), not a copy here.
import { EXPERIENCE_PARTY_TYPE_OPTIONS } from '../constants/businessAttributes';
import { matchesDateFilter, DATE_OPTIONS } from './gatheringDateFilter';
import { attendeeTotal } from './gatheringFullness';
import { TRENDING_ATTENDANCE_MIN } from '../constants/trending';
import { quickPickForActivity } from './timeContext';

export const LOCAL_FILTER_MILES = 1;
export const PRICE_FILTER_OPTIONS = [null, 'free', '$', '$$', '$$$'];
export const PLAN_KIND_FILTER_OPTIONS = [null, ...EXPERIENCE_PARTY_TYPE_OPTIONS.filter((o) => o.key).map((o) => o.key)];

export const GATHERING_FILTER_DEFAULTS = Object.freeze({
  when: 'anytime', category: null, term: null, pick: null, forYou: false, trending: false, price: null, planKind: null, local: false,
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
    ...(p && typeof p.pick === 'string' && p.pick && ((typeof p.category === 'string' && p.category) || (typeof p.term === 'string' && p.term.trim())) ? { pick: p.pick } : {}),
  };
}

// The Quick Pick the selection still stands for (null = none: show category and term as they are).
export function pickedActivity(f) {
  return f?.pick && (f.category || f.term) ? f.pick : null;
}

// Removing the pick removes everything it put there (its category and its word), nothing else (time, other chips stay).
export function clearPick(f) {
  return { ...f, pick: null, category: null, term: null };
}

// Create from an empty Gatherings result: the category, and the person's own words for the activity when a pick set it.
// A selected Tonight carries too (owner, 2026-10-27): Create's Tonight with today's date only, never a clock time, so Create
// asks the time (the same day-only path as a named weekday). Other windows (Now, Today, This Weekend) carry nothing.
export function createParamsFromGatheringFilters(f, pickLabel = null, now = new Date()) {
  const tonight = f?.when === 'tonight'
    ? { quickStartWhenPreset: 'tonight', quickStartDateISO: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
    : {};
  return {
    quickStartCategory: f?.category || undefined,
    quickStartTitle: pickedActivity(f) && pickLabel ? pickLabel : undefined,
    // The pick itself (its label key, "Dinner"), kept on the gathering as its activity whatever the title becomes.
    quickStartActivity: pickedActivity(f) && f.category ? f.pick : undefined,
    ...tonight,
  };
}

// Where every "show me gatherings" entry goes now that the separate feed is retired: Discover -> Gatherings, carrying only
// the filters that entry really implies (a fresh params object each time, so Discover applies it once).
export const GATHERINGS_TAB = Object.freeze({ initialMode: 'things', initialTypeTab: 'gatherings' });
export function gatheringsTabParams(filters = null) {
  return filters ? { ...GATHERINGS_TAB, gatheringFilters: { ...filters } } : { ...GATHERINGS_TAB };
}

function matchesTerm(g, term) {
  const word = term.toLowerCase();
  if (quickPickForActivity(g.interest_tag, g.activity)?.searchTerm === word) return true;
  return `${g.title ?? ''} ${g.description ?? ''}`.toLowerCase().includes(word);
}

export function applyGatheringFilters(list, f, { forYouCategories = [] } = {}) {
  const filters = { ...GATHERING_FILTER_DEFAULTS, ...(f ?? {}) };
  return (list ?? []).filter((g) => {
    if (!g) return false;
    if (filters.forYou ? !forYouCategories.includes(g.interest_tag) : (filters.category && g.interest_tag !== filters.category)) return false;
    if (filters.trending && attendeeTotal(g) < TRENDING_ATTENDANCE_MIN) return false;
    if (!matchesDateFilter(g.scheduled_at, filters.when)) return false;
    if (filters.term && !matchesTerm(g, filters.term)) return false;
    if (filters.price && g.price_level !== filters.price) return false;
    if (filters.planKind && g.party_type !== filters.planKind) return false;
    if (filters.local && !(typeof g.distanceMiles === 'number' && g.distanceMiles <= LOCAL_FILTER_MILES)) return false;
    return true;
  });
}

// For You and a single category replace each other (as on the old feed).
// A pick's word belongs to its category: changing the category drops the pick and its word with it.
export function toggleForYou(f) {
  const base = f.pick ? { ...f, pick: null, term: null } : f;
  return f.forYou ? { ...base, forYou: false } : { ...base, forYou: true, category: null };
}
export function selectCategory(f, tag) {
  const base = f.pick ? { ...f, pick: null, term: null } : f;
  return { ...base, category: f.category === tag ? null : tag, forYou: false };
}
