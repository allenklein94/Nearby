// Category parent/child tree (owner item 76, 2026-09-26). One tree over the EXISTING single sources, owning no list of its
// own except which food tags carry a cuisine and the cuisine words:
//   group (19 majors, CATEGORY_GROUPS)  ->  tag (leaf tags, CATEGORY_GROUPS[].tags)  ->  cuisine (CUISINE_OPTIONS)
//   Food & Drink -> Coffee, Restaurants, Bakeries, Bars & Lounges, Breweries...  ->  Restaurants -> Italian, Mexican, BBQ...
// Cuisine stays the business's own `cuisine` field (a declared fact, one per business, DB-CHECKed), NOT a leaf tag: an
// Italian restaurant is tag Restaurants + cuisine italian, so a cuisine never shows up as an interest or a gathering tag.
// searchScope(text) lets one search box go broad or narrow, deterministically (never AI):
//   "food & drink" -> group: every consumer tag in it     "restaurants" / "cafe" -> tag(s) (synonym table)
//   "italian" / "sushi" / "italian food near me" -> cuisine: businesses that DECLARED that cuisine (gatherings have none,
//   so they stay a literal text search; nothing is widened to every restaurant).
// A cuisine adjective counts only alone or with food words ("french class" is not French food); a dish word (sushi, pho,
// tacos) is enough on its own. Business-only tags are never in a consumer scope.
import { CATEGORY_GROUPS } from './gatheringCategories';
import { CUISINE_OPTIONS } from './businessAttributes';
import { tagsForPhrase } from './categorySynonyms';

// Food tags a cuisine is a child of (the Restaurants branch). Cuisine search reaches businesses under any of them.
export const CUISINE_PARENT_TAGS = ['Restaurants', 'Fine Dining', 'Fast Casual', 'Food Trucks', 'Takeout & Delivery', 'Family Dining', 'Foodie'];

// Cuisine words: [adjectives, dish words]. A dish word is specific enough alone; an adjective needs to stand alone or beside food words.
export const CUISINE_PHRASES = {
  italian: [['italian'], ['trattoria', 'pasta', 'osteria']],
  mexican: [['mexican'], ['tacos', 'taco', 'taqueria', 'burrito']],
  japanese: [['japanese'], ['sushi', 'ramen', 'izakaya']],
  chinese: [['chinese'], ['dim sum', 'dumplings']],
  american: [['american'], []],
  french: [['french'], ['brasserie']],
  mediterranean: [['mediterranean'], ['falafel']],
  indian: [['indian'], ['curry house']],
  thai: [['thai'], ['pad thai']],
  seafood: [['seafood'], ['oyster bar', 'fish restaurant', 'crab shack']],
  bbq: [['bbq', 'barbecue', 'barbeque'], ['smokehouse']],
  korean: [['korean'], ['korean bbq', 'bibimbap']],
  vietnamese: [['vietnamese'], ['pho', 'banh mi']],
  greek: [['greek'], ['gyro', 'gyros', 'souvlaki']],
};

const FOOD_CONTEXT = new Set(['food', 'restaurant', 'restaurants', 'dinner', 'lunch', 'brunch', 'cuisine', 'place', 'places', 'spot', 'spots', 'eat', 'eats', 'eating', 'takeout', 'meal', 'joint']);
const FILLER = new Set(['near', 'me', 'nearby', 'a', 'an', 'the', 'some', 'good', 'best', 'great', 'in', 'around', 'tonight', 'today', 'for', 'to', 'get', 'grab', 'want', 'i', 'we', 'find', 'any', 'local']);

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const has = (q, phrase) => ` ${q} `.includes(` ${phrase} `);

const consumerTags = (g) => [...g.tags];

