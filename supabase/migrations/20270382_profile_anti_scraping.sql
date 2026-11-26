-- People anti-scraping (owner idea 9, option B, 2026-11-01; staged, never deployed with build 87). Before this migration
-- (checked read-only on prod 2026-11-01) any signed-in account could page through EVERY visible profile: the profiles read
-- policy and both people views allowed any screened, unhidden profile with no relationship condition, PostgREST pages up
-- to 1000 rows with unlimited offsets, get_friend_discovery_candidates took any limit, match_contacts_to_users returned a
-- name + photo for any phone number (hidden, blocked or suspended people too; 30,000 numbers a day), and no read was ever
-- counted. After:
--   1. ONE read rule, public.viewer_may_read_profile(target): self, an admin, or a real reason to see that person (friend
--      or friend request, match, notice, invitation, crossed paths, a shared gathering / community / group plan / plan,
--      the host of a gathering you can see, a public story, a poll, a photo comment, a story view, a referral, the
--      business you manage talking with them) or Nearby SHOWED them to you through a capped discovery function within
--      grant_days. Knowing an id alone never grants a read. Blocks hide both ways (your own block list still shows the
--      person you blocked). The profiles read policy and both people views apply it, so a direct read by id, a table
--      read, an embed and the views all follow the same rule.
--   2. Strangers are discovered ONLY through four server functions: browse_dating_candidates (new; the Dating Browse
--      path), get_friend_discovery_candidates, get_suggested_friends, match_contacts_to_users. Each caps its page
--      (page_max) and passes what it returns through private.serve_profiles, which counts DISTINCT NEW PEOPLE returned per
--      account in a rolling 24 h (daily_new_profiles; asking for bigger pages or more pages never returns more). A person
--      already readable, or already served in the last 24 h, costs nothing again. Past the limit a function returns fewer
--      people (never an error, never a restriction).
--   3. Reaching the daily limit is a NAMED behaviour signal only when the owner switches it on (settings null = off):
--      'discovery_limit' (any day; corroboration only) and 'discovery_limit_repeated' (reached on >= N distinct days in
--      a window; may open a case alone once listed in case_alone_kinds). Review cases follow 20270363's rules (one per
--      person, daily cap, overflow kept). Nothing here suspends, hides, scores or tells anyone.
--   4. Visibility kept: discovery functions keep their own consent / block / hidden / suspended / phone rules;
--      match_contacts_to_users and get_suggested_friends now also skip hidden, unscreened, suspended and blocked people.
-- Numbers (PROPOSED, owner approval at deploy): page_max 50, daily_new_profiles 300, grant_days 7, max_buckets 9.
-- Stored: (viewer, person, first/last served) for grant_days, and the days the limit was reached (30 days). Nothing new
-- about anyone's profile is collected.
-- Requires a build whose Dating Browse calls browse_dating_candidates (services/proximity.js; falls back to the view
-- while this migration is not live). An older build's Browse returns only people the viewer already has a reason to
-- see (fails closed: fewer people, never more data). Rollout like 20270348: the new build on every device first.
-- Requires 20270352 (person_discoverable) and 20270363 (behaviour signals). Deploy after 20270381, own approval.

-- Settings (one row).
create table if not exists private.profile_read_limits (
  id boolean primary key default true check (id),
  page_max integer not null default 50 check (page_max between 1 and 100),
  daily_new_profiles integer not null default 300 check (daily_new_profiles between 20 and 5000),
  grant_days integer not null default 7 check (grant_days between 1 and 30),
  max_buckets integer not null default 9 check (max_buckets between 1 and 25),
  limit_signal_window_days integer check (limit_signal_window_days is null or limit_signal_window_days between 1 and 30),
  limit_signal_min_days integer check (limit_signal_min_days is null or limit_signal_min_days between 2 and 30),
  updated_at timestamptz not null default now()
);
insert into private.profile_read_limits (id) values (true) on conflict (id) do nothing;

-- Who Nearby showed to whom through discovery (the grant for a later direct read, and the daily count).
create table if not exists private.profile_served (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  via text not null check (via in ('dating_browse', 'friend_discovery', 'suggested_friends', 'contacts')),
  first_served_at timestamptz not null default now(),
  last_served_at timestamptz not null default now(),
  primary key (viewer_id, target_id)
);
create index if not exists profile_served_first_idx on private.profile_served (viewer_id, first_served_at desc);
create index if not exists profile_served_last_idx on private.profile_served (last_served_at);

