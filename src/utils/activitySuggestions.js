// Discover's activity suggestions (owner, 2026-10-27): the Gatherings tab's search box, while focused, offers activities the
// person can pick without knowing Nearby's categories. ONE catalog from what already exists, never a new category or list:
//   - every Home quick pick, whatever the time of day ("Dinner" = Foodie + "dinner", "Concert" = Concerts), in its own word;
//   - every consumer gathering category not already a word-less quick pick, by its translated name.
// Empty box = up to EMPTY_MAX activities that really have gatherings in the list given (most first, ties in list order; no
// counts shown or invented); typing = up to TYPED_MAX recognized activities (name prefix, then the synonym table), whether or
// not anything is loaded. The current activity is never suggested again. Picking one goes through selectActivity.
import { CATEGORY_GROUPS, NEED_TAG_KEYS, PERSONAL_INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { SYNONYM_GROUPS, tagsForPhrase } from '../constants/categorySynonyms';
import { allQuickPicks, quickPickForGathering } from './timeContext';

export const EMPTY_MAX = 6;
export const TYPED_MAX = 3;

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s&]/gu, ' ').replace(/\s+/g, ' ').trim();

// The consumer categories a person may hold as interests (never the dating tag), minus need/service categories.
const SUGGESTABLE_TAGS = PERSONAL_INTEREST_OPTIONS.filter((t, i, all) => all.indexOf(t) === i && !NEED_TAG_KEYS.includes(t));

let catalogCache = null;
// [{ key, pick, category, term, icon }]: picks first, then categories. key = pick label, or "category:<tag>".
export function activityCatalog() {
  if (catalogCache) return catalogCache;
  const picks = allQuickPicks();
  const wordless = new Map(picks.filter((p) => !p.searchTerm).map((p) => [p.category, p]));
  const iconFor = (tag) => CATEGORY_GROUPS.find((g) => g.tags.includes(tag))?.icon ?? '✨';
  catalogCache = [
    ...picks.map((p) => ({ key: p.label, pick: p.label, category: p.category, term: p.searchTerm ?? null, icon: p.icon })),
    ...SUGGESTABLE_TAGS.filter((t) => !wordless.has(t)).map((t) => ({ key: `category:${t}`, pick: null, category: t, term: null, icon: iconFor(t) })),
  ];
  return catalogCache;
}

// The catalog entry a tag stands for: its word-less quick pick when it has one, else the category.
function entryForTag(tag) {
  const catalog = activityCatalog();
  return catalog.find((a) => a.pick && !a.term && a.category === tag) ?? catalog.find((a) => !a.pick && a.category === tag) ?? null;
}

// The activity a gathering answers to: the word-bearing quick pick it was started from / names, else its category.
function entryForGathering(g) {
  const pick = quickPickForGathering(g);
  if (pick?.searchTerm) return activityCatalog().find((a) => a.pick === pick.label) ?? null;
  return g?.interest_tag ? entryForTag(g.interest_tag) : null;
}

export function isCurrentActivity(a, f) {
  if (!a || !f) return false;
  return f.pick ? a.pick === f.pick : (!a.pick || !a.term) && !!f.category && a.category === f.category && !f.term;
}

// labelOf(entry) = the entry's word in the person's language (screen passes quickOptionLabel / names.tag).
export function activitySuggestions({ text = '', gatherings = [], filters = null, labelOf = (a) => a.pick ?? a.category } = {}) {
  const q = norm(text);
  const keep = (a) => a && !isCurrentActivity(a, filters);
  if (!q) {
    const counts = new Map();
    const order = [];
    for (const g of gatherings ?? []) {
      const a = entryForGathering(g);
      if (!keep(a)) continue;
      if (!counts.has(a.key)) { counts.set(a.key, 0); order.push(a); }
      counts.set(a.key, counts.get(a.key) + 1);
    }
    return order
      .map((a, i) => ({ a, n: counts.get(a.key), i }))
      .sort((x, y) => y.n - x.n || x.i - y.i)
      .slice(0, EMPTY_MAX)
      .map(({ a }) => a);
  }
  const out = [];
  const add = (a) => { if (keep(a) && !out.some((o) => o.key === a.key)) out.push(a); };
  const catalog = activityCatalog();
  const startsWord = (name) => { const n = norm(name); return n.startsWith(q) || n.split(' ').some((w) => w.startsWith(q)); };
  // 1. The activity's own word: in the person's language, in English, or the pick's word ("dinner").
  for (const a of catalog) if (startsWord(labelOf(a)) || startsWord(a.pick ?? a.category) || (a.term && a.term.startsWith(q))) add(a);
  // 2. The synonym table (rule-based, English): the whole phrase, then a one-word phrase the typed letters begin.
  for (const tag of tagsForPhrase(text)) add(entryForTag(tag));
  if (q.length >= 3) {
    for (const group of SYNONYM_GROUPS) {
      if (group.phrases.some((p) => !p.includes(' ') && norm(p).startsWith(q))) for (const tag of group.tags) add(entryForTag(tag));
    }
  }
  return out.slice(0, TYPED_MAX);
}
