// Item 77 (owner, LOCKED 2026-09-26): no category tree explosion. A food business is described on SEPARATE flat axes,
// never one deep path (Food -> Restaurant -> Italian -> Pizza -> Neapolitan -> Wood Fired):
//   category = a leaf tag (Restaurants)   cuisine = the business's one declared cuisine (italian)
//   specialty = not built yet (Pizza would live here, as its own flat axis, never as a child of a cuisine)
//   attributes = the one shared attribute vocabulary (wood-fired would be a key there, not a level)
// The tree (categoryTree.js) stops at cuisine: group -> tag -> cuisine, three levels, nothing below.
import { CATEGORY_GROUPS } from './gatheringCategories';
import { CUISINE_OPTIONS, BUSINESS_ATTRIBUTE_OPTIONS } from './businessAttributes';
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
