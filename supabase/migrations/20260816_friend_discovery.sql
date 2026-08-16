-- Friend Discovery: an explicit, opt-in "swipe to meet new people looking
-- for friends" surface -- a completely separate product surface from dating
-- discovery (separate opt-in, separate table, separate candidate pool) and
-- deliberately never referenced by the intent resolver. See CLAUDE.md's
-- "Friend Discovery" plan section for the full design/locked rules this
-- migration implements.

-- ---------- profiles: one plain, self-editable opt-in column ----------
-- No trusted_update guard needed -- same posture as `interests`/
-- `intent_visibility`, a user's own preference, not a privileged flag.
alter table public.profiles
  add column if not exists open_to_friend_discovery boolean not null default false;

-- ---------- friend_discovery_swipes ----------
-- Deliberately its own table, not a repurposing of `notices` (dating) --
-- keeps dating/friend preferences, RLS, analytics, and deletion completely
-- independent, per explicit product decision.
create table if not exists public.friend_discovery_swipes (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  direction text not null check (direction in ('like', 'pass')),
  created_at timestamptz not null default now(),
  constraint no_self_friend_swipe check (from_user <> to_user),
  constraint friend_discovery_swipes_from_to_key unique (from_user, to_user)
);

alter table public.friend_discovery_swipes enable row level security;

-- No policies at all -- deny by default for every role, every operation.
-- Every read and write is mediated by a SECURITY DEFINER RPC below,
-- matching the `group_plan_*`/`business_availability` precedent, not the
-- dating `notices` table's own partially-open SELECT policy. This is
-- deliberate: a recipient of an unreciprocated like must never be able to
-- query this table directly and learn they were liked.
revoke all on public.friend_discovery_swipes from public, anon, authenticated;

create index if not exists friend_discovery_swipes_to_user_idx
  on public.friend_discovery_swipes (to_user);

-- ---------- existing-trigger bypass for a system-mediated friendship ----------
-- A friend-discovery mutual match creates a `friendships` row directly, via
-- the RPC below, rather than going through the normal one-sided
-- request -> accept flow. Two existing triggers need a narrow, explicit
-- bypass so that path doesn't (a) get blocked by the unrelated daily
-- manual-friend-request cap, or (b) fire confusing dating-style "New
-- match!" copy for what should read as a clean "you're now friends"
-- moment. Both bypasses are gated on the same `app.trusted_update` flag
-- this schema already uses everywhere else for "this write is
-- RPC-mediated, not a raw client action" -- normal client-driven inserts
-- (sendFriendRequest, the dating swipe deck) never set this flag, so
-- their existing behavior is completely unchanged.

CREATE OR REPLACE FUNCTION public.enforce_friend_request_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
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
  perform set_config('app.trusted_update', 'false', true);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_new_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a_wants_notif boolean;
  b_wants_notif boolean;
  a_name text;
  b_name text;
  service_key text;
begin
  -- A friend-discovery mutual match sends its own, correctly-worded push
  -- (from record_friend_discovery_swipe below) instead of this dating-
  -- flavored "New match! ... noticed each other" copy.
  if coalesce(current_setting('app.trusted_update', true), '') = 'true' then
    return new;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select notify_matches, display_name into a_wants_notif, a_name from profiles where id = new.user_a;
  select notify_matches, display_name into b_wants_notif, b_name from profiles where id = new.user_b;

  if a_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.user_a,
        'title', 'New match!',
        'body', 'You and ' || coalesce(b_name, 'someone') || ' noticed each other. Say hi!',
        'data', jsonb_build_object('type', 'match', 'match_id', new.id)
      )
    );
  end if;

  if b_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.user_b,
        'title', 'New match!',
        'body', 'You and ' || coalesce(a_name, 'someone') || ' noticed each other. Say hi!',
        'data', jsonb_build_object('type', 'match', 'match_id', new.id)
      )
    );
  end if;

  return new;
end;
$function$;

