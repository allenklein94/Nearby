-- Account takeover through a phone number (SIM swap / a number someone else controls) + account recovery. Owner exception
-- to the freeze, 2026-10-31; REVISED IN PLACE 2026-11-01 (owner approved D1-D4 with adjustments; the first version was
-- never deployed or merged). Staged after 20270374; its own deploy approval. Needs 20270351 (suspension), 20270361
-- (marker pattern), 20270369 (private.require_admin + the review case queue), 20270374 (case constraints).
--
-- Proven on Supabase Auth v2.197.0 (= production) before this migration: whoever gets one SMS code for an account's number
-- gets a session (inherent to SMS sign-in), and from it could V1 move the account to their own number (the owner's number then
-- opens a new, empty account), V2 add a password (other sessions end; a way back in without SMS), V3 add an email (a second way
-- in), V4 then enrol an authenticator (the owner can change nothing). The first version of this file closed V2-V4 and slowed V1
-- with "24 h since the account's latest sign-in"; the 2026-11-01 investigation (scripts/investigation/account-recovery-probe-
-- 2026-11-01.js) showed that clock can't tell owner from intruder: an intruder's completed change counts as a sign-in and then
-- blocks the OWNER's change back, and an Auth-admin number change answered OK while saving nothing. This version:
--
--   D1 A number change needs ALL of: a calling session that has existed 7 days (the device that was there first), a fresh
--      sign-in code to the account's CURRENT number verified by Auth itself (works with Twilio Verify; the step-up), the
--      second factor when the account has one (D4), no recovery hold. The step-up yields a single-use permit for ONE new
--      number (15 min); the auth.users guard saves a number change only against it, and REFUSES LOUDLY otherwise (an error
--      to the caller, incl. the Auth admin API: never a silent "OK"). Emergency recovery goes through admin_recover_account.
--   D2 Deletion (switch, OFF until every device runs a build that does the step-up): needs the same fresh code; immediate,
--      except from a session younger than 7 days on an account with a takeover signal in the last 30 days: then the account
--      is signed out everywhere, hidden, sign-in refused, and permanently deleted 7 days later (the app states the date;
--      Apple 5.1.1(v) allows a reasonable time when the person is told and gets a confirmation). Support can stop it (D3).
--   D3 Recovery admins (an allow-list on top of admin) open an account_recovery case, place a hold (sessions end, sign-in,
--      number change and deletion refused; 14 days, extendable with a reason to 42 at most, never a suspension), and recover:
--      the original number back (proved by the claimant signing in with it, which Auth verifies), every session ended, any
--      scheduled deletion cancelled. Evidence rules are enforced; every action goes to an append-only audit.
--   D4 When an account has a verified second factor, every function here also requires an aal2 session (Supabase does not
--      enforce this by itself: it is the server's job).
-- Kept from the first version: a phone-only account never gains a password or an email (quietly not saved); one security
-- notice for a new sign-in elsewhere and a completed number change; the private record (kind + time, 12 months, admins only).
-- Never: an automatic restriction, a public signal, a device fingerprint or IP kept by Nearby, mandatory ID.
-- Limits (recorded): see PRODUCT_AUDIT/ACCOUNT_RECOVERY_DESIGN_2026-11-01.md.

-- 1. The private record ---------------------------------------------------------------------------------------------------
create table if not exists private.account_security_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,               -- no foreign key: kept (12 months) even if the account is deleted
  kind text not null check (kind in ('password_add_refused', 'email_add_refused', 'phone_change_refused',
                                     'phone_changed', 'new_sign_in_elsewhere', 'guard_failure',
                                     'step_up_failed', 'deletion_scheduled', 'deletion_cancelled',
                                     'recovery_hold', 'recovery_hold_released', 'account_recovered')),
  sqlstate text,                       -- guard_failure only
  created_at timestamptz not null default now()
);
create index if not exists account_security_events_user on private.account_security_events (user_id, created_at desc);
revoke all on private.account_security_events from public, anon, authenticated;

-- The numbers, in one place
create or replace function private.account_security_rule(p_key text)
returns interval
language sql
immutable
as $function$
  select case p_key
    when 'established_session' then interval '7 days'    -- a session this old may change the number / delete at once
    when 'step_up' then interval '10 minutes'            -- a step-up must be finished, and used, within this
    when 'permit' then interval '15 minutes'             -- a verified number-change permit lives this long
    when 'deletion_delay' then interval '7 days'
    when 'takeover_signal' then interval '30 days'
    when 'hold' then interval '14 days'
    when 'hold_max' then interval '42 days'
  end;
$function$;
revoke all on function private.account_security_rule(text) from public, anon, authenticated;

-- D2's switch (server-side: a direct API call can't choose the old behaviour once it is on)
create table if not exists private.account_security_settings (
  id boolean primary key default true check (id),
  deletion_protection_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.account_security_settings (id) values (true) on conflict (id) do nothing;
revoke all on private.account_security_settings from public, anon, authenticated;

-- 2. Building blocks ------------------------------------------------------------------------------------------------------
-- The session the caller is using (from its JWT), only while it exists and hasn't ended; null otherwise.
create or replace function private.caller_session()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id from auth.sessions s
  where s.id::text = nullif(auth.jwt() ->> 'session_id', '') and s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > now());
