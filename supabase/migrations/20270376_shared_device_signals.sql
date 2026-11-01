-- Shared device notification token across accounts, for admin review (owner, 2026-11-01: finish the account-cycling
-- protections; idea 18's gap 1). Staged after 20270375; deploy only with its own approval. DETECTS NOTHING until the owner
-- approves numbers: private.account_signal_settings.shared_device_min_accounts starts null and
-- shared_device_suspended_enabled starts false, so while both are off NOTHING is stored or compared (no key is computed,
-- no sighting is kept). Activation = a separate migration (as 0358 / 0365), which also runs
-- private.backfill_device_sightings() once for the tokens already registered.
--
-- What it is: the Expo push token the app already registers (20270347, private.push_tokens, one per account) identifies an
-- app install on a phone, not a person. When the SAME token is registered by more than one account, that is a reason for
-- a human to look, never proof: families share a phone, one person may have several accounts (the owner's iPhone has
-- three), a token can move or rotate (reinstall, restore, new phone). So:
--   * Stored: only a keyed one-way hash of the token (HMAC-SHA256 under a server-only secret,
--     private.device_signal_secret), per account, with the first and last time it was registered. NEVER the token itself
--     (a token is enough to send a notification that looks like Nearby's, 20270347). No device model, OS, IP, location,
--     advertising id or fingerprint of any kind. Nothing sent to a third party.
--   * Kept 90 days after the account last registered that token (private.device_sightings; purged daily). Sign-out
--     deletes the account's push token (20270347) but NOT its sighting: that is what lets a later account on the same
--     install be compared. Deleting an account deletes its sightings, EXCEPT for a suspended account: then only the
--     keys are kept 12 months with the former account id and suspension time (private.suspended_device_keys; same rule
--     as 20270374 for numbers), so "suspended, deleted, signed up again on the same phone" is still visible.
--   * A token rotation (new token on the same account) just adds a new key; the old one ages out.
-- A CASE (the 20270357 queue, signal 'shared_device') opens only under an approved rule:
--   suspended_device  the token is on a suspended account (live, or deleted within 12 months) AND on another account;
--                     also evaluated when an account is suspended AFTER the sharing began
--   many_accounts     the token is on at least shared_device_min_accounts accounts within the 90 days (>= 3: two
--                     accounts alone, the shared family phone, NEVER open anything)
-- One case per token ever (until 20270369's retention removes it): later accounts join the open case; on a closed case a
-- new account is "new evidence since closed" and the case stays closed (20270369's triggers); only an admin reopens.
-- Case evidence = counts, the suspended accounts' ids and suspension times; never the token or its key.
-- NOTHING here bans, suspends, hides, restricts or limits anyone, sends anything, or tells anyone; push delivery is
-- untouched. Every step runs in its own exception block: a failure never blocks registering a token, deleting an
-- account or suspending one (recorded privately in private.device_signal_failures, no detail about the person).
-- Concurrency: one evaluation per key at a time (transaction advisory lock on the key); a unique index on the case's key
-- backs it up. The secret lives in the database (whoever can read the private schema can test a token they already
-- hold against it): same accepted limit + same pre-deploy secret review as 20270374.

-- 1. Settings (off) ------------------------------------------------------------------------------------------------------
alter table private.account_signal_settings
  add column if not exists shared_device_min_accounts integer
    check (shared_device_min_accounts is null or shared_device_min_accounts >= 3),
  add column if not exists shared_device_suspended_enabled boolean not null default false;

-- 2. The secret and the key ------------------------------------------------------------------------------------------------
create table if not exists private.device_signal_secret (
  id boolean primary key default true check (id),
  secret bytea not null check (length(secret) = 32),
  created_at timestamptz not null default now()
);
revoke all on private.device_signal_secret from public, anon, authenticated;
insert into private.device_signal_secret (secret) values (extensions.gen_random_bytes(32)) on conflict (id) do nothing;

create or replace function private.device_token_key(p_token text)
returns bytea
language sql
stable
security definer
set search_path to ''
as $function$
  select case when nullif(btrim(p_token), '') is not null
              then extensions.hmac(convert_to('push-token:v1:' || btrim(p_token), 'UTF8'), s.secret, 'sha256') end
    from private.device_signal_secret s;
$function$;
revoke all on function private.device_token_key(text) from public, anon, authenticated;

create or replace function private.shared_device_active()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select shared_device_min_accounts is not null or shared_device_suspended_enabled
                     from private.account_signal_settings where id), false);
$function$;
revoke all on function private.shared_device_active() from public, anon, authenticated;

-- 3. Tables ----------------------------------------------------------------------------------------------------------------
create table if not exists private.device_sightings (
  token_key bytea not null check (length(token_key) = 32),
  user_id uuid not null references auth.users(id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (token_key, user_id)
);
create index if not exists device_sightings_user_idx on private.device_sightings (user_id);
create index if not exists device_sightings_last_seen_idx on private.device_sightings (last_seen);

create table if not exists private.suspended_device_keys (
  token_key bytea not null check (length(token_key) = 32),
  former_account_id uuid not null,      -- no FK: the account is gone
  suspended_at timestamptz not null,
  kept_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (token_key, former_account_id)
);
create index if not exists suspended_device_keys_expiry_idx on private.suspended_device_keys (expires_at);

-- which token a shared-device case is about (one case per key; deleted with the case)
create table if not exists private.account_review_case_devices (
  case_id uuid not null references private.account_review_cases(id) on delete cascade,
  token_key bytea not null check (length(token_key) = 32),
  primary key (case_id, token_key)
);
create unique index if not exists account_review_case_devices_one_case on private.account_review_case_devices (token_key);

create table if not exists private.device_signal_failures (
  id bigint generated always as identity primary key,
  step text not null,
  sqlstate text,
  at timestamptz not null default now()
);
revoke all on private.device_sightings, private.suspended_device_keys, private.account_review_case_devices,
  private.device_signal_failures from public, anon, authenticated;

-- 4. Case kind -------------------------------------------------------------------------------------------------------------
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'account_recovery', 'shared_device'));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile', 'suspended_number_reused',
                    'recovery_request', 'suspended_device'));
