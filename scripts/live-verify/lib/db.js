// 10/10 roadmap Part 8 (see CLAUDE.md's "10/10 roadmap" plan): technical
// validation. Shared helper for the scripts/live-verify/*.js scripts --
// runs real SQL against the real production database via the Supabase
// Management API's "database/query" endpoint, the exact same technique
// this whole file's own history has used by hand, over and over, to
// verify a schema change live. This turns that into a real, repeatable
// script instead of a one-off manual session each time a schema change
// needs re-checking.
//
// Requires SUPABASE_ACCESS_TOKEN in the environment -- never hardcoded
// here or in any script that uses this file, since it's a real
// project-management credential. SUPABASE_PROJECT_REF defaults to this
// app's own project (enmosvippabmuqslzrox, matching src/services/
// supabase.js's own SUPABASE_URL) but can be overridden for a different
// environment.

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'enmosvippabmuqslzrox';

function requireToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'SUPABASE_ACCESS_TOKEN is not set. These scripts run real SQL against ' +
      'production and need a real Supabase Management API access token -- ' +
      'export it before running, never hardcode it in a committed file.'
    );
  }
  return token;
}

// Runs one or more semicolon-separated statements in a single round trip
// (matching how psql/the SQL editor batches statements) and returns the
// result of the LAST statement, mirroring this file's own established
// verification pattern of chaining a set_config(...) call ahead of the
// real query in one string.
//
// REAL, EMPIRICALLY-CONFIRMED QUIRK, not documented anywhere upstream --
// found while building the concurrency harness's RLS-proving scripts:
// when the true last statement in a batch returns ZERO rows, this
// endpoint does NOT return an empty array. It silently falls back to
// reporting the last statement THAT HAD a non-empty result, which can be
// an earlier, unrelated statement in the same batch (confirmed directly:
// `select 111 as a; select 222 as b where false; select 333 as c where
// false;` returns `[{"a":111}]`, not `[]`). Any script whose real
// assertion is "this final statement should return zero rows" (e.g. "RLS
// correctly filtered this row out") must NOT rely on an empty array from
// the raw last statement -- wrap it in `select count(*) as c from (...)
// x` instead, which always returns exactly one row regardless, and
// assert on the count.
async function runSql(query) {
  const token = requireToken();
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok || (body && body.message && !Array.isArray(body))) {
    const err = new Error(body?.message || `Query failed with status ${res.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

// Runs `query` as if a specific real profile were the authenticated
// caller -- same set_config('request.jwt.claims', ...) technique used
// throughout this codebase's own live-verification history, since the
// Management API itself has no real user session to authenticate as.
async function runSqlAs(userId, query) {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  return runSql(
    `select set_config('request.jwt.claims', '${claims}', true) from (select 1) x; ${query}`
  );
}

// Same idea as runSqlAs, but for genuinely proving RLS itself holds
// (rather than an app-level `auth.uid()` check inside a SECURITY DEFINER
// function body). The Management API's own connection runs as the table
// owner (postgres), which bypasses RLS entirely regardless of what
// request.jwt.claims is set to -- confirmed empirically, and the exact
// "false-negative first pass" gotcha this file's own history already
// documented once (the Aug 16 2026 full RLS resweep). A real RLS check
// needs a genuine `SET ROLE authenticated` in the same session, not just
// the JWT claim -- also confirmed empirically (`current_user` really
// flips from `postgres` to `authenticated`).
async function runSqlAsRls(userId, query) {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  return runSql(
    `select set_config('request.jwt.claims', '${claims}', false) from (select 1) x; set role authenticated; ${query}`
  );
}

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`  ✗ FAIL: ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

function summarize(scriptName) {
  if (failures > 0) {
    console.error(`\n${scriptName}: ${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\n${scriptName}: all checks passed.`);
  }
}

module.exports = { runSql, runSqlAs, runSqlAsRls, assert, summarize, PROJECT_REF };