$function$;
revoke all on function private.caller_session() from public, anon, authenticated;

create or replace function private.session_established(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select s.created_at <= now() - private.account_security_rule('established_session')
                   from auth.sessions s where s.id = p_session), false);
$function$;
revoke all on function private.session_established(uuid) from public, anon, authenticated;

-- D4: an account with a verified second factor needs an aal2 session for anything here.
create or replace function private.meets_second_factor(p_user uuid, p_aal text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified')
         or coalesce(p_aal, '') = 'aal2';
$function$;
revoke all on function private.meets_second_factor(uuid, text) from public, anon, authenticated;

-- Recovery holds (D3)
create table if not exists private.account_recovery_holds (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  case_id uuid not null,
  placed_by uuid,
  placed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  extensions integer not null default 0,
  released_at timestamptz,
  released_by uuid,                    -- null + released_at = expired
  release_reason text,
  check (expires_at <= placed_at + interval '42 days')
);
create unique index if not exists account_recovery_holds_one_open on private.account_recovery_holds (user_id) where released_at is null;
revoke all on private.account_recovery_holds from public, anon, authenticated;

create or replace function private.recovery_hold_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from private.account_recovery_holds h
                 where h.user_id = p_user and h.released_at is null and h.expires_at > now());
$function$;
revoke all on function private.recovery_hold_active(uuid) from public, anon, authenticated;

-- Scheduled deletions (D2)
create table if not exists private.account_deletion_requests (
  user_id uuid primary key,            -- no foreign key: the row outlives the account (12 months)
  requested_at timestamptz not null default now(),
  purge_at timestamptz not null,
  session_id uuid,
  previous_profile_hidden boolean,
  status text not null default 'pending' check (status in ('pending', 'cancelled', 'done')),
  resolved_at timestamptz,
  resolved_by uuid
);
revoke all on private.account_deletion_requests from public, anon, authenticated;

-- While a hold or a scheduled deletion is open, sign-in stays refused at least until it ends (whoever writes banned_until,
-- incl. 0351's reinstate). Suspension's own ban is longer and is never shortened by this.
create or replace function private.account_ban_floor(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select nullif(greatest(
    coalesce((select max(h.expires_at) from private.account_recovery_holds h
              where h.user_id = p_user and h.released_at is null and h.expires_at > now()), '-infinity'::timestamptz),
    coalesce((select d.purge_at + interval '1 day' from private.account_deletion_requests d
              where d.user_id = p_user and d.status = 'pending'), '-infinity'::timestamptz)), '-infinity'::timestamptz);
$function$;
revoke all on function private.account_ban_floor(uuid) from public, anon, authenticated;

-- The marker only admin_recover_account sets (per transaction, no client grant; as 20270361)
create table if not exists private.account_recovery_marker (txid bigint primary key);
revoke all on private.account_recovery_marker from public, anon, authenticated;
create or replace function private.account_recovery_write_active()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from private.account_recovery_marker where txid = txid_current_if_assigned());
$function$;
revoke all on function private.account_recovery_write_active() from public, anon, authenticated;

-- 3. Step-up (D1/D2): a fresh sign-in code, verified by Auth, tied to the established session that asked for it ----------
create table if not exists private.account_step_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  purpose text not null check (purpose in ('phone_change', 'delete')),
  session_id uuid not null,            -- the calling (established) session
  new_phone text,                      -- phone_change only: digits, as Auth stores them
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  fresh_session_id uuid,               -- the first session created for this account after the step-up began
  verified_at timestamptz,
  consumed_at timestamptz,
  check ((purpose = 'phone_change') = (new_phone is not null))
);
create index if not exists account_step_ups_user on private.account_step_ups (user_id, created_at desc);
revoke all on private.account_step_ups from public, anon, authenticated;

