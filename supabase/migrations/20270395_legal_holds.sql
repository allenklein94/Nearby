-- Legal holds on moderation evidence (owner, 2026-11-07). Staged after 20270394; own deploy approval. Needs 20270355 (reports +
-- action log), 20270369 (review cases), 20270391 (held report photos), 20270393 (removal records).
--
-- What it is: an admin can put a report, a removal record (20270393) or an account review case (20270369) on legal hold, with a
-- written reason and an optional outside reference (a ticket or a legal request number). While a hold is active the ordinary
-- retention jobs skip that evidence, whatever its age or outcome:
--   - purge_expired_reports: the report stays, with its server copy (20270355 / 20270392), every action on it, a reported chat
--     message's copy, and its held photo (report_media_evidence cascades from the report);
--   - a "No action needed" outcome no longer releases a held photo while the report is on hold; placing a hold re-holds a photo
--     that was released but is still in Storage (a file already deleted can't come back: the place call says so);
--   - purge_content_removal_snapshots: the removal's snapshot (the object, who was in it) stays;
--   - purge_account_review_cases: the case and its history stay, also once every account in it is deleted.
-- A hold on a removal record also keeps the report it came from, and a hold on that report keeps the removal's snapshot.
--
-- What it is NOT: nothing is ever put on hold automatically, and no content is classified as legally held by the system; only an
-- admin decides, case by case. It sets no retention period: the ordinary periods (12 months) are unchanged and still need legal
-- review, and a hold lasts until an admin releases it (with a written reason). Released holds stay on record. No client can read
-- or change the table; admins act only through the three functions below, each checking check_is_admin.
-- Races: placing a hold and the purge jobs take one shared lock, so a purge either finishes before the hold (the call then says
-- the evidence is gone) or runs after it and sees it. A hold and a "No action needed" outcome both lock the report row.

create table private.legal_holds (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('report', 'content_removal', 'review_case')),
  target_id uuid not null,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  reference text check (reference is null or length(btrim(reference)) between 1 and 200),
  placed_by uuid not null,
  placed_at timestamptz not null default now(),
  released_by uuid,
  released_at timestamptz,
  release_reason text check (release_reason is null or length(btrim(release_reason)) between 10 and 1000),
  check ((released_at is null) = (released_by is null) and (released_at is null) = (release_reason is null))
);
create unique index legal_holds_one_active on private.legal_holds (target_type, target_id) where released_at is null;
revoke all on table private.legal_holds from public, anon, authenticated;

-- A hold is never deleted or rewritten; the only change is its one release.
create function private.legal_hold_immutable()
returns trigger
language plpgsql
set search_path to 'private', 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'A legal hold is never deleted; release it instead' using hint = 'legal_hold_immutable';
  end if;
  if old.released_at is not null
     or (new.id, new.target_type, new.target_id, new.reason, new.reference, new.placed_by, new.placed_at)
        is distinct from (old.id, old.target_type, old.target_id, old.reason, old.reference, old.placed_by, old.placed_at) then
    raise exception 'A legal hold can only be released, once' using hint = 'legal_hold_immutable';
  end if;
  return new;
end;
$function$;
revoke all on function private.legal_hold_immutable() from public, anon, authenticated;
create trigger legal_hold_immutable before update or delete on private.legal_holds
  for each row execute function private.legal_hold_immutable();

-- One shared lock for placing a hold and the purge jobs (volatile, so each check reads what is committed now).
create function private.legal_hold_lock()
returns void
language sql
volatile
set search_path to 'private', 'public'
as $function$
  select pg_advisory_xact_lock(hashtextextended('nearby:legal_hold', 0));
$function$;
revoke all on function private.legal_hold_lock() from public, anon, authenticated;

create function private.report_on_legal_hold(p_report uuid)
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
                          and h.target_id in (select c.id from private.content_removals c where c.report_id = p_report))));
$function$;
revoke all on function private.report_on_legal_hold(uuid) from public, anon, authenticated;

