-- Account deletion keeps evidence under an active legal hold, images included (owner, 2026-11-08: mandatory pre-launch fix, staged).
-- Staged after 20270401; deploy only with its own approval; delete-account is redeployed right after it (the function needs this
-- migration: it refuses to delete without it, so never deploy the function first).
-- PRODUCT_AUDIT/ACCOUNT_DELETION_AUDIT_RETENTION_2026-11-08.md
--
-- The rules:
--   Scope.      A hold keeps what that hold is about, not the account's whole history: the held item, the cases and reports linked to
--               it, decisions and pauses that name them, and what a case's own signal rests on. The whole moderation history only when
--               the admin who places the hold says so, in writing on the hold (scope 'account_history'), and only for the account
--               the held item is about. A hold on an ID submission keeps that submission.
--   Images.     The original file stays where it is, in its private bucket, listed in private.legal_hold_files with its size, type and
--               hash. While a file is listed and its hold isn't purgeable, nothing can delete, move or overwrite it (trigger on
--               storage.objects, every role, quietly: nothing tells the person). An admin reads one only by first calling
--               admin_open_held_file with a reason: every opening is on record and the Storage policy needs that record.
--   Deletion.   A hold never stops a deletion and nothing reveals a hold. Files are queued in the transaction that deletes the profile and
--               removed only after the account is gone, each re-checked under the hold lock at that moment. So a hold placed at any point
--               of the deletion is either seen, or (the file's DELETE already handed over) answered 'deleting', never 'held'.
--               A failed copy aborts the deletion and is recorded; admins get one private push a day (counts only).
--   Retention.  Nothing is purged while a hold on the same target is active. After a release, evidence is purged only under a recorded
--               policy: private.held_evidence_retention_policy starts EMPTY, and empty means nothing is purged. Setting it needs a decision
--               and a reference (private.set_held_evidence_retention); it is a question for counsel, not a default.
-- Also fixed because the wording promises it: an account's voice messages were sent to the wrong bucket (they live in chat-media, the
-- function asked profile-photos), so they, chat photos, voice intros and replaced photos survived deletion. The whole folder of each of
-- the account's three media buckets is now queued, and a failed removal is retried instead of forgotten.
-- Not changed: no hold on the account = no evidence written; no screen; no foreign key or constraint on existing tables; 20270374's copy.
-- Requires 20270351, 20270357, 20270363, 20270368, 20270369, 20270374, 20270375, 20270393, 20270395, 20270399, 20270400.

-- ===== the stores =====
alter table private.legal_holds add column if not exists scope text not null default 'item';
alter table private.legal_holds drop constraint if exists legal_holds_scope_check;
alter table private.legal_holds add constraint legal_holds_scope_check check (scope in ('item', 'account_history'));

create table if not exists private.held_account_evidence (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references private.legal_holds(id),   -- a hold is never deleted (20270395)
  account_id uuid not null,                                   -- the deleted account's former id; no foreign key, it must outlive it
  record_type text not null check (record_type in ('coverage', 'review_case', 'case_member', 'case_event', 'case_photo',
    'case_report_link', 'photo_fingerprint', 'photo_hash', 'suspension_decision', 'pause', 'pause_event', 'behavior_signal',
    'security_event', 'id_submission')),
  source_id text not null,
  payload jsonb not null,
  preserved_at timestamptz not null default now(),
  unique (hold_id, record_type, source_id)
);
create index if not exists held_account_evidence_account_idx on private.held_account_evidence (account_id);
revoke all on table private.held_account_evidence from public, anon, authenticated;

-- The original files a hold keeps. object_id = storage.objects.id: the file itself stays in its private bucket.
create table if not exists private.legal_hold_files (
  hold_id uuid not null references private.legal_holds(id),
  object_id uuid not null,
  bucket_id text not null,
  object_name text not null,
  account_id uuid,                     -- whose file; no foreign key, it must outlive the account
  size_bytes bigint,
  mimetype text,
  etag text,
  sha256 text,
  registered_at timestamptz not null default now(),
  primary key (hold_id, object_id)
);
create index if not exists legal_hold_files_object_idx on private.legal_hold_files (object_id);
revoke all on table private.legal_hold_files from public, anon, authenticated;

-- Every time an admin opens a held file. Append-only, no purge: its period is a question for counsel.
create table if not exists private.legal_hold_file_access (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references private.legal_holds(id),
  object_id uuid not null,
  admin_id uuid not null,              -- no foreign key: the record outlives the admin's account
  purpose text not null check (length(btrim(purpose)) between 10 and 500),
  opened_at timestamptz not null default now()
);
create index if not exists legal_hold_file_access_recent_idx on private.legal_hold_file_access (admin_id, object_id, opened_at desc);
revoke all on table private.legal_hold_file_access from public, anon, authenticated;

-- What happens after a release. EMPTY = nothing is purged. The latest row governs; a null retention = keep until decided.
create table if not exists private.held_evidence_retention_policy (
  id bigint generated always as identity primary key,
  retention interval check (retention is null or retention >= interval '0'),
  reference text not null check (length(btrim(reference)) between 3 and 300),
  decided_by text not null check (length(btrim(decided_by)) between 3 and 200),
  decided_at timestamptz not null default now()
);
revoke all on table private.held_evidence_retention_policy from public, anon, authenticated;
revoke all on sequence private.held_evidence_retention_policy_id_seq from public, anon, authenticated;

