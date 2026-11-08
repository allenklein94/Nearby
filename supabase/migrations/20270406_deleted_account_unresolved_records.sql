-- Deleting an account doesn't erase an unresolved report, an open case or an active pause (owner, 2026-11-08). Extends the suspended-account retention
-- (20270374) to those accounts. STAGED after 20270405; own deploy approval; 90 days is a PROPOSED default, subject to legal approval (deploy gate).
--
-- Without this: such an account kept no number key, no device key and no link between its reports; a case about it vanished with its history; its pauses went.
-- With it, on deletion, ONLY when something is unresolved at that moment, one record keeps:
--   the former account id (a pseudonym: nothing else in the database names it once the account is gone), a keyed hash of the confirmed number
--   (20270374's key, never the number), the device keys already held (only exists if the shared-device detector is on), the ids of the unresolved reports and
--   open cases, and what its active pauses were. No name, email, photo, message, gathering or attendee. The reports keep what they already kept; nothing is copied from them.
--   An open case about the account stays open, for an admin to finish. A closed case goes, as before. Attendee lists are NOT kept: other people's
--   information isn't retained because a host was reported (owner).
-- Coming back: the same confirmed number (or a device key, once that detector is on) opens ONE private admin-review case about the new account. It never
--   blocks sign-up, never restricts, never tells the person, never decides anything: numbers get reassigned and families share phones.
-- Expiry: 90 days after deletion the number and device keys go, then the record and any case kept with it, unless a legal hold covers them (then the
--   keys still go and the rest waits for the hold). The daily purge says what it did in an append-only log with no account ids.
-- Never blocks a deletion: a failure here is recorded privately and the deletion carries on.
-- A hold's own evidence copy (20270402) is separate and unchanged.

-- ── settings, records, log ──
create table if not exists private.unresolved_account_settings (
  id boolean primary key default true check (id),
  retention interval not null default interval '90 days' check (retention >= interval '1 day' and retention <= interval '1 year'),
  reference text
);
insert into private.unresolved_account_settings (id) values (true) on conflict (id) do nothing;

-- SQL only, with the decision's reference. New records use it; a record keeps the date it was given.
create or replace function private.set_unresolved_account_retention(p_retention interval, p_reference text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if p_reference is null or length(btrim(p_reference)) < 3 then
    raise exception 'A retention period needs the decision''s reference' using errcode = '22023';
  end if;
  update private.unresolved_account_settings set retention = p_retention, reference = btrim(p_reference) where id;
end;
$$;

create table if not exists private.unresolved_account_records (
  id uuid primary key default gen_random_uuid(),
  former_account_id uuid not null unique,  -- no FK: the account is gone
  phone_key bytea check (phone_key is null or length(phone_key) = 32),
  reasons text[] not null check (cardinality(reasons) >= 1 and reasons <@ array['open_report', 'open_case', 'active_pause']),
  report_ids uuid[] not null default '{}',
  case_ids uuid[] not null default '{}',
  pauses jsonb not null default '[]' check (jsonb_typeof(pauses) = 'array'),
  released_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > released_at)
);
create index if not exists unresolved_account_records_key_idx on private.unresolved_account_records (phone_key) where phone_key is not null;
create index if not exists unresolved_account_records_expiry_idx on private.unresolved_account_records (expires_at);

create table if not exists private.unresolved_account_device_keys (
  token_key bytea not null check (length(token_key) = 32),
  record_id uuid not null references private.unresolved_account_records(id) on delete cascade,
  primary key (token_key, record_id)
);

create table if not exists private.unresolved_account_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  record_id uuid not null,   -- no FK and no account id: this outlives the record, and says nothing about who
  kind text not null check (kind in ('kept', 'returned_number', 'returned_device', 'viewed', 'keys_removed', 'purged')),
  actor uuid,
  detail jsonb not null default '{}'
);
revoke all on private.unresolved_account_settings, private.unresolved_account_records, private.unresolved_account_device_keys, private.unresolved_account_events
  from public, anon, authenticated;

create or replace function private._unresolved_record_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.expires_at <= now() and new.phone_key is null and (to_jsonb(new) - 'phone_key') = (to_jsonb(old) - 'phone_key') then
    return new;
  end if;
  if tg_op = 'UPDATE' or old.expires_at > now() then
    raise exception 'These records are append-only until they expire' using errcode = '42501', hint = 'unresolved_record_append_only';
  end if;
  return old;
