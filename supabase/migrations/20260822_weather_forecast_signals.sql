-- Weather signals engine, V1 (Aug 22 2026).
--
-- Extends the existing current-conditions-only async request/poll pair
-- (submit_weather_request / get_weather_result) to ALSO fetch
-- OpenWeatherMap's free-tier 5 day / 3 hour forecast endpoint alongside
-- the existing current-conditions call -- same API key, same free plan
-- tier (not the paid One Call API), so this costs nothing new. From the
-- real forecast data it derives normalized, honest recommendation
-- signals (outdoor_favorable, rain_risk, heat_risk, cold_risk) meant to
-- be a real input to Nearby's recommendation surfaces, not just a
-- prettier weather card -- and it closes a real, repeatedly-disclosed
-- gap in this file's own history: the old current-conditions-only
-- version could never honestly claim a specific future time ("rain
-- after 7 PM"), only describe right now. This version genuinely can,
-- because it's real forecast data, not an inferred guess.
--
-- forecast_label/forecast_detail's own core bucketing (current
-- conditions only, unchanged from before this migration) stays
-- byte-identical -- zero regression risk to what's already live.
-- forecast_detail only ever gains one appended, genuinely-derived
-- sentence when rain is coming soon; it's never rewritten.

alter table public.weather_requests
  add column if not exists forecast_request_id bigint;

create or replace function public.submit_weather_request(my_lat double precision, my_lng double precision)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  api_key text;
  request_id bigint;
  forecast_id bigint;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'openweather_api_key';

  select net.http_get(
    url := format(
      'https://api.openweathermap.org/data/2.5/weather?lat=%s&lon=%s&appid=%s&units=imperial',
      my_lat, my_lng, api_key
    )
  ) into request_id;

  -- Same key/plan as the call above -- the free-tier 5 day/3 hour
  -- forecast endpoint, not a paid subscription. cnt=8 bounds the
  -- response to the next 24 real hours (8 x 3-hour blocks), plenty for
  -- a same-day recommendation signal, smaller payload than the full
  -- 5-day default.
  select net.http_get(
    url := format(
      'https://api.openweathermap.org/data/2.5/forecast?lat=%s&lon=%s&appid=%s&units=imperial&cnt=8',
      my_lat, my_lng, api_key
    )
  ) into forecast_id;

  insert into weather_requests (request_id, user_id, forecast_request_id)
  values (request_id, auth.uid(), forecast_id);

  return request_id;
end;
$function$;

-- Return shape changed (new columns) -- explicit DROP + CREATE, matching
-- this schema's own established "an added column creates a distinct
-- orphaned overload, drop the old one first" convention, not a plain
-- CREATE OR REPLACE.
drop function if exists public.get_weather_result(bigint);

