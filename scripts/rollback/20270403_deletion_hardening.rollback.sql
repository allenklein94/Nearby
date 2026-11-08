-- Rollback of 20270403. Back to 20270402 exactly. It refuses while an account hold, a logged purge, a kept cover or a waiting cover exists: export + get a decision first.
do $$
begin
  if exists (select 1 from private.legal_holds where target_type = 'account') then
    raise exception 'Account holds exist: export them and get a decision before rolling back';
  end if;
  if exists (select 1 from private.held_evidence_purge_log) then
    raise exception 'The purge log has entries: export it first';
  end if;
  if exists (select 1 from private.account_file_cleanup where reason = 'gathering_deleted') or exists (select 1 from private.account_file_cleanup where bucket_id = 'gathering-photos') then
    raise exception 'Gathering covers are waiting to be removed: let them finish first';
  end if;
  if exists (select 1 from private.legal_hold_files where bucket_id = 'gathering-photos') then
    raise exception 'A hold keeps a gathering cover: export it and get a decision first';
  end if;
end;
$$;
drop trigger if exists held_evidence_minimize on private.held_account_evidence;
drop trigger if exists a_queue_gathering_cover_files on public.gatherings;
drop trigger if exists held_evidence_purge_log_guard on private.held_evidence_purge_log;
drop trigger if exists legal_hold_object_guard on storage.objects;
create trigger legal_hold_object_guard before update or delete on storage.objects
  for each row when (old.bucket_id in ('profile-photos', 'chat-media', 'profile-audio'))
  execute function private._storage_object_hold_guard();
drop policy if exists "Admins can open held evidence files" on storage.objects;
create policy "Admins can open held evidence files" on storage.objects
  for select to authenticated
  using (bucket_id in ('profile-photos', 'chat-media', 'profile-audio') and public.admin_held_file_visible(id));
alter table private.legal_holds drop constraint if exists legal_holds_target_type_check;
alter table private.legal_holds add constraint legal_holds_target_type_check
  check (target_type = any (array['report'::text, 'content_removal'::text, 'review_case'::text, 'id_submission'::text]));
alter table private.account_file_cleanup drop constraint if exists account_file_cleanup_reason_check;
alter table private.account_file_cleanup add constraint account_file_cleanup_reason_check
  check (reason = any (array['account_deleted'::text, 'hold_ended'::text]));

