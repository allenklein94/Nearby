-- Item 119 (owner, 2026-10-16, reopened and approved): a business's ONE reply may offer up to TWO times, both for the
-- request's full party. The customer picks one; "I'll take this one" books that time. Build plan:
-- PRODUCT_AUDIT/ITEM_119_TWO_TIME_REPLY_BUILD_PLAN_2026-10-16.md (owner decisions recorded there).
--   * business_request_offers.proposed_time_alt: the second time. Two is the structural maximum (one column, no options
--     table). Only on a reply the business wrote: never with availability_id / package_id / auto_reply (automatic replies
--     stay one time; item 116's capacity path is unchanged and no two-time reply holds availability capacity).
--     Still one reply per business per request (business_request_offers_unique_partner untouched).
--   * Accepting (accept_business_offer, _accept_business_offer_internal) takes chosen_time_param; _offer_chosen_time is
--     the ONE rule: two times = a choice is required, it must be exactly one of them and still ahead; the chosen time is
--     written into proposed_time and proposed_time_alt cleared, so an accepted offer has one time for every reader.
--   * Group plans (owner: two times everywhere, no group flag ever reaches the business): each participant confirms the
--     offer AND a time (group_plan_offer_confirmations.chosen_time, visible only to that group's participants, the existing
--     policy); it books only when every participant chose the SAME time. A split stays pending; Nearby never picks.
--   * No party-size field anywhere: every time is for the whole party (item 116 / item 94 stand).
-- Old signatures are dropped (no second overload); new ones revoke public/anon.

alter table public.business_request_offers
  add column if not exists proposed_time_alt timestamptz;
alter table public.business_request_offers
  add constraint business_request_offers_alt_time_check check (
    proposed_time_alt is null
    or (proposed_time is not null and proposed_time_alt <> proposed_time
        and availability_id is null and package_id is null and auto_reply is null)
  );
comment on column public.business_request_offers.proposed_time_alt is
  'Item 119: a second time the business offers in the same reply (same full party). Cleared at acceptance, when the chosen time is written into proposed_time.';

alter table public.group_plan_offer_confirmations
  add column if not exists chosen_time timestamptz;
comment on column public.group_plan_offer_confirmations.chosen_time is
  'Item 119: the time this participant chose on a two-time reply (null on a one-time reply). The offer books only when every participant chose the same time.';

-- The ONE rule for which time an accept books.
create or replace function public._offer_chosen_time(first_param timestamptz, alt_param timestamptz, chosen_param timestamptz)
 returns timestamptz
 language plpgsql
 stable
 set search_path to 'public'
as $function$
begin
  if alt_param is null then
    if chosen_param is not null and chosen_param is distinct from first_param then
      raise exception 'That time is not one this business offered.';
    end if;
    return first_param;
  end if;
  if chosen_param is null then
    raise exception 'Pick a time first.';
  end if;
  if chosen_param is distinct from first_param and chosen_param is distinct from alt_param then
    raise exception 'That time is not one this business offered.';
  end if;
  if chosen_param <= now() then
    raise exception 'That time has already passed.';
  end if;
  return chosen_param;
end;
$function$;

drop function if exists public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time);
drop function if exists public.accept_business_offer(uuid);
drop function if exists public._accept_business_offer_internal(uuid);
drop function if exists public.confirm_group_plan_offer(uuid, uuid);

