// Item 77 (owner, LOCKED 2026-09-26): no category tree explosion. A food business is described on SEPARATE flat axes,
// never one deep path (Food -> Restaurant -> Italian -> Pizza -> Neapolitan -> Wood Fired):
//   category = a leaf tag (Restaurants)   cuisine = the business's one declared cuisine (italian)
//   specialty = not built yet (Pizza would live here, as its own flat axis, never as a child of a cuisine)
//   attributes = the one shared attribute vocabulary (wood-fired would be a key there, not a level)
// The tree (categoryTree.js) stops at cuisine: group -> tag -> cuisine, three levels, nothing below.
import { CATEGORY_GROUPS } from './gatheringCategories';
import { CUISINE_OPTIONS, BUSINESS_ATTRIBUTE_OPTIONS } from './businessAttributes';
import { SKILL_LEVELS } from './skillLevel';
import { RELATED_ACTIVITY_GROUPS } from './activityDictionary';
import { ACTIVITY_FORMATS } from './activityFormat';
import { GENRE_OPTIONS, MUSIC_TAGS } from '../utils/gatheringPractical';
import { childrenOf, CUISINE_PHRASES, cuisineForSearch, cuisineFromText, searchScope } from './categoryTree';

const ALL_TAGS = CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]);
const lower = (s) => s.toLowerCase();
const CUISINE_LABELS = CUISINE_OPTIONS.map((o) => lower(o.label));
const DISH_WORDS = Object.values(CUISINE_PHRASES).flatMap(([, dishes]) => dishes);

describe('the ontology stays flat (item 77)', () => {
  it('the tree has exactly three levels and nothing hangs below a cuisine', () => {
    for (const g of CATEGORY_GROUPS) {
      for (const child of childrenOf({ group: g.key })) {
        for (const grand of childrenOf({ tag: child.tag })) {
          expect(Object.keys(grand).sort()).toEqual(['cuisine', 'label']);
          expect(childrenOf({ cuisine: grand.cuisine })).toEqual([]);
        }
      }
    }
  });
  it('a cuisine is never a category tag, and no tag is a cuisine-qualified restaurant', () => {
    for (const t of ALL_TAGS) {
      expect(CUISINE_LABELS).not.toContain(lower(t));
      for (const c of CUISINE_LABELS.filter((x) => x !== 'other')) expect(lower(t).startsWith(`${c} `)).toBe(false);
    }
  });
  it('a dish or specialty word is never a category tag or a cuisine (it maps onto a cuisine, nothing nests)', () => {
    for (const d of [...DISH_WORDS, 'pizza', 'neapolitan', 'wood fired', 'wood-fired']) {
      expect(ALL_TAGS.map(lower)).not.toContain(lower(d));
      expect(CUISINE_OPTIONS.map((o) => o.key)).not.toContain(lower(d).replace(/[ -]/g, '_'));
    }
  });
  it('cuisine is one flat closed list of plain keys', () => {
    for (const o of CUISINE_OPTIONS) {
      expect(o.key).toMatch(/^[a-z]+$/);
      expect(Object.keys(o).sort()).toEqual(['key', 'label']);
    }
  });
  // (An attribute may share a name with an activity tag -- "Live Music" is both a venue quality and a thing to do; that is
  // two flat axes agreeing, not nesting.)
  it('attributes are one flat list of plain keys, never a cuisine', () => {
    for (const a of BUSINESS_ATTRIBUTE_OPTIONS) {
      expect(a.key).toMatch(/^[a-z_]+$/);
      expect(CUISINE_LABELS).not.toContain(lower(a.label));
    }
  });
  it('a dish word maps to a cuisine ONLY where CUISINE_PHRASES explicitly says so; otherwise it stays plain search text', () => {
    // Explicit entries resolve deterministically.
    expect(cuisineForSearch('sushi')).toBe('japanese');
    expect(cuisineForSearch('pho')).toBe('vietnamese');
    expect(cuisineForSearch('tacos')).toBe('mexican');
    expect(cuisineForSearch('ramen')).toBe('japanese');
    // Pizza (and other unlisted dishes) are NOT assumed to be any cuisine, however commonly associated.
    for (const w of ['pizza', 'pizza near me', 'pizza tonight', 'burgers', 'steak', 'wings', 'bagels', 'curry', 'noodles']) {
      expect(cuisineForSearch(w)).toBeNull();
      expect(cuisineFromText(w)).toBeNull();
      expect(searchScope(w).cuisine).toBeNull();
    }
  });
});

