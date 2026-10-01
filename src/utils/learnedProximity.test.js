// Item 137, adaptive personal proximity: the learner and its safeguards (pure), plus storage/privacy guards on the migration.
import fs from 'fs';
import path from 'path';
import { learnProximity, learnedProximityDelta, learnedProximityFor, learnedProximityApplies, applyLearnedProximity, usualTripRows,
  MIN_CHOICES, RECENT_CHOICES, LEARNED_PROXIMITY_POINTS } from './learnedProximity';

const day = (n) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString();
const trips = (category, miles, from = 0, event = 'join') => miles.map((m, i) => ({ category, trip_miles: m, event_type: event, created_at: day(from + i) }));

describe('learning per category', () => {
  const learned = learnProximity([...trips('Coffee', [0.3, 0.5, 0.4, 0.6]), ...trips('Restaurants', [14, 18, 22, 20], 10, 'accept')]);
  test('coffee and dinner are learned separately', () => {
    expect(learned.Coffee).toMatchObject({ status: 'learned', typicalMiles: 0.5, count: 4 });
    expect(learned.Restaurants).toMatchObject({ status: 'learned', typicalMiles: 19, count: 4, sources: { accept: 4 } });
  });
  test('a 15 mi trip is usual for dinner and far for coffee; dinner habits never apply to coffee', () => {
    expect(learnedProximityFor(learned, 'Restaurants', 15)).toBe(1);
    expect(learnedProximityFor(learned, 'Coffee', 15)).toBe(-1);
    expect(learnedProximityFor(learned, 'Coffee', 0.4)).toBe(1);
  });
  test('no fallback to the group or another category: Bars learns nothing from Coffee or Restaurants', () => {
    expect(learnedProximityFor(learned, 'Bars & Lounges', 0.4)).toBe(0);
    expect(learnedProximityFor(learned, 'Bars & Lounges', 30)).toBe(0);
  });
});

describe('not enough evidence / conflicting evidence = default behavior', () => {
  test(`fewer than ${MIN_CHOICES} choices learns nothing`, () => {
    const l = learnProximity(trips('Coffee', [0.3, 0.4]));
    expect(l.Coffee).toEqual({ status: 'insufficient', count: 2 });
    expect(learnedProximityFor(l, 'Coffee', 0.3)).toBe(0);
    expect(learnedProximityFor(l, 'Coffee', 40)).toBe(0);
  });
  test('choices that disagree (very close AND far) learn nothing', () => {
    const l = learnProximity(trips('Coffee', [0.3, 0.4, 12, 15]));
    expect(l.Coffee.status).toBe('mixed');
    expect(learnedProximityFor(l, 'Coffee', 0.3)).toBe(0);
  });
  test('an occasional far trip does not make someone a long-distance person', () => {
    const l = learnProximity(trips('Coffee', [0.4, 0.5, 0.3, 0.6, 9]));
    expect(l.Coffee).toMatchObject({ status: 'learned', typicalMiles: 0.5 });
    expect(learnedProximityFor(l, 'Coffee', 9)).toBe(-1);
  });
  test('garbage rows are ignored; no rows = nothing', () => {
    expect(learnProximity([{ category: 'Coffee', trip_miles: null }, { trip_miles: 1 }, { category: 'Coffee', trip_miles: -2 }])).toEqual({});
    expect(learnProximity(null)).toEqual({});
    expect(learnedProximityDelta(1, undefined)).toBe(0);
    expect(learnedProximityDelta(null, { status: 'learned', typicalMiles: 1 })).toBe(0);
  });
});

describe('adapts as behavior changes', () => {
  test(`only the newest ${RECENT_CHOICES} choices count: moving from short to long trips moves the profile`, () => {
    const old = trips('Restaurants', Array(RECENT_CHOICES).fill(1), 0);
    const recent = trips('Restaurants', Array(RECENT_CHOICES).fill(15), 40);
    expect(learnProximity(old).Restaurants.typicalMiles).toBe(1);
    expect(learnProximity([...old, ...recent]).Restaurants.typicalMiles).toBe(15);
  });
});

