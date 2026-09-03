-- Phase E of the "global onboarding->product wiring" master plan (see CLAUDE.md,
-- Sep 3 2026): the real 7-category notification taxonomy, minus the two categories
-- that stay honest placeholders (notify_things_to_do / notify_nearby_opportunities --
-- no consumer-facing push exists for either yet, matching notify_businesses_offers'
-- own Phase C precedent of adding the column before there's necessarily a UI reason
-- to flip it). notify_businesses_offers (Phase C) and notify_messages/notify_waves
-- already cover their own categories cleanly and are untouched here.
--
-- Every function body below was pulled fresh via the Management API before editing
-- (not reconstructed from an older local copy) -- every other line stays
-- byte-for-byte unchanged, only the flagged predicate/gate actually changed.
--
-- Real, previously-undocumented finding made while tracing every real INSERT INTO
-- matches path (there are exactly 6: approve_gathering_interest, check_mutual_notice,
-- create_match_on_friendship_accepted, join_gathering, leave_gathering,
-- record_friend_discovery_swipe -- confirmed via both a plain and a regex sweep of
-- every function body, not assumed): every one of those six now already has (or, as
-- part of this migration, gains) its own correctly-worded, correctly-gated push --
-- check_mutual_notice's real "It's a Match! 🎉" for a genuine dating match,
-- notify_gathering_approved's real approval/waitlist copy for a gathering-sourced
-- match, notify_friend_request_accepted's real copy for a friendship-sourced match,
-- and record_friend_discovery_swipe's own "New friend!" for a friend-discovery match
-- (already suppressed from the generic trigger below via app.trusted_update).
--
-- notify_new_match() -- the on_match_created trigger firing a second, generic
-- "New match! ... noticed each other. Say hi!" push on every single one of those six
-- inserts, dating-flavored regardless of the real source -- was therefore not
-- re-pointed to a new notify_dating column as the plan's own original shorthand
-- said. It was retired outright: it had become a pure duplicate-push bug, not a real
-- remaining notification job. Concretely, before this migration, a genuine dating
-- match sent BOTH "It's a Match! 🎉" and "New match! ... noticed each other" back to
-- back; an approved gathering request sent BOTH "You're approved!" and the same
-- generic line; an accepted friend request sent BOTH "Friend request accepted" and
-- the same generic line. All three are now single-push, correctly worded per real
-- origin. check_mutual_notice -- the one real surviving dating-match push -- is
-- re-pointed from notify_matches to the new notify_dating column.
--
-- notify_matches itself is left in place, untouched, unread by anything new --
-- matching this schema's own "don't delete legacy data, just stop asking" rule --
-- but its one real client caller (SettingsScreen.js's old single "New Matches" row)
-- is retired in the same pass as this migration, in favor of the new, more precise
-- toggles.

alter table profiles
  add column if not exists notify_things_to_do boolean not null default true,
  add column if not exists notify_friends boolean not null default true,
  add column if not exists notify_dating boolean not null default true,
  add column if not exists notify_plans boolean not null default true,
  add column if not exists notify_nearby_opportunities boolean not null default true;

-- Re-point: gathering interest/approval notices move from the overloaded
-- notify_matches to the real notify_plans category. Every other line unchanged.
create or replace function public.notify_gathering_interest()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  gathering_host_id uuid;
  gathering_title text;
  interested_user_name text;
  host_wants_notif boolean;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select host_id, title into gathering_host_id, gathering_title from gatherings where id = new.gathering_id;
  select display_name into interested_user_name from profiles where id = new.user_id;
  select coalesce(notify_plans, true) into host_wants_notif from profiles where id = gathering_host_id;

  if host_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', gathering_host_id,
        'title', 'New interest in your gathering',
        'body', interested_user_name || ' is interested in "' || gathering_title || '"',
        'data', jsonb_build_object('type', 'gathering_interest')
      )
    );
  end if;
  return new;
end;
$function$;

create or replace function public.notify_gathering_approved()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  gathering_title text;
  interested_user_wants_notif boolean;
  service_key text;
begin
  if new.status = 'approved' and old.status in ('pending', 'waitlisted') then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_plans, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', case when old.status = 'waitlisted' then 'A spot opened up!' else 'You''re approved!' end,
          'body', case when old.status = 'waitlisted'
            then 'A spot opened up in "' || gathering_title || '" and you''re in! Start chatting!'
            else 'The host of "' || gathering_title || '" approved your interest. Start chatting!' end,
          'data', jsonb_build_object('type', 'gathering_approved', 'match_id', new.match_id)
        )
      );
    end if;
  elsif new.status = 'waitlisted' and old.status = 'pending' then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_plans, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', 'Added to the waitlist',
          'body', '"' || gathering_title || '" is full, but you''re on the waitlist — we''ll let you know if a spot opens.',
          'data', jsonb_build_object('type', 'gathering_waitlisted', 'gathering_id', new.gathering_id)
        )
      );
    end if;
  end if;
  return new;
