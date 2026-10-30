-- Review cases: history, no reopening for unchanged evidence, side-by-side photo review, report -> investigation, and
-- retention (owner approved 2026-10-30, with safeguards). Staged after 20270368; deploy only with its own approval.
-- Every outcome stays a human decision: nothing here bans, suspends, hides, restricts or limits anyone, or tells anyone.
--
--   1. History. private.account_review_case_events is APPEND-ONLY (no client access; updates refused; rows leave only
--      with their case at retention): opened, account added, new evidence after closing, note, outside check, report
--      linked, closed (outcome + note + admin), reopened (reason + admin). Closing no longer loses the earlier decision:
--      the case row shows the latest decision, the events keep every one.
--   2. No reopening for unchanged evidence. A closed case is never reopened or replaced automatically:
--        * the same photo (exact or similar) uploaded again by the same accounts changes nothing;
--        * a NEW account with that photo is added to the closed case as "new evidence since closed" (one event), the
--          case surfaces in the admin queue, and it stays closed;
--        * behaviour signals: only signals AFTER the case was closed count, and they record new evidence on the closed
--          case instead of opening a fresh one (at most one event a day).
--      Only an admin reopens a case, with a written reason (admin_reopen_account_review_case), recorded with them and
--      the time.
--   3. Photo review. A photo case keeps the photos it is about (identical: the matching files; similar: 20270368; a case
--      opened from a report: the reported person's photos at that moment). admin_get_account_review_case returns their
--      storage paths to ADMINS only; the website then asks Storage for 15-minute signed links, and Storage itself
--      re-checks the admin (policy "Admins can view photos under review" -> admin_review_photo_visible): an admin may
--      read only photos attached to a case that still exists, nobody else gains anything, the bucket stays private.
--   4. Reports. A report never opens a case by itself (a report is an allegation, not evidence). An admin may open a
--      linked investigation from any report (admin_open_case_from_report): it joins the reported person's open case if
--      there is one, else opens a 'report' case. The report itself, and its frozen evidence (20270355), is untouched.
--   5. Retention.
--        * Resolved (closed) cases: deleted 12 months after they were last closed (or after the last new evidence, if
--          later), with their members, photo list, report links and events; from then on no admin can read those photos
--          through this path (the policy needs the case). Daily, purge_account_review_cases.
--        * Open cases: never closed automatically (closing is a human decision). Each has a review date 30 days after it
--          opened or was reopened; the admin queue lists overdue cases first and counts them. A case whose accounts have
--          all been deleted is removed (account deletion cascades the member rows; the purge removes the empty case).
--        * Account deletion: the person's member rows, photo rows and fingerprints/hashes go with the account; events keep
--          the case's history with that person's id set to null.

-- 1. Columns and constraints -------------------------------------------------------------------------------------------
alter table private.account_review_cases add column if not exists review_due_at timestamptz;
alter table private.account_review_cases add column if not exists new_evidence_at timestamptz;
update private.account_review_cases set review_due_at = opened_at + interval '30 days' where review_due_at is null;
alter table private.account_review_cases alter column review_due_at set default now() + interval '30 days';
alter table private.account_review_cases alter column review_due_at set not null;
alter table private.account_review_case_members add column if not exists after_close boolean not null default false;

alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report'));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile'));
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null)
         and (signal in ('behavior', 'report')) = (subject_user is not null));
create unique index if not exists account_review_cases_one_open_report on private.account_review_cases (subject_user)
  where status = 'open' and signal = 'report';

create table if not exists private.account_review_case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references private.account_review_cases(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid references auth.users(id) on delete set null,     -- the admin; null = the system
  kind text not null check (kind in ('opened', 'member_added', 'new_evidence', 'note', 'external_check',
                                     'report_linked', 'closed', 'reopened')),
  subject uuid references auth.users(id) on delete set null,   -- the account an event is about, if any
  detail jsonb not null default '{}'::jsonb
);
create index if not exists account_review_case_events_case_idx on private.account_review_case_events (case_id, at);