-- Days on which an account reached the daily limit (only while the signal is on).
create table if not exists private.profile_discovery_limit_days (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  primary key (viewer_id, day)
);
revoke all on private.profile_read_limits, private.profile_served, private.profile_discovery_limit_days
  from public, anon, authenticated;

-- Indexes the read rule probes (only where none exists yet).
create index if not exists gathering_interest_user_gathering_idx on public.gathering_interest (user_id, gathering_id);
create index if not exists community_members_user_idx on public.community_members (user_id, community_id);
create index if not exists notices_pair_idx on public.notices (from_user, to_user);
create index if not exists social_invites_pair_idx on public.social_invites (inviter_id, invitee_id);
create index if not exists gatherings_host_scheduled_idx on public.gatherings (host_id, scheduled_at);
create index if not exists stories_user_public_idx on public.stories (user_id, expires_at) where is_public;

-- 1. The ONE read rule.
create or replace function public.viewer_may_read_profile(target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v uuid := auth.uid();
  v_partner uuid;
begin
  if v is null or target is null then return false; end if;
  if target = v then return true; end if;
  if check_is_admin(v) then return true; end if;
  -- your own block list shows the person you blocked; otherwise a block hides both ways
  if exists (select 1 from blocks b where b.blocker_id = v and b.blocked_id = target) then return true; end if;
  if viewer_blocked_either_way(target) then return false; end if;

  -- shown to you by a capped discovery function recently
  if exists (select 1 from private.profile_served s
              where s.viewer_id = v and s.target_id = target
                and s.last_served_at > now() - make_interval(days => (select l.grant_days from private.profile_read_limits l where l.id))) then
    return true;
  end if;
  -- people you are connected with, or who reached out to you / you to them
  if exists (select 1 from friendships f where (f.user_a = v and f.user_b = target) or (f.user_a = target and f.user_b = v))
     or exists (select 1 from matches m where (m.user_a = v and m.user_b = target) or (m.user_a = target and m.user_b = v))
     or exists (select 1 from notices n where (n.from_user = v and n.to_user = target) or (n.from_user = target and n.to_user = v))
     or exists (select 1 from social_invites i where (i.inviter_id = v and i.invitee_id = target) or (i.inviter_id = target and i.invitee_id = v))
     or exists (select 1 from sightings s where (s.user_a = v and s.user_b = target) or (s.user_a = target and s.user_b = v))
     or exists (select 1 from referral_redemptions r where (r.referrer_id = v and r.referred_id = target) or (r.referrer_id = target and r.referred_id = v))
     or exists (select 1 from preference_polls pp where (pp.asker_id = v and pp.target_id = target) or (pp.asker_id = target and pp.target_id = v))
     or exists (select 1 from photo_comments pc where (pc.photo_owner_id = v and pc.commenter_id = target) or (pc.photo_owner_id = target and pc.commenter_id = v)) then
    return true;
  end if;
  -- gatherings: fellow approved attendees; the host and anyone in their gathering (any request state); the host of a
  -- current gathering you can see; someone who asked a question on a current gathering you can see
  if exists (select 1 from gathering_interest a join gathering_interest b on b.gathering_id = a.gathering_id
              where a.user_id = v and b.user_id = target and a.status = 'approved' and b.status = 'approved')
     or exists (select 1 from gatherings g join gathering_interest gi on gi.gathering_id = g.id
                 where (g.host_id = v and gi.user_id = target) or (g.host_id = target and gi.user_id = v))
     or exists (select 1 from gatherings g
                 where g.host_id = target and g.scheduled_at > now() - interval '1 day'
                   and _gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id))
     or exists (select 1 from gathering_questions q join gatherings g on g.id = q.gathering_id
                 where q.asker_id = target and g.scheduled_at > now() - interval '1 day'
                   and _gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)) then
    return true;
  end if;
  -- communities, group plans, plans you share
  if exists (select 1 from community_members a join community_members b on b.community_id = a.community_id
              where a.user_id = v and b.user_id = target)
     or exists (select 1 from group_plan_participants a join group_plan_participants b on b.proposal_id = a.proposal_id
                 where a.user_id = v and b.user_id = target)
     or exists (select 1 from group_plan_proposals gp join group_plan_participants pa on pa.proposal_id = gp.id
                 where (gp.initiator_id = v and pa.user_id = target) or (gp.initiator_id = target and pa.user_id = v))
     or exists (select 1 from occasion_group_plan_participants a join occasion_group_plan_participants b on b.group_plan_id = a.group_plan_id
                 where a.user_id = v and b.user_id = target)
     or exists (select 1 from occasion_group_plans op join occasion_group_plan_participants pa on pa.group_plan_id = op.id
                 where (op.host_id = v and pa.user_id = target) or (op.host_id = target and pa.user_id = v))
     or exists (select 1 from plans pl
                 where (pl.created_by = v and (exists (select 1 from plan_organizers o where o.plan_id = pl.id and o.user_id = target)
                                               or exists (select 1 from plan_shares sh where sh.plan_id = pl.id and sh.user_id = target)))
                    or (pl.created_by = target and (exists (select 1 from plan_organizers o where o.plan_id = pl.id and o.user_id = v)
                                                    or exists (select 1 from plan_shares sh where sh.plan_id = pl.id and sh.user_id = v))))
     or exists (select 1 from plan_organizers a join plan_organizers b on b.plan_id = a.plan_id where a.user_id = v and b.user_id = target) then
    return true;
  end if;
  -- stories: a current public story of theirs; someone who viewed your story
  if exists (select 1 from stories st where st.user_id = target and st.is_public and st.expires_at > now())
     or exists (select 1 from story_views sv join stories st on st.id = sv.story_id where st.user_id = v and sv.viewer_id = target) then
    return true;
  end if;
  -- business: the business you manage talking with this person or asked by them; the owner of a business talking with you
  v_partner := my_managed_partner_id();
  if v_partner is not null and (
       exists (select 1 from business_partnership_requests r where r.partner_id = v_partner and r.requester_id = target)
       or exists (select 1 from business_messages bm where bm.partner_id = v_partner and bm.conversation_with_id = target)) then
    return true;
  end if;
  if exists (select 1 from business_messages bm where bm.conversation_with_id = v and bm.sender_id = target and bm.from_business) then
    return true;
  end if;
  return false;
