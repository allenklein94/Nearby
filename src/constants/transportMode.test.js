const fs = require('fs');
const path = require('path');
const { transportModeFromText, effectiveTransportMode, applyTransportMode, transportModeCaption, candidateKey, TRANSPORT_MODES } = require('./transportMode');
const { closeBonusOf } = require('./distanceWillingness');
const { resolveAsk } = require('../utils/askResolver');
const travel = require('../services/travelTime');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const t = transportModeFromText;

describe('reading how the person is getting there (words only)', () => {
  it("the owner's examples", () => {
    expect(t("I'm walking, where should we get coffee")).toBe('walking');
    expect(t("I'm on my bike, something fun nearby")).toBe('bike');
    expect(t("I'm driving, dinner tonight")).toBe('driving');
    expect(t("I'll take an Uber to dinner")).toBe('rideshare');
    expect(t("I'm taking the train, drinks after work")).toBe('transit');
    expect(resolveAsk("coffee, I'm walking").transportMode).toBe('walking');
  });
  it('more phrasings per mode', () => {
    expect(['we are on foot', "we'll walk over", 'we can walk there'].map(t)).toEqual(Array(3).fill('walking'));
    expect(['by bike', "we're cycling", "I'll bike there"].map(t)).toEqual(Array(3).fill('bike'));
    expect(['I have a car', "I'll drive", 'we are driving'].map(t)).toEqual(Array(3).fill('driving'));
    expect(['grab a Lyft', 'in a cab', 'getting a taxi', 'uber there'].map(t)).toEqual(Array(4).fill('rideshare'));
    expect(['by bus', 'on the subway', 'public transit', 'catching the metro'].map(t)).toEqual(Array(4).fill('transit'));
  });
  it('activities and vague words are not a mode', () => {
    for (const s of ['', 'a walking tour', 'go for a walk', 'walking group Saturday', 'a bike ride', 'bike trail', 'a scenic drive', 'drive-in movie', 'coffee near me', 'train for a 5k', 'personal training', 'bus tour', 'something fun tonight']) {
      expect([s, t(s)]).toEqual([s, null]);
    }
  });
  it('negated modes are not a mode', () => {
    for (const s of ["I'm not driving tonight", "we won't take an Uber", "I don't have a car"]) expect([s, t(s)]).toEqual([s, null]);
  });
  it('two different modes = unclear (null); driving + rideshare agree', () => {
    expect(t("I'll walk or take the bus")).toBeNull();
    expect(t("I'm walking there and taking an Uber home")).toBeNull();
    expect(t("I have a car but might grab an Uber")).toBe('rideshare');
  });
  it('a stated distance wins over the mode', () => {
    expect(effectiveTransportMode('driving', 'very_nearby')).toBeNull();
    expect(effectiveTransportMode('walking', null)).toBe('walking');
    expect(effectiveTransportMode('teleport', null)).toBeNull();
  });
});

describe('ranking: relative closeness on real measured distances, no mile cutoffs, nothing removed', () => {
  const g = (id, d, o = {}) => ({ type: 'gathering', id, distanceMiles: d, score: 0, ...o });
  const list = () => [g('a', 0.5), g('b', 2), g('c', 4.5), g('d', null)];
  const deltas = (mode, tt) => applyTransportMode(list(), mode, tt).map((c) => c.score);
  it('walking lifts closest most (+2 .. 0), bike gentler (+1 .. 0)', () => {
    expect(deltas('walking')).toEqual([2, 2 * 2.5 / 4, 0, 0]);
    expect(deltas('bike')).toEqual([1, 2.5 / 4, 0, 0]);
  });
  it('driving and rideshare remove exactly the existing close-by bonus, nothing else', () => {
    const d = deltas('driving');
    expect(d).toEqual(list().map((c) => -closeBonusOf(c) || 0));
    expect(d[0]).toBeLessThan(0);
    expect(deltas('rideshare')).toEqual(d);
  });
  it('transit changes nothing on miles alone (no transit data)', () => {
    expect(applyTransportMode(list(), 'transit')).toEqual(list());
    expect(transportModeCaption('transit')).toBeNull();
  });
  it('unknown distance untouched, same length, no mode = same array', () => {
    const l = list();
    expect(applyTransportMode(l, null)).toBe(l);
    expect(applyTransportMode(l, 'walking')).toHaveLength(4);
    expect(applyTransportMode(l, 'walking')[3]).toBe(l[3]);
  });
  it('captions never claim a result is easier to reach', () => {
    for (const m of TRANSPORT_MODES) {
      const c = transportModeCaption(m.key);
      if (c) expect(c).not.toMatch(/easier|faster|min\b|minutes|quick(er)? to (get|reach)/i);
    }
  });
});

