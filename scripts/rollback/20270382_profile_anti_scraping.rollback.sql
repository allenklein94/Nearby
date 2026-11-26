-- Rollback for migration 20270382 (people anti-scraping). Run before rolling back anything older. Restores the read rule,
-- views and functions exactly as after 20270352 / 20270359 / 20270369 / the baseline; drops the served / limit records
-- and the discovery-limit signals (behaviour signals of other kinds and every review case are kept; a case opened by a
-- discovery-limit signal keeps its evidence copy, as any case does).
select cron.unschedule(jobid) from cron.job where jobname = 'purge-profile-served';
drop function if exists private.purge_profile_served();

-- the read policy as before
alter policy "Users can view own or verified profiles" on public.profiles
  using ((auth.uid() = id) OR ((photo_verified = true) AND (profile_hidden = false)));

-- the views as after 20270352 (directly on profiles), then the private row views
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
    AND NOT viewer_blocked_either_way(p.id)
    AND person_discoverable(p.id);

revoke all on public.people_visible_to_me from public, anon, authenticated;
revoke all on public.dating_candidates_visible_to_me from public, anon, authenticated;
grant select on public.people_visible_to_me to authenticated;
grant select on public.dating_candidates_visible_to_me to authenticated;

-- functions as before (signatures unchanged)
drop function if exists public.browse_dating_candidates(text[], integer, integer);
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
revoke all on function public.get_friend_discovery_candidates(integer) from public, anon;
grant execute on function public.get_friend_discovery_candidates(integer) to authenticated, service_role;
drop function if exists private.friend_discovery_rows(integer);
CREATE OR REPLACE FUNCTION public.get_suggested_friends()
 RETURNS TABLE(suggested_id uuid, display_name text, photo_url text, mutual_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with my_friends as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = auth.uid() or f.user_b = auth.uid())
  ),
  friends_of_friends as (
    select case when f.user_a = mf.friend_id then f.user_b else f.user_a end as suggested_id
    from friendships f
    join my_friends mf on (f.user_a = mf.friend_id or f.user_b = mf.friend_id)
    where f.status = 'accepted'
  )
  select
    fof.suggested_id,
    p.display_name,
    p.photo_url,
    count(*) as mutual_count
  from friends_of_friends fof
  join profiles p on p.id = fof.suggested_id
  where fof.suggested_id != auth.uid()
  and fof.suggested_id not in (select friend_id from my_friends)
  and not exists (
    select 1 from blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = fof.suggested_id)
    or (b.blocker_id = fof.suggested_id and b.blocked_id = auth.uid())
  )
  and not exists (
    select 1 from friendships f2
    where (f2.user_a = auth.uid() and f2.user_b = fof.suggested_id)
    or (f2.user_a = fof.suggested_id and f2.user_b = auth.uid())
  )
  group by fof.suggested_id, p.display_name, p.photo_url
  order by mutual_count desc
  limit 10;
$function$
;
revoke all on function public.get_suggested_friends() from public, anon;
grant execute on function public.get_suggested_friends() to authenticated, service_role;
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
    select p.id, p.display_name, p.photo_url
    from profiles p
    join auth.users u on u.id = p.id
    where u.phone = any(phone_numbers)
    and p.id != auth.uid();
end;
$function$;

drop view if exists private.dating_candidate_rows;
drop view if exists private.people_rows;
drop function if exists private.serve_profiles(uuid[], text);
drop function if exists private.note_discovery_limit(uuid);
drop function if exists public.viewer_may_read_profile(uuid);

-- behaviour signals: the discovery-limit kinds go, then the checks as after 20270363
delete from private.behavior_signals where kind in ('discovery_limit', 'discovery_limit_repeated');
update private.behavior_signal_settings
   set case_alone_kinds = array(select k from unnest(case_alone_kinds) k where k <> 'discovery_limit_repeated') where id;
alter table private.behavior_signals drop constraint if exists behavior_signals_kind_check;
alter table private.behavior_signals add constraint behavior_signals_kind_check
  check (kind in ('repeated_messages', 'join_burst', 'location_switching', 'limit_burst'));
alter table private.behavior_signal_settings drop constraint if exists behavior_signal_settings_case_alone_kinds_check;
alter table private.behavior_signal_settings add constraint behavior_signal_settings_case_alone_kinds_check
  check (case_alone_kinds <@ array['repeated_messages', 'join_burst', 'location_switching', 'limit_burst']);
create or replace function private.behavior_evaluate_case(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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
  if not ((s.case_min_signal_kinds is not null and cardinality(v_kinds) >= s.case_min_signal_kinds)
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

drop table if exists private.profile_discovery_limit_days;
drop table if exists private.profile_served;
drop table if exists private.profile_read_limits;

drop index if exists public.gathering_interest_user_gathering_idx;
drop index if exists public.community_members_user_idx;
drop index if exists public.notices_pair_idx;
drop index if exists public.social_invites_pair_idx;
drop index if exists public.gatherings_host_scheduled_idx;
drop index if exists public.stories_user_public_idx;