end;
$function$;
revoke all on function public.viewer_may_read_profile(uuid) from public, anon;
grant execute on function public.viewer_may_read_profile(uuid) to authenticated, service_role;

-- The profiles read policy: as before + the read rule.
alter policy "Users can view own or verified profiles" on public.profiles
  using ((auth.uid() = id) OR ((photo_verified = true) AND (profile_hidden = false) AND viewer_may_read_profile(id)));

-- 2. The people views: their rows (as after 20270352) move to owner-only private views, read by the discovery functions;
-- the public views = those rows + the read rule.
create or replace view private.people_rows with (security_invoker = false, security_barrier = true) as
 SELECT p.id,
    p.display_name,
    p.bio,
    p.photo_url,
    p.photo_verified,
    p.is_premium,
    p.created_at,
    p.interests,
    p.pronouns,
    p.basics,
    p.prompts,
    p.relationship_intention,
    p.connection_goal,
    p.favorite_tracks,
    p.voice_intro_path,
    CASE WHEN p.id = auth.uid() THEN p.open_to_friend_discovery
         ELSE p.open_to_friend_discovery AND person_discoverable(p.id) END AS open_to_friend_discovery,
    date_part('year', age(current_date, p.birthdate))::integer AS age,
    CASE WHEN coalesce(p.gender_hidden, false) THEN NULL ELSE p.gender END AS gender,
    p.sexual_orientation,
    CASE WHEN coalesce(p.ethnicity_hidden, false) THEN NULL ELSE p.ethnicity END AS ethnicity,
    CASE WHEN coalesce(p.gender_hidden, false) OR NOT is_dating_discoverable(p.onboarding_motivations) THEN NULL
         ELSE p.gender_identity END AS gender_identity,
    CASE WHEN coalesce(p.gender_hidden, false) OR NOT is_dating_discoverable(p.onboarding_motivations) THEN NULL
         ELSE p.interested_in_genders END AS interested_in_genders,
    p.id_verified
   FROM profiles p
  WHERE auth.uid() IS NOT NULL
    AND (p.id = auth.uid()
         OR (((p.photo_verified = true AND p.profile_hidden = false) OR check_is_admin(auth.uid()))
             AND NOT viewer_blocked_either_way(p.id)));