// Longest cuisine phrase in the text: { key, phrase, dish } or null.
function findCuisine(q) {
  let best = null;
  for (const [key, [adjectives, dishes]] of Object.entries(CUISINE_PHRASES)) {
    for (const p of adjectives) if (has(q, p) && (!best || p.length > best.phrase.length)) best = { key, phrase: p, dish: false };
    for (const p of dishes) if (has(q, p) && (!best || p.length > best.phrase.length)) best = { key, phrase: p, dish: true };
  }
  return best;
}

// The cuisine a SEARCH names: a dish word, or a cuisine word alone / with only food + filler words.
export function cuisineForSearch(text) {
  const q = norm(text);
  const c = findCuisine(q);
  if (!c) return null;
  if (c.dish) return c.key;
  const rest = ` ${q} `.replace(` ${c.phrase} `, ' ').trim().split(' ').filter(Boolean);
  return rest.every((w) => FOOD_CONTEXT.has(w) || FILLER.has(w)) ? c.key : null;
}

// The cuisine an ASK names ("italian dinner tonight with my wife"): a dish word, or a cuisine word next to any food word.
export function cuisineFromText(text) {
  const q = norm(text);
  const c = findCuisine(q);
  if (!c) return null;
  if (c.dish) return c.key;
  const words = q.split(' ');
  return words.length === 1 || words.some((w) => FOOD_CONTEXT.has(w)) ? c.key : null;
}

export function groupForPhrase(text) {
  const q = norm(text);
  if (!q) return null;
  return CATEGORY_GROUPS.find((g) => norm(g.label) === q || norm(g.key.replace(/_/g, ' ')) === q) ?? null;
}

// { level: 'group' | 'tag' | 'cuisine' | null, group, tags, cuisine, path }.
export function searchScope(text) {
  const empty = { level: null, group: null, tags: [], cuisine: null, path: [] };
  if (!norm(text)) return empty;
  const g = groupForPhrase(text);
  const exactTags = tagsForPhrase(text);
  if (g && !exactTags.some((t) => norm(t) === norm(text))) {
    return { level: 'group', group: g.key, tags: consumerTags(g), cuisine: null, path: [g.label] };
  }
  const cuisine = cuisineForSearch(text);
  if (cuisine && exactTags.every((t) => CUISINE_PARENT_TAGS.includes(t))) {
    return { level: 'cuisine', group: 'food_drink', tags: [], cuisine, path: categoryPath({ tag: 'Restaurants', cuisine }) };
  }
  if (exactTags.length > 0) {
    return { level: 'tag', group: groupOfTag(exactTags[0])?.key ?? null, tags: exactTags, cuisine: null, path: categoryPath({ tag: exactTags[0] }) };
  }
  return empty;
}

function groupOfTag(tag) {
  return CATEGORY_GROUPS.find((g) => g.tags.includes(tag) || (g.businessOnlyTags ?? []).includes(tag)) ?? null;
}

// Breadcrumb labels, broad to narrow: ['Food & Drink', 'Restaurants', 'Italian'].
export function categoryPath({ group = null, tag = null, cuisine = null } = {}) {
  const g = tag ? groupOfTag(tag) : CATEGORY_GROUPS.find((x) => x.key === group);
  const out = [];
  if (g) out.push(g.label);
  if (tag && g) out.push(tag);
  const c = cuisine && CUISINE_OPTIONS.find((o) => o.key === cuisine && o.key !== 'other');
  if (c && tag && CUISINE_PARENT_TAGS.includes(tag)) out.push(c.label);
  return out;
}

// Direct children of a node: a group's consumer tags, a cuisine-parent tag's cuisines (never "Other"), else none.
export function childrenOf({ group = null, tag = null } = {}) {
  if (tag) return CUISINE_PARENT_TAGS.includes(tag) ? CUISINE_OPTIONS.filter((o) => o.key !== 'other').map((o) => ({ cuisine: o.key, label: o.label })) : [];
  const g = CATEGORY_GROUPS.find((x) => x.key === group);
  return g ? consumerTags(g).map((t) => ({ tag: t, label: t })) : [];
}
