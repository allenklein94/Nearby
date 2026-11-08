-- Rollback of 20270402. WARNING: this destroys what it kept. It refuses to run while any evidence, kept file, access record or policy row
-- exists: export them first and get the owner's + counsel's decision, because they may be under an active hold. An original file stays in
-- its bucket, but nothing protects it any more once this runs.
-- Redeploy the previous delete-account FIRST: this version refuses to delete without these functions.
do $$
begin
  if exists (select 1 from private.held_account_evidence) or exists (select 1 from private.legal_hold_files)
     or exists (select 1 from private.legal_hold_file_access) or exists (select 1 from private.held_evidence_retention_policy) then
    raise exception 'Kept evidence exists: export it and get a decision before rolling back';
  end if;
  if exists (select 1 from private.account_file_cleanup) then
    raise exception 'Files are waiting to be removed: let them finish, or they are never removed';
  end if;
  if exists (select 1 from cron.job where jobname = 'purge-held-account-evidence') then
    perform cron.unschedule('purge-held-account-evidence');
  end if;
end;
$$;
-- 20270395's report rule + 20270374's purge, as they were
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
                          and h.target_id in (select c.id from private.content_removals c where c.report_id = p_report))));
$function$;
create or replace function private.purge_suspended_account_records()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.suspended_account_records where expires_at <= now();
  -- anything the matcher could not take within a day (it runs every 10 minutes): dropped, never kept
  delete from private.phone_match_queue where queued_at < now() - interval '1 day';
  delete from private.suspended_number_failures where at < now() - interval '90 days';
$function$;
-- 20270375's hourly call
create or replace function private.request_due_deletions()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
begin
  if not exists (select 1 from public.account_deletions_due()) then return 'none'; end if;
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

-- the admin functions as 20270395 / 20270400 left them
drop policy if exists "Admins can open held evidence files" on storage.objects;
drop function if exists public.admin_held_file_visible(uuid);
drop function if exists public.admin_open_held_file(uuid, uuid, text);
drop function if exists public.admin_list_held_files(uuid);
drop function if exists public.admin_list_legal_holds(boolean);
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
drop function if exists public.admin_place_legal_hold(text, uuid, text, text, text);
create or replace function public.admin_place_legal_hold(target_type_param text, target_id_param uuid, reason_param text,
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
  v_sub record;
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

  insert into private.legal_holds (target_type, target_id, reason, reference, placed_by)
  values (target_type_param, target_id_param, v_reason, v_ref, v_admin)
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

  return jsonb_build_object('hold_id', v_id, 'already', false, 'photo', v_media);
end;
$function$;
revoke all on function public.admin_place_legal_hold(text, uuid, text, text) from public, anon;
grant execute on function public.admin_place_legal_hold(text, uuid, text, text) to authenticated;
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
     or (new.id, new.target_type, new.target_id, new.reason, new.reference, new.placed_by, new.placed_at)
        is distinct from (old.id, old.target_type, old.target_id, old.reason, old.reference, old.placed_by, old.placed_at) then
    raise exception 'A legal hold can only be released, once' using hint = 'legal_hold_immutable';
  end if;
  return new;
end;
$function$;

drop trigger if exists a_preserve_held_evidence on public.profiles;
drop trigger if exists a_preserve_held_evidence on auth.users;
drop trigger if exists legal_hold_object_guard on storage.objects;
drop function if exists public.account_deletion_preserve_held_evidence(uuid);
drop function if exists public.account_file_cleanup_claim(uuid);
drop function if exists public.account_file_cleanup_confirm(jsonb);
drop function if exists public.account_deletion_record_failure(uuid, text);
drop function if exists private.purge_held_account_evidence();
drop function if exists private._account_deletion_alert();
drop function if exists private.account_file_due(private.account_file_cleanup);
drop function if exists private._preserve_held_evidence_before_delete();
drop function if exists private.preserve_held_account_evidence(uuid);
drop function if exists private._storage_object_hold_guard();
drop function if exists private.register_hold_files(uuid);
drop function if exists private._list_hold_file(uuid, uuid, uuid);
drop function if exists private.object_under_hold(uuid);
drop function if exists private.hold_is_about_account(text, uuid, uuid);
drop function if exists private.report_names_account(uuid, uuid);
drop function if exists private.hold_case_ids(text, uuid);
drop function if exists private.hold_report_ids(text, uuid);
drop table if exists private.legal_hold_file_access;
drop table if exists private.legal_hold_files;
drop table if exists private.held_account_evidence;
drop table if exists private.held_evidence_retention_policy;
drop table if exists private.account_file_cleanup;
drop table if exists private.account_deletion_markers;
drop table if exists private.account_deletion_failures;
drop function if exists private._append_only_guard();
drop function if exists private._held_evidence_guard();
drop function if exists private.set_held_evidence_retention(interval, text, text);
drop function if exists private.held_evidence_hold_purgeable(uuid);
drop function if exists private.held_evidence_retention();
alter table private.legal_holds drop constraint if exists legal_holds_scope_check;
alter table private.legal_holds drop column if exists scope;