-- submit_business_offer: + proposed_time_alt_param (old signature dropped above).
CREATE OR REPLACE FUNCTION public.submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text, offer_price_param numeric DEFAULT NULL::numeric, proposed_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, experience_id_param uuid DEFAULT NULL::uuid, media_path_param text DEFAULT NULL::text, media_type_param text DEFAULT NULL::text, offer_title_param text DEFAULT NULL::text, included_items_param text[] DEFAULT '{}'::text[], price_is_per_person_param boolean DEFAULT false, discount_pct_param numeric DEFAULT NULL::numeric, redemption_instructions_param text DEFAULT NULL::text, media_poster_path_param text DEFAULT NULL::text, creative_id_param uuid DEFAULT NULL::uuid, valid_until_param timestamp with time zone DEFAULT NULL::timestamp with time zone, available_from_param time without time zone DEFAULT NULL::time without time zone, available_until_param time without time zone DEFAULT NULL::time without time zone, proposed_time_alt_param timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_request_expires_at timestamptz;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_req_category text;
  v_req_gathering uuid;
  v_offer_title text;
  v_creative record;
  v_items text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
  end if;

  select status, requester_id, raw_text, expires_at into v_request_status, v_requester_id, v_raw_text, v_request_expires_at
  from business_requests where id = request_id_param;
  if v_request_status is null then
    raise exception 'Request not found.';
  end if;
  if v_request_status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  -- The hourly sweep flips status; the deadline itself is authoritative the moment it passes.
  if v_request_expires_at is not null and v_request_expires_at <= now() then
    raise exception 'This request has expired.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;

  -- A saved creative REPLACES any media passed: its file and poster come from the library row (already screened).
  if creative_id_param is not null then
    select * into v_creative from business_creatives
     where id = creative_id_param and partner_id = v_partner_id and archived_at is null;
    if not found then raise exception 'That saved creative is not available.'; end if;
    media_path_param := v_creative.media_path;
    media_type_param := v_creative.media_type;
    media_poster_path_param := v_creative.poster_path;
  end if;
  if valid_until_param is not null and (valid_until_param <= now() or valid_until_param > now() + interval '30 days') then
    raise exception 'Pick an end time that is later than now (within 30 days).';
  end if;
  -- "Available 6:00-8:00 PM": the owner's own time-of-day window for when this offer can be used, on the day the visit
  -- is for (the accepted alternative time's day, else the request's date). Both ends or neither; same-day only.
  if (available_from_param is null) <> (available_until_param is null) then
    raise exception 'Set both a start and an end for the available window, or neither.';
  end if;
  if available_from_param is not null and available_until_param <= available_from_param then
    raise exception 'The available window must end after it starts.';
  end if;
  -- Item 119: a second time the customer can choose instead, for the same full party. Both times or one; never the same
  -- time twice; the second one must still be ahead. One reply stays one reply (unique per business per request).
  if proposed_time_alt_param is not null then
    if proposed_time_param is null then
      raise exception 'Pick the first time before adding another.';
    end if;
    if proposed_time_alt_param = proposed_time_param then
      raise exception 'The second time is the same as the first.';
    end if;
    if proposed_time_alt_param <= now() or proposed_time_param <= now() then
      raise exception 'Pick times that are later than now.';
    end if;
  end if;
  if redemption_instructions_param is not null and length(redemption_instructions_param) > 500 then
    raise exception 'Redemption instructions are too long.';
  end if;
  -- A video offer must carry a preview image (the frame Nearby screened); an image offer needs none.
  if media_type_param = 'video' and media_poster_path_param is null then
    raise exception 'A video needs a preview image.';
  end if;
  -- Media must live in this business's own folder of the offer-media bucket.
  if media_path_param is not null and media_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;
  if media_poster_path_param is not null and media_poster_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;

  v_offer_title := nullif(trim(coalesce(offer_title_param, '')), '');

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  update business_request_offers
  set status = 'offered',
      offer_type = offer_type_param,
      offer_description = offer_description_param,
      offer_title = v_offer_title,
      included_items = coalesce(v_items, '{}'),
      offer_price = offer_price_param,
      price_is_per_person = coalesce(price_is_per_person_param, false),
      discount_pct = discount_pct_param,
      proposed_time = proposed_time_param,
      proposed_time_alt = proposed_time_alt_param,
      experience_id = experience_id_param,
      media_path = media_path_param,
      media_type = media_type_param,
      media_poster_path = case when media_type_param = 'video' then media_poster_path_param else null end,
      redemption_instructions = nullif(trim(coalesce(redemption_instructions_param, '')), ''),
      creative_id = creative_id_param,
      valid_until = valid_until_param,
      available_from = available_from_param,
      available_until = available_until_param,
      responded_at = now()
  where id = v_row.id;

  -- Item 125: the reply is an event; the notification layer tells the customer (wording from _business_reply_push).
  perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', v_row.id, auth.uid(), 'submit_business_offer',
    jsonb_build_object('request_id', request_id_param, 'partner_id', v_partner_id, 'offer_id', v_row.id),
    'BUSINESS_OFFER_SENT:' || v_row.id);

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$function$;

