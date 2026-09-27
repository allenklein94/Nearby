// The Discover session synced to the account (owner, 2026-09-27; migration 20270242). Two devices are simulated over one fake
// account that follows the SQL rules (latest client time wins, a clear is a tombstone, a cleared session id never returns).
// The SQL itself is verified live by scripts/live-verify/discover-session-sync.sql; the screen by source guards (no device run).
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from './supabase';
import { reconcile, toServer, fromServer, pushSession, pushClear, sameSession } from './discoverSessionSync';
import { createDiscoverSessionStore } from './discoverSession';

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const S1 = 'cccccccc-0000-4000-8000-000000000001';
const S2 = 'cccccccc-0000-4000-8000-000000000002';
const T0 = Date.UTC(2026, 8, 27, 18);
const sess = (sessionId, updatedAt, extra = {}) => ({
  v: 2, userId: USER, sessionId, typedText: 'something fun tonight with friends', askedAt: T0, updatedAt,
  classifyResult: { intent: 'gathering', dateWindow: 'tonight', partyType: 'friends', narrowGroup: 'activities_recreation' },
  submissionId: null, rootSnapshotId: null, refined: true, ...extra,
});

// A fake account following the migration's rules.
function fakeAccount() {
  let row = null;
  const json = () => (!row ? null : row.cleared_at
    ? { session_id: row.session_id, cleared_at: row.cleared_at, client_updated_at: row.client_updated_at }
    : { ...row });
  supabase.rpc.mockImplementation(async (name, args) => {
    if (name === 'get_discover_session') return { data: json(), error: null };
    if (name === 'save_discover_session') {
      const s = args.session;
      if (row && (Date.parse(s.client_updated_at) < Date.parse(row.client_updated_at) || (row.session_id === s.session_id && row.cleared_at))) {
        return { data: { accepted: false, session: json() }, error: null };
      }
      const keep = row && row.session_id === s.session_id ? row.asked_at : new Date(T0).toISOString();
      row = { ...s, asked_at: keep, cleared_at: null };
      return { data: { accepted: true, session: json() }, error: null };
    }
    if (name === 'clear_discover_session') {
      if (row && (row.session_id === args.session_id_param || Date.parse(args.client_updated_at_param) >= Date.parse(row.client_updated_at))) {
        row = { session_id: row.session_id, cleared_at: new Date().toISOString(), client_updated_at: args.client_updated_at_param };
      }
      return { data: json(), error: null };
    }
    throw new Error(`unexpected ${name}`);
  });
  return { get row() { return row; } };
}
function deviceStorage() {
  const map = new Map();
  return { map, getItem: async (k) => map.get(k) ?? null, setItem: async (k, v) => { map.set(k, v); }, removeItem: async (k) => { map.delete(k); },
    getAllKeys: async () => [...map.keys()], multiRemove: async (ks) => ks.forEach((k) => map.delete(k)) };
}
// One device = its own cache + the sync module bound to it.
function device(now) {
  const store = createDiscoverSessionStore(deviceStorage(), now);
  let mod;
  jest.isolateModules(() => {
    jest.doMock('./discoverSession', () => ({ ...jest.requireActual('./discoverSession'), discoverSession: store }));
    mod = require('./discoverSessionSync');
  });
  return { store, sync: () => mod.syncDiscoverSession(USER), push: (s) => mod.pushSession(USER, s), clear: (id, at) => mod.pushClear(id, at) };
}

beforeEach(() => supabase.rpc.mockReset());

describe('reconcile (latest valid update wins, no merging)', () => {
  it('nothing on the account: this device keeps its session and sends it', () => {
    expect(reconcile(sess(S1, 1), null)).toEqual({ session: sess(S1, 1), push: true });
    expect(reconcile(null, null)).toEqual({ session: null, push: false });
  });
  it('the newer side wins, in either direction', () => {
    expect(reconcile(sess(S1, 1), sess(S1, 2)).session.updatedAt).toBe(2);
    expect(reconcile(sess(S1, 3), sess(S1, 2))).toMatchObject({ push: true, session: { updatedAt: 3 } });
    expect(reconcile(sess(S1, 1), sess(S2, 2)).session.sessionId).toBe(S2);
    expect(reconcile(null, sess(S2, 2)).session.sessionId).toBe(S2);
  });
  it('a clear ends the session here, except a newer, different ask made on this device', () => {
    const tomb = { cleared: true, sessionId: S1, updatedAt: 5 };
    expect(reconcile(sess(S1, 9), tomb)).toEqual({ session: null, push: false }); // the cleared ask never returns
    expect(reconcile(sess(S2, 4), tomb)).toEqual({ session: null, push: false });
    expect(reconcile(sess(S2, 6), tomb)).toEqual({ session: sess(S2, 6), push: true });
  });
});

