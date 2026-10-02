// Item 140 follow-up: "Request expires soon" -> Review Request opens the exact request, and the dashboard says what is
// true NOW (the push may be stale), never an outdated action. Delivery rules are proven live by the journey
// (src/journeys/requestExpiryWarning.journey.js); this covers the client side and pins the server rules in the migration.
const fs = require('fs');
const path = require('path');

jest.mock('../services/businessFulfillment', () => ({ getBusinessAvailabilityById: async () => null }));

const { focusedOpportunityView, focusFirst, STATE_KEYS } = require('./focusedOpportunity');
const { notificationDestination } = require('../navigation/notificationDestinations');
const { notificationNavAction } = require('../navigation/notificationNav');
const { NOTIFICATION_ACTION_BY_TYPE } = require('../constants/notificationActions');
const { BUSINESS_NOTIFICATION_GROUP_BY_TYPE } = require('../constants/businessNotificationGroups');
const bizDash2 = require('../i18n/ui/bizDash2').default;

const NOW = new Date('2026-10-02T17:00:00Z');
const inHours = (h) => new Date(NOW.getTime() + h * 3600e3).toISOString();
const opp = (over = {}, req = {}) => ({
  id: 'o1', request_id: 'r1', status: 'pending',
  business_requests: { status: 'open', expires_at: inHours(1.8), ...req },
  ...over,
});

describe('the push opens the exact request', () => {
  test('type, action and mute group', () => {
    expect(NOTIFICATION_ACTION_BY_TYPE.business_request_expiring).toBe('review_request');
    expect(BUSINESS_NOTIFICATION_GROUP_BY_TYPE.business_request_expiring).toBe('requests'); // the owner's "New requests" (owner_requests) mute applies
  });
  test('destination = the business dashboard focused on that request, never a generic screen', async () => {
    expect(await notificationDestination({ type: 'business_request_expiring', request_id: 'r1', offer_id: 'o1', partner_id: 'b' }))
      .toEqual({ name: 'BusinessDashboard', params: { initialSection: 'requests', focusRequestId: 'r1' } });
  });
  test('it opens on top of where the owner was (a different request = its own screen; the same one refreshes in place)', () => {
    const here = { name: 'BusinessDashboard', params: { initialSection: 'profile' } };
    expect(notificationNavAction(here, 'BusinessDashboard', { initialSection: 'requests', focusRequestId: 'r1' })).toBe('push');
    const onIt = { name: 'BusinessDashboard', params: { initialSection: 'requests', focusRequestId: 'r1' } };
    expect(notificationNavAction(onIt, 'BusinessDashboard', { initialSection: 'requests', focusRequestId: 'r1' })).toBe('setParams');
  });
});

