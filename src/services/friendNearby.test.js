// Item 39 (owner, 2026-10-11): "A friend is nearby". The server rules (consent, friends only, freshness, distance, blocks,
// throttle, retention) are proven on the live DB in journeys/friendNearby.journey.js. Here: the client throttle, the
// foreground-only reporter, Home's line (priority, ONE friend, Invite), and the guards that keep consent and location
// where the owner put them.
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./proximity', () => ({}));
jest.mock('./gatherings', () => ({}));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn() }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
const fs = require('fs');
const path = require('path');
import { shouldReportFix, createFriendNearbyReporter } from './friendNearby';
import { getHomeInsight } from './homeDashboard';
import { FRIEND_NEARBY } from '../constants/friendNearby';

const SRC = path.join(__dirname, '..');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'journeys') walk(p, out); } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
};
const sources = walk(SRC).map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }));

const here = { latitude: 40.3, longitude: -75.2 };
const near = { latitude: 40.301, longitude: -75.2 }; // ~0.07 mi
const moved = { latitude: 40.305, longitude: -75.2 }; // ~0.35 mi

describe('report throttle (mirrors the server; the server enforces it again)', () => {
  test('first fix goes; then one per 5 minutes unless moved >= 0.25 mi', () => {
    expect(shouldReportFix(null, here, 0)).toBe(true);
    const last = { coords: here, at: 0 };
    expect(shouldReportFix(last, near, 60 * 1000)).toBe(false);
    expect(shouldReportFix(last, moved, 60 * 1000)).toBe(true);
    expect(shouldReportFix(last, near, FRIEND_NEARBY.minReportIntervalMs)).toBe(true);
    expect(shouldReportFix(last, { latitude: 'x' }, 10 ** 9)).toBe(false);
  });

  test('nothing is sent while sharing is off or the app is not in the foreground; a failed send is retried', async () => {
    const sent = [];
    let sharing = false; let fg = true; let t = 0; let fail = false;
    const r = createFriendNearbyReporter({ send: async (a, b) => { if (fail) throw new Error('x'); sent.push([a, b]); }, isSharing: () => sharing, isForeground: () => fg, now: () => t });
    await r(here);
    expect(sent).toHaveLength(0);
    sharing = true; fg = false;
    await r(here);
    expect(sent).toHaveLength(0);
    fg = true; fail = true;
    await r(here);
    expect(sent).toHaveLength(0);
    fail = false;
    await r(here); // the failure did not count as sent
    expect(sent).toHaveLength(1);
    t = 1000;
    await r(near);
    expect(sent).toHaveLength(1);
  });
});

describe('Home social line', () => {
  const friend = { id: 'f1', name: 'Claude', photoPath: 'p/1.jpg' };

  test('one friend: "{Name} is nearby" + Invite {Name} -> Create with them preselected; nothing else about them', () => {
    const r = getHomeInsight({ nearbyFriend: friend });
    expect(r.kind).toBe('friend_nearby');
    expect(r.text).toBe('Claude is nearby');
    expect(r.cta.label).toBe('Invite Claude');
    expect(r.cta.destination).toEqual({ kind: 'navigate', screen: 'CreateGathering', params: { suggestedInviteeIds: ['f1'] } });
    expect(r.person).toEqual({ id: 'f1', photoPath: 'p/1.jpg' });
    expect(r.text).not.toMatch(/\d|mi\b|km|min|ago|away/);
    expect(r.basis).toBeUndefined();
  });

  test('LAST: starting soon, the meet line and friends planning all come first', () => {
    expect(getHomeInsight({ nearbyFriend: friend, friendsActivity: [{ id: 'a' }, { id: 'b' }] }).kind).toBe('friends_planning');
    expect(getHomeInsight({ nearbyFriend: friend, happeningNow: [{ id: 'g', scheduled_at: new Date().toISOString() }] }).kind).toBe('starting_soon');
    const evening = new Date(2026, 8, 22, 19, 0, 0);
    expect(getHomeInsight({ nearbyFriend: friend, nearbyPeopleCount: 5, motivations: ['Go on dates'] }, evening).kind).toBe('meet_tonight');
  });

  test('no friend (any reason) -> nothing', () => {
    expect(getHomeInsight({ nearbyFriend: null })).toBeNull();
    expect(getHomeInsight({ nearbyFriend: { id: 'x' } })).toBeNull();
  });
});