// Item 78 (owner, LOCKED 2026-09-26): the same for sports. Never Activities -> Sports -> Ball Sports -> Racquet -> Tennis ->
// Outdoor Tennis -> Casual Tennis. Instead: category group (Activities & Recreation) -> activity tag (Tennis), and the
// qualities are separate flat facts: skill level (host-declared: Casual / Beginner / All levels...), indoor/outdoor (from the
// tag, askFacets.environmentOf), format (open play, tournament...). Related sports (Pickleball / Padel / Tennis) are an
// UNNAMED sibling group (activityDictionary), never a "Racquet Sports" parent; SPORT_TAGS is a flat list, not a level.

describe('sports stay flat (item 78)', () => {
  const tagSet = new Set(ALL_TAGS.map(lower));
  const QUALIFIERS = ['outdoor', 'indoor', 'casual', 'competitive', 'beginner', 'intermediate', 'advanced', 'recreational', 'pro',
    ...SKILL_LEVELS.map((l) => lower(l.label)), ...ACTIVITY_FORMATS.map((f) => lower(f.label))];
  it('no intermediate sport family is a tag (Ball Sports, Racquet Sports...)', () => {
    for (const t of ['ball sports', 'racquet sports', 'racket sports', 'paddle sports', 'court sports', 'team sports', 'combat sports']) {
      expect(tagSet.has(t)).toBe(false);
    }
  });
  // Pre-existing, kept on purpose (item 66: removing a stored tag breaks data; it carries its format through TAG_FORMAT).
  // Adding to this list needs an owner decision.
  const LEGACY_QUALIFIED_TAGS = ['cooking class'];
  it('no tag is a qualifier + another tag (Outdoor Tennis, Casual Tennis, Beginner Yoga, Tennis Tournament)', () => {
    for (const t of ALL_TAGS.map(lower).filter((x) => !LEGACY_QUALIFIED_TAGS.includes(x))) {
      for (const q of QUALIFIERS) {
        if (t.startsWith(`${q} `)) expect(tagSet.has(t.slice(q.length + 1))).toBe(false);
        if (t.endsWith(` ${q}`)) expect(tagSet.has(t.slice(0, -(q.length + 1)))).toBe(false);
      }
    }
  });
  it('an activity tag has no children in the tree (qualities are facts, not levels)', () => {
    for (const t of ['Tennis', 'Pickleball', 'Padel', 'Basketball', 'Yoga', 'Hiking']) expect(childrenOf({ tag: t })).toEqual([]);
  });
  it('related sports are unnamed sibling groups, never a parent tag', () => {
    for (const g of RELATED_ACTIVITY_GROUPS) {
      expect(Array.isArray(g)).toBe(true);
      for (const t of g) expect(typeof t).toBe('string');
    }
  });
});

// Item 79 (owner, LOCKED 2026-09-26): nightlife too. Category group (Entertainment & Nightlife) -> activity tag (Live Music),
// and the rest are separate flat facts: genre (host-declared `gatherings.genre`, music tags only), indoor/outdoor (from the
// tag), food (`food_available` attribute), dancing (its own tag). No "Rock Concerts", "Jazz Clubs", "Outdoor Concerts" or
// "21+ Nights" tags. An age limit (21+) is NOT built: it restricts who may join and needs its own owner decision.
describe('nightlife stays flat (item 79)', () => {
  const tagSet = new Set(ALL_TAGS.map(lower));
  const genres = GENRE_OPTIONS.filter((g) => g.key).map((g) => lower(g.label));
  const GENRE_WORDS = [...genres, 'jazz club', 'indie', 'metal', 'punk', 'edm', 'techno', 'house'];
  it('a genre is never a tag, and no tag is genre + an activity (Rock Concerts, Jazz Club, Techno Nights)', () => {
    for (const t of ALL_TAGS.map(lower)) {
      expect(genres).not.toContain(t);
      for (const g of GENRE_WORDS) if (t.startsWith(`${g} `)) expect(tagSet.has(t.slice(g.length + 1)) || /club|night|concert|show|bar/.test(t)).toBe(false);
    }
  });
  it('no age-qualified tag (21+, 18+, adults only)', () => {
    for (const t of ALL_TAGS) expect(t).not.toMatch(/\b(1[89]|2[01])\+|adults? only/i);
  });
  it('genre is asked only on music tags, which are plain Entertainment & Nightlife tags with no children', () => {
    const ent = CATEGORY_GROUPS.find((g) => g.key === 'entertainment_nightlife').tags;
    for (const t of MUSIC_TAGS) {
      expect(ent).toContain(t);
      expect(childrenOf({ tag: t })).toEqual([]);
    }
  });
});

