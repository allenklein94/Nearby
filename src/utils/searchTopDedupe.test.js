// Item 134 on Discover's Top Results: the found block wins, the previews below leave out what it already shows.
import fs from 'fs';
import path from 'path';
import { foundBlockShownIds, withoutFoundBlock } from './searchTopDedupe';
import { searchResultTabs, topResultKinds } from './searchResultTabs';

const result = (items, extra = {}) => ({ outcome: 'results', items, ...extra });
const G1 = 'g-1', G2 = 'g-2', P1 = 'perk-1', P2 = 'perk-2', B1 = 'biz-1', B2 = 'biz-2';

describe('foundBlockShownIds', () => {
  it('collects ids per type from the rows actually shown', () => {
    const shown = foundBlockShownIds(result([
      { type: 'gathering', id: G1 },
      { type: 'perk', id: P1, partnerId: B2 },
      { type: 'business_availability', id: 'posting-9', partnerId: B1 },
      { type: 'community', id: 'c-1' },
      { type: 'friend_discovery', id: 'friend-discovery' },
    ]));
    expect([...shown.plans]).toEqual([G1]);
    expect([...shown.offers]).toEqual([P1]);
    // a business by its brand_partners id (never the posting id), and a perk's business is not a business row
    expect([...shown.places]).toEqual([B1]);
  });

  it('policy-only and package results count by their business', () => {
    const shown = foundBlockShownIds(result([
      { type: 'business_policy_match', id: B1, partnerId: B1 },
      { type: 'business_occasion_package', id: 'pkg-1', partnerId: B2 },
    ]));
    expect([...shown.places].sort()).toEqual([B1, B2]);
  });

  it('reads an assembled experience (bundles + component items)', () => {
    const shown = foundBlockShownIds(result([], {
      experience: { bundles: [], components: [{ key: 'dinner', items: [{ type: 'gathering', id: G2 }] }] },
    }));
    expect([...shown.plans]).toEqual([G2]);
  });

  it('nothing shown when there is no result or it is not a results outcome', () => {
    for (const r of [null, { outcome: 'pick_for_me', items: [{ type: 'gathering', id: G1 }] }]) {
      const shown = foundBlockShownIds(r);
      expect(shown.plans.size + shown.offers.size + shown.places.size).toBe(0);
    }
  });
});

describe('withoutFoundBlock', () => {
  const shown = foundBlockShownIds(result([
    { type: 'gathering', id: G1 }, { type: 'perk', id: P1 }, { type: 'business_availability', id: 'x', partnerId: B1 },
  ]));

  it('a gathering, perk or business shown above is left out of its preview; others stay', () => {
    expect(withoutFoundBlock([{ id: G1 }, { id: G2 }], 'plans', shown)).toEqual([{ id: G2 }]);
    expect(withoutFoundBlock([{ id: P1 }, { id: P2 }], 'offers', shown)).toEqual([{ id: P2 }]);
    expect(withoutFoundBlock([{ id: B1 }, { id: B2 }], 'places', shown)).toEqual([{ id: B2 }]);
  });

  it('matches within a type only (a perk id never removes a gathering with the same id)', () => {
    const s = foundBlockShownIds(result([{ type: 'perk', id: 'same' }]));
    expect(withoutFoundBlock([{ id: 'same' }], 'plans', s)).toEqual([{ id: 'same' }]);
  });

  it('a preview can end up empty (it then disappears)', () => {
    expect(withoutFoundBlock([{ id: G1 }], 'plans', shown)).toEqual([]);
  });

  it('no found block = previews unchanged', () => {
    const list = [{ id: G1 }, { id: G2 }];
    expect(withoutFoundBlock(list, 'plans', null)).toBe(list);
    expect(withoutFoundBlock(list, 'plans', foundBlockShownIds(null))).toBe(list);
  });

  it('tabs and their counts are computed from the full lists, untouched by the dedupe', () => {
    const counts = { plans: 2, places: 2, offers: 2, activities: 0 };
    expect(searchResultTabs(counts).map((t) => [t.key, t.count])).toEqual([['top', null], ['places', 2], ['plans', 2], ['offers', 2]]);
    expect(topResultKinds(counts)).toEqual(['plans', 'places', 'offers']);
  });
});

describe('source guard', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');

  it('the three Top previews go through the helper, only on the Top tab', () => {
    expect(src).toMatch(/capList\(withoutFoundBlock\(searchedBusinesses, 'places', topShown\), 'places'\)/);
    expect(src).toMatch(/capList\(withoutFoundBlock\(dedupedGatherings, 'plans', topShown\), 'plans'\)/);
    expect(src).toMatch(/capList\(withoutFoundBlock\(filteredOffers, 'offers', topShown\), 'offers'\)/);
    expect(src).toMatch(/resultTabsActive && resultTab === 'top' && foundBlockShowing \? foundBlockShownIds\(intentSearch\) : null/);
  });

  it('the result counts (tabs, See all) still read the full lists', () => {
    expect(src).toMatch(/plans: dedupedGatherings\.length,/);
    expect(src).toMatch(/offers: filteredOffers\.length,/);
    expect(src).toMatch(/places: searchedBusinesses\.length \+/);
  });

  it('a "nothing matched" empty state never fires because the found block took the items', () => {
    expect(src).toMatch(/isSearching && !loadingSearch && dedupedGatherings\.length === 0/);
    expect(src).toMatch(/isSearching && !loadingSearch && withSelectedPerk\(filteredOffers\)\.length === 0/);
  });
});
