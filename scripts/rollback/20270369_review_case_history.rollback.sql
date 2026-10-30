-- Rollback for migration 20270369 (review case history). Run BEFORE rolling back 20270368 and earlier (newest first).
-- WARNING: deletes every case's history (events), report links and every case opened from a report; closed cases keep
-- only their latest decision (as before 20270369). Export first if the history must be kept:
--   select * from private.account_review_case_events;  select * from private.account_review_case_reports;
select cron.unschedule(jobid) from cron.job where jobname = 'purge-account-review-cases';
drop policy if exists "Admins can view photos under review" on storage.objects;
drop function if exists public.admin_review_photo_visible(uuid);
drop function if exists public.admin_get_account_review_case(uuid);
drop function if exists public.admin_reopen_account_review_case(uuid, text);
drop function if exists public.admin_add_account_review_note(uuid, text);
drop function if exists public.admin_record_case_external_check(uuid, text, text, text, text);
drop function if exists public.admin_open_case_from_report(uuid, text);
drop function if exists private.purge_account_review_cases();
drop trigger if exists review_case_opened on private.account_review_cases;
drop trigger if exists review_case_member_mark on private.account_review_case_members;
drop trigger if exists review_case_member_added on private.account_review_case_members;
drop trigger if exists review_case_event_guard on private.account_review_case_events;
drop function if exists private._review_case_opened();
drop function if exists private._review_case_member_mark();
drop function if exists private._review_case_member_added();
drop function if exists private._review_case_event_guard();
drop table if exists private.account_review_case_events;
drop table if exists private.account_review_case_reports;
delete from private.account_review_cases where signal = 'report';
delete from private.account_review_case_photos cp using private.account_review_cases c where c.id = cp.case_id and c.signal = 'identical_photo';
drop index if exists private.account_review_cases_one_open_report;
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null) and (signal = 'behavior') = (subject_user is not null));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern'));
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior'));
alter table private.account_review_cases drop column if exists review_due_at;
alter table private.account_review_cases drop column if exists new_evidence_at;
alter table private.account_review_case_members drop column if exists after_close;
-- the functions as before 20270369 (verbatim from their migrations)
-- private.evaluate_photo_fingerprint(text): back to 20270357
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
begin
  select * into s from private.account_signal_settings where id;
  if s.duplicate_photo_min_accounts is null and s.similar_name_min_similarity is null then return; end if;
  select array_agg(distinct f.user_id) into v_users from private.photo_fingerprints f
   where f.sha256 = p_sha256 and private.photo_object_in_use(f.user_id, f.object_id);
  if coalesce(cardinality(v_users), 0) < 2 then return; end if;

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

  select id into v_case from private.account_review_cases where sha256 = p_sha256 and status = 'open' for update;
  if v_case is null then
    insert into private.account_review_cases (signal, sha256, reason) values ('identical_photo', p_sha256, v_reason)
      on conflict (sha256) where status = 'open' do nothing
      returning id into v_case;
    if v_case is null then
      select id into v_case from private.account_review_cases where sha256 = p_sha256 and status = 'open';
    end if;
  else
    update private.account_review_cases
       set updated_at = now(),
           reason = case when v_reason = 'many_accounts' then 'many_accounts' else reason end
     where id = v_case;
  end if;
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;
end;
$function$;
revoke all on function private.evaluate_photo_fingerprint(text) from public, anon, authenticated;
-- private.evaluate_similar_photo(uuid): back to 20270368
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
  -- one evaluation at a time, so two similar uploads at the same moment can't open two cases for the same photos
  perform pg_advisory_xact_lock(hashtext('similar_photo_cases'));
  -- byte-identical copies are 20270357's (identical_photo); this case is only about copies that differ
  select f.sha256 into v_sha from private.photo_fingerprints f where f.object_id = p_object;
  select array_agg(x.object_id), array_agg(distinct x.user_id) into v_objects, v_users
    from (select p_object as object_id, v_owner as user_id
          union select m.object_id, m.user_id from private.similar_photo_objects(p_object) m
                 where v_sha is null or not exists (select 1 from private.photo_fingerprints f
                                                     where f.object_id = m.object_id and f.sha256 = v_sha)) x;
  if coalesce(cardinality(v_users), 0) < 2 then return; end if;

  -- a photo already in a similar-photo case never opens a second one: the open case grows; a closed one stays closed
  select c.id, c.status into v_case, v_status
    from private.account_review_cases c
   where c.signal = 'similar_photo'
     and exists (select 1 from private.account_review_case_photos cp where cp.case_id = c.id and cp.object_id = any(v_objects))
   order by (c.status = 'open') desc, c.opened_at desc
   limit 1;
  if v_case is not null and v_status <> 'open' then return; end if;

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
  if v_case is null and v_reason is null then return; end if;

  if v_case is null then
    insert into private.account_review_cases (signal, reason) values ('similar_photo', v_reason) returning id into v_case;
  else
    update private.account_review_cases
       set updated_at = now(),
           reason = case when v_reason = 'many_accounts' then 'many_accounts' else reason end
     where id = v_case;
  end if;
  insert into private.account_review_case_photos (case_id, object_id, user_id)
    select v_case, o.object_id, h.user_id
      from unnest(v_objects) o(object_id)
      join lateral (select user_id from private.photo_perceptual_hashes where object_id = o.object_id limit 1) h on true
    on conflict do nothing;
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;
end;
$function$;
revoke all on function private.evaluate_similar_photo(uuid) from public, anon, authenticated;
-- private.behavior_evaluate_case(uuid): back to 20270363
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
begin
  select * into s from private.behavior_signal_settings where id;
  if not s.review_cases_enabled or s.case_window_hours is null or s.max_new_cases_per_day is null then return; end if;
  select array_agg(distinct kind),
         jsonb_agg(jsonb_build_object('kind', kind, 'first_at', first_at, 'last_at', last_at, 'hits', hits) || evidence
                   order by last_at desc)
    into v_kinds, v_evidence
    from private.behavior_signals
   where user_id = p_user and last_at > now() - make_interval(hours => s.case_window_hours);
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
  -- flood protection: a fixed number of new behaviour cases a day for the whole queue
  perform pg_advisory_xact_lock(hashtext('behavior_case_queue'));
  if (select count(*) from private.account_review_cases
       where signal = 'behavior' and opened_at > now() - interval '24 hours') >= s.max_new_cases_per_day then
    -- queue full: never silent. Count it for the day and keep the person waiting (admins see both).
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
-- public.admin_list_account_review_cases(boolean): back to 20270363
create or replace function public.admin_list_account_review_cases(include_closed_param boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'signal', c.signal, 'reason', c.reason, 'status', c.status,
             'opened_at', c.opened_at, 'updated_at', c.updated_at, 'closed_at', c.closed_at,
             'outcome', c.outcome, 'note', c.note, 'evidence', c.evidence,
             'members', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'user_id', m.user_id, 'display_name', p.display_name,
                                  'suspended', p.suspended_at is not null, 'added_at', m.added_at) order by m.added_at), '[]'::jsonb)
                           from private.account_review_case_members m left join profiles p on p.id = m.user_id
                          where m.case_id = c.id))
           order by (c.status = 'open') desc, c.updated_at desc)
      from private.account_review_cases c
     where include_closed_param or c.status = 'open'), '[]'::jsonb);
end;
$function$;
revoke all on function public.admin_list_account_review_cases(boolean) from public, anon;
grant execute on function public.admin_list_account_review_cases(boolean) to authenticated;
-- public.admin_close_account_review_case(uuid, text, text): back to 20270357
create or replace function public.admin_close_account_review_case(case_id_param uuid, outcome_param text, note_param text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_status text;
  v_note text := nullif(btrim(coalesce(note_param, '')), '');
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if outcome_param not in ('no_action', 'action_taken') then
    raise exception 'Choose an outcome' using errcode = '22023', hint = 'case_outcome';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters' using errcode = '22023', hint = 'case_note_length';
  end if;
  select status into v_status from private.account_review_cases where id = case_id_param for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('already', true);
  end if;
  update private.account_review_cases
     set status = 'closed', closed_at = now(), closed_by = v_admin, outcome = outcome_param, note = v_note, updated_at = now()
   where id = case_id_param;
  return jsonb_build_object('already', false);
end;
$function$;
revoke all on function public.admin_close_account_review_case(uuid, text, text) from public, anon;
grant execute on function public.admin_close_account_review_case(uuid, text, text) to authenticated;
drop function if exists private.require_admin();
drop function if exists private.clean_case_text(text, integer, text);
