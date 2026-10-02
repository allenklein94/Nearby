// Outdoor / Indoor as a declared-data match (2026-10-02, owner): one rule, every surface.
const fs = require('fs');
const path = require('path');
const { businessEnvironment, gatheringEnvironment, environmentOfItem, matchesEnvironment, filterByEnvironment } = require('./environmentMatch');
const { categoryEnvironment, filterGatheringsByEnvironment, isOutdoorCategory } = require('./gatheringIndoorOutdoor');
const { environmentOf, askFacetsLift, askFacetsEligible, parseAskFacets } = require('./askFacets');
const { askedForEnvironmentReason } = require('./recommendationReasonVocabulary');
const { localizeReason } = require('../utils/reasonLocalization');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('places (Nearby businesses and Google places)', () => {
  test('outdoor place: declared Outdoor only / Weather dependent / Outdoor seating', () => {
    expect(environmentOfItem('business', { weather_setting: 'outdoor' })).toBe('outdoor');
    expect(environmentOfItem('business', { weather_setting: 'weather_dependent' })).toBe('outdoor');
    expect(environmentOfItem('business', { attributes: ['quiet', 'outdoor_seating'] })).toBe('outdoor');
  });
  test('non-outdoor place: declared Indoor only', () => {
    expect(environmentOfItem('business', { weather_setting: 'indoor' })).toBe('indoor');
    expect(matchesEnvironment('business', { weather_setting: 'indoor' }, 'outdoor')).toBe(false);
  });
  test('never inferred from type, location or a map category', () => {
    expect(businessEnvironment({ category: 'outdoors_nature', subcategory: 'Hiking', categories: ['Kayaking', 'Beaches'] })).toBeNull();
    expect(businessEnvironment({ category: 'food_drink', subcategory: 'Coffee' })).toBeNull(); // not "indoor" either
    expect(businessEnvironment({ attributes: ['waterfront'] })).toBeNull();
    expect(environmentOfItem('place', { name: 'Central Park', types: ['park'], open_now: true })).toBeNull();
  });
});

describe('perks: their business\'s declarations', () => {
  test('outdoor perk', () => {
    expect(environmentOfItem('perk', { title: 'Free refill', brand_partners: { attributes: ['outdoor_seating'] } })).toBe('outdoor');
  });
  test('non-outdoor perk (declared indoor, or a hiking-type business that declared nothing)', () => {
    expect(environmentOfItem('perk', { brand_partners: { weather_setting: 'indoor' } })).toBe('indoor');
    expect(environmentOfItem('perk', { target_interest_tag: 'Hiking', brand_partners: { category: 'outdoors_nature' } })).toBeNull();
  });
});

describe('gatherings', () => {
  test('outdoor gathering: its activity (incl. the Outdoors & Nature group) or the host\'s declared outdoor seating', () => {
    expect(gatheringEnvironment({ interest_tag: 'Hiking' })).toBe('outdoor');
    expect(gatheringEnvironment({ interest_tag: 'Kayaking' })).toBe('outdoor');
    expect(gatheringEnvironment({ interest_tag: 'Coffee', features: ['outdoor_seating'] })).toBe('outdoor');
    expect(gatheringEnvironment({ interest_tag: 'Coffee' })).toBe('indoor');
  });
  test('the old two rules are one: Kayaking used to be outdoor in typed asks but missing from Discover\'s Outdoor view', () => {
    expect(isOutdoorCategory('Kayaking')).toBe(true);
    expect(environmentOf('Kayaking')).toBe(categoryEnvironment('Kayaking'));
    expect(filterGatheringsByEnvironment([{ id: 'k', interest_tag: 'Kayaking' }, { id: 'c', interest_tag: 'Coffee' }], 'outdoor').map((g) => g.id)).toEqual(['k']);
  });
});

