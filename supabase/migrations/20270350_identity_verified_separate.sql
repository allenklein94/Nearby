-- Trust & safety fix 3 (owner, 2026-10-27; audit B3): "Verified" means an approved identity check, nothing else.
-- Before: one flag, profiles.photo_verified, meant (a) the main photo passed automatic screening, (b) an admin approved
-- an ID submission, and (c) "not suspended" (the old Suspend button cleared it); the "Verified" badge read it.
-- After:
--   photo_verified  = the main photo passed screening (moderate-photo, swap_main_photo). Unchanged meaning for
--                     visibility: the profiles / extra-photo / voice-intro read policies keep using it, so nobody's
--                     visibility changes.
--   id_verified     = an admin approved this person's ID submission (admin_approve_id_verification only; never the
--                     person, never photo screening). id_verified_at = when. The "Verified" badge and every
--                     "Verified only" filter read id_verified.
-- Approving an ID no longer marks the photo screened (it never checked the photo for content).
-- Backfill: approved submissions -> id_verified (0 in production on 2026-10-27, so every existing badge disappears until a
-- real ID approval: today's 3 badges came from photo screening, not ID checks).
-- Requires 20270349 (its insert guard is extended here).

alter table public.profiles add column if not exists id_verified boolean not null default false;
alter table public.profiles add column if not exists id_verified_at timestamptz;

update public.profiles p set id_verified = true, id_verified_at = s.reviewed_at
from (select distinct on (user_id) user_id, reviewed_at from public.id_verification_submissions
      where status = 'approved' order by user_id, reviewed_at desc) s
where s.user_id = p.id and not p.id_verified;

-- Only trusted server code (app.trusted_update = 'true') or the service role changes it.
create or replace function public._guard_identity_verified()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if tg_op = 'INSERT' then
      new.id_verified := false;
      new.id_verified_at := null;
    else
      new.id_verified := old.id_verified;
      new.id_verified_at := old.id_verified_at;
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public._guard_identity_verified() from public, anon, authenticated;
drop trigger if exists block_client_identity_verified_edit on public.profiles;
create trigger block_client_identity_verified_edit before insert or update on public.profiles
  for each row execute function public._guard_identity_verified();

create or replace function public.admin_approve_id_verification(submission_id_param uuid, approved boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    update profiles set id_verified = true, id_verified_at = now() where id = v_user_id;
    perform set_config('app.trusted_update', 'false', true);
  end if;
end;
$function$;

-- The two people views carry id_verified (appended; every existing column unchanged).
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
  WHERE id = auth.uid() OR NOT viewer_blocked_either_way(id)
;

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

-- Friends Browse returns id_verified for the badge (a new result column, so the function is recreated; body unchanged).
drop function if exists public.get_friend_discovery_candidates(integer);
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
revoke all on function public.get_friend_discovery_candidates(integer) from public, anon;
grant execute on function public.get_friend_discovery_candidates(integer) to authenticated, service_role;