-- A deleted account's media files, waiting for the account to be gone, then for Storage to confirm. A row leaves only then.
create table if not exists private.account_file_cleanup (
  bucket_id text not null,
  object_name text not null,
  object_id uuid not null,
  account_id uuid not null,
  reason text not null check (reason in ('account_deleted', 'hold_ended')),
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  primary key (bucket_id, object_name)
);
create index if not exists account_file_cleanup_account_idx on private.account_file_cleanup (account_id);
revoke all on table private.account_file_cleanup from public, anon, authenticated;

-- A deletion under way: the reports that named the account, because deleting the profile clears their reference. Lets a hold placed
-- at any point of the deletion still find the account. Removed once the account and its files are gone.
create table if not exists private.account_deletion_markers (
  account_id uuid primary key,
  report_ids uuid[] not null default '{}',
  started_at timestamptz not null default now()
);
revoke all on table private.account_deletion_markers from public, anon, authenticated;

create table if not exists private.account_deletion_failures (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  step text not null check (step in ('preserve', 'profile', 'auth')),
  failed_at timestamptz not null default now()
);
create index if not exists account_deletion_failures_at_idx on private.account_deletion_failures (failed_at);
revoke all on table private.account_deletion_failures from public, anon, authenticated;
revoke all on sequence private.account_deletion_failures_id_seq from public, anon, authenticated;

-- ===== retention =====
create or replace function private.held_evidence_retention()
returns interval
language sql
stable
set search_path to 'private', 'public'
as $function$
  select p.retention from private.held_evidence_retention_policy p order by p.id desc limit 1;
$function$;
revoke all on function private.held_evidence_retention() from public, anon, authenticated;

-- The one way to set it, by an operator in SQL, after a decision. A null retention returns to keeping everything.
create or replace function private.set_held_evidence_retention(p_retention interval, p_reference text, p_decided_by text)
returns void
language sql
security definer
set search_path to 'private', 'public'
as $function$
  select private.legal_hold_lock();
  insert into private.held_evidence_retention_policy (retention, reference, decided_by) values (p_retention, p_reference, p_decided_by);
$function$;
revoke all on function private.set_held_evidence_retention(interval, text, text) from public, anon, authenticated;

