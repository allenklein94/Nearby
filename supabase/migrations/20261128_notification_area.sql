-- Notification area (2026-09-18). Nearby pushes ("this matches you", availability, interest thresholds)
-- used to target only people with a presence report from the last hour, and presence is refreshed only
-- from the Discovery screen / background task -- so a user browsing Discover, Gatherings or Places got no
-- relevant pushes. This adds a separate, deliberately coarse (2 decimals, ~0.7 mi) "notification area"
-- the app updates whenever it learns the user's location. It is NOT presence: it never feeds crossed
-- paths, matching or anything shown to another person; it is read only by push targeting (via the view
-- below), and the table has RLS enabled with no policies, so clients can only write it through the RPC.

create table if not exists public.notification_areas (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  area text not null,
  updated_at timestamptz not null default now()
);
alter table public.notification_areas enable row level security;
revoke all on public.notification_areas from public, anon, authenticated;

create or replace function public.set_my_notification_area(lat_param double precision, lng_param double precision)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if lat_param is null or lng_param is null or lat_param not between -90 and 90 or lng_param not between -180 and 180 then
    raise exception 'invalid coordinates';
  end if;
  insert into notification_areas (user_id, area, updated_at)
  values (auth.uid(), round(lat_param::numeric, 2)::text || ',' || round(lng_param::numeric, 2)::text, now())
  on conflict (user_id) do update set area = excluded.area, updated_at = now();
end;
$function$;
revoke all on function public.set_my_notification_area(double precision, double precision) from public, anon;
grant execute on function public.set_my_notification_area(double precision, double precision) to authenticated;

-- Where push targeting looks for "where is this person": fresh presence when there is one, otherwise the
-- notification area (valid 48h). reported_at is what the trigger functions already filter on (last hour).
create or replace view public.push_target_areas as
  select user_id, area, reported_at from public.presence_reports
  union all
  select n.user_id, n.area, now() as reported_at
  from public.notification_areas n
  where n.updated_at > now() - interval '48 hours'
    and not exists (select 1 from public.presence_reports r where r.user_id = n.user_id and r.reported_at > now() - interval '1 hour');
revoke all on public.push_target_areas from public, anon, authenticated;

-- The three location-targeted push triggers, unchanged except they read push_target_areas.
CREATE OR REPLACE FUNCTION public.notify_matching_things_to_do()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_scheduled_local timestamp;
  v_when_phrase text;
