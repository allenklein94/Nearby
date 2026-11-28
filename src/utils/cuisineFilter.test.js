import { contextHasCuisines, offerInContext, applyCuisine, cuisineChips, cuisineConstraintFromText, cuisineLabel } from './cuisineFilter';
import { CUISINE_OPTIONS } from '../constants/businessAttributes';
import { searchScope } from '../constants/categoryTree';
import { INTEREST_OPTIONS, CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { filterOpenNow, perkEntity } from './operatingStatus';

const fs = require('fs');
const path = require('path');
const discover = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');

const perk = (id, cuisine, extra = {}) => ({ id, target_interest_tag: 'Restaurants', brand_partners: { name: id, cuisine, subcategory: 'Restaurants', category: 'food_drink', ...extra } });
const list = [perk('trattoria', 'italian'), perk('sushi-bar', 'japanese'), perk('diner', null), perk('pizzeria', 'italian'), perk('taqueria', 'mexican')];

describe('cuisine filter in the Restaurants view (item 76)', () => {
  it('chips come from the canonical cuisine list only (labels, keys, never Other)', () => {
    const chips = cuisineChips(list);
    const canonical = new Map(CUISINE_OPTIONS.map((o) => [o.key, o.label]));
    for (const c of chips) expect(canonical.get(c.key)).toBe(c.label);
    expect(chips.map((c) => c.key)).toEqual(['italian', 'mexican', 'japanese']); // most declared first, canonical order on ties
    expect(chips.map((c) => c.key)).not.toContain('other');
    expect(discover).not.toMatch(/['"](Italian|Japanese|Mexican|Thai|Korean)['"]/);
  });
  it('the selected chip stays visible (clearable) even when nothing in view matches', () => {
    expect(cuisineChips(list, 'thai').find((c) => c.key === 'thai')).toMatchObject({ active: true, count: 0 });
  });
  it('Italian returns only Italian-declared businesses; Japanese only Japanese; never widened', () => {
    expect(applyCuisine(list, 'italian').map((o) => o.id)).toEqual(['trattoria', 'pizzeria']);
    expect(applyCuisine(list, 'japanese').map((o) => o.id)).toEqual(['sushi-bar']);
    const mentionsOnly = { id: 'x', title: 'Italian night special', target_interest_tag: 'Restaurants', brand_partners: { cuisine: 'american' } };
    expect(applyCuisine([...list, mentionsOnly], 'italian').map((o) => o.id)).not.toContain('x');
    expect(applyCuisine(list, 'italian').map((o) => o.id)).not.toContain('diner');
  });
  it('clearing restores the broad Restaurants list unchanged', () => {
    expect(applyCuisine(list, null)).toBe(list);
  });
  it('combines with Open now: both constraints apply', () => {
    const now = new Date('2026-09-26T19:00:00Z');
    const allWeek = (v) => ({ sun: v, mon: v, tue: v, wed: v, thu: v, fri: v, sat: v });
    const hours = { timezone: 'UTC', week: allWeek([['17:00', '23:00']]) };
    const open = perk('open-italian', 'italian', { operating_hours: hours });
    const closed = perk('closed-italian', 'italian', { operating_hours: { timezone: 'UTC', week: allWeek('closed') } });
    const openOther = perk('open-thai', 'thai', { operating_hours: hours });
    const both = applyCuisine(filterOpenNow([open, closed, openOther], (o) => perkEntity(o), now), 'italian');
    expect(both.map((o) => o.id)).toEqual(['open-italian']);
    expect(both.map((o) => o.id)).not.toContain('closed-italian');
    expect(both.map((o) => o.id)).not.toContain('open-thai');
  });
  it('the row belongs only to a context holding the restaurant branch', () => {
    expect(contextHasCuisines(['Restaurants'])).toBe(true);
    expect(contextHasCuisines(CATEGORY_GROUPS.find((g) => g.key === 'food_drink').tags)).toBe(true);
    expect(contextHasCuisines(['Coffee'])).toBe(false);
    expect(contextHasCuisines(['Yoga'])).toBe(false);
  });
  it('a perk is in context by its own tag or its business\'s declared type', () => {
    expect(offerInContext({ target_interest_tag: 'Foodie', brand_partners: { subcategory: 'Restaurants' } }, { tags: ['Restaurants'] })).toBe(true);
    expect(offerInContext({ target_interest_tag: null, brand_partners: { category: 'food_drink' } }, { tags: ['Coffee'], groupKey: 'food_drink' })).toBe(true);
    expect(offerInContext({ target_interest_tag: 'Yoga', brand_partners: { subcategory: 'Yoga' } }, { tags: ['Restaurants'] })).toBe(false);
  });
  it('typed text and the chip resolve to the same constraint', () => {
    expect(cuisineConstraintFromText('Italian restaurants')).toBe('italian');
    expect(searchScope('Italian restaurants').cuisine).toBe('italian');
    expect(cuisineConstraintFromText('Italian dinner tonight')).toBe('italian');
    expect(cuisineConstraintFromText('sushi near me')).toBe('japanese');
    expect(cuisineConstraintFromText('tacos near me')).toBe('mexican');
    expect(cuisineLabel('italian')).toBe('Italian');
  });
  it('generic food words never become a cuisine; context guards hold', () => {
    for (const t of ['dinner tonight', 'restaurant tonight', 'food near me', 'restaurants', 'lunch', 'french class', 'thai massage', 'greek mythology']) {
      expect(cuisineConstraintFromText(t)).toBeNull();
      expect(searchScope(t).cuisine).toBeNull();
    }
  });
});

describe('cuisine stays a business discovery attribute', () => {
  const labels = CUISINE_OPTIONS.map((o) => o.label);
  it('never a personal interest, a gathering category or a Discover top-level category', () => {
    for (const l of labels.filter((x) => x !== 'Other')) expect(INTEREST_OPTIONS).not.toContain(l);
    const rail = fs.readFileSync(path.join(__dirname, '../constants/discoverCategoryRail.js'), 'utf8');
    expect(rail).not.toMatch(/cuisine/i);
    expect(CATEGORY_GROUPS.map((g) => g.label)).not.toEqual(expect.arrayContaining(['Italian']));
  });
  it('gatherings, communities and Places are not shown under a cuisine; a gathering reads its cuisine only on its own', () => {
    expect(discover).toMatch(/\{!activeCuisine && \(<>/);
    // Owner 2026-11-27: a gathering may carry its own cuisine fact (20270435), read and written only through its own
    // helpers, never in the shared list selects (so no list read depends on the column before it is live).
    const gSvc = fs.readFileSync(path.join(__dirname, '../services/gatherings.js'), 'utf8');
    const SAFE = /const SAFE_GATHERING_FIELDS = '([^']+)'/.exec(gSvc)[1];
    expect(SAFE).not.toMatch(/cuisine/);
    expect(gSvc).toMatch(/export async function getGatheringCuisine/);
    expect(gSvc).toMatch(/export async function setGatheringCuisine/);
  });
  it('no new screen or navigation: the chip only sets state, the typed link reopens the same in-place view', () => {
    expect(discover).toMatch(/onPress=\{\(\) => setCuisineFilter\(c\.active \? null : c\.key\)\}/);
    expect(discover).toMatch(/openCuisineContext\(cuisineConstraintFromText/);
    const fn = discover.slice(discover.indexOf('function openCuisineContext'), discover.indexOf('function openTopCategoryContext'));
    expect(fn).not.toMatch(/navigate\(/);
  });
});

describe('gatherings join the cuisine filter by their declared cuisine (owner 2026-11-28)', () => {
  const { applyGatheringCuisine, gatheringDeclaredCuisine } = require('./cuisineFilter');
  const g = (id, cuisine, title = 'Dinner') => ({ id, interest_tag: 'Foodie', title, ...(cuisine !== undefined ? { cuisine } : {}) });
  const rows = [g('a', 'italian'), g('b', 'mexican'), g('c', null, 'Italian night'), g('d', undefined, 'Pasta Italian feast'), g('e', 'italian')];
  it('Italian returns only gatherings that DECLARED Italian, never by title or activity', () => {
    expect(applyGatheringCuisine(rows, 'italian').map((x) => x.id)).toEqual(['a', 'e']);
  });
  it('before 20270435 (no cuisine field on any row) no gathering is ever claimed as a match', () => {
    const pre = rows.map(({ cuisine, ...rest }) => rest);
    expect(applyGatheringCuisine(pre, 'italian')).toEqual([]);
  });
  it('no constraint = the list unchanged; Other is never a declared cuisine', () => {
    expect(applyGatheringCuisine(rows, null)).toBe(rows);
    expect(gatheringDeclaredCuisine({ cuisine: 'other' })).toBeNull();
  });
  it('chips count declared gathering cuisines beside business cuisines', () => {
    const chips = cuisineChips([perk('t', 'japanese')], null, [g('x', 'italian'), g('y', 'italian'), g('z', null, 'Italian')]);
    expect(chips.map((c) => [c.key, c.count])).toEqual([['italian', 2], ['japanese', 1]]);
  });
  it('Discover shows the gathering section only once the server stores cuisine, reading the shared rule', () => {
    expect(discover).toMatch(/applyGatheringCuisine\(contextCuisineGatheringsAll, activeCuisine\)/);
    expect(discover).toMatch(/activeCuisine && cuisineGatheringsSupported \?/);
    expect(discover).toMatch(/attachGatheringCuisines\(/);
    expect(discover).not.toMatch(/applyGatheringCuisine\([^)]*title/);
  });
});