-- Only a released hold, with nothing else holding its target, under a recorded period that has passed. Anything unknown = no.
create or replace function private.held_evidence_hold_purgeable(p_hold uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select coalesce(h.released_at is not null
     and not case h.target_type
           when 'report' then private.report_on_legal_hold(h.target_id)
           when 'content_removal' then private.removal_on_legal_hold(h.target_id)
           when 'review_case' then private.case_on_legal_hold(h.target_id)
           when 'id_submission' then private.id_submission_on_legal_hold(h.target_id)
           else true
         end
     and (select max(x.released_at) from private.legal_holds x
           where x.target_type = h.target_type and x.target_id = h.target_id) < now() - private.held_evidence_retention(), false)
    from private.legal_holds h where h.id = p_hold;
$function$;
revoke all on function private.held_evidence_hold_purgeable(uuid) from public, anon, authenticated;

-- Append-only: never changed; removed only once its hold is purgeable.
create or replace function private._held_evidence_guard()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
begin
  if tg_op = 'UPDATE' or not coalesce(private.held_evidence_hold_purgeable(old.hold_id), false) then
    raise exception 'Held account evidence is append-only' using errcode = '42501', hint = 'held_evidence_append_only';
  end if;
  return old;
end;
$function$;
revoke all on function private._held_evidence_guard() from public, anon, authenticated;
drop trigger if exists held_evidence_guard on private.held_account_evidence;
create trigger held_evidence_guard before update or delete on private.held_account_evidence
  for each row execute function private._held_evidence_guard();
drop trigger if exists legal_hold_files_guard on private.legal_hold_files;
create trigger legal_hold_files_guard before update or delete on private.legal_hold_files
  for each row execute function private._held_evidence_guard();

create or replace function private._append_only_guard()
returns trigger
language plpgsql
set search_path to 'private', 'public'
as $function$
begin
  raise exception 'This record is append-only' using errcode = '42501', hint = 'held_evidence_append_only';
end;
$function$;
revoke all on function private._append_only_guard() from public, anon, authenticated;
drop trigger if exists legal_hold_file_access_guard on private.legal_hold_file_access;
create trigger legal_hold_file_access_guard before update or delete on private.legal_hold_file_access
  for each row execute function private._append_only_guard();
drop trigger if exists held_evidence_policy_guard on private.held_evidence_retention_policy;
create trigger held_evidence_policy_guard before update or delete on private.held_evidence_retention_policy
  for each row execute function private._append_only_guard();

-- 20270395's record + the scope: it can't change after placing.
create or replace function private.legal_hold_immutable()
returns trigger
language plpgsql
set search_path to 'private', 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'A legal hold is never deleted; release it instead' using hint = 'legal_hold_immutable';
  end if;
  if old.released_at is not null
     or (new.id, new.target_type, new.target_id, new.reason, new.reference, new.placed_by, new.placed_at, new.scope)
        is distinct from (old.id, old.target_type, old.target_id, old.reason, old.reference, old.placed_by, old.placed_at, old.scope) then
    raise exception 'A legal hold can only be released, once' using hint = 'legal_hold_immutable';
  end if;
  return new;
end;
$function$;

-- 20270395's rule + a hold on a review case linked to the report, also after that case went with its account.
create or replace function private.report_on_legal_hold(p_report uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select exists (select 1 from private.legal_holds h
                  where h.released_at is null
                    and ((h.target_type = 'report' and h.target_id = p_report)
                      or (h.target_type = 'content_removal'
                          and h.target_id in (select c.id from private.content_removals c where c.report_id = p_report))
                      or (h.target_type = 'review_case'
                          and h.target_id in (select l.case_id from private.account_review_case_reports l where l.report_id = p_report))))
      or exists (select 1 from private.held_account_evidence e join private.legal_holds h on h.id = e.hold_id
                  where h.released_at is null and e.record_type = 'case_report_link' and e.payload->>'report_id' = p_report::text);
$function$;
revoke all on function private.report_on_legal_hold(uuid) from public, anon, authenticated;

-- 20270374's purge + the hold. The shared lock: a hold being placed and this purge go one after the other.
create or replace function private.purge_suspended_account_records()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.legal_hold_lock();
  delete from private.suspended_account_records r
   where r.expires_at <= now()
     and not exists (select 1 from jsonb_array_elements(r.decisions) d
                      where d->>'report_id' is not null and private.report_on_legal_hold((d->>'report_id')::uuid))
     and not exists (select 1 from private.held_account_evidence e join private.legal_holds h on h.id = e.hold_id
                      where e.account_id = r.former_account_id and h.released_at is null);
  -- unchanged from 20270374
  delete from private.phone_match_queue where queued_at < now() - interval '1 day';
  delete from private.suspended_number_failures where at < now() - interval '90 days';
end;
$function$;
revoke all on function private.purge_suspended_account_records() from public, anon, authenticated;


-- ===== what a hold is about =====
-- The reports a hold keeps: the held report, a removal's report, a case's linked reports.
create or replace function private.hold_report_ids(p_type text, p_target uuid)
returns uuid[]
language sql
stable
set search_path to 'private', 'public'
as $function$
  select case p_type
    when 'report' then array[p_target]
    when 'content_removal' then array(select c.report_id from private.content_removals c where c.id = p_target and c.report_id is not null)
    when 'review_case' then array(select l.report_id from private.account_review_case_reports l where l.case_id = p_target)
    else '{}'::uuid[] end;
$function$;
revoke all on function private.hold_report_ids(text, uuid) from public, anon, authenticated;

-- The cases a hold keeps: the held case, and any case linked to its reports.
create or replace function private.hold_case_ids(p_type text, p_target uuid)
returns uuid[]
language sql
stable
set search_path to 'private', 'public'
as $function$
  select array(
    select p_target where p_type = 'review_case'
    union
    select l.case_id from private.account_review_case_reports l
     where p_type in ('report', 'content_removal') and l.report_id = any(private.hold_report_ids(p_type, p_target)));
$function$;
revoke all on function private.hold_case_ids(text, uuid) from public, anon, authenticated;

-- Is this report about this account, also once the profile delete has cleared the reference?
create or replace function private.report_names_account(p_report uuid, p_user uuid)
returns boolean
language sql
stable
set search_path to 'private', 'public'
as $function$
  select exists (select 1 from public.reports r where r.id = p_report and r.reported_id = p_user)
      or exists (select 1 from private.account_deletion_markers m where m.account_id = p_user and p_report = any(m.report_ids));
$function$;
revoke all on function private.report_names_account(uuid, uuid) from public, anon, authenticated;

-- Is this the account the held item is about? (Only then can an 'account_history' hold reach its history.)
create or replace function private.hold_is_about_account(p_type text, p_target uuid, p_user uuid)
returns boolean
language sql
stable
set search_path to 'private', 'public'
as $function$
  select case p_type
    when 'report' then private.report_names_account(p_target, p_user)
    when 'content_removal' then exists (select 1 from private.content_removals c where c.id = p_target
                                         and (c.owner_id = p_user or private.report_names_account(c.report_id, p_user)))
    when 'review_case' then exists (select 1 from private.account_review_cases c where c.id = p_target and c.subject_user = p_user)
    when 'id_submission' then exists (select 1 from public.id_verification_submissions s where s.id = p_target and s.user_id = p_user)
    else false end;
$function$;
revoke all on function private.hold_is_about_account(text, uuid, uuid) from public, anon, authenticated;

-- ===== the original files =====
-- Kept while listed under a hold not yet purgeable, or attached to a held case (a photo added to the case later counts at once).
create or replace function private.object_under_hold(p_object uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select exists (select 1 from private.legal_hold_files f where f.object_id = p_object and not private.held_evidence_hold_purgeable(f.hold_id))
      or exists (select 1 from private.account_review_case_photos p
                  where p.object_id = p_object and private.case_on_legal_hold(p.case_id));
$function$;
revoke all on function private.object_under_hold(uuid) from public, anon, authenticated;

-- Lists one file under a hold, with its identity at this moment.
create or replace function private._list_hold_file(p_hold uuid, p_object uuid, p_account uuid)
returns void
language sql
security definer
set search_path to 'private', 'public'
as $function$
  insert into private.legal_hold_files (hold_id, object_id, bucket_id, object_name, account_id, size_bytes, mimetype, etag, sha256)
  select p_hold, o.id, o.bucket_id, o.name, p_account, nullif(o.metadata->>'size', '')::bigint, o.metadata->>'mimetype', o.metadata->>'eTag',
         (select f.sha256 from private.photo_fingerprints f where f.object_id = o.id)
    from storage.objects o where o.id = p_object
  on conflict (hold_id, object_id) do nothing;
$function$;
revoke all on function private._list_hold_file(uuid, uuid, uuid) from public, anon, authenticated;

-- Which original files this hold is about: photos attached to its cases; for a report about a profile, the photos in use at this
-- moment; for a report about a chat message, that message's file. Nothing else. Answers what happened to each, truthfully.
create or replace function private.register_hold_files(p_hold uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h private.legal_holds%rowtype;
  v_reports uuid[];
  v_cases uuid[];
  r record;
  v_missing integer := 0;
begin
  select * into h from private.legal_holds where id = p_hold;
  v_reports := private.hold_report_ids(h.target_type, h.target_id);
  v_cases := private.hold_case_ids(h.target_type, h.target_id);

  for r in select p.object_id, p.user_id from private.account_review_case_photos p where p.case_id = any(v_cases) loop
    if exists (select 1 from storage.objects o where o.id = r.object_id) then
      perform private._list_hold_file(p_hold, r.object_id, r.user_id);
    else
      v_missing := v_missing + 1;
    end if;
  end loop;

  for r in select rp.id, rp.reported_id, rp.content_type, rp.content_id,
                  (select m.account_id from private.account_deletion_markers m where rp.id = any(m.report_ids) limit 1) as gone
             from reports rp where rp.id = any(v_reports) loop
    if r.content_type is null and r.reported_id is not null then
      perform private._list_hold_file(p_hold, o.id, r.reported_id)
         from storage.objects o where o.bucket_id = 'profile-photos' and private.photo_object_in_use(r.reported_id, o.id);
    elsif r.content_type is null and r.gone is not null then
      -- the profile is already gone, the file waiting: this hold still reaches it
      perform private._list_hold_file(p_hold, q.object_id, r.gone)
         from private.account_file_cleanup q where q.account_id = r.gone and q.bucket_id = 'profile-photos';
    elsif r.content_type = 'message' then
      perform private._list_hold_file(p_hold, o.id, m.sender_id)
         from messages m join storage.objects o on o.bucket_id = 'chat-media' and o.name in (m.media_url, m.audio_url)
        where m.id = r.content_id;
    end if;
  end loop;

  return jsonb_build_object(
    'kept', (select count(*) from private.legal_hold_files f where f.hold_id = p_hold
              and not exists (select 1 from private.account_file_cleanup q where q.object_id = f.object_id and q.claimed_at is not null)),
    'deleting', (select count(*) from private.legal_hold_files f join private.account_file_cleanup q on q.object_id = f.object_id
                  where f.hold_id = p_hold and q.claimed_at is not null),
    'already_deleted', v_missing);
end;
$function$;
revoke all on function private.register_hold_files(uuid) from public, anon, authenticated;

-- Nothing deletes, moves or overwrites a held file: every role, quietly (a skipped row, so nothing tells the person). A plain metadata
-- update goes through. The shared lock: a hold being placed and this go one after the other.
create or replace function private._storage_object_hold_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and (new.bucket_id, new.name, new.version) is not distinct from (old.bucket_id, old.name, old.version) then
    return new;
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('nearby:legal_hold', 0));
  if private.object_under_hold(old.id) then
    return null;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;
revoke all on function private._storage_object_hold_guard() from public, anon, authenticated;
drop trigger if exists legal_hold_object_guard on storage.objects;
create trigger legal_hold_object_guard before update or delete on storage.objects
  for each row when (old.bucket_id in ('profile-photos', 'chat-media', 'profile-audio'))
  execute function private._storage_object_hold_guard();

-- ===== the copy =====
create or replace function private.preserve_held_account_evidence(p_user uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h record;
  v_reports uuid[];
  v_cases uuid[];
  v_history boolean;
  v_before bigint;
  v_after bigint;
begin
  if p_user is null then return 0; end if;
  -- the same key as private.legal_hold_lock(), shared: placing or releasing a hold excludes this, other deletions don't
  perform pg_advisory_xact_lock_shared(hashtextextended('nearby:legal_hold', 0));
  select count(*) into v_before from private.held_account_evidence where account_id = p_user;

  for h in
    select l.id, l.target_type, l.target_id, l.scope from private.legal_holds l
     where l.released_at is null
       and (
         exists (select 1 from private.held_account_evidence e where e.hold_id = l.id and e.account_id = p_user)
         or (l.target_type = 'report' and (
               private.report_names_account(l.target_id, p_user)
               or exists (select 1 from account_moderation_actions a where a.report_id = l.target_id and a.user_id = p_user)
               or exists (select 1 from private.account_restrictions x where x.report_id = l.target_id and x.user_id = p_user)))
         or (l.target_type = 'content_removal' and exists (
               select 1 from private.content_removals c
                where c.id = l.target_id and (c.owner_id = p_user or private.report_names_account(c.report_id, p_user))))
         or (l.target_type = 'review_case' and (
               exists (select 1 from private.account_review_cases c where c.id = l.target_id and c.subject_user = p_user)
               or exists (select 1 from private.account_review_case_members m where m.case_id = l.target_id and m.user_id = p_user)
               or exists (select 1 from private.account_restrictions x where x.review_case_id = l.target_id and x.user_id = p_user)))
         or (l.target_type = 'id_submission' and exists (
               select 1 from id_verification_submissions s where s.id = l.target_id and s.user_id = p_user))
       )
     order by l.placed_at, l.id
  loop
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    values (h.id, p_user, 'coverage', p_user::text, jsonb_build_object('target_type', h.target_type, 'target_id', h.target_id, 'scope', h.scope))
    on conflict (hold_id, record_type, source_id) do nothing;

    v_reports := private.hold_report_ids(h.target_type, h.target_id);
    v_cases := private.hold_case_ids(h.target_type, h.target_id);
    v_reports := v_reports || array(select l.report_id from private.account_review_case_reports l where l.case_id = any(v_cases));
    v_history := h.scope = 'account_history' and private.hold_is_about_account(h.target_type, h.target_id, p_user);

    -- a case about this account goes with it: the whole case
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'review_case', c.id::text, to_jsonb(c)
      from private.account_review_cases c where c.id = any(v_cases) and c.subject_user = p_user
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'case_member', m.case_id || ':' || m.user_id, to_jsonb(m)
      from private.account_review_case_members m join private.account_review_cases c on c.id = m.case_id
     where c.id = any(v_cases) and (c.subject_user = p_user or m.user_id = p_user)
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'case_event', e.id::text, to_jsonb(e)
      from private.account_review_case_events e join private.account_review_cases c on c.id = e.case_id
     where c.id = any(v_cases) and (c.subject_user = p_user or e.subject = p_user)
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'case_photo', p.case_id || ':' || p.object_id, to_jsonb(p)
      from private.account_review_case_photos p join private.account_review_cases c on c.id = p.case_id
     where c.id = any(v_cases) and (c.subject_user = p_user or p.user_id = p_user)
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'case_report_link', l.case_id || ':' || l.report_id, to_jsonb(l)
      from private.account_review_case_reports l join private.account_review_cases c on c.id = l.case_id
     where c.id = any(v_cases) and c.subject_user = p_user
    on conflict (hold_id, record_type, source_id) do nothing;

    -- the hashes behind a held photo case
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'photo_fingerprint', f.object_id::text, to_jsonb(f)
      from private.photo_fingerprints f
     where f.user_id = p_user
       and f.object_id in (select p.object_id from private.account_review_case_photos p where p.case_id = any(v_cases) and p.user_id = p_user)
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'photo_hash', f.object_id || ':' || f.variant, to_jsonb(f)
      from private.photo_perceptual_hashes f
     where f.user_id = p_user
       and f.object_id in (select p.object_id from private.account_review_case_photos p where p.case_id = any(v_cases) and p.user_id = p_user)
    on conflict (hold_id, record_type, source_id) do nothing;

    -- moderation records: what names this hold's reports or cases, what a case's own signal rests on; the rest only if the hold says so
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'suspension_decision', a.id::text, to_jsonb(a) from account_moderation_actions a
     where a.user_id = p_user and (v_history or a.report_id = any(v_reports)
           or exists (select 1 from private.account_review_cases c where c.id = any(v_cases) and c.subject_user = p_user and c.signal = 'prior_suspension'))
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'pause', x.id::text, to_jsonb(x) from private.account_restrictions x
     where x.user_id = p_user and (v_history or x.report_id = any(v_reports) or x.review_case_id = any(v_cases))
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'pause_event', e.id::text, to_jsonb(e)
      from private.account_restriction_events e join private.account_restrictions x on x.id = e.restriction_id
     where e.user_id = p_user and (v_history or x.report_id = any(v_reports) or x.review_case_id = any(v_cases))
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'behavior_signal', b.id::text, to_jsonb(b) from private.behavior_signals b
     where b.user_id = p_user and (v_history
           or exists (select 1 from private.account_review_cases c where c.id = any(v_cases) and c.subject_user = p_user and c.signal = 'behavior'))
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'security_event', e.id::text, to_jsonb(e) from private.account_security_events e
     where e.user_id = p_user and (v_history
           or exists (select 1 from private.account_review_cases c where c.id = any(v_cases) and c.subject_user = p_user and c.signal = 'account_recovery'))
    on conflict (hold_id, record_type, source_id) do nothing;

    if h.target_type = 'id_submission' then
      insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
      select h.id, p_user, 'id_submission', s.id::text, to_jsonb(s)
        from id_verification_submissions s where s.id = h.target_id and s.user_id = p_user
      on conflict (hold_id, record_type, source_id) do nothing;
    end if;

    -- the original files, while this account's rows still say which (the cascade removes the case photos)
    perform private.register_hold_files(h.id);
  end loop;

  select count(*) into v_after from private.held_account_evidence where account_id = p_user;
  return (v_after - v_before)::integer;
end;
$function$;
revoke all on function private.preserve_held_account_evidence(uuid) from public, anon, authenticated;

-- The profile delete: note which reports named the account (the delete clears them), queue its media files, copy. All in the deletion's
-- transaction, on every path. No exception handler, on purpose: a failure aborts the deletion.
create or replace function private._preserve_held_evidence_before_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_table_schema = 'public' then
    insert into private.account_deletion_markers (account_id, report_ids)
    values (old.id, array(select r.id from reports r where r.reported_id = old.id))
    on conflict (account_id) do update set report_ids = private.account_deletion_markers.report_ids || excluded.report_ids;
    insert into private.account_file_cleanup (bucket_id, object_name, object_id, account_id, reason)
    select o.bucket_id, o.name, o.id, old.id, 'account_deleted'
      from storage.objects o
     where o.bucket_id in ('profile-photos', 'chat-media', 'profile-audio') and (storage.foldername(o.name))[1] = old.id::text
    on conflict (bucket_id, object_name) do nothing;
  end if;
  perform private.preserve_held_account_evidence(old.id);
  return old;
end;
$function$;
revoke all on function private._preserve_held_evidence_before_delete() from public, anon, authenticated;

drop trigger if exists a_preserve_held_evidence on public.profiles;
create trigger a_preserve_held_evidence before delete on public.profiles
  for each row execute function private._preserve_held_evidence_before_delete();
drop trigger if exists a_preserve_held_evidence on auth.users;
create trigger a_preserve_held_evidence before delete on auth.users
  for each row execute function private._preserve_held_evidence_before_delete();

-- delete-account calls this FIRST and stops if it fails.
create or replace function public.account_deletion_preserve_held_evidence(user_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.preserve_held_account_evidence(user_id_param);
end;
$function$;
revoke all on function public.account_deletion_preserve_held_evidence(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_preserve_held_evidence(uuid) to service_role;

-- ===== removing the files =====
-- Due: the account is gone, nothing holds the file, and no other run has it (a claim older than 15 minutes is taken as lost).
create or replace function private.account_file_due(p_row private.account_file_cleanup)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select not exists (select 1 from auth.users u where u.id = p_row.account_id)
     and (p_row.claimed_at is null or p_row.claimed_at < now() - interval '15 minutes')
     and not private.object_under_hold(p_row.object_id);
$function$;
revoke all on function private.account_file_due(private.account_file_cleanup) from public, anon, authenticated;

-- delete-account takes files to remove here, one account's or (the hourly run) any. Under the shared hold lock, so a hold being placed goes
-- first (this then skips the file) or after (it then answers 'deleting').
create or replace function public.account_file_cleanup_claim(user_id_param uuid default null)
returns table (bucket_id text, object_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('nearby:legal_hold', 0));
  return query
    update private.account_file_cleanup q set claimed_at = now()
     where (q.bucket_id, q.object_name) in (
       select c.bucket_id, c.object_name from private.account_file_cleanup c
        where (user_id_param is null or c.account_id = user_id_param) and private.account_file_due(c)
        order by c.queued_at limit 500 for update skip locked)
    returning q.bucket_id, q.object_name;
end;
$function$;
revoke all on function public.account_file_cleanup_claim(uuid) from public, anon, authenticated;
grant execute on function public.account_file_cleanup_claim(uuid) to service_role;

-- A file leaves the queue only when storage.objects agrees it is gone; otherwise it stays, and a later run tries again.
create or replace function public.account_file_cleanup_confirm(files_param jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gone integer;
begin
  with listed as (
    select x->>'bucket_id' as bucket_id, x->>'object_name' as object_name from jsonb_array_elements(coalesce(files_param, '[]'::jsonb)) x
  ), gone as (
    delete from private.account_file_cleanup q using listed l
     where q.bucket_id = l.bucket_id and q.object_name = l.object_name and q.claimed_at is not null
       and not exists (select 1 from storage.objects o where o.bucket_id = q.bucket_id and o.name = q.object_name)
    returning 1
  )
  select count(*) into v_gone from gone;
  update private.account_file_cleanup q set claimed_at = null, attempts = q.attempts + 1
    from (select x->>'bucket_id' as bucket_id, x->>'object_name' as object_name from jsonb_array_elements(coalesce(files_param, '[]'::jsonb)) x) l
   where q.bucket_id = l.bucket_id and q.object_name = l.object_name and q.claimed_at is not null;
  delete from private.account_deletion_markers m
   where not exists (select 1 from auth.users u where u.id = m.account_id)
     and not exists (select 1 from private.account_file_cleanup q where q.account_id = m.account_id);
  return v_gone;
end;
$function$;
revoke all on function public.account_file_cleanup_confirm(jsonb) from public, anon, authenticated;
grant execute on function public.account_file_cleanup_confirm(jsonb) to service_role;

-- ===== failures reach an admin =====
-- One private push per admin per day, counts only. Open = deletions that failed in the last 7 days whose account is still there.
create or replace function private._account_deletion_alert()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_failed integer;
  v_files integer;
  r record;
begin
  select count(distinct f.account_id) into v_failed from private.account_deletion_failures f
   where f.failed_at > now() - interval '7 days' and exists (select 1 from auth.users u where u.id = f.account_id);
  select count(*) into v_files from private.account_file_cleanup q
   where (q.attempts >= 3 or q.queued_at < now() - interval '24 hours') and private.account_file_due(q);
  if v_failed = 0 and v_files = 0 then return; end if;
  for r in select p.id from profiles p where p.is_admin is true and p.suspended_at is null loop
    perform _send_push(r.id, 'Account deletion needs attention',
      v_failed || ' account deletion(s) couldn''t finish; ' || v_files || ' file(s) couldn''t be removed yet.',
      jsonb_build_object('type', 'admin_report_received', 'kind', 'account_deletion'),
      'account_deletion:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD') || ':' || r.id);
  end loop;
end;
$function$;
revoke all on function private._account_deletion_alert() from public, anon, authenticated;

-- delete-account records its own failure here. Nothing about a hold is in it.
create or replace function public.account_deletion_record_failure(user_id_param uuid, step_param text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into private.account_deletion_failures (account_id, step) values (user_id_param, step_param);
  perform private._account_deletion_alert();
end;
$function$;
revoke all on function public.account_deletion_record_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.account_deletion_record_failure(uuid, text) to service_role;

-- 20270375's hourly call + files waiting (a deletion whose first removal failed, a hold's file whose retention has passed).
create or replace function private.request_due_deletions()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
begin
  if not exists (select 1 from public.account_deletions_due())
     and not exists (select 1 from private.account_file_cleanup q where private.account_file_due(q)) then
    return 'none';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return 'no_key'; end if;
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/delete-account',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('purge_due', true));
  return 'requested';
exception when others then
  return 'failed';
end;
$function$;
revoke all on function private.request_due_deletions() from public, anon, authenticated;

-- ===== the daily job =====
-- Under a recorded policy only (held_evidence_hold_purgeable). A file whose account is gone is queued for removal; a file of a living
-- account just stops being listed and is the person's again.
create or replace function private.purge_held_account_evidence()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.legal_hold_lock();
  insert into private.account_file_cleanup (bucket_id, object_name, object_id, account_id, reason)
  select o.bucket_id, o.name, o.id, f.account_id, 'hold_ended'
    from private.legal_hold_files f join storage.objects o on o.id = f.object_id
   where private.held_evidence_hold_purgeable(f.hold_id)
     and f.account_id is not null and not exists (select 1 from auth.users u where u.id = f.account_id)
  on conflict (bucket_id, object_name) do nothing;
  delete from private.legal_hold_files f where private.held_evidence_hold_purgeable(f.hold_id);
  delete from private.held_account_evidence e where private.held_evidence_hold_purgeable(e.hold_id);
  delete from private.account_deletion_failures where failed_at < now() - interval '90 days';
  delete from private.account_deletion_markers m
   where not exists (select 1 from auth.users u where u.id = m.account_id)
     and not exists (select 1 from private.account_file_cleanup q where q.account_id = m.account_id);
  perform private._account_deletion_alert();
end;
$function$;
revoke all on function private.purge_held_account_evidence() from public, anon, authenticated;

-- ===== admins =====
-- 20270400's function + scope_param + the original files.
drop function if exists public.admin_place_legal_hold(text, uuid, text, text);
create or replace function public.admin_place_legal_hold(target_type_param text, target_id_param uuid, reason_param text,
  reference_param text default null, scope_param text default 'item')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_reason text := btrim(coalesce(reason_param, ''));
  v_ref text := nullif(btrim(coalesce(reference_param, '')), '');
  v_existing uuid;
  v_id uuid;
  v_report uuid;
  v_media text := 'none';
  v_path text;
  v_sub record;
  v_scope text := coalesce(scope_param, 'item');
  v_files jsonb;
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if target_type_param is null or target_type_param not in ('report', 'content_removal', 'review_case', 'id_submission') then
    raise exception 'Hold a report, a removal record, a review case or an ID submission' using errcode = '22023', hint = 'legal_hold_target';
  end if;
  if length(v_reason) not between 10 and 1000 then
    raise exception 'Say why, in 10 to 1000 characters' using errcode = '22023', hint = 'legal_hold_reason_required';
  end if;
  if v_ref is not null and length(v_ref) > 200 then
    raise exception 'The reference is at most 200 characters' using errcode = '22023', hint = 'legal_hold_reference';
  end if;

  if v_scope not in ('item', 'account_history') then
    raise exception 'Hold the item or its account''s moderation history' using errcode = '22023', hint = 'legal_hold_scope';
  end if;

  perform private.legal_hold_lock();
  if target_type_param = 'report' then
    -- the report row first: a resolve at the same moment goes one way or the other
    select r.id into v_report from reports r where r.id = target_id_param for update;
    if v_report is null then
      raise exception 'That report doesn''t exist (it may already have been deleted)' using errcode = 'P0002', hint = 'legal_hold_not_found';
    end if;
  elsif target_type_param = 'content_removal' then
    perform 1 from private.content_removals c where c.id = target_id_param for update;
    if not found then
      raise exception 'That removal record doesn''t exist' using errcode = 'P0002', hint = 'legal_hold_not_found';
    end if;
    select c.report_id into v_report from private.content_removals c where c.id = target_id_param;
    perform 1 from reports r where r.id = v_report for update;
  elsif target_type_param = 'id_submission' then
    select s.id, s.selfie_path, s.id_photo_path into v_sub from id_verification_submissions s where s.id = target_id_param for update;
    if v_sub.id is null then
      raise exception 'That ID submission doesn''t exist' using errcode = 'P0002', hint = 'legal_hold_not_found';
    end if;
    -- the job's transaction (which only QUEUES a DELETE) finishes first (the row lock); a DELETE it handed to pg_net can't be
    -- recalled, so the answer below says 'deleting' for it, never 'held'
    perform 1 from private.id_document_cleanup q where q.object_path in (v_sub.selfie_path, v_sub.id_photo_path) for update of q;
  else
    perform 1 from private.account_review_cases c where c.id = target_id_param for update;
    if not found then
      raise exception 'That review case doesn''t exist (it may already have been deleted)' using errcode = 'P0002', hint = 'legal_hold_not_found';
    end if;
  end if;

  select h.id into v_existing from private.legal_holds h
   where h.target_type = target_type_param and h.target_id = target_id_param and h.released_at is null;
  if v_existing is not null then
    return jsonb_build_object('hold_id', v_existing, 'already', true);
  end if;

  insert into private.legal_holds (target_type, target_id, reason, reference, placed_by, scope)
  values (target_type_param, target_id_param, v_reason, v_ref, v_admin, v_scope)
  returning id into v_id;

  -- a held photo (a report about a Story or memory): held again if it was released and is still in Storage
  if target_type_param = 'report' then
    select e.media_path into v_path from private.report_media_evidence e where e.report_id = v_report;
    if v_path is not null then
      perform 1 from private.story_file_cleanup q where q.media_path = v_path for update of q;
      update private.report_media_evidence set released_at = null where report_id = v_report;
      -- a DELETE already sent by the job (pg_net runs it after the job commits) can't be recalled: 'deleting', never 'held'
      v_media := case when not exists (select 1 from storage.objects o where o.bucket_id = 'stories' and o.name = v_path) then 'already_deleted'
                      when exists (select 1 from private.story_file_cleanup q where q.media_path = v_path and q.request_id is not null) then 'deleting'
                      else 'held' end;
    end if;
  elsif target_type_param = 'id_submission' then
    v_media := case when not exists (select 1 from storage.objects o where o.bucket_id = 'id-verification'
                                       and o.name in (v_sub.selfie_path, v_sub.id_photo_path)) then 'already_deleted'
                    when exists (select 1 from private.id_document_cleanup q
                                  where q.object_path in (v_sub.selfie_path, v_sub.id_photo_path) and q.request_id is not null) then 'deleting'
                    else 'held' end;
  end if;

  v_files := private.register_hold_files(v_id);
  return jsonb_build_object('hold_id', v_id, 'already', false, 'photo', v_media, 'files', v_files);
end;
$function$;
revoke all on function public.admin_place_legal_hold(text, uuid, text, text, text) from public, anon;
grant execute on function public.admin_place_legal_hold(text, uuid, text, text, text) to authenticated;

-- 20270395's function + the shared lock + says whether a retention policy exists (nothing is purged without one).
create or replace function public.admin_release_legal_hold(hold_id_param uuid, reason_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_reason text := btrim(coalesce(reason_param, ''));
  h private.legal_holds%rowtype;
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if length(v_reason) not between 10 and 1000 then
    raise exception 'Say why, in 10 to 1000 characters' using errcode = '22023', hint = 'legal_hold_reason_required';
  end if;
  perform private.legal_hold_lock();  -- a deletion copying under this hold finishes first
  select * into h from private.legal_holds where id = hold_id_param for update;
  if not found then
    raise exception 'That hold doesn''t exist' using errcode = 'P0002', hint = 'legal_hold_not_found';
  end if;
  if h.released_at is not null then
    return jsonb_build_object('released', false, 'already', true);
  end if;
  update private.legal_holds set released_at = now(), released_by = v_admin, release_reason = v_reason where id = h.id;
  -- a report's photo follows its outcome again: released if the report's last outcome was "No action needed"
  if h.target_type = 'report' and not private.report_on_legal_hold(h.target_id)
     and (select a.action from report_actions a where a.report_id = h.target_id order by a.created_at desc, a.id desc limit 1)
         = 'resolved_no_action' then
    update private.report_media_evidence set released_at = now() where report_id = h.target_id and released_at is null;
  end if;
  return jsonb_build_object('released', true, 'already', false, 'retention_set', private.held_evidence_retention() is not null);
end;
$function$;
revoke all on function public.admin_release_legal_hold(uuid, text) from public, anon;
grant execute on function public.admin_release_legal_hold(uuid, text) to authenticated;

-- 20270395's function + the hold's scope.
drop function if exists public.admin_list_legal_holds(boolean);
create function public.admin_list_legal_holds(include_released_param boolean default false)
returns table (hold_id uuid, target_type text, target_id uuid, reason text, reference text, placed_by uuid, placed_at timestamptz,
  released_by uuid, released_at timestamptz, release_reason text, scope text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return query
    select h.id, h.target_type, h.target_id, h.reason, h.reference, h.placed_by, h.placed_at, h.released_by, h.released_at, h.release_reason, h.scope
      from private.legal_holds h
     where coalesce(include_released_param, false) or h.released_at is null
     order by h.placed_at desc;
end;
$function$;
revoke all on function public.admin_list_legal_holds(boolean) from public, anon;
grant execute on function public.admin_list_legal_holds(boolean) to authenticated;

-- A hold's files: what they are, never where. Opening one needs the function below.
create or replace function public.admin_list_held_files(hold_id_param uuid)
returns table (object_id uuid, bucket_id text, size_bytes bigint, mimetype text, etag text, sha256 text, registered_at timestamptz, still_in_storage boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return query
    select f.object_id, f.bucket_id, f.size_bytes, f.mimetype, f.etag, f.sha256, f.registered_at,
           exists (select 1 from storage.objects o where o.id = f.object_id)
      from private.legal_hold_files f where f.hold_id = hold_id_param order by f.registered_at, f.object_id;
end;
$function$;
revoke all on function public.admin_list_held_files(uuid) from public, anon;
grant execute on function public.admin_list_held_files(uuid) to authenticated;

-- Opening a held file: on record first, with the reason. Returns where it is; the Storage policy below then lets this admin ask for a link.
create or replace function public.admin_open_held_file(hold_id_param uuid, object_id_param uuid, purpose_param text)
returns table (bucket_id text, object_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_purpose text := btrim(coalesce(purpose_param, ''));
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if length(v_purpose) not between 10 and 500 then
    raise exception 'Say why, in 10 to 500 characters' using errcode = '22023', hint = 'legal_hold_reason_required';
  end if;
  if not exists (select 1 from private.legal_hold_files f where f.hold_id = hold_id_param and f.object_id = object_id_param) then
    raise exception 'That file isn''t under this hold' using errcode = 'P0002', hint = 'legal_hold_not_found';
  end if;
  insert into private.legal_hold_file_access (hold_id, object_id, admin_id, purpose) values (hold_id_param, object_id_param, v_admin, v_purpose);
  return query select f.bucket_id, f.object_name from private.legal_hold_files f where f.hold_id = hold_id_param and f.object_id = object_id_param;
end;
$function$;
revoke all on function public.admin_open_held_file(uuid, uuid, text) from public, anon;
grant execute on function public.admin_open_held_file(uuid, uuid, text) to authenticated;

-- Reading the file: only an admin, only for 15 minutes after opening it on record.
create or replace function public.admin_held_file_visible(p_object_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and p_object_id is not null and check_is_admin(auth.uid())
     and exists (select 1 from private.legal_hold_file_access a
                  where a.admin_id = auth.uid() and a.object_id = p_object_id and a.opened_at > now() - interval '15 minutes');
$function$;
revoke all on function public.admin_held_file_visible(uuid) from public, anon;
grant execute on function public.admin_held_file_visible(uuid) to authenticated;
drop policy if exists "Admins can open held evidence files" on storage.objects;
create policy "Admins can open held evidence files" on storage.objects
  for select to authenticated
  using (bucket_id in ('profile-photos', 'chat-media', 'profile-audio') and public.admin_held_file_visible(id));

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-held-account-evidence') then
    perform cron.unschedule('purge-held-account-evidence');
  end if;
  perform cron.schedule('purge-held-account-evidence', '50 4 * * *', 'select private.purge_held_account_evidence()');
end;
$$;
