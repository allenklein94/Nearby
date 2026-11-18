// Customer-message alerts on a multi-location account (20270428 x 20270424): the alert names the location the message is
// about (partner_id). A tap (push) or the email link must open that conversation UNDER THAT LOCATION:
//   already selected            -> open the inbox on that message (no switch)
//   another of my locations     -> switch first (server-checked select_managed_business), then open
//   not one of mine / refused   -> plain fallback, never that message under the location currently selected
// Permanent form of the ad hoc 3/3 check (open / switch / fallback) run on the multi-location tree, 2026-11-17.
// Driven through the real pieces: locationPlanForLink, ensureBusinessLocationForPush, notificationDestination,
// the web link builder/parser and messageFocusPlan; only the network (supabase.rpc) is stubbed.
const mockRpc = jest.fn();
jest.mock('../services/supabase', () => ({ supabase: { rpc: (...a) => mockRpc(...a) } }));

const { locationPlanForLink, LOCATION_FALLBACK_DESTINATION } = require('./businessLocations');
const { ensureBusinessLocationForPush } = require('../services/businessLocations');
const { notificationDestination } = require('../navigation/notificationDestinations');
const { messageFocusPlan } = require('./businessMessageFocus');
const { parseBusinessWebLink, businessWebDestination, linkPushData, businessWebLinkUrl } = require('./businessWebLink');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const X = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // a business this account doesn't manage
const MID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const alert = (partner) => ({ type: 'business_message_received', message_id: MID, partner_id: partner }); // 20270428's payload
const mine = (selected) => [
  { partner_id: A, name: 'A', role: 'owner', is_selected: selected === A },
  { partner_id: B, name: 'B', role: 'staff', is_selected: selected === B },
];
const INBOX_ON_MESSAGE = { name: 'BusinessDashboard', params: { initialSection: 'inbox_modal', focusMessageId: MID } };

function serverWith(locations) {
  let selected = locations.find((r) => r.is_selected)?.partner_id ?? null;
  const calls = [];
  mockRpc.mockImplementation(async (fn, args) => {
    calls.push([fn, args]);
    if (fn === 'get_my_businesses') return { data: locations.map((r) => ({ ...r, is_selected: r.partner_id === selected })), error: null };
    if (fn === 'select_managed_business') {
      if (!locations.some((r) => r.partner_id === args.partner_id_param)) return { data: null, error: { message: 'Not a member' } };
      selected = args.partner_id_param;
      return { data: null, error: null };
    }
    return { data: null, error: { message: `unexpected ${fn}` } };
  });
  return { calls, selected: () => selected };
}
// What the message read returns under the (possibly switched) selection, then where the inbox lands.
const land = (selectedId) => messageFocusPlan(
  { id: MID, partner_id: B, conversation_with_id: CUSTOMER }, selectedId,
  [{ userId: CUSTOMER, name: 'Customer' }], { conversationsLoaded: true },
).kind;

beforeEach(() => mockRpc.mockReset());

describe('business_message_received follows its location (multi-location)', () => {
  test('the alert is an owner alert, so the location rule applies to it', () => {
    expect(locationPlanForLink(alert(B), mine(B))).toEqual({ action: 'open' });
    expect(locationPlanForLink(alert(B), mine(A))).toEqual({ action: 'switch', partnerId: B });
    expect(locationPlanForLink(alert(X), mine(A))).toEqual({ action: 'fallback' });
  });

  test('open: already acting for that location -> no switch, inbox on that conversation', async () => {
    const s = serverWith(mine(B));
    await expect(ensureBusinessLocationForPush(alert(B))).resolves.toEqual({ switchedTo: null, open: true });
    expect(s.calls.map((c) => c[0])).toEqual(['get_my_businesses']);
    await expect(notificationDestination(alert(B))).resolves.toEqual(INBOX_ON_MESSAGE);
    expect(land(s.selected())).toBe('open');
  });

  test('switch: acting for A, message is about B -> switches to B first, then opens that conversation', async () => {
    const s = serverWith(mine(A));
    expect(land(s.selected())).toBe('list'); // without the switch the message would never open under A
    await expect(ensureBusinessLocationForPush(alert(B))).resolves.toEqual({ switchedTo: B, open: true });
    expect(s.calls).toContainEqual(['select_managed_business', { partner_id_param: B }]);
    expect(s.selected()).toBe(B);
    await expect(notificationDestination(alert(B))).resolves.toEqual(INBOX_ON_MESSAGE);
    expect(land(s.selected())).toBe('open');
  });

  test('fallback: a location the account can\'t act for -> plain fallback, selection unchanged, message never opened', async () => {
    const s = serverWith(mine(A));
    await expect(ensureBusinessLocationForPush(alert(X))).resolves.toEqual({ switchedTo: null, open: false });
    expect(s.calls.map((c) => c[0])).not.toContain('select_managed_business');
    expect(s.selected()).toBe(A);
    expect(LOCATION_FALLBACK_DESTINATION.params).not.toHaveProperty('focusMessageId');
  });

  test('a refused / failed switch also falls back (never opens the message under the current location)', async () => {
    serverWith(mine(A));
    mockRpc.mockImplementation(async (fn) => (fn === 'get_my_businesses'
      ? { data: mine(A), error: null } : { data: null, error: { message: 'business_selection_changed' } }));
    await expect(ensureBusinessLocationForPush(alert(B))).resolves.toEqual({ switchedTo: null, open: false });
  });

  test('the alert email link carries the location and follows the same rule as the push', async () => {
    // send-push's email link: r = the message id, b = the location (mirrored by businessWebLinkUrl, guard keeps them equal).
    const url = businessWebLinkUrl('https://example.invalid/Nearby/business/', 'business_message_received', MID, B);
    const link = parseBusinessWebLink(new URL(url).search);
    expect(linkPushData(link)).toMatchObject({ type: 'business_message_received', partner_id: B });
    const s = serverWith(mine(A));
    await expect(ensureBusinessLocationForPush(linkPushData(link))).resolves.toEqual({ switchedTo: B, open: true });
    expect(s.selected()).toBe(B);
    await expect(businessWebDestination(link)).resolves.toEqual(INBOX_ON_MESSAGE);
  });
});
