// Owner, 2026-10-17 (Option A, final; PRODUCT_AUDIT/PLACE_COUNT_ORACLE_SCOPE_2026-10-17.md):
//   1. The Places "N gatherings here" count is gone everywhere: no function, caller, string or field (migration 20270325).
//   2. A gathering's pin is privacy-shifted (item 146 Option A, up to ~0.5 mi), so its location reads as approximate to a
//      sighted viewer, not only to a screen reader: every gathering distance says "About ..." (miles only), and the Discover
//      map says so in its callout and in one caption whenever a gathering pin is shown. Business distances stay exact.
const fs = require('fs');
const path = require('path');
import { formatApproxDistance, formatApproxDistanceAway, approximateMiles } from './formatDistance';
import { localApproxDistance } from '../i18n/format';
import { displayApproxDistance } from '../i18n/display';
import { recommendationContext, contextItem } from './recommendationContext';
import { recommendationFacts, factsMeta } from './recommendationFacts';
import { strongMatchPieces } from './strongMatch';
import { categorizeReasonText, isContextRestatement, REASON_CATEGORIES } from '../constants/recommendationReasonVocabulary';
import { localizeReason } from './reasonLocalization';
import { translations } from '../i18n/translations';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('the place gathering count is gone', () => {
  const sources = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'supabase', 'functions'))]
    .filter((f) => !f.endsWith('approximateGatheringLocation.test.js') && !f.includes(`${path.sep}journeys${path.sep}`));

  test('no app or edge function source calls or names count_gatherings_near(_batch)', () => {
    expect(sources.filter((f) => /count_gatherings_near/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  test('no gatheringCount field and no "gatherings here" strings remain', () => {
    expect(sources.filter((f) => /gatheringCount\b|gatheringsHere|hostedHereA11y/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))).toEqual([]);
    const places = JSON.parse(read('scripts/i18n/strings/places.json'));
    for (const l of LANGS) {
      expect(places[l].gatheringsHere).toBeUndefined();
      expect(places[l].hostedHereA11y).toBeUndefined();
    }
  });

  test('Places search makes no gathering database call (only the Google budget claim + switch, owner 2026-10-22)', () => {
    const src = read('src/services/places.js');
    const rpcs = [...src.matchAll(/supabase\.rpc\('([a-z_]+)'/g)].map((m) => m[1]);
    expect(rpcs.sort()).toEqual(['claim_places_search', 'places_also_nearby_enabled']);
    expect(src).not.toMatch(/count_gatherings|\.from\(/);
  });

  test('migration 20270325 drops both signatures and no later migration recreates either', () => {
    const dir = path.join(ROOT, 'supabase', 'migrations');
    expect(read('supabase/migrations/20270325_drop_place_gathering_count.sql')).toMatch(
      /drop function if exists public\.count_gatherings_near_batch\(double precision\[\], double precision\[\]\);/);
    const later = fs.readdirSync(dir).filter((f) => f > '20270325_drop_place_gathering_count.sql');
    for (const f of later) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/create (or replace )?function public\.count_gatherings_near/);
  });
});

describe('gathering distances read as approximate', () => {
  test('one rule: "About", miles only (never feet), at least 0.1, whole miles from 10', () => {
    expect(formatApproxDistance(0.3)).toBe('About 0.3 mi');
    expect(formatApproxDistance(0.01)).toBe('About 0.1 mi');
    expect(formatApproxDistance(0.15)).toMatch(/^About 0\.[12] mi$/);
    expect(formatApproxDistance(12.4)).toBe('About 12 mi');
    expect(formatApproxDistanceAway(0.3)).toBe('About 0.3 mi away');
    for (const bad of [null, undefined, NaN, -1, '1']) {
      expect(formatApproxDistance(bad)).toBeNull();
      expect(approximateMiles(bad)).toBeNull();
    }
    for (const m of [0, 0.02, 0.1, 0.18, 0.5]) expect(formatApproxDistance(m)).not.toMatch(/ft/);
  });

  test('every language has both templates, and the localized figure is the same decision', () => {
    for (const l of LANGS) {
      expect(translations[l].reasons.approxDistance).toMatch(/\{distance\}/);
      expect(translations[l].reasons.approxDistanceAway).toMatch(/\{distance\}/);
    }
    expect(displayApproxDistance(0.3, 'en')).toBe('About 0.3 mi');
    expect(localApproxDistance(0.3, 'de')).toBe(translations.de.reasons.approxDistance.replace('{distance}', translations.de.vocab.units.miles.replace('{n}', '0,3')));
    expect(localApproxDistance(0.02, 'es')).not.toMatch(/pies/);
  });

  test('the shared context line: a gathering says "About", a business stays exact', () => {
    const soon = new Date(Date.now() + 3 * 3600e3).toISOString();
    const g = recommendationContext(contextItem('gathering', { id: 'g', title: 'Run', scheduled_at: soon, distanceMiles: 1.1 }));
    expect(g.context).toMatch(/^About 1\.1 mi · /);
    const es = recommendationContext(contextItem('gathering', { id: 'g', title: 'Run', scheduled_at: soon, distanceMiles: 1.1 }), { language: 'es' });
    expect(es.context.startsWith(localApproxDistance(1.1, 'es'))).toBe(true);
    const b = recommendationContext(contextItem('business', { id: 'b', name: 'Cafe', distanceMiles: 1.1 }));
    expect(b.context).toBe('1.1 mi');
  });

  test('recommendation facts (gatherings) say "About"', () => {
    const soon = new Date(Date.now() + 3 * 3600e3).toISOString();
    expect(recommendationFacts({ distanceMiles: 1.34, scheduled_at: soon }).distance).toBe('About 1.3 mi');
    expect(factsMeta({ distanceMiles: 0.2 }, 'Tonight')).toBe('About 0.2 mi · Tonight');
  });

  test('the approximate reason is a distance restatement (context line, never the why) and is localized', () => {
    expect(categorizeReasonText('About 0.3 mi away')).toBe(REASON_CATEGORIES.DISTANCE);
    expect(isContextRestatement('About 0.3 mi away')).toBe(true);
    expect(isContextRestatement('About 12 mi')).toBe(true);
    expect(localizeReason('About 0.3 mi away', 'en')).toBe('About 0.3 mi away');
    expect(localizeReason('About 0.3 mi away', 'fr')).toBe(translations.fr.reasons.approxDistanceAway.replace('{distance}', translations.fr.vocab.units.miles.replace('{n}', '0,3')));
  });

  test("item 37's place tick is approximate for a gathering, exact for a business", () => {
    const at = new Date(); at.setHours(20, 0, 0, 0);
    const now = new Date(at.getTime() - 3600e3);
    const ask = { category: 'Coffee', dateWindow: 'tonight' };
    const base = { category: 'Coffee', distanceMiles: 0.4 };
    const place = (item) => strongMatchPieces(item, ask, now)?.find((p) => p.key === 'place');
    expect(place({ ...base, type: 'gathering', startsAt: at.toISOString() })?.approximate).toBe(true);
    const biz = place({ ...base, type: 'business_availability', postingStartsAt: at.toISOString() });
    expect(biz).toBeTruthy();
    expect(biz.approximate).toBe(false);
    expect(read('src/motion/StrongMatch.js')).toMatch(/p\.approximate \? displayApproxDistance : displayDistance/);
  });

  test('every gathering distance source uses the approximate rule', () => {
    const svc = read('src/services/gatherings.js');
    expect(svc).not.toMatch(/formatDistanceAway\(/);
    expect((svc.match(/distanceLabel = distanceMiles !== null\s*\?\s*formatApproxDistanceAway\(distanceMiles\)/g) ?? []).length
      + (svc.match(/distanceLabel: distanceMiles !== null\s*\?\s*formatApproxDistanceAway\(distanceMiles\)/g) ?? []).length).toBe(2);
    expect(read('src/screens/OnboardingRecommendationsScreen.js')).toMatch(/displayApproxDistance\(r\.distanceMiles/);
    expect(read('src/screens/OnboardingRecommendationsScreen.js')).not.toMatch(/displayDistance\(/);
  });
});

describe('the Discover map says gathering pins are approximate, in words', () => {
  const map = read('src/components/GatheringsMapView.js');
  const mapStrings = JSON.parse(read('scripts/i18n/strings/mapView.json'));

  test("a gathering pin's callout carries the approximate-area line", () => {
    const callout = map.slice(map.indexOf('stackGatheringPins('), map.indexOf('pinnableDeals.map'));
    expect(callout).toMatch(/t\('ui\.smallParts\.anApproximateAreaNotAn'\)/);
  });

  test('one static caption whenever a gathering pin is on the map, never intercepting touches', () => {
    expect(map).toMatch(/pinnableGatherings\.length > 0 && \(\s*<View style=\{styles\.approxCaption\} pointerEvents="none">\s*<Text style=\{styles\.approxCaptionText\}>\{t\('ui\.mapView\.gatheringPinsApproximate'\)\}/);
    for (const l of LANGS) expect(mapStrings[l].gatheringPinsApproximate).toEqual(expect.any(String));
    expect(mapStrings.en.gatheringPinsApproximate).toBe('Gathering pins show an approximate area, not the exact spot');
  });
});