create or replace view private.dating_candidate_rows with (security_invoker = false, security_barrier = true) as
 SELECT p.id,
    p.display_name,
    p.photo_url,
    p.bio,
    p.discovery_gender,
    date_part('year', age(current_date, p.birthdate))::integer AS age,
    CASE WHEN coalesce(p.ethnicity_hidden, false) THEN NULL ELSE p.ethnicity END AS ethnicity,
    p.interests,
    p.basics,
    p.height_inches,
    p.photo_verified,
    p.relationship_intention,
    CASE WHEN coalesce(p.gender_hidden, false) THEN NULL ELSE p.gender_identity END AS gender_identity,
    CASE WHEN coalesce(p.gender_hidden, false) THEN NULL ELSE p.interested_in_genders END AS interested_in_genders,
    p.show_me,
    p.wide_area,
    is_dating_discoverable(p.onboarding_motivations) AS dating_opted_in,
    p.id_verified
   FROM profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND is_dating_discoverable(p.onboarding_motivations)
    AND ((p.photo_verified = true AND p.profile_hidden = false) OR check_is_admin(auth.uid()))
    AND NOT viewer_blocked_either_way(p.id)
    AND person_discoverable(p.id);
revoke all on private.people_rows, private.dating_candidate_rows from public, anon, authenticated;

create or replace view public.people_visible_to_me with (security_invoker = false, security_barrier = true) as
 SELECT r.* FROM private.people_rows r WHERE viewer_may_read_profile(r.id);
create or replace view public.dating_candidates_visible_to_me with (security_invoker = false, security_barrier = true) as
 SELECT r.* FROM private.dating_candidate_rows r WHERE viewer_may_read_profile(r.id);
revoke all on public.people_visible_to_me from public, anon, authenticated;
revoke all on public.dating_candidates_visible_to_me from public, anon, authenticated;
grant select on public.people_visible_to_me to authenticated;
grant select on public.dating_candidates_visible_to_me to authenticated;

