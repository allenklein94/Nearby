const fs = require('fs');
const path = require('path');
const { DISTANCE_WILLINGNESS, distanceWillingnessFromText, distanceWillingnessDelta, applyDistanceWillingness, closeBonusOf, CLOSE_DISTANCE_MILES, distanceWillingnessCaption, travelSearchMiles } = require('./distanceWillingness');
const { SEARCH_RADIUS_OPTIONS, DEFAULT_SEARCH_MILES, TRAVEL_SEARCH_MILES, MAX_SEARCH_MILES, boundedSearchMiles } = require('./searchRadius');
const { SCORE_CLOSE_DISTANCE, occasionOfferingScore, scoreGatheringForResolver } = require('../services/intentResolverScoring');
const { resolveAsk } = require('../utils/askResolver');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const w = distanceWillingnessFromText;

describe('reading how far the person will go (words only)', () => {
  it("the owner's examples: 5 minutes right now vs 30 minutes on a Saturday", () => {
    expect(w('coffee 5 minutes away right now')).toBe('very_nearby');
    expect(w('something 30 minutes away for Saturday')).toBe('willing_to_travel');
    expect(w('10 minutes from me')).toBe('very_nearby');
    expect(w('a 20 minute drive')).toBe('nearby');
    expect(w('a 15 minute walk')).toBe('nearby');
    expect(resolveAsk('a hike 30 minutes away on Saturday').distanceWillingness).toBe('willing_to_travel');
  });
  it('all four buckets', () => {
    expect(['within walking distance', 'around the corner', 'a 10 minute walk', 'super close to me', 'in my neighborhood'].map(w)).toEqual(Array(5).fill('very_nearby'));
    expect(['not too far', 'a short drive', '15 minutes away', 'a 20-min drive', 'close to home', 'close by'].map(w)).toEqual(Array(6).fill('nearby'));
    expect(['anywhere in town', 'anywhere in my area', "distance doesn't matter"].map(w)).toEqual(Array(3).fill('anywhere_in_area'));
    expect(["I don't mind driving", 'willing to travel', 'worth the drive', 'an hour away', "half an hour's drive", 'a day trip'].map(w)).toEqual(Array(6).fill('willing_to_travel'));
  });
  it('nothing said = null; a time amount is not a distance; "nearby" alone is not a bucket', () => {
    for (const t of ['', 'coffee tonight', 'I only have an hour', 'in 5 minutes', 'for 30 minutes', 'something fun nearby', 'nearby', 'near me', 'coffee near me', 'dinner at 7', 'a 2 hour hike', 'meet in 10 minutes']) {
      expect([t, w(t)]).toEqual([t, null]);
    }
  });
  it('never uses the time of day: "right now" alone says nothing about distance', () => {
    expect(w('something to do right now')).toBeNull();
  });
});

describe('ranking on real measured distances only', () => {
  const g = (d, o = {}) => ({ type: 'gathering', distanceMiles: d, score: 0, ...o });
  it('closeness is relative to the other results\' real distances: no mile cutoffs', () => {
    const measured = [0.5, 2, 4.5];
    expect(measured.map((d) => distanceWillingnessDelta(g(d), 'very_nearby', measured))).toEqual([2, 2 * 2.5 / 4, 0]);
    expect(measured.map((d) => distanceWillingnessDelta(g(d), 'nearby', measured))).toEqual([1, 2.5 / 4, 0]);
    // the same shape at any scale: 5 / 20 / 45 miles orders exactly like 0.5 / 2 / 4.5
    const far = [5, 20, 45];
    expect(far.map((d) => distanceWillingnessDelta(g(d), 'very_nearby', far))).toEqual([2, 2 * 25 / 40, 0]);
    expect(distanceWillingnessDelta(g(3), 'very_nearby', [3])).toBe(2);
    const src = read('src/constants/distanceWillingness.js');
    expect(src).not.toMatch(/within:|beyond:|BANDS/);
  });
  it('anywhere in my area cancels exactly the existing close-by bonus; willing to travel ranks normally', () => {
    expect(distanceWillingnessDelta(g(1), 'willing_to_travel')).toBe(0);
    for (const key of ['anywhere_in_area']) {
      expect(distanceWillingnessDelta(g(1), key)).toBe(-3);
      expect(distanceWillingnessDelta(g(8), key)).toBe(0);
      expect(distanceWillingnessDelta({ type: 'business_policy_match', viaOccasionOffering: true, distanceMiles: 1 }, key)).toBe(-1);
      expect(distanceWillingnessDelta({ type: 'community', distanceMiles: 1 }, key)).toBe(0);
    }
  });
  it('the mirrored bonus matches the real scorers', () => {
    expect(CLOSE_DISTANCE_MILES).toBe(2);
    expect(closeBonusOf(g(1))).toBe(SCORE_CLOSE_DISTANCE);
    expect(scoreGatheringForResolver({ distanceMiles: 1, scheduled_at: '2000-01-01' }) - scoreGatheringForResolver({ distanceMiles: 3, scheduled_at: '2000-01-01' })).toBe(closeBonusOf(g(1)));
    expect(occasionOfferingScore(1) - occasionOfferingScore(3)).toBe(closeBonusOf({ type: 'business_policy_match', viaOccasionOffering: true, distanceMiles: 1 }));
    const src = read('src/services/intentResolver.js');
    expect((src.match(/row\.distance_miles < 2\) score \+= SCORE_CLOSE_DISTANCE/g) ?? []).length).toBe(2);
    expect(src).toContain('row.distance_miles != null && row.distance_miles < 2 ? SCORE_CLOSE_DISTANCE : 0');
  });
  it('unknown distance untouched, nothing removed, no ask = same array', () => {
    const cands = [g(0.4, { id: 'a' }), g(null, { id: 'b' }), g(9, { id: 'c' })];
    const out = applyDistanceWillingness(cands, 'very_nearby');
    expect(out.map((c) => [c.id, c.score])).toEqual([['a', 2], ['b', 0], ['c', 0]]);
    expect(out).toHaveLength(3);
    expect(applyDistanceWillingness(cands, 'willing_to_travel').map((c) => c.score)).toEqual([0, 0, 0]);
    expect(applyDistanceWillingness(cands, null)).toBe(cands);
    expect(applyDistanceWillingness(cands, 'far_away')).toBe(cands);
  });
  it('each bucket has a caption; unknown has none', () => {
    for (const d of DISTANCE_WILLINGNESS) expect(distanceWillingnessCaption(d.key)).toBeTruthy();
    expect(distanceWillingnessCaption(null)).toBeNull();
  });
});

