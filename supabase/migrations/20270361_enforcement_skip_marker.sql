-- Enforcement skips no longer trust app.trusted_update (owner security review, 2026-10-29; staged after 20270360, deploy only
-- with its own approval).
--
-- 20270360 made the column guards ignore a flag forged by a client role. Four checks still SKIPPED enforcement when the flag
-- was 'true': the 0356 rate limits (private.enforce_rate_limit, used by every zz_rate_limit trigger), the name / photo
-- change limit, the extra-photo limit and the friend-request daily limit. A client role that sets the flag with set_config
-- (not reachable through the API today) would have skipped them. These run as definer functions, where current_user is
-- always the owner, so 0360's caller-role test cannot be used without giving client roles access to the private schema.
--
-- Instead the skip needs a marker clients cannot create: a row in private.trusted_write_marker for the CURRENT transaction
-- (txid_current()), written only by private.mark_trusted_write() (definer, no client EXECUTE, no client grant on the table,
-- and anon / authenticated have no USAGE on schema private). Only the two server paths that legitimately skip a limit set it,
-- inside their 0359 trusted scope, and remove it before handing back the caller's flag:
--   swap_main_photo                 reordering photos already uploaded is not a new photo change
--   record_friend_discovery_swipe   a mutual like is not a friend request
-- No other flag-setting function writes a rate-limited table for a signed-in person (checked against every write made under
-- trust), so behaviour is otherwise unchanged. A nested call keeps its caller's marker (on conflict do nothing; only the call
-- that created it removes it). A failed statement undoes the marker with its (sub)transaction.
-- Bodies otherwise byte-identical to after 20270360 (owner, security, search_path, grants kept).
-- Note: a session with raw SQL as a client role can also set request.jwt.claims (auth.uid()); the database cannot defend
-- every rule against that, which is why the API boundary (no raw SQL, no set_config) stays the primary control.

create table if not exists private.trusted_write_marker (
  txid bigint primary key,
  created_at timestamptz not null default now()
);
revoke all on table private.trusted_write_marker from public, anon, authenticated;

create or replace function private.mark_trusted_write()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into private.trusted_write_marker (txid) values (txid_current()) on conflict (txid) do nothing;
  return found; -- false = a caller in this transaction already holds the marker (it removes it)
end;
$function$;
revoke all on function private.mark_trusted_write() from public, anon, authenticated;

create or replace function private.unmark_trusted_write()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.trusted_write_marker where txid = txid_current();
$function$;
revoke all on function private.unmark_trusted_write() from public, anon, authenticated;

create or replace function private.trusted_write_active()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from private.trusted_write_marker where txid = txid_current_if_assigned());
$function$;
revoke all on function private.trusted_write_active() from public, anon, authenticated;

