const fs = require('fs');
const path = require('path');
const { normalizeBusinessLocations, showLocationSelector, currentLocation, locationToSelectForPush } = require('./businessLocations');

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
  test('a push switches only to another of the account’s own locations', () => {
    expect(locationToSelectForPush({ partner_id: 'b' }, [A, B])).toBe('b');
    expect(locationToSelectForPush({ partner_id: 'a' }, [A, B])).toBeNull(); // already selected
    expect(locationToSelectForPush({ partner_id: 'z' }, [A, B])).toBeNull(); // not a member: never attempted
    expect(locationToSelectForPush({ request_id: 'r' }, [A, B])).toBeNull(); // older pushes carry none
    expect(locationToSelectForPush(null, [A, B])).toBeNull();
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