-- 4. The notice: one push to the account, no detail beyond what happened ---------------------------------------------------
create or replace function private.account_security_notice(p_user uuid, p_kind text, p_detail text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
revoke all on function private.account_security_notice(uuid, text, text) from public, anon, authenticated;

-- 5. The guard on auth.users ----------------------------------------------------------------------------------------------
-- Password / email on a phone-only account: quietly not saved (BEFORE UPDATE, never raises; proven with Auth).
-- A number change: saved only against a verified, unconsumed permit for exactly that number, or inside admin_recover_account.
-- Without one, STARTING a change (the client path) is quietly not saved and recorded (the code to the new number then fails),
-- and the NUMBER ITSELF changing (the Auth admin API / dashboard) is REFUSED WITH AN ERROR: never a silent "OK".
-- The sign-in ban never drops below an open hold / scheduled deletion.
create or replace function private._auth_user_takeover_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone_only boolean := coalesce(old.email, '') = '';
  v_starts boolean;
  v_moves boolean;
  v_target text;
  v_permit uuid;
  v_refuse boolean := false;
  v_floor timestamptz;
begin
  begin
    -- a phone-only account never gains a password
    if v_phone_only and new.encrypted_password is distinct from old.encrypted_password then
      new.encrypted_password := old.encrypted_password;
      insert into private.account_security_events (user_id, kind) values (old.id, 'password_add_refused');
    end if;
    -- ...nor an email (set directly or as a pending change)
    if v_phone_only and (coalesce(new.email, '') <> '' or
         (coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change)) then
      new.email := old.email;
      new.email_confirmed_at := old.email_confirmed_at;
      new.email_change := old.email_change;
      new.email_change_token_new := old.email_change_token_new;
      new.email_change_token_current := old.email_change_token_current;
      new.email_change_sent_at := old.email_change_sent_at;
      new.email_change_confirm_status := old.email_change_confirm_status;
      insert into private.account_security_events (user_id, kind) values (old.id, 'email_add_refused');
    end if;
    -- a number change: starting one, or the number itself
    v_starts := coalesce(new.phone_change, '') <> '' and new.phone_change is distinct from old.phone_change;
    v_moves := old.phone is not null and old.phone <> '' and new.phone is distinct from old.phone;
    if (v_starts or v_moves) and not private.account_recovery_write_active() then
      v_target := case when v_moves then coalesce(new.phone, '') else new.phone_change end;
      if not private.recovery_hold_active(old.id) then
        select p.id into v_permit from private.account_step_ups p
        where p.user_id = old.id and p.purpose = 'phone_change' and p.new_phone = v_target
          and p.verified_at > now() - private.account_security_rule('permit') and p.consumed_at is null
        order by p.verified_at desc limit 1 for update;
      end if;
      if v_permit is null and v_moves then
        v_refuse := true;                    -- the number itself (Auth admin API, a code for an unpermitted start): an error
      elsif v_permit is null then
        new.phone_change := old.phone_change;             -- starting one without a permit: quietly not saved, recorded
        new.phone_change_token := old.phone_change_token;
        new.phone_change_sent_at := old.phone_change_sent_at;
        insert into private.account_security_events (user_id, kind) values (old.id, 'phone_change_refused');
      elsif v_moves then
        update private.account_step_ups set consumed_at = now() where id = v_permit;
      end if;
    end if;
    -- sign-in stays refused while a hold / scheduled deletion is open
    if new.banned_until is distinct from old.banned_until or new.banned_until is null or new.banned_until < now() then
      v_floor := private.account_ban_floor(old.id);
      if v_floor is not null and (new.banned_until is null or new.banned_until < v_floor) then
        new.banned_until := v_floor;
      end if;
    end if;
  exception when others then
    -- fail closed on the sensitive fields, never an error inside Auth for these
    new.encrypted_password := case when v_phone_only then old.encrypted_password else new.encrypted_password end;
    new.phone := old.phone; new.phone_confirmed_at := old.phone_confirmed_at;
    new.phone_change := old.phone_change; new.phone_change_token := old.phone_change_token;
    if v_phone_only then new.email := old.email; new.email_change := old.email_change; end if;
    insert into private.account_security_events (user_id, kind, sqlstate) values (old.id, 'guard_failure', sqlstate);
    return new;
  end;
  if v_refuse then
    -- (an error rolls back its own record; an unpermitted START, the client path, was already refused quietly and recorded)
    raise exception 'This phone number change is not permitted' using errcode = '42501', hint = 'phone_change_not_permitted';
  end if;
  return new;
end;
$function$;
revoke all on function private._auth_user_takeover_guard() from public, anon, authenticated;
drop trigger if exists aa_account_takeover_guard on auth.users;
create trigger aa_account_takeover_guard before update on auth.users
  for each row execute function private._auth_user_takeover_guard();

-- 6. New sign-in notice (and a step-up's own fresh session, which gets no notice) ------------------------------------------
create or replace function private._auth_session_created_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_step uuid;
begin
  begin
    -- the first session created after a pending step-up began is that step-up's fresh session (bound to it, no notice)
    update private.account_step_ups set fresh_session_id = new.id
    where id = (select p.id from private.account_step_ups p
                where p.user_id = new.user_id and p.fresh_session_id is null and p.verified_at is null
                  and p.consumed_at is null and p.expires_at > now() and p.session_id <> new.id
                order by p.created_at desc limit 1)
    returning id into v_step;
    if v_step is not null then return null; end if;
    -- (not the session a number change itself opens: that account was just told by the 'phone_changed' notice)
    if exists (select 1 from auth.sessions s where s.user_id = new.user_id and s.id <> new.id
                 and coalesce(s.updated_at, s.created_at) > now() - interval '30 days')
       and not exists (select 1 from private.account_security_events e where e.user_id = new.user_id
                         and e.kind = 'phone_changed' and e.created_at > now() - interval '2 minutes') then
      perform private.account_security_notice(new.user_id, 'new_sign_in_elsewhere');
    end if;
  exception when others then
    insert into private.account_security_events (user_id, kind, sqlstate) values (new.user_id, 'guard_failure', sqlstate);
  end;
  return null;
end;
$function$;
revoke all on function private._auth_session_created_notice() from public, anon, authenticated;
drop trigger if exists zz_account_new_sign_in on auth.sessions;
create trigger zz_account_new_sign_in after insert on auth.sessions
  for each row execute function private._auth_session_created_notice();

-- a completed number change (only reaches here when the guard let it through)
create or replace function private._auth_user_phone_changed_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if old.phone is not null and old.phone <> '' and new.phone is distinct from old.phone
       and not private.account_recovery_write_active() then
      perform private.account_security_notice(new.id, 'phone_changed');
    end if;
  exception when others then
    insert into private.account_security_events (user_id, kind, sqlstate) values (new.id, 'guard_failure', sqlstate);
  end;
  return null;
end;
$function$;
revoke all on function private._auth_user_phone_changed_notice() from public, anon, authenticated;
drop trigger if exists zz_account_phone_changed_notice on auth.users;
create trigger zz_account_phone_changed_notice after update of phone on auth.users
  for each row execute function private._auth_user_phone_changed_notice();

-- 7. The signed-in person's functions -------------------------------------------------------------------------------------
-- When a number change becomes possible from THIS session (null = now). Own session only.
create or replace function public.get_my_phone_change_wait()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when s.created_at > now() - private.account_security_rule('established_session')
              then s.created_at + private.account_security_rule('established_session') end
  from auth.sessions s where s.id = private.caller_session();
$function$;
revoke all on function public.get_my_phone_change_wait() from public, anon;
grant execute on function public.get_my_phone_change_wait() to authenticated;

-- Begin a step-up from the session the person is using. The app then signs in once more with a code to the CURRENT number
-- (on a separate, throw-away client) and passes that fresh session to complete_account_step_up.
create or replace function public.begin_account_step_up(purpose_param text, new_phone_param text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_sess uuid := private.caller_session();
  v_phone text := nullif(regexp_replace(coalesce(new_phone_param, ''), '\D', '', 'g'), '');
  v_current text;
  v_id uuid;
  v_exp timestamptz := now() + private.account_security_rule('step_up');
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_sess is null then raise exception 'Sign in again' using errcode = '42501', hint = 'session_unknown'; end if;
  if coalesce(purpose_param, '') not in ('phone_change', 'delete') then raise exception 'Unknown step' using errcode = '22023'; end if;
  if private.recovery_hold_active(v_uid) then
    raise exception 'This account is on hold' using errcode = '42501', hint = 'account_on_hold';
  end if;
  if not private.meets_second_factor(v_uid, auth.jwt() ->> 'aal') then
    raise exception 'Verify with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  if (select count(*) from private.account_step_ups where user_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many attempts. Try again later.' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  if purpose_param = 'phone_change' then
    select phone into v_current from auth.users where id = v_uid;
    if v_phone is null or length(v_phone) not between 8 and 15 or v_phone = coalesce(v_current, '') then
      raise exception 'Enter a different phone number' using errcode = '22023', hint = 'phone_invalid';
    end if;
    if not private.session_established(v_sess) then
      raise exception 'Not yet' using errcode = '42501', hint = 'phone_change_wait';
    end if;
  else
    v_phone := null;
  end if;
  update private.account_step_ups set consumed_at = now()            -- one pending step-up at a time
  where user_id = v_uid and verified_at is null and consumed_at is null;
  insert into private.account_step_ups (user_id, purpose, session_id, new_phone, expires_at)
  values (v_uid, purpose_param, v_sess, v_phone, v_exp) returning id into v_id;
  return jsonb_build_object('step_up_id', v_id, 'expires_at', v_exp);
end;
$function$;
revoke all on function public.begin_account_step_up(text, text) from public, anon;
grant execute on function public.begin_account_step_up(text, text) to authenticated;

create or replace function public.complete_account_step_up(step_up_id_param uuid, fresh_session_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_sess uuid := private.caller_session();
  s private.account_step_ups;
  v_ok boolean;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into s from private.account_step_ups where id = step_up_id_param and user_id = v_uid for update;
  if not found or s.verified_at is not null or s.consumed_at is not null then
    raise exception 'Start again' using errcode = '22023', hint = 'step_up_unknown';
  end if;
  v_ok := v_sess is not null and s.session_id = v_sess and s.expires_at > now()
          and s.fresh_session_id is not null and s.fresh_session_id = fresh_session_param
          and exists (select 1 from auth.sessions f where f.id = fresh_session_param and f.user_id = v_uid
                        and f.created_at >= s.created_at);
  if not v_ok then
    update private.account_step_ups set consumed_at = now() where id = s.id;
    insert into private.account_security_events (user_id, kind) values (v_uid, 'step_up_failed');
    -- another session took the step-up's slot (its notice was held back): tell the account now
    if s.fresh_session_id is not null and s.fresh_session_id is distinct from fresh_session_param then
      perform private.account_security_notice(v_uid, 'new_sign_in_elsewhere');
    end if;
    return jsonb_build_object('verified', false);
  end if;
  update private.account_step_ups set verified_at = now() where id = s.id;
  delete from auth.sessions where id = fresh_session_param;           -- it was only the proof
  return jsonb_build_object('verified', true, 'purpose', s.purpose,
    'valid_until', now() + case when s.purpose = 'phone_change' then private.account_security_rule('permit')
                                else private.account_security_rule('step_up') end);
end;
$function$;
revoke all on function public.complete_account_step_up(uuid, uuid) from public, anon;
grant execute on function public.complete_account_step_up(uuid, uuid) to authenticated;

-- 8. Deletion (D2), called only by delete-account with the values of the caller's VERIFIED JWT ------------------------------
create or replace function public.account_deletion_authorize(user_id_param uuid, session_id_param uuid, aal_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_step uuid;
  v_purge timestamptz;
  v_hidden boolean;
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
begin
  if private.recovery_hold_active(user_id_param) then
    raise exception 'This account is on hold' using errcode = '42501', hint = 'account_on_hold';
  end if;
  if not (select deletion_protection_enabled from private.account_security_settings) then
    return jsonb_build_object('mode', 'legacy');                       -- switch off: exactly as before
  end if;
  if not exists (select 1 from auth.sessions s where s.id = session_id_param and s.user_id = user_id_param
                   and (s.not_after is null or s.not_after > now())) then
    raise exception 'Sign in again' using errcode = '42501', hint = 'session_unknown';
  end if;
  if not private.meets_second_factor(user_id_param, aal_param) then
    raise exception 'Verify with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  select id into v_step from private.account_step_ups
  where user_id = user_id_param and purpose = 'delete' and session_id = session_id_param and consumed_at is null
    and verified_at > now() - private.account_security_rule('step_up')
  order by verified_at desc limit 1 for update;
  if v_step is null then
    raise exception 'Confirm with a code first' using errcode = '42501', hint = 'step_up_required';
  end if;
  update private.account_step_ups set consumed_at = now() where id = v_step;
  if private.session_established(session_id_param)
     or not exists (select 1 from private.account_security_events e where e.user_id = user_id_param
                      and e.created_at > now() - private.account_security_rule('takeover_signal')
                      and e.kind in ('new_sign_in_elsewhere', 'phone_changed', 'phone_change_refused', 'password_add_refused',
                                     'email_add_refused', 'step_up_failed', 'recovery_hold_released', 'account_recovered')) then
    return jsonb_build_object('mode', 'immediate');
  end if;
  -- scheduled: signed out everywhere, hidden, sign-in refused until the purge (the guard keeps the ban), deleted later
  v_purge := now() + private.account_security_rule('deletion_delay');
  select profile_hidden into v_hidden from profiles where id = user_id_param;
  insert into private.account_deletion_requests (user_id, requested_at, purge_at, session_id, previous_profile_hidden, status)
  values (user_id_param, now(), v_purge, session_id_param, v_hidden, 'pending')
  on conflict (user_id) do update set requested_at = now(), purge_at = excluded.purge_at, session_id = excluded.session_id,
    previous_profile_hidden = excluded.previous_profile_hidden, status = 'pending', resolved_at = null, resolved_by = null;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set profile_hidden = true where id = user_id_param;
  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: the caller's value, not 'false'
  update auth.users set banned_until = greatest(coalesce(banned_until, v_purge + interval '1 day'), v_purge + interval '1 day')
  where id = user_id_param;
  delete from auth.sessions where user_id = user_id_param;
  perform private.account_security_notice(user_id_param, 'deletion_scheduled', to_char(v_purge, 'FMMonth FMDD, YYYY'));
  return jsonb_build_object('mode', 'scheduled', 'purge_at', v_purge);
end;
$function$;
revoke all on function public.account_deletion_authorize(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.account_deletion_authorize(uuid, uuid, text) to service_role;

-- due scheduled deletions (a hold pauses them: recovery in progress)
create or replace function public.account_deletions_due()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select d.user_id from private.account_deletion_requests d
  where d.status = 'pending' and d.purge_at <= now() and not private.recovery_hold_active(d.user_id)
  order by d.purge_at limit 50;
$function$;
revoke all on function public.account_deletions_due() from public, anon, authenticated;
grant execute on function public.account_deletions_due() to service_role;

create or replace function public.account_deletion_finished(user_id_param uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update private.account_deletion_requests set status = 'done', resolved_at = now() where user_id = user_id_param and status = 'pending';
$function$;
revoke all on function public.account_deletion_finished(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_finished(uuid) to service_role;

-- hourly: ask delete-account to purge what is due (no key configured = nothing happens, never an error)
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

-- 9. Recovery (D3) --------------------------------------------------------------------------------------------------------
create table if not exists private.account_recovery_admins (
  user_id uuid primary key,
  added_at timestamptz not null default now(),
  note text
);
revoke all on private.account_recovery_admins from public, anon, authenticated;   -- the owner adds rows by SQL only

create table if not exists private.account_recovery_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                          -- the recovery admin; null = the system (hold expiry)
  user_id uuid not null,
  action text not null check (action in ('case_opened', 'hold_placed', 'hold_extended', 'hold_released', 'hold_expired',
                                         'account_recovered', 'deletion_cancelled')),
  case_id uuid,
  evidence text[] not null default '{}',
  note text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists account_recovery_audit_user on private.account_recovery_audit (user_id, at desc);
revoke all on private.account_recovery_audit from public, anon, authenticated;
create or replace function private._account_recovery_audit_append_only()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'DELETE' and old.at < now() - interval '24 months' then return old; end if;   -- the purge only
  raise exception 'The recovery audit is append-only' using errcode = '42501';
end;
$function$;
revoke all on function private._account_recovery_audit_append_only() from public, anon, authenticated;
drop trigger if exists account_recovery_audit_append_only on private.account_recovery_audit;
create trigger account_recovery_audit_append_only before update or delete on private.account_recovery_audit
  for each row execute function private._account_recovery_audit_append_only();

-- the case queue knows account_recovery cases (subject = the account)
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'account_recovery'));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile', 'suspended_number_reused',
                    'recovery_request'));
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null)
         and (signal in ('behavior', 'report', 'prior_suspension', 'account_recovery')) = (subject_user is not null));
create unique index if not exists account_review_cases_one_open_recovery on private.account_review_cases (subject_user)
  where status = 'open' and signal = 'account_recovery';

-- recovery admins only: admin + on the allow-list + aal2 if they have a second factor
create or replace function private.require_recovery_admin()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v uuid := private.require_admin();
begin
  if not exists (select 1 from private.account_recovery_admins a where a.user_id = v) then
    raise exception 'Recovery admins only' using errcode = '42501', hint = 'recovery_admin_only';
  end if;
  if not private.meets_second_factor(v, auth.jwt() ->> 'aal') then
    raise exception 'Verify with your second factor first' using errcode = '42501', hint = 'mfa_required';
  end if;
  return v;
end;
$function$;
revoke all on function private.require_recovery_admin() from public, anon, authenticated;

create or replace function private.recovery_text(p text, p_min integer)
returns text
language plpgsql
immutable
as $function$
declare
  v text := nullif(btrim(coalesce(p, '')), '');
begin
  if v is null or length(v) < p_min or length(v) > 1000 then
    raise exception 'Write at least % characters (at most 1000)', p_min using errcode = '22023', hint = 'note_required';
  end if;
  return v;
end;
$function$;
revoke all on function private.recovery_text(text, integer) from public, anon, authenticated;

-- an open account_recovery case for that account, or an error
create or replace function private.open_recovery_case(p_user uuid, p_case uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from private.account_review_cases c where c.id = p_case and c.signal = 'account_recovery'
                   and c.subject_user = p_user and c.status = 'open') then
    raise exception 'Open a recovery case for this account first' using errcode = '22023', hint = 'recovery_case_required';
  end if;
end;
$function$;
revoke all on function private.open_recovery_case(uuid, uuid) from public, anon, authenticated;

-- sign-in back to what the account's other state says (suspension keeps its own ban; the guard keeps any floor)
create or replace function private.reset_account_ban(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not private.account_suspended(p_user) then
    update auth.users set banned_until = null where id = p_user;      -- the guard raises it again if a floor remains
  end if;
end;
$function$;
revoke all on function private.reset_account_ban(uuid) from public, anon, authenticated;

create or replace function public.admin_open_account_recovery(user_id_param uuid, note_param text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_recovery_admin();
  v_note text := private.recovery_text(note_param, 30);
  v_case uuid;
begin
  if user_id_param = v_admin then raise exception 'Not your own account' using errcode = '42501', hint = 'recovery_self'; end if;
  if not exists (select 1 from auth.users where id = user_id_param) then raise exception 'Account not found' using errcode = 'P0002'; end if;
  select id into v_case from private.account_review_cases where subject_user = user_id_param and signal = 'account_recovery' and status = 'open';
  if v_case is null then
    insert into private.account_review_cases (signal, sha256, reason, subject_user)
    values ('account_recovery', null, 'recovery_request', user_id_param) returning id into v_case;
  end if;
  insert into private.account_recovery_audit (actor, user_id, action, case_id, note) values (v_admin, user_id_param, 'case_opened', v_case, v_note);
  return v_case;
end;
$function$;
revoke all on function public.admin_open_account_recovery(uuid, text) from public, anon;
grant execute on function public.admin_open_account_recovery(uuid, text) to authenticated;

create or replace function public.admin_place_recovery_hold(user_id_param uuid, case_id_param uuid, reason_param text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_recovery_admin();
  v_reason text := private.recovery_text(reason_param, 30);
  v_exp timestamptz := now() + private.account_security_rule('hold');
begin
  if user_id_param = v_admin then raise exception 'Not your own account' using errcode = '42501', hint = 'recovery_self'; end if;
  perform private.open_recovery_case(user_id_param, case_id_param);
  perform private.expire_recovery_holds();
  if private.recovery_hold_active(user_id_param) then
    raise exception 'A hold is already in place' using errcode = '22023', hint = 'hold_exists';
  end if;
  insert into private.account_recovery_holds (user_id, case_id, placed_by, expires_at) values (user_id_param, case_id_param, v_admin, v_exp);
  update auth.users set banned_until = greatest(coalesce(banned_until, v_exp), v_exp) where id = user_id_param;  -- never shorter
  delete from auth.sessions where user_id = user_id_param;
  update private.account_step_ups set consumed_at = now() where user_id = user_id_param and consumed_at is null;
  insert into private.account_recovery_audit (actor, user_id, action, case_id, note, detail)
  values (v_admin, user_id_param, 'hold_placed', case_id_param, v_reason, jsonb_build_object('expires_at', v_exp));
  perform private.account_security_notice(user_id_param, 'recovery_hold');
  return v_exp;
end;
$function$;
revoke all on function public.admin_place_recovery_hold(uuid, uuid, text) from public, anon;
grant execute on function public.admin_place_recovery_hold(uuid, uuid, text) to authenticated;

create or replace function public.admin_extend_recovery_hold(user_id_param uuid, reason_param text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_recovery_admin();
  v_reason text := private.recovery_text(reason_param, 30);
  h private.account_recovery_holds;
  v_exp timestamptz;
begin
  select * into h from private.account_recovery_holds where user_id = user_id_param and released_at is null and expires_at > now() for update;
  if not found then raise exception 'No hold in place' using errcode = '22023', hint = 'no_hold'; end if;
  v_exp := least(now() + private.account_security_rule('hold'), h.placed_at + private.account_security_rule('hold_max'));
  if v_exp <= h.expires_at then
    raise exception 'The hold has reached its limit' using errcode = '22023', hint = 'hold_limit';
  end if;
  update private.account_recovery_holds set expires_at = v_exp, extensions = extensions + 1 where id = h.id;
  update auth.users set banned_until = greatest(coalesce(banned_until, v_exp), v_exp) where id = user_id_param;
  insert into private.account_recovery_audit (actor, user_id, action, case_id, note, detail)
  values (v_admin, user_id_param, 'hold_extended', h.case_id, v_reason, jsonb_build_object('expires_at', v_exp));
  return v_exp;
end;
$function$;
revoke all on function public.admin_extend_recovery_hold(uuid, text) from public, anon;
grant execute on function public.admin_extend_recovery_hold(uuid, text) to authenticated;

create or replace function public.admin_release_recovery_hold(user_id_param uuid, reason_param text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_recovery_admin();
  v_reason text := private.recovery_text(reason_param, 30);
  h private.account_recovery_holds;
begin
  select * into h from private.account_recovery_holds where user_id = user_id_param and released_at is null for update;
  if not found then raise exception 'No hold in place' using errcode = '22023', hint = 'no_hold'; end if;
  update private.account_recovery_holds set released_at = now(), released_by = v_admin, release_reason = v_reason where id = h.id;
  perform private.reset_account_ban(user_id_param);
  insert into private.account_security_events (user_id, kind) values (user_id_param, 'recovery_hold_released');
  insert into private.account_recovery_audit (actor, user_id, action, case_id, note) values (v_admin, user_id_param, 'hold_released', h.case_id, v_reason);
end;
$function$;
revoke all on function public.admin_release_recovery_hold(uuid, text) from public, anon;
grant execute on function public.admin_release_recovery_hold(uuid, text) to authenticated;

-- holds end by themselves at their limit (never silently renewed)
create or replace function private.expire_recovery_holds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h record;
  n integer := 0;
begin
  for h in select id, user_id, case_id from private.account_recovery_holds where released_at is null and expires_at <= now() for update skip locked loop
    update private.account_recovery_holds set released_at = now(), release_reason = 'expired' where id = h.id;
    perform private.reset_account_ban(h.user_id);
    insert into private.account_recovery_audit (user_id, action, case_id) values (h.user_id, 'hold_expired', h.case_id);
    n := n + 1;
  end loop;
  return n;
end;
$function$;
revoke all on function private.expire_recovery_holds() from public, anon, authenticated;

-- Recover an account. Evidence (all enforced): an open recovery case; a takeover signal in the last 30 days (no claim on a
-- quiet account: a recycled number alone is never enough); at least ONE strong independent item (carrier confirmation of a
-- SIM swap / port-out, a passkey registered before the event, a match to an ID verified earlier); a trusted device only
-- supports, never decides; a note. To RESTORE a number the claimant proves control of it by signing in with it: Auth creates
-- a fresh account for that number (proof_account), which must be new (after the account's last number change) and empty of
-- anything but a profile; it is deleted and the number goes back to the account.
create or replace function public.admin_recover_account(user_id_param uuid, case_id_param uuid, evidence_param text[],
                                                       note_param text, proof_account_param uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_recovery_admin();
  v_note text := private.recovery_text(note_param, 30);
  v_evidence text[] := (select coalesce(array_agg(distinct e order by e), '{}') from unnest(coalesce(evidence_param, '{}')) e);
  v_last_change timestamptz;
  v_proof auth.users;
  v_restored text;
  v_deletion boolean := false;
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
begin
  if user_id_param = v_admin or proof_account_param = v_admin then
    raise exception 'Not your own account' using errcode = '42501', hint = 'recovery_self';
  end if;
  perform private.open_recovery_case(user_id_param, case_id_param);
  if not v_evidence <@ array['carrier_confirmation', 'prior_passkey', 'prior_id_match', 'pre_event_device'] then
    raise exception 'Unknown evidence' using errcode = '22023', hint = 'evidence_unknown';
  end if;
  if not v_evidence && array['carrier_confirmation', 'prior_passkey', 'prior_id_match'] then
    raise exception 'At least one independent proof is needed (a trusted device alone is not enough)' using errcode = '22023',
      hint = 'evidence_insufficient';
  end if;
  if not exists (select 1 from private.account_security_events e where e.user_id = user_id_param
                   and e.created_at > now() - private.account_security_rule('takeover_signal')
                   and e.kind in ('new_sign_in_elsewhere', 'phone_changed', 'phone_change_refused', 'password_add_refused',
                                  'email_add_refused', 'step_up_failed', 'deletion_scheduled', 'recovery_hold')) then
    raise exception 'This account shows no recent takeover signal' using errcode = '22023', hint = 'no_takeover_signal';
  end if;
  if proof_account_param is null and exists (select 1 from private.account_security_events e where e.user_id = user_id_param
       and e.kind = 'phone_changed' and e.created_at > now() - private.account_security_rule('takeover_signal')) then
    raise exception 'The number was changed recently: restore it with a proof account' using errcode = '22023',
      hint = 'proof_account_required';
  end if;
  if proof_account_param is not null then
    select max(created_at) into v_last_change from private.account_security_events
    where user_id = user_id_param and kind = 'phone_changed';
    select * into v_proof from auth.users where id = proof_account_param for update;
    if not found or proof_account_param = user_id_param or coalesce(v_proof.phone, '') = '' or v_proof.phone_confirmed_at is null
       or v_proof.created_at < now() - interval '7 days'
       or (v_last_change is not null and v_proof.created_at < v_last_change)
       or exists (select 1 from gatherings g where g.host_id = proof_account_param)
       or exists (select 1 from friendships f where f.user_a = proof_account_param or f.user_b = proof_account_param) then
      raise exception 'The proof account is not a fresh sign-in with the original number' using errcode = '22023',
        hint = 'proof_account_invalid';
    end if;
    v_restored := v_proof.phone;
    insert into private.account_recovery_marker (txid) values (txid_current()) on conflict do nothing;
    delete from auth.users where id = proof_account_param;
    update auth.users set phone = v_restored, phone_confirmed_at = now(), phone_change = '', phone_change_token = '',
      phone_change_sent_at = null where id = user_id_param;
    delete from private.account_recovery_marker where txid = txid_current();
  end if;
  -- a scheduled deletion stops; the profile goes back as it was
  if exists (select 1 from private.account_deletion_requests where user_id = user_id_param and status = 'pending') then
    v_deletion := true;
    update private.account_deletion_requests set status = 'cancelled', resolved_at = now(), resolved_by = v_admin
    where user_id = user_id_param;
    perform set_config('app.trusted_update', 'true', true);
    update profiles set profile_hidden = coalesce((select previous_profile_hidden from private.account_deletion_requests
                                                   where user_id = user_id_param), false)
    where id = user_id_param and not private.account_suspended(user_id_param);
    perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: the caller's value, not 'false'
    insert into private.account_security_events (user_id, kind) values (user_id_param, 'deletion_cancelled');
    insert into private.account_recovery_audit (actor, user_id, action, case_id, evidence, note)
    values (v_admin, user_id_param, 'deletion_cancelled', case_id_param, v_evidence, v_note);
  end if;
  update private.account_recovery_holds set released_at = now(), released_by = v_admin, release_reason = 'recovered'
  where user_id = user_id_param and released_at is null;
  delete from auth.sessions where user_id = user_id_param;
  update private.account_step_ups set consumed_at = now() where user_id = user_id_param and consumed_at is null;
  perform private.reset_account_ban(user_id_param);
  insert into private.account_recovery_audit (actor, user_id, action, case_id, evidence, note, detail)
  values (v_admin, user_id_param, 'account_recovered', case_id_param, v_evidence, v_note,
          jsonb_build_object('number_restored', v_restored is not null, 'deletion_cancelled', v_deletion));
  insert into private.account_review_case_events (case_id, actor, kind, subject, detail)
  values (case_id_param, v_admin, 'note', user_id_param, jsonb_build_object('recovered', true, 'evidence', v_evidence));
  perform private.account_security_notice(user_id_param, 'account_recovered');
  return jsonb_build_object('recovered', true, 'number_restored', v_restored is not null, 'deletion_cancelled', v_deletion);
end;
$function$;
revoke all on function public.admin_recover_account(uuid, uuid, text[], text, uuid) from public, anon;
grant execute on function public.admin_recover_account(uuid, uuid, text[], text, uuid) to authenticated;

-- 10. Readers (admins only) -----------------------------------------------------------------------------------------------
create or replace function public.admin_get_account_security_events(user_id_param uuid)
returns table (kind text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform private.require_admin();
  return query select e.kind, e.created_at from private.account_security_events e
    where e.user_id = user_id_param order by e.created_at desc, e.id desc limit 200;
end;
$function$;
revoke all on function public.admin_get_account_security_events(uuid) from public, anon;
grant execute on function public.admin_get_account_security_events(uuid) to authenticated;

create or replace function public.admin_get_account_recovery(user_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform private.require_recovery_admin();
  return jsonb_build_object(
    'hold', (select to_jsonb(h) - 'user_id' from private.account_recovery_holds h where h.user_id = user_id_param and h.released_at is null),
    'deletion', (select jsonb_build_object('status', d.status, 'requested_at', d.requested_at, 'purge_at', d.purge_at)
                 from private.account_deletion_requests d where d.user_id = user_id_param),
    'sessions', (select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'established',
                   s.created_at <= now() - private.account_security_rule('established_session')) order by s.created_at)
                 from auth.sessions s where s.user_id = user_id_param),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'evidence', a.evidence, 'note', a.note)
                                        order by a.at desc), '[]'::jsonb)
              from private.account_recovery_audit a where a.user_id = user_id_param));
end;
$function$;
revoke all on function public.admin_get_account_recovery(uuid) from public, anon;
grant execute on function public.admin_get_account_recovery(uuid) to authenticated;

-- 11. Retention + jobs ----------------------------------------------------------------------------------------------------
create or replace function private.purge_account_security_events()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
revoke all on function private.purge_account_security_events() from public, anon, authenticated;
select cron.schedule('purge-account-security-events', '53 4 * * *', 'select private.purge_account_security_events();');
select cron.schedule('expire-recovery-holds', '*/15 * * * *', 'select private.expire_recovery_holds();');
select cron.schedule('request-due-deletions', '17 * * * *', 'select private.request_due_deletions();');
