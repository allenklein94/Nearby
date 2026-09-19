-- Business-facing payloads carry only the minimum needed to evaluate, offer on, and fulfill a specific request.
-- Removes from get_business_opportunities: raw_text (consumer's own typed sentence), shared_interests (profile-derived),
-- match_id / gathering_id (internal ids), plan_label (consumer free text the business UI never read).
-- Adds `summary` (built ONLY from structured fields by business_safe_request_summary) and `is_match_request` (boolean; the UI
-- needs it for the existing "Two people planning to visit" anonymization -- the id itself is not needed).
-- The same summary replaces raw_text in every push sent TO a business (new opportunity, AI auto-response, offer accepted,
-- customer cancelled). Consumer-side pushes and the consumer's own reads of raw_text are unchanged.
-- `attributes`/`cuisine`/`occasion` stay: each is a DB-CHECK-constrained closed vocabulary (no free text, no dietary field exists).

create or replace function public.business_safe_request_summary(request_id_param uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(nullif(concat_ws(' · ',
    nullif(initcap(replace(br.occasion, '_', ' ')), ''),
    nullif(br.category, ''),
    case when br.party_size is not null then 'party of ' || br.party_size end,
    case when br.date is not null then to_char(br.date, 'Mon FMDD') end
  ), ''), 'A new request')
  from public.business_requests br where br.id = request_id_param
$fn$;
revoke all on function public.business_safe_request_summary(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_business_opportunities(partner_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price, bro.price_is_per_person,
      bro.offer_description, bro.proposed_time, bro.created_at, bro.expires_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.viewed_at, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id,
      jsonb_build_object(
        'category', br.category,
        'party_size', br.party_size,
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'summary', public.business_safe_request_summary(br.id),
        'is_match_request', br.match_id is not null,
        'attributes', br.attributes,
        'cuisine', br.cuisine,
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level,
          'party_type', g.party_type
        ) else null end,
        'requester_display_name', case
          when bro.status in ('accepted', 'completed') and br.match_id is null
          then req.display_name
          else null
        end
      ) as business_requests,
      case when bres.id is not null then jsonb_build_object(
        'status', bres.status,
        'business_payments', case when bp.id is not null then jsonb_build_object('status', bp.status) else null end
      ) else null end as business_reservations
    from public.business_request_offers bro
    join public.business_requests br on br.id = bro.request_id
    left join public.gatherings g on g.id = br.gathering_id
    left join public.profiles req on req.id = br.requester_id
    left join public.business_reservations bres on bres.offer_id = bro.id
    left join public.business_payments bp on bp.reservation_id = bres.id
    where bro.partner_id = partner_id_param
  ) t;

  return v_result;
end;
$function$;

revoke all on function public.get_business_opportunities(uuid) from public, anon;
grant execute on function public.get_business_opportunities(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_filter_param text[] DEFAULT NULL::text[], business_major_filter_param text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_raw_text text;
  v_req_attributes text[];
  v_req_cuisine text;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, attributes, cuisine into v_raw_text, v_req_attributes, v_req_cuisine from business_requests where id = request_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_row in
    with eligible as (
      select p.id, p.attributes, p.cuisine, (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      )) as distance_miles
      from brand_partners p
      where p.active = true
      and p.latitude is not null
      and p.longitude is not null
      and (category_filter_param is null or p.subcategory = any(category_filter_param) or p.categories && category_filter_param)
      and (business_major_filter_param is null or p.category = business_major_filter_param)
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
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) desc,
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
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'New opportunity nearby!',
            'body', 'New request: ' || public.business_safe_request_summary(request_id_param),
            'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
          )
        );
      end loop;
    end if;
  end loop;

  return v_notified_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public._ai_auto_respond_to_business_requests(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
  v_exp record;
  v_reason text;
  v_offer_price numeric;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bap.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name, p.ai_trust_level
    from business_ai_policies bap
    join brand_partners p on p.id = bap.partner_id and p.active = true
    left join reputation r on r.partner_id = bap.partner_id
    where bap.enabled = true
    and bap.action_type = 'auto_respond_offer'
    and p.ai_trust_level >= 2
    and bap.trust_level <= p.ai_trust_level
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bap.created_at desc
  loop
    v_reason := null;
    v_exp := null;

    if category_param is null or (v_policy.conditions ->> 'category') is distinct from category_param then
      v_reason := 'category_mismatch';
    elsif party_size_param is not null and v_policy.conditions ? 'party_size_max'
          and party_size_param > (v_policy.conditions ->> 'party_size_max')::integer then
      v_reason := 'party_size_out_of_range';
    elsif v_policy.conditions ? 'hours_start' and v_policy.conditions ? 'hours_end'
          and time_window_start_param is not null and time_window_end_param is not null
          and not ((time_window_start_param, time_window_end_param) overlaps
                    ((v_policy.conditions ->> 'hours_start')::time, (v_policy.conditions ->> 'hours_end')::time)) then
      v_reason := 'hours_mismatch';
    else
      select * into v_exp from business_experiences
      where id = (v_policy.conditions ->> 'experience_id')::uuid
      and partner_id = v_policy.partner_id and active = true;

      if v_exp.id is null then
        v_reason := 'experience_inactive';
      end if;
    end if;

    if v_reason is not null then
      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, requires_approval, approval_result, outcome
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('policy_name', v_policy.name),
        false, 'blocked', v_reason
      )
      on conflict (policy_id, (input_ref ->> 'request_id')) where approval_result = 'blocked' do nothing;
      continue;
    end if;

    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    v_offer_price := case v_exp.price_level
      when '$' then 15 when '$$' then 35 when '$$$' then 65 else null
    end;

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_price, offer_description, status, responded_at
    ) values (
      request_id_param, v_policy.partner_id, 'standard', v_offer_price,
      coalesce(v_policy.partner_name, 'This business') || ' automatically confirmed: ' || v_exp.title
        || case when v_exp.description is not null then ' -- ' || v_exp.description else '' end,
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type,
          offer_price = excluded.offer_price, offer_description = excluded.offer_description,
          responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, actual_action, confidence, requires_approval, approval_result
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('experience_id', v_exp.id, 'experience_title', v_exp.title, 'price_level', v_exp.price_level),
        jsonb_build_object('offer_type', 'standard', 'offer_price', v_offer_price),
        null, false, 'auto_applied'
      );

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_policy.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your AI Automation auto-responded!',
              'body', 'Policy "' || v_policy.name || '" auto-sent an offer for: ' || public.business_safe_request_summary(request_id_param),
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