describe('willing to travel widens the bounded search', () => {
  it('one step on the shared radius list, and only for willing to travel', () => {
    expect(SEARCH_RADIUS_OPTIONS).toEqual([15, 30, 50]);
    expect(travelSearchMiles('willing_to_travel')).toBe(TRAVEL_SEARCH_MILES);
    expect(TRAVEL_SEARCH_MILES).toBeGreaterThan(DEFAULT_SEARCH_MILES);
    for (const k of ['very_nearby', 'nearby', 'anywhere_in_area', null, 'far_away']) expect(travelSearchMiles(k)).toBeNull();
    const src = read('src/services/intentResolver.js');
    expect(src).toContain("getNearbyGatherings(travel ? 'travel' : 'wide')");
    for (const fn of ['resolvePolicyOnlyBusinesses(location, partySize, travelMiles)', 'resolveOccasionPackages(location, occasion, partySize, travelMiles)', 'resolveOccasionOfferingBusinesses(location, occasion, travelMiles)', 'activitiesFromText(rawText), travelMiles)']) expect(src).toContain(fn);
    expect(read('src/services/gatherings.js')).toMatch(/tier === 'travel' \? TRAVEL_TIER_MAX_MILES/);
    expect(read('src/screens/AskBusinessScreen.js')).toContain('const RADIUS_OPTIONS = SEARCH_RADIUS_OPTIONS;');
  });
  it('never unlimited: every radius is clamped to the list maximum', () => {
    expect(MAX_SEARCH_MILES).toBe(50);
    for (const m of [51, 500, Infinity, 1e9]) expect(boundedSearchMiles(m)).toBeLessThanOrEqual(MAX_SEARCH_MILES);
    for (const m of [0, -5, NaN, null, undefined, '30']) expect(boundedSearchMiles(m)).toBe(DEFAULT_SEARCH_MILES);
    expect(read('src/services/gatherings.js')).toContain('const tierMaxMiles = (tier) => boundedSearchMiles(');
    // a posting still reaches only as far as its business chose (server uses least(search radius, posting radius))
    expect(read('src/services/intentResolver.js')).toContain('...(searchMiles ? { radiusMiles: searchMiles } : {})');
  });
});

describe('scope', () => {
  it('typed-ask resolver only; nothing sent to businesses', () => {
    const src = read('src/services/intentResolver.js');
    expect(src).toContain('applyDistanceWillingness(deduped, distanceWillingness)');
    for (const f of ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/services/homeDashboard.js', 'src/services/businessFulfillment.js', 'src/services/gatherings.js']) {
      expect([f, /applyDistanceWillingness|distanceWillingnessFromText/.test(read(f))]).toEqual([f, false]);
    }
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(ROOT, 'supabase')).filter((f) => /\.(sql|ts)$/.test(f))) expect([f, /distance_willingness/.test(fs.readFileSync(f, 'utf8'))]).toEqual([f, false]);
  });
});