-- private.enforce_rate_limit(text)
CREATE OR REPLACE FUNCTION private.enforce_rate_limit(p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_level text;
  r record;
begin
  if v_uid is null or private.trusted_write_active() /* 20270361: never the forgeable flag */ then return; end if;
  if not exists (select 1 from private.rate_limit_rules where action = p_action) then return; end if;  -- nothing approved
  v_level := private.trust_level(v_uid);
  if v_level = 'restricted' then return; end if;  -- 20270351 refuses it on its own terms
  for r in select window_seconds, max_count from private.rate_limit_rules
            where action = p_action and trust_level = v_level loop
    if private.rate_limit_count(p_action, v_uid, now() - make_interval(secs => r.window_seconds)) >= r.max_count then
      raise exception 'You''ve reached the limit for this for now. Please try again later.'
        using errcode = 'P0001', hint = 'rate_limited';
    end if;
  end loop;
end;
$function$;

-- public._rate_limit_profile_change()
CREATE OR REPLACE FUNCTION public._rate_limit_profile_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or auth.uid() is distinct from new.id
     or private.trusted_write_active() /* 20270361: never the forgeable flag */ then
    return new;
  end if;
  if old.display_name is not null and new.display_name is distinct from old.display_name then
    perform private.enforce_rate_limit('name_change');
    insert into private.limited_action_log (user_id, field) values (new.id, 'name');
  end if;
  if old.photo_url is not null and new.photo_url is not null and new.photo_url is distinct from old.photo_url then
    perform private.enforce_rate_limit('photo_change');
    insert into private.limited_action_log (user_id, field) values (new.id, 'photo');
  end if;
  return new;
end;
$function$;

-- public._rate_limit_extra_photo()
CREATE OR REPLACE FUNCTION public._rate_limit_extra_photo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or auth.uid() is distinct from new.user_id
     or private.trusted_write_active() /* 20270361: never the forgeable flag */ then
    return new;
  end if;
  if tg_op = 'INSERT' or new.photo_url is distinct from old.photo_url then
    perform private.enforce_rate_limit('photo_change');
    insert into private.limited_action_log (user_id, field) values (new.user_id, 'photo');
  end if;
  return new;
end;
$function$;

-- public.enforce_friend_request_daily_limit()
CREATE OR REPLACE FUNCTION public.enforce_friend_request_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 15;
begin
  if private.trusted_write_active() /* 20270361: never the forgeable flag */ then
    return new;
  end if;

  select friend_requests_sent_today, friend_requests_sent_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.requested_by for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can send up to % friend requests per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set friend_requests_sent_today = v_current_count + 1, friend_requests_sent_date = v_today_in_user_tz
  where id = new.requested_by;
  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: the caller's value, not 'false'

  return new;
end;
$function$;

-- public.swap_main_photo(uuid)
CREATE OR REPLACE FUNCTION public.swap_main_photo(extra_photo_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_marked boolean := false; -- 20270361: this call set the enforcement-skip marker
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
  v_me uuid := auth.uid();
  v_extra record;
  v_main_url text;
  v_main_verified boolean;
  v_main_object uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select id, photo_url, photo_verified, screened_object_id into v_extra from profile_photos where id = extra_photo_id_param and user_id = v_me for update;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  select photo_url, coalesce(photo_verified, false), photo_object_id into v_main_url, v_main_verified, v_main_object from profiles where id = v_me for update;

  perform set_config('app.trusted_update', 'true', true);
  v_marked := private.mark_trusted_write(); -- 20270361: skip rate / friend-request limits for this server write only
  update profiles set photo_url = v_extra.photo_url, photo_verified = coalesce(v_extra.photo_verified, false),
    photo_object_id = v_extra.screened_object_id where id = v_me;
  if v_main_url is not null then
    update profile_photos set photo_url = v_main_url, photo_verified = v_main_verified, screened_object_id = v_main_object
      where id = v_extra.id;
  else
    delete from profile_photos where id = v_extra.id;
  end if;
  if v_marked then perform private.unmark_trusted_write(); end if; -- 20270361
  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: the caller's value, not 'false'
end;
$function$;

-- public.record_friend_discovery_swipe(uuid,text)
CREATE OR REPLACE FUNCTION public.record_friend_discovery_swipe(target_user_id uuid, direction_param text)
 RETURNS TABLE(is_mutual_match boolean, match_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_marked boolean := false; -- 20270361: this call set the enforcement-skip marker
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
  v_me uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
  v_friendship_id uuid;
  v_match_id uuid;
  v_reverse_like_exists boolean;
  v_i_opted_in boolean;
  v_they_opted_in boolean;
  v_already_connected boolean;
  v_my_name text;
  v_recipient_wants_notif boolean;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if v_me = target_user_id then
    raise exception 'You cannot swipe on yourself';
  end if;
  if direction_param not in ('like', 'pass') then
    raise exception 'Invalid direction';
  end if;

  perform id from profiles where id in (least(v_me, target_user_id), greatest(v_me, target_user_id)) order by id for update;

  select open_to_friend_discovery into v_i_opted_in from profiles where id = v_me;
  select open_to_friend_discovery into v_they_opted_in from profiles where id = target_user_id;
  if not coalesce(v_i_opted_in, false) or not coalesce(v_they_opted_in, false) then
    return query select false, null::uuid;
    return;
  end if;

  if is_blocked(v_me, target_user_id) then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friendships f
    where (f.user_a = v_me and f.user_b = target_user_id) or (f.user_a = target_user_id and f.user_b = v_me)
  ) or exists (
    select 1 from matches m
    where (m.user_a = v_me and m.user_b = target_user_id) or (m.user_a = target_user_id and m.user_b = v_me)
  ) into v_already_connected;

  if v_already_connected then
    return query select false, null::uuid;
    return;
  end if;

  insert into friend_discovery_swipes (from_user, to_user, direction)
  values (v_me, target_user_id, direction_param)
  on conflict (from_user, to_user) do nothing;

  if direction_param = 'pass' then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friend_discovery_swipes
    where from_user = target_user_id and to_user = v_me and direction = 'like'
  ) into v_reverse_like_exists;

  if not v_reverse_like_exists then
    return query select false, null::uuid;
    return;
  end if;

  v_user_a := least(v_me, target_user_id);
  v_user_b := greatest(v_me, target_user_id);

  perform set_config('app.trusted_update', 'true', true);
  v_marked := private.mark_trusted_write(); -- 20270361: skip rate / friend-request limits for this server write only

  insert into friendships (user_a, user_b, status, requested_by)
  values (v_user_a, v_user_b, 'accepted', v_me)
  on conflict (user_a, user_b) do update set status = 'accepted'
  where friendships.status <> 'accepted'
  returning id into v_friendship_id;

  if v_friendship_id is null then
    select id into v_friendship_id from friendships where user_a = v_user_a and user_b = v_user_b;
  end if;

  insert into matches (user_a, user_b, source_friendship_id)
  values (v_user_a, v_user_b, v_friendship_id)
  on conflict (user_a, user_b) do update
    set source_friendship_id = coalesce(matches.source_friendship_id, excluded.source_friendship_id)
  returning id into v_match_id;

  if v_marked then perform private.unmark_trusted_write(); end if; -- 20270361

  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: the caller's value, not 'false'

  select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = target_user_id;
  if v_recipient_wants_notif then
    select display_name into v_my_name from profiles where id = v_me;
    perform public._send_push(target_user_id, 'New friend!', 'You and ' || coalesce(v_my_name, 'someone') || ' are now friends on Nearby. 🎉', jsonb_build_object('type', 'friend_discovery_match', 'match_id', v_match_id));
  end if;

  return query select true, v_match_id;
end;
$function$;

-- Nothing may skip enforcement on the flag any more, and the marker stays closed to clients.
do $check$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosrc ~ 'current_setting\(''app\.trusted_update'', true\), ''''\) = ''true''';
  if v_bad is not null then
    raise exception 'enforcement that a forged flag can skip: %', v_bad;
  end if;
  if has_table_privilege('authenticated', 'private.trusted_write_marker', 'insert,update,delete,select')
     or has_table_privilege('anon', 'private.trusted_write_marker', 'insert,update,delete,select')
     or has_function_privilege('authenticated', 'private.mark_trusted_write()', 'execute')
     or has_function_privilege('anon', 'private.mark_trusted_write()', 'execute') then
    raise exception 'the trusted-write marker must not be reachable by client roles';
  end if;
end
$check$;