create table if not exists private.account_review_case_reports (
  case_id uuid not null references private.account_review_cases(id) on delete cascade,
  report_id uuid not null,               -- public.reports.id (no FK: the report keeps its own retention, 20270355)
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id) on delete set null,
  primary key (case_id, report_id)
);
revoke all on private.account_review_case_events, private.account_review_case_reports from public, anon, authenticated;

-- Append-only: an event is never changed; it leaves only with its case (retention / every member deleted).
create or replace function private._review_case_event_guard()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'UPDATE' then
    -- the one allowed change: an account deletion nulls that person's id (ON DELETE SET NULL); nothing else
    if new.id = old.id and new.case_id = old.case_id and new.at = old.at and new.kind = old.kind and new.detail = old.detail
       and (new.actor is not distinct from old.actor or new.actor is null)
       and (new.subject is not distinct from old.subject or new.subject is null)
       and (new.actor is null and old.actor is not null and not exists (select 1 from auth.users u where u.id = old.actor)
            or new.subject is null and old.subject is not null and not exists (select 1 from auth.users u where u.id = old.subject)) then
      return new;
    end if;
    raise exception 'Review case history is append-only' using errcode = '42501', hint = 'case_history_append_only';
  end if;
  if exists (select 1 from private.account_review_cases c where c.id = old.case_id) then
    raise exception 'Review case history is append-only' using errcode = '42501', hint = 'case_history_append_only';
  end if;
  return old;
end;
$function$;
revoke all on function private._review_case_event_guard() from public, anon, authenticated;
drop trigger if exists review_case_event_guard on private.account_review_case_events;
create trigger review_case_event_guard before update or delete on private.account_review_case_events
  for each row execute function private._review_case_event_guard();
-- (TRUNCATE is refused too: nobody but the table owner can truncate, and no function does.)

-- Opening and every added account are recorded by triggers, so every path (rules, admins, older functions) is covered.
create or replace function private._review_case_opened()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into private.account_review_case_events (case_id, actor, kind, subject, detail)
    values (new.id, case when auth.uid() is not null and check_is_admin(auth.uid()) then auth.uid() end, 'opened',
            new.subject_user, jsonb_build_object('signal', new.signal, 'reason', new.reason));
  return null;
end;
$function$;
revoke all on function private._review_case_opened() from public, anon, authenticated;
drop trigger if exists review_case_opened on private.account_review_cases;
create trigger review_case_opened after insert on private.account_review_cases
  for each row execute function private._review_case_opened();

-- An account added to a CLOSED case = new evidence since closing (the case stays closed and surfaces for review).
create or replace function private._review_case_member_mark()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  new.after_close := exists (select 1 from private.account_review_cases c where c.id = new.case_id and c.status = 'closed');
  return new;
end;
$function$;
revoke all on function private._review_case_member_mark() from public, anon, authenticated;
drop trigger if exists review_case_member_mark on private.account_review_case_members;
create trigger review_case_member_mark before insert on private.account_review_case_members
  for each row execute function private._review_case_member_mark();

create or replace function private._review_case_member_added()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into private.account_review_case_events (case_id, actor, kind, subject)
    values (new.case_id, case when auth.uid() is not null and check_is_admin(auth.uid()) then auth.uid() end,
            case when new.after_close then 'new_evidence' else 'member_added' end, new.user_id);
  if new.after_close then
    update private.account_review_cases set new_evidence_at = now(), updated_at = now() where id = new.case_id;
  end if;
  return null;
end;
$function$;
revoke all on function private._review_case_member_added() from public, anon, authenticated;
drop trigger if exists review_case_member_added on private.account_review_case_members;
create trigger review_case_member_added after insert on private.account_review_case_members
  for each row execute function private._review_case_member_added();

-- History for cases that existed before this migration (none on production: 0357/0363 are not deployed together with it
-- yet; kept for any database where they are).
insert into private.account_review_case_events (case_id, at, kind, subject, detail)
  select c.id, c.opened_at, 'opened', c.subject_user, jsonb_build_object('signal', c.signal, 'reason', c.reason, 'backfilled', true)
    from private.account_review_cases c
   where not exists (select 1 from private.account_review_case_events e where e.case_id = c.id);