describe('explicit preferences stay in control', () => {
  const rows = trips('Restaurants', [20, 22, 25]);
  test('an explicit maximum caps what was learned (never exceeded)', () => {
    expect(learnProximity(rows).Restaurants.typicalMiles).toBe(22);
    expect(learnProximity(rows, { maxMiles: 10 }).Restaurants.typicalMiles).toBe(10);
  });
  test('lowering the explicit maximum takes effect immediately (read live, nothing stored)', () => {
    const before = learnProximity(rows, { maxMiles: 30 });
    const after = learnProximity(rows, { maxMiles: 5 });
    expect(learnedProximityFor(before, 'Restaurants', 20)).toBe(1);
    expect(learnedProximityFor(after, 'Restaurants', 20)).toBe(-1);
  });
  test('stated distance or way of travelling in the words turns learning off', () => {
    expect(learnedProximityApplies({})).toBe(true);
    expect(learnedProximityApplies({ distanceWillingness: 'very_nearby' })).toBe(false);
    expect(learnedProximityApplies({ distanceWillingness: 'willing_to_travel' })).toBe(false);
    expect(learnedProximityApplies({ transportMode: 'walking' })).toBe(false);
  });
});

describe('ranking safeguards', () => {
  const learned = learnProximity(trips('Restaurants', [15, 18, 20]));
  test('monotonic: on its own it never puts a farther result above a closer one', () => {
    const miles = [0, 0.2, 1, 5, 10, 18, 22, 30, 60, 100, 400];
    const deltas = miles.map((m) => learnedProximityFor(learned, 'Restaurants', m));
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]).toBeLessThanOrEqual(deltas[i - 1]);
  });
  test('modest: one point, below every ask-specific lift (2)', () => {
    expect(LEARNED_PROXIMITY_POINTS).toBe(1);
  });
  test('re-scores only: same results, nothing added or removed, including past any limit', () => {
    const cands = [{ id: 'a', category: 'Restaurants', distanceMiles: 2, score: 5 }, { id: 'b', category: 'Restaurants', distanceMiles: 300, score: 5 },
      { id: 'c', category: 'Coffee', distanceMiles: 1, score: 5 }, { id: 'd', category: 'Restaurants', distanceMiles: null, score: 5 }];
    const out = applyLearnedProximity(cands, learned);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.map((c) => c.score)).toEqual([6, 4, 5, 5]);
  });
  test('nothing learned = the very same array (existing results unchanged)', () => {
    const cands = [{ id: 'a', category: 'Coffee', distanceMiles: 1, score: 3 }];
    expect(applyLearnedProximity(cands, {})).toBe(cands);
    expect(applyLearnedProximity(cands, null)).toBe(cands);
  });
  test('a person who travels: the profile is trip LENGTH, so it applies the same wherever they are now', () => {
    // two people with the same trip lengths from different home cities learn the same thing
    expect(learnProximity(trips('Coffee', [0.4, 0.5, 0.6]))).toEqual(learnProximity(trips('Coffee', [0.6, 0.4, 0.5], 30)));
  });
});

test('Settings rows show only what is really applied', () => {
  const l = learnProximity([...trips('Coffee', [0.3, 0.4, 0.5]), ...trips('Bars & Lounges', [1, 2])]);
  expect(usualTripRows(l)).toEqual([{ category: 'Coffee', typicalMiles: 0.4, count: 3 }]);
});

