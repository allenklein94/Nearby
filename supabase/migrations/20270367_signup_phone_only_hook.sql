-- New accounts only by phone (owner, 2026-10-30; STAGED, NOT DEPLOYED). Nearby signs people up only by phone code, but
-- Supabase Auth still created accounts for anyone calling its API with an email (sign-up, or an email code/magic link for
-- an unknown address). This function is Supabase Auth's "before user created" hook: it allows a new account only when it
-- is a phone sign-up (provider 'phone', a phone number, no email) and refuses every other new account (email, OAuth/SSO,
-- anonymous) with 403. It decides NEW accounts only: Auth calls it only before creating a user (checked in Supabase Auth's
-- source: signup / OTP / magic-link sign-up / invite + generateLink signup, external providers; NOT the admin API's
-- createUser, NOT sign-in), so every existing account, its email or phone sign-in, the App Review magic link, password
-- reset and the admin API are untouched.
-- Inert until switched on in Auth (hook_before_user_created_* via scripts/trust-safety/signup-hook-settings.js, its own
-- approval); switch it off BEFORE rolling this back (a configured hook whose function is gone refuses every sign-up).
-- Pure: reads only the event, writes nothing, never raises (any error here would refuse phone sign-ups too).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $function$
declare
  u jsonb := coalesce(event -> 'user', '{}'::jsonb);
begin
  if coalesce(u -> 'app_metadata' ->> 'provider', '') = 'phone'
     and coalesce(u ->> 'phone', '') <> ''
     and coalesce(u ->> 'email', '') = '' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'New Nearby accounts are created with a phone number in the Nearby app.'));
end;
$function$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
