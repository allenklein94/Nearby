-- Suspended-number re-registration (owner approved 2026-10-31: required before external users; an approved exception to the
-- development freeze). Staged after 20270373; deploy only with its own approval. Needs 20270351 (suspension + its audit
-- trail) and 20270357/20270363/20270369 (the one admin review queue and its history).
--
-- The gap: a suspended person deletes their account (or moves it to another number), which frees the phone number, signs up
-- again with it and starts clean: account_moderation_actions cascades away with the account, nothing remembers the number.
--
-- Now:
--   1. Retained record. When a SUSPENDED account is deleted, or changes away from a confirmed number while suspended,
--      private.suspended_account_records keeps, for 12 months from that moment:
--        * phone_key  = HMAC-SHA256 of the normalized number under a server-only secret (private.phone_match_secret, 32
--                       random bytes made here, no client access; never the number, never a plain or unsalted hash, so the
--                       10^10 possible numbers can't be tried against it without the secret). Only a CONFIRMED number is
--                       kept (an unconfirmed one may be someone else's typing). No number = record without a key.
--        * the suspension decisions as they were (action, reason, admin, report id, time, sessions ended) and the former
--          account id (it links the reports that outlive the account, 20270355). Nothing from the profile: no name,
--          photo, bio, birthdate, location, messages.
--      Records are append-only (no update; delete only once expired) and purged daily once expired.
--      A reinstated account (latest decision = reinstate) leaves nothing behind.
--   2. Matching. When any account's number becomes confirmed (a phone sign-up's code, or a number added/changed later) the
--      key goes into private.phone_match_queue, the same single insert for every number, so sign-up does the same work and
--      answers the same way whether or not the number matches. Every 10 minutes private.match_suspended_numbers() compares
--      the queue with unexpired records, outside any request.
--   3. On a match: sign-up is never refused, nothing is restricted, suspended, hidden or limited. A private review case
--      opens (signal prior_suspension, the new account as subject and member), for an admin to decide on the evidence: a
--      number may have been reassigned to someone else. One case per account: a further record matched later is added as
--      new evidence (a closed case stays closed and surfaces in the queue, 20270369's rule). The admin sees the earlier
--      decisions through admin_get_prior_suspension(case) - never the number or the key.
--   4. Nothing reveals a match: no client-readable table, function, column, error, push or badge carries it; the triggers
--      never raise (a failure is recorded privately and never blocks Auth); matching runs later, from cron.
-- Known limits: this closes same-number re-registration only (another number = the duplicate-account signals + human
-- review); the secret lives in the database (whoever can read the private schema can test numbers); rotating it orphans
-- every kept key; a match up to 10 minutes after confirmation.

-- 1. The secret and the key ------------------------------------------------------------------------------------------
create table if not exists private.phone_match_secret (
  id boolean primary key default true check (id),
  secret bytea not null check (length(secret) = 32),
  created_at timestamptz not null default now()
);
revoke all on private.phone_match_secret from public, anon, authenticated;
insert into private.phone_match_secret (secret) values (extensions.gen_random_bytes(32)) on conflict (id) do nothing;

-- digits only ('+1 (561) 555-0101' = '15615550101' = Auth's stored form); fewer than 7 digits = no key
create or replace function private.phone_number_key(p_phone text)
returns bytea
language sql
stable
security definer
set search_path to 'private'
as $function$
  select case when length(d) >= 7
              then extensions.hmac(convert_to('suspended-number:v1:' || d, 'UTF8'), s.secret, 'sha256') end
    from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') d) n
    cross join private.phone_match_secret s;
$function$;
revoke all on function private.phone_number_key(text) from public, anon, authenticated;

-- 2. Records, queue, failures ------------------------------------------------------------------------------------------
create table if not exists private.suspended_account_records (
  id uuid primary key default gen_random_uuid(),
  phone_key bytea check (phone_key is null or length(phone_key) = 32),
  former_account_id uuid not null,            -- no FK: the account is gone (or moved to another number)
  released text not null check (released in ('account_deleted', 'number_changed')),
  suspended_at timestamptz not null,
  released_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decisions jsonb not null check (jsonb_typeof(decisions) = 'array' and jsonb_array_length(decisions) >= 1),
  check (expires_at = released_at + interval '12 months')
);
create index if not exists suspended_account_records_key_idx on private.suspended_account_records (phone_key) where phone_key is not null;
create index if not exists suspended_account_records_expiry_idx on private.suspended_account_records (expires_at);

create table if not exists private.phone_match_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_key bytea not null,
  queued_at timestamptz not null default now()
);
create index if not exists phone_match_queue_queued_idx on private.phone_match_queue (queued_at);

create table if not exists private.suspended_number_failures (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  step text not null check (step in ('retain', 'queue')),
  sqlstate text
);
revoke all on private.suspended_account_records, private.phone_match_queue, private.suspended_number_failures
  from public, anon, authenticated;

-- Append-only: never changed; removed only once expired (the purge).
create or replace function private._suspended_record_guard()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'UPDATE' or old.expires_at > now() then
    raise exception 'Suspended-account records are append-only' using errcode = '42501', hint = 'suspended_record_append_only';
  end if;
  return old;
end;
$function$;
revoke all on function private._suspended_record_guard() from public, anon, authenticated;
drop trigger if exists suspended_record_guard on private.suspended_account_records;
create trigger suspended_record_guard before update or delete on private.suspended_account_records
  for each row execute function private._suspended_record_guard();

-- 3. Retaining (account deleted, or its confirmed number changed, while suspended) ----------------------------------------
-- Suspended = the profile says so (profiles.suspended_at, set only by admin_suspend_user / cleared only by
-- admin_reinstate_user) or, when delete-account already removed the profile, the latest admin decision is 'suspend'
-- (account_moderation_actions lives until the auth account goes). Copied BEFORE the delete: the decisions cascade with it.
create or replace function private.retain_suspended_account(p_user uuid, p_phone text, p_phone_confirmed boolean, p_released text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_latest text;
  v_suspended_at timestamptz;
  v_decisions jsonb;
begin
  -- the profile is the authority while it exists; once the app's deletion removed it first, the latest admin decision
  if exists (select 1 from profiles where id = p_user) then
    if not exists (select 1 from profiles where id = p_user and suspended_at is not null) then return; end if;
  else
    select action into v_latest from account_moderation_actions where user_id = p_user order by created_at desc, id desc limit 1;
    if v_latest is distinct from 'suspend' then return; end if;
  end if;
  select max(created_at) filter (where action = 'suspend'),
         jsonb_agg(jsonb_build_object('action', action, 'reason', reason, 'report_id', report_id, 'admin_id', admin_id,
                                      'sessions_ended', sessions_ended, 'at', created_at) order by created_at, id)
    into v_suspended_at, v_decisions
    from account_moderation_actions where user_id = p_user;
  if v_decisions is null then        -- suspended with no recorded decision (not possible through 20270351's functions)
    select suspended_at, jsonb_build_array(jsonb_build_object('action', 'suspend', 'reason', null, 'at', suspended_at))
      into v_suspended_at, v_decisions from profiles where id = p_user;
  end if;
  insert into private.suspended_account_records (phone_key, former_account_id, released, suspended_at, released_at, expires_at, decisions)
  values (case when p_phone_confirmed then private.phone_number_key(p_phone) end, p_user, p_released,
          coalesce(v_suspended_at, now()), now(), now() + interval '12 months', v_decisions);
end;
$function$;
revoke all on function private.retain_suspended_account(uuid, text, boolean, text) from public, anon, authenticated;

create or replace function private._auth_user_deleted_retain()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    perform private.retain_suspended_account(old.id, old.phone, old.phone_confirmed_at is not null, 'account_deleted');
  exception when others then
    -- never block an account deletion; recorded privately (no detail about the person)
    insert into private.suspended_number_failures (step, sqlstate) values ('retain', sqlstate);
  end;
  return old;
end;
$function$;
revoke all on function private._auth_user_deleted_retain() from public, anon, authenticated;
drop trigger if exists zz_retain_suspended_account on auth.users;
create trigger zz_retain_suspended_account before delete on auth.users
  for each row execute function private._auth_user_deleted_retain();

-- 4. Queueing every newly confirmed number (the same work for every number) ---------------------------------------------
create or replace function private._auth_user_phone_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    -- a suspended account leaving a confirmed number keeps that number on record
    if tg_op = 'UPDATE' and old.phone is not null and old.phone_confirmed_at is not null
       and (new.phone is distinct from old.phone) then
      perform private.retain_suspended_account(old.id, old.phone, true, 'number_changed');
    end if;
    if new.phone is not null and new.phone_confirmed_at is not null
       and (tg_op = 'INSERT' or new.phone is distinct from old.phone or old.phone_confirmed_at is null) then
      insert into private.phone_match_queue (user_id, phone_key)
        select new.id, k from (select private.phone_number_key(new.phone) k) x where k is not null;
    end if;
  exception when others then
    -- never block Auth (sign-up, code confirmation, number change); recorded privately
    insert into private.suspended_number_failures (step, sqlstate) values ('queue', sqlstate);
  end;
  return null;
end;
$function$;
revoke all on function private._auth_user_phone_changed() from public, anon, authenticated;
drop trigger if exists zz_queue_phone_match on auth.users;
create trigger zz_queue_phone_match after insert or update of phone, phone_confirmed_at on auth.users
  for each row execute function private._auth_user_phone_changed();

-- 5. The review case ---------------------------------------------------------------------------------------------------
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension'));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile', 'suspended_number_reused'));
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null)
         and (signal in ('behavior', 'report', 'prior_suspension')) = (subject_user is not null));
