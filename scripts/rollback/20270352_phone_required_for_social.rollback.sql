-- Rollback for migration 20270352 (verified phone before social participation): restores the production definitions read 2026-10-27 before it was applied.
-- Run the rollbacks newest first (20270354 -> 20270347); each assumes the later ones were already rolled back.
drop trigger if exists zz_require_verified_phone on public.messages;
drop trigger if exists zz_require_verified_phone on public.gathering_messages;
drop trigger if exists zz_require_verified_phone on public.community_messages;
drop trigger if exists zz_require_verified_phone on public.plan_messages;
drop trigger if exists zz_require_verified_phone on public.photo_comments;
drop trigger if exists zz_require_verified_phone on public.gathering_questions;
drop trigger if exists zz_require_verified_phone on public.notices;
drop trigger if exists zz_require_verified_phone on public.friendships;
drop trigger if exists zz_require_verified_phone on public.social_invites;
drop trigger if exists zz_require_verified_phone on public.gatherings;
drop trigger if exists zz_require_verified_phone on public.communities;
create or replace view public.dating_candidates_visible_to_me with (security_invoker = false, security_barrier = true) as
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
    AND NOT viewer_blocked_either_way(p.id);
-- people_visible_to_me: open_to_friend_discovery back to the plain column (a column's expression can't change type; it doesn't).
-- Both views go back to 20270350's definitions on top of N6's narrowed, owner-run views (20270348), never the old wide ones.
create or replace view public.people_visible_to_me with (security_invoker = false, security_barrier = true) as
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
    p.open_to_friend_discovery,
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
    -- only profiles others may see at all (the profiles read policy's rule) and never a suspended account
    and coalesce(p.photo_verified, false) and not coalesce(p.profile_hidden, false) and p.suspended_at is null
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
drop function if exists public._require_verified_phone();
drop function if exists public.person_discoverable(uuid);
drop function if exists private.has_verified_phone(uuid);
