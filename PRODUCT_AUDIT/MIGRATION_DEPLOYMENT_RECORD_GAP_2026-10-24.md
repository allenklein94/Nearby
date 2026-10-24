# Migration deployment record gap (2026-10-24): findings + proposed safeguards

Status: COMPLETE (2026-10-24). S1-S4 built and tested (Jest 14, disposable-db-test 29/29); production ledger deployed through
deploy.js at 18:42:39 UTC (20270345, sha b6962ed4…, commit 8d0278c6) and verified; 20270344 recorded as historical. Record: CLAUDE_HISTORY.md top.

## What happened (evidence, not inference)

- A new session's pre-apply check for 20270344 found it already live (3 new functions + 2 triggers present; the 7 replaced
  functions = the migration's result, compared by applying it inside a rolled-back transaction).
- The earlier session's local transcript (`~/.claude/projects/-workspaces-Nearby/dc024208-1c72-4c4e-b111-a3aa4e1de286.jsonl`) shows:
  - 12:53:18 UTC commit bf0cbb3e ("NOT applied"); 12:55:41 the owner's approval arrives;
  - 12:55:56 its pre-apply check passes (baseline bodies, nothing from 20270344, 20270343 present); 12:56:05 row snapshot;
  - 12:56:09 the file is sent to production as one Management API query (`node $S/q.js <migration file>`), returns OK;
  - 12:56:42 the 7 live bodies verified byte-equal to the file; 12:56:46 it starts the journeys and the transcript ends (tool call,
    no result): the session was cut off. No "applied" record was written or committed.
- The approval was then pasted into a new session, which found the database already changed.

So the change was made under explicit approval; what failed is the record. Nothing in the repo or on the server ties "this
migration is live" to a durable fact.

## Why it is possible

1. **No ledger on production.** `supabase_migrations.schema_migrations` does not exist (migrations are never applied with the
   Supabase CLI). "Applied" lives only in CLAUDE.md / CLAUDE_HISTORY.md prose, written after the fact, in a separate step.
2. **Apply and record are two steps.** The DDL commits at once; the record is a later doc edit + git commit. Any interruption
   between them (restart-prone codespace, session cut-off, context loss) leaves production changed and the record saying otherwise.
3. **Ad-hoc apply path.** Each session writes its own scratch `q.js` and sends the file; nothing checks for an existing apply or
   writes a record. The same token runs both rolled-back tests and real applies, so they look alike.
4. **Server-side history is not reachable from here.** `log_statement = ddl` is on, but the Management API logs endpoint returns
   `Table "postgres_logs" does not exist` (the old `logs.all` is removed); `track_commit_timestamp` and `track_functions` are off.
   The owner can still see the DDL in the Dashboard's Logs Explorer (search `_gathering_request_follows_time`, 2026-10-24 ~12:56 UTC).

## Proposed safeguards (lightweight; for approval)

**S1 Ledger table (one migration, `private.migration_ledger`, no client grant):** `version` (PK, e.g. `20270344`), `file_sha256`,
`git_commit`, `applied_at` (default now()), `approval` (the owner's approval text/date, required), `applied_by` (session id), `notes`.
Written in the SAME transaction as the migration, so a migration can never be live without its row, and a cut-off session leaves
either both or neither.
Backfill: one baseline row `pre-ledger` stating that everything up to 20270344 was applied per CLAUDE_HISTORY.md (no invented
per-file timestamps), plus a real row for 20270344 with `applied_at` = 2026-10-24 12:56:09 UTC from the transcript, marked
`backfilled`.

**S2 One deploy script, the only production apply path (`scripts/deploy-migration.sh <file>`):** refuses unless
- the file is committed, the tree is clean, and its sha256 matches HEAD;
- no ledger row exists for its version (already applied = stop and report, never re-apply);
- `NEARBY_PROD_APPROVAL` is set to the version plus the owner's approval date (an explicit, per-migration gate: approval in one
  context never carries to the next);
- it is not pointed at the replay DB by mistake (or vice versa).
Then it sends `begin; <file>; insert into private.migration_ledger …; commit;` as one request and prints the ledger row.
Optional pre-step: the script runs the migration inside a rolled-back transaction first and diffs function fingerprints, as done today.

**S3 Read-only status (`scripts/migration-status.sh`):** lists repo migrations against ledger rows (applied / not applied / sha
mismatch). Every session runs it before claiming a migration's state, instead of trusting the prose.

**S4 Convention (one bullet in CLAUDE.md "Engineering discipline"):** production DDL only through S2; `JOURNEY_PRELUDE_FILE` and
rolled-back checks stay as they are; the history entry cites the ledger row.

Not proposed: a DDL event trigger blocking any change without the ledger setting. It would be real enforcement, but it also affects
every Supabase-managed DDL and the journey preludes, and costs more than this gap warrants. The token-holder can still bypass S2:
S1-S4 make the honest path atomic and visible; they don't stop a deliberate bypass.

## Until decided

Before any production apply: fingerprint-check that the migration is not already live (as the 20270344 check did) and write the
"applied" record in the same turn as the apply.