end;
$function$;

-- Close a real, previously-ungated push: notify_friend_request() sent
-- unconditionally with zero preference check of any kind. Now gated on the new
-- notify_friends column, matching notify_business_update()'s own Phase C precedent
-- for exactly this shape of gap.
create or replace function public.notify_friend_request()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  v_requester_name text;
  v_recipient uuid;
  v_recipient_wants_notif boolean;
begin
  if new.status = 'pending' then
    v_recipient := case when new.user_a = new.requested_by then new.user_b else new.user_a end;
    select coalesce(notify_friends, true) into v_recipient_wants_notif from profiles where id = v_recipient;
    if not v_recipient_wants_notif then
      return new;
    end if;

    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_requester_name from profiles where id = new.requested_by;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_recipient,
        'title', 'New friend request',
        'body', coalesce(v_requester_name, 'Someone') || ' wants to be friends on Nearby.',
        'data', jsonb_build_object('type', 'friend_request')
      )
    );
  end if;
  return new;
end;
$function$;

-- Same real, previously-ungated-push fix, for the accept side.
create or replace function public.notify_friend_request_accepted()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  v_accepter_name text;
  v_requester uuid;
  v_requester_wants_notif boolean;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    v_requester := new.requested_by;
    select coalesce(notify_friends, true) into v_requester_wants_notif from profiles where id = v_requester;
    if not v_requester_wants_notif then
      return new;
    end if;

    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_accepter_name from profiles where id = (case when new.requested_by = new.user_a then new.user_b else new.user_a end);

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_requester,
        'title', 'Friend request accepted',
        'body', coalesce(v_accepter_name, 'Someone') || ' accepted your friend request.',
        'data', jsonb_build_object('type', 'friend_accepted')
      )
    );
  end if;
  return new;
end;
$function$;

-- Re-point the genuine dating-match push to the new notify_dating column. Every
-- other line (the mutual-notice check, the real match insert, both push bodies)
-- unchanged.
create or replace function public.check_mutual_notice()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  matched_user_a uuid;
  matched_user_b uuid;
  new_match_id uuid;
  sender_name text;
  recipient_name text;
  to_user_wants_notif boolean;
  from_user_wants_notif boolean;
begin
  if exists (
    select 1 from notices
    where from_user = new.to_user and to_user = new.from_user
  ) then
    matched_user_a := least(new.from_user, new.to_user);
    matched_user_b := greatest(new.from_user, new.to_user);
    insert into matches (user_a, user_b)
    values (matched_user_a, matched_user_b)
    on conflict do nothing
    returning id into new_match_id;
    if new_match_id is not null then
      select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      select display_name into sender_name from profiles where id = new.from_user;
      select display_name into recipient_name from profiles where id = new.to_user;

      select coalesce(notify_dating, true) into to_user_wants_notif from profiles where id = new.to_user;
      select coalesce(notify_dating, true) into from_user_wants_notif from profiles where id = new.from_user;

      if to_user_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', new.to_user,
            'title', 'It''s a Match! 🎉',
            'body', 'You and ' || coalesce(sender_name, 'someone') || ' noticed each other.',
            'data', jsonb_build_object('type', 'new_match', 'match_id', new_match_id)
          )
        );
      end if;

      if from_user_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', new.from_user,
            'title', 'It''s a Match! 🎉',
            'body', 'You and ' || coalesce(recipient_name, 'someone') || ' noticed each other.',
            'data', jsonb_build_object('type', 'new_match', 'match_id', new_match_id)
          )
        );
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- Close the real, previously-ungated push found while auditing this whole
-- family: record_friend_discovery_swipe's own "New friend!" push had zero
-- preference check at all. Gated on notify_friends now, matching every other
-- friend-relationship push above.
create or replace function public.record_friend_discovery_swipe(target_user_id uuid, direction_param text)
 returns table(is_mutual_match boolean, match_id uuid)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
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
  v_service_key text;
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

  perform set_config('app.trusted_update', 'false', true);

  select coalesce(notify_friends, true) into v_recipient_wants_notif from profiles where id = target_user_id;
  if v_recipient_wants_notif then
    select display_name into v_my_name from profiles where id = v_me;
    select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', target_user_id,
        'title', 'New friend!',
        'body', 'You and ' || coalesce(v_my_name, 'someone') || ' are now friends on Nearby. 🎉',
        'data', jsonb_build_object('type', 'friend_discovery_match', 'match_id', v_match_id)
      )
    );
  end if;

  return query select true, v_match_id;
end;
$function$;

-- Retire the now-fully-redundant generic "New match!" trigger -- see the real,
-- previously-undocumented duplicate-push finding in this migration's own header
-- comment. Every real source of a matches row now has its own correctly-scoped
-- push; this trigger's only remaining effect was a second, dating-flavored,
-- confusing push on top of each one.
drop trigger if exists on_match_created on matches;
drop function if exists public.notify_new_match();
