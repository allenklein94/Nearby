-- Account deletion keeps moderation evidence under an active legal hold (owner, 2026-11-08: mandatory pre-launch fix, staged).
-- Staged after 20270401; deploy only with its own approval; delete-account is redeployed right after it.
-- Before: deletion went through under a hold and cascaded away held review cases about the account (+ history), its pauses, its
-- suspension decisions and its behaviour signals; the hold row was left pointing at nothing.
-- PRODUCT_AUDIT/ACCOUNT_DELETION_AUDIT_RETENTION_2026-11-08.md
-- Now:
--   private.held_account_evidence   append-only copy, one row per (hold, record), no client access.
--   private.preserve_held_account_evidence(user)  copies what deletion would destroy, only when an active hold covers the account:
--     the hold's cases with this account as subject (+ members, history, photo references, report links), this account's rows in
--     its other held cases, a held ID submission's row, and all of the account's suspension decisions, pauses + history, and
--     behaviour signals. Never the profile, messages or anything else.
--   BEFORE DELETE triggers on public.profiles AND auth.users: the copy commits with the deletion or not at all, and a failure
--     aborts the deletion (no exception handler, on purpose). Both, because delete-account deletes the profile first, which clears
--     a report's person reference. Idempotent.
--   Shared legal-hold lock: a hold being placed waits for a running deletion and vice versa; deletions don't wait for each other.
--   No hold on the account: nothing is written and deletion is unchanged. The refusal is generic: nothing reveals a hold.
--   Retention: kept while any hold on the same target is active, then held_evidence_retention() after the latest release
--     (PROVISIONAL 12 months, matching the other moderation records; needs legal review), deleted by a daily job.
--   Two purge gaps that would still lose held evidence after a deletion:
--     - a hold on a review case now also keeps the reports linked to it (the words of the case; the link outlives the case through
--       the copy). report_on_legal_hold is the one place, so held photos and pauses follow.
--     - 20270374's suspended-account record is no longer purged at its expiry while a hold covers it (a decision naming a held
--       report, or the account's evidence in this store). An expired record stays out of number matching as before; once released
--       it goes on the next daily run. The record's dates are not changed.
-- Not changed: a hold never stops a deletion; no screen; no foreign key or constraint; 20270374's copy and its matching.
-- Requires 20270351, 20270357, 20270363, 20270368, 20270369, 20270393, 20270395, 20270399, 20270400.

create table if not exists private.held_account_evidence (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references private.legal_holds(id),   -- a hold is never deleted (20270395)
  account_id uuid not null,                                   -- the deleted account's former id; no foreign key, it must outlive it
  record_type text not null check (record_type in ('coverage', 'review_case', 'case_member', 'case_event', 'case_photo',
    'case_report_link', 'suspension_decision', 'pause', 'pause_event', 'behavior_signal', 'id_submission')),
  source_id text not null,
  payload jsonb not null,
  preserved_at timestamptz not null default now(),
  unique (hold_id, record_type, source_id)
);
create index if not exists held_account_evidence_account_idx on private.held_account_evidence (account_id);
revoke all on table private.held_account_evidence from public, anon, authenticated;

-- PROVISIONAL, one place to change it (legal review).
create or replace function private.held_evidence_retention()
returns interval
language sql
immutable
as $function$
  select interval '12 months';
$function$;
revoke all on function private.held_evidence_retention() from public, anon, authenticated;

