import { CATEGORY_GROUPS } from './gatheringCategories';

// Search synonyms (owner items 31/32, 2026-09-21). The taxonomy is the one canonical list of tags; PEOPLE and
// BUSINESSES say the same thing many ways ("cafe", "coffee shop", "coffeehouse" -> Coffee; "gym", "fitness center" ->
// Gyms). This is the ONE deterministic phrase -> canonical tag(s) table, used wherever a typed phrase must find a
// category: consumer search (gatherings, communities, offers), the business signup type search, and the emerging-
// category flagging (a phrase that is a known synonym is never "a new category"). Rule-based, never AI. A phrase may
// map to several tags ("happy hour" -> Happy Hour + Bars & Lounges). Adding a synonym = one row here + the seed in a
// migration (categorySynonyms.test.js keeps the two identical and every tag canonical).
export const SYNONYM_GROUPS = [
  { tags: ['Coffee'], phrases: ['cafe', 'café', 'coffee shop', 'coffeehouse', 'coffee house', 'coffee bar', 'coffee place', 'specialty coffee', 'espresso', 'espresso bar', 'coffee roaster', 'latte'] },
  { tags: ['Gyms', 'Fitness'], phrases: ['gym', 'fitness center', 'fitness centre', 'health club', 'workout', 'weight room', 'exercise'] },
  { tags: ['Happy Hour', 'Bars & Lounges'], phrases: ['happy hour', 'drink specials'] },
  { tags: ['Bars & Lounges'], phrases: ['bar', 'pub', 'cocktail bar', 'lounge', 'tavern', 'cocktails'] },
  { tags: ['Breweries'], phrases: ['brewery', 'brewpub', 'craft beer', 'taproom', 'tap room', 'beer'] },
  { tags: ['Wine', 'Wineries'], phrases: ['winery', 'wine bar', 'wine tasting', 'vineyard'] },
  { tags: ['Bakeries'], phrases: ['bakery', 'bake shop', 'patisserie', 'pastry shop'] },
  { tags: ['Brunch'], phrases: ['brunch spot', 'breakfast spot'] },
  { tags: ['Restaurants'], phrases: ['restaurant', 'eatery', 'diner', 'bistro', 'dinner', 'lunch'] },
  { tags: ['Fine Dining'], phrases: ['upscale dining', 'tasting menu', 'fancy dinner'] },
  { tags: ['Fast Casual'], phrases: ['quick bite', 'counter service'] },
  { tags: ['Food Trucks'], phrases: ['food truck', 'street food'] },
  { tags: ['Dessert & Ice Cream'], phrases: ['ice cream', 'gelato', 'froyo', 'frozen yogurt', 'dessert', 'sweets', 'creamery'] },
  { tags: ['Yoga'], phrases: ['yoga studio', 'hot yoga', 'vinyasa'] },
  { tags: ['Pilates'], phrases: ['pilates studio', 'reformer'] },
  { tags: ['Martial Arts'], phrases: ['karate', 'judo', 'jiu jitsu', 'bjj', 'taekwondo', 'boxing', 'mma', 'dojo'] },
  { tags: ['Pickleball'], phrases: ['pickle ball', 'pickleball court', 'paddle'] },
  { tags: ['Padel'], phrases: ['padel tennis', 'padel court', 'padel club'] },
  { tags: ['Tennis'], phrases: ['tennis court', 'tennis club'] },
  { tags: ['Paddleboarding'], phrases: ['paddleboard', 'paddle board', 'paddle boarding', 'stand up paddle', 'sup board'] },
  { tags: ['Kayaking'], phrases: ['kayak'] },
  { tags: ['Climbing'], phrases: ['rock climbing', 'bouldering', 'climbing gym'] },
  { tags: ['Mini Golf'], phrases: ['miniature golf', 'putt putt', 'crazy golf'] },
  { tags: ['Golf'], phrases: ['driving range', 'golf course', 'indoor golf', 'golf simulator'] },
  { tags: ['Bowling'], phrases: ['bowling alley'] },
  { tags: ['Arcade'], phrases: ['arcade bar', 'video games', 'game room'] },
  { tags: ['Escape Rooms'], phrases: ['escape room', 'puzzle room'] },
  { tags: ['Live Music'], phrases: ['live band', 'gig', 'music venue'] },
  { tags: ['Nightclubs'], phrases: ['nightclub', 'night club', 'dance club', 'club night'] },
  { tags: ['Massage'], phrases: ['massage therapy', 'spa massage'] },
  { tags: ['Salons'], phrases: ['hair salon', 'hairdresser', 'hair stylist'] },
  { tags: ['Barbers'], phrases: ['barber shop', 'barbershop'] },
  // Item 161 (2026-10-03): everyday NEED wording ("I need a haircut / flowers / a gift / a dog groomer") that named no tag.
  { tags: ['Barbers', 'Salons'], phrases: ['haircut', 'hair cut'] },
  { tags: ['Florist'], phrases: ['flowers', 'bouquet'] },
  { tags: ['Gift Shop'], phrases: ['gift', 'present'] },
  { tags: ['Grooming'], phrases: ['dog groomer', 'pet grooming'] },
  { tags: ['Nails'], phrases: ['nail salon', 'manicure', 'pedicure'] },
  { tags: ['Spa Day'], phrases: ['day spa', 'spa'] },
  { tags: ['Car Wash'], phrases: ['car wash', 'auto wash'] },
  { tags: ['Auto Repair'], phrases: ['mechanic', 'car repair', 'auto shop', 'garage'] },
  { tags: ['Cleaning'], phrases: ['house cleaning', 'maid service', 'cleaners'] },
  { tags: ['Plumbing'], phrases: ['plumber'] },
  { tags: ['Electrical'], phrases: ['electrician'] },
  { tags: ['Hotels'], phrases: ['hotel', 'inn', 'motel', 'lodging', 'boutique hotel'] },
  { tags: ['Museums'], phrases: ['museum', 'art museum'] },
  { tags: ['Dogs', 'Dog Parks'], phrases: ['dog park', 'off leash'] },
  { tags: ['Photography'], phrases: ['photo walk', 'photographer'] },
  { tags: ['Hiking'], phrases: ['hike', 'trail walk'] },
  { tags: ['Cooking Class'], phrases: ['cooking lesson', 'culinary class'] },
  // Item 182 (owner, LOCKED): "I need to get CPR certified" reaches Certifications (the tag's own name covers certification).
  { tags: ['Certifications'], phrases: ['certified'] },
];