describe('missing data', () => {
  test('unknown is never a match and is left out of a narrowing; no environment = nothing narrowed', () => {
    expect(environmentOfItem('business', {})).toBeNull();
    expect(environmentOfItem('gathering', { interest_tag: 'Music' })).toBeNull();
    expect(environmentOfItem('perk', { brand_partners: null })).toBeNull();
    expect(filterByEnvironment([{ id: 1 }, { id: 2, weather_setting: 'outdoor' }], 'business', 'outdoor').map((x) => x.id)).toEqual([2]);
    expect(filterByEnvironment([{ id: 1 }], 'business', null)).toEqual([{ id: 1 }]);
  });
  test('firm typed ask (outdoor or indoor): only the known asked side stays; unknown and the opposite are removed', () => {
    const envOf = (c) => c.env ?? null;
    const items = [{ id: 'u', score: 5 }, { id: 'in', env: 'indoor', score: 5 }, { id: 'out', env: 'outdoor', score: 5 }];
    const outdoor = askFacetsEligible(items, parseAskFacets('something outside tonight'), envOf);
    expect(outdoor.items.map((c) => c.id)).toEqual(['out']);
    expect(outdoor).toMatchObject({ removedOpposite: true, removedUnknown: true });
    const indoor = askFacetsEligible(items, parseAskFacets('something indoors tonight'), envOf);
    expect(indoor.items.map((c) => c.id)).toEqual(['in']);
    expect(indoor).toMatchObject({ removedOpposite: true, removedUnknown: true });
  });
  test('tentative typed ask: nothing removed; unknown neither lifted nor sunk', () => {
    const facets = parseAskFacets('maybe something outdoors tonight?');
    const envOf = (c) => c.env ?? null;
    const items = [{ id: 'u', score: 5 }, { id: 'in', env: 'indoor', score: 5 }];
    expect(askFacetsEligible(items, facets, envOf).items.map((c) => c.id)).toEqual(['u', 'in']);
    expect(askFacetsLift([{ id: 'u', score: 5 }], facets, envOf)[0].score).toBe(5);
  });
  test('an ordinary ask applies no environment at all', () => {
    const facets = parseAskFacets('coffee right now');
    expect(facets.environment).toBeNull();
    const items = [{ id: 'u' }, { id: 'in', env: 'indoor' }];
    expect(askFacetsEligible(items, facets, (c) => c.env ?? null).items).toBe(items);
  });
});

describe('sponsored never rides the organic match', () => {
  test('a sponsored outdoor place has no environment and gets no lift', () => {
    expect(environmentOfItem('sponsored', { weather_setting: 'outdoor', attributes: ['outdoor_seating'] })).toBeNull();
  });
  test('Discover hides the sponsored slot while Outdoor/Indoor is on; sponsored code never reads the match', () => {
    const discover = read('screens/DiscoverHubScreen.js');
    expect((discover.match(/!openNowActive && !environmentFilter && \(\s*<SponsoredSpotlightSlot/g) || []).length).toBe(2);
    for (const f of ['components/SponsoredSpotlightSlot.js', 'components/SponsoredCard.js', 'services/sponsored.js']) {
      expect(read(f)).not.toMatch(/environmentMatch|weather_setting/);
    }
    expect(read('constants/environmentMatch.js')).not.toMatch(/sponsored_|getSponsored/);
  });
});

describe('the reason', () => {
  test('a declared match carries "Because you asked for something outdoors"; opposite or unknown carry none', () => {
    const facets = parseAskFacets('maybe something outdoors tonight?');
    const envOf = (c) => c.env ?? null;
    const [out, inn, unk] = askFacetsLift([{ id: 'o', env: 'outdoor', score: 1 }, { id: 'i', env: 'indoor', score: 1 }, { id: 'u', score: 1 }], facets, envOf);
    expect(out.reasons).toEqual(['Because you asked for something outdoors']);
    expect(out.score).toBe(3);
    expect(inn.reasons).toBeUndefined();
    expect(inn.score).toBe(0);
    expect(unk.reasons).toBeUndefined();
  });
  test('localized like every other reason, and the generic askedFor template does not swallow it', () => {
    expect(askedForEnvironmentReason('indoor')).toBe('Because you asked for something indoors');
    expect(localizeReason('Because you asked for something outdoors', 'es')).toBe('Porque pediste algo al aire libre');
    expect(localizeReason('Because you asked for something indoors', 'ko')).toBe('실내를 원하셨기 때문이에요');
    expect(askedForEnvironmentReason(null)).toBeNull();
  });
});

describe('one rule, no duplicates, no new screen or preference', () => {
  test('surfaces read the shared rule', () => {
    expect(read('services/homeDashboard.js')).toMatch(/gatheringEnvironment\(g\) === 'outdoor'/);
    expect(read('services/homeRecommendations.js')).toMatch(/gatheringEnvironment\(gathering\)/);
    expect(read('services/intentResolver.js')).toMatch(/businessEnvironment\(partnerInfo\.get/);
    expect(read('screens/DiscoverHubScreen.js')).toMatch(/filterByEnvironment\(list, kind, environmentFilter\)/);
    for (const kind of ['perk', 'place', 'business', 'community']) expect(read('screens/DiscoverHubScreen.js')).toMatch(new RegExp(`'${kind}'\\)`));
  });
  test('no other file keeps its own category -> side table', () => {
    const src = path.join(__dirname, '..');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const offenders = walk(src).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !f.includes(`${path.sep}i18n${path.sep}`))
      .filter((f) => /Hiking:\s*'outdoor'|'outdoors_nature'\s*\?\s*'outdoor'/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f));
    expect(offenders).toEqual(['constants/gatheringIndoorOutdoor.js']);
  });
});
