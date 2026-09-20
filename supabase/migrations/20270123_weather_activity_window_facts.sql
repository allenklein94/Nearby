-- Weather: per-block forecast facts + sun times for activity-window checks (2026-09-20).
--
-- Adds forecast_blocks (jsonb array of {dt,temp,pop,id} for the ~24h of 3-hour
-- blocks; NULL while the forecast is unknown), sunrise and sunset (epoch,
-- NULL when absent). Return shape changes, so drop first (single overload).
-- Everything else identical to 20270122.

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
   cold_risk boolean,
   is_daylight boolean,
   forecast_blocks jsonb,
   sunrise bigint,
   sunset bigint
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
  v_outdoor_favorable boolean := null;
  v_rain_risk text := null;
  v_heat_risk boolean := null;
  v_cold_risk boolean := null;
  v_rain_time_label text := null;
  v_base_detail text;
  v_icon text;
  v_blocks jsonb := null;
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
  -- OpenWeather's icon code ends in 'd' (day) or 'n' (night) for the location's
  -- own sun position; NULL (unknown) when absent.
  v_icon := response -> 'weather' -> 0 ->> 'icon';

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

        -- Raw per-block facts (start epoch, temp F, precipitation probability,
        -- condition id) so the client can judge the weather AT an activity's own
        -- time. No verdicts here.
        v_blocks := coalesce(v_blocks, '[]'::jsonb) || jsonb_build_object(
          'dt', (entry ->> 'dt')::bigint, 'temp', entry_temp, 'pop', entry_pop, 'id', entry_condition_id);

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

      -- Only derive the forecast signals when the forecast payload really
      -- carried forecast blocks (an API error body or an empty list is
      -- NOT "no rain expected"). Otherwise every forecast signal stays
      -- NULL = unknown, never favorable.
      if jsonb_typeof(forecast -> 'list') = 'array' and jsonb_array_length(forecast -> 'list') > 0 then
        v_heat_risk := v_max_temp > 95;
        v_cold_risk := v_min_temp < 45;
        v_rain_risk := case
          when v_max_pop >= 0.6 then 'high'
          when v_max_pop >= 0.3 then 'medium'
          else 'low'
        end;
        -- A block with a precipitation condition code (2xx thunder, 3xx
        -- drizzle, 5xx rain, 6xx snow) at pop >= 0.3 already lifts
        -- v_rain_risk above 'low', so drizzle counts as wet here.
        v_outdoor_favorable := (v_rain_risk = 'low') and not v_heat_risk and not v_cold_risk;
      end if;

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
    v_cold_risk,
    case when v_icon like '%d' then true when v_icon like '%n' then false else null end,
    v_blocks,
    (response -> 'sys' ->> 'sunrise')::bigint,
    (response -> 'sys' ->> 'sunset')::bigint;
end;
$function$;

grant execute on function public.get_weather_result(bigint) to authenticated, service_role;
revoke all on function public.get_weather_result(bigint) from public, anon;
