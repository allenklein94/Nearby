-- Rollback for migration 20270351 (account suspension): restores the production definitions read 2026-10-27 before it was applied.
-- Run the rollbacks newest first (20270354 -> 20270347); each assumes the later ones were already rolled back.
-- WARNING: a person suspended while this was live becomes unsuspended in the database by this rollback. Check first:
--   select id from profiles where suspended_at is not null;  and lift any auth ban deliberately (auth.users.banned_until).
drop trigger if exists zz_refuse_suspended_actor on public.messages;
drop trigger if exists zz_refuse_suspended_actor on public.message_reactions;
drop trigger if exists zz_refuse_suspended_actor on public.gathering_messages;
drop trigger if exists zz_refuse_suspended_actor on public.community_messages;
drop trigger if exists zz_refuse_suspended_actor on public.plan_messages;
drop trigger if exists zz_refuse_suspended_actor on public.business_messages;
drop trigger if exists zz_refuse_suspended_actor on public.photo_comments;
drop trigger if exists zz_refuse_suspended_actor on public.gathering_questions;
drop trigger if exists zz_refuse_suspended_actor on public.gathering_feedback;
drop trigger if exists zz_refuse_suspended_actor on public.notices;
drop trigger if exists zz_refuse_suspended_actor on public.friendships;
drop trigger if exists zz_refuse_suspended_actor on public.friend_discovery_swipes;
drop trigger if exists zz_refuse_suspended_actor on public.social_invites;
drop trigger if exists zz_refuse_suspended_actor on public.gatherings;
drop trigger if exists zz_refuse_suspended_actor on public.gathering_interest;
drop trigger if exists zz_refuse_suspended_actor on public.gathering_interested;
drop trigger if exists zz_refuse_suspended_actor on public.communities;
drop trigger if exists zz_refuse_suspended_actor on public.community_members;
drop trigger if exists zz_refuse_suspended_actor on public.stories;
drop trigger if exists zz_refuse_suspended_actor on public.profile_photos;
drop trigger if exists zz_refuse_suspended_actor on public.business_requests;
drop trigger if exists zz_refuse_suspended_actor on public.occasion_group_plans;
drop trigger if exists zz_refuse_suspended_actor on public.occasion_group_plan_participants;
drop trigger if exists zz_refuse_suspended_actor on public.plan_shares;
CREATE OR REPLACE FUNCTION public._gathering_row_visible(g_id uuid, g_host_id uuid, g_visibility text, g_women_only boolean, g_community_id uuid, g_hosting_partner_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_partner uuid;
begin
  if v_uid is null or g_id is null then return false; end if;
  if g_host_id = v_uid then return true; end if;
  -- already part of it (any request state) or personally invited
  if exists (select 1 from gathering_interest where gathering_id = g_id and user_id = v_uid) then return true; end if;
  if exists (select 1 from social_invites where invite_type = 'gathering' and target_id = g_id and invitee_id = v_uid
             and status in ('pending', 'accepted')) then return true; end if;
  -- the business that partners on it, or was asked to
  select managed_partner_id into v_partner from profiles where id = v_uid;
  if v_partner is not null and (
       v_partner = g_hosting_partner_id
       or exists (select 1 from business_partnership_requests r where r.target_type = 'gathering' and r.target_id = g_id
                  and r.partner_id = v_partner and r.status in ('pending', 'approved'))) then
    return true;
  end if;
  if public.viewer_blocked_either_way(g_host_id) then return false; end if;
  if coalesce(g_women_only, false)
     and lower(coalesce((select gender from profiles where id = v_uid), '')) not in ('female', 'woman') then return false; end if;
  return case g_visibility
    when 'everyone' then true
    when 'friends' then public.viewer_is_friend_of(g_host_id)
    when 'community' then g_community_id is not null
      and exists (select 1 from community_members where community_id = g_community_id and user_id = v_uid)
    else false
  end;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_friend_discovery_candidates(limit_param integer DEFAULT 20)
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
drop function if exists public.admin_suspend_user(uuid, text, uuid, boolean);
drop function if exists public.admin_reinstate_user(uuid, text);
drop trigger if exists block_client_suspension_edit on public.profiles;
drop function if exists public._guard_suspension();
drop function if exists public._refuse_suspended_actor();
drop table if exists public.account_moderation_actions;
drop function if exists private.account_suspended(uuid);
alter table public.profiles drop column if exists suspended_at;