// Distinct named sports Nearby has NO category for (owner rule, item 75): a specific multi-word phrase beats a broad
// single-word synonym, and a distinct sport is never silently redirected into a related one. "paddle tennis" must not
// become Pickleball through "paddle" (nor Tennis through "tennis"), so these phrases compete like any other and map to
// NOTHING: the search stays literal until a real category exists (then move the phrase to SYNONYM_GROUPS, or let the
// tag's own name match it). Never create a category just to resolve a collision.
// Item 182 (owner, LOCKED): bare "business class" is an airline seat as often as a course, so it maps to nothing (once
// "class" and "classes" share one key, it would otherwise fall into the generic Classes tag).
export const UNMATCHED_PHRASES = ['paddle tennis', 'platform tennis', 'business class'];

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Plural trim per word so a singular and its plural share one key (item 182): "cafes" = "cafe", "classes" = "class",
// "beaches" = "beach", "boxes" = "box"; a word whose singular ends in -che/-she/-sse also drops that e, so "headache" and
// "headaches" agree. The SAME rule lives in docs/business.html (applyKey) and the server's _category_phrase_key and
// _category_search_key; pluralNormalization.regression.test.js keeps the copies identical.
export const singular = (w) => {
  if (w.length > 4 && /(ss|ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /(ss|ch|sh)e$/.test(w)) return w.slice(0, -1);
  return w.length > 4 && !w.endsWith('ss') ? w.replace(/s$/, '') : w;
};
const key = (s) => norm(s).split(' ').map(singular).join(' ');
// The same normalized words tagsInText indexes into (item 162 locates a task verb relative to a category phrase).
export function normalizedWords(text) {
  return key(String(text ?? '')).split(' ').filter(Boolean);
}

// Item 182: keys of category names that are only a FORMAT word. Once "class" and "classes" share one key, the generic
// Classes tag must not outrank a named activity next to it ("yoga class" stays Yoga).
const GENERIC_FORMAT_KEYS = new Set(['class']);

const PHRASE_TO_TAGS = new Map();
for (const { tags, phrases } of SYNONYM_GROUPS) {
  for (const p of phrases) {
    const k = key(p);
    PHRASE_TO_TAGS.set(k, [...new Set([...(PHRASE_TO_TAGS.get(k) ?? []), ...tags])]);
  }
}
// A canonical tag's own name is also a phrase for itself ("Wine" finds Wine); it never overrides a synonym row. Built per
// call from the live taxonomy so a tag an admin adds later (registerCategoryTag) matches with no other step.
function phraseMap() {
  const m = new Map(PHRASE_TO_TAGS);
  for (const p of UNMATCHED_PHRASES) if (!m.has(key(p))) m.set(key(p), []);
  for (const g of CATEGORY_GROUPS) {
    for (const t of [...g.tags, ...(g.businessOnlyTags ?? [])]) {
      const k = key(t);
      if (!m.has(k)) m.set(k, [t]);
    }
  }
  return m;
}

// The canonical tag whose own name has this key, or null.
function ownTagOf(k) {
  for (const g of CATEGORY_GROUPS) for (const t of [...g.tags, ...(g.businessOnlyTags ?? [])]) if (key(t) === k) return t;
  return null;
}

// Synonyms taught centrally (category_synonyms, migration 20270191) arrive here on sign-in. Only a phrase whose tag
// exists in the taxonomy is kept; nothing is ever removed, and the built-in rows above always work with no network.
export function registerSynonyms(rows) {
  const known = new Set(CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]));
  let added = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (typeof r?.phrase !== 'string' || !known.has(r?.tag)) continue;
    const k = key(r.phrase);
    if (k.length < 2) continue;
    // A canonical tag's own name is never a synonym of a DIFFERENT tag ("padel" can never become Pickleball).
    const own = ownTagOf(k);
    if (own && own !== r.tag) continue;
    const cur = PHRASE_TO_TAGS.get(k) ?? [];
    if (cur.includes(r.tag)) continue;
    PHRASE_TO_TAGS.set(k, [...cur, r.tag]);
    added += 1;
  }
  return added;
}

