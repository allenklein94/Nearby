-- Rollback for migration 20270350 (identity verification as its own state): restores the production definitions read 2026-10-27 before it was applied.
-- Run the rollbacks newest first (20270354 -> 20270347); each assumes the later ones were already rolled back.
-- The Verified badge then reads photo_verified again in the app only if the app is rolled back too.
-- a view can't lose a column with CREATE OR REPLACE: drop the dependent view first, then recreate both
drop view public.dating_candidates_visible_to_me;
drop view public.people_visible_to_me;
-- Back to N6's narrowed, owner-run views (20270348), never the old wide ones.
create view public.people_visible_to_me with (security_invoker = false, security_barrier = true) as
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
         ELSE p.interested_in_genders END AS interested_in_genders
   FROM profiles p
  WHERE auth.uid() IS NOT NULL
    AND (p.id = auth.uid()
         OR (((p.photo_verified = true AND p.profile_hidden = false) OR check_is_admin(auth.uid()))
             AND NOT viewer_blocked_either_way(p.id)));
create view public.dating_candidates_visible_to_me with (security_invoker = false, security_barrier = true) as
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
    is_dating_discoverable(p.onboarding_motivations) AS dating_opted_in
   FROM profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND is_dating_discoverable(p.onboarding_motivations)
    AND ((p.photo_verified = true AND p.profile_hidden = false) OR check_is_admin(auth.uid()))
    AND NOT viewer_blocked_either_way(p.id);
revoke all on public.people_visible_to_me from public, anon, authenticated;
revoke all on public.dating_candidates_visible_to_me from public, anon, authenticated;
grant select on public.people_visible_to_me to authenticated;
grant select on public.dating_candidates_visible_to_me to authenticated;
revoke select (id_verified) on public.profiles from authenticated;
drop function if exists public.get_friend_discovery_candidates(integer);
CREATE OR REPLACE FUNCTION public.get_friend_discovery_candidates(limit_param integer DEFAULT 20)
 RETURNS TABLE(id uuid, display_name text, photo_url text, bio text, interests text[], photo_verified boolean, shared_interest_count integer, shared_community_count integer, mutual_friend_count integer, distance_bucket text)
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
      p.id, p.display_name, p.photo_url, p.bio, p.interests, p.wide_area, p.photo_verified,
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
    c.id, c.display_name, c.photo_url, c.bio, c.interests, c.photo_verified,
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
grant execute on function public.get_friend_discovery_candidates(integer) to authenticated, service_role;
CREATE OR REPLACE FUNCTION public.admin_approve_id_verification(submission_id_param uuid, approved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review verification submissions';
  end if;

  if exists (select 1 from id_verification_submissions where id = submission_id_param and user_id = auth.uid()) then
    raise exception 'You can''t review your own verification' using errcode = '42501', hint = 'own_submission';
  end if;

  update id_verification_submissions
  set status = case when approved then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = submission_id_param and status = 'pending'
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Submission not found or already reviewed';
  end if;

  if approved then
    perform set_config('app.trusted_update', 'true', true);
    update profiles set photo_verified = true where id = v_user_id;
  end if;
end;
$function$;
drop trigger if exists block_client_identity_verified_edit on public.profiles;
drop function if exists public._guard_identity_verified();
alter table public.profiles drop column if exists id_verified_at;
alter table public.profiles drop column if exists id_verified;
