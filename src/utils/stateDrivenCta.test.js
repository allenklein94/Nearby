// Owner item 73: the CTA is generated from the object's state (utils/primaryAction.js), never decided by a screen.
import fs from 'fs';
import path from 'path';
import {
  primaryActionFor, gatheringPrimaryAction, gatheringJoinAction, opportunityPrimaryAction, consumerOfferAction, inviteAction,
} from './primaryAction';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = new Date('2026-09-26T12:00:00Z').getTime();
const FUTURE = '2026-09-27T19:00:00Z';
const PAST = '2026-09-25T19:00:00Z';
const g = (over = {}) => ({ id: 'g1', host_id: 'host', scheduled_at: FUTURE, is_public: true, requires_approval: false, capacity: null, attendees: [], ...over });

describe('the owner\'s table', () => {
  test('gathering + public + open capacity -> Join', () => {
    expect(primaryActionFor('gathering', g(), { myUserId: 'me', now: NOW })).toMatchObject({ kind: 'join', label: 'Join' });
  });
  test('gathering + approval required -> Request to Join', () => {
    expect(primaryActionFor('gathering', g({ requires_approval: true }), { myUserId: 'me', now: NOW })).toMatchObject({ kind: 'join', label: 'Request to Join' });
    expect(primaryActionFor('gathering', g({ is_public: false }), { myUserId: 'me', now: NOW }).label).toBe('Request to Join');
  });
  test('gathering + full -> Join Waitlist', () => {
    const full = g({ capacity: 2, attendees: [{ user_id: 'x', status: 'approved' }] });
    expect(primaryActionFor('gathering', full, { myUserId: 'me', now: NOW }).label).toBe('Join Waitlist');
  });
  test('gathering + past -> View (no join), with a Past status', () => {
    const a = primaryActionFor('gathering', g({ scheduled_at: PAST }), { myUserId: 'me', now: NOW });
    expect(a.kind).toBe('view');
    expect(a.status).toBe('Past');
  });
  test('gathering already going / hosting / requested never offers Join', () => {
    expect(primaryActionFor('gathering', g({ attendees: [{ user_id: 'me', status: 'approved' }] }), { myUserId: 'me', now: NOW })).toMatchObject({ kind: 'view_plan', status: 'Going' });
    expect(primaryActionFor('gathering', g(), { myUserId: 'host', now: NOW })).toMatchObject({ kind: 'view_plan', status: 'Hosting' });
    expect(primaryActionFor('gathering', g({ attendees: [{ user_id: 'me', status: 'pending' }] }), { myUserId: 'me', now: NOW }).kind).toBe('requested');
  });
  test('a past request reads Request expired, not Join', () => {
    const a = primaryActionFor('gathering', g({ scheduled_at: PAST, attendees: [{ user_id: 'me', status: 'pending' }] }), { myUserId: 'me', now: NOW });
    expect(a).toMatchObject({ kind: 'view', status: 'Request expired' });
  });
  const opp = (req = {}, over = {}) => ({ status: 'pending', request_id: 'r1', business_requests: { status: 'open', expires_at: null, ...req }, ...over });
  test('business request + open -> Send Offer (Accept & Offer, with Offer Alternative and Decline)', () => {
    const a = primaryActionFor('opportunity', opp());
    expect(a.kind).toBe('send_offer');
    expect(a.alternatives.map((x) => x.kind)).toEqual(['offer_alternative', 'decline']);
  });
  test('business request past its deadline, closed, or already answered -> no Send Offer', () => {
    expect(opportunityPrimaryAction(opp({ expires_at: '2026-09-26T11:00:00Z' }), { now: NOW })).toEqual({ kind: 'status', status: 'No longer open' });
    expect(opportunityPrimaryAction(opp({ status: 'cancelled' })).kind).toBe('status');
    expect(opportunityPrimaryAction(opp({}, { status: 'offered' })).kind).toBe('view');
    expect(opportunityPrimaryAction(opp(), { inFlight: true })).toEqual({ kind: 'status', status: 'Reviewing your offer…' });
  });
  const req = (over = {}) => ({ status: 'open', expires_at: null, ...over });
  test('offer + available -> Accept Offer', () => {
    expect(primaryActionFor('offer', { status: 'offered' }, { request: req(), now: NOW })).toEqual({ kind: 'accept_offer', label: "I'll take this one" });
  });
  test('offer + expired -> View', () => {
    expect(consumerOfferAction({ status: 'offered', valid_until: '2026-09-26T11:00:00Z' }, { request: req(), now: NOW }).kind).toBe('view');
    expect(consumerOfferAction({ status: 'expired' }, { request: req(), now: NOW }).kind).toBe('view');
  });
  test('offer on a request past its own deadline -> View (was a raw status check before item 73)', () => {
    expect(consumerOfferAction({ status: 'offered' }, { request: req({ expires_at: '2026-09-26T11:00:00Z' }), now: NOW }).kind).toBe('view');
  });
  test('offer once another was chosen -> View; group-plan offer -> Confirm With the Group', () => {
    expect(consumerOfferAction({ status: 'offered' }, { request: req(), hasWinner: true, now: NOW }).kind).toBe('view');
    expect(consumerOfferAction({ status: 'offered' }, { request: req(), isGroupPlanRequest: true, now: NOW }).kind).toBe('confirm_with_group');
  });
  test('reservation available -> Reserve (item 72 booking mode)', () => {
    expect(primaryActionFor('business', { booking_mode: 'reservation_recommended', latitude: 1, longitude: 1 }).label).toBe('Reserve');
    expect(primaryActionFor('business', { booking_mode: 'reservation_required' }).label).toBe('Book');
  });
  test('invites: pending -> Accept (+ Decline), past gathering -> Dismiss', () => {
    expect(inviteAction({ status: 'pending' }, NOW)).toMatchObject({ kind: 'accept', label: 'Accept' });
    expect(inviteAction({ status: 'pending', inviteType: 'gathering', scheduledAt: PAST }, NOW)).toMatchObject({ kind: 'dismiss', label: 'Dismiss' });
    expect(inviteAction({ status: 'declined' }, NOW).kind).toBe('view');
  });
  test('unknown kind -> View', () => {
    expect(primaryActionFor('mystery', {})).toEqual({ kind: 'view', label: 'View' });
  });
});

