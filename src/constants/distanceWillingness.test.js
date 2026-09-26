const fs = require('fs');
const path = require('path');
const { DISTANCE_WILLINGNESS, distanceWillingnessFromText, distanceWillingnessDelta, applyDistanceWillingness, closeBonusOf, CLOSE_DISTANCE_MILES, distanceWillingnessCaption } = require('./distanceWillingness');
const { SCORE_CLOSE_DISTANCE, occasionOfferingScore, scoreGatheringForResolver } = require('../services/intentResolverScoring');
const { resolveAsk } = require('../utils/askResolver');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const w = distanceWillingnessFromText;

describe('reading how far the person will go (words only)', () => {
  it("the owner's examples: 5 minutes right now vs 30 minutes on a Saturday", () => {
    expect(w('coffee 5 minutes away right now')).toBe('very_nearby');
    expect(w('something 30 minutes away for Saturday')).toBe('willing_to_travel');
    expect(resolveAsk('a hike 30 minutes away on Saturday').distanceWillingness).toBe('willing_to_travel');
  });
  it('all four buckets', () => {
    expect(['within walking distance', 'around the corner', 'a 10 minute walk', 'super close to me', 'in my neighborhood'].map(w)).toEqual(Array(5).fill('very_nearby'));
    expect(['not too far', 'a short drive', '15 minutes away', 'a 20-min drive', 'close to home', 'close by'].map(w)).toEqual(Array(6).fill('nearby'));
    expect(['anywhere in town', 'anywhere in my area', "distance doesn't matter"].map(w)).toEqual(Array(3).fill('anywhere_in_area'));
    expect(["I don't mind driving", 'willing to travel', 'worth the drive', 'an hour away', "half an hour's drive", 'a day trip'].map(w)).toEqual(Array(6).fill('willing_to_travel'));
  });
  it('nothing said = null; a time amount is not a distance; "nearby" alone is not a bucket', () => {
    for (const t of ['', 'coffee tonight', 'I only have an hour', 'in 5 minutes', 'something fun nearby', 'coffee near me', 'dinner at 7', 'a 2 hour hike', 'meet in 10 minutes']) {
      expect([t, w(t)]).toEqual([t, null]);
    }
  });
  it('never uses the time of day: "right now" alone says nothing about distance', () => {
    expect(w('something to do right now')).toBeNull();
  });
});

describe('ranking on real measured distances only', () => {
  const g = (d, o = {}) => ({ type: 'gathering', distanceMiles: d, score: 0, ...o });
  it('very nearby and nearby bands', () => {
    expect([0.5, 1, 3, 5, 6].map((d) => distanceWillingnessDelta(g(d), 'very_nearby'))).toEqual([2, 2, 0, 0, -2]);
    expect([2, 3, 8, 10, 12].map((d) => distanceWillingnessDelta(g(d), 'nearby'))).toEqual([1, 1, 0, 0, -1]);
  });
  it('anywhere / willing to travel cancel exactly the existing close-by bonus', () => {
    for (const key of ['anywhere_in_area', 'willing_to_travel']) {
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
    expect(applyDistanceWillingness(cands, 'very_nearby').map((c) => [c.id, c.score])).toEqual([['a', 2], ['b', 0], ['c', -2]]);
    expect(applyDistanceWillingness(cands, null)).toBe(cands);
    expect(applyDistanceWillingness(cands, 'far_away')).toBe(cands);
  });
  it('each bucket has a caption; unknown has none', () => {
    for (const d of DISTANCE_WILLINGNESS) expect(distanceWillingnessCaption(d.key)).toBeTruthy();
    expect(distanceWillingnessCaption(null)).toBeNull();
  });
});

describe('scope', () => {
  it('typed-ask resolver only; the search area is not widened; nothing sent to businesses', () => {
    const src = read('src/services/intentResolver.js');
    expect(src).toContain('applyDistanceWillingness(deduped, distanceWillingness)');
    expect(src).toContain("getNearbyGatherings('wide')");
    for (const f of ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/services/homeDashboard.js', 'src/services/businessFulfillment.js', 'src/services/gatherings.js']) {
      expect([f, /distanceWillingness/i.test(read(f))]).toEqual([f, false]);
    }
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(ROOT, 'supabase')).filter((f) => /\.(sql|ts)$/.test(f))) expect([f, /distance_willingness/.test(fs.readFileSync(f, 'utf8'))]).toEqual([f, false]);
  });
});
