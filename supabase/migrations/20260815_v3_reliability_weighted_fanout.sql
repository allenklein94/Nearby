-- "Nearby V3/V4" plan, Phase C (see CLAUDE.md's "Nearby V3/V4 strategic
-- vision" plan section): reliability-weighted fan-out and offer ordering.
--
-- _business_request_fanout() and _match_request_to_availability() both
-- currently order/notify eligible businesses by plain radius/recency
-- only -- a business with a real, established track record of actually
-- following through gets no preference over one with none. This extends
-- both to prefer (not exclusively surface -- every eligible business
-- still gets included, same radius/eligibility bound as before, only the
-- ORDER BY changes) a real, established completion-rate track record,
-- reusing the exact same aggregate get_partner_offer_reputation() already
-- computes (inlined here rather than called as an RPC, since this runs
-- inside another SECURITY DEFINER function over the same table), gated
-- on the same real 5-opportunity threshold formatPartnerReliabilityLine()
-- already uses client-side (business_request_offers.js). A partner below
-- that threshold is never penalized -- among the rest, this ordering
-- falls back to exactly the same tie-break the old query already used
-- (distance asc / created_at desc), so a brand-new partner with no
-- history lands exactly where it would have today.
--
-- Both function bodies pulled fresh from live production via the
-- Management API before editing (not reconstructed from the last local
-- migration file, which could have drifted) -- confirmed byte-identical
-- to 20260814_business_fulfillment_opportunity_notifications.sql's own
-- copy, so no drift to reconcile. Only the ORDER BY (and, for the
-- fan-out, the CTE it reads from) changed -- every other line, including
-- the push-notification logic, is untouched.

-- ---------- FUNCTION: _business_request_fanout (reliability-weighted) ----------
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
    ),
    reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, e.id
    from eligible e
    left join reputation r on r.partner_id = e.id
    where e.distance_miles <= radius_miles_param
    order by
      -- Established (5+ real past opportunities) partners first, ranked
      -- by real completion rate. Everyone else (no row, or under the
      -- threshold) falls through in exactly their prior distance-only
      -- order -- completion_rate is null for them, "nulls last" keeps
      -- them as one undifferentiated group below the established ones.
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      e.distance_miles asc
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

-- ---------- FUNCTION: _match_request_to_availability (reliability-weighted) ----------
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

revoke all on function public._match_request_to_availability(uuid, double precision, double precision, double precision, text, date, time, time) from public, anon, authenticated;