-- 3. The daily limit: returns the ids (in the given order) the caller may be shown, records them, notes a reached limit.
create or replace function private.note_discovery_limit(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l private.profile_read_limits;
  v_days integer;
begin
  select * into l from private.profile_read_limits where id;
  if l.limit_signal_window_days is null or l.limit_signal_min_days is null then return; end if;
  begin
    insert into private.profile_discovery_limit_days (viewer_id, day)
      values (p_user, (now() at time zone 'utc')::date) on conflict do nothing;
    select count(*) into v_days from private.profile_discovery_limit_days
     where viewer_id = p_user and day > (now() at time zone 'utc')::date - l.limit_signal_window_days;
    perform private.behavior_note_signal(p_user, 'discovery_limit',
      jsonb_build_object('days', v_days, 'window_days', l.limit_signal_window_days));
    if v_days >= l.limit_signal_min_days then
      perform private.behavior_note_signal(p_user, 'discovery_limit_repeated',
        jsonb_build_object('days', v_days, 'window_days', l.limit_signal_window_days));
    end if;
  exception when others then
    raise warning 'discovery limit signal: %', sqlerrm;  -- never fails the read
  end;
end;
$function$;
revoke all on function private.note_discovery_limit(uuid) from public, anon, authenticated;

create or replace function private.serve_profiles(p_ids uuid[], p_via text)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v uuid := auth.uid();
  l private.profile_read_limits;
  v_room integer;
  v_out uuid[] := '{}';
  v_dropped integer := 0;
  v_id uuid;
begin
  if v is null or p_ids is null or cardinality(p_ids) = 0 then return '{}'; end if;
  select * into l from private.profile_read_limits where id;
  -- one account's parallel calls are counted together
  perform pg_advisory_xact_lock(hashtext('profile_serve:' || v::text));
  select l.daily_new_profiles - count(*) into v_room from private.profile_served
   where viewer_id = v and first_served_at > now() - interval '24 hours';
  for v_id in select x from unnest(p_ids) with ordinality u(x, n) order by n loop
    continue when v_id is null or v_id = v or v_id = any(v_out);
    if exists (select 1 from private.profile_served s
                where s.viewer_id = v and s.target_id = v_id and s.last_served_at > now() - make_interval(days => l.grant_days)) then
      update private.profile_served set last_served_at = now() where viewer_id = v and target_id = v_id;
      v_out := v_out || v_id;
    elsif viewer_may_read_profile(v_id) then
      v_out := v_out || v_id;              -- already someone you may see: free
    elsif v_room > 0 then
      insert into private.profile_served (viewer_id, target_id, via) values (v, v_id, p_via)
        on conflict (viewer_id, target_id) do update
          set via = excluded.via, first_served_at = now(), last_served_at = now();
      v_room := v_room - 1;
      v_out := v_out || v_id;
    else
      v_dropped := v_dropped + 1;
    end if;
  end loop;
  if v_dropped > 0 then perform private.note_discovery_limit(v); end if;
  return v_out;
end;
$function$;
revoke all on function private.serve_profiles(uuid[], text) from public, anon, authenticated;

-- 4. Dating Browse: the area buckets, a capped page, the daily limit.
create or replace function public.browse_dating_candidates(buckets_param text[], offset_param integer default 0,
                                                           limit_param integer default 20)
returns setof public.dating_candidates_visible_to_me
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  l private.profile_read_limits;
begin
  if auth.uid() is null or buckets_param is null or cardinality(buckets_param) = 0 then return; end if;
  select * into l from private.profile_read_limits where id;
  if cardinality(buckets_param) > l.max_buckets then
    raise exception 'Too many areas at once.' using errcode = '22023', hint = 'discovery_page_limit';
  end if;
  return query
  with page as materialized (
    select r.*, row_number() over (order by r.id) as rn
      from private.dating_candidate_rows r
     where r.wide_area = any(buckets_param)
     order by r.id
     offset greatest(coalesce(offset_param, 0), 0)
     limit least(greatest(coalesce(limit_param, 20), 1), l.page_max)),
  allowed as materialized (
    select private.serve_profiles(array(select p.id from page p order by p.rn), 'dating_browse') as ids)
  select p.id, p.display_name, p.photo_url, p.bio, p.discovery_gender, p.age, p.ethnicity, p.interests, p.basics,
         p.height_inches, p.photo_verified, p.relationship_intention, p.gender_identity, p.interested_in_genders, p.show_me,
         p.wide_area, p.dating_opted_in, p.id_verified
    from page p, allowed a
   where p.id = any(a.ids)
   order by p.rn;
end;
$function$;
revoke all on function public.browse_dating_candidates(text[], integer, integer) from public, anon;
grant execute on function public.browse_dating_candidates(text[], integer, integer) to authenticated, service_role;

-- 5. Friend discovery: its rule (as after 20270352) moves unchanged into a private helper; the public function caps the
-- page and applies the daily limit.
CREATE OR REPLACE FUNCTION private.friend_discovery_rows(limit_param integer)
 RETURNS TABLE(id uuid, display_name text, photo_url text, bio text, interests text[], photo_verified boolean, id_verified boolean, shared_interest_count integer, shared_community_count integer, mutual_friend_count integer, distance_bucket text)
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
      p.id, p.display_name, p.photo_url, p.bio, p.interests, p.wide_area, p.photo_verified, p.id_verified,
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
    -- only profiles others may see at all (the profiles read policy's rule), never a suspended account, and only a
    -- person with a verified phone (20270352)
    and coalesce(p.photo_verified, false) and not coalesce(p.profile_hidden, false) and p.suspended_at is null
    and public.person_discoverable(p.id)
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
    c.id, c.display_name, c.photo_url, c.bio, c.interests, c.photo_verified, c.id_verified,
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
revoke all on function private.friend_discovery_rows(integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_friend_discovery_candidates(limit_param integer DEFAULT 20)
 RETURNS TABLE(id uuid, display_name text, photo_url text, bio text, interests text[], photo_verified boolean, id_verified boolean, shared_interest_count integer, shared_community_count integer, mutual_friend_count integer, distance_bucket text)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l private.profile_read_limits;
begin
  if auth.uid() is null then return; end if;
  select * into l from private.profile_read_limits where profile_read_limits.id;
  return query
  with page as materialized (
    select f.*, row_number() over () as rn
      from private.friend_discovery_rows(least(greatest(coalesce(limit_param, 20), 1), l.page_max)) f),
  allowed as materialized (
    select private.serve_profiles(array(select p.id from page p order by p.rn), 'friend_discovery') as ids)
  select p.id, p.display_name, p.photo_url, p.bio, p.interests, p.photo_verified, p.id_verified,
         p.shared_interest_count, p.shared_community_count, p.mutual_friend_count, p.distance_bucket
    from page p, allowed a
   where p.id = any(a.ids)
   order by p.rn;
end;
$function$;
revoke all on function public.get_friend_discovery_candidates(integer) from public, anon;
grant execute on function public.get_friend_discovery_candidates(integer) to authenticated, service_role;

-- 6. Suggested friends (friends of friends): as before + only people others may see at all, never a suspended or blocked
-- person, through the daily limit.
CREATE OR REPLACE FUNCTION public.get_suggested_friends()
 RETURNS TABLE(suggested_id uuid, display_name text, photo_url text, mutual_count bigint)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then return; end if;
  return query
  with my_friends as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = auth.uid() or f.user_b = auth.uid())
  ),
  friends_of_friends as (
    select case when f.user_a = mf.friend_id then f.user_b else f.user_a end as sid
    from friendships f
    join my_friends mf on (f.user_a = mf.friend_id or f.user_b = mf.friend_id)
    where f.status = 'accepted'
  ),
  page as materialized (
    select fof.sid, p.display_name as dn, p.photo_url as pu, count(*) as mc
    from friends_of_friends fof
    join profiles p on p.id = fof.sid
    where fof.sid <> auth.uid()
      and fof.sid not in (select friend_id from my_friends)
      and coalesce(p.photo_verified, false) and not coalesce(p.profile_hidden, false) and p.suspended_at is null
      and not is_blocked(auth.uid(), fof.sid)
      and not exists (select 1 from friendships f2
                       where (f2.user_a = auth.uid() and f2.user_b = fof.sid) or (f2.user_a = fof.sid and f2.user_b = auth.uid()))
    group by fof.sid, p.display_name, p.photo_url
    order by count(*) desc, fof.sid
    limit 10),
  allowed as materialized (
    select private.serve_profiles(array(select pg.sid from page pg order by pg.mc desc, pg.sid), 'suggested_friends') as ids)
  select pg.sid, pg.dn, pg.pu, pg.mc
    from page pg, allowed a
   where pg.sid = any(a.ids)
   order by pg.mc desc, pg.sid;
end;
$function$;
revoke all on function public.get_suggested_friends() from public, anon;
grant execute on function public.get_suggested_friends() to authenticated, service_role;

-- 7. Contacts: as after 20270359 + only people others may see at all (screened, not hidden, not suspended, no block
-- either way), through the daily limit.
CREATE OR REPLACE FUNCTION public.match_contacts_to_users(phone_numbers text[])
 RETURNS TABLE(id uuid, display_name text, photo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
  v_calls_today integer;
  v_call_date date;
begin
  if array_length(phone_numbers, 1) > 3000 then
    raise exception 'Too many contacts submitted at once.';
  end if;

  select p.contacts_matched_calls_today, p.contacts_matched_date
    into v_calls_today, v_call_date
    from profiles p
    where p.id = auth.uid()
    for update;

  if v_call_date is distinct from current_date then
    v_calls_today := 0;
  end if;

  if v_calls_today >= 10 then
    raise exception 'Too many contact-matching requests today -- try again tomorrow.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles p
    set contacts_matched_calls_today = v_calls_today + 1,
        contacts_matched_date = current_date
    where p.id = auth.uid();

  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: trust ends here
  return query
    with page as materialized (
      select p.id as pid, p.display_name as dn, p.photo_url as pu
        from profiles p
        join auth.users u on u.id = p.id
       where u.phone = any(phone_numbers)
         and p.id <> auth.uid()
         and coalesce(p.photo_verified, false) and not coalesce(p.profile_hidden, false) and p.suspended_at is null
         and not is_blocked(auth.uid(), p.id)
       order by p.id),
    allowed as materialized (
      select private.serve_profiles(array(select pg.pid from page pg order by pg.pid), 'contacts') as ids)
    select pg.pid, pg.dn, pg.pu from page pg, allowed a where pg.pid = any(a.ids) order by pg.pid;
end;
$function$;

-- 8. Named signals (off until the owner sets limit_signal_window_days + limit_signal_min_days).
alter table private.behavior_signals drop constraint if exists behavior_signals_kind_check;
alter table private.behavior_signals add constraint behavior_signals_kind_check
  check (kind in ('repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                  'discovery_limit', 'discovery_limit_repeated'));
alter table private.behavior_signal_settings drop constraint if exists behavior_signal_settings_case_alone_kinds_check;
alter table private.behavior_signal_settings add constraint behavior_signal_settings_case_alone_kinds_check
  check (case_alone_kinds <@ array['repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                                   'discovery_limit_repeated']);

-- private.behavior_evaluate_case: as after 20270369, but distinct kinds are counted by family (above).
create or replace function private.behavior_evaluate_case(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_families integer;
  s private.behavior_signal_settings;
  v_kinds text[];
  v_evidence jsonb;
  v_case uuid;
  v_closed uuid;
  v_closed_at timestamptz;
  v_last_new timestamptz;
begin
  select * into s from private.behavior_signal_settings where id;
  if not s.review_cases_enabled or s.case_window_hours is null or s.max_new_cases_per_day is null then return; end if;
  select id, closed_at, new_evidence_at into v_closed, v_closed_at, v_last_new from private.account_review_cases
   where signal = 'behavior' and subject_user = p_user and status = 'closed'
   order by closed_at desc limit 1;
  select array_agg(distinct kind),
         jsonb_agg(jsonb_build_object('kind', kind, 'first_at', first_at, 'last_at', last_at, 'hits', hits) || evidence
                   order by last_at desc)
    into v_kinds, v_evidence
    from private.behavior_signals
   where user_id = p_user and last_at > now() - make_interval(hours => s.case_window_hours)
     and (v_closed_at is null or last_at > v_closed_at);
  if v_kinds is null then return; end if;
  -- 20270382: the two discovery-limit signals are one family (the repeated one never corroborates its own day)
  select count(distinct case when kind = 'discovery_limit_repeated' then 'discovery_limit' else kind end) into v_families
    from private.behavior_signals
   where user_id = p_user and last_at > now() - make_interval(hours => s.case_window_hours)
     and (v_closed_at is null or last_at > v_closed_at);
  if not ((s.case_min_signal_kinds is not null and v_families >= s.case_min_signal_kinds)
          or v_kinds && s.case_alone_kinds) then
    return;
  end if;
  select id into v_case from private.account_review_cases
   where signal = 'behavior' and subject_user = p_user and status = 'open' for update;
  if v_case is not null then
    update private.account_review_cases set evidence = jsonb_build_object('signals', v_evidence), updated_at = now()
     where id = v_case;
    return;
  end if;
  if v_closed is not null then
    -- decided before: note the new signals on that case (the admin may reopen it), never a fresh case
    if v_last_new is null or v_last_new < v_closed_at or v_last_new < now() - interval '24 hours' then
      perform 1 from private.account_review_cases where id = v_closed for update;
      insert into private.account_review_case_events (case_id, kind, subject, detail)
        values (v_closed, 'new_evidence', p_user, jsonb_build_object('signals', v_evidence));
      update private.account_review_cases set new_evidence_at = now(), updated_at = now() where id = v_closed;
    end if;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('behavior_case_queue'));
  if (select count(*) from private.account_review_cases
       where signal = 'behavior' and opened_at > now() - interval '24 hours') >= s.max_new_cases_per_day then
    insert into private.behavior_case_overflow (day, suppressed) values ((now() at time zone 'utc')::date, 1)
      on conflict (day) do update set suppressed = private.behavior_case_overflow.suppressed + 1;
    insert into private.behavior_case_waiting (user_id) values (p_user)
      on conflict (user_id) do update set last_at = now(), times = private.behavior_case_waiting.times + 1;
    return;
  end if;
  insert into private.account_review_cases (signal, reason, subject_user, evidence)
    values ('behavior', 'behavior_pattern', p_user, jsonb_build_object('signals', v_evidence))
    on conflict (subject_user) where status = 'open' and signal = 'behavior' do nothing
    returning id into v_case;
  if v_case is not null then
    insert into private.account_review_case_members (case_id, user_id) values (v_case, p_user) on conflict do nothing;
    delete from private.behavior_case_waiting where user_id = p_user;
  end if;
end;
$function$;

revoke all on function private.behavior_evaluate_case(uuid) from public, anon, authenticated;

-- 9. Retention: served rows after grant_days, limit days after 30 days.
create or replace function private.purge_profile_served()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.profile_served
   where last_served_at < now() - make_interval(days => (select grant_days from private.profile_read_limits where id));
  delete from private.profile_discovery_limit_days where day < (now() at time zone 'utc')::date - 30;
$function$;
revoke all on function private.purge_profile_served() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'purge-profile-served';
select cron.schedule('purge-profile-served', '17 * * * *', 'select private.purge_profile_served();');