describe('storage and privacy (migration 20270255)', () => {
  const root = path.join(__dirname, '..', '..');
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20270255_learned_trip_distances.sql'), 'utf8');
  test('only a miles figure is stored, never a coordinate', () => {
    expect(sql).toMatch(/add column if not exists trip_miles numeric\(6,1\)/);
    expect(sql).not.toMatch(/add column[^;]*(lat|lng|lon|location)/i);
    expect(sql).not.toMatch(/insert into behavior_events[^;]*origin/i);
  });
  test('only real choices carry a trip (joins and accepted offers), never views/searches', () => {
    expect(sql).toMatch(/trip_miles is null or \(event_type in \('join', 'accept'\)/);
  });
  test('one overload; the internal distance helper is not callable by clients; the read is the caller\'s own', () => {
    expect(sql).toMatch(/drop function if exists public\.record_behavior_event\(text, text, uuid, text\);/);
    expect(sql).toMatch(/revoke all on function public\._trip_miles[^;]*from public, anon, authenticated/);
    expect(sql).toMatch(/where be\.user_id = auth\.uid\(\) and be\.trip_miles is not null/);
  });
  test('no other migration, edge function or business-facing code reads trip_miles', () => {
    const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
    const sqlUsers = walk(path.join(root, 'supabase')).filter((f) => /\.(sql|ts)$/.test(f) && fs.readFileSync(f, 'utf8').includes('trip_miles'));
    expect(sqlUsers.map((f) => path.basename(f))).toEqual(['20270255_learned_trip_distances.sql']);
    const src = walk(path.join(root, 'src')).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f));
    const appUsers = src.filter((f) => /trip_miles|get_my_trip_choices/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(path.join(root, 'src'), f)).sort();
    expect(appUsers).toEqual(['services/learnedProximity.js', 'utils/learnedProximity.js']);
    // the business dashboard / business services never import it
    for (const f of src.filter((x) => /Business|business/.test(path.basename(x)))) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/learnedProximity/);
    }
  });
  test('sponsorship and business routing never read it', () => {
    const read = (p) => fs.readFileSync(path.join(root, 'src', p), 'utf8');
    for (const p of ['components/SponsoredSpotlightSlot.js', 'components/SponsoredCard.js']) expect(read(p)).not.toMatch(/learnedProximity/);
  });
  test('the typed-ask audit records the step as a proximity signal, not the person\'s trips', () => {
    const audit = fs.readFileSync(path.join(root, 'src/utils/typedAskAudit.js'), 'utf8');
    expect(audit).toMatch(/learned_proximity: 'proximity'/);
    expect(audit).not.toMatch(/typicalMiles|trip_miles/);
  });
});

describe('Gatherings feed (the one ladder)', () => {
  const { rankGatheringFeed, feedRankParts } = require('./gatheringFeedRanking');
  const g = (id, tag, miles, extra = {}) => ({ id, interest_tag: tag, distanceMiles: miles, capacity: null, approvedCount: 0, ...extra });
  const walker = learnProximity(trips('Coffee', [0.3, 0.4, 0.5]));
  test('learned proximity is the weakest tier: it reorders only among otherwise-equal gatherings', () => {
    // incoming order is nearest-first; a far coffee and a near coffee: unchanged order (monotonic)
    const list = [g('near', 'Coffee', 0.4), g('far', 'Coffee', 8)];
    expect(rankGatheringFeed(list, { personalization: { learnedProximity: walker } }).map((x) => x.id)).toEqual(['near', 'far']);
    // a stronger signal (a declared interest) still wins over learned proximity
    const list2 = [g('near', 'Coffee', 0.4), g('yoga', 'Yoga', 9)];
    expect(rankGatheringFeed(list2, { personalization: { learnedProximity: walker, declared: ['Yoga'] } }).map((x) => x.id)).toEqual(['yoga', 'near']);
  });
  test('nothing learned = the feed parts are exactly what they were', () => {
    const x = g('a', 'Coffee', 8);
    expect(feedRankParts(x, { personalization: {} }).map((p) => p.code)).not.toContain('learned_proximity');
    expect(feedRankParts(x, { personalization: { learnedProximity: walker } })).toEqual(expect.arrayContaining([{ code: 'learned_proximity', tier: 10, delta: -1 }]));
  });
  test('Discover feeds the same part into its tier vector', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'DiscoverHubScreen.js'), 'utf8');
    expect(src).toMatch(/SIGNAL_TIERS\.discovery, delta: learnedProximityFor\(personalization\.learnedProximity, g\.interest_tag, g\.distanceMiles\)/);
  });
});