insert into private.account_review_case_events (case_id, at, actor, kind, detail)
  select c.id, c.closed_at, c.closed_by, 'closed', jsonb_build_object('outcome', c.outcome, 'note', c.note, 'backfilled', true)
    from private.account_review_cases c
   where c.status = 'closed' and not exists (select 1 from private.account_review_case_events e where e.case_id = c.id and e.kind = 'closed');
-- identical-photo cases keep their files too
insert into private.account_review_case_photos (case_id, object_id, user_id)
  select c.id, f.object_id, f.user_id
    from private.account_review_cases c
    join private.photo_fingerprints f on f.sha256 = c.sha256
    join private.account_review_case_members m on m.case_id = c.id and m.user_id = f.user_id
   where c.signal = 'identical_photo'
  on conflict do nothing;

-- 2. No reopening for unchanged evidence ---------------------------------------------------------------------------------

-- Exact copies (20270357 + the case keeps its files; a photo already in a case never opens a second one).
create or replace function private.evaluate_photo_fingerprint(p_sha256 text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.account_signal_settings;
  v_users uuid[];
  v_reason text;
  v_case uuid;
  v_status text;
begin
  select * into s from private.account_signal_settings where id;
  if s.duplicate_photo_min_accounts is null and s.similar_name_min_similarity is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('photo_case:' || p_sha256));
  select array_agg(distinct f.user_id) into v_users from private.photo_fingerprints f
   where f.sha256 = p_sha256 and private.photo_object_in_use(f.user_id, f.object_id);
  if coalesce(cardinality(v_users), 0) < 2 then return; end if;

  -- the case for this file, open first; a closed one is never reopened or replaced (only new accounts are noted)
  select id, status into v_case, v_status from private.account_review_cases
   where signal = 'identical_photo' and sha256 = p_sha256
   order by (status = 'open') desc, opened_at desc limit 1
   for update;

  if v_case is null then
    if s.duplicate_photo_min_accounts is not null and cardinality(v_users) >= s.duplicate_photo_min_accounts then
      v_reason := 'many_accounts';
    elsif s.similar_name_min_similarity is not null and exists (
        select 1 from profiles a join profiles b on a.id < b.id
         where a.id = any(v_users) and b.id = any(v_users)
           and private.normalized_name(a.display_name) is not null
           and private.normalized_name(b.display_name) is not null
           and private.name_similarity(private.normalized_name(a.display_name), private.normalized_name(b.display_name))
               >= s.similar_name_min_similarity) then
      v_reason := 'similar_names';
    end if;
    if v_reason is null then return; end if;
    insert into private.account_review_cases (signal, sha256, reason) values ('identical_photo', p_sha256, v_reason)
      returning id into v_case;
  elsif v_status = 'open' then
    if s.duplicate_photo_min_accounts is not null and cardinality(v_users) >= s.duplicate_photo_min_accounts then
      update private.account_review_cases set reason = 'many_accounts', updated_at = now() where id = v_case and reason <> 'many_accounts';
    end if;
  end if;
  insert into private.account_review_case_photos (case_id, object_id, user_id)
    select v_case, f.object_id, f.user_id from private.photo_fingerprints f
     where f.sha256 = p_sha256 and private.photo_object_in_use(f.user_id, f.object_id)
       and (v_status is distinct from 'closed'
            or not exists (select 1 from private.account_review_case_members m where m.case_id = v_case and m.user_id = f.user_id))
    on conflict do nothing;
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;  -- on a closed case only a NEW account inserts a row (= new evidence, see the trigger)
end;
$function$;
revoke all on function private.evaluate_photo_fingerprint(text) from public, anon, authenticated;

