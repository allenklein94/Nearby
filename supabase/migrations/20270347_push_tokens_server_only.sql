-- Trust & safety N1 (owner, 2026-10-27, security blocker before external testing): device push tokens and Spotify tokens
-- are never readable by another user.
-- Proven before this migration, read-only under the real `authenticated` role: a signed-in user read 2 other accounts'
-- expo_push_token from public.profiles (and people_visible_to_me lists the same columns). profiles has a whole-table SELECT
-- grant and its read policy is row-level only. send-push sends to Expo without an access token, so a token is enough to
-- send a notification that looks like Nearby's.
-- Fix (smallest change that keeps every installed app working; build 86 reads profiles with select('*'), so column-level
-- grants would break it):
--   * the secrets move to tables no other user can read: private.push_tokens (no client grant at all) and
--     public.spotify_connections (owner-only RLS; the app reads its own Spotify tokens);
--   * the profiles columns stay but are ALWAYS NULL (check constraint). A client write to them still works: a trigger moves
--     the value into the new table, so an app that still writes profiles.expo_push_token (build 86, and the current client)
--     keeps registering and clearing its token. The column trigger fires on UPDATE OF the column, so a logout's
--     "set expo_push_token = null" still clears the stored token although the column already reads null;
--   * send-push reads the token through push_token_for_delivery() (service_role only), with a fallback to the old column
--     while this migration is not yet live;
--   * anon loses SELECT on profiles. Today anon is refused only by accident (the admin read policy calls check_is_admin,
--     which anon can't execute); nothing signed out reads profiles.
-- Existing data: the 3 stored push tokens (0 Spotify) move into private.push_tokens, then the columns are nulled. No other
-- column of any profile changes.

lock table public.profiles in share row exclusive mode;

create table if not exists private.push_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expo_push_token text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.push_tokens from public, anon, authenticated;

create table if not exists public.spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.spotify_connections enable row level security;
revoke all on public.spotify_connections from public, anon, authenticated;
grant select, insert, update, delete on public.spotify_connections to authenticated;
drop policy if exists "Own Spotify connection only" on public.spotify_connections;
create policy "Own Spotify connection only" on public.spotify_connections
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Backfill before the triggers exist (the column trigger would otherwise treat the nulling as a logout).
insert into private.push_tokens (user_id, expo_push_token)
select p.id, p.expo_push_token from public.profiles p
where nullif(btrim(p.expo_push_token), '') is not null and exists (select 1 from auth.users u where u.id = p.id)
on conflict (user_id) do update set expo_push_token = excluded.expo_push_token, updated_at = now();

insert into public.spotify_connections (user_id, access_token, refresh_token, expires_at)
select p.id, p.spotify_access_token, p.spotify_refresh_token, p.spotify_token_expires_at from public.profiles p
where (p.spotify_access_token is not null or p.spotify_refresh_token is not null)
  and exists (select 1 from auth.users u where u.id = p.id)
on conflict (user_id) do nothing;

select set_config('app.trusted_update', 'true', true);
update public.profiles set expo_push_token = null where expo_push_token is not null;
update public.profiles set spotify_access_token = null, spotify_refresh_token = null, spotify_token_expires_at = null
where spotify_access_token is not null or spotify_refresh_token is not null or spotify_token_expires_at is not null;
select set_config('app.trusted_update', '', true);

create or replace function private.profiles_move_push_token()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if nullif(btrim(new.expo_push_token), '') is null then
    if tg_op = 'UPDATE' then
      delete from private.push_tokens where user_id = new.id;
    end if;
  else
    insert into private.push_tokens (user_id, expo_push_token, updated_at)
    values (new.id, btrim(new.expo_push_token), now())
    on conflict (user_id) do update set expo_push_token = excluded.expo_push_token, updated_at = now();
  end if;
  new.expo_push_token := null;
  return new;
end;
$function$;
revoke all on function private.profiles_move_push_token() from public, anon, authenticated;

create or replace function private.profiles_move_spotify_tokens()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.spotify_access_token is null and new.spotify_refresh_token is null then
    if tg_op = 'UPDATE' then
      delete from public.spotify_connections where user_id = new.id;
    end if;
  else
    insert into public.spotify_connections (user_id, access_token, refresh_token, expires_at, updated_at)
    values (new.id, new.spotify_access_token, new.spotify_refresh_token, new.spotify_token_expires_at, now())
    on conflict (user_id) do update set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at, updated_at = now();
  end if;
  new.spotify_access_token := null;
  new.spotify_refresh_token := null;
  new.spotify_token_expires_at := null;
  return new;
end;
$function$;
revoke all on function private.profiles_move_spotify_tokens() from public, anon, authenticated;

drop trigger if exists profiles_push_token_server_only on public.profiles;
create trigger profiles_push_token_server_only
  before insert or update of expo_push_token on public.profiles
  for each row execute function private.profiles_move_push_token();

drop trigger if exists profiles_spotify_tokens_owner_only on public.profiles;
create trigger profiles_spotify_tokens_owner_only
  before insert or update of spotify_access_token, spotify_refresh_token, spotify_token_expires_at on public.profiles
  for each row execute function private.profiles_move_spotify_tokens();

alter table public.profiles drop constraint if exists profiles_client_secrets_never_stored;
alter table public.profiles add constraint profiles_client_secrets_never_stored check (
  expo_push_token is null and spotify_access_token is null and spotify_refresh_token is null
  and spotify_token_expires_at is null
);

-- The one reader of a push token: send-push (service role).
create or replace function public.push_token_for_delivery(recipient_param uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select t.expo_push_token from private.push_tokens t where t.user_id = recipient_param;
$function$;
revoke all on function public.push_token_for_delivery(uuid) from public, anon, authenticated;
grant execute on function public.push_token_for_delivery(uuid) to service_role;

revoke select on public.profiles from anon;
