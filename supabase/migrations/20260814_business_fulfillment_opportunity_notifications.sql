-- Intent Layer + Business Fulfillment, follow-up hardening pass (see
-- CLAUDE.md's "Intent Layer + Business Fulfillment" plan, Phase 4's own
-- status note) -- closes two real, low-severity gaps flagged during a
-- post-Phase-4 review and asked to be fixed rather than left flagged:
--
--   1. _business_request_fanout() never notified the businesses it fanned
--      out to -- a business only ever found out about a new pending
--      opportunity by checking their dashboard. Now loops over the
--      partners it actually inserted a row for (via RETURNING) and pushes
--      each one a real "New opportunity nearby!" notification, same
--      unconditional-send precedent already established for every other
--      business_* push in this schema (no notify_* preference exists for
--      this event type).
--   2. _match_request_to_availability()'s returned count (previously
--      discarded via `perform`, not `select ... into`) conflated two
--      different things: a business that was already fanned out to (and
--      just got upgraded pending -> offered) vs. a business genuinely
--      newly contacted because it matched via availability but fell
--      outside the fanout's top-10-nearest set. create_business_request/
--      create_business_request_for_gathering's own returned
--      `notifiedCount` only ever reflected the fanout's count, silently
--      undercounting in that edge case. Now returns only the genuinely-
--      new count (checked via a pre-existence lookup before the upsert,
--      not FOUND, since FOUND is true for both a fresh insert and an
--      upgrade) and both callers add it to their own notifiedCount.
--      Also now pushes the matched business directly, same reasoning as
--      item 1 -- an availability-sourced 'offered' row is a real
--      opportunity the business might not otherwise notice until a
--      consumer accepts it.
--
-- New push type `business_opportunity_received`, routed client-side to
-- BusinessDashboard's Requests tab (new `initialSection` route param,
-- read by BusinessDashboardScreen.js -- same established pattern as
-- Gatherings' `initialTab`/Inbox's `initialSection`).

-- ---------- FUNCTION: _business_request_fanout (re-pointed) ----------
create or replace function public._business_request_fanout(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_notified_count integer := 0;
  v_raw_text text;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_row in
    with eligible as (
      select p.id, (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      )) as distance_miles
      from brand_partners p
      where p.active = true
      and p.latitude is not null
      and p.longitude is not null
    )
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, id
    from eligible
    where distance_miles <= radius_miles_param
    order by distance_miles asc
    limit 10
    returning partner_id
  loop
    v_notified_count := v_notified_count + 1;

    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_row.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'New opportunity nearby!',
            'body', 'A customer is asking for: "' || left(coalesce(v_raw_text, ''), 60) || '"',
            'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
          )
        );
      end loop;
    end if;
  end loop;

  return v_notified_count;
end;
$function$;

revoke all on function public._business_request_fanout(uuid, double precision, double precision, double precision) from public, anon, authenticated;

-- ---------- FUNCTION: _match_request_to_availability (re-pointed) ----------
create or replace function public._match_request_to_availability(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  category_param text,
  date_param date,
  time_window_start_param time,
  time_window_end_param time
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_avail record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  for v_avail in
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or ba.remaining_capacity > 0)
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
    order by ba.created_at desc
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

revoke all on function public._match_request_to_availability(uuid, double precision, double precision, double precision, text, date, time, time) from public, anon, authenticated;

-- ---------- create_business_request: re-pointed to add availability's new-contact count ----------
create or replace function public.create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  party_size_param integer default null,
  budget_min_param integer default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time default null,
  time_window_end_param time default null,
  radius_miles_param double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
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
    radius_miles, expires_at
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param) into v_avail_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) to authenticated;

-- ---------- create_business_request_for_gathering: re-pointed to add availability's new-contact count ----------
create or replace function public.create_business_request_for_gathering(
  gathering_id_param uuid,
  raw_text_param text,
  category_param text default null,
  budget_max_param integer default null,
  radius_miles_param double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
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

  select count(*) into v_party_size
  from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';
  v_party_size := coalesce(v_party_size, 0) + 1;

  v_expires_at := least(v_scheduled_at, now() + interval '30 days');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, latitude, longitude,
    radius_miles, expires_at, gathering_id
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_scheduled_at::date, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null) into v_avail_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$;

revoke all on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) from public, anon;
grant execute on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) to authenticated;