end;
$$;
drop trigger if exists unresolved_record_guard on private.unresolved_account_records;
create trigger unresolved_record_guard before update or delete on private.unresolved_account_records
  for each row execute function private._unresolved_record_guard();

create or replace function private._unresolved_event_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.at < now() - interval '12 months' and not exists (select 1 from private.unresolved_account_records r where r.id = old.record_id) then
    return old;
  end if;
  raise exception 'This log is append-only' using errcode = '42501', hint = 'unresolved_event_append_only';
end;
$$;
drop trigger if exists unresolved_event_guard on private.unresolved_account_events;
create trigger unresolved_event_guard before update or delete on private.unresolved_account_events
  for each row execute function private._unresolved_event_guard();

alter table private.suspended_number_failures drop constraint if exists suspended_number_failures_step_check;
alter table private.suspended_number_failures add constraint suspended_number_failures_step_check
  check (step in ('retain', 'queue', 'retain_unresolved', 'match_unresolved'));

-- ── a case outlives its subject while it's open ──
alter table private.account_review_cases
  add column if not exists former_subject_id uuid,      -- plain id: the account is gone
  add column if not exists subject_deleted_at timestamptz;
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'prior_unresolved', 'account_recovery', 'shared_device', 'shared_text'));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile', 'suspended_number_reused', 'unresolved_account_returned', 'recovery_request', 'suspended_device'));
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null)
         and (signal in ('behavior', 'report', 'prior_suspension', 'prior_unresolved', 'account_recovery')) = (subject_user is not null or former_subject_id is not null));
create index if not exists account_review_cases_former_subject_idx on private.account_review_cases (former_subject_id) where former_subject_id is not null;
create unique index if not exists account_review_cases_one_prior_unresolved on private.account_review_cases (subject_user) where signal = 'prior_unresolved';
alter table private.account_review_cases drop constraint account_review_cases_subject_user_fkey,
  add constraint account_review_cases_subject_user_fkey foreign key (subject_user) references auth.users(id) on delete set null;
alter table private.account_review_case_events drop constraint account_review_case_events_kind_check,
  add constraint account_review_case_events_kind_check
  check (kind in ('opened', 'member_added', 'new_evidence', 'note', 'external_check', 'report_linked', 'closed', 'reopened', 'account_deleted'));

