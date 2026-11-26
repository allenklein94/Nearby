// Multi-location stale-screen guard, client side (20270426). The server is the protection; this checks the client says
// which location it shows on REST calls only, never on the switch/list calls it needs to recover, and reacts to the
// server's refusal without hiding the error from the caller.
import {
  claimActingBusiness, releaseActingBusiness, actingBusiness, actingBusinessHeaderFor, withActingBusiness,
  onSelectionChanged, ACTING_BUSINESS_HEADER, SELECTION_CHANGED_HINT,
} from './actingBusiness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const REST = 'https://x.supabase.co/rest/v1';
const res = (status, body) => ({ status, clone: () => ({ json: async () => body }) });

afterEach(() => releaseActingBusiness(claimActingBusiness(null)));

test('header only on REST calls while a location is claimed', () => {
  expect(actingBusinessHeaderFor(`${REST}/rpc/set_business_operating_hours`)).toBeNull();
  claimActingBusiness(A);
  expect(actingBusinessHeaderFor(`${REST}/rpc/set_business_operating_hours`)).toBe(A);
  expect(actingBusinessHeaderFor(`${REST}/brand_offers?select=*`)).toBe(A);
  expect(actingBusinessHeaderFor('https://x.supabase.co/functions/v1/screen-business-content')).toBeNull();
  expect(actingBusinessHeaderFor('https://x.supabase.co/storage/v1/object/logos/a.png')).toBeNull();
  expect(actingBusinessHeaderFor('https://x.supabase.co/auth/v1/token')).toBeNull();
});

test('never on switching or listing locations (how a stale screen recovers)', () => {
  claimActingBusiness(A);
  expect(actingBusinessHeaderFor(`${REST}/rpc/select_managed_business`)).toBeNull();
  expect(actingBusinessHeaderFor(`${REST}/rpc/get_my_businesses?x=1`)).toBeNull();
  expect(actingBusinessHeaderFor(`${REST}/rpc/note_location_aware_session`)).toBeNull();
});

test('a late release from an older claim never clears a newer one', () => {
  const old = claimActingBusiness(A);
  const now = claimActingBusiness(B);
  releaseActingBusiness(old);
  expect(actingBusiness()).toBe(B);
  releaseActingBusiness(now);
  expect(actingBusiness()).toBeNull();
});

test('wrapper adds the header and keeps the caller\'s own headers', async () => {
  claimActingBusiness(A);
  const base = jest.fn(async () => res(200, {}));
  await withActingBusiness(base)(`${REST}/rpc/x`, { method: 'POST', headers: { Authorization: 'Bearer t', apikey: 'k' } });
  const h = base.mock.calls[0][1].headers;
  expect(h.get(ACTING_BUSINESS_HEADER)).toBe(A);
  expect(h.get('Authorization')).toBe('Bearer t');
  expect(h.get('apikey')).toBe('k');
});

test('no claim = request passes through untouched', async () => {
  const base = jest.fn(async () => res(200, {}));
  const init = { headers: { a: 'b' } };
  await withActingBusiness(base)(`${REST}/rpc/x`, init);
  expect(base.mock.calls[0][1]).toBe(init);
});

test('server refusal clears the claim, tells listeners, and still returns the error response', async () => {
  claimActingBusiness(A);
  const seen = jest.fn();
  const off = onSelectionChanged(seen);
  const refusal = res(400, { code: 'P0001', hint: SELECTION_CHANGED_HINT });
  const out = await withActingBusiness(async () => refusal)(`${REST}/rpc/set_business_location`, {});
  expect(out).toBe(refusal);
  expect(seen).toHaveBeenCalledTimes(1);
  expect(actingBusiness()).toBeNull();
  off();
});

test('other 400s (input problems) change nothing', async () => {
  claimActingBusiness(A);
  const seen = jest.fn();
  const off = onSelectionChanged(seen);
  await withActingBusiness(async () => res(400, { code: 'P0001', hint: 'something_else' }))(`${REST}/rpc/x`, {});
  await withActingBusiness(async () => ({ status: 400, clone: () => ({ json: async () => { throw new Error('html'); } }) }))(`${REST}/rpc/x`, {});
  expect(seen).not.toHaveBeenCalled();
  expect(actingBusiness()).toBe(A);
  off();
});

test('a refusal for an older claim never clears a newer location', async () => {
  claimActingBusiness(A);
  let finish;
  const pending = withActingBusiness(() => new Promise((f) => { finish = f; }))(`${REST}/rpc/x`, {});
  claimActingBusiness(B);
  finish(res(400, { hint: SELECTION_CHANGED_HINT }));
  await pending;
  expect(actingBusiness()).toBe(B);
});