describe('what the dashboard says about it, from its current state', () => {
  test('still open with time left: respondable, with the real deadline', () => {
    expect(focusedOpportunityView([opp()], 'r1', { now: NOW })).toEqual({ kind: 'respondable', expiresAt: inHours(1.8) });
  });
  test('tapped after the request changed state: the current state, no action', () => {
    const v = (o) => focusedOpportunityView([o], 'r1', { now: NOW });
    expect(v(opp({}, { expires_at: inHours(-0.1) }))).toEqual({ kind: 'state', key: 'expired' }); // deadline passed, sweep not run yet
    expect(v(opp({}, { status: 'expired' }))).toEqual({ kind: 'state', key: 'expired' });
    expect(v(opp({ status: 'expired' }))).toEqual({ kind: 'state', key: 'expired' });
    expect(v(opp({}, { status: 'fulfilled' }))).toEqual({ kind: 'state', key: 'customerChoseAnother' }); // another business was accepted
    expect(v(opp({}, { status: 'cancelled' }))).toEqual({ kind: 'state', key: 'customerCancelled' }); // customer withdrew it
    expect(v(opp({ status: 'cancelled' }, { status: 'cancelled' }))).toEqual({ kind: 'state', key: 'customerCancelled' }); // the real row shape
    expect(v(opp({ status: 'cancelled' }, { status: 'fulfilled' }))).toEqual({ kind: 'state', key: 'customerChoseAnother' });
    expect(v(opp({}, { status: 'merged' }))).toEqual({ kind: 'state', key: 'closed' });
    expect(v(opp({ status: 'offered' }))).toEqual({ kind: 'state', key: 'youReplied' });
    expect(v(opp({ status: 'accepted' }))).toEqual({ kind: 'state', key: 'booked' });
    expect(v(opp({ status: 'declined' }))).toEqual({ kind: 'state', key: 'youDeclined' });
    expect(v(opp({ status: 'withdrawn' }))).toEqual({ kind: 'state', key: 'closed' });
    expect(focusedOpportunityView([opp()], 'r1', { now: NOW, inFlight: true })).toEqual({ kind: 'state', key: 'reviewing' });
  });
  test('not authorized: the server refuses the list (not this business) -> unavailable, never someone else\'s request', () => {
    expect(focusedOpportunityView([], 'r1', { now: NOW, loadFailed: true })).toEqual({ kind: 'unavailable' });
    expect(focusedOpportunityView([opp({ request_id: 'other' })], 'r1', { now: NOW })).toEqual({ kind: 'unavailable' });
    expect(focusedOpportunityView(null, 'r1', { now: NOW })).toEqual({ kind: 'unavailable' });
  });
  test('the focused card leads; nothing is removed or reordered otherwise', () => {
    const list = [opp({ id: 'a', request_id: 'x' }), opp({ id: 'b', request_id: 'r1' }), opp({ id: 'c', request_id: 'y' })];
    expect(focusFirst(list, 'r1').map((o) => o.id)).toEqual(['b', 'a', 'c']);
    expect(focusFirst(list, null)).toBe(list);
    expect(focusFirst(list, 'missing')).toBe(list);
  });
  test('every state has wording in all 11 languages', () => {
    for (const lang of Object.keys(bizDash2)) {
      for (const k of [...STATE_KEYS, 'title', 'respondBy', 'respondOpen', 'unavailable']) expect(typeof bizDash2[lang].focus[k]).toBe('string');
      expect(bizDash2[lang].focus.respondBy).toContain('{when}');
    }
  });
  test('the dashboard renders from the helper and re-reads on open', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'BusinessDashboardScreen.js'), 'utf8');
    expect(src).toMatch(/focusedOpportunityView\(opportunities, focusRequestId/);
    expect(src).toMatch(/focusFirst\(scoredOpportunities, focusRequestId\)/);
    expect(src).toMatch(/if \(selectedPartner\) loadOpportunities\(selectedPartner\.id\);\n {2}\}, \[focusRequestId\]\);/);
  });
});

describe('server delivery rules (migration 20270257)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270257_business_request_expiry_warning.sql'), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  test('eligibility', () => {
    expect(code).toMatch(/o\.status = 'pending'/);
    expect(code).toMatch(/r\.status = 'open'/);
    expect(code).toMatch(/r\.expires_at > now\(\)/);
    expect(code).toMatch(/r\.expires_at <= now\(\) \+ interval '2 hours'/);
    expect(code).toMatch(/r\.expires_at - greatest\(r\.created_at, o\.created_at\) > interval '2 hours'/); // arrived with < 2 h left: no warning
    expect(code).toMatch(/w\.status in \('accepted', 'completed'\)/);
    expect(code).toMatch(/p\.managed_partner_id = o\.partner_id/); // only that business's owner
    expect(code).toMatch(/coalesce\(p\.notify_business, true\)/);
  });
  test('one per request per business, idempotent, ids-only payload, not client-callable', () => {
    expect(code).toMatch(/primary key \(request_id, partner_id\)/);
    expect(code).toMatch(/on conflict do nothing;\s*continue when not found;/);
    expect(code).toMatch(/'request_expiring:' \|\| v_row\.offer_id/);
    expect(code).toMatch(/jsonb_build_object\('type', 'business_request_expiring', 'request_id', v_row\.request_id, 'offer_id', v_row\.offer_id, 'partner_id', v_row\.partner_id\)/);
    expect(code).not.toMatch(/raw_text|requester_id|display_name/);
    expect(code).toMatch(/revoke all on function public\.send_business_request_expiry_warnings\(\) from public, anon, authenticated/);
    expect(code).toMatch(/cron\.schedule\('send-business-request-expiry-warnings', '\*\/15 \* \* \* \*'/);
  });
  test('the gathering reminder is untouched (no 30-minute reminder added)', () => {
    expect(code).not.toMatch(/gathering_reminder|send_gathering_reminders/);
  });
});