describe('the same object reads the same everywhere', () => {
  test('feed/Discover/Home (gatheringPrimaryAction) and Detail (gatheringJoinAction) word a join identically', () => {
    for (const over of [{}, { requires_approval: true }, { capacity: 2, attendees: [{ user_id: 'x', status: 'approved' }] }]) {
      const gathering = g(over);
      const card = gatheringPrimaryAction(gathering, 'me', NOW);
      const detail = gatheringJoinAction(gathering, { isFull: card.waitlist === true });
      expect(detail.label).toBe(card.label);
    }
  });
  test('Interested viewer: I\'m Going, unless approval is needed', () => {
    expect(gatheringJoinAction(g(), { interested: true }).label).toBe("I'm Going");
    expect(gatheringJoinAction(g({ requires_approval: true }), { interested: true }).label).toBe('Request to Join');
  });
});

describe('screens do not decide CTAs themselves', () => {
  const SCREENS = ['GatheringsScreen', 'DiscoverHubScreen', 'GatheringDetailScreen', 'HomeScreen', 'BusinessRequestDetailScreen', 'BusinessDashboardScreen', 'ActivityScreen'];
  test('no hand-written join / accept / send-offer labels', () => {
    for (const name of SCREENS) {
      const src = read(`src/screens/${name}.js`);
      for (const literal of ["'Join Waitlist'", "'Request to Join'", "'JOIN GATHERING'", "'REQUEST TO JOIN'", "'JOIN WAITLIST'", ">I'll take this one<", '>Accept & Offer<', '>Confirm With the Group', '>Offer Alternative<']) {
        expect({ name, literal, found: src.includes(literal) }).toEqual({ name, literal, found: false });
      }
      expect(src).not.toMatch(/\bjoinLabel\(/);
    }
  });
  test('the consumer accept button no longer reads the raw request status', () => {
    expect(read('src/screens/BusinessRequestDetailScreen.js')).not.toContain("canDo('request', request.status, 'accept_offer')");
  });
  test('each converted screen goes through the shared functions', () => {
    expect(read('src/screens/GatheringsScreen.js')).toContain('gatheringPrimaryAction(item, myUserId)');
    expect(read('src/screens/DiscoverHubScreen.js')).toContain('gatheringPrimaryAction(g, myUserId)');
    expect(read('src/screens/GatheringDetailScreen.js')).toContain('gatheringJoinAction(gathering');
    expect(read('src/screens/BusinessDashboardScreen.js')).toContain('opportunityPrimaryAction(o, {');
    expect(read('src/screens/BusinessRequestDetailScreen.js')).toContain('consumerOfferAction(o, {');
    expect(read('src/screens/ActivityScreen.js')).toContain('inviteAction(item)');
  });
});