-- ── keeping the record ──
create or replace function private.retain_unresolved_account(p_user uuid, p_phone text, p_phone_confirmed boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_reports uuid[];
  v_cases uuid[];
  v_pauses jsonb;
  v_reasons text[] := '{}';
  v_id uuid;
  v_devices int := 0;
begin
  if exists (select 1 from private.unresolved_account_records where former_account_id = p_user) then return; end if;
  select coalesce(array_agg(id), '{}') into v_reports from reports where reported_id = p_user and resolved is not true;
  select coalesce(array_agg(distinct c.id), '{}') into v_cases from private.account_review_cases c
   where c.status = 'open' and (c.subject_user = p_user or exists (select 1 from private.account_review_case_members m where m.case_id = c.id and m.user_id = p_user));
  select coalesce(jsonb_agg(jsonb_build_object('capability', r.capability, 'reason', r.reason, 'report_id', r.report_id, 'review_case_id', r.review_case_id,
           'starts_at', r.starts_at, 'expires_at', r.expires_at) order by r.starts_at), '[]') into v_pauses
    from private.account_restrictions r where r.user_id = p_user and r.lifted_at is null and r.expires_at > now();
  if cardinality(v_reports) > 0 then v_reasons := v_reasons || 'open_report'::text; end if;
  if cardinality(v_cases) > 0 then v_reasons := v_reasons || 'open_case'::text; end if;
  if jsonb_array_length(v_pauses) > 0 then v_reasons := v_reasons || 'active_pause'::text; end if;
  if cardinality(v_reasons) = 0 then return; end if;

  insert into private.unresolved_account_records (former_account_id, phone_key, reasons, report_ids, case_ids, pauses, expires_at)
  values (p_user, case when p_phone_confirmed then private.phone_number_key(p_phone) end, v_reasons, v_reports, v_cases, v_pauses,
          now() + (select retention from private.unresolved_account_settings where id))
  on conflict (former_account_id) do nothing
  returning id into v_id;
  if v_id is null then return; end if;
  -- only there if the shared-device detector is on (nothing is stored while it's off)
  insert into private.unresolved_account_device_keys (token_key, record_id)
    select d.token_key, v_id from private.device_sightings d where d.user_id = p_user on conflict do nothing;
  get diagnostics v_devices = row_count;
  insert into private.unresolved_account_events (record_id, kind, detail)
  values (v_id, 'kept', jsonb_build_object('reports', cardinality(v_reports), 'cases', cardinality(v_cases), 'pauses', jsonb_array_length(v_pauses), 'device_keys', v_devices));
end;
$$;

-- delete-account removes the profile first (which clears reports.reported_id), so this has to look before that, and again on the auth-only path.
create or replace function private._profile_deleted_retain_unresolved()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_phone text; v_confirmed boolean;
begin
  begin
    select u.phone, u.phone_confirmed_at is not null into v_phone, v_confirmed from auth.users u where u.id = old.id;
    perform private.retain_unresolved_account(old.id, v_phone, coalesce(v_confirmed, false));
  exception when others then
    insert into private.suspended_number_failures (step, sqlstate) values ('retain_unresolved', sqlstate);
  end;
  return old;
end;
$$;
drop trigger if exists a_retain_unresolved_account on public.profiles;
create trigger a_retain_unresolved_account before delete on public.profiles
  for each row execute function private._profile_deleted_retain_unresolved();

create or replace function private._auth_user_deleted_retain_unresolved()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_case uuid; v_record uuid;
begin
  begin
    perform private.retain_unresolved_account(old.id, old.phone, old.phone_confirmed_at is not null);
  exception when others then
    insert into private.suspended_number_failures (step, sqlstate) values ('retain_unresolved', sqlstate);
  end;
  select id into v_record from private.unresolved_account_records where former_account_id = old.id;
  -- open: it stays, for an admin to finish. Closed: it goes, as it always has.
  delete from private.account_review_cases where subject_user = old.id and status = 'closed';
  for v_case in update private.account_review_cases set former_subject_id = old.id, subject_deleted_at = now(), updated_at = now()
                 where subject_user = old.id returning id loop
    insert into private.account_review_case_events (case_id, kind, detail) values (v_case, 'account_deleted', jsonb_build_object('record_id', v_record));
  end loop;
  return old;
end;
$$;
drop trigger if exists a_retain_unresolved_account on auth.users;
create trigger a_retain_unresolved_account before delete on auth.users
  for each row execute function private._auth_user_deleted_retain_unresolved();

-- ── coming back ──
create or replace function private.open_returned_account_case(p_user uuid, p_record uuid, p_via text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_case uuid; v_closed boolean;
begin
  insert into private.account_review_cases (signal, reason, subject_user, evidence)
  values ('prior_unresolved', 'unresolved_account_returned', p_user, jsonb_build_object('record_id', p_record, 'via', p_via))
  on conflict do nothing
  returning id into v_case;
  if v_case is not null then
    insert into private.account_review_case_members (case_id, user_id) values (v_case, p_user) on conflict do nothing;
  else
    select c.id into v_case from private.account_review_cases c where c.signal = 'prior_unresolved' and c.subject_user = p_user for update;
    if v_case is null then return; end if;
    if (select evidence ->> 'record_id' from private.account_review_cases where id = v_case) = p_record::text
       or exists (select 1 from private.account_review_case_events e where e.case_id = v_case and e.kind = 'new_evidence' and e.detail ->> 'record_id' = p_record::text) then
      return;
    end if;
    update private.account_review_cases set updated_at = now(), new_evidence_at = case when status = 'closed' then now() else new_evidence_at end
     where id = v_case returning status = 'closed' into v_closed;
    insert into private.account_review_case_events (case_id, kind, subject, detail)
    values (v_case, 'new_evidence', p_user, jsonb_build_object('record_id', p_record, 'via', p_via, 'while_closed', v_closed));
  end if;
  insert into private.unresolved_account_events (record_id, kind) values (p_record, case when p_via = 'device' then 'returned_device' else 'returned_number' end);
end;
$$;

create or replace function private.match_unresolved_number(p_user uuid, p_key bytea)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  for r in select id from private.unresolved_account_records
            where phone_key = p_key and expires_at > now() and former_account_id <> p_user order by released_at loop
    perform private.open_returned_account_case(p_user, r.id, 'number');
  end loop;
exception when others then
  insert into private.suspended_number_failures (step, sqlstate) values ('match_unresolved', sqlstate);
end;
$$;

-- Fires only for a sighting, and sightings exist only while the shared-device detector is on. Never blocks registering for notifications.
create or replace function private._device_sighting_match_unresolved()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  begin
    for r in select a.id from private.unresolved_account_device_keys k join private.unresolved_account_records a on a.id = k.record_id
              where k.token_key = new.token_key and a.expires_at > now() and a.former_account_id <> new.user_id order by a.released_at loop
      perform private.open_returned_account_case(new.user_id, r.id, 'device');
    end loop;
  exception when others then
    insert into private.suspended_number_failures (step, sqlstate) values ('match_unresolved', sqlstate);
  end;
  return null;
end;
$$;
drop trigger if exists zz_match_unresolved_account on private.device_sightings;
create trigger zz_match_unresolved_account after insert on private.device_sightings
  for each row execute function private._device_sighting_match_unresolved();

-- verbatim from 20270374 + one line
create or replace function private.match_suspended_numbers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q record;
  r record;
  v_case uuid;
  v_closed boolean;
  v_opened integer := 0;
begin
  for q in select id, user_id, phone_key from private.phone_match_queue order by id for update skip locked loop
    for r in select id from private.suspended_account_records
              where phone_key = q.phone_key and expires_at > now() and former_account_id <> q.user_id
              order by released_at loop
      -- the unique index decides: a concurrent run that loses waits, then finds the winner's case below
      insert into private.account_review_cases (signal, reason, subject_user, evidence)
      values ('prior_suspension', 'suspended_number_reused', q.user_id, jsonb_build_object('record_id', r.id))
      on conflict do nothing
      returning id into v_case;
      if v_case is not null then
        insert into private.account_review_case_members (case_id, user_id) values (v_case, q.user_id) on conflict do nothing;
        v_opened := v_opened + 1;
        v_case := null;
        continue;
      end if;
      select c.id into v_case from private.account_review_cases c
       where c.signal = 'prior_suspension' and c.subject_user = q.user_id;
      if v_case is not null
         and not exists (select 1 from private.account_review_cases where id = v_case and evidence ->> 'record_id' = r.id::text) then
        -- lock the case, THEN look (a concurrent run's evidence for the same record is visible once it committed)
        perform 1 from private.account_review_cases where id = v_case for update;
        if not exists (select 1 from private.account_review_case_events e
                        where e.case_id = v_case and e.kind = 'new_evidence' and e.detail ->> 'record_id' = r.id::text) then
          -- its status as it is now (a close committed meanwhile counts), never an earlier read
          update private.account_review_cases
             set updated_at = now(), new_evidence_at = case when status = 'closed' then now() else new_evidence_at end
           where id = v_case
          returning status = 'closed' into v_closed;
          insert into private.account_review_case_events (case_id, kind, subject, detail)
          values (v_case, 'new_evidence', q.user_id, jsonb_build_object('record_id', r.id, 'while_closed', v_closed));
        end if;
      end if;
      v_case := null;
    end loop;
    perform private.match_unresolved_number(q.user_id, q.phone_key);   -- 20270406
    delete from private.phone_match_queue where id = q.id;
  end loop;
  return v_opened;
end;
$function$;
revoke all on function private.match_suspended_numbers() from public, anon, authenticated;


-- ── what an admin sees: never the number, key, device key or former id ──
create or replace function public.admin_get_deleted_account_record(case_id_param uuid default null, report_id_param uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_ids uuid[];
  v_out jsonb;
  v_admin uuid := auth.uid();
begin
  perform private.require_admin();
  if case_id_param is not null then
    select coalesce(array_agg(x.id), '{}') into v_ids from (
      select a.id from private.unresolved_account_records a where case_id_param = any(a.case_ids)
      union select (c.evidence ->> 'record_id')::uuid from private.account_review_cases c where c.id = case_id_param and c.signal = 'prior_unresolved'
      union select (e.detail ->> 'record_id')::uuid from private.account_review_case_events e
             where e.case_id = case_id_param and e.kind in ('new_evidence', 'account_deleted') and e.detail ->> 'record_id' is not null
               and exists (select 1 from private.unresolved_account_records a where a.id = (e.detail ->> 'record_id')::uuid)
    ) x;
  elsif report_id_param is not null then
    select coalesce(array_agg(a.id), '{}') into v_ids from private.unresolved_account_records a where report_id_param = any(a.report_ids);
  else
    raise exception 'A case or report is needed' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(z.j order by z.released_at), '[]') into v_out from (
    select i.id, a.released_at,
           case when a.id is null or a.expires_at <= now()
             then jsonb_build_object('record_id', i.id, 'still_kept', false)
             else jsonb_build_object('record_id', i.id, 'still_kept', true, 'released_at', a.released_at, 'expires_at', a.expires_at, 'reasons', a.reasons,
                    'open_reports', cardinality(a.report_ids), 'report_ids', to_jsonb(a.report_ids), 'open_cases', cardinality(a.case_ids), 'case_ids', to_jsonb(a.case_ids), 'pauses', a.pauses,
                    'number_kept', a.phone_key is not null) end j
      from unnest(v_ids) i(id) left join private.unresolved_account_records a on a.id = i.id) z;
  insert into private.unresolved_account_events (record_id, kind, actor)
    select i, 'viewed', v_admin from unnest(v_ids) i where exists (select 1 from private.unresolved_account_records a where a.id = i);
  return v_out;
end;
$$;

-- ── expiry ──
create or replace function private.purge_unresolved_account_records()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  r private.unresolved_account_records;
  v_cases int;
begin
  perform private.legal_hold_lock();
  for r in select * from private.unresolved_account_records a where a.expires_at <= now() order by a.expires_at loop
    -- the keys go at the date, whatever else is held: past it they are never matched again
    if r.phone_key is not null or exists (select 1 from private.unresolved_account_device_keys k where k.record_id = r.id) then
      update private.unresolved_account_records set phone_key = null where id = r.id and phone_key is not null;
      delete from private.unresolved_account_device_keys where record_id = r.id;
      insert into private.unresolved_account_events (record_id, kind) values (r.id, 'keys_removed');
    end if;
    continue when private.account_on_legal_hold(r.former_account_id)
      or exists (select 1 from unnest(r.report_ids) x where private.report_on_legal_hold(x))
      or exists (select 1 from unnest(r.case_ids) x where private.case_on_legal_hold(x))
      or exists (select 1 from private.account_review_cases c where c.former_subject_id = r.former_account_id and private.case_on_legal_hold(c.id));
    delete from private.account_review_cases c where c.former_subject_id = r.former_account_id and not private.case_on_legal_hold(c.id);
    get diagnostics v_cases = row_count;
    delete from private.unresolved_account_records where id = r.id;
    insert into private.unresolved_account_events (record_id, kind, detail) values (r.id, 'purged', jsonb_build_object('cases', v_cases));
  end loop;
  -- a case kept without a record (keeping the record failed): the same limit, from the deletion
  delete from private.account_review_cases c
   where c.former_subject_id is not null and c.subject_deleted_at + (select retention from private.unresolved_account_settings where id) <= now()
     and not exists (select 1 from private.unresolved_account_records a where a.former_account_id = c.former_subject_id)
     and not private.case_on_legal_hold(c.id) and not private.account_on_legal_hold(c.former_subject_id);
  delete from private.unresolved_account_events e where e.at < now() - interval '12 months'
    and not exists (select 1 from private.unresolved_account_records a where a.id = e.record_id);
end;
$$;
select cron.schedule('purge-unresolved-account-records', '53 4 * * *', $$select private.purge_unresolved_account_records();$$);

revoke all on function private.set_unresolved_account_retention(interval, text) from public, anon, authenticated;
revoke all on function private._unresolved_record_guard() from public, anon, authenticated;
revoke all on function private._unresolved_event_guard() from public, anon, authenticated;
revoke all on function private.retain_unresolved_account(uuid, text, boolean) from public, anon, authenticated;
revoke all on function private._profile_deleted_retain_unresolved() from public, anon, authenticated;
revoke all on function private._auth_user_deleted_retain_unresolved() from public, anon, authenticated;
revoke all on function private.open_returned_account_case(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.match_unresolved_number(uuid, bytea) from public, anon, authenticated;
revoke all on function private._device_sighting_match_unresolved() from public, anon, authenticated;
revoke all on function private.purge_unresolved_account_records() from public, anon, authenticated;
revoke all on function public.admin_get_deleted_account_record(uuid, uuid) from public, anon;
grant execute on function public.admin_get_deleted_account_record(uuid, uuid) to authenticated;