-- Similar copies (20270368 + a closed case notes new accounts instead of doing nothing).
create or replace function private.evaluate_similar_photo(p_object uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.account_signal_settings;
  v_owner uuid;
  v_objects uuid[];
  v_users uuid[];
  v_reason text;
  v_case uuid;
  v_status text;
  v_sha text;
begin
  select * into s from private.account_signal_settings where id;
  if s.similar_photo_max_dhash is null or s.similar_photo_max_phash is null then return; end if;
  if s.duplicate_photo_min_accounts is null and s.similar_name_min_similarity is null then return; end if;
  select h.user_id into v_owner from private.photo_perceptual_hashes h where h.object_id = p_object limit 1;
  if v_owner is null or not private.photo_object_in_use(v_owner, p_object) then return; end if;
  perform pg_advisory_xact_lock(hashtext('similar_photo_cases'));
  select f.sha256 into v_sha from private.photo_fingerprints f where f.object_id = p_object;
  select array_agg(x.object_id), array_agg(distinct x.user_id) into v_objects, v_users
    from (select p_object as object_id, v_owner as user_id
          union select m.object_id, m.user_id from private.similar_photo_objects(p_object) m
                 where v_sha is null or not exists (select 1 from private.photo_fingerprints f
                                                     where f.object_id = m.object_id and f.sha256 = v_sha)) x;
  if coalesce(cardinality(v_users), 0) < 2 then return; end if;

  select c.id, c.status into v_case, v_status
    from private.account_review_cases c
   where c.signal = 'similar_photo'
     and exists (select 1 from private.account_review_case_photos cp where cp.case_id = c.id and cp.object_id = any(v_objects))
   order by (c.status = 'open') desc, c.opened_at desc
   limit 1
   for update;

  if v_case is null then
    if s.duplicate_photo_min_accounts is not null and cardinality(v_users) >= s.duplicate_photo_min_accounts then
      v_reason := 'many_accounts';
    elsif s.similar_name_min_similarity is not null and exists (
        select 1 from profiles a join profiles b on a.id < b.id
         where a.id = any(v_users) and b.id = any(v_users)
           and private.normalized_name(a.display_name) is not null
           and private.normalized_name(b.display_name) is not null
           and private.name_similarity(private.normalized_name(a.display_name), private.normalized_name(b.display_name))
               >= s.similar_name_min_similarity) then
      v_reason := 'similar_names';
    end if;
    if v_reason is null then return; end if;
    insert into private.account_review_cases (signal, reason) values ('similar_photo', v_reason) returning id into v_case;
  elsif v_status = 'open' then
    if s.duplicate_photo_min_accounts is not null and cardinality(v_users) >= s.duplicate_photo_min_accounts then
      update private.account_review_cases set reason = 'many_accounts', updated_at = now() where id = v_case and reason <> 'many_accounts';
    end if;
  end if;
  insert into private.account_review_case_photos (case_id, object_id, user_id)
    select v_case, o.object_id, h.user_id
      from unnest(v_objects) o(object_id)
      join lateral (select user_id from private.photo_perceptual_hashes where object_id = o.object_id limit 1) h on true
     where v_status is distinct from 'closed'
        or not exists (select 1 from private.account_review_case_members m where m.case_id = v_case and m.user_id = h.user_id)
    on conflict do nothing;
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;
end;
$function$;
revoke all on function private.evaluate_similar_photo(uuid) from public, anon, authenticated;

-- Behaviour (20270363): only signals after the person's last closed case count; a closed case records new evidence
-- (at most one event a day) and is never replaced by a fresh case.
create or replace function private.behavior_evaluate_case(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.behavior_signal_settings;
  v_kinds text[];
  v_evidence jsonb;
  v_case uuid;
  v_closed uuid;
  v_closed_at timestamptz;
  v_last_new timestamptz;
begin
  select * into s from private.behavior_signal_settings where id;
  if not s.review_cases_enabled or s.case_window_hours is null or s.max_new_cases_per_day is null then return; end if;
  select id, closed_at, new_evidence_at into v_closed, v_closed_at, v_last_new from private.account_review_cases
   where signal = 'behavior' and subject_user = p_user and status = 'closed'
   order by closed_at desc limit 1;
  select array_agg(distinct kind),
         jsonb_agg(jsonb_build_object('kind', kind, 'first_at', first_at, 'last_at', last_at, 'hits', hits) || evidence
                   order by last_at desc)
    into v_kinds, v_evidence
    from private.behavior_signals
   where user_id = p_user and last_at > now() - make_interval(hours => s.case_window_hours)
     and (v_closed_at is null or last_at > v_closed_at);
  if v_kinds is null then return; end if;
  if not ((s.case_min_signal_kinds is not null and cardinality(v_kinds) >= s.case_min_signal_kinds)
          or v_kinds && s.case_alone_kinds) then
    return;
  end if;
  select id into v_case from private.account_review_cases
   where signal = 'behavior' and subject_user = p_user and status = 'open' for update;
  if v_case is not null then
    update private.account_review_cases set evidence = jsonb_build_object('signals', v_evidence), updated_at = now()
     where id = v_case;
    return;
  end if;
  if v_closed is not null then
    -- decided before: note the new signals on that case (the admin may reopen it), never a fresh case
    if v_last_new is null or v_last_new < v_closed_at or v_last_new < now() - interval '24 hours' then
      perform 1 from private.account_review_cases where id = v_closed for update;
      insert into private.account_review_case_events (case_id, kind, subject, detail)
        values (v_closed, 'new_evidence', p_user, jsonb_build_object('signals', v_evidence));
      update private.account_review_cases set new_evidence_at = now(), updated_at = now() where id = v_closed;
    end if;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('behavior_case_queue'));
  if (select count(*) from private.account_review_cases
       where signal = 'behavior' and opened_at > now() - interval '24 hours') >= s.max_new_cases_per_day then
    insert into private.behavior_case_overflow (day, suppressed) values ((now() at time zone 'utc')::date, 1)
      on conflict (day) do update set suppressed = private.behavior_case_overflow.suppressed + 1;
    insert into private.behavior_case_waiting (user_id) values (p_user)
      on conflict (user_id) do update set last_at = now(), times = private.behavior_case_waiting.times + 1;
    return;
  end if;
  insert into private.account_review_cases (signal, reason, subject_user, evidence)
    values ('behavior', 'behavior_pattern', p_user, jsonb_build_object('signals', v_evidence))
    on conflict (subject_user) where status = 'open' and signal = 'behavior' do nothing
    returning id into v_case;
  if v_case is not null then
    insert into private.account_review_case_members (case_id, user_id) values (v_case, p_user) on conflict do nothing;
    delete from private.behavior_case_waiting where user_id = p_user;
  end if;
end;
$function$;
revoke all on function private.behavior_evaluate_case(uuid) from public, anon, authenticated;

-- 3. Admin review --------------------------------------------------------------------------------------------------------
create or replace function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return auth.uid();
end;
$function$;
revoke all on function private.require_admin() from public, anon, authenticated;

create or replace function private.clean_case_text(p text, p_max integer, p_hint text)
returns text
language plpgsql
immutable
as $function$
declare
  v text := nullif(btrim(coalesce(p, '')), '');
begin
  if v is not null and length(v) > p_max then
    raise exception 'Keep it under % characters', p_max using errcode = '22023', hint = p_hint;
  end if;
  return v;
end;
$function$;
revoke all on function private.clean_case_text(text, integer, text) from public, anon, authenticated;

-- The queue: open cases (overdue first), then closed cases with new evidence since closing, then (on request) the rest.
-- new_evidence_at is cleared by every close and reopen, so on a closed case it always means "since it was closed".
create or replace function public.admin_list_account_review_cases(include_closed_param boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'signal', c.signal, 'reason', c.reason, 'status', c.status,
             'opened_at', c.opened_at, 'updated_at', c.updated_at, 'closed_at', c.closed_at,
             'outcome', c.outcome, 'note', c.note, 'evidence', c.evidence,
             'review_due_at', c.review_due_at,
             'overdue', c.status = 'open' and c.review_due_at < now(),
             'new_evidence_since_closed', c.status = 'closed' and c.new_evidence_at is not null,
             'photos', (select count(*) from private.account_review_case_photos cp where cp.case_id = c.id),
             'reports', (select count(*) from private.account_review_case_reports cr where cr.case_id = c.id),
             'members', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'user_id', m.user_id, 'display_name', p.display_name,
                                  'suspended', p.suspended_at is not null, 'added_at', m.added_at,
                                  'after_close', m.after_close) order by m.added_at), '[]'::jsonb)
                           from private.account_review_case_members m left join profiles p on p.id = m.user_id
                          where m.case_id = c.id))
           order by (c.status = 'open') desc, (c.status = 'open' and c.review_due_at < now()) desc,
                    (c.status = 'closed' and c.new_evidence_at is not null) desc, c.updated_at desc)
      from private.account_review_cases c
     where include_closed_param or c.status = 'open' or c.new_evidence_at is not null), '[]'::jsonb);