describe('two devices, one account', () => {
  it('device A searches and refines; device B restores the same interpretation, category and chips', async () => {
    const account = fakeAccount();
    const A = device(() => T0);
    await A.push(sess(S1, T0));
    await A.push(sess(S1, T0 + 60_000, { classifyResult: { ...sess(S1, 0).classifyResult, budgetMax: 25, priceLevel: '$' } }));
    const B = device(() => T0 + 120_000);
    const onB = await B.sync();
    expect(onB.sessionId).toBe(S1);
    expect(onB.classifyResult).toMatchObject({ narrowGroup: 'activities_recreation', partyType: 'friends', dateWindow: 'tonight', budgetMax: 25 });
    expect(onB.askedAt).toBe(T0); // retention clock travels with it and never restarts
    expect(await B.store.load(USER)).toMatchObject({ sessionId: S1, updatedAt: T0 + 60_000 }); // cached for an instant next open
    expect(account.row).not.toHaveProperty('items'); // no results synced
  });

  it('clearing on one device ends it on the other', async () => {
    fakeAccount();
    const A = device(() => T0);
    const B = device(() => T0);
    await A.push(sess(S1, T0));
    await B.sync();
    await A.clear(S1, T0 + 1000);
    expect(await B.sync()).toBeNull();
    expect(await B.store.load(USER)).toBeNull();
  });

  it('a stale device is not allowed to overwrite a newer session and adopts it instead', async () => {
    fakeAccount();
    const A = device(() => T0);
    const B = device(() => T0);
    await B.push(sess(S2, T0 + 5000));
    const after = await A.push(sess(S1, T0));
    expect(after.sessionId).toBe(S2);
  });

  it('offline change: the cache holds it and the next sync sends it', async () => {
    const account = fakeAccount();
    const A = device(() => T0);
    await A.store.save(USER, sess(S1, T0));
    expect(account.row).toBeNull();
    const shown = await A.sync();
    expect(shown.sessionId).toBe(S1);
    expect(account.row.session_id).toBe(S1);
  });

  it('the account unreachable: sync throws and the cache stands', async () => {
    const A = device(() => T0);
    await A.store.save(USER, sess(S1, T0));
    supabase.rpc.mockResolvedValue({ data: null, error: new Error('network') });
    await expect(A.sync()).rejects.toThrow('network');
    expect(await A.store.load(USER)).toMatchObject({ sessionId: S1 });
  });
});

describe('what is sent, and what is not', () => {
  it('only the ask: words, interpretation, ids, refined flag, change time (never results)', () => {
    expect(Object.keys(toServer({ ...sess(S1, T0), items: [{ id: 'x' }], shown: {}, outcome: 'results' })).sort())
      .toEqual(['classify_result', 'client_updated_at', 'refined', 'root_snapshot_id', 'session_id', 'submission_id', 'typed_text']);
    expect(fromServer({ session_id: S1, cleared_at: 'x', client_updated_at: new Date(T0).toISOString() }, USER)).toEqual({ cleared: true, sessionId: S1, updatedAt: T0 });
    expect(sameSession(sess(S1, 1), { sessionId: S1, updatedAt: 1 })).toBe(true);
  });

  it('server rules: one row per account, caller-only, account deletion cascades, 180-day purge, no business reads it', () => {
    const sql = read('../../supabase/migrations/20270242_discover_session_sync.sql');
    expect(sql).toMatch(/user_id uuid primary key references public\.profiles \(id\) on delete cascade/);
    expect(sql).toMatch(/revoke all on public\.discover_sessions from public, anon, authenticated/);
    expect(sql).toMatch(/raw_ask_retention_days\(\)/);
    expect(sql).toMatch(/update discover_sessions set typed_text = null, classify_result = null, cleared_at = now\(\) where cleared_at is null and raw_text_expires_at <= now\(\)/);
    const fns = path.join(__dirname, '../../supabase/functions');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(fns)) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/discover_session/);
  });

  it('screen wiring: cache first, account on focus, own changes pushed, clear pushed; sign-out never deletes the account copy', () => {
    const D = read('../screens/DiscoverHubScreen.js');
    expect(D).toMatch(/useFocusEffect\(useCallback\(\(\) => \{ syncFromAccount\(\); \}, \[myUserId\]\)\)/);
    expect(D).toMatch(/pushSession\(myUserId, snap\)/);
    expect(D).toMatch(/pushClear\(sid\)/);
    expect(D).toMatch(/if \(localEdit\.current !== editAtStart\) return;/); // an account answer never overrides the person's own change
    const auth = read('../context/AuthContext.js');
    expect(auth).not.toMatch(/clear_discover_session|pushClear/);
    // restore never calls the AI: the account copy goes through the same restoreDiscoverAsk as the cache
    expect(read('./discoverSessionSync.js')).not.toMatch(/classifyCreateRequest|runIntentSearch/);
  });
});
