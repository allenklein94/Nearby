// Owner item 189 (2026-10-04, LOCKED): "Places to go" is a fallback enrichment of a typed ask, never a discovery surface.
const fs = require('fs');
const path = require('path');
const { placesToGoActivity, pickPlacesToGo, PLACES_TO_GO_ACTIVITIES, MAX_PLACES_TO_GO } = require('./placesToGo');
const { tagsForPhrase } = require('../constants/categorySynonyms');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const appFiles = walk(path.join(ROOT, 'src')).filter((p) => p.endsWith('.js') && !/\.(test|journey)\.js$/.test(p))
  .map((p) => path.relative(ROOT, p).split(path.sep).join('/'));

const place = (id, name, miles) => ({ placeId: id, name, latitude: 40 + miles / 100, longitude: -75, distanceMiles: miles, rating: 4.8, openNow: true, types: ['park'] });

describe('the fixed allowlist is the only gate', () => {
  it('is exactly the owner-approved list, all real canonical tags', () => {
    expect(PLACES_TO_GO_ACTIVITIES).toEqual(['Walking', 'Hiking', 'Running', 'Trails', 'Parks', 'Beaches', 'Picnics', 'Scenic Views', 'Gardens', 'Playgrounds']);
    for (const tag of PLACES_TO_GO_ACTIVITIES) expect(tagsForPhrase(tag)).toContain(tag);
  });

  it('1. "go for a walk tonight" qualifies (and the other everyday allowlisted asks)', () => {
    expect(placesToGoActivity('go for a walk tonight')).toBe('Walking');
    expect(placesToGoActivity('take a walk after dinner')).toBe('Walking');
    expect(placesToGoActivity('hike tomorrow morning')).toBe('Hiking');
    expect(placesToGoActivity('beach day saturday')).toBe('Beaches');
    expect(placesToGoActivity('picnic with the kids')).toBe('Picnics');
    expect(placesToGoActivity('go running')).toBe('Running');
  });

  it('2. an unlisted activity, a walk-in, or walking distance does not trigger Places', () => {
    for (const t of ['coffee tonight', 'dinner with friends', 'a walk-in clinic', 'walk-in haircut', 'coffee within walking distance',
      'somewhere walkable for drinks', 'museum this weekend', 'something fun tonight', 'go kayaking', 'camping trip', '']) {
      expect(placesToGoActivity(t)).toBeNull();
    }
  });

  it('the walk phrases are gate-only: the ask itself still resolves exactly as before (no new category synonym)', () => {
    expect(tagsForPhrase('go for a walk tonight')).toEqual([]);
    expect(tagsForPhrase('take a walk')).toEqual([]);
  });
});

describe('what a place shows', () => {
  it('at most 3, nearest first, name + distance + directions only', () => {
    const out = pickPlacesToGo([place('a', 'Far Park', 4), place('b', 'Waterfront Trail', 0.4), place('c', 'Mid Park', 1.2), place('d', 'Near Garden', 0.8), place('b', 'Waterfront Trail', 0.4)], 'en');
    expect(MAX_PLACES_TO_GO).toBe(3);
    expect(out.map((p) => p.name)).toEqual(['Waterfront Trail', 'Near Garden', 'Mid Park']);
    for (const p of out) {
      expect(Object.keys(p).sort()).toEqual(['context', 'destination', 'id', 'name']);
      expect(p.destination.kind).toBe('url');
    }
    expect(JSON.stringify(out)).not.toMatch(/our pick|because|reason|book|reserve|available|open now|rating/i);
  });

  it('a place with no way to get directions is dropped; nothing is invented', () => {
    expect(pickPlacesToGo([{ name: 'Nowhere' }], 'en')).toEqual([]);
    expect(pickPlacesToGo(null, 'en')).toEqual([]);
  });
});

describe('boundaries', () => {
  const NEW = ['src/utils/placesToGo.js', 'src/hooks/usePlacesToGo.js', 'src/components/PlacesToGoSection.js'];

  it('3. Places never enter Nearby ranking or results: only Home/Discover render the section, nothing else imports it', () => {
    const users = appFiles.filter((f) => !NEW.includes(f) && !f.startsWith('src/i18n/ui/') && /placesToGo|PlacesToGo/.test(read(f)));
    expect(users.sort()).toEqual(['src/screens/DiscoverHubScreen.js', 'src/screens/HomeScreen.js']);
    for (const f of ['src/services/intentResolver.js', 'src/utils/askResolver.js', 'src/constants/signalPriority.js', 'src/utils/askEligibility.js']) {
      expect(read(f)).not.toMatch(/placesToGo|searchNearbyPlaces/);
    }
    // The section gets only `places`, never the ask's items, and sits below the results.
    for (const f of ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js']) {
      for (const m of read(f).matchAll(/<PlacesToGoSection ([^/]*)\/>/g)) expect(m[1].trim()).toBe('places={placesToGo.places} navigation={navigation}');
    }
  });

  it('4. Places never enter Surprise Me or multi-part plans', () => {
    const planning = appFiles.filter((f) => /surprise|experience|planAsk|planCombinations|planTiming/i.test(f));
    expect(planning.length).toBeGreaterThan(3);
    for (const f of planning) expect(read(f)).not.toMatch(/placesToGo|PlacesToGo|searchNearbyPlaces/);
    expect(read('src/screens/DiscoverHubScreen.js')).toContain("usePlacesToGo(intentSearch && intentSearch.outcome !== 'pick_for_me'");
  });

  it('5. nothing is stored, logged or learned from places or their taps', () => {
    for (const f of NEW) {
      expect(read(f)).not.toMatch(/supabase|AsyncStorage|behavior|recordIntent|recordTypedAsk|formDrafts|logBehavior|rpc\(/);
    }
    expect(read('src/components/PlacesToGoSection.js')).toMatch(/onPress=\{\(\) => openDestination\(navigation, p\.destination\)\}/);
  });

  it('6. existing Nearby business/gathering results are unchanged: no ranking, eligibility or result file reads places', () => {
    // The fixed typed-ask ordering fixture (services/askEligibility.regression.test.js) pins the results themselves; here we pin
    // that nothing in the result pipeline can see the places, and that the screens render the ask's own items untouched.
    const pipeline = appFiles.filter((f) => /^src\/(services|utils|constants)\//.test(f) && !NEW.includes(f));
    for (const f of pipeline) expect(read(f)).not.toMatch(/placesToGo|PlacesToGo/);
    expect(read('src/screens/DiscoverHubScreen.js')).toContain('intentSearch.items.map(renderIntentSearchResultRow)');
  });

  it('7. the external search runs only for a submitted, qualifying typed ask', () => {
    const hook = read('src/hooks/usePlacesToGo.js');
    expect(hook).toMatch(/if \(!activity\) \{ setState/);
    expect(read('src/screens/HomeScreen.js')).toContain('usePlacesToGo(intentResults?.typedText ?? intentEmptyFallback?.typedText ?? null, language)');
    const callers = appFiles.filter((f) => /searchNearbyPlaces\(/.test(read(f)) && f !== 'src/services/places.js');
    expect(callers.sort()).toEqual(['src/hooks/usePlacesToGo.js', 'src/screens/CreateGatheringScreen.js', 'src/screens/DiscoverHubScreen.js']);
  });
});
