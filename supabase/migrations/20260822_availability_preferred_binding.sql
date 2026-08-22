-- Closes CLAUDE.md's Finding 5 (Aug 14 2026, Intent Layer UX walkthrough): "matchedAvailability
-- (the banner shown when a Tier 4-lite result is tapped through to AskBusinessScreen) is
-- informational only, never threaded into the actual submit call -- submitting there re-runs
-- the generic create_business_request() fan-out/matching pipeline from scratch. Usually
-- re-matches the same posting correctly, but if it filled up or the resubmitted fields drifted
-- outside its bounds in the interim, the 'already available' promise can go unfulfilled with
-- no explicit reconciliation."
--
-- Fixed by adding an optional preferred_availability_id_param, threaded from
-- create_business_request() into _match_request_to_availability(). When present, the specific
-- business_availability row the consumer already reviewed and explicitly tapped is directly,
-- immediately bound -- as long as it's still genuinely live (active, unexpired, has capacity,
-- the partner is still within the request's own real radius) -- rather than only ever being
-- re-derived by the general category/date/time-window matching pass below it. This is an
-- honest, deliberate binding of what the consumer already saw and chose, not a bypass of the
-- app's real constraints (a genuinely expired/filled/cancelled posting still correctly falls
-- through to nothing, same as before this fix). The general matching loop runs afterward
-- unchanged (excluding the already-bound posting from its own candidate set, so it can't be
-- double-processed) to still catch any other real matches on top of the preferred one.
--
-- Both functions' bodies were pulled fresh via the Management API before editing -- every other
-- line is byte-for-byte unchanged from what's live in production today. Both old signatures are
-- explicitly DROPped before the new ones are created, matching this schema's own established
-- "a CREATE OR REPLACE with an added param creates a distinct orphaned overload, it doesn't
-- replace the old one" lesson (see CLAUDE.md's "Aug 17 2026 -- closing the last concurrency gap"
-- section) -- not repeating that mistake here.

DROP FUNCTION IF EXISTS public._match_request_to_availability(uuid, double precision, double precision, double precision, text, date, time without time zone, time without time zone);

CREATE FUNCTION public._match_request_to_availability(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  category_param text,
  date_param date,
  time_window_start_param time without time zone,
  time_window_end_param time without time zone,
  preferred_availability_id_param uuid DEFAULT NULL
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_avail record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_availability_id_param is not null then
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true
    where ba.id = preferred_availability_id_param
    and ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
      values (request_id_param, v_preferred.partner_id, v_preferred.offer_type, coalesce(v_preferred.description, v_preferred.title), v_preferred.price, v_preferred.id, 'offered', now())
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        if service_key is null then
          select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
        end if;
        select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_preferred.partner_id;
        if v_managing_profiles is not null then
          for i in 1 .. array_length(v_managing_profiles, 1) loop
            perform net.http_post(
              url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
              headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
              body := jsonb_build_object(
                'recipient_id', v_managing_profiles[i],
                'title', 'Your availability was just matched!',
                'body', '"' || v_preferred.title || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
                'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
              )
            );
          end loop;
        end if;
      end if;
    end if;
  end if;

  for v_avail in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true
    left join reputation r on r.partner_id = ba.partner_id
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and p.latitude is not null and p.longitude is not null
    and (
      date_param is null
      or date_param between ba.starts_at::date and ba.ends_at::date
    )
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      ba.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_avail.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_avail.partner_id, v_avail.offer_type, coalesce(v_avail.description, v_avail.title), v_avail.price, v_avail.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_avail.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your availability was just matched!',
              'body', '"' || v_avail.title || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return v_new_count;
end;
$function$;

REVOKE ALL ON FUNCTION public._match_request_to_availability(uuid, double precision, double precision, double precision, text, date, time without time zone, time without time zone, uuid) FROM public, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time without time zone, time without time zone, double precision, uuid);

CREATE FUNCTION public.create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text DEFAULT NULL::text,
  party_size_param integer DEFAULT NULL::integer,
  budget_min_param integer DEFAULT NULL::integer,
  budget_max_param integer DEFAULT NULL::integer,
  date_param date DEFAULT NULL::date,
  time_window_start_param time without time zone DEFAULT NULL::time without time zone,
  time_window_end_param time without time zone DEFAULT NULL::time without time zone,
  radius_miles_param double precision DEFAULT 15,
  submission_id_param uuid DEFAULT NULL::uuid,
  preferred_availability_id_param uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
  end if;

  v_expires_at := case
    when date_param is not null and time_window_end_param is not null
      then (date_param + time_window_end_param)::timestamptz
    when date_param is not null
      then (date_param + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;

  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_min, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at, submission_id
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid())
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param, preferred_availability_id_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), party_size_param, time_window_start_param, time_window_end_param) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

REVOKE ALL ON FUNCTION public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time without time zone, time without time zone, double precision, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time without time zone, time without time zone, double precision, uuid, uuid) TO authenticated, service_role;