begin
  if new.visibility <> 'everyone' or coalesce(new.is_public, false) is not true or new.interest_tag is null
     or new.precise_lat is null or new.precise_lng is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_things_to_do_frequency, p.notify_things_to_do_max_distance_miles,
           p.notify_things_to_do_time_pref
    from profiles p
    join push_target_areas pr on pr.user_id = p.id
    where p.id <> new.host_id
      and coalesce(p.notify_discovery, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and p.interests @> array[new.interest_tag]
      and (p.notify_things_to_do_categories is null or new.interest_tag = any(p.notify_things_to_do_categories))
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(new.precise_lat)) * cos(radians(new.precise_lng) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(new.precise_lat))
    )));
    if v_candidate.notify_things_to_do_max_distance_miles is not null
       and v_distance_miles > v_candidate.notify_things_to_do_max_distance_miles then
      continue;
    end if;

    v_scheduled_local := new.scheduled_at at time zone v_candidate.tz;
    if v_candidate.notify_things_to_do_time_pref = 'evenings_weekends'
       and extract(dow from v_scheduled_local) not in (0, 6)
       and extract(hour from v_scheduled_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'gathering'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_things_to_do_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20 -- 'as_they_happen' -- still a hard safety ceiling, not literally unlimited
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    v_when_phrase := case
      when v_scheduled_local::date = v_today_in_tz and extract(hour from v_scheduled_local) >= 17 then 'tonight'
      when v_scheduled_local::date = v_today_in_tz then 'today'
      when v_scheduled_local::date = v_today_in_tz + 1 then 'tomorrow'
      when extract(dow from v_scheduled_local) in (0, 6) and v_scheduled_local::date <= v_today_in_tz + 7 then 'this weekend'
      else to_char(v_scheduled_local, 'FMDay')
    end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_candidate.id,
        'title', '🎯 This matches you',
        'body', '"' || new.title || '" (' || new.interest_tag || ') is happening ' || v_when_phrase || ' and matches your interests.',
        'data', jsonb_build_object('type', 'recommended_gathering', 'gathering_id', new.id)
      )
    );
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'gathering', new.id);
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_matching_business_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_partner record;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_effective_radius double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_starts_local timestamp;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select id, name, latitude, longitude, subcategory, categories
    into v_partner
    from brand_partners bp
    where bp.id = new.partner_id;
  if v_partner.latitude is null or v_partner.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_nearby_opportunities_frequency, p.notify_nearby_opportunities_max_distance_miles,
           p.notify_nearby_opportunities_time_pref
    from profiles p
    join push_target_areas pr on pr.user_id = p.id
    where coalesce(p.managed_partner_id, '00000000-0000-0000-0000-000000000000'::uuid) <> new.partner_id
      and coalesce(p.notify_discovery, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and (
        (new.category is not null and p.interests @> array[new.category])
        or (v_partner.subcategory is not null and p.interests @> array[v_partner.subcategory])
        or (v_partner.categories is not null and p.interests && v_partner.categories)
      )
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(v_partner.latitude)) * cos(radians(v_partner.longitude) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(v_partner.latitude))
    )));
    v_effective_radius := coalesce(new.radius_miles, 15);
    if v_candidate.notify_nearby_opportunities_max_distance_miles is not null then
      v_effective_radius := least(v_effective_radius, v_candidate.notify_nearby_opportunities_max_distance_miles);
    end if;
    if v_distance_miles > v_effective_radius then
      continue;
    end if;

    v_starts_local := new.starts_at at time zone v_candidate.tz;
    if v_candidate.notify_nearby_opportunities_time_pref = 'evenings_weekends'
       and extract(dow from v_starts_local) not in (0, 6)
       and extract(hour from v_starts_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'business_availability'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_nearby_opportunities_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_candidate.id,
        'title', '🌟 This matches you',
        'body', coalesce(v_partner.name, 'A nearby business') || '''s "' || new.title || '" matches your interests.',
        'data', jsonb_build_object('type', 'recommended_business_availability', 'availability_id', new.id, 'partner_id', new.partner_id)
      )
    );
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'business_availability', new.id);
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_gathering_interest_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gathering record;
  v_interest_count integer;
  v_service_key text;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_scheduled_local timestamp;
  v_when_phrase text;
begin
  select * into v_gathering from gatherings where id = new.gathering_id;
  if v_gathering.id is null
     or v_gathering.visibility <> 'everyone' or coalesce(v_gathering.is_public, false) is not true
     or v_gathering.interest_tag is null
     or v_gathering.precise_lat is null or v_gathering.precise_lng is null
     or v_gathering.scheduled_at <= now() then
    return new;
  end if;

  -- Fire exactly at the real 3rd real interest row -- never again for the
  -- 4th/5th/etc, matching notify_group_intent_threshold()'s own "fire once"
  -- precedent so this can't nag the same matched user repeatedly for one
  -- gathering as more people join.
  select count(*) into v_interest_count from gathering_interest where gathering_id = new.gathering_id;
  if v_interest_count <> 3 then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_things_to_do_frequency, p.notify_things_to_do_max_distance_miles,
           p.notify_things_to_do_time_pref
    from profiles p
    join push_target_areas pr on pr.user_id = p.id
    where p.id <> v_gathering.host_id
      and coalesce(p.notify_discovery, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and p.interests @> array[v_gathering.interest_tag]
      and (p.notify_things_to_do_categories is null or v_gathering.interest_tag = any(p.notify_things_to_do_categories))
      and not exists (
        select 1 from gathering_interest gi where gi.gathering_id = new.gathering_id and gi.user_id = p.id
      )
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(v_gathering.precise_lat)) * cos(radians(v_gathering.precise_lng) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(v_gathering.precise_lat))
    )));
    if v_candidate.notify_things_to_do_max_distance_miles is not null
       and v_distance_miles > v_candidate.notify_things_to_do_max_distance_miles then
      continue;
    end if;

    v_scheduled_local := v_gathering.scheduled_at at time zone v_candidate.tz;
    if v_candidate.notify_things_to_do_time_pref = 'evenings_weekends'
       and extract(dow from v_scheduled_local) not in (0, 6)
       and extract(hour from v_scheduled_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'gathering'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_things_to_do_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20 -- 'as_they_happen' -- still a hard safety ceiling, not literally unlimited
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    v_when_phrase := case
      when v_scheduled_local::date = v_today_in_tz and extract(hour from v_scheduled_local) >= 17 then 'tonight'
      when v_scheduled_local::date = v_today_in_tz then 'today'
      when v_scheduled_local::date = v_today_in_tz + 1 then 'tomorrow'
      when extract(dow from v_scheduled_local) in (0, 6) and v_scheduled_local::date <= v_today_in_tz + 7 then 'this weekend'
      else to_char(v_scheduled_local, 'FMDay')
    end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_candidate.id,
        'title', '🎉 People nearby are planning this',
        'body', v_interest_count || ' people are interested in "' || v_gathering.title || '" (' || v_gathering.interest_tag || '), happening ' || v_when_phrase || ' — and it matches your interests.',
        'data', jsonb_build_object('type', 'recommended_gathering', 'gathering_id', v_gathering.id)
      )
    );
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'gathering', v_gathering.id);
  end loop;
  return new;
end;
$function$;
