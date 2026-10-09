import {
  applyGatheringFilters, gatheringFiltersFromParams, GATHERING_FILTER_DEFAULTS, hasActiveGatheringFilters,
  toggleForYou, selectCategory, gatheringsTabParams, GATHERINGS_TAB,
} from './gatheringFilters';

const soon = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
const g = (o) => ({ id: o.id, title: o.title ?? 'x', scheduled_at: soon, interest_tag: 'Coffee', approvedCount: 0, ...o });

describe('gathering filters (B3: the feed folded into Discover)', () => {
  it('defaults filter nothing', () => {
    const list = [g({ id: 1 }), g({ id: 2, interest_tag: 'Sports' })];
    expect(applyGatheringFilters(list, GATHERING_FILTER_DEFAULTS)).toHaveLength(2);
    expect(hasActiveGatheringFilters(GATHERING_FILTER_DEFAULTS)).toBe(false);
  });
  it('category, price, plan kind and local leave out the undeclared', () => {
    const list = [
      g({ id: 1, price_level: '$', party_type: 'friends', distanceMiles: 0.5 }),
      g({ id: 2, interest_tag: 'Sports' }),
      g({ id: 3, distanceMiles: 3 }),
    ];
    expect(applyGatheringFilters(list, { category: 'Coffee' }).map((x) => x.id)).toEqual([1, 3]);
    expect(applyGatheringFilters(list, { price: '$' }).map((x) => x.id)).toEqual([1]);
    expect(applyGatheringFilters(list, { planKind: 'friends' }).map((x) => x.id)).toEqual([1]);
    expect(applyGatheringFilters(list, { local: true }).map((x) => x.id)).toEqual([1]);
  });
  it('trending is the one shared floor of people going', () => {
    const list = [g({ id: 1, approvedCount: 5 }), g({ id: 2, approvedCount: 4 })];
    expect(applyGatheringFilters(list, { trending: true }).map((x) => x.id)).toEqual([1]);
  });
  it('For You replaces a single category and reads the person categories', () => {
    const f = toggleForYou(selectCategory(GATHERING_FILTER_DEFAULTS, 'Sports'));
    expect(f).toMatchObject({ forYou: true, category: null });
    const list = [g({ id: 1 }), g({ id: 2, interest_tag: 'Sports' })];
    expect(applyGatheringFilters(list, f, { forYouCategories: ['Coffee'] }).map((x) => x.id)).toEqual([1]);
    expect(selectCategory(f, 'Sports')).toMatchObject({ forYou: false, category: 'Sports' });
  });
  it('a carried word narrows by title or description', () => {
    const list = [g({ id: 1, title: 'Beach Volleyball' }), g({ id: 2, title: 'Soccer', description: 'pickup volleyball after' }), g({ id: 3 })];
    expect(applyGatheringFilters(list, { term: 'volleyball' }).map((x) => x.id)).toEqual([1, 2]);
  });
  it('entry params keep only real values', () => {
    expect(gatheringFiltersFromParams({ when: 'tonight', category: 'Coffee', term: ' run ' })).toMatchObject({ when: 'tonight', category: 'Coffee', term: 'run' });
    expect(gatheringFiltersFromParams({ when: 'someday' }).when).toBe('anytime');
    expect(gatheringFiltersFromParams(undefined)).toEqual(GATHERING_FILTER_DEFAULTS);
  });
  it('every entry gets a fresh params object for Discover -> Gatherings', () => {
    const a = gatheringsTabParams(); const b = gatheringsTabParams();
    expect(a).toEqual(GATHERINGS_TAB);
    expect(a).not.toBe(b);
    expect(gatheringsTabParams({ when: 'today' })).toEqual({ ...GATHERINGS_TAB, gatheringFilters: { when: 'today' } });
  });
});
