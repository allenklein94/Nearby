-- Adaptive personal proximity, owner item 137 (2026-10-01).
--
-- Nearby learns how far THIS person usually goes for each category from real choices only: joining a gathering and
-- accepting a business offer. One new column on the existing private behavior log (20261215 / 20270231), so it inherits
-- that log's rules: owner-only read, RPC-only write, 90-day window, "Forget" per category, "Clear my activity history",
-- removed with the account (FK cascade), never read by any business-facing function (guard: behaviorPrivacyGuard.test.js).
--
-- What is stored: the trip length in miles (one decimal). Never a coordinate: for a join the device's position at the moment
-- of the choice is sent, used for one distance calculation, and discarded; for an accepted offer the distance is the
-- request's own location to the business it chose. Views, searches, recommendations shown and notifications never carry a
-- trip (only join / accept do). Ranking use is client-side, for this person only (utils/learnedProximity.js).

alter table public.behavior_events add column if not exists trip_miles numeric(6,1);
alter table public.behavior_events drop constraint if exists behavior_events_trip_shape;
alter table public.behavior_events add constraint behavior_events_trip_shape
  check (trip_miles is null or (event_type in ('join', 'accept') and trip_miles >= 0 and trip_miles <= 500));

-- Great-circle miles between two points; null when any coordinate is missing. Internal.
create or replace function public._trip_miles(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns numeric language sql immutable set search_path to 'public' as $function$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null else
    round((3958.8 * 2 * asin(least(1, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))))::numeric, 1)
  end;
$function$;
revoke all on function public._trip_miles(double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- Same contract as before plus an optional origin, used ONLY for a gathering join and never stored. The old 4-argument
-- signature is dropped so there is exactly one overload; existing callers pass named parameters and keep working.
drop function if exists public.record_behavior_event(text, text, uuid, text);
create or replace function public.record_behavior_event(event_type_param text, entity_type_param text, entity_id_param uuid, category_param text,
  origin_lat_param double precision default null, origin_lng_param double precision default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_trip numeric;
begin
  if auth.uid() is null or category_param is null or length(category_param) = 0 or length(category_param) > 60 then return; end if;
  if event_type_param not in ('open', 'create', 'join', 'search', 'accept')
     or entity_type_param not in ('gathering', 'community', 'business_request', 'search')
     or (event_type_param = 'search') <> (entity_type_param = 'search')
     or (entity_type_param = 'search') <> (entity_id_param is null) then
    raise exception 'Invalid behavior event.';
  end if;
  if event_type_param in ('search', 'accept')
     and not exists (select 1 from category_tag_groups where tag = category_param and not coalesce(business_only, false)) then
    return;
  end if;
  if exists (select 1 from behavior_events where user_id = auth.uid() and event_type = event_type_param
             and created_at > now() - interval '1 hour'
             and (case when event_type_param = 'search' then category = category_param else entity_id = entity_id_param end)) then
    return;
  end if;
  -- the trip of a real choice: a join measured from where the person was when they chose; an accepted offer from the
  -- request's own location to the business that was chosen. Anything unknown = no trip (the event still counts as before).
  if event_type_param = 'join' and entity_type_param = 'gathering'
     and origin_lat_param between -90 and 90 and origin_lng_param between -180 and 180 then
    select public._trip_miles(origin_lat_param, origin_lng_param, g.precise_lat::double precision, g.precise_lng::double precision)
      into v_trip from gatherings g where g.id = entity_id_param;
  elsif event_type_param = 'accept' and entity_type_param = 'business_request' then
    select public._trip_miles(r.latitude, r.longitude, bp.latitude, bp.longitude)
      into v_trip
      from business_requests r
      join business_request_offers o on o.request_id = r.id and o.status in ('accepted', 'completed')
      join brand_partners bp on bp.id = o.partner_id
     where r.id = entity_id_param and r.requester_id = auth.uid()
     limit 1;
  end if;
  if v_trip is not null and v_trip > 500 then v_trip := null; end if;
  delete from behavior_events where user_id = auth.uid() and created_at < now() - interval '90 days';
  insert into behavior_events (user_id, event_type, entity_type, entity_id, category, trip_miles)
  values (auth.uid(), event_type_param, entity_type_param, entity_id_param, category_param, v_trip);
end;
$function$;
revoke all on function public.record_behavior_event(text, text, uuid, text, double precision, double precision) from public, anon;
grant execute on function public.record_behavior_event(text, text, uuid, text, double precision, double precision) to authenticated;

-- The caller's own trips, newest first (category, miles, kind, when): the only read path the app uses. Last 90 days.
create or replace function public.get_my_trip_choices()
returns table(category text, trip_miles numeric, event_type text, created_at timestamptz)
language sql security definer stable set search_path to 'public' as $function$
  select be.category, be.trip_miles, be.event_type, be.created_at
    from behavior_events be
   where be.user_id = auth.uid() and be.trip_miles is not null and be.created_at >= now() - interval '90 days'
   order by be.created_at desc
   limit 500;
$function$;
revoke all on function public.get_my_trip_choices() from public, anon;
grant execute on function public.get_my_trip_choices() to authenticated;