describe('guards', () => {
  test('only the Settings toggle can turn sharing ON; Home may only turn it off', () => {
    const callers = sources.filter((s) => /setFriendNearbySharing\(/.test(s.text)).map((s) => s.rel).sort();
    expect(callers).toEqual(['screens/HomeScreen.js', 'screens/SettingsScreen.js', 'services/friendNearby.js']);
    for (const m of read('screens/HomeScreen.js').match(/setFriendNearbySharing\([^)]*\)/g)) expect(m).toBe('setFriendNearbySharing(false)');
    const settings = read('screens/SettingsScreen.js');
    expect(settings).toMatch(/onValueChange=\{toggleFriendNearby\}/);
    expect((settings.match(/toggleFriendNearby/g) ?? []).length).toBe(2); // defined once, used only by the Switch
    // never from onboarding, friends, dating, gatherings or a permission grant
    for (const s of sources) {
      if (!['screens/HomeScreen.js', 'screens/SettingsScreen.js', 'services/friendNearby.js', 'services/userLocation.js'].includes(s.rel)) {
        expect([s.rel, /services\/friendNearby'|friendNearby'\)/.test(s.text)]).toEqual([s.rel, false]);
      }
    }
  });

  test('the server calls live only in the one service; no client reads the tables', () => {
    for (const s of sources) {
      if (s.rel === 'services/friendNearby.js') continue;
      expect([s.rel, /get_nearby_friends|report_friend_nearby_fix|set_friend_nearby_sharing|friend_nearby_(fixes|sharing|reads)/.test(s.text)]).toEqual([s.rel, false]);
    }
  });

  test('foreground only: a fix comes from userLocation.js onFix, never from a background task', () => {
    expect(read('services/userLocation.js')).toMatch(/reportFriendNearbyFix\(coords\)/);
    for (const s of sources.filter((x) => /TaskManager|startLocationUpdatesAsync/.test(x.text))) {
      expect([s.rel, /friendNearby/.test(s.text)]).toEqual([s.rel, false]);
    }
    expect(read('services/friendNearby.js')).toMatch(/AppState\.currentState === 'active'/);
    expect(read('services/friendNearby.js')).not.toMatch(/expo-location|AsyncStorage/); // no device-side location store
  });

  test('no push, event or analytics anywhere near it; the invite never mentions nearby', () => {
    const mig = fs.readFileSync(path.join(SRC, '../supabase/migrations/20270296_friend_nearby.sql'), 'utf8').replace(/--.*$/gm, '');
    expect(mig).not.toMatch(/_send_push|_emit_event|behavior_events|net\.http/);
    const migDir = path.join(SRC, '../supabase/migrations');
    for (const f of fs.readdirSync(migDir)) {
      if (f === '20270296_friend_nearby.sql') continue;
      expect([f, /friend_nearby|get_nearby_friends/.test(fs.readFileSync(path.join(migDir, f), 'utf8'))]).toEqual([f, false]);
    }
    expect(read('services/friendNearby.js').replace(/\/\/.*$/gm, '')).not.toMatch(/recordBehaviorEvent|trackEvent|analytics/i);
    expect(read('screens/CreateGatheringScreen.js')).not.toMatch(/nearby_friend|friendNearby/i);
    expect(read('services/invites.js')).not.toMatch(/nearby/i);
  });

  test('every language has the eight strings (machine-authored; native review open)', () => {
    const ns = require('../i18n/ui/friendNearby').default;
    for (const lang of ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      expect(Object.keys(ns[lang]).sort()).toEqual(['invite', 'line', 'locationOff', 'reminder', 'settingHelper', 'settingTitle', 'turnOff', 'turnOffA11y']);
      expect(ns[lang].line).toMatch(/\{name\}/);
      expect(ns[lang].invite).toMatch(/\{name\}/);
    }
  });
});
