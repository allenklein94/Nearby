-- ID-document retention and deletion (owner, 2026-11-07: build the lifecycle now, staged; own deploy approval after 20270399).
-- Needs 20270349 (submission insert rules), 20270350 (id_verified), 20270391 (the Storage URL setting + the URL-safe path helpers),
-- 20270395 (legal holds).
--
-- The approved retention target (owner decision 2, 2026-10-27; PRODUCT_AUDIT/TRUST_SAFETY_FIXES_2026-10-27.md), unchanged here:
--   approved            -> the selfie + ID image are deleted 7 days after the decision
--   rejected            -> 30 days after the decision
--   never reviewed      -> automatically rejected after 60 days, and its images deleted at once
--   orphan uploads      -> a file in the bucket that no submission names is deleted after 24 hours
--   account deletion    -> the whole folder, on the job's next run (hourly)
-- The submission ROW stays as the record (status, dates, who reviewed); only the images go. id_verified is unaffected.
--
-- Deletion is confirmed, never assumed (20270391's rule): a file leaves the queue only when Storage answers success / not-found AND
-- no storage.objects row is left; any other answer keeps it, with bounded retries (10, then an admin re-arms it), a log row per
-- failure and one private admin push a day (counts only). No path is ever sent unless it is safe in a URL.
--
-- Never touched by the job: a file named by a PENDING submission, or one still inside its retention period, or one whose
-- submission is under a legal hold (target 'id_submission', placed by an admin with a written reason through
-- admin_place_legal_hold; nothing is ever held automatically; a hold outlives the account's deletion). Rechecked per file at send
-- time under the submission's row lock, so a hold that lands after the list was read still stops the DELETE; a DELETE already
-- handed to pg_net can't be recalled, and a hold placed then says 'deleting', never 'held'.
--
-- New uploads are REFUSED until an admin migration turns them on (private.id_document_settings.uploads_enabled, default false,
-- no client access): the bucket's insert policy and the submission insert both check it. Turning it on needs its own approval.
--
-- Access: a person reads only their own folder; an admin reads a file only while a pending submission names it (to review it) or
-- its submission is on legal hold. Clients still have no UPDATE / DELETE on the bucket.
--
-- Audit without content: private.id_document_deletion_log keeps submission id, which image, why, queued and deleted times. Never
-- a path, a user id or an image. It has no purge (no period was approved: the owner decides).

-- ===== settings =====
create table if not exists private.id_document_settings (
  id boolean primary key default true check (id),
  uploads_enabled boolean not null default false
);
insert into private.id_document_settings (id) values (true) on conflict (id) do nothing;
revoke all on private.id_document_settings from public, anon, authenticated;

-- ===== the row records when its images may go and when they went =====
alter table public.id_verification_submissions
  add column if not exists documents_delete_after timestamptz,
  add column if not exists documents_deleted_at timestamptz;
-- clients never set these (the column grants never included them; inserts are forced below)
revoke update (documents_delete_after, documents_deleted_at) on public.id_verification_submissions from public, anon, authenticated;

-- Existing rows (production: 0 on 2026-11-07): a decided one gets its period from its decision, a pending one keeps none.
update public.id_verification_submissions
   set documents_delete_after = case when status = 'approved' then coalesce(reviewed_at, submitted_at, now()) + interval '7 days'
                                     else coalesce(reviewed_at, submitted_at, now()) + interval '30 days' end
 where status <> 'pending' and documents_delete_after is null;

-- The ONE retention rule. Runs on every insert / update, whoever writes (the review function, an admin's direct update, the job).
create or replace function private.id_submission_retention()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if not coalesce((select s.uploads_enabled from private.id_document_settings s where s.id), false) then
      raise exception 'ID verification isn''t available right now' using errcode = '42501', hint = 'id_verification_paused';
    end if;
    new.documents_delete_after := null;
    new.documents_deleted_at := null;
    return new;
  end if;
  new.documents_deleted_at := old.documents_deleted_at;  -- only the job sets it (below, with the trigger bypassed by a flag)
  if current_setting('nearby.id_documents_confirm', true) = 'on' then
    new.documents_deleted_at := now();
  end if;
  if new.status is distinct from old.status then
    new.documents_delete_after := case
      when new.status = 'pending' then null
      when current_setting('nearby.id_auto_reject', true) = 'on' then now()
      when new.status = 'approved' then now() + interval '7 days'
      else now() + interval '30 days' end;
  else
    new.documents_delete_after := old.documents_delete_after;
  end if;
  return new;
end;
$function$;
revoke all on function private.id_submission_retention() from public, anon, authenticated;

drop trigger if exists id_submission_retention on public.id_verification_submissions;
create trigger id_submission_retention before insert or update on public.id_verification_submissions
  for each row execute function private.id_submission_retention();

-- ===== uploads closed + access restricted =====
create or replace function public.id_verification_open()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select s.uploads_enabled from private.id_document_settings s where s.id), false);
$function$;
revoke all on function public.id_verification_open() from public, anon;
grant execute on function public.id_verification_open() to authenticated;

alter table private.legal_holds drop constraint if exists legal_holds_target_type_check;
alter table private.legal_holds add constraint legal_holds_target_type_check
  check (target_type in ('report', 'content_removal', 'review_case', 'id_submission'));
create or replace function private.id_submission_on_legal_hold(p_submission uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select p_submission is not null and exists (select 1 from private.legal_holds h
                  where h.released_at is null and h.target_type = 'id_submission' and h.target_id = p_submission);
$function$;
revoke all on function private.id_submission_on_legal_hold(uuid) from public, anon, authenticated;

-- An admin may read an ID file only while a pending submission names it, or its submission is on legal hold.
create or replace function public.admin_id_document_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and check_is_admin(auth.uid())
     and exists (select 1 from id_verification_submissions s
                  where p_name in (s.selfie_path, s.id_photo_path)
                    and (s.status = 'pending' or private.id_submission_on_legal_hold(s.id)));
$function$;

drop policy if exists "Users can upload their own verification photos" on storage.objects;
create policy "Users can upload their own verification photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'id-verification' and (storage.foldername(name))[1] = (auth.uid())::text
              and public.id_verification_open());

alter policy "Users can view their own verification photos, admins can view a" on storage.objects
  using (bucket_id = 'id-verification'
         and ((storage.foldername(name))[1] = (auth.uid())::text or public.admin_id_document_visible(name)));

-- ===== legal holds on an ID submission =====

revoke all on function public.admin_id_document_visible(text) from public, anon;
grant execute on function public.admin_id_document_visible(text) to authenticated;

-- 20270395's function, + 'id_submission' (the submission row must still exist; its files are kept while held, also after the
-- account is deleted). Everything else is unchanged.
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

