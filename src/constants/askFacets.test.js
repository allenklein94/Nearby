import { parseAskFacets, applyAskFacets, partnerPartyType, environmentOf, ALCOHOL_TAGS, CROWDED_TAGS } from './askFacets';
import { groupForTag } from './gatheringCategories';

describe('ask facets: combinations and negative intent (items 47/48)', () => {
  it('reads the owner\'s combination example', () => {
    const f = parseAskFacets('Something fun outside tonight under $30 with my girlfriend');
    expect(f.environment).toBe('outdoor');
    expect(f.exclude).toEqual([]);
    expect(partnerPartyType('with my girlfriend')).toBe('date');
    expect(partnerPartyType('with two friends')).toBeNull();
  });
  it('reads exclusions, and a negated environment never becomes a positive one', () => {
    expect(parseAskFacets("I don't want anything crowded").exclude).toEqual(['crowded']);
    expect(parseAskFacets('No alcohol').exclude).toEqual(['alcohol']);
    const n = parseAskFacets('Nothing outdoors');
    expect(n.exclude).toEqual(['outdoor']);
    expect(n.environment).toBeNull();
    expect(parseAskFacets('not too expensive').pricey).toBe(true);
    expect(parseAskFacets('indoors only').exclude).toEqual(['outdoor']);
    expect(parseAskFacets('coffee tonight')).toEqual({ environment: null, exclude: [], pricey: false });
    expect(parseAskFacets(null).exclude).toEqual([]);
  });
  it('drops only KNOWN conflicts; unknown stays; caption says what was left out', () => {
    const list = [
      { category: 'Wine', score: 3 }, { category: 'Coffee', score: 3 }, { category: null, score: 3 }, { category: 'Music', score: 3 },
    ];
    const out = applyAskFacets(list, parseAskFacets('no alcohol'));
    expect(out.items.map((c) => c.category)).toEqual(['Coffee', null, 'Music']);
    expect(out.caption).toBe('Leaving out alcohol');
  });
  it('crowded: known crowd tags and big gatherings go, small ones stay', () => {
    const list = [{ category: 'Festivals' }, { category: 'Coffee', capacity: 30 }, { category: 'Coffee', attendeeCount: 25 }, { category: 'Coffee', capacity: 6 }, { category: 'Coffee' }];
    expect(applyAskFacets(list, parseAskFacets('nothing crowded')).items).toHaveLength(2);
  });
  it('nothing outdoors removes known outdoor; an outdoor ask lifts outdoor and nudges known indoor down; never removes for a positive ask', () => {
    const list = [{ category: 'Hiking', score: 1 }, { category: 'Movies', score: 1 }, { category: 'Music', score: 1 }];
    expect(applyAskFacets(list, parseAskFacets('nothing outdoors')).items.map((c) => c.category)).toEqual(['Movies', 'Music']);
    const up = applyAskFacets(list, parseAskFacets('something outside')).items;
    expect(up.map((c) => c.score)).toEqual([3, 0, 1]);
    expect(up).toHaveLength(3);
  });
  it('not too expensive only sinks a known $$$ result; no facets = untouched', () => {
    const list = [{ category: 'Coffee', priceLevel: '$$$', score: 3 }, { category: 'Coffee', score: 3 }];
    expect(applyAskFacets(list, parseAskFacets('not too expensive')).items.map((c) => c.score)).toEqual([1, 3]);
    expect(applyAskFacets(list, parseAskFacets('coffee'))).toEqual({ items: list, caption: null });
  });
  it('tables only name real tags, and Outdoors & Nature tags read as outdoor', () => {
    [...ALCOHOL_TAGS, ...CROWDED_TAGS].forEach((t) => expect(groupForTag(t)).toBeTruthy());
    expect(environmentOf('Parks')).toBe('outdoor');
    expect(environmentOf('Coffee')).toBe('indoor');
    expect(environmentOf('Music')).toBeNull();
  });
});