-- the functions as 20270402 left them
CREATE OR REPLACE FUNCTION private.case_on_legal_hold(p_case uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
  select exists (select 1 from private.legal_holds h
                  where h.released_at is null and h.target_type = 'review_case' and h.target_id = p_case);
$function$;

CREATE OR REPLACE FUNCTION private.report_on_legal_hold(p_report uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION private.removal_on_legal_hold(p_removal uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
  select exists (select 1 from private.legal_holds h
                  where h.released_at is null
                    and ((h.target_type = 'content_removal' and h.target_id = p_removal)
                      or (h.target_type = 'report'
                          and h.target_id in (select c.report_id from private.content_removals c where c.id = p_removal))));
$function$;

CREATE OR REPLACE FUNCTION private.held_evidence_hold_purgeable(p_hold uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION private.hold_report_ids(p_type text, p_target uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'private', 'public'
AS $function$
  select case p_type
    when 'report' then array[p_target]
    when 'content_removal' then array(select c.report_id from private.content_removals c where c.id = p_target and c.report_id is not null)
    when 'review_case' then array(select l.report_id from private.account_review_case_reports l where l.case_id = p_target)
    else '{}'::uuid[] end;
$function$;

CREATE OR REPLACE FUNCTION private.hold_case_ids(p_type text, p_target uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'private', 'public'
AS $function$
  select array(
    select p_target where p_type = 'review_case'
    union
    select l.case_id from private.account_review_case_reports l
     where p_type in ('report', 'content_removal') and l.report_id = any(private.hold_report_ids(p_type, p_target)));
$function$;

CREATE OR REPLACE FUNCTION private.hold_is_about_account(p_type text, p_target uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'private', 'public'
AS $function$
  select case p_type
    when 'report' then private.report_names_account(p_target, p_user)
    when 'content_removal' then exists (select 1 from private.content_removals c where c.id = p_target
                                         and (c.owner_id = p_user or private.report_names_account(c.report_id, p_user)))
    when 'review_case' then exists (select 1 from private.account_review_cases c where c.id = p_target and c.subject_user = p_user)
    when 'id_submission' then exists (select 1 from public.id_verification_submissions s where s.id = p_target and s.user_id = p_user)
    else false end;
$function$;

CREATE OR REPLACE FUNCTION private.preserve_held_account_evidence(p_user uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION private.purge_ended_account_restrictions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform private.legal_hold_lock();
  delete from private.account_restrictions r
   where coalesce(r.lifted_at, r.expires_at) < now() - interval '12 months'
     and not (r.report_id is not null and private.report_on_legal_hold(r.report_id))
     and not (r.review_case_id is not null and private.case_on_legal_hold(r.review_case_id));
end;
$function$;

CREATE OR REPLACE FUNCTION private.purge_behavior_signals()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from private.behavior_events where kind = 'location_jump' and at < now() - interval '1 hour';
  delete from private.behavior_events where at < now() - interval '48 hours';
  delete from private.behavior_signals where last_at < now() - interval '30 days';
  delete from private.behavior_case_waiting where last_at < now() - interval '30 days';
  delete from private.behavior_case_overflow where day < (now() at time zone 'utc')::date - 90;
  delete from private.gathering_cancel_log where cancelled_at < now() - interval '30 days';
  delete from private.gathering_size_marks where marked_at < now() - interval '180 days';
$function$;

CREATE OR REPLACE FUNCTION private.purge_account_security_events()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
begin
  with d as (delete from private.account_security_events where created_at < now() - interval '12 months' returning 1)
  select count(*)::integer into n from d;
  delete from private.account_step_ups where created_at < now() - interval '1 day';
  delete from private.account_deletion_requests where status <> 'pending' and resolved_at < now() - interval '12 months';
  delete from private.account_recovery_holds where released_at < now() - interval '24 months';
  delete from private.account_recovery_audit where at < now() - interval '24 months';
  delete from private.account_recovery_marker;                         -- never needed after its transaction
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION private.purge_suspended_account_records()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION private.register_hold_files(p_hold uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION private._preserve_held_evidence_before_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION private.account_file_due(p_row private.account_file_cleanup)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
  select not exists (select 1 from auth.users u where u.id = p_row.account_id)
     and (p_row.claimed_at is null or p_row.claimed_at < now() - interval '15 minutes')
     and not private.object_under_hold(p_row.object_id);
$function$;

CREATE OR REPLACE FUNCTION public.admin_place_legal_hold(target_type_param text, target_id_param uuid, reason_param text, reference_param text DEFAULT NULL::text, scope_param text DEFAULT 'item'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION private.purge_held_account_evidence()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION private._suspended_record_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'UPDATE' or old.expires_at > now() then
    raise exception 'Suspended-account records are append-only' using errcode = '42501', hint = 'suspended_record_append_only';
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION private.account_security_notice(p_user uuid, p_kind text, p_detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into private.account_security_events (user_id, kind) values (p_user, p_kind);
  if p_kind = 'new_sign_in_elsewhere' then
    perform public._send_push(p_user, 'New sign-in to your Nearby account',
      'If this wasn''t you, open Settings and tap Sign Out to end every session, then contact your mobile carrier.',
      jsonb_build_object('type', 'account_security_notice'),
      'account_security:sign_in:' || p_user || ':' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'));
  elsif p_kind = 'phone_changed' then
    perform public._send_push(p_user, 'Your Nearby phone number was changed',
      'If this wasn''t you, contact Nearby support right away.',
      jsonb_build_object('type', 'account_security_notice'),
      'account_security:phone:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  elsif p_kind = 'deletion_scheduled' then
    perform public._send_push(p_user, 'Your Nearby account will be deleted',
      'It was signed out everywhere and will be permanently deleted on ' || coalesce(p_detail, 'the date shown') ||
      '. If this wasn''t you, contact Nearby support before then.',
      jsonb_build_object('type', 'account_security_notice'),
      'account_security:deletion:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  elsif p_kind = 'recovery_hold' then
    perform public._send_push(p_user, 'Your Nearby account is on hold',
      'We''re checking a security report about this account. Contact Nearby support if you have questions.',
      jsonb_build_object('type', 'account_security_notice'),
      'account_security:hold:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  elsif p_kind = 'account_recovered' then
    perform public._send_push(p_user, 'Your Nearby account was recovered',
      'Every session was ended. Sign in again with your phone number.',
      jsonb_build_object('type', 'account_security_notice'),
      'account_security:recovered:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
end;
$function$;

drop function if exists public.admin_held_evidence_retention_status();
drop function if exists private.held_evidence_purge_preview(interval);
drop function if exists private._queue_gathering_cover_files();
drop function if exists private.gathering_of_hold_owner(text, uuid);
drop function if exists private.hold_gathering_ids(text, uuid);
drop function if exists private.legal_hold_target_active(text, uuid);
drop function if exists private.account_on_legal_hold(uuid);
drop function if exists private._held_evidence_minimize();
drop function if exists private.held_payload_minimized(jsonb);
drop table if exists private.held_evidence_purge_log;
drop table if exists private.account_deletion_report_files;
