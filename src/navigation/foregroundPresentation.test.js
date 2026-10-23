// Idea "338": a push arriving while the app is open stays quiet only when the screen in front already shows that change.
jest.mock('../services/celebrateSomething', () => ({ extractNameFromBirthdayTitle: () => null }));
import fs from 'fs';
import path from 'path';
import {
  foregroundPresentation, noteForegroundPresentation, systemPlayedSound, NORMAL, QUIET, LIVE_ON_SCREEN, REPLY_PILL_REPLACES_BANNER, ARRIVAL_CLAIM_TIMEOUT_MS,
} from './foregroundPresentation';
import { createOfferArrivals, registerArrivalClaimer, claimArrival, ARRIVAL_CLAIM_RECENT_MS } from '../services/offerArrivals';

const route = (name, params) => ({ name, params });
const reply = { type: 'business_offer_received', request_id: 'r1', offer_id: 'o1' };

describe('rule 1: same screen, same object', () => {
  test('host on that gathering: the join push is quiet (still listed, badge kept)', async () => {
    const r = await foregroundPresentation({ type: 'gathering_interest', gathering_id: 'g1' }, { currentRoute: route('GatheringDetail', { gatheringId: 'g1' }) });
    expect(r).toEqual({ behavior: QUIET, reason: 'same_object' });
    expect(QUIET).toEqual({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true });
  });
  test('same screen, DIFFERENT gathering: normal banner', async () => {
    const r = await foregroundPresentation({ type: 'gathering_interest', gathering_id: 'g1' }, { currentRoute: route('GatheringDetail', { gatheringId: 'g2' }) });
    expect(r.behavior).toBe(NORMAL);
  });
  test('in that chat / plan chat: quiet; another chat: banner', async () => {
    expect((await foregroundPresentation({ type: 'message', match_id: 'm1' }, { currentRoute: route('Chat', { matchId: 'm1' }) })).behavior).toBe(QUIET);
    expect((await foregroundPresentation({ type: 'message', match_id: 'm1' }, { currentRoute: route('Chat', { matchId: 'm2' }) })).behavior).toBe(NORMAL);
    expect((await foregroundPresentation({ type: 'plan_message', business_request_id: 'b1' }, { currentRoute: route('PlanChat', { businessRequestId: 'b1' }) })).behavior).toBe(QUIET);
  });
  test('a type whose screen does not update live keeps its banner even on its own object', async () => {
    const r = await foregroundPresentation({ type: 'gathering_updated', gathering_id: 'g1' }, { currentRoute: route('GatheringDetail', { gatheringId: 'g1' }) });
    expect(r).toEqual({ behavior: NORMAL, reason: 'not_live_type' });
  });
  test('no current route, no data, an id missing: normal banner', async () => {
    expect((await foregroundPresentation({ type: 'message', match_id: 'm1' }, { currentRoute: null })).behavior).toBe(NORMAL);
    expect((await foregroundPresentation(null)).behavior).toBe(NORMAL);
    expect((await foregroundPresentation({ type: 'message' }, { currentRoute: route('Chat', {}) })).behavior).toBe(NORMAL);
  });
});

describe('business replies', () => {
  test('on the request screen, confirmed reloaded for it: quiet', async () => {
    const r = await foregroundPresentation(reply, { currentRoute: route('BusinessRequestDetail', { requestId: 'r1' }), claimArrival: async () => 'viewed' });
    expect(r).toEqual({ behavior: QUIET, reason: 'same_object' });
  });
  test('on the request screen but unconfirmed (controller not ready): banner', async () => {
    const r = await foregroundPresentation(reply, { currentRoute: route('BusinessRequestDetail', { requestId: 'r1' }), claimArrival: async () => null });
    expect(r).toEqual({ behavior: NORMAL, reason: 'unconfirmed' });
  });
  test('on another request screen: banner while the pill is unverified', async () => {
    const r = await foregroundPresentation(reply, { currentRoute: route('BusinessRequestDetail', { requestId: 'r2' }), claimArrival: async () => 'pill' });
    expect(r).toEqual({ behavior: NORMAL, reason: 'pill_not_verified' });
  });
  test('owner safeguard: the pill does not replace the banner until verified on a phone', () => {
    expect(REPLY_PILL_REPLACES_BANNER).toBe(false);
  });
  test('another screen, pill verified and showing it: quiet; pill not shown / unavailable: banner', async () => {
    const opts = { currentRoute: route('MainTabs', {}), pillReplacesBanner: true };
    expect((await foregroundPresentation(reply, { ...opts, claimArrival: async () => 'pill' })).behavior).toBe(QUIET);
    expect((await foregroundPresentation(reply, { ...opts, claimArrival: async () => null })).reason).toBe('pill_unavailable');
    expect((await foregroundPresentation(reply, { ...opts, claimArrival: async () => { throw new Error('x'); } })).behavior).toBe(NORMAL);
  });
  test('a slow answer never risks the 3 s discard: banner after the timeout', async () => {
    expect(ARRIVAL_CLAIM_TIMEOUT_MS).toBeLessThan(3000);
    const r = await foregroundPresentation(reply, {
      currentRoute: route('BusinessRequestDetail', { requestId: 'r1' }),
      claimArrival: () => new Promise(() => {}),
      timeoutMs: 5,
    });
    expect(r.behavior).toBe(NORMAL);
  });
});

