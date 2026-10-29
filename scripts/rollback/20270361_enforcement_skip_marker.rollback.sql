-- Rollback for migration 20270361: puts the four checks and the two functions back exactly as after 20270360 (skip on the
-- flag), then drops the marker functions and table. Re-opens the forged-flag skip; only if a legitimate write is wrongly limited.

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
  if v_uid is null or coalesce(current_setting('app.trusted_update', true), '') = 'true' then return; end if;
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
     or coalesce(current_setting('app.trusted_update', true), '') = 'true' then
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
     or coalesce(current_setting('app.trusted_update', true), '') = 'true' then
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
  if coalesce(current_setting('app.trusted_update', true), '') = 'true' then
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
  update profiles set photo_url = v_extra.photo_url, photo_verified = coalesce(v_extra.photo_verified, false),
    photo_object_id = v_extra.screened_object_id where id = v_me;
  if v_main_url is not null then
    update profile_photos set photo_url = v_main_url, photo_verified = v_main_verified, screened_object_id = v_main_object
      where id = v_extra.id;
  else
    delete from profile_photos where id = v_extra.id;
  end if;
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

  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: the caller's value, not 'false'

  select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = target_user_id;
  if v_recipient_wants_notif then
    select display_name into v_my_name from profiles where id = v_me;
    perform public._send_push(target_user_id, 'New friend!', 'You and ' || coalesce(v_my_name, 'someone') || ' are now friends on Nearby. 🎉', jsonb_build_object('type', 'friend_discovery_match', 'match_id', v_match_id));
  end if;

  return query select true, v_match_id;
end;
$function$;

drop function if exists private.trusted_write_active();
drop function if exists private.unmark_trusted_write();
drop function if exists private.mark_trusted_write();
drop table if exists private.trusted_write_marker;
