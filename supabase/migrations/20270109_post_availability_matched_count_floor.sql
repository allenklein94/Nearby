-- post_business_availability returned the raw number of requests it sent offers to. That is a demand figure about
-- unconnected people, so it now obeys the same floor as the pre-post preview: matchedCount is returned only when at
-- least demand_min_people() DISTINCT requesters are behind it, otherwise null. Matching, offers and pushes are unchanged;
-- signature unchanged (single overload).

CREATE OR REPLACE FUNCTION public.post_business_availability(category_param text, title_param text, description_param text, offer_type_param text, price_param numeric, capacity_param integer, starts_at_param timestamp with time zone, ends_at_param timestamp with time zone, radius_miles_param double precision DEFAULT 15, bundle_occasion_param text DEFAULT NULL::text, bundle_components_param text[] DEFAULT NULL::text[], discount_pct_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_availability_id uuid;
  v_matched_count integer := 0;
  v_matched_people uuid[] := array[]::uuid[];
  v_req record;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  service_key text;
  v_bundle_components text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;
  if title_param is null or length(trim(title_param)) = 0 then
    raise exception 'Give this availability a real title.';
  end if;
  if ends_at_param <= starts_at_param then
    raise exception 'End time must be after the start time.';
  end if;

  if bundle_occasion_param is not null and bundle_occasion_param not in (
    'date_night', 'anniversary', 'birthday', 'celebration', 'family_gathering'
  ) then
    raise exception 'Invalid bundle occasion';
  end if;

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;
  if _discount_cap_violation(v_partner_id, offer_type_param, discount_pct_param) is not null then
    raise exception '%', _discount_cap_violation(v_partner_id, offer_type_param, discount_pct_param);
  end if;

  v_bundle_components := coalesce(bundle_components_param, '{}');
  if not (v_bundle_components <@ array[
    'dinner', 'something_to_do', 'finish_the_night',
    'something_fun', 'sweet_treat',
    'food', 'family_fun'
  ]::text[]) then
    raise exception 'Invalid bundle component';
  end if;
  if array_length(v_bundle_components, 1) > 0 and bundle_occasion_param is null then
    raise exception 'A bundle needs an occasion';
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = v_partner_id;
  if v_lat is null or v_lng is null then
    raise exception 'Set your business address before posting availability.';
  end if;

  insert into business_availability (
    partner_id, category, title, description, offer_type, price,
    capacity, remaining_capacity, starts_at, ends_at, radius_miles,
    bundle_occasion, bundle_components, discount_pct
  ) values (
    v_partner_id, category_param, trim(title_param), description_param, offer_type_param, price_param,
    capacity_param, capacity_param, starts_at_param, ends_at_param, coalesce(radius_miles_param, 15),
    bundle_occasion_param, v_bundle_components, discount_pct_param
  ) returning id into v_availability_id;

  for v_req in
    select br.*
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and (capacity_param is null or br.party_size is null or capacity_param >= br.party_size)
    and (category_param is null or br.category is null or br.category = category_param)
    and (
      br.date is null
      or br.date between starts_at_param::date and ends_at_param::date
    )
    and (
      br.date is null or br.time_window_start is null or br.time_window_end is null
      or (br.date + br.time_window_start, br.date + br.time_window_end) overlaps (starts_at_param, ends_at_param)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= least(br.radius_miles, coalesce(radius_miles_param, 15))
    order by br.created_at desc
    limit 10
  loop
    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (v_req.id, v_partner_id, offer_type_param, coalesce(description_param, title_param), price_param, v_availability_id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      v_matched_count := v_matched_count + 1;
      if not (v_req.requester_id = any(v_matched_people)) then v_matched_people := array_append(v_matched_people, v_req.requester_id); end if;

      if coalesce((select notify_business from profiles where id = v_req.requester_id), true) then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
        select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(v_req.id);

        if v_occ_type is not null then
          v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
          v_push_body := trim(title_param) || ' just became available for your ' || lower(_occasion_noun(v_occ_type)) || ' request'
            || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
        else
          v_push_title := 'New offer for your request!';
          v_push_body := trim(title_param) || ' just became available for "' || left(v_req.raw_text, 60) || '"';
        end if;

        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_req.requester_id,
            'title', v_push_title,
            'body', v_push_body,
            'data', jsonb_build_object('type', 'business_offer_received', 'request_id', v_req.id)
          )
        );
      end if;
    end if;
  end loop;

  -- Privacy floor: how many requests matched is a demand figure about unconnected people, so it is returned only when
  -- >= demand_min_people() DISTINCT people are behind it (else null). The offers themselves are sent regardless.
  return jsonb_build_object(
    'availabilityId', v_availability_id,
    'matchedCount', case when coalesce(array_length(v_matched_people, 1), 0) >= public.demand_min_people() then v_matched_count end
  );
end;
$function$;