create or replace function private.held_evidence_hold_purgeable(p_hold uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select h.released_at is not null
     and not case h.target_type
           when 'report' then private.report_on_legal_hold(h.target_id)
           when 'content_removal' then private.removal_on_legal_hold(h.target_id)
           when 'review_case' then private.case_on_legal_hold(h.target_id)
           when 'id_submission' then private.id_submission_on_legal_hold(h.target_id)
           else true
         end
     and (select max(x.released_at) from private.legal_holds x
           where x.target_type = h.target_type and x.target_id = h.target_id) < now() - private.held_evidence_retention()
    from private.legal_holds h where h.id = p_hold;
$function$;
revoke all on function private.held_evidence_hold_purgeable(uuid) from public, anon, authenticated;

-- Append-only: never changed; removed only once its hold's retention has passed.
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
  v_before bigint;
  v_after bigint;
begin
  if p_user is null then return 0; end if;
  -- the same key as private.legal_hold_lock(), shared: placing a hold excludes this, other deletions don't
  perform pg_advisory_xact_lock_shared(hashtextextended('nearby:legal_hold', 0));
  select count(*) into v_before from private.held_account_evidence where account_id = p_user;

  for h in
    select l.id, l.target_type, l.target_id from private.legal_holds l
     where l.released_at is null
       and (
         exists (select 1 from private.held_account_evidence e where e.hold_id = l.id and e.account_id = p_user)
         or (l.target_type = 'report' and (
               exists (select 1 from reports r where r.id = l.target_id and r.reported_id = p_user)
               or exists (select 1 from account_moderation_actions a where a.report_id = l.target_id and a.user_id = p_user)
               or exists (select 1 from private.account_restrictions x where x.report_id = l.target_id and x.user_id = p_user)))
         or (l.target_type = 'content_removal' and exists (
               select 1 from private.content_removals c left join reports r on r.id = c.report_id
                where c.id = l.target_id and (c.owner_id = p_user or r.reported_id = p_user)))
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
    values (h.id, p_user, 'coverage', p_user::text, jsonb_build_object('target_type', h.target_type, 'target_id', h.target_id))
    on conflict (hold_id, record_type, source_id) do nothing;

    -- which reports this hold holds, and which cases that brings in
    v_reports := case h.target_type
      when 'report' then array[h.target_id]
      when 'content_removal' then array(select c.report_id from private.content_removals c where c.id = h.target_id)
      else '{}'::uuid[] end;
    v_cases := array(
      select h.target_id where h.target_type = 'review_case'
      union
      select l.case_id from private.account_review_case_reports l where l.report_id = any(v_reports));

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

    -- the account's own moderation history
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'suspension_decision', a.id::text, to_jsonb(a) from account_moderation_actions a where a.user_id = p_user
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'pause', x.id::text, to_jsonb(x) from private.account_restrictions x where x.user_id = p_user
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'pause_event', e.id::text, to_jsonb(e) from private.account_restriction_events e where e.user_id = p_user
    on conflict (hold_id, record_type, source_id) do nothing;
    insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
    select h.id, p_user, 'behavior_signal', b.id::text, to_jsonb(b) from private.behavior_signals b where b.user_id = p_user
    on conflict (hold_id, record_type, source_id) do nothing;

    if h.target_type = 'id_submission' then
      insert into private.held_account_evidence (hold_id, account_id, record_type, source_id, payload)
      select h.id, p_user, 'id_submission', s.id::text, to_jsonb(s)
        from id_verification_submissions s where s.id = h.target_id and s.user_id = p_user
      on conflict (hold_id, record_type, source_id) do nothing;
    end if;
  end loop;

  select count(*) into v_after from private.held_account_evidence where account_id = p_user;
  return (v_after - v_before)::integer;
end;
$function$;
revoke all on function private.preserve_held_account_evidence(uuid) from public, anon, authenticated;

create or replace function private._preserve_held_evidence_before_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
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

-- delete-account calls this FIRST and stops if it fails, before it removes any file.
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

create or replace function private.purge_held_account_evidence()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.legal_hold_lock();
  delete from private.held_account_evidence e where private.held_evidence_hold_purgeable(e.hold_id);
end;
$function$;
revoke all on function private.purge_held_account_evidence() from public, anon, authenticated;

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

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-held-account-evidence') then
    perform cron.unschedule('purge-held-account-evidence');
  end if;
  perform cron.schedule('purge-held-account-evidence', '50 4 * * *', 'select private.purge_held_account_evidence()');
end;
$$;
