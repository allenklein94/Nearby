const fs = require('fs');
const path = require('path');
const { normalizeBusinessLocations, showLocationSelector, currentLocation, selectionChangedElsewhere, locationPlanForLink, LOCATION_FALLBACK_DESTINATION } = require('./businessLocations');

const A = { partner_id: 'a', name: 'Cafe Delray', address: '1 A St', role: 'owner', is_selected: true };
const B = { partner_id: 'b', name: 'Cafe Boca', address: '2 B St', role: 'owner', is_selected: false };

describe('multi-location Business Mode (20270424)', () => {
  test('one location (every business today) or none = no selector, no extra tap', () => {
    expect(showLocationSelector([])).toBe(false);
    expect(showLocationSelector([A])).toBe(false);
    expect(showLocationSelector(null)).toBe(false);
    expect(showLocationSelector([A, B])).toBe(true);
  });
  test('malformed and duplicate rows are dropped', () => {
    expect(normalizeBusinessLocations([A, null, { name: 'x' }, A, B]).map((r) => r.partner_id)).toEqual(['a', 'b']);
    expect(showLocationSelector([A, A])).toBe(false);
  });
  test('current = the server-selected row only', () => {
    expect(currentLocation([B, A])).toBe(A);
    expect(currentLocation([B])).toBeNull();
  });
  test('a business alert switches only to another of the account’s own locations; a foreign location never opens its request', () => {
    const owner = (partner_id, type = 'business_opportunity_received') => ({ type, request_id: 'r', partner_id });
    expect(locationPlanForLink(owner('b'), [A, B])).toEqual({ action: 'switch', partnerId: 'b' });
    expect(locationPlanForLink(owner('a'), [A, B])).toEqual({ action: 'open' }); // already selected
    expect(locationPlanForLink(owner('z'), [A, B])).toEqual({ action: 'fallback' }); // not a member: never that request here
    expect(locationPlanForLink(owner('z'), [])).toEqual({ action: 'open' }); // single location / 0424 not live: as today
    expect(locationPlanForLink({ type: 'business_opportunity_received', request_id: 'r' }, [A, B])).toEqual({ action: 'open' }); // older pushes
    expect(locationPlanForLink(owner('b', 'business_offer_review_result'), [A, B])).toEqual({ action: 'switch', partnerId: 'b' });
    expect(locationPlanForLink(null, [A, B])).toEqual({ action: 'open' });
  });
  test('a push about a business as a PLACE (not an owner alert) never switches or falls back', () => {
    expect(locationPlanForLink({ type: 'perk_nearby', partner_id: 'z' }, [A, B])).toEqual({ action: 'open' });
    expect(locationPlanForLink({ type: 'message', partner_id: 'b' }, [A, B])).toEqual({ action: 'open' });
  });
  test('the fallback is plain Opportunities with no request focus', () => {
    expect(LOCATION_FALLBACK_DESTINATION).toEqual({ name: 'BusinessDashboard', params: { initialSection: 'requests' } });
  });
  test('a selection changed on another device is noticed; unchanged / unknown / empty reads change nothing', () => {
    const Bsel = { ...B, is_selected: true };
    const Aoff = { ...A, is_selected: false };
    expect(selectionChangedElsewhere('a', [A, B])).toBeUndefined();
    expect(selectionChangedElsewhere('a', [Aoff, Bsel])).toBe('b');
    expect(selectionChangedElsewhere('a', [Aoff])).toBeNull(); // no location selected any more
    expect(selectionChangedElsewhere(undefined, [Aoff, Bsel])).toBeUndefined(); // not seeded yet
    expect(selectionChangedElsewhere('a', [])).toBeUndefined(); // failed read / 0424 not live
  });
  test('Business Mode re-checks the selection on focus and on return to the foreground', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
    const wrapper = src.slice(src.indexOf('export default function BusinessDashboardScreen'), src.indexOf('function BusinessDashboardForLocation'));
    expect(wrapper).toMatch(/useFocusEffect\(/);
    expect(wrapper).toMatch(/AppState\.addEventListener\('change'/);
    expect(wrapper).toMatch(/selectionChangedElsewhere\(/);
  });
  test('push taps and email links share ONE location rule and fall back the same way', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    expect(read('services/notifications.js')).toMatch(/open \? await notificationDestination\([^)]*\) : LOCATION_FALLBACK_DESTINATION/);
    expect(read('screens/BusinessWebHomeScreen.js')).toMatch(/ensureBusinessLocationForPush\(linkPushData\(link\)\)/);
    expect(read('screens/BusinessWebHomeScreen.js')).toMatch(/LOCATION_FALLBACK_DESTINATION/);
  });
  test('only the server switches location: the client never writes managed_partner_id', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    for (const p of ['services/businessLocations.js', 'components/BusinessLocationSelector.js']) {
      expect([p, /managed_partner_id/.test(read(p))]).toEqual([p, false]);
    }
    expect(read('services/businessLocations.js')).toMatch(/rpc\('select_managed_business'/);
  });
  test('switching remounts Business Mode so nothing from one location carries into another', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
    expect(src).toMatch(/<BusinessDashboardForLocation key=\{key\}/);
    expect(src).toMatch(/<BusinessLocationSelector onSwitched=\{onLocationSwitched\}>/);
  });
});
