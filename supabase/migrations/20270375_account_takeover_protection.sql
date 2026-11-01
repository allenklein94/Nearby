-- Account takeover through a phone number (SIM swap / a number someone else controls): owner exception to the freeze,
-- 2026-10-31. Staged after 20270374; its own deploy approval. Proven on Supabase Auth v2.197.0 (= production) with
-- production's settings (scripts/replay/account-takeover-auth-local.js): whoever gets one SMS code for an account's number
-- gets a session (inherent to SMS sign-in), and from that session could, before this migration:
--   V1 move the account to their own number: Auth asks only the NEW number for a code; the owner's number then opens a
--      new, empty account (full takeover, the owner is locked out for good);
--   V2 set a password on a phone-only account: Auth ends every OTHER session (the owner is signed out) and the intruder
--      can come back by phone + password with no SMS, even after the owner gets their number back;
--   V3 add an email to a phone-only account: the confirmation goes only to the new (intruder's) address, giving a second
--      way in (email code / magic link / password reset);
--   V4 after V3, enrol an authenticator app: the owner can then neither remove it nor change phone, email or password
--      (Auth requires AAL2 for both).
-- The app offers none of V2-V4 (no password or email on a phone account, no authenticator) and V1 only from Settings.
-- What this does (smallest change; sign-up, sign-in and the app's flows unchanged):
--   1. A phone-only account (no email) can never gain a password or an email through Auth: the change is quietly not
--      saved (BEFORE UPDATE on auth.users; Auth goes on, nothing is raised inside Auth). Closes V2, V3 and so V4.
--   2. A phone-number change (starting it, or the number itself changing) is not saved while the account's latest
--      sign-in is less than 24 hours old (a fresh sign-in = maybe a new device; a token refresh is not a sign-in).
--      Someone who just got in with a stolen code has to keep the account a full day before moving it, while the owner
--      is told (3) and can sign out every session from Settings. The app asks first (get_my_phone_change_wait) and says
--      when to try again; a number change from a long-signed-in phone works as before. Narrows V1.
--   3. A security notice: a new sign-in while the account is signed in elsewhere, and a completed number change, send ONE
--      push to the account ("account_security_notice", never muted, no name, place or device) and are recorded.
--   4. Every refused change and every notice is recorded privately (private.account_security_events, 12 months), read
--      only by admins (admin_get_account_security_events). Nothing reaches another person.
-- Never: an automatic restriction, a public signal, a device fingerprint or IP kept, an error inside Auth.
-- Limits: SMS alone can't stop the sign-in itself; an intruder who waits 24 h while the owner has no signed-in device
-- (no notice reaches them) can still move the number; a support/admin change through Auth's admin API obeys the same
-- rules (an operator works around them only as the database owner).

-- 1. The private record --------------------------------------------------------------------------------------------------
create table if not exists private.account_security_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,               -- no foreign key: kept (12 months) even if the account is deleted
  kind text not null check (kind in ('password_add_refused', 'email_add_refused', 'phone_change_refused',
                                     'phone_changed', 'new_sign_in_elsewhere', 'guard_failure')),
  sqlstate text,                       -- guard_failure only
  created_at timestamptz not null default now()
);
create index if not exists account_security_events_user on private.account_security_events (user_id, created_at desc);
revoke all on private.account_security_events from public, anon, authenticated;

-- The one rule for "too soon after a sign-in": the time a number change becomes possible, or null when it is now.
create or replace function private.phone_change_allowed_at(p_last_sign_in timestamptz)
returns timestamptz
language sql
stable
set search_path to 'public'
as $function$
  select case when p_last_sign_in is not null and p_last_sign_in > now() - interval '24 hours'
              then p_last_sign_in + interval '24 hours' end;
$function$;
revoke all on function private.phone_change_allowed_at(timestamptz) from public, anon, authenticated;

-- 2. The guard on auth.users (BEFORE UPDATE: fixes the row, never raises) -------------------------------------------------
create or replace function private._auth_user_takeover_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone_only boolean := coalesce(old.email, '') = '';
  v_too_soon boolean;
begin
  begin
    v_too_soon := private.phone_change_allowed_at(old.last_sign_in_at) is not null;
    -- 1. a phone-only account never gains a password
    if v_phone_only and new.encrypted_password is distinct from old.encrypted_password then
      new.encrypted_password := old.encrypted_password;
      insert into private.account_security_events (user_id, kind) values (old.id, 'password_add_refused');
    end if;
    -- 1. ...nor an email (set directly or as a pending change)
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
    -- 2. no number change within 24 hours of a sign-in: neither starting one nor the number itself
    if v_too_soon and ((coalesce(new.phone_change, '') <> '' and new.phone_change is distinct from old.phone_change)
                       or (old.phone is not null and new.phone is distinct from old.phone)) then
      new.phone_change := old.phone_change;
      new.phone_change_token := old.phone_change_token;
      new.phone_change_sent_at := old.phone_change_sent_at;
      new.phone := old.phone;
      new.phone_confirmed_at := old.phone_confirmed_at;
      insert into private.account_security_events (user_id, kind) values (old.id, 'phone_change_refused');
    end if;
  exception when others then
    -- fail closed on the sensitive fields, never block Auth
    new.encrypted_password := case when v_phone_only then old.encrypted_password else new.encrypted_password end;
    new.phone := old.phone; new.phone_confirmed_at := old.phone_confirmed_at;
    new.phone_change := old.phone_change; new.phone_change_token := old.phone_change_token;
    if v_phone_only then new.email := old.email; new.email_change := old.email_change; end if;
    insert into private.account_security_events (user_id, kind, sqlstate) values (old.id, 'guard_failure', sqlstate);
  end;
  return new;
end;
$function$;
revoke all on function private._auth_user_takeover_guard() from public, anon, authenticated;
drop trigger if exists aa_account_takeover_guard on auth.users;
create trigger aa_account_takeover_guard before update on auth.users
  for each row execute function private._auth_user_takeover_guard();

-- 3. The notice: one push to the account, no detail beyond what happened ---------------------------------------------------
create or replace function private.account_security_notice(p_user uuid, p_kind text)
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
  end if;
end;
$function$;
revoke all on function private.account_security_notice(uuid, text) from public, anon, authenticated;

-- a new sign-in (a new session) while another session of the same account was used in the last 30 days
create or replace function private._auth_session_created_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
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
    if old.phone is not null and old.phone <> '' and new.phone is distinct from old.phone then
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

-- 4. Readers ------------------------------------------------------------------------------------------------------------
-- The signed-in person: when their own number change becomes possible (null = now). Their own row only.
create or replace function public.get_my_phone_change_wait()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select private.phone_change_allowed_at(u.last_sign_in_at) from auth.users u where u.id = auth.uid();
$function$;
revoke all on function public.get_my_phone_change_wait() from public, anon;
grant execute on function public.get_my_phone_change_wait() to authenticated;

-- Admins only: one account's security events (kind + time; nothing else is kept).
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

-- 12 months, then gone
create or replace function private.purge_account_security_events()
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  with d as (delete from private.account_security_events where created_at < now() - interval '12 months' returning 1)
  select count(*)::integer from d;
$function$;
revoke all on function private.purge_account_security_events() from public, anon, authenticated;
select cron.schedule('purge-account-security-events', '53 4 * * *', 'select private.purge_account_security_events();');