describe('future routing interface (no provider exists)', () => {
  afterEach(() => travel.registerTravelTimeProvider(null));
  const cands = [
    { type: 'gathering', id: 'a', distanceMiles: 2, score: 5 },
    { type: 'gathering', id: 'b', distanceMiles: 4, score: 4 },
    { type: 'business_availability', id: 'c', distanceMiles: 1, score: 3 },
  ];
  const origin = { latitude: 40.712776, longitude: -74.005974 };

  it('with no provider: null, no network, ranking falls back to miles', async () => {
    expect(travel.hasTravelTimeProvider()).toBe(false);
    expect(await travel.getTravelTimes(cands, 'walking', origin, { keyOf: candidateKey })).toBeNull();
    expect(applyTransportMode(cands, 'walking', null).map((c) => c.score)).toEqual([5 + 2 * 2 / 3, 4, 3 + 2]);
  });
  it('a provider sees a coarsened origin and candidate keys only, capped at the top 20', async () => {
    const seen = [];
    travel.registerTravelTimeProvider({ name: 'fake', travelTimes: async (req) => { seen.push(req); return req.candidateKeys.map(() => 600); } });
    const many = Array.from({ length: 30 }, (_, i) => ({ type: 'gathering', id: `g${i}`, score: i }));
    await travel.getTravelTimes(many, 'transit', origin, { keyOf: candidateKey });
    expect(seen[0].origin).toEqual({ latitude: 40.713, longitude: -74.006 });
    expect(seen[0].candidateKeys).toHaveLength(travel.MAX_ROUTED_CANDIDATES);
    expect(seen[0].candidateKeys[0]).toBe('gathering:g29');
    expect(Object.keys(seen[0]).sort()).toEqual(['candidateKeys', 'mode', 'origin', 'signal']);
  });
  it('real seconds re-rank on time, not miles: 4 mi can beat 1 mi; transit then ranks too', async () => {
    travel.registerTravelTimeProvider({ name: 'fake', travelTimes: async () => [900, 300, 1500] });
    const tt = await travel.getTravelTimes(cands, 'transit', origin, { keyOf: candidateKey });
    expect(travel.travelTimeSeconds(cands[1], tt, candidateKey)).toBe(300);
    const ranked = applyTransportMode(cands, 'transit', tt);
    expect(ranked.map((c) => c.score - cands.find((x) => x.id === c.id).score)).toEqual([0.5, 1, 0]);
  });
  it('failure, timeout, bad shape or implausible values fall back to null (never throws)', async () => {
    const tries = [
      async () => { throw new Error('quota'); },
      () => new Promise(() => {}),
      async () => [1, 2],
      async () => [NaN, -1, 99999999],
    ];
    for (const fn of tries) {
      travel.registerTravelTimeProvider({ name: 'x', travelTimes: fn });
      expect(await travel.getTravelTimes(cands, 'walking', origin, { keyOf: candidateKey, timeoutMs: 20 })).toBeNull();
    }
  });
  it('no origin or unknown mode = not routed', async () => {
    const spy = jest.fn(async (r) => r.candidateKeys.map(() => 60));
    travel.registerTravelTimeProvider({ name: 'x', travelTimes: spy });
    expect(await travel.getTravelTimes(cands, 'walking', null, { keyOf: candidateKey })).toBeNull();
    expect(await travel.getTravelTimes(cands, 'hover', origin, { keyOf: candidateKey })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it('"About 12 min by transit" only from real seconds', () => {
    expect(travel.travelTimeLabel(720, 'transit')).toBe('About 12 min by transit');
    expect(travel.travelTimeLabel(4200, 'driving')).toBe('About 1 hr 10 min by car');
    expect(travel.travelTimeLabel(null, 'transit')).toBeNull();
    expect(travel.travelTimeLabel(600, null)).toBeNull();
  });
});

describe('scope and safety', () => {
  it('no provider is registered anywhere; the routing module makes no network call and holds no key', () => {
    const src = read('src/services/travelTime.js');
    expect(src).not.toMatch(/\bfetch\(|supabase|functions\.invoke|googleapis|api[_-]?key/i);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
    for (const f of walk(path.join(ROOT, 'src')).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))) {
      expect([f, /registerTravelTimeProvider\(/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith('travelTime.js')]).toEqual([f, false]);
    }
    for (const f of walk(path.join(ROOT, 'supabase')).filter((f) => /\.(sql|ts)$/.test(f))) {
      expect([f, /routes\.googleapis|computeRouteMatrix|transport_mode/i.test(fs.readFileSync(f, 'utf8'))]).toEqual([f, false]);
    }
  });
  it('typed-ask resolver only; never widens the search; not in feeds, people or business code', () => {
    const src = read('src/services/intentResolver.js');
    expect(src).toContain('applyTransportMode(deduped, transportMode, travelTimes)');
    // the only widening input is distance willingness
    expect(src).toMatch(/const travelMiles = travelSearchMiles\(distanceWillingness\);/);
    for (const f of ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/services/homeDashboard.js', 'src/services/businessFulfillment.js', 'src/services/gatherings.js', 'src/services/friendDiscovery.js']) {
      if (!fs.existsSync(path.join(ROOT, f))) continue;
      expect([f, /transportMode|travelTime/.test(read(f))]).toEqual([f, false]);
    }
  });
});