-- accept_business_offer: + chosen_time_param.
CREATE OR REPLACE FUNCTION public.accept_business_offer(offer_id_param uuid, chosen_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
  v_stripe_ready boolean;
  v_payment_status text;
  v_payment_provider text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_consumer_title text;
  v_consumer_body text;
  v_held integer;
  v_time timestamptz;
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
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  -- Item 119: a reply with two times books the one the person picked (exactly one of the two, still ahead); it is
  -- written into proposed_time so the accepted offer has ONE time for every reader after this.
  v_time := public._offer_chosen_time(v_offer.proposed_time, v_offer.proposed_time_alt, chosen_time_param);

  if v_offer.availability_id is not null then
    -- Item 116: hold the whole party (the request's party size), refused when it does not fit.
    v_held := public._take_availability_capacity(v_offer.availability_id, v_request.party_size);
  end if;

  update business_request_offers
  set status = 'accepted', accepted_at = now(), capacity_held = v_held, proposed_time = v_time, proposed_time_alt = null
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

  -- Item 125: the accept is an event; the notification layer tells the business, the customer and the rest of the plan.
  perform public._emit_event('BUSINESS_OFFER_ACCEPTED', 'business_request_offer', offer_id_param, auth.uid(), 'accept_business_offer',
    jsonb_build_object('request_id', v_request.id, 'partner_id', v_offer.partner_id, 'offer_id', offer_id_param),
    'BUSINESS_OFFER_ACCEPTED:' || offer_id_param);

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'paymentRequired', v_payment_status = 'pending'
  );
end;
$function$;

-- _accept_business_offer_internal (group plans): + chosen_time_param.
CREATE OR REPLACE FUNCTION public._accept_business_offer_internal(offer_id_param uuid, chosen_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
  v_reservation_id uuid;
  v_held integer;
  v_time timestamptz;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  -- Item 119: a reply with two times books the one the person picked (exactly one of the two, still ahead); it is
  -- written into proposed_time so the accepted offer has ONE time for every reader after this.
  v_time := public._offer_chosen_time(v_offer.proposed_time, v_offer.proposed_time_alt, chosen_time_param);

  if v_offer.availability_id is not null then
    -- Item 116: hold the whole party (the request's party size), refused when it does not fit.
    v_held := public._take_availability_capacity(v_offer.availability_id, v_request.party_size);
  end if;

  update business_request_offers set status = 'accepted', accepted_at = now(), capacity_held = v_held, proposed_time = v_time, proposed_time_alt = null where id = offer_id_param;

  -- The group booking's reservation: the same confirmed 'nearby' row a direct accept creates, one per offer, reused if it
  -- exists. No payment row (no payer is invented for a group).
  insert into business_reservations (offer_id, status, provider, confirmed_at)
  values (offer_id_param, 'confirmed', 'nearby', now())
  on conflict (offer_id) do nothing
  returning id into v_reservation_id;
  if v_reservation_id is null then
    select id into v_reservation_id from business_reservations where offer_id = offer_id_param;
  end if;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id and id <> offer_id_param and status in ('pending', 'offered');

  update business_requests set status = 'fulfilled' where id = v_request.id;

  -- Item 125: the caller (confirm_group_plan_offer) emits BUSINESS_OFFER_ACCEPTED; the business push lives in its handler.
  return jsonb_build_object('success', true, 'reservationId', v_reservation_id);
end;
$function$;

-- confirm_group_plan_offer: + chosen_time_param; unanimity on the same time.
CREATE OR REPLACE FUNCTION public.confirm_group_plan_offer(proposal_id_param uuid, offer_id_param uuid, chosen_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_offer record;
  v_participant record;
  v_required_count integer;
  v_confirmed_count integer;
  v_accept_result jsonb;
  v_notify_row record;
  v_occ_type text;
  v_occ_who text;
  v_final_title text;
  v_final_body text;
  v_time timestamptz;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.status <> 'confirmed' or v_proposal.resulting_request_id is null then
    raise exception 'This group plan has not been finalized into a real request yet.';
  end if;

  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null or v_offer.request_id <> v_proposal.resulting_request_id then
    raise exception 'This offer does not belong to this group plan.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available to confirm.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = auth.uid() and status = 'accepted';
  if v_participant is null then
    raise exception 'You are not an active participant in this group plan.';
  end if;

  -- Item 119: on a reply with two times each participant confirms the offer AND a time (changeable: confirming again
  -- replaces their time). It books only when everyone confirmed the SAME time; a split stays pending, never resolved by
  -- Nearby picking one. A one-time reply records no time and counts exactly as before.
  v_time := case when v_offer.proposed_time_alt is not null
                 then public._offer_chosen_time(v_offer.proposed_time, v_offer.proposed_time_alt, chosen_time_param)
                 else null end;

  insert into group_plan_offer_confirmations (proposal_id, offer_id, user_id, chosen_time)
  values (proposal_id_param, offer_id_param, auth.uid(), v_time)
  on conflict (offer_id, user_id) do update set chosen_time = excluded.chosen_time,
    confirmed_at = case when group_plan_offer_confirmations.chosen_time is distinct from excluded.chosen_time then now() else group_plan_offer_confirmations.confirmed_at end;

  select count(*) into v_required_count from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted';
  select count(*) into v_confirmed_count from group_plan_offer_confirmations where proposal_id = proposal_id_param and offer_id = offer_id_param
    and chosen_time is not distinct from v_time;


  if v_confirmed_count < v_required_count then
    for v_notify_row in
      select gpp.user_id from group_plan_participants gpp
      where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted' and gpp.user_id <> auth.uid()
      and not exists (select 1 from group_plan_offer_confirmations c where c.offer_id = offer_id_param and c.user_id = gpp.user_id)
    loop
      continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
      perform public._send_push(v_notify_row.user_id, 'Confirm your group plan offer', 'Someone in your group confirmed a business offer -- confirm your spot too.', jsonb_build_object('type', 'group_plan_offer_pending', 'proposal_id', proposal_id_param, 'offer_id', offer_id_param));
    end loop;
    return jsonb_build_object('success', true, 'allConfirmed', false, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count, 'chosenTime', v_time);
  end if;

  v_accept_result := public._accept_business_offer_internal(offer_id_param, v_time);

  -- Item 125: everyone confirmed = the offer is accepted; the notification layer tells the business and the group.
  perform public._emit_event('BUSINESS_OFFER_ACCEPTED', 'business_request_offer', offer_id_param, auth.uid(), 'confirm_group_plan_offer',
    jsonb_build_object('request_id', v_proposal.resulting_request_id, 'offer_id', offer_id_param, 'proposal_id', proposal_id_param),
    'BUSINESS_OFFER_ACCEPTED:' || offer_id_param);

  return jsonb_build_object('success', true, 'allConfirmed', true, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count) || v_accept_result;
end;
$function$;

-- admin publish of a held reply: carries the second time.
CREATE OR REPLACE FUNCTION public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row business_content_screening_results;
  v_entitlement jsonb;
  v_current_count integer;
  v_lat double precision;
  v_lng double precision;
  v_gathering_scheduled_at timestamptz;
  v_expires_at timestamptz;
  v_duration_hours numeric;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_offer_title text;
  v_items text[];
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  if v_row.source = 'resweep' then
    update business_content_screening_results
    set review_outcome = case when approve_param then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = screening_id_param;
    return;
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator',
      subcategory = v_row.content_snapshot->>'subcategory'
    where id = v_row.partner_id;
  end if;

  if approve_param and v_row.target_type = 'experience' then
    if v_row.content_snapshot->>'experienceId' is null then
      select check_business_entitlement(v_row.partner_id, 'signature_experiences') into v_entitlement;
      if (v_entitlement ->> 'limit_value') is not null then
        select count(*) into v_current_count from business_experiences where partner_id = v_row.partner_id;
        if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
          raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
        end if;
      end if;

      insert into business_experiences (
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested, media_path, media_type
      ) values (
        v_row.partner_id,
        v_row.content_snapshot->>'title',
        v_row.content_snapshot->>'description',
        v_row.content_snapshot->>'icon',
        coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        v_row.content_snapshot->>'priceLevel',
        v_row.content_snapshot->>'partyType',
        false,
        v_row.content_snapshot->>'mediaPath',
        v_row.content_snapshot->>'mediaType'
      );
    else
      update business_experiences set
        title = coalesce(v_row.content_snapshot->>'title', title),
        description = v_row.content_snapshot->>'description',
        icon = v_row.content_snapshot->>'icon',
        attributes = coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        price_level = v_row.content_snapshot->>'priceLevel',
        party_type = v_row.content_snapshot->>'partyType',
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        ai_suggested = false,
        updated_at = now()
      where id = (v_row.content_snapshot->>'experienceId')::uuid and partner_id = v_row.partner_id;
    end if;
  end if;

  if approve_param and v_row.target_type = 'offer' then
    v_expires_at := null;
    if (v_row.content_snapshot->>'gatheringId') is not null then
      select scheduled_at into v_gathering_scheduled_at from gatherings where id = (v_row.content_snapshot->>'gatheringId')::uuid;
      if v_gathering_scheduled_at is not null then
        v_expires_at := v_gathering_scheduled_at + interval '48 hours';
      end if;
    end if;

    insert into brand_offers (
      partner_id, title, description, reward_type, redemption_instructions, active,
      gathering_id, expires_at, redemption_limit, target_interest_tag,
      unlock_scope, unlock_community_id, unlock_min_members
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      coalesce(v_row.content_snapshot->>'rewardType', 'discount'),
      v_row.content_snapshot->>'redemptionInstructions',
      true,
      nullif(v_row.content_snapshot->>'gatheringId', '')::uuid,
      v_expires_at,
      nullif(v_row.content_snapshot->>'redemptionLimit', '')::integer,
      nullif(v_row.content_snapshot->>'targetInterestTag', ''),
      nullif(v_row.content_snapshot->>'unlockScope', ''),
      nullif(v_row.content_snapshot->>'unlockCommunityId', '')::uuid,
      nullif(v_row.content_snapshot->>'unlockMinMembers', '')::integer
    );
  end if;

  if approve_param and v_row.target_type = 'availability' then
    select latitude, longitude into v_lat, v_lng from brand_partners where id = v_row.partner_id;
    if v_lat is null or v_lng is null then
      raise exception 'This business no longer has an address set -- the availability posting could not be published.';
    end if;

    v_duration_hours := nullif(v_row.content_snapshot->>'durationHours', '')::numeric;
    v_starts_at := coalesce(nullif(v_row.content_snapshot->>'startsAt', '')::timestamptz, now());
    v_ends_at := case
      when nullif(v_row.content_snapshot->>'endsAt', '') is not null then (v_row.content_snapshot->>'endsAt')::timestamptz
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;
    if v_ends_at <= now() then
      raise exception 'This availability window has already passed -- it could not be published.';
    end if;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles,
      bundle_occasion, bundle_components, discount_pct
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'category',
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      v_row.content_snapshot->>'offerType',
      nullif(v_row.content_snapshot->>'price', '')::numeric,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      v_starts_at,
      v_ends_at,
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15),
      nullif(v_row.content_snapshot->>'bundleOccasion', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'bundleComponents')),
        '{}'::text[]
      ),
      nullif(v_row.content_snapshot->>'discountPct', '')::numeric
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;

    -- Item 119: a held reply's second time must still be ahead when the team publishes it (never dropped silently).
    if nullif(v_row.content_snapshot->>'proposedTimeAlt', '')::timestamptz <= now() then
      raise exception 'This offer''s second time has already passed -- it could not be published.';
    end if;

    if nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz <= now() then
      raise exception 'This offer''s end time has already passed -- it could not be published.';
    end if;
    v_offer_title := nullif(trim(coalesce(v_row.content_snapshot->>'offerTitle', '')), '');

    -- Same trim + blank-filter discipline as submit_business_offer/
    -- create_occasion_package -- never a second, laxer validation rule
    -- for the identical real shape just because it arrived via a
    -- different write path (found live via Test 4 below: an earlier
    -- draft of this branch skipped the filter and let a blank jsonb
    -- array entry survive as a literal empty-string item).
    select array_agg(trim(item)) into v_items
    from jsonb_array_elements_text(coalesce(v_row.content_snapshot->'includedItems', '[]'::jsonb)) as item
    where length(trim(item)) > 0;

    -- 20270289: the team is publishing THIS held item; the offer video gate accepts its (length-checked) media for this
    -- transaction only. Nothing a client can call sets this.
    perform set_config('app.reviewed_offer_media', coalesce(v_row.content_snapshot->>'mediaPath', ''), true);

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_title = v_offer_title,
        included_items = coalesce(v_items, '{}'::text[]),
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        price_is_per_person = coalesce((v_row.content_snapshot->>'priceIsPerPerson')::boolean, false),
        discount_pct = nullif(v_row.content_snapshot->>'discountPct', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        proposed_time_alt = nullif(v_row.content_snapshot->>'proposedTimeAlt', '')::timestamptz,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        media_poster_path = case when v_row.content_snapshot->>'mediaType' = 'video' then nullif(v_row.content_snapshot->>'posterPath', '') else null end,
        redemption_instructions = nullif(trim(coalesce(v_row.content_snapshot->>'redemptionInstructions', '')), ''),
        creative_id = nullif(v_row.content_snapshot->>'creativeId', '')::uuid,
        valid_until = nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz,
        available_from = nullif(v_row.content_snapshot->>'availableFrom', '')::time,
        available_until = nullif(v_row.content_snapshot->>'availableUntil', '')::time,
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    perform set_config('app.reviewed_offer_media', '', true);

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    -- Item 125: the same BUSINESS_OFFER_SENT event as a direct reply.
    perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', o.id, null,
      'admin_review_business_content_screening',
      jsonb_build_object('request_id', o.request_id, 'partner_id', o.partner_id, 'offer_id', o.id),
      'BUSINESS_OFFER_SENT:' || o.id)
    from business_request_offers o
    where o.request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid and o.partner_id = v_row.partner_id;
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$;

-- The business's own replies: + proposed_time_alt.
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
      bro.offer_description, bro.proposed_time, bro.proposed_time_alt, bro.created_at, bro.expires_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.viewed_at, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id, bro.is_directed,
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
        'dietary', case when cardinality(br.dietary) > 0 then to_jsonb(br.dietary) else null end,
        'cuisine', br.cuisine,
        'requested_items', case when cardinality(br.requested_items) > 0 then to_jsonb(br.requested_items) else null end,
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'note', case when bro.is_directed then br.note_for_business else null end,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'title', case when bro.is_directed and public._title_safe_for_business(g.title) then g.title else null end,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level
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

revoke all on function public._offer_chosen_time(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public._offer_chosen_time(timestamptz, timestamptz, timestamptz) to service_role;

revoke all on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz) from public, anon;
grant execute on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz) to authenticated, service_role;

revoke all on function public.accept_business_offer(uuid, timestamptz) from public, anon;
grant execute on function public.accept_business_offer(uuid, timestamptz) to authenticated, service_role;

revoke all on function public._accept_business_offer_internal(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public._accept_business_offer_internal(uuid, timestamptz) to service_role;

revoke all on function public.confirm_group_plan_offer(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.confirm_group_plan_offer(uuid, uuid, timestamptz) to authenticated, service_role;
