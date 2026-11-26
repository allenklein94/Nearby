// Host familiarity (owner, 2026-11-11; migration 20270410): a tie-breaker only, on Home (candidate pool, Picked For You, Best
// Pick), Discover and typed asks. It never outranks any ladder signal, never crosses Discover's one-mile distance band, never
// adds a reason or makes a pick personal, and never touches trust, limits, moderation or access.
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../services/friends', () => ({ getMyFriends: jest.fn() }));
jest.mock('../services/communities', () => ({ getMyCommunities: jest.fn() }));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn(), requireUserLocation: jest.fn() }));

import fs from 'fs';
import path from 'path';
import { familiarHostsFromRows, familiarityOf, compareFamiliarity, distanceBand, FAMILIARITY_CAP, EMPTY_FAMILIAR_HOSTS } from './hostFamiliarity';
import { compareDiscover } from './discoverSections';
import { buildHomeRecommendations } from '../services/homeRecommendations';
import { pickBestGathering } from '../services/gatherings';
import { selectHomeAttention } from './homeAttention';
import { tierVector, SIGNAL_TIERS } from '../constants/signalPriority';

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const familiar = familiarHostsFromRows([{ person_id: 'met', shared_count: 3 }, { person_id: 'once', shared_count: 1 }]);

describe('host familiarity: one source, one rule', () => {
  beforeAll(() => { jest.useFakeTimers({ now: new Date(2026, 10, 11, 12, 0) }); });
  afterAll(() => { jest.useRealTimers(); });

  it('reads the server rows, capped at 3; malformed rows and the empty case change nothing', () => {
    expect(FAMILIARITY_CAP).toBe(3);
    const m = familiarHostsFromRows([{ person_id: 'a', shared_count: 9 }, { person_id: 'b', shared_count: 0 }, { person_id: null, shared_count: 2 }, { shared_count: 'x' }]);
    expect([...m.entries()]).toEqual([['a', 3]]);
    expect(familiarityOf('a', m)).toBe(3);
    expect(familiarityOf('zz', m)).toBe(0);
    expect(familiarityOf('a', null)).toBe(0);
    expect(compareFamiliarity({ host_id: 'met' }, { host_id: 'x' }, EMPTY_FAMILIAR_HOSTS)).toBe(0);
    expect(compareFamiliarity({ host_id: 'met' }, { host_id: 'x' }, familiar)).toBeLessThan(0);
    expect(compareFamiliarity({ host_id: 'once' }, { host_id: 'met' }, familiar)).toBeGreaterThan(0);
  });

  it('Discover: breaks a tie on the ladder within the same mile; a nearer band and any ladder point still win', () => {
    const v = (d) => tierVector([{ tier: SIGNAL_TIERS.interest, delta: d }]);
    const item = (id, miles, fam, vec = v(5)) => ({ id, distanceMiles: miles, fit: { rankVector: vec, familiarity: fam } });
    const sort = (xs) => [...xs].sort(compareDiscover).map((x) => x.id);
    // same band (0.2 vs 0.8 mi): the familiar host first, though slightly farther
    expect(sort([item('near', 0.2, 0), item('met', 0.8, 3)])).toEqual(['met', 'near']);
    // different bands (0.8 vs 1.4 mi): nearest first, familiarity ignored
    expect(sort([item('met', 1.4, 3), item('near', 0.8, 0)])).toEqual(['near', 'met']);
    // a stronger ladder never loses to familiarity
    expect(sort([item('met', 0.2, 3, v(4)), item('fit', 0.2, 0, v(5))])).toEqual(['fit', 'met']);
    // no familiarity anywhere = the old nearest-first order exactly
    expect(sort([item('b', 0.9, 0), item('a', 0.3, 0), item('c', 2.5, 0)])).toEqual(['a', 'b', 'c']);
    expect(distanceBand(null)).toBe(Infinity);
  });

  it('Home candidate pool: an exact score tie only; never a score point or a reason, never personal', () => {
    const gathering = (id, host, extra = {}) => ({ id, host_id: host, title: id, interest_tag: 'Coffee', scheduled_at: new Date(2026, 10, 14, 18).toISOString(), distanceMiles: 1, ...extra });
    const pool = [gathering('plain', 'x'), gathering('met', 'met')];
    const without = buildHomeRecommendations({ gatherings: pool });
    const withF = buildHomeRecommendations({ gatherings: pool, familiarHosts: familiar });
    expect(without.map((r) => r.id)).toEqual(['plain', 'met']);
    expect(withF.map((r) => r.id)).toEqual(['met', 'plain']);
    expect(withF.map((r) => [r.score, r.reasons, r.personal])).toEqual(without.map((r) => [r.score, r.reasons, r.personal]).reverse());
    // a higher score still wins
    const interest = buildHomeRecommendations({ gatherings: [gathering('met', 'met'), gathering('mine', 'x', { matchesYourInterests: true })], familiarHosts: familiar });
    expect(interest[0].id).toBe('mine');
  });

  it('Best Pick: between equally ranked eligible picks only; never makes a gathering eligible', () => {
    const g = (id, host, extra = {}) => ({ id, host_id: host, interest_tag: 'Coffee', scheduled_at: new Date(2026, 10, 14, 18).toISOString(), capacity: null, approvedCount: 0, approvedAttendees: [], matchesYourInterests: true, ...extra });
    expect(pickBestGathering([g('plain', 'x'), g('met', 'met')], { familiarHosts: familiar }).id).toBe('met');
    expect(pickBestGathering([g('plain', 'x'), g('met', 'met')]).id).toBe('plain');
    // not personal (no interest): still no pick, however familiar the host
    expect(pickBestGathering([g('met', 'met', { matchesYourInterests: false, distanceMiles: 0.5, distanceLabel: '0.5 mi away' })], { familiarHosts: familiar })).toBeNull();
  });

  it('Picked For You: only between cards tied on the ladder; a non-personal card never gets in', () => {
    const card = (id, host, kind = 'interest') => ({ gathering: { id, host_id: host, interest_tag: 'Coffee', scheduled_at: new Date(2026, 10, 14, 18).toISOString() }, signals: [{ kind, text: 'Because you like Coffee' }], reasons: [], hasFriend: false, trendingOnly: false });
    const ids = (r) => r.items.map((e) => e.gathering.id);
    expect(ids(selectHomeAttention({ cards: [card('plain', 'x'), card('met', 'met')] }))).toEqual(['plain', 'met']);
    expect(ids(selectHomeAttention({ cards: [card('plain', 'x'), card('met', 'met')], familiarHosts: familiar }))).toEqual(['met', 'plain']);
    const notPersonal = { gathering: { id: 'met-only', host_id: 'met', scheduled_at: new Date(2026, 10, 14, 18).toISOString() }, signals: [{ kind: 'soon', text: 'Starting soon' }], reasons: [] };
    expect(ids(selectHomeAttention({ cards: [notPersonal], familiarHosts: familiar }))).toEqual([]);
  });

  it('typed asks: the last tie-break, after the ladder and the existing personal tie-break', () => {
    const src = read('src/services/intentResolver.js');
    expect(src).toMatch(/compareRanked\(a, b\) \|\| comparePersonalTieBreak\(a, b\) \|\| compareFamiliarity\(a, b, familiarHosts/);
  });

  it('never shown and never trust: no reason text, and only ranking files read it; no trust, limit or moderation SQL calls it', () => {
    const helper = read('src/utils/hostFamiliarity.js');
    expect(helper).not.toMatch(/reasonText|REASON_TEXT|tr\(/);
    const readers = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${f.name}`;
        if (f.isDirectory()) walk(p);
        else if (/\.js$/.test(f.name) && !/\.test\.js$/.test(f.name) && /hostFamiliarity|familiarHosts|get_my_familiar_hosts/.test(read(p))) readers.push(p);
      }
    };
    walk('src');
    expect(readers.sort()).toEqual([
      'src/hooks/usePersonalization.js', 'src/journeys/blockedAttendeePrivacy.journey.js', 'src/journeys/hostFamiliarity.journey.js', 'src/screens/DiscoverHubScreen.js', 'src/screens/HomeScreen.js',
      'src/services/familiarHosts.js', 'src/services/gatherings.js', 'src/services/homeDashboard.js', 'src/services/homeRecommendations.js',
      'src/services/intentResolver.js', 'src/utils/discoverSections.js', 'src/utils/homeAttention.js', 'src/utils/hostFamiliarity.js',
    ].sort());
    const sqlUsers = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => read(`supabase/migrations/${f}`).includes('get_my_familiar_hosts'));
    expect(sqlUsers).toEqual(['20270410_familiar_hosts.sql']);
    const mig = read('supabase/migrations/20270410_familiar_hosts.sql').replace(/^\s*--.*$/gm, '');
    expect(mig).not.toMatch(/trust_level|rate_limit|insert |update |delete /i);
    expect(mig).toMatch(/least\(count\(distinct t\.id\), 3\)/);
    expect(mig).toMatch(/revoke all on function public\.get_my_familiar_hosts\(\) from public, anon/);
  });
});
