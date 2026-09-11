-- External UX critique item 17's own explicitly-named fast-follow (see
-- 20261004_recommended_for_you_push.sql's own header comment, restated
-- there rather than built there): the "3 people nearby are planning X"
-- social-proof copy variant from the user's own original example. A
-- brand-new gathering has zero attendees at the moment
-- notify_matching_things_to_do() fires (AFTER INSERT on gatherings), so
-- that trigger can never produce this copy -- this migration adds the
-- distinct trigger it deferred, on gathering_interest AFTER INSERT,
-- mirroring notify_group_intent_threshold()'s own "fire exactly once, at
-- the real threshold crossing" shape (same reasoning there: never again
-- for the 4th/5th/etc. person expressing interest, so this can't nag).
--
-- Threshold: 3 -- the exact number from the user's own example. "Planning"
-- is satisfied by a real gathering_interest row regardless of status
-- (pending or approved) -- expressing interest is the real signal being
-- reported here, not confirmed attendance; gathering_interest already has
-- no self-interest (no_self_gathering_interest trigger), so this can never
-- count a host's own row.
--
-- Recipients: the exact same interest-matched, presence-based, distance/
-- time-pref/frequency-gated population notify_matching_things_to_do() (the
-- other gathering-side half of this same feature) already computes --
-- reused here rather than re-derived, minus anyone who already has their
-- own gathering_interest row for this gathering (they're already going,
-- there's nothing to tell them) and minus the gathering's own host. Shares
-- recommendation_push_log's source_type='gathering' bucket and therefore
-- the same daily frequency cap notify_matching_things_to_do() already
-- enforces -- one shared budget for all gathering-side "this matches you"
-- pushes to a given user, not a second independent budget.
create or replace function public.notify_gathering_interest_threshold()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    join presence_reports pr on pr.user_id = p.id
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

create trigger on_gathering_interest_created_notify_threshold
  after insert on gathering_interest
  for each row execute function public.notify_gathering_interest_threshold();