-- ===== the deletion queue =====
create table if not exists private.id_document_cleanup (
  object_path text primary key,
  submission_id uuid,                                -- the submission that named it; null = an orphan upload
  image text not null check (image in ('selfie', 'id_photo', 'orphan')),
  reason text not null check (reason in ('approved_7d', 'rejected_30d', 'unreviewed_60d', 'orphan_24h', 'account_deleted', 'submission_deleted')),
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  request_id bigint,
  sent_at timestamptz,
  last_status integer,
  last_error text,
  last_failed_at timestamptz,
  gave_up_at timestamptz
);
revoke all on private.id_document_cleanup from public, anon, authenticated;

create table if not exists private.id_document_cleanup_log (
  id bigint generated always as identity primary key,
  object_path text,
  attempt integer,
  status_code integer,
  kind text not null,
  error text,
  gave_up boolean not null default false,
  admin_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists id_document_cleanup_log_created_idx on private.id_document_cleanup_log (created_at);
revoke all on private.id_document_cleanup_log from public, anon, authenticated;
revoke all on sequence private.id_document_cleanup_log_id_seq from public, anon, authenticated;

-- The audit record of every confirmed deletion: no path, no user id, no image.
create table if not exists private.id_document_deletion_log (
  id bigint generated always as identity primary key,
  submission_id uuid,
  image text not null,
  reason text not null,
  queued_at timestamptz not null,
  deleted_at timestamptz not null default now()
);
revoke all on private.id_document_deletion_log from public, anon, authenticated;
revoke all on sequence private.id_document_deletion_log_id_seq from public, anon, authenticated;

-- A file the job must not touch right now.
create or replace function private.id_document_protected(p_path text, p_submission uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select private.id_submission_on_legal_hold(p_submission)
      or exists (select 1 from public.id_verification_submissions s
                  where p_path in (s.selfie_path, s.id_photo_path)
                    and (s.status = 'pending' or s.documents_delete_after is null or s.documents_delete_after > now()
                         or private.id_submission_on_legal_hold(s.id)));
$function$;
revoke all on function private.id_document_protected(text, uuid) from public, anon, authenticated;

-- A submission row deleted (its account deleted, or by an admin): its files are queued; the job deletes them unless held.
create or replace function private._queue_id_submission_files()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into private.id_document_cleanup (object_path, submission_id, image, reason)
  values (old.selfie_path, old.id, 'selfie', 'submission_deleted'), (old.id_photo_path, old.id, 'id_photo', 'submission_deleted')
  -- whichever trigger ran first (this one or the account's folder sweep), the file keeps its submission, so a hold still applies
  on conflict (object_path) do update set submission_id = excluded.submission_id, image = excluded.image
   where private.id_document_cleanup.submission_id is null;
  return null;
end;
$function$;
revoke all on function private._queue_id_submission_files() from public, anon, authenticated;
drop trigger if exists queue_id_submission_files on public.id_verification_submissions;
create trigger queue_id_submission_files after delete on public.id_verification_submissions
  for each row execute function private._queue_id_submission_files();

-- An account deleted: its whole folder (incl. uploads no submission ever named). The submission rows' own trigger (cascade) has
-- usually queued their two files already; those keep their submission id, so a legal hold still protects them.
create or replace function private._queue_id_folder_on_account_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into private.id_document_cleanup (object_path, submission_id, image, reason)
  select o.name, null, 'orphan', 'account_deleted'
    from storage.objects o
   where o.bucket_id = 'id-verification' and (storage.foldername(o.name))[1] = old.id::text
  on conflict (object_path) do nothing;
  return null;
end;
$function$;
revoke all on function private._queue_id_folder_on_account_delete() from public, anon, authenticated;
drop trigger if exists queue_id_folder_on_account_delete on public.profiles;
create trigger queue_id_folder_on_account_delete after delete on public.profiles
  for each row execute function private._queue_id_folder_on_account_delete();

create or replace function private._id_document_failed(p_path text, p_status integer, p_kind text, p_error text, p_give_up boolean default false)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_attempts integer;
  v_give_up boolean;
begin
  select attempts + 1 into v_attempts from private.id_document_cleanup where object_path = p_path;
  v_give_up := p_give_up or v_attempts >= 10;
  update private.id_document_cleanup
     set attempts = v_attempts, request_id = null, sent_at = null, last_status = p_status, last_error = left(p_error, 300),
         last_failed_at = now(), gave_up_at = case when v_give_up then now() end,
         next_attempt_at = now() + make_interval(hours => least(24, 2 ^ (v_attempts - 1))::integer) - interval '5 minutes'
   where object_path = p_path;
  insert into private.id_document_cleanup_log (object_path, attempt, status_code, kind, error, gave_up)
  values (p_path, v_attempts, p_status, p_kind, left(p_error, 300), v_give_up);
end;
$function$;
revoke all on function private._id_document_failed(text, integer, text, text, boolean) from public, anon, authenticated;

-- Reads the answers. Removing the queue row here (with its audit row) is the only way a file leaves the queue.
create or replace function private._id_document_read_responses()
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  r record;
  v_code integer;
  v_kind text;
begin
  for r in
    select q.object_path, q.submission_id, q.image, q.reason, q.queued_at, q.sent_at,
           h.id as response_id, h.status_code, h.timed_out, h.error_msg, h.content
      from private.id_document_cleanup q
      left join net._http_response h on h.id = q.request_id
     where q.request_id is not null
       for update of q skip locked
  loop
    if r.response_id is null then
      if r.sent_at < now() - interval '2 hours' then
        perform private._id_document_failed(r.object_path, null, 'no_response', 'no_response');
      end if;
      continue;
    end if;
    v_code := r.status_code;
    if v_code = 400 then
      v_code := coalesce(substring(r.content from '"statusCode"\s*:\s*"?(\d{3})')::integer, v_code);
    end if;
    if (v_code between 200 and 299 or v_code = 404)
       and not exists (select 1 from storage.objects o where o.bucket_id = 'id-verification' and o.name = r.object_path) then
      delete from private.id_document_cleanup where object_path = r.object_path;
      insert into private.id_document_deletion_log (submission_id, image, reason, queued_at)
      values (r.submission_id, r.image, r.reason, r.queued_at);
      -- both images of a still-existing submission gone = the row says so
      if r.submission_id is not null then
        perform set_config('nearby.id_documents_confirm', 'on', true);
        update public.id_verification_submissions s set documents_deleted_at = now()
         where s.id = r.submission_id and s.documents_deleted_at is null
           and not exists (select 1 from private.id_document_cleanup q where q.submission_id = s.id)
           and not exists (select 1 from storage.objects o where o.bucket_id = 'id-verification' and o.name in (s.selfie_path, s.id_photo_path));
        perform set_config('nearby.id_documents_confirm', 'off', true);
      end if;
      continue;
    end if;
    v_kind := case
      when v_code is null then case when r.timed_out or r.error_msg ilike '%timeout%' or r.error_msg ilike '%timed out%' then 'timeout' else 'network' end
      when v_code between 200 and 299 or v_code = 404 then 'still_present'
      when v_code in (401, 403) then 'refused'
      when v_code = 429 then 'rate_limited'
      when v_code >= 500 then 'server'
      else 'other' end;
    perform private._id_document_failed(r.object_path, r.status_code, v_kind, coalesce(r.error_msg, r.content, v_kind));
  end loop;
end;
$function$;
revoke all on function private._id_document_read_responses() from public, anon, authenticated;

create or replace function private._id_document_send(p_key text)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_path text;
  v_sub uuid;
  v_url text;
  v_id bigint;
begin
  select storage_url into v_url from private.story_media_settings where id;
  for v_path, v_sub in
    select q.object_path, q.submission_id from private.id_document_cleanup q
     where q.request_id is null and q.gave_up_at is null and q.next_attempt_at <= now()
     order by q.next_attempt_at, q.queued_at
     limit 200
  loop
    -- The submission row first (share lock): a legal hold takes it FOR UPDATE, so a hold and a send never interleave. A hold
    -- still committing = skipped this run (no wait, no deadlock); a send first = the hold waits for this commit and then sees
    -- the request id ("deleting"). The queue has no link to the submission row, so without this the hold answered "held" while
    -- the DELETE went out (scripts/replay/id-document-concurrency.js, both orders). A submission already deleted has no row.
    if v_sub is not null and exists (select 1 from public.id_verification_submissions s where s.id = v_sub) then
      perform 1 from public.id_verification_submissions s where s.id = v_sub for share skip locked;
      continue when not found;
    end if;
    perform 1 from private.id_document_cleanup q
      where q.object_path = v_path and q.request_id is null and q.gave_up_at is null
      for update skip locked;
    continue when not found;
    -- rechecked here, under both locks: a hold or a new pending submission that landed after the list was read wins
    continue when private.id_document_protected(v_path, v_sub);
    if private._story_file_path_unsafe(v_path) then
      perform private._id_document_failed(v_path, null, 'unsafe_path', 'unsafe_path', true);
      continue;
    end if;
    v_id := net.http_delete(
      url := v_url || '/object/id-verification/' || private._storage_url_path(v_path),
      headers := jsonb_build_object('Authorization', 'Bearer ' || p_key, 'apikey', p_key));
    update private.id_document_cleanup set request_id = v_id, sent_at = now() where object_path = v_path;
  end loop;
end;
$function$;
revoke all on function private._id_document_send(text) from public, anon, authenticated;

-- Unprotected files that aren't going away (given up, 3+ failures, or due and unsent for 24 hours).
create or replace function private._id_documents_failing()
returns setof private.id_document_cleanup
language sql
volatile
set search_path to 'public'
as $function$
  select q.* from private.id_document_cleanup q
   where (q.gave_up_at is not null or q.attempts >= 3 or (q.request_id is null and q.next_attempt_at < now() - interval '24 hours'))
     and not private.id_document_protected(q.object_path, q.submission_id);
$function$;
revoke all on function private._id_documents_failing() from public, anon, authenticated;

-- Queues what is due. Never a pending submission's files, never a held submission's.
create or replace function private._id_document_queue_due()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- never reviewed for 60 days: rejected by the system (no reviewer), its images due at once
  perform set_config('nearby.id_auto_reject', 'on', true);
  update id_verification_submissions set status = 'rejected', reviewed_at = now(), reviewed_by = null
   where status = 'pending' and submitted_at < now() - interval '60 days';
  perform set_config('nearby.id_auto_reject', 'off', true);

  insert into private.id_document_cleanup (object_path, submission_id, image, reason)
  select x.path, s.id, x.image,
         case when s.status = 'approved' then 'approved_7d'
              when s.reviewed_by is null and s.documents_delete_after = s.reviewed_at then 'unreviewed_60d'
              else 'rejected_30d' end
    from id_verification_submissions s
    cross join lateral (values (s.selfie_path, 'selfie'), (s.id_photo_path, 'id_photo')) as x(path, image)
   where s.status <> 'pending' and s.documents_deleted_at is null
     and s.documents_delete_after is not null and s.documents_delete_after <= now()
     and not private.id_submission_on_legal_hold(s.id)
     and exists (select 1 from storage.objects o where o.bucket_id = 'id-verification' and o.name = x.path)
  on conflict (object_path) do nothing;

  -- a decided submission whose files are already gone (never uploaded, or deleted earlier): recorded as deleted
  perform set_config('nearby.id_documents_confirm', 'on', true);
  update id_verification_submissions s set documents_deleted_at = now()
   where s.status <> 'pending' and s.documents_deleted_at is null
     and s.documents_delete_after is not null and s.documents_delete_after <= now()
     and not private.id_submission_on_legal_hold(s.id)
     and not exists (select 1 from private.id_document_cleanup q where q.submission_id = s.id)
     and not exists (select 1 from storage.objects o where o.bucket_id = 'id-verification' and o.name in (s.selfie_path, s.id_photo_path));
  perform set_config('nearby.id_documents_confirm', 'off', true);

  -- uploads no submission names, older than 24 hours
  insert into private.id_document_cleanup (object_path, submission_id, image, reason)
  select o.name, null, 'orphan', 'orphan_24h'
    from storage.objects o
   where o.bucket_id = 'id-verification' and o.created_at < now() - interval '24 hours'
     and not exists (select 1 from id_verification_submissions s where o.name in (s.selfie_path, s.id_photo_path))
  on conflict (object_path) do nothing;
end;
$function$;
revoke all on function private._id_document_queue_due() from public, anon, authenticated;

create or replace function private._id_document_alert()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_failing integer;
  r record;
begin
  select count(*) into v_failing from private._id_documents_failing();
  if v_failing = 0 then
    return;
  end if;
  for r in select p.id from profiles p where p.is_admin is true and p.suspended_at is null loop
    perform _send_push(
      r.id,
      'ID document cleanup needs attention',
      case when v_failing = 1 then '1 ID image couldn''t be deleted yet.' else v_failing || ' ID images couldn''t be deleted yet.' end,
      jsonb_build_object('type', 'admin_report_received', 'kind', 'id_document_cleanup'),
      'id_document_cleanup:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD') || ':' || r.id);
  end loop;
end;
$function$;
revoke all on function private._id_document_alert() from public, anon, authenticated;

-- The hourly job. Each step in its own block, so one failure never stops the others; errors are logged.
create or replace function private.run_id_document_retention()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  delete from private.id_document_cleanup_log where created_at < now() - interval '90 days';
  begin
    if pg_try_advisory_xact_lock(hashtext('nearby.id_document_cleanup')) then
      perform private._id_document_read_responses();
      perform private._id_document_queue_due();
      if service_key is not null then
        perform private._id_document_send(service_key);
      end if;
    end if;
  exception when others then
    insert into private.id_document_cleanup_log (kind, error) values ('job_error', left(sqlerrm, 300));
  end;
  begin
    perform private._id_document_alert();
  exception when others then
    insert into private.id_document_cleanup_log (kind, error) values ('alert_error', left(sqlerrm, 300));
  end;
end;
$function$;
revoke all on function private.run_id_document_retention() from public, anon, authenticated;

select cron.schedule('id-document-retention', '41 * * * *', 'select private.run_id_document_retention();');

-- Counts only, never a path.
create or replace function public.admin_id_document_cleanup_status()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  select jsonb_build_object(
    'queued', (select count(*) from private.id_document_cleanup),
    'failing', count(*),
    'gave_up', count(*) filter (where f.gave_up_at is not null),
    'oldest_queued_at', min(f.queued_at),
    'last_failed_at', max(f.last_failed_at))
    into v_result
    from private._id_documents_failing() f;
  return v_result;
end;
$function$;
revoke all on function public.admin_id_document_cleanup_status() from public, anon;
grant execute on function public.admin_id_document_cleanup_status() to authenticated;

create or replace function public.admin_retry_id_document_cleanup()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_count integer;
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  with armed as (
    update private.id_document_cleanup
       set attempts = 0, gave_up_at = null, next_attempt_at = now()
     where gave_up_at is not null and not private._story_file_path_unsafe(object_path)
     returning object_path
  ), logged as (
    insert into private.id_document_cleanup_log (object_path, kind, admin_id)
    select a.object_path, 'admin_retry', v_admin from armed a returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$function$;
revoke all on function public.admin_retry_id_document_cleanup() from public, anon;
grant execute on function public.admin_retry_id_document_cleanup() to authenticated;