end;
$function$;
revoke all on function public.admin_list_account_review_cases(boolean) from public, anon;
grant execute on function public.admin_list_account_review_cases(boolean) to authenticated;

-- One case in full: members, the photos to compare (storage paths, only files that still exist), linked reports and the
-- whole history. Paths are useless without the Storage policy below, which re-checks the admin for every signed link.
create or replace function public.admin_get_account_review_case(case_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c private.account_review_cases;
begin
  perform private.require_admin();
  select * into c from private.account_review_cases where id = case_id_param;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  return jsonb_build_object(
    'id', c.id, 'signal', c.signal, 'reason', c.reason, 'status', c.status, 'opened_at', c.opened_at,
    'updated_at', c.updated_at, 'closed_at', c.closed_at, 'outcome', c.outcome, 'note', c.note, 'evidence', c.evidence,
    'review_due_at', c.review_due_at, 'overdue', c.status = 'open' and c.review_due_at < now(),
    'new_evidence_since_closed', c.status = 'closed' and c.new_evidence_at is not null,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                         'user_id', m.user_id, 'display_name', p.display_name, 'suspended', p.suspended_at is not null,
                         'added_at', m.added_at, 'after_close', m.after_close) order by m.added_at), '[]'::jsonb)
                  from private.account_review_case_members m left join profiles p on p.id = m.user_id where m.case_id = c.id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                        'object_id', cp.object_id, 'user_id', cp.user_id, 'path', o.name, 'added_at', cp.added_at,
                        'in_use', private.photo_object_in_use(cp.user_id, cp.object_id)) order by cp.user_id, cp.added_at), '[]'::jsonb)
                 from private.account_review_case_photos cp
                 join storage.objects o on o.id = cp.object_id and o.bucket_id = 'profile-photos'
                where cp.case_id = c.id),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object(
                         'report_id', cr.report_id, 'linked_at', cr.linked_at, 'reason', r.reason, 'created_at', r.created_at,
                         'resolved', r.resolved, 'still_kept', r.id is not null) order by cr.linked_at), '[]'::jsonb)
                  from private.account_review_case_reports cr left join reports r on r.id = cr.report_id where cr.case_id = c.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                        'at', e.at, 'kind', e.kind, 'detail', e.detail,
                        'actor', e.actor, 'actor_name', (select display_name from profiles where id = e.actor),
                        'subject', e.subject, 'subject_name', (select display_name from profiles where id = e.subject))
                        order by e.at, e.id), '[]'::jsonb)
                 from private.account_review_case_events e where e.case_id = c.id));
