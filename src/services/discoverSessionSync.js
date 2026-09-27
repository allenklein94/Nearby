// The Discover typed-ask session, synced to the account (owner, 2026-09-27; migration 20270242). The account's ONE active
// session is the source of truth; the device store (services/discoverSession.js) is its cache. Scoped to exactly this session:
// not a general synced app-state mechanism.
//
// Latest valid update wins, by updatedAt (when the person changed it on their device); no merging. Clearing leaves a
// tombstone on the account so every device ends the session. No results are synced (a restore re-runs the canonical search,
// no AI call). The server enforces the 180-day raw-text limit and keeps it private to the account (caller-only RPCs).
import { supabase } from './supabase';
import { discoverSession } from './discoverSession';

const iso = (ms) => new Date(ms).toISOString();

export function toServer(s) {
  return {
    session_id: s.sessionId, typed_text: s.typedText, classify_result: s.classifyResult, submission_id: s.submissionId ?? null,
    root_snapshot_id: s.rootSnapshotId ?? null, refined: s.refined === true, client_updated_at: iso(s.updatedAt),
  };
}

// The account's session as { live session } | { cleared: true, sessionId, updatedAt } | null (never synced).
export function fromServer(row, userId) {
  if (!row || typeof row !== 'object' || !row.session_id) return null;
  const updatedAt = Date.parse(row.client_updated_at);
  if (row.cleared_at) return { cleared: true, sessionId: row.session_id, updatedAt };
  return {
    v: 2, userId, sessionId: row.session_id, typedText: row.typed_text, classifyResult: row.classify_result,
    submissionId: row.submission_id ?? null, rootSnapshotId: row.root_snapshot_id ?? null, refined: row.refined === true,
    askedAt: Date.parse(row.asked_at), updatedAt,
  };
}

// Pure: which session this device should show, and whether the account needs this device's copy.
//   { session: live session | null, push: boolean }
export function reconcile(local, account) {
  if (!account) return { session: local ?? null, push: !!local };
  if (account.cleared) {
    // a newer, different ask made here (e.g. offline) survives an older clear; the cleared ask itself never comes back
    if (local && local.sessionId !== account.sessionId && local.updatedAt > account.updatedAt) return { session: local, push: true };
    return { session: null, push: false };
  }
  if (!local) return { session: account, push: false };
  if (local.updatedAt > account.updatedAt) return { session: local, push: true };
  return { session: account, push: false };
}

export const sameSession = (a, b) => (a?.sessionId ?? null) === (b?.sessionId ?? null) && (a?.updatedAt ?? null) === (b?.updatedAt ?? null);

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

// Sends this device's session; returns the account's session afterwards (the newer one if this device was behind).
export async function pushSession(userId, session) {
  const res = await rpc('save_discover_session', { session: toServer(session) });
  return fromServer(res?.session, userId);
}

export async function pushClear(sessionId, at = Date.now()) {
  await rpc('clear_discover_session', { session_id_param: sessionId, client_updated_at_param: iso(at) });
}

// Reads the account, reconciles with the device cache, pushes when this device is newer, and writes the cache to match.
// Returns the session this device should show (null = none). Throws when the account cannot be reached (the cache stands).
export async function syncDiscoverSession(userId) {
  const local = await discoverSession.load(userId);
  const account = fromServer(await rpc('get_discover_session'), userId);
  let { session, push } = reconcile(local, account);
  if (push) {
    const after = await pushSession(userId, session);
    session = after && !after.cleared ? after : (after?.cleared ? null : session);
  }
  if (session) await discoverSession.save(userId, session);
  else await discoverSession.clear(userId);
  return session;
}
