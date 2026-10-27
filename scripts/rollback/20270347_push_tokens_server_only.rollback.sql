-- Rollback for migration 20270347 (push + Spotify tokens server-only). It is the OLDEST of the trust & safety set: when rolling back the
-- whole set, run it LAST (newest first: 20270353 -> 20270347). It puts every stored token back into profiles, so after it the N1 exposure (any signed-in user can
-- read other people's push tokens) is open again. Operational note: send-push keeps working either way (it falls back to
-- profiles.expo_push_token when push_token_for_delivery is missing).

lock table public.profiles in share row exclusive mode;

drop trigger if exists profiles_push_token_server_only on public.profiles;
drop trigger if exists profiles_spotify_tokens_owner_only on public.profiles;
alter table public.profiles drop constraint if exists profiles_client_secrets_never_stored;

select set_config('app.trusted_update', 'true', true);
update public.profiles p set expo_push_token = t.expo_push_token
from private.push_tokens t where t.user_id = p.id;
update public.profiles p set spotify_access_token = s.access_token, spotify_refresh_token = s.refresh_token,
  spotify_token_expires_at = s.expires_at
from public.spotify_connections s where s.user_id = p.id;
select set_config('app.trusted_update', '', true);

drop function if exists public.push_token_for_delivery(uuid);
drop function if exists private.profiles_move_push_token();
drop function if exists private.profiles_move_spotify_tokens();
drop table if exists public.spotify_connections;
drop table if exists private.push_tokens;

grant select on public.profiles to anon;