end;
$function$;
revoke all on function public.admin_get_account_review_case(uuid) from public, anon;
grant execute on function public.admin_get_account_review_case(uuid) to authenticated;

-- Close: as 20270357, now with the decision kept in the history (the case row shows the latest one).
create or replace function public.admin_close_account_review_case(case_id_param uuid, outcome_param text, note_param text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
  v_status text;
  v_note text := private.clean_case_text(note_param, 1000, 'case_note_length');
begin
  if outcome_param is null or outcome_param not in ('no_action', 'action_taken') then
    raise exception 'Choose an outcome' using errcode = '22023', hint = 'case_outcome';
  end if;
  select status into v_status from private.account_review_cases where id = case_id_param for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('already', true);
  end if;
  update private.account_review_cases
     set status = 'closed', closed_at = now(), closed_by = v_admin, outcome = outcome_param, note = v_note,
         new_evidence_at = null, updated_at = now()
   where id = case_id_param;
  insert into private.account_review_case_events (case_id, actor, kind, detail)
    values (case_id_param, v_admin, 'closed', jsonb_build_object('outcome', outcome_param, 'note', v_note));
  return jsonb_build_object('already', false);
end;
$function$;
revoke all on function public.admin_close_account_review_case(uuid, text, text) from public, anon;
grant execute on function public.admin_close_account_review_case(uuid, text, text) to authenticated;

-- Reopen: only an admin, only with a written reason (what is materially new), recorded in the history.
create or replace function public.admin_reopen_account_review_case(case_id_param uuid, reason_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.clean_case_text(reason_param, 1000, 'case_reason_length');
  c private.account_review_cases;
begin
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Say what is new (at least 10 characters)' using errcode = '22023', hint = 'case_reopen_reason';
  end if;
  select * into c from private.account_review_cases where id = case_id_param for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  if c.status = 'open' then
    return jsonb_build_object('already', true);
  end if;
  begin
    update private.account_review_cases
       set status = 'open', closed_at = null, closed_by = null, outcome = null, note = null, new_evidence_at = null,
           review_due_at = now() + interval '30 days', updated_at = now()
     where id = case_id_param;
  exception when unique_violation then
    raise exception 'Another open case already covers this. Review that one instead.' using errcode = '23505', hint = 'case_conflict';
  end;
  insert into private.account_review_case_events (case_id, actor, kind, detail)
    values (case_id_param, v_admin, 'reopened', jsonb_build_object('reason', v_reason,
            'previous_outcome', c.outcome, 'previous_note', c.note, 'previous_closed_at', c.closed_at));
  return jsonb_build_object('already', false);
end;
$function$;
revoke all on function public.admin_reopen_account_review_case(uuid, text) from public, anon;
grant execute on function public.admin_reopen_account_review_case(uuid, text) to authenticated;

create or replace function public.admin_add_account_review_note(case_id_param uuid, note_param text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
  v_note text := private.clean_case_text(note_param, 1000, 'case_note_length');
begin
  if v_note is null then
    raise exception 'Write a note' using errcode = '22023', hint = 'case_note_empty';
  end if;
  if not exists (select 1 from private.account_review_cases where id = case_id_param) then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  insert into private.account_review_case_events (case_id, actor, kind, detail)
    values (case_id_param, v_admin, 'note', jsonb_build_object('note', v_note));
end;
$function$;
revoke all on function public.admin_add_account_review_note(uuid, text) from public, anon;
grant execute on function public.admin_add_account_review_note(uuid, text) to authenticated;

-- An outside check the admin did themselves (e.g. a reverse image search): where, what it found, an optional https link.
-- Nothing is sent anywhere by Nearby; no vendor is connected.
create or replace function public.admin_record_case_external_check(case_id_param uuid, source_param text, result_param text,
                                                                  link_param text default null, note_param text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
  v_source text := private.clean_case_text(source_param, 100, 'case_source_length');
  v_link text := private.clean_case_text(link_param, 500, 'case_link_length');
  v_note text := private.clean_case_text(note_param, 1000, 'case_note_length');
begin
  if v_source is null then
    raise exception 'Say where you checked' using errcode = '22023', hint = 'case_source_empty';
  end if;
  if result_param is null or result_param not in ('match_found', 'no_match', 'inconclusive') then
    raise exception 'Choose a result' using errcode = '22023', hint = 'case_check_result';
  end if;
  if v_link is not null and v_link !~ '^https://[^\s]+$' then
    raise exception 'Use an https link' using errcode = '22023', hint = 'case_link';
  end if;
  if not exists (select 1 from private.account_review_cases where id = case_id_param) then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  insert into private.account_review_case_events (case_id, actor, kind, detail)
    values (case_id_param, v_admin, 'external_check',
            jsonb_strip_nulls(jsonb_build_object('source', v_source, 'result', result_param, 'link', v_link, 'note', v_note)));
end;
$function$;
revoke all on function public.admin_record_case_external_check(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_record_case_external_check(uuid, text, text, text, text) to authenticated;

-- 4. A report -> an investigation, only when an admin chooses. The report is untouched.
create or replace function public.admin_open_case_from_report(report_id_param uuid, note_param text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
  v_note text := private.clean_case_text(note_param, 1000, 'case_note_length');
  v_reported uuid;
  v_case uuid;
  v_new boolean := false;
begin
  select reported_id into v_reported from reports where id = report_id_param;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002', hint = 'report_not_found';
  end if;
  if v_reported is null then
    raise exception 'This report is not about an account' using errcode = '22023', hint = 'report_no_account';
  end if;
  perform pg_advisory_xact_lock(hashtext('report_case:' || v_reported::text));
  -- the reported person's open case, if any (any kind), else a new report case
  select c.id into v_case from private.account_review_cases c
   where c.status = 'open'
     and (c.subject_user = v_reported
          or exists (select 1 from private.account_review_case_members m where m.case_id = c.id and m.user_id = v_reported))
   order by (c.signal = 'report') desc, c.opened_at
   limit 1;
  if v_case is null then
    insert into private.account_review_cases (signal, reason, subject_user)
      values ('report', 'reported_profile', v_reported) returning id into v_case;
    v_new := true;
    insert into private.account_review_case_members (case_id, user_id) values (v_case, v_reported);
    -- the reported person's photos at this moment, for review
    insert into private.account_review_case_photos (case_id, object_id, user_id)
      select v_case, o.id, v_reported from storage.objects o
       where o.bucket_id = 'profile-photos' and private.photo_object_in_use(v_reported, o.id)
      on conflict do nothing;
  end if;
  insert into private.account_review_case_reports (case_id, report_id, linked_by) values (v_case, report_id_param, v_admin)
    on conflict do nothing;
  if found then
    insert into private.account_review_case_events (case_id, actor, kind, subject, detail)
      values (v_case, v_admin, 'report_linked', v_reported, jsonb_strip_nulls(jsonb_build_object('report_id', report_id_param, 'note', v_note)));
  end if;
  return jsonb_build_object('case_id', v_case, 'new', v_new);
end;
$function$;
revoke all on function public.admin_open_case_from_report(uuid, text) from public, anon;
grant execute on function public.admin_open_case_from_report(uuid, text) to authenticated;

-- 5. Private photo access for review -------------------------------------------------------------------------------------
-- True only for a signed-in ADMIN and a profile-photos file attached to a review case that still exists. Used by the
-- Storage policy, so a signed link is only ever issued after this check; links last 15 minutes (the website asks for 900 s).
create or replace function public.admin_review_photo_visible(p_object_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and p_object_id is not null and check_is_admin(auth.uid())
     and exists (select 1 from private.account_review_case_photos cp where cp.object_id = p_object_id);
$function$;
revoke all on function public.admin_review_photo_visible(uuid) from public, anon;
grant execute on function public.admin_review_photo_visible(uuid) to authenticated;

drop policy if exists "Admins can view photos under review" on storage.objects;
create policy "Admins can view photos under review" on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos' and public.admin_review_photo_visible(id));

-- 6. Retention ----------------------------------------------------------------------------------------------------------
create or replace function private.purge_account_review_cases()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  -- resolved: 12 months after the last close (or the last new evidence, if later)
  delete from private.account_review_cases c
   where c.status = 'closed'
     and greatest(c.closed_at, coalesce(c.new_evidence_at, c.closed_at)) < now() - interval '12 months';
  -- any case whose accounts have all been deleted
  delete from private.account_review_cases c
   where not exists (select 1 from private.account_review_case_members m where m.case_id = c.id)
     and c.opened_at < now() - interval '1 hour';
$function$;
revoke all on function private.purge_account_review_cases() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'purge-account-review-cases';
select cron.schedule('purge-account-review-cases', '41 4 * * *', 'select private.purge_account_review_cases();');