create function public.get_weather_result(request_id_param bigint)
 returns table(
   condition text,
   temp_f numeric,
   forecast_label text,
   forecast_detail text,
   outdoor_favorable boolean,
   rain_risk text,
   heat_risk boolean,
   cold_risk boolean
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_forecast_request_id bigint;
  response_content text;
  response jsonb;
  weather_main text;
  weather_temp numeric;
  weather_condition_id integer;
  forecast_content text;
  forecast jsonb;
  tz_offset_seconds integer;
  rec record;
  entry jsonb;
  entry_idx integer;
  entry_temp numeric;
  entry_condition_id integer;
  entry_pop numeric;
  entry_local_time timestamp;
  v_max_pop numeric := 0;
  v_max_temp numeric;
  v_min_temp numeric;
  v_outdoor_favorable boolean := true;
  v_rain_risk text := 'low';
  v_heat_risk boolean := false;
  v_cold_risk boolean := false;
  v_rain_time_label text := null;
  v_base_detail text;
begin
  select forecast_request_id into v_forecast_request_id
  from weather_requests
  where request_id = request_id_param and user_id = auth.uid();

  if not found then
    return;
  end if;

  select content into response_content from net._http_response where id = request_id_param;
  if response_content is null then
    return;
  end if;

  response := response_content::jsonb;
  weather_main := response -> 'weather' -> 0 ->> 'main';
  weather_temp := (response -> 'main' ->> 'temp')::numeric;
  weather_condition_id := (response -> 'weather' -> 0 ->> 'id')::integer;

  v_base_detail := case
    when weather_condition_id < 700 then 'Rain or storms expected — a better time for something indoors.'
    when weather_temp < 45 then 'Cold out — outdoor plans might be a harder sell right now.'
    when weather_temp > 95 then 'Very hot — outdoor plans are better earlier or later in the day.'
    when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Clear skies and comfortable temps — good conditions for outdoor plans.'
    else 'Decent conditions out there right now.'
  end;

  -- Real forecast-derived signals -- honest defaults (never fabricated)
  -- when the forecast leg of the request hasn't resolved yet, a real,
  -- already-accepted possibility of this same fire-and-forget async
  -- pattern (the current-conditions call already tolerates this the
  -- same way, returning nothing rather than a guess).
  if v_forecast_request_id is not null then
    select content into forecast_content from net._http_response where id = v_forecast_request_id;
    if forecast_content is not null then
      forecast := forecast_content::jsonb;
      tz_offset_seconds := coalesce((forecast -> 'city' ->> 'timezone')::integer, 0);
      v_max_temp := weather_temp;
      v_min_temp := weather_temp;

      for rec in
        select value, ordinality
        from jsonb_array_elements(forecast -> 'list') with ordinality as t(value, ordinality)
      loop
        entry := rec.value;
        entry_idx := rec.ordinality;
        entry_temp := (entry -> 'main' ->> 'temp')::numeric;
        entry_condition_id := (entry -> 'weather' -> 0 ->> 'id')::integer;
        entry_pop := coalesce((entry ->> 'pop')::numeric, 0);

        if entry_temp > v_max_temp then v_max_temp := entry_temp; end if;
        if entry_temp < v_min_temp then v_min_temp := entry_temp; end if;
        if entry_pop > v_max_pop then v_max_pop := entry_pop; end if;

        -- The first genuinely-likely rain block (pop >= 0.4, a real
        -- rain/storm condition code) within the next ~9 hours (the
        -- first 3 of the 8 fetched 3-hour blocks) -- scoped to a
        -- same-day horizon on purpose, not the full 24h window the
        -- risk/temp signals above use, so this never reads like
        -- "rain likely" about something 20 hours out.
        if v_rain_time_label is null and entry_idx <= 3 and entry_condition_id < 700 and entry_pop >= 0.4 then
          entry_local_time := (to_timestamp((entry ->> 'dt')::bigint) at time zone 'UTC') + (tz_offset_seconds || ' seconds')::interval;
          v_rain_time_label := to_char(entry_local_time, 'FMHH12:MI AM');
        end if;
      end loop;

      v_heat_risk := v_max_temp > 95;
      v_cold_risk := v_min_temp < 45;
      v_rain_risk := case
        when v_max_pop >= 0.6 then 'high'
        when v_max_pop >= 0.3 then 'medium'
        else 'low'
      end;
      v_outdoor_favorable := (v_rain_risk = 'low') and not v_heat_risk and not v_cold_risk;

      -- Only append when it's real new information -- if it's already
      -- raining right now (weather_condition_id < 700), the base detail
      -- above already says so; this is specifically the "give me a
      -- heads-up before it starts" case.
      if v_rain_time_label is not null and weather_condition_id >= 700 then
        v_base_detail := v_base_detail || ' Rain looks likely around ' || v_rain_time_label || '.';
      end if;
    end if;
  end if;

  return query select
    weather_main,
    weather_temp,
    case
      when weather_condition_id < 700 then 'Quiet'
      when weather_temp < 45 or weather_temp > 95 then 'Quiet'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Excellent'
      else 'Good'
    end,
    v_base_detail,
    v_outdoor_favorable,
    v_rain_risk,
    v_heat_risk,
    v_cold_risk;
end;
$function$;

grant execute on function public.get_weather_result(bigint) to authenticated, service_role;
revoke all on function public.get_weather_result(bigint) from public, anon;

-- get_social_forecast is the pre-existing, already-unused synchronous
-- sibling (confirmed zero client callers, kept byte-identical to its
-- old current-conditions-only shape per its own established "kept in
-- sync anyway" precedent) -- deliberately not extended with the same
-- forecast logic this migration adds, since duplicating the fetch/parse
-- logic into a function nothing calls would just be more surface to
-- keep in sync for no real benefit.