// Canonical tags a typed phrase stands for: the whole query, or a whole-word phrase inside it ("cafe near me").
// No match = empty (callers fall back to their literal search); a phrase never matches inside a longer word.
export function tagsForPhrase(text) {
  const q = key(text);
  if (q.length < 2) return [];
  const map = phraseMap();
  if (map.has(q)) return [...map.get(q)];
  // The longest whole-word phrase inside the query wins, so a specific phrase beats a broad one ("paddle tennis" > "paddle").
  // A generic format word ("class") only names the format: any other category in the query wins ("yoga class" = Yoga),
  // and it counts alone only when nothing else matched ("find a class" = Classes).
  const padded = ` ${q} `;
  let best = null;
  let generic = null;
  for (const [phrase, tags] of map) {
    if (phrase.length < 3 || !padded.includes(` ${phrase} `)) continue;
    if (GENERIC_FORMAT_KEYS.has(phrase)) { generic = { phrase, tags }; continue; }
    if (!best || phrase.length > best.phrase.length) best = { phrase, tags };
  }
  const hit = best ?? generic;
  return hit ? [...hit.tags] : [];
}

// Every canonical tag the text NAMES, in word order (item 130): "dinner and live music" -> [Restaurants?, Live Music]. Same
// phrase map and whole-word rule as tagsForPhrase; longest phrase first, and a word belongs to at most one phrase, so
// "mini golf" is Mini Golf, never Golf too. `word` = the first matched word as it appears normalized (for locating it);
// `prev` = up to two normalized words right before the phrase ("near the" in "dinner near the park").
export function tagsInText(text) {
  const words = key(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  const map = phraseMap();
  const hits = [];
  for (const [phrase, tags] of map) {
    if (phrase.length < 3 || !tags.length) continue;
    const pw = phrase.split(' ');
    for (let i = 0; i + pw.length <= words.length; i++) {
      if (pw.every((w, j) => words[i + j] === w)) hits.push({ start: i, len: pw.length, chars: phrase.length, tags });
    }
  }
  hits.sort((a, b) => b.chars - a.chars || a.start - b.start);
  const taken = new Set();
  const kept = [];
  for (const h of hits) {
    const span = Array.from({ length: h.len }, (_, j) => h.start + j);
    if (span.some((i) => taken.has(i))) continue;
    span.forEach((i) => taken.add(i));
    kept.push(h);
  }
  return kept.sort((a, b) => a.start - b.start).flatMap((h) => h.tags.map((tag) => ({ tag, word: words[h.start], prev: words.slice(Math.max(0, h.start - 2), h.start).join(' '), start: h.start })));
}

// Everything a search should look for: the person's own words first, then the canonical tag names their words stand for.
export function expandSearchTerms(text) {
  const own = String(text ?? '').trim();
  if (!own) return [];
  const terms = [own];
  for (const t of tagsForPhrase(own)) if (!terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
  return terms;
}

export function seedRows() {
  return SYNONYM_GROUPS.flatMap(({ tags, phrases }) => phrases.flatMap((p) => tags.map((t) => ({ phrase: key(p), tag: t }))));
}
