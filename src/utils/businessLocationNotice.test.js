import { businessLocationNotice } from './businessLocationNotice';

test('no coordinates and no address asks for an address and says requests cannot reach the business', () => {
  const n = businessLocationNotice({ address: null, latitude: null, longitude: null });
  expect(n.needsAction).toBe(true);
  expect(n.text).toMatch(/requests can’t reach/);
});
test('an address that never geocoded is flagged too', () => {
  expect(businessLocationNotice({ address: '1 Main St', latitude: null, longitude: null }).text).toMatch(/couldn’t place/);
});
test('a located business shows no notice; no partner shows none', () => {
  expect(businessLocationNotice({ address: '1 Main St', latitude: 33, longitude: -117 })).toBeNull();
  expect(businessLocationNotice(null)).toBeNull();
});