-- ---------- get_friend_discovery_candidates ----------
-- Real candidate rows only. Excludes: existing friends, existing dating
-- matches, blocked pairs (either direction), pending friend requests
-- (either direction), previously declined friend requests/friendships
-- (either direction), and anyone the caller has already swiped (like or
-- pass). Since `friendships.status` only ever has 3 values
-- (pending/accepted/declined), "any friendships row exists between the
-- pair, in any status" is the single condition that covers all of: already
-- friends, pending either direction, and previously declined either
-- direction -- exactly the locked exclusion rule.
--
-- Distance is intentionally never returned as an exact figure -- only a
-- coarse bucketed label, computed from the same `wide_area` coarse-grid
-- column Browse/Crossed-Paths already use, never precise coordinates
-- (which don't even exist on `profiles`). No hard radius cutoff -- this is
-- a city/region-wide pool, matching `wide_area`'s own established "wider,
-- filter-based" precedent, not a fixed-mile filter.
CREATE OR REPLACE FUNCTION public.get_friend_discovery_candidates(limit_param integer default 20)
 RETURNS TABLE(
   id uuid,
   display_name text,
   photo_url text,
   bio text,
   interests text[],
   shared_interest_count integer,
   shared_community_count integer,
   mutual_friend_count integer,
   distance_bucket text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_my_interests text[];
  v_my_wide_area text;
  v_my_lat double precision;
  v_my_lng double precision;
  v_i_opted_in boolean;
begin
  if v_me is null then
    return;
  end if;

  select profiles.open_to_friend_discovery, profiles.interests, profiles.wide_area
  into v_i_opted_in, v_my_interests, v_my_wide_area
  from profiles where profiles.id = v_me;

  if not coalesce(v_i_opted_in, false) then
    return;
  end if;

  if v_my_wide_area is not null then
    v_my_lat := split_part(v_my_wide_area, ',', 1)::double precision;
    v_my_lng := split_part(v_my_wide_area, ',', 2)::double precision;
  end if;

  return query
  with my_friends as (
    select case when f.user_a = v_me then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = v_me or f.user_b = v_me)
  ),
  my_communities as (
    select community_id from community_members where user_id = v_me
  ),
  candidates as (
    select
      p.id, p.display_name, p.photo_url, p.bio, p.interests, p.wide_area,
      cardinality(array(select unnest(p.interests) intersect select unnest(v_my_interests))) as shared_interest_count,
      (select count(*) from community_members cm where cm.user_id = p.id and cm.community_id in (select community_id from my_communities))::integer as shared_community_count,
      (select count(*) from friendships f2
        where f2.status = 'accepted'
        and ((f2.user_a = p.id and f2.user_b in (select friend_id from my_friends))
          or (f2.user_b = p.id and f2.user_a in (select friend_id from my_friends))))::integer as mutual_friend_count,
      case
        when p.wide_area is null or v_my_lat is null then null
        else 3958.8 * acos(least(1.0, greatest(-1.0,
          cos(radians(v_my_lat)) * cos(radians(split_part(p.wide_area, ',', 1)::double precision)) * cos(radians(split_part(p.wide_area, ',', 2)::double precision) - radians(v_my_lng)) +
          sin(radians(v_my_lat)) * sin(radians(split_part(p.wide_area, ',', 1)::double precision))
        )))
      end as distance_miles
    from profiles p
    where p.id <> v_me
    and p.open_to_friend_discovery = true
    and not is_blocked(v_me, p.id)
    and not exists (
      select 1 from friendships f
      where (f.user_a = v_me and f.user_b = p.id) or (f.user_a = p.id and f.user_b = v_me)
    )
    and not exists (
      select 1 from matches m
      where (m.user_a = v_me and m.user_b = p.id) or (m.user_a = p.id and m.user_b = v_me)
    )
    and not exists (
      select 1 from friend_discovery_swipes s
      where s.from_user = v_me and s.to_user = p.id
    )
  )
  select
    c.id, c.display_name, c.photo_url, c.bio, c.interests,
    c.shared_interest_count, c.shared_community_count, c.mutual_friend_count,
    case
      when c.distance_miles is null then null
      when c.distance_miles < 3 then 'Nearby'
      when c.distance_miles < 15 then 'A few miles away'
      else 'In the wider area'
    end as distance_bucket
  from candidates c
  order by (c.shared_interest_count + c.shared_community_count + c.mutual_friend_count) desc,
    c.distance_miles asc nulls last,
    random()
  limit limit_param;
end;
$function$;

revoke all on function public.get_friend_discovery_candidates(integer) from public, anon;
grant execute on function public.get_friend_discovery_candidates(integer) to authenticated;

-- ---------- record_friend_discovery_swipe ----------
-- Records a durable like/pass (so "don't show me someone I've already
-- passed" holds across sessions/devices/reinstalls), and on a genuine
-- mutual like creates a normal accepted friendship + a normal matches row
-- (real messaging channel) in one transaction -- reusing the exact same
-- `matches` row shape a normal accepted friend request already produces,
-- not a dating-style "match" object with different semantics.
CREATE OR REPLACE FUNCTION public.record_friend_discovery_swipe(target_user_id uuid, direction_param text)
 RETURNS TABLE(is_mutual_match boolean, match_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Defensive re-check of the same exclusion rule the candidate RPC
  -- already applies -- a stale client shouldn't be trusted, and this
  -- covers friends/pending/declined (any friendships row) plus an
  -- existing dating match in one check each.
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

  return query select true, v_match_id;
end;
$function$;

revoke all on function public.record_friend_discovery_swipe(uuid, text) from public, anon;
grant execute on function public.record_friend_discovery_swipe(uuid, text) to authenticated;
