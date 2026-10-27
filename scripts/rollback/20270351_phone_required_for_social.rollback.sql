-- Rollback for migration 20270351 (verified phone before social participation): restores the production definitions read 2026-10-27 before it was applied.
-- Run the rollbacks newest first (20270353 -> 20270347); each assumes the later ones were already rolled back.
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
create or replace view public.dating_candidates_visible_to_me with (security_invoker = true) as
 SELECT id,
    display_name,
    photo_url,
    bio,
    discovery_gender,
    birthdate,
    ethnicity,
    interests,
    basics,
    height_inches,
    photo_verified,
    relationship_intention,
    gender_identity,
    interested_in_genders,
    show_me,
    wide_area,
    is_dating_discoverable(onboarding_motivations) AS dating_opted_in,
    id_verified
   FROM people_visible_to_me v
  WHERE id <> auth.uid() AND is_dating_discoverable(onboarding_motivations);
-- people_visible_to_me: open_to_friend_discovery back to the plain column (a column's expression can't change type; it doesn't)
create or replace view public.people_visible_to_me with (security_invoker = true) as
 SELECT id,
    display_name,
    bio,
    birthdate,
    photo_url,
    photo_verified,
    is_premium,
    expo_push_token,
    created_at,
    is_admin,
    terms_accepted_at,
    interests,
    pronouns,
    gender,
    sexual_orientation,
    profile_hidden,
    basics,
    discovery_gender,
    show_me,
    preferred_min_age,
    preferred_max_age,
    notify_matches,
    gender_hidden,
    ethnicity,
    ethnicity_hidden,
    ethnicity_preferences,
    prompts,
    relationship_intention,
    read_receipts_enabled,
    women_message_first,
    referral_code,
    referred_by,
    bonus_notices,
    gender_identity,
    interested_in_genders,
    discovery_view_style,
    wide_area,
    seen_browse_callout,
    browse_views_today,
    browse_views_date,
    ai_uses_today,
    ai_uses_date,
    spotify_access_token,
    spotify_refresh_token,
    spotify_token_expires_at,
    favorite_tracks,
    quick_filter_order,
    quick_filter_visible,
    last_home_visit,
    last_activity_check,
    managed_partner_id,
    connection_goal,
    timezone,
    gatherings_created_today,
    gatherings_created_date,
    communities_created_today,
    communities_created_date,
    friend_requests_sent_today,
    friend_requests_sent_date,
    stories_posted_today,
    stories_posted_date,
    onboarding_motivations,
    social_comfort_level,
    monthly_interests,
    monthly_interests_updated_at,
    home_quick_pick_categories,
    voice_intro_path,
    intent_visibility,
    open_to_friend_discovery,
    contacts_matched_calls_today,
    contacts_matched_date,
    dating_preferences_set,
    seen_home_first_run_moment,
    dating_pref_hair_colors,
    height_inches,
    dating_pref_min_height_inches,
    dating_pref_max_height_inches,
    dating_pref_eye_colors,
    quick_filter_config,
    friend_quick_filter_order,
    friend_quick_filter_visible,
    friend_quick_filter_config,
    notify_things_to_do_frequency,
    notify_things_to_do_categories,
    notify_things_to_do_max_distance_miles,
    notify_things_to_do_time_pref,
    notify_nearby_opportunities_frequency,
    notify_nearby_opportunities_categories,
    notify_nearby_opportunities_max_distance_miles,
    notify_nearby_opportunities_time_pref,
    notify_social,
    notify_discovery,
    notify_proximity,
    notify_planning,
    notify_business,
    notify_community,
    people_submode_dating_uses,
    people_submode_friends_uses,
    cuisine_preferences,
    venue_preferences,
    notify_dating,
    interest_groups,
    share_interest_in_demand,
    interested_demand_disclosure_ack_at,
    show_sponsored_places,
    notification_mutes,
    id_verified
   FROM profiles p
  WHERE id = auth.uid() OR NOT viewer_blocked_either_way(id);
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