-- one prior-suspension case per account, ever (closed cases never reopen themselves; later matches = new evidence)
create unique index if not exists account_review_cases_one_prior_suspension on private.account_review_cases (subject_user)
  where signal = 'prior_suspension';

-- Every 10 minutes (and callable by the service role). SKIP LOCKED + the unique index: two runs never open two cases.
create or replace function private.match_suspended_numbers()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    delete from private.phone_match_queue where id = q.id;
  end loop;
  return v_opened;
end;
$function$;
revoke all on function private.match_suspended_numbers() from public, anon, authenticated;

-- The earlier decisions behind a prior-suspension case, for admins only: never the number or the key.
create or replace function public.admin_get_prior_suspension(case_id_param uuid)
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
  select * into c from private.account_review_cases where id = case_id_param and signal = 'prior_suspension';
  if not found then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'record_id', ids.rid,
             'still_kept', r.id is not null,
             'released', r.released, 'suspended_at', r.suspended_at, 'released_at', r.released_at, 'expires_at', r.expires_at,
             'decisions', (select coalesce(jsonb_agg(d || jsonb_build_object(
                                     'admin_name', (select display_name from profiles where id = (d ->> 'admin_id')::uuid))
                                     order by d ->> 'at'), '[]'::jsonb)
                             from jsonb_array_elements(r.decisions) d))
           order by ids.first_at)
      from (select (c.evidence ->> 'record_id')::uuid rid, c.opened_at first_at
            union
            select (e.detail ->> 'record_id')::uuid, min(e.at) from private.account_review_case_events e
             where e.case_id = c.id and e.kind = 'new_evidence' and e.detail ? 'record_id' group by 1) ids
      left join private.suspended_account_records r on r.id = ids.rid and r.expires_at > now()), '[]'::jsonb);
end;
$function$;
revoke all on function public.admin_get_prior_suspension(uuid) from public, anon;
grant execute on function public.admin_get_prior_suspension(uuid) to authenticated;

-- 6. Retention ----------------------------------------------------------------------------------------------------------
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
revoke all on function private.purge_suspended_account_records() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('match-suspended-numbers', 'purge-suspended-account-records');
select cron.schedule('match-suspended-numbers', '*/10 * * * *', 'select private.match_suspended_numbers();');
select cron.schedule('purge-suspended-account-records', '47 4 * * *', 'select private.purge_suspended_account_records();');