-- (account_review_cases_subject_check is unchanged: a shared-device case has neither sha256 nor subject_user; its
-- accounts are its members, like a similar-photo case.)

-- 5. Evaluation ------------------------------------------------------------------------------------------------------------
-- Opens / extends the shared-device case for one key when an approved rule holds. Never touches an account.
create or replace function private.evaluate_shared_device(p_key bytea)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.account_signal_settings;
  v_users uuid[];
  v_suspended uuid[];
  v_former jsonb;
  v_reason text;
  v_case uuid;
  v_status text;
  v_evidence jsonb;
begin
  select * into s from private.account_signal_settings where id;
  if s.shared_device_min_accounts is null and not s.shared_device_suspended_enabled then return; end if;
  if p_key is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('device_case:' || encode(p_key, 'hex')));

  select coalesce(array_agg(d.user_id order by d.first_seen), '{}') into v_users
    from private.device_sightings d
   where d.token_key = p_key and d.last_seen > now() - interval '90 days'
     and exists (select 1 from auth.users u where u.id = d.user_id);
  select coalesce(array_agg(p.id), '{}') into v_suspended
    from profiles p where p.id = any(v_users) and p.suspended_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('former_account_id', k.former_account_id, 'suspended_at', k.suspended_at)
                            order by k.suspended_at), '[]'::jsonb) into v_former
    from private.suspended_device_keys k where k.token_key = p_key and k.expires_at > now();

  select c.id, c.status into v_case, v_status
    from private.account_review_case_devices cd join private.account_review_cases c on c.id = cd.case_id
   where cd.token_key = p_key
   for update of c;

  if s.shared_device_suspended_enabled
     and ((cardinality(v_suspended) >= 1 and cardinality(v_users) >= 2)
          or (jsonb_array_length(v_former) >= 1 and cardinality(v_users) >= 1)) then
    v_reason := 'suspended_device';
  elsif s.shared_device_min_accounts is not null and cardinality(v_users) >= s.shared_device_min_accounts then
    v_reason := 'many_accounts';
  end if;

  v_evidence := jsonb_build_object('accounts', cardinality(v_users), 'window_days', 90,
                                   'suspended_accounts', to_jsonb(v_suspended), 'former_suspended_accounts', v_former);

  if v_case is null then
    if v_reason is null then return; end if;
    insert into private.account_review_cases (signal, reason, evidence) values ('shared_device', v_reason, v_evidence)
      returning id into v_case;
    insert into private.account_review_case_devices (case_id, token_key) values (v_case, p_key);
  elsif v_status = 'open' then
    update private.account_review_cases
       set evidence = v_evidence, updated_at = now(),
           reason = case when v_reason = 'suspended_device' then 'suspended_device' else reason end
     where id = v_case;
  end if;
  -- on a closed case only a NEW account inserts a row (= new evidence, 20270369's trigger); the case stays closed
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;
end;
$function$;
revoke all on function private.evaluate_shared_device(bytea) from public, anon, authenticated;

-- 6. Recording -------------------------------------------------------------------------------------------------------------
create or replace function private.note_device_sighting(p_user uuid, p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key bytea;
begin
  if p_user is null or not private.shared_device_active() then return; end if;
  v_key := private.device_token_key(p_token);
  if v_key is null then return; end if;
  insert into private.device_sightings (token_key, user_id) values (v_key, p_user)
  on conflict (token_key, user_id) do update set last_seen = now();
  perform private.evaluate_shared_device(v_key);
end;
$function$;
revoke all on function private.note_device_sighting(uuid, text) from public, anon, authenticated;

create or replace function private._push_token_sighting()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    perform private.note_device_sighting(new.user_id, new.expo_push_token);
  exception when others then
    insert into private.device_signal_failures (step, sqlstate) values ('sighting', sqlstate);
  end;
  return null;
end;
$function$;
revoke all on function private._push_token_sighting() from public, anon, authenticated;
drop trigger if exists zz_push_token_sighting on private.push_tokens;
create trigger zz_push_token_sighting after insert or update on private.push_tokens
  for each row execute function private._push_token_sighting();

-- An account suspended AFTER the sharing began: re-evaluate its keys.
create or replace function private._suspension_device_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  k bytea;
begin
  if new.suspended_at is null or old.suspended_at is not null then return null; end if;
  begin
    if private.shared_device_active() then
      for k in select token_key from private.device_sightings where user_id = new.id loop
        perform private.evaluate_shared_device(k);
      end loop;
    end if;
  exception when others then
    insert into private.device_signal_failures (step, sqlstate) values ('suspension', sqlstate);
  end;
  return null;
end;
$function$;
revoke all on function private._suspension_device_check() from public, anon, authenticated;
drop trigger if exists zz_suspension_device_check on public.profiles;
create trigger zz_suspension_device_check after update of suspended_at on public.profiles
  for each row execute function private._suspension_device_check();

-- A suspended account being deleted keeps only its keys, 12 months (before the sightings cascade away). "Suspended" =
-- the profile says so, or (delete-account removed the profile first) the latest admin decision is 'suspend' (as 20270374).
create or replace function private._auth_user_deleted_keep_device_keys()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_suspended_at timestamptz;
  v_latest text;
begin
  begin
    if exists (select 1 from private.device_sightings where user_id = old.id) then
      if exists (select 1 from profiles where id = old.id) then
        select suspended_at into v_suspended_at from profiles where id = old.id;
      else
        select action into v_latest from account_moderation_actions where user_id = old.id order by created_at desc, id desc limit 1;
        if v_latest = 'suspend' then
          select max(created_at) into v_suspended_at from account_moderation_actions where user_id = old.id and action = 'suspend';
        end if;
      end if;
      if v_suspended_at is not null then
        insert into private.suspended_device_keys (token_key, former_account_id, suspended_at, expires_at)
          select d.token_key, old.id, v_suspended_at, now() + interval '12 months'
            from private.device_sightings d where d.user_id = old.id
        on conflict do nothing;
      end if;
    end if;
  exception when others then
    insert into private.device_signal_failures (step, sqlstate) values ('retain', sqlstate);
  end;
  return old;
end;
$function$;
revoke all on function private._auth_user_deleted_keep_device_keys() from public, anon, authenticated;
drop trigger if exists zz_keep_suspended_device_keys on auth.users;
create trigger zz_keep_suspended_device_keys before delete on auth.users
  for each row execute function private._auth_user_deleted_keep_device_keys();

-- 7. Activation backfill (run by the activation migration, never by this one) + retention --------------------------------
create or replace function private.backfill_device_sightings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  if not private.shared_device_active() then return 0; end if;
  for r in select user_id, expo_push_token from private.push_tokens loop
    perform private.note_device_sighting(r.user_id, r.expo_push_token);
    n := n + 1;
  end loop;
  return n;
end;
$function$;
revoke all on function private.backfill_device_sightings() from public, anon, authenticated;

create or replace function private.purge_device_sightings()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a integer;
  b integer;
begin
  delete from private.device_sightings where last_seen <= now() - interval '90 days';
  get diagnostics a = row_count;
  delete from private.suspended_device_keys where expires_at <= now();
  get diagnostics b = row_count;
  delete from private.device_signal_failures where at <= now() - interval '90 days';
  return jsonb_build_object('sightings', a, 'suspended_keys', b);
end;
$function$;
revoke all on function private.purge_device_sightings() from public, anon, authenticated;

select cron.schedule('purge-device-sightings', '59 4 * * *', 'select private.purge_device_sightings();');
