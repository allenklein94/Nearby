-- Rollback of 20270400 (ID-document retention). Refuses while an ID submission is on legal hold (release it first, with its written
-- reason: the hold record itself stays). After it: no automatic deletion of ID images any more (files queued but not yet deleted
-- stay in Storage; copy private.id_document_cleanup out first if they must still go), uploads are open again as before 0400, admins
-- read every ID image again. The audit rows (private.id_document_deletion_log) go with their table: copy it out first if needed.
-- Deploy the previous delete-account edge function back first (the 0400 version leaves ID deletion to this migration). Defect only.
do $$ begin
  if exists (select 1 from private.legal_holds where target_type = 'id_submission' and released_at is null) then
    raise exception 'An ID submission is on legal hold: release it first' using hint = 'id_hold_active';
  end if;
end $$;

select cron.unschedule('id-document-retention') where exists (select 1 from cron.job where jobname = 'id-document-retention');

drop function if exists public.admin_retry_id_document_cleanup();
drop function if exists public.admin_id_document_cleanup_status();
drop function if exists private.run_id_document_retention();
drop function if exists private._id_document_alert();
drop function if exists private._id_document_queue_due();
drop function if exists private._id_documents_failing();
drop function if exists private._id_document_send(text);
drop function if exists private._id_document_read_responses();
drop function if exists private._id_document_failed(text, integer, text, text, boolean);
drop trigger if exists queue_id_folder_on_account_delete on public.profiles;
drop function if exists private._queue_id_folder_on_account_delete();
drop trigger if exists queue_id_submission_files on public.id_verification_submissions;
drop function if exists private._queue_id_submission_files();
drop function if exists private.id_document_protected(text, uuid);
drop table if exists private.id_document_deletion_log;
drop table if exists private.id_document_cleanup_log;
drop table if exists private.id_document_cleanup;

-- 20270395's function, as it was
-- 20270391's private._story_file_send, verbatim
create or replace function private._story_file_send(p_key text)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_path text;
  v_url text;
  v_id bigint;
begin
  select storage_url into v_url from private.story_media_settings where id;
  -- a protected file isn't due: its 24 hours start when nothing protects it
  update private.story_file_cleanup q set next_attempt_at = now()
   where q.request_id is null and q.gave_up_at is null and q.next_attempt_at < now()
     and (exists (select 1 from stories s where s.media_path = q.media_path)
          or exists (select 1 from private.report_media_evidence e where e.media_path = q.media_path and e.released_at is null));
  for v_path in
    select q.media_path from private.story_file_cleanup q
     where q.request_id is null and q.gave_up_at is null and q.next_attempt_at <= now()
       and not exists (select 1 from stories s where s.media_path = q.media_path)
       and not exists (select 1 from private.report_media_evidence e where e.media_path = q.media_path and e.released_at is null)
     order by q.next_attempt_at, q.queued_at
     limit 200
  loop
    perform 1 from private.story_file_cleanup q
      where q.media_path = v_path and q.request_id is null and q.gave_up_at is null
      for update skip locked;
    continue when not found;
    continue when exists (select 1 from stories s where s.media_path = v_path)
               or exists (select 1 from private.report_media_evidence e where e.media_path = v_path and e.released_at is null);
    if private._story_file_path_unsafe(v_path) then
      perform private._story_file_failed(v_path, null, 'unsafe_path', 'unsafe_path', true);
      continue;
    end if;
    v_id := net.http_delete(
      url := v_url || '/object/stories/' || private._storage_url_path(v_path),
      headers := jsonb_build_object('Authorization', 'Bearer ' || p_key, 'apikey', p_key));
    update private.story_file_cleanup set request_id = v_id, sent_at = now() where media_path = v_path;
  end loop;
end;
$function$;
revoke all on function private._story_file_send(text) from public, anon, authenticated;

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

-- the bucket policies as they were (baseline insert, 20270348 select)
drop policy if exists "Users can upload their own verification photos" on storage.objects;
create policy "Users can upload their own verification photos" on storage.objects
  for insert to authenticated
  with check (((bucket_id = 'id-verification'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
alter policy "Users can view their own verification photos, admins can view a" on storage.objects
  using (((bucket_id = 'id-verification'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR check_is_admin(auth.uid()))));

drop function if exists public.admin_id_document_visible(text);
drop function if exists public.id_verification_open();

-- released id_submission holds stay as records; the type list allows them only if any exist
do $$ begin
  alter table private.legal_holds drop constraint if exists legal_holds_target_type_check;
  if not exists (select 1 from private.legal_holds where target_type = 'id_submission') then
    alter table private.legal_holds add constraint legal_holds_target_type_check
      check (target_type in ('report', 'content_removal', 'review_case'));
  else
    alter table private.legal_holds add constraint legal_holds_target_type_check
      check (target_type in ('report', 'content_removal', 'review_case', 'id_submission'));
  end if;
end $$;
drop function if exists private.id_submission_on_legal_hold(uuid);

drop trigger if exists id_submission_retention on public.id_verification_submissions;
drop function if exists private.id_submission_retention();
alter table public.id_verification_submissions drop column if exists documents_deleted_at, drop column if exists documents_delete_after;
drop table if exists private.id_document_settings;
