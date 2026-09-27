-- Item 111: "Find a business" from a gathering carries the gathering's own facts (category, date, time, group size,
-- location are all read server-side from the gathering, unchanged) and asks only "Anything specific you'd like the
-- business to provide?". For coffee/food gatherings that answer is the SAME closed requested-items list a solo ask
-- uses (item 69: coffee, pastries...), so the gathering creator gains a trailing items_param. Stored in
-- business_requests.requested_items (CHECK unchanged) and shown to a business only via get_business_opportunities,
-- never in the summary or a push body. Old 11-arg overload dropped so exactly one signature remains.
drop function if exists public.create_business_request_for_gathering(uuid, text, text, integer, double precision, text, text[], uuid, text, date, time without time zone);

CREATE OR REPLACE FUNCTION public.create_business_request_for_gathering(gathering_id_param uuid, raw_text_param text, category_param text DEFAULT NULL::text, budget_max_param integer DEFAULT NULL::integer, radius_miles_param double precision DEFAULT 15, occasion_param text DEFAULT NULL::text, dietary_param text[] DEFAULT NULL::text[], target_partner_id_param uuid DEFAULT NULL::uuid, note_param text DEFAULT NULL::text, date_param date DEFAULT NULL::date, time_start_param time without time zone DEFAULT NULL::time without time zone, items_param text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host_id uuid;
  v_scheduled_at timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_party_size integer;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
  v_note text;
  v_local_date date;
  v_local_time time;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'bachelor_bachelorette', 'fundraiser', 'first_date', 'self_care', 'networking', 'vacation', 'milestone',
    'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
  end if;

  if items_param is not null and (cardinality(items_param) > 9 or not items_param <@ array['coffee','tea','pastries','cake','sandwiches','appetizers','full_meal','desserts','soft_drinks']::text[]) then
    raise exception 'Invalid requested items';
  end if;

  select host_id, scheduled_at, precise_lat, precise_lng
  into v_host_id, v_scheduled_at, v_lat, v_lng
  from gatherings where id = gathering_id_param;

  if v_host_id is null then
    raise exception 'Gathering not found.';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can ask businesses on behalf of this gathering.';
  end if;
  if v_lat is null or v_lng is null then
    raise exception 'This gathering has no location set.';
  end if;

  if target_partner_id_param is not null then
    if not exists (select 1 from brand_partners where id = target_partner_id_param and active = true) then
      raise exception 'That business could not be found';
    end if;
    v_note := public._clean_note_for_business(note_param);
  end if;

  select id into v_duplicate_id
  from business_requests
  where gathering_id = gathering_id_param and status = 'open'
  order by created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', null);
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', null);
  end if;

  v_party_size := public._gathering_party_size(gathering_id_param);
  select local_date, local_time into v_local_date, v_local_time from public._gathering_local_when(v_scheduled_at, v_host_id, date_param, time_start_param);

  v_expires_at := least(v_scheduled_at, now() + interval '30 days');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude,
    radius_miles, expires_at, gathering_id, occasion, dietary, target_partner_id, note_for_business, attributes, requested_items
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_local_date, v_local_time, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param, occasion_param, public.normalize_dietary(dietary_param), target_partner_id_param, v_note,
    public._gathering_request_attributes(gathering_id_param),
    coalesce((select array_agg(distinct t order by t) from unnest(items_param) t), '{}')
  ) returning id into v_request_id;

  if target_partner_id_param is not null then
    perform public._route_request_to_partner(v_request_id, target_partner_id_param);
    return jsonb_build_object('requestId', v_request_id, 'notifiedCount', 1, 'partySize', v_party_size, 'targeted', true);
  end if;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null, null, v_party_size) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), v_party_size, null, null) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$
;
revoke all on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision, text, text[], uuid, text, date, time without time zone, text[]) from public, anon;
grant execute on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision, text, text[], uuid, text, date, time without time zone, text[]) to authenticated, service_role;