describe('the arrival controller answers honestly', () => {
  const row = (id, request_id = 'r1') => ({ id, request_id, status: 'offered', viewed_at: null, request_status: 'open', partner_name: 'Coastal Coffee' });
  const make = ({ rows, viewing = null, t = { now: 0 } }) => createOfferArrivals({
    fetchReplies: async () => rows.current,
    isViewingRequest: (id) => id === viewing,
    setTimer: () => 0,
    clearTimer: () => {},
    now: () => t.now,
  });

  test('pill showing that request = pill; another request = null', async () => {
    const rows = { current: [] };
    const c = make({ rows });
    await c.start();
    rows.current = [row('o1')];
    expect(await c.claim('r1')).toBe('pill');
    expect(await c.claim('r9')).toBe(null);
  });
  test('viewing that request = viewed, only while recent', async () => {
    const rows = { current: [] };
    const t = { now: 0 };
    const c = make({ rows, viewing: 'r1', t });
    await c.start();
    rows.current = [row('o1')];
    expect(await c.claim('r1')).toBe('viewed');
    t.now = ARRIVAL_CLAIM_RECENT_MS + 1;
    expect(await c.claim('r1')).toBe(null);
  });
  test('app returning from background: no baseline yet = null (banner), and the baseline itself is never claimed', async () => {
    const rows = { current: [row('o1')] };
    const c = make({ rows });
    expect(await c.claim('r1')).toBe(null); // not started
    c.pause();
    const started = c.start();
    expect(await c.claim('r1')).toBe(null); // baseline in flight
    await started;
    expect(await c.claim('r1')).toBe(null); // o1 is baseline: delivered by the push, never a pill
  });
  test('several replies close together: one pill, each push for it is claimed', async () => {
    const rows = { current: [] };
    const c = make({ rows });
    await c.start();
    rows.current = [row('o1'), row('o2')];
    expect(await c.claim('r1')).toBe('pill');
    expect(await c.claim('r1')).toBe('pill');
    expect(c.getSignal().items).toHaveLength(2);
  });
  test('a dismissed pill no longer claims (banner returns)', async () => {
    const rows = { current: [] };
    const c = make({ rows });
    await c.start();
    rows.current = [row('o1')];
    await c.claim('r1');
    c.dismiss();
    expect(await c.claim('r1')).toBe(null);
  });
  test('pill not available (no controller registered) = null', async () => {
    expect(await claimArrival('r1')).toBe(null);
    const off = registerArrivalClaimer(async () => 'pill');
    expect(await claimArrival('r1')).toBe('pill');
    off();
    expect(await claimArrival('r1')).toBe(null);
  });
});

describe('wiring guard', () => {
  const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  test('the foreground handler asks only this rule; no deprecated always-on alert', () => {
    const n = src('services/notifications.js');
    expect(n).toMatch(/foregroundPresentation\(data, \{ currentRoute, claimArrival \}\)/);
    expect(n).not.toMatch(/shouldShowAlert/);
    expect((n.match(/setNotificationHandler\(/g) || []).length).toBe(1);
  });
  test('every live type names a screen the destination table really opens', () => {
    const table = src('navigation/notificationDestinations.js');
    for (const [type, { screen }] of Object.entries(LIVE_ON_SCREEN)) {
      expect(table).toContain(`case '${type}'`);
      expect(table).toContain(`'${screen}'`);
    }
  });
  test('the OS reply sound is noted only when it really plays; unknown = assume it played', () => {
    expect(src('components/OfferArrivalSignal.js')).toMatch(/if \(systemPlayedSound\(n\?\.request\?\.identifier\)\) noteOsOfferSound\(\)/);
    expect(src('services/notifications.js')).not.toMatch(/soundCue|SOUND_CUES/);
    noteForegroundPresentation('a', QUIET);
    noteForegroundPresentation('b', NORMAL);
    expect([systemPlayedSound('a'), systemPlayedSound('b'), systemPlayedSound('never')]).toEqual([false, true, true]);
  });
});