CREATE OR REPLACE FUNCTION public.accept_business_offer(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_reservation_id uuid;
  v_managing_profiles uuid[];
  service_key text;
  v_stripe_ready boolean;
  v_payment_status text;
  v_payment_provider text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_consumer_title text;
  v_consumer_body text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id <> auth.uid() then
    raise exception 'You do not own this request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;

  if v_offer.availability_id is not null then
    select * into v_availability from business_availability where id = v_offer.availability_id for update;
    if v_availability is not null and v_availability.remaining_capacity is not null then
      if v_availability.remaining_capacity <= 0 then
        raise exception 'This availability just filled up.';
      end if;
      update business_availability
      set remaining_capacity = remaining_capacity - 1,
          status = case when remaining_capacity - 1 <= 0 then 'filled' else status end
      where id = v_offer.availability_id;
    end if;
  end if;

  update business_request_offers
  set status = 'accepted', accepted_at = now()
  where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id
  and id <> offer_id_param
  and status in ('pending', 'offered');

  update business_requests
  set status = 'fulfilled'
  where id = v_request.id;

  insert into business_reservations (offer_id, status, provider, confirmed_at)
  values (offer_id_param, 'confirmed', 'nearby', now())
  returning id into v_reservation_id;

  -- Real, honest routing: a payable Stripe PaymentIntent can only follow
  -- when there's a real price AND the business has genuinely finished
  -- Connect onboarding (stripe_charges_enabled) -- otherwise this stays
  -- exactly the pre-Stripe 'not_required' state, never a fabricated
  -- pending charge nothing downstream can actually collect.
  select stripe_charges_enabled into v_stripe_ready
  from brand_partners where id = v_offer.partner_id;

  if v_offer.offer_price is not null and coalesce(v_stripe_ready, false) then
    v_payment_status := 'pending';
    v_payment_provider := 'stripe';
  else
    v_payment_status := 'not_required';
    v_payment_provider := null;
  end if;

  insert into business_payments (reservation_id, status, amount, currency, payer_id, provider)
  values (v_reservation_id, v_payment_status, v_offer.offer_price, 'usd', auth.uid(), v_payment_provider);

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into v_partner_name from brand_partners where id = v_offer.partner_id;

  select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
  if v_managing_profiles is not null and service_key is not null then
    for i in 1 .. array_length(v_managing_profiles, 1) loop
      continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_managing_profiles[i],
          'title', 'Your offer was accepted!',
          'body', 'A customer accepted your offer: ' || public.business_safe_request_summary(v_request.id),
          'data', jsonb_build_object('type', 'business_offer_accepted', 'request_id', v_request.id, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(v_request.id);

  if v_occ_type is not null then
    v_consumer_title := _occasion_emoji(v_occ_type) || ' Reservation Confirmed!';
    if v_occ_who is not null then
      v_consumer_body := 'Your reservation for ' || v_occ_who || '''s ' || _occasion_noun(v_occ_type) || ' is confirmed!';
    else
      v_consumer_body := 'Your ' || _occasion_noun(v_occ_type) || ' reservation is confirmed!';
    end if;
  else
    v_consumer_title := '✅ Reservation Confirmed!';
    v_consumer_body := 'Your reservation' || case when v_partner_name is not null then ' with ' || v_partner_name else '' end || ' is confirmed!';
  end if;

  if service_key is not null and coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_request.requester_id,
        'title', v_consumer_title,
        'body', v_consumer_body,
        'data', jsonb_build_object('type', 'business_reservation_confirmed', 'request_id', v_request.id, 'offer_id', offer_id_param)
      )
    );
  end if;

  -- Item 90: everyone else on the plan learns it's confirmed too.
  perform _notify_other_plan_participants(
    v_request.id,
    v_request.requester_id,
    'plan_confirmed',
    v_consumer_title,
    v_consumer_body,
    jsonb_build_object('offer_id', offer_id_param)
  );

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'paymentRequired', v_payment_status = 'pending'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_business_reservation(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_partner_id uuid;
  v_is_business boolean;
  v_partner_name text;
  v_actor_name text;
  v_managing_profiles uuid[];
  service_key text;
  v_result jsonb;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'This reservation is not in a state that can be cancelled.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id;

  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is not null and v_partner_id = v_offer.partner_id then
    v_is_business := true;
  elsif auth.uid() = v_request.requester_id then
    v_is_business := false;
  else
    raise exception 'You are not part of this reservation.';
  end if;

  v_result := _cancel_reservation_by_offer(offer_id_param);
  if not (v_result->>'cancelled')::boolean then
    if v_result->>'reason' = 'payment_captured' then
      raise exception 'This reservation has already been paid for. Contact the business directly to arrange a refund.';
    else
      raise exception 'This reservation is not in a state that can be cancelled.';
    end if;
  end if;

  perform _record_cancellation('business_reservation', offer_id_param, v_offer.partner_id, case when v_is_business then 'business' else 'requester' end);

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_is_business then
    if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_request.requester_id,
          'title', 'Your reservation was cancelled',
          'body', 'The business cancelled your reservation for "' || left(v_request.raw_text, 60) || '"',
          'data', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', offer_id_param)
        )
      );
    end if;

    -- Item 90: every other real plan participant learns the business
    -- cancelled too, not just the original requester.
    perform _notify_other_plan_participants(
      v_request.id, v_request.requester_id, 'plan_reservation_cancelled',
      'Your reservation was cancelled',
      'The business cancelled the reservation for "' || left(v_request.raw_text, 60) || '"',
      jsonb_build_object('offer_id', offer_id_param)
    );
  else
    select name into v_partner_name from brand_partners where id = v_offer.partner_id;
    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'A reservation was cancelled',
            'body', 'A customer cancelled their reservation: ' || public.business_safe_request_summary(v_request.id),
            'data', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', offer_id_param)
          )
        );
      end loop;
    end if;

    -- Item 90: every other real plan participant learns whoever cancelled
    -- did so, not just the business.
    select display_name into v_actor_name from profiles where id = auth.uid();
    perform _notify_other_plan_participants(
      v_request.id, auth.uid(), 'plan_reservation_cancelled',
      'A reservation was cancelled',
      coalesce(v_actor_name, 'Someone on the plan') || ' cancelled the reservation for "' || left(v_request.raw_text, 60) || '"',
      jsonb_build_object('offer_id', offer_id_param)
    );
  end if;

  return jsonb_build_object('success', true);
end;
$function$;
