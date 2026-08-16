// Phase 1 item 2 of the "Scorecard to 10" plan (see CLAUDE.md): a real
// concurrency harness -- two genuinely parallel DB sessions -- for
// re-proving races this file's history had previously only proven via
// *sequential* replay (this sandbox has never been able to force two
// truly overlapping DB transactions before this).
//
// The technique: the Supabase Management API's database/query endpoint
// (see ./db.js) opens a real, separate Postgres backend connection per
// HTTP request and holds it open for the full duration of that request's
// query string. Confirmed empirically before trusting this, not assumed:
// two concurrent `select pg_sleep(2), pg_backend_pid()` calls returned
// two distinct backend pids and completed in ~2.4s total, not ~4.8s
// serialized; a follow-up pg_advisory_lock test confirmed a second
// connection's own lock acquisition genuinely blocks at the Postgres
// level (not just "runs slower") while a first connection holds the same
// lock and sleeps -- true concurrency, not two sequential calls dressed
// up as concurrent.
//
// So: fire a "holder" query (no `await` before firing the "racer") that
// explicitly locks a real row (`SELECT ... FOR UPDATE`) and then
// pg_sleep()s while still holding that lock, all inside one HTTP
// call/session. After a fixed delay long enough for the holder to have
// already acquired its lock and entered the sleep, fire a "racer" query
// that tries to touch the same locked row (often via the real RPC under
// test, which does its own internal FOR UPDATE). The racer is then
// genuinely blocked at the Postgres level until the holder commits --
// proving whatever invariant the racer's post-block behavior
// demonstrates was actually forced to wait for the holder's real commit,
// not racing against a stale pre-commit read.
//
// Usage matches lib/db.js's own runSql/runSqlAs shape -- these are
// deliberately not a new abstraction layered on top, just two concurrent
// calls into the exact same primitive every other live-verify script
// already uses.

const { runSql } = require('./db');

// Fires `holderQuery` and, after `racerDelayMs` (default 900ms -- long
// enough in practice for a holder's own BEGIN/lock/sleep to have already
// started on its own connection, confirmed via the pg_advisory_lock test
// above), fires `racerQuery` -- without ever awaiting the holder first.
// Never throws itself; each side's real success/failure is captured so a
// caller can assert on whichever shape the race is supposed to produce
// (e.g. "the racer is rejected", "the racer's blocked result reflects
// the holder's already-committed change").
async function runOverlapping({ holderQuery, racerQuery, racerDelayMs = 900 }) {
  const t0 = Date.now();

  const holderPromise = runSql(holderQuery)
    .then((data) => ({ ok: true, data, elapsedMs: Date.now() - t0 }))
    .catch((error) => ({ ok: false, error, elapsedMs: Date.now() - t0 }));

  await new Promise((resolve) => setTimeout(resolve, racerDelayMs));

  const racerPromise = runSql(racerQuery)
    .then((data) => ({ ok: true, data, elapsedMs: Date.now() - t0 }))
    .catch((error) => ({ ok: false, error, elapsedMs: Date.now() - t0 }));

  const [holder, racer] = await Promise.all([holderPromise, racerPromise]);
  return { holder, racer };
}

// Prefixes `sql` with a real per-connection auth context, matching
// lib/db.js's own runSqlAs technique -- but as `false` (session-scoped,
// not transaction-local), since a holder query's own explicit BEGIN...
// COMMIT would otherwise reset a transaction-local set_config the moment
// its BEGIN runs.
function asUser(userId, sql) {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  return `select set_config('request.jwt.claims', '${claims}', false) from (select 1) x; ${sql}`;
}

module.exports = { runOverlapping, asUser };
