-- Softens get_weather_result()'s (and its unused-but-identical sibling
-- get_social_forecast()'s) hardcoded forecast_detail copy away from
-- claiming a specific time of day. The underlying OpenWeatherMap call is
-- a current-conditions snapshot at request time, not an hourly forecast —
-- "tonight"/"a better night" was misleading for any request that didn't
-- happen to fire in the evening (e.g. a morning request during rain still
-- said "a better night for something indoors"). This does not change
-- forecast_label, the Quiet/Excellent/Good bucketing logic, or add any
-- new time-of-day data the backend doesn't have — it only replaces the
-- three strings that claimed a specific time with time-neutral wording.
-- Flagged as a known open item in CLAUDE.md; genuinely time-specific
-- claims (e.g. "rain after 7 PM") would still need a real hourly-forecast
-- API integration, deliberately not attempted here.

CREATE OR REPLACE FUNCTION public.get_social_forecast(my_lat double precision, my_lng double precision)
 RETURNS TABLE(condition text, temp_f numeric, forecast_label text, forecast_detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  api_key text;
  request_id bigint;
  response_content text;
  response jsonb;
  weather_main text;
  weather_temp numeric;
  weather_condition_id integer;
  attempts integer := 0;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'openweather_api_key';

  select net.http_get(
    url := format(
      'https://api.openweathermap.org/data/2.5/weather?lat=%s&lon=%s&appid=%s&units=imperial',
      my_lat, my_lng, api_key
    )
  ) into request_id;

  loop
    select content into response_content from net._http_response where id = request_id;
    exit when response_content is not null or attempts >= 40;
    attempts := attempts + 1;
    perform pg_sleep(0.5);
  end loop;

  if response_content is null then
    raise exception 'Weather request timed out after % attempts', attempts;
  end if;

  response := response_content::jsonb;
  weather_main := response -> 'weather' -> 0 ->> 'main';
  weather_temp := (response -> 'main' ->> 'temp')::numeric;
  weather_condition_id := (response -> 'weather' -> 0 ->> 'id')::integer;

  return query select
    weather_main,
    weather_temp,
    case
      when weather_condition_id < 700 then 'Quiet'
      when weather_temp < 45 or weather_temp > 95 then 'Quiet'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Excellent'
      else 'Good'
    end,
    case
      when weather_condition_id < 700 then 'Rain or storms expected — a better time for something indoors.'
      when weather_temp < 45 then 'Cold out — outdoor plans might be a harder sell right now.'
      when weather_temp > 95 then 'Very hot — outdoor plans are better earlier or later in the day.'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Clear skies and comfortable temps — good conditions for outdoor plans.'
      else 'Decent conditions out there right now.'
    end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_weather_result(request_id_param bigint)
 RETURNS TABLE(condition text, temp_f numeric, forecast_label text, forecast_detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  response_content text;
  response jsonb;
  weather_main text;
  weather_temp numeric;
  weather_condition_id integer;
begin
  select content into response_content from net._http_response where id = request_id_param;

  if response_content is null then
    return;
  end if;

  response := response_content::jsonb;
  weather_main := response -> 'weather' -> 0 ->> 'main';
  weather_temp := (response -> 'main' ->> 'temp')::numeric;
  weather_condition_id := (response -> 'weather' -> 0 ->> 'id')::integer;

  return query select
    weather_main,
    weather_temp,
    case
      when weather_condition_id < 700 then 'Quiet'
      when weather_temp < 45 or weather_temp > 95 then 'Quiet'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Excellent'
      else 'Good'
    end,
    case
      when weather_condition_id < 700 then 'Rain or storms expected — a better time for something indoors.'
      when weather_temp < 45 then 'Cold out — outdoor plans might be a harder sell right now.'
      when weather_temp > 95 then 'Very hot — outdoor plans are better earlier or later in the day.'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Clear skies and comfortable temps — good conditions for outdoor plans.'
      else 'Decent conditions out there right now.'
    end;
end;
$function$
;