create function private.removal_on_legal_hold(p_removal uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select exists (select 1 from private.legal_holds h
                  where h.released_at is null
                    and ((h.target_type = 'content_removal' and h.target_id = p_removal)
                      or (h.target_type = 'report'
                          and h.target_id in (select c.report_id from private.content_removals c where c.id = p_removal))));
$function$;
revoke all on function private.removal_on_legal_hold(uuid) from public, anon, authenticated;

create function private.case_on_legal_hold(p_case uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select exists (select 1 from private.legal_holds h
                  where h.released_at is null and h.target_type = 'review_case' and h.target_id = p_case);
$function$;
revoke all on function private.case_on_legal_hold(uuid) from public, anon, authenticated;

-- ===== the retention jobs skip held evidence =====

-- 20270355's purge + the hold
create or replace function private.purge_expired_reports()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.legal_hold_lock();
  delete from reports r
   where coalesce(r.resolved, false)
     and coalesce((select max(a.created_at) from report_actions a where a.report_id = r.id and a.action <> 'reopened'),
                  r.created_at) < now() - interval '12 months'
     and not private.report_on_legal_hold(r.id);
end;
$function$;
revoke all on function private.purge_expired_reports() from public, anon, authenticated;

-- 20270393's purge + the hold
create or replace function private.purge_content_removal_snapshots()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.legal_hold_lock();
  update private.content_removals c set snapshot = null
   where c.snapshot is not null and c.removed_at < now() - interval '12 months'
     and not private.removal_on_legal_hold(c.id);
end;
$function$;
revoke all on function private.purge_content_removal_snapshots() from public, anon, authenticated;

-- 20270369's purge + the hold
create or replace function private.purge_account_review_cases()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.legal_hold_lock();
  -- resolved: 12 months after the last close (or the last new evidence, if later)
  delete from private.account_review_cases c
   where c.status = 'closed'
     and greatest(c.closed_at, coalesce(c.new_evidence_at, c.closed_at)) < now() - interval '12 months'
     and not private.case_on_legal_hold(c.id);
  -- any case whose accounts have all been deleted
  delete from private.account_review_cases c
   where not exists (select 1 from private.account_review_case_members m where m.case_id = c.id)
     and c.opened_at < now() - interval '1 hour'
     and not private.case_on_legal_hold(c.id);
end;
$function$;
revoke all on function private.purge_account_review_cases() from public, anon, authenticated;

-- 20270391's outcome rule + the hold: "No action needed" doesn't release the photo of a report on hold.
create or replace function private._report_media_follow_outcome()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.action = 'resolved_no_action' then
    update private.report_media_evidence set released_at = now()
     where report_id = new.report_id and released_at is null and not private.report_on_legal_hold(new.report_id);
  elsif new.action = 'reopened' then
    -- waits for a run that has this file locked; a run that comes after sees the hold when it re-checks
    perform 1 from private.story_file_cleanup q
      where q.media_path in (select e.media_path from private.report_media_evidence e where e.report_id = new.report_id)
      for update of q;
    update private.report_media_evidence set released_at = null where report_id = new.report_id;
  end if;
  return null;
end;
$function$;
revoke all on function private._report_media_follow_outcome() from public, anon, authenticated;

-- ===== admins =====

create function public.admin_place_legal_hold(target_type_param text, target_id_param uuid, reason_param text,
  reference_param text default null)
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
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if target_type_param is null or target_type_param not in ('report', 'content_removal', 'review_case') then
    raise exception 'Hold a report, a removal record or a review case' using errcode = '22023', hint = 'legal_hold_target';
  end if;
  if length(v_reason) not between 10 and 1000 then
    raise exception 'Say why, in 10 to 1000 characters' using errcode = '22023', hint = 'legal_hold_reason_required';
  end if;
  if v_ref is not null and length(v_ref) > 200 then
    raise exception 'The reference is at most 200 characters' using errcode = '22023', hint = 'legal_hold_reference';
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

  insert into private.legal_holds (target_type, target_id, reason, reference, placed_by)
  values (target_type_param, target_id_param, v_reason, v_ref, v_admin)
  returning id into v_id;

  -- a held photo (a report about a Story or memory): held again if it was released and is still in Storage
  if target_type_param = 'report' then
    select e.media_path into v_path from private.report_media_evidence e where e.report_id = v_report;
    if v_path is not null then
      perform 1 from private.story_file_cleanup q where q.media_path = v_path for update of q;
      update private.report_media_evidence set released_at = null where report_id = v_report;
      v_media := case when exists (select 1 from storage.objects o where o.bucket_id = 'stories' and o.name = v_path)
                      then 'held' else 'already_deleted' end;
    end if;
  end if;

  return jsonb_build_object('hold_id', v_id, 'already', false, 'photo', v_media);
end;
$function$;
revoke all on function public.admin_place_legal_hold(text, uuid, text, text) from public, anon;
grant execute on function public.admin_place_legal_hold(text, uuid, text, text) to authenticated;

create function public.admin_release_legal_hold(hold_id_param uuid, reason_param text)
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
  return jsonb_build_object('released', true, 'already', false);
end;
$function$;
revoke all on function public.admin_release_legal_hold(uuid, text) from public, anon;
grant execute on function public.admin_release_legal_hold(uuid, text) to authenticated;

create function public.admin_list_legal_holds(include_released_param boolean default false)
returns table (hold_id uuid, target_type text, target_id uuid, reason text, reference text, placed_by uuid, placed_at timestamptz,
  released_by uuid, released_at timestamptz, release_reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return query
    select h.id, h.target_type, h.target_id, h.reason, h.reference, h.placed_by, h.placed_at, h.released_by, h.released_at, h.release_reason
      from private.legal_holds h
     where coalesce(include_released_param, false) or h.released_at is null
     order by h.placed_at desc;
end;
$function$;
revoke all on function public.admin_list_legal_holds(boolean) from public, anon;
grant execute on function public.admin_list_legal_holds(boolean) to authenticated;
