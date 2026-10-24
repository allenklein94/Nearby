-- Migration ledger (owner approved the deployment safeguards, 2026-10-24). Before it, no ledger existed: "applied" lived only in CLAUDE_HISTORY.md prose,
-- and a session cut off between the apply and the record left them disagreeing (20270344).
-- One append-only row per production migration, written by scripts/migrations/deploy.js IN THE SAME TRANSACTION as the
-- migration itself: a migration is live with its row or not at all. No client grant; never read by the app.
--   record_kind 'deployed'   = applied by deploy.js (applied_at = that transaction's time).
--               'historical' = applied before the ledger, recorded afterwards from verified evidence (never re-applied).
--               'baseline'   = the one row standing for every migration up to and including 20270343 (pre-ledger).
-- This file itself is deployed by deploy.js, which records its own 'deployed' row after the table exists.

create schema if not exists private;

create table private.migration_ledger (
  version text primary key check (version ~ '^[0-9]{8}$' or version = 'pre-ledger'),
  record_kind text not null check (record_kind in ('deployed', 'historical', 'baseline')),
  file_sha256 text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  git_commit text check (git_commit ~ '^[0-9a-f]{40}$'),
  applied_at timestamptz,
  approval_ref text not null check (length(trim(approval_ref)) > 0),
  session_id text not null check (length(trim(session_id)) > 0),
  recorded_at timestamptz not null default now(),
  notes text,
  check ((record_kind = 'baseline') = (version = 'pre-ledger')),
  check (record_kind = 'baseline' or (file_sha256 is not null and git_commit is not null and applied_at is not null))
);
revoke all on table private.migration_ledger from public, anon, authenticated;

-- Append-only: a record is never edited or removed (a mistake is corrected by the owner, by hand, with a note).
create or replace function private.migration_ledger_append_only()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'private.migration_ledger is append-only (% refused)', tg_op;
end;
$function$;
revoke all on function private.migration_ledger_append_only() from public, anon, authenticated;

create trigger migration_ledger_append_only before update or delete on private.migration_ledger
  for each row execute function private.migration_ledger_append_only();
create trigger migration_ledger_no_truncate before truncate on private.migration_ledger
  for each statement execute function private.migration_ledger_append_only();

insert into private.migration_ledger (version, record_kind, approval_ref, session_id, notes) values (
  'pre-ledger', 'baseline',
  'none: applied before the ledger existed',
  'backfill-2026-10-24',
  'Every migration up to and including 20270343 was applied before this ledger existed. Their applied status is recorded '
  'only in CLAUDE.md / CLAUDE_HISTORY.md, not verified per file here.'
);

insert into private.migration_ledger (version, record_kind, file_sha256, git_commit, applied_at, approval_ref, session_id, notes)
values (
  '20270344', 'historical',
  '5bb1fa44355219d41b2311f67a8f52283c6df6ec093e5184491b1dabdc9d148f',
  'bf0cbb3e28ee0fc61e2f87a6e8a64885eb80f16c',
  '2026-10-24 12:56:09.501+00',
  'owner approval 2026-10-24 12:55:41 UTC ("Approved. Apply migration 20270344 to production.")',
  'dc024208-1c72-4c4e-b111-a3aa4e1de286',
  'HISTORICAL RECORD, not applied by deploy.js. Evidence: that session''s local transcript (apply request sent 12:56:09.501 UTC, '
  'returned OK 12:56:13.606 UTC; exact server commit time not available); the session was cut off before recording it. '
  'Re-verified 2026-10-24 by session 618db8ac-2c5f-49af-abc4-2d38f66bff1c: live = the migration''s result (11 functions + '
  'grants, 2 triggers), prod journeys 684/684. See CLAUDE_HISTORY.md.'
);
