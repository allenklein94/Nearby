-- Item 90 ("The 'Plan' itself becomes the source of truth" -- CLAUDE.md).
--
-- User's own framing: once a plan is confirmed, everyone sees the same
-- information; if the time changes, everyone gets updated; if the
-- business cancels, everyone gets notified; if the host cancels,
-- everyone gets notified. Audited the real current state first (a
-- background research fork read every function below live against
-- production) rather than assuming CLAUDE.md's own past summaries were
-- still accurate:
--
--   - submit_business_offer / admin_review_business_content_screening's
--     offer-response branch: notify the original requester only, never
--     any co-organizer or accepted guest on the plan (is_plan_participant/
--     plan_organizers/group_plan_participants -- Items 88/89 -- were
--     never referenced by either).
--   - set_plan_item_time (Item 81/88): sends ZERO notifications at all --
--     an organizer retiming a plan item today tells no one, including
--     every other organizer and guest.
--   - decline_business_offer: sends ZERO notifications at all -- a
--     business declining pre-acceptance tells literally no one, not even
--     the requester.
--   - withdraw_business_offer, cancel_business_reservation (both the
--     business-cancels and consumer-cancels branches): notify at most one
--     counterparty (the requester, or the business's managing profiles) --
--     never the plan's other real participants.
--   - cancel_business_request: sends ZERO notifications (not even to the
--     business whose pending/offered ask just vanished), and is still
--     hard-gated on literal `requester_id = auth.uid()` -- never widened
--     for Item 88's organizer model, so a co-organizer can't cancel the
--     add-on they're supposed to be able to manage, and the host can't
--     cancel an add-on a co-organizer created.
--
-- The gathering-cancellation precedent this mirrors (notify_gathering_
-- cancelled/notify_gathering_updated, cancel_community) already fans out
-- to every real attendee/member, gated per-recipient on notify_planning --
-- exactly the shape applied below via one new shared helper,
-- _notify_other_plan_participants(), built directly on the same roster
-- query get_plan_participants()/is_plan_participant() already use (host
-- via plans.created_by, any plan_organizers row, or a real accepted
-- group_plan_participants row via either the invite_to_business_request
-- mechanism or the older propose_group_plan/confirm_group_plan merged-
-- request mechanism) -- not a second, possibly-drifting roster query.
--
-- Every function touched here keeps its exact prior signature -- plain
-- CREATE OR REPLACE, no overload risk.

create or replace function _notify_other_plan_participants(
  request_id_param uuid,
  exclude_user_id uuid,
  notif_type text,
  title_text text,
  body_text text,
  extra_data jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_primary_id uuid;
  v_plan_id uuid;
  service_key text;
  v_uid uuid;
begin
  select coalesce(parent_request_id, id) into v_primary_id
  from business_requests where id = request_id_param;
  if v_primary_id is null then
    return;
  end if;

  select p.id into v_plan_id from plans p
  where p.resulting_business_request_id = v_primary_id
  order by p.created_at desc limit 1;
  if v_plan_id is null then
    return;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is null then
    return;
  end if;

  for v_uid in
    select distinct uid from (
      select created_by as uid from plans where id = v_plan_id
      union
      select user_id from plan_organizers where plan_id = v_plan_id
      union
      select gpp.user_id
      from group_plan_participants gpp
      where gpp.status = 'accepted'
        and gpp.proposal_id in (
          select gpp2.proposal_id from group_plan_participants gpp2
          where gpp2.source_request_id = v_primary_id
          union
          select br.group_plan_id from business_requests br
          where br.id = v_primary_id and br.group_plan_id is not null
        )
    ) x
    where uid is not null and uid is distinct from exclude_user_id
  loop
    continue when not coalesce((select notify_planning from profiles where id = v_uid), true);
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_uid,
        'title', title_text,
        'body', body_text,
        'data', jsonb_build_object('type', notif_type, 'request_id', v_primary_id) || extra_data
      )
    );
  end loop;
end;
$$;

-- This is a mutating, side-effecting function with no caller-identity
-- check of its own (it trusts request_id_param/exclude_user_id/title/
-- body outright, meant to be invoked only internally by an already-
-- authorized SECURITY DEFINER caller) -- unlike a pure read-only
-- predicate like _can_manage_business_request, `authenticated` must be
-- explicitly revoked too, not just public/anon, or any signed-in client
-- could call it directly to send arbitrary push text to a real plan's
-- participants. Mirrors _cancel_reservation_by_offer's own identical
-- posture for the same reason.
revoke all on function _notify_other_plan_participants(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- accept_business_offer: the moment a plan becomes "Confirmed" -- exactly
-- the central moment item 90's own mock is about -- now reaches every
-- real plan participant, not just whoever tapped Accept. The occasion-
-- aware title/body (Item 78) is computed once and reused for both the
-- requester's own gated push and the new participant fan-out.
create or replace function accept_business_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
          'body', 'A customer accepted your offer on "' || left(v_request.raw_text, 60) || '"',
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
$$;

-- decline_business_offer: previously sent zero notifications to anyone at
-- all, not even the requester. This is genuinely "the business cancels"
-- in item 90's own words, just before acceptance rather than after --
-- now notifies the requester (a real, previously-missing basic gap) and
-- fans out to every other real plan participant.
create or replace function decline_business_offer(request_id_param uuid, reason_param text, note_param text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_partner_id uuid;
  v_row record;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  service_key text;
begin
  if reason_param not in (
    'too_far',
    'too_busy_right_now',
    'cant_accommodate_group_size',
    'outside_our_hours',
    'not_a_fit_for_us',
    'other'
  ) then
    raise exception 'Invalid decline reason.';
  end if;

  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status not in ('pending', 'offered') then
    raise exception 'This request has already been resolved.';
  end if;

  update business_request_offers
  set status = 'declined',
      responded_at = now(),
      decline_reason = reason_param,
      decline_note = case when reason_param = 'other' then note_param else null end
  where id = v_row.id;

  select requester_id, raw_text into v_requester_id, v_raw_text from business_requests where id = request_id_param;
  select name into v_partner_name from brand_partners where id = v_partner_id;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(request_id_param);
  if v_occ_type is not null then
    v_push_title := _occasion_emoji(v_occ_type) || ' An update on your ' || lower(_occasion_noun(v_occ_type)) || ' plan';
    v_push_body := coalesce(v_partner_name, 'A business') || ' can''t accommodate your request'
      || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '. Try another business nearby.';
  else
    v_push_title := 'An update on your request';
    v_push_body := coalesce(v_partner_name, 'A business') || ' can''t accommodate "' || left(coalesce(v_raw_text, ''), 60) || '"';
  end if;

  if service_key is not null then
    if coalesce((select notify_business from profiles where id = v_requester_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_requester_id,
          'title', v_push_title,
          'body', v_push_body,
          'data', jsonb_build_object('type', 'business_offer_declined', 'request_id', request_id_param)
        )
      );
    end if;

    perform _notify_other_plan_participants(request_id_param, v_requester_id, 'business_offer_declined', v_push_title, v_push_body);
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- withdraw_business_offer: keep the existing single-recipient push,
-- extend the fan-out to every other real plan participant.
create or replace function withdraw_business_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_partner_id uuid;
  v_row record;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_push_title text;
  v_push_body text;
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_request_offers
  where id = offer_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'Offer not found.';
  end if;
  if v_row.status <> 'offered' then
    raise exception 'This offer can no longer be withdrawn.';
  end if;

  update business_request_offers
  set status = 'withdrawn', responded_at = now()
  where id = offer_id_param;

  select requester_id, raw_text into v_requester_id, v_raw_text
  from business_requests where id = v_row.request_id;
  select name into v_partner_name from brand_partners where id = v_partner_id;

  v_push_title := 'An offer was withdrawn';
  v_push_body := coalesce(v_partner_name, 'A business') || ' withdrew its offer on "' || left(v_raw_text, 60) || '"';

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null then
    if coalesce((select notify_business from profiles where id = v_requester_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_requester_id,
          'title', v_push_title,
          'body', v_push_body,
          'data', jsonb_build_object('type', 'business_offer_withdrawn', 'request_id', v_row.request_id, 'offer_id', offer_id_param)
        )
      );
    end if;

    perform _notify_other_plan_participants(v_row.request_id, v_requester_id, 'business_offer_declined', v_push_title, v_push_body, jsonb_build_object('offer_id', offer_id_param));
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- cancel_business_reservation: both branches now also fan out to every
-- other real plan participant, in addition to the existing single
-- direct-counterparty push.
create or replace function cancel_business_reservation(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
            'body', 'A customer cancelled their reservation for "' || left(v_request.raw_text, 60) || '"',
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
$$;

-- cancel_business_request: previously hard-required literal
-- `requester_id = auth.uid()` and sent zero notifications. Now:
--   - the PRIMARY request stays host-only to cancel, per Item 88's own
--     locked decision ("cancelling the plan... stays host-only") -- but
--     is now actually enforced via the plan's real created_by rather than
--     just the row's own requester_id, which are usually but not always
--     the same person is meaningless here since the primary's requester
--     IS the plan's host by construction; this simply makes that
--     explicit and correct if that construction is ever untrue.
--   - an ADD-ON can now be cancelled/removed by _can_manage_business_
--     request() (its own creator OR any real organizer of the plan) --
--     Item 88's own header comment already claimed "any organizer can
--     manage ANY add-on in the plan," but this function was never
--     actually updated for it; this closes that real, disclosed gap.
--   - every real other plan participant is notified either way, and any
--     business whose still-pending/offered ask on this row just vanished
--     is notified too (previously notified of nothing).
create or replace function cancel_business_request(request_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_request record;
  v_primary_id uuid;
  v_plan record;
  v_is_primary boolean;
  v_actor_name text;
  v_cancelled_partner_ids uuid[];
  v_managing_id uuid;
  service_key text;
begin
  select * into v_request from business_requests where id = request_id_param for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request can no longer be cancelled.';
  end if;

  v_is_primary := v_request.parent_request_id is null;
  v_primary_id := coalesce(v_request.parent_request_id, v_request.id);

  if v_is_primary then
    select p.* into v_plan from plans p
    where p.resulting_business_request_id = v_primary_id
    order by p.created_at desc limit 1;

    if v_plan.id is not null then
      if v_plan.created_by <> auth.uid() then
        raise exception 'Only the host can cancel this plan.';
      end if;
    elsif v_request.requester_id <> auth.uid() then
      raise exception 'You do not have permission to cancel this request.';
    end if;
  else
    if not _can_manage_business_request(v_request.id) then
      raise exception 'You do not have permission to cancel this add-on.';
    end if;
  end if;

  select array_agg(distinct partner_id) into v_cancelled_partner_ids
  from business_request_offers
  where request_id = request_id_param and status in ('pending', 'offered');

  update business_requests set status = 'cancelled' where id = request_id_param;

  update business_request_offers
  set status = 'cancelled'
  where request_id = request_id_param
  and status in ('pending', 'offered');

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_actor_name from profiles where id = auth.uid();

  -- Item 90: every other real plan participant learns the plan (or one
  -- of its add-ons) was cancelled, not just whoever tapped Cancel.
  perform _notify_other_plan_participants(
    request_id_param,
    auth.uid(),
    case when v_is_primary then 'plan_cancelled' else 'plan_addon_removed' end,
    case when v_is_primary then '🚫 Plan cancelled' else 'Plan updated' end,
    case
      when v_is_primary then coalesce(v_actor_name, 'The host') || ' cancelled this plan.'
      else coalesce(v_actor_name, 'Someone on the plan') || ' removed ' || coalesce(v_request.plan_label, v_request.addon_type, 'an item') || ' from the plan.'
    end
  );

  -- The business(es) whose still-open ask on this row just vanished
  -- deserve to know too -- previously they learned nothing at all.
  if v_cancelled_partner_ids is not null and service_key is not null then
    for i in 1 .. array_length(v_cancelled_partner_ids, 1) loop
      for v_managing_id in
        select id from profiles where managed_partner_id = v_cancelled_partner_ids[i]
      loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_id), true);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_id,
            'title', 'A request was cancelled',
            'body', 'A request you were considering was cancelled by the requester.',
            'data', jsonb_build_object('type', 'business_request_cancelled', 'request_id', request_id_param)
          )
        );
      end loop;
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- set_plan_item_time: previously sent zero notifications of any kind.
-- Item 90's own literal example ("if the time changes, everyone gets
-- updated") maps directly onto this function -- it's the one real
-- mechanism that changes a plan item's time today (a business can't
-- revise proposed_time after its one-shot response).
create or replace function set_plan_item_time(request_id_param uuid, plan_time_param time without time zone default null, plan_label_param text default null, clear_label boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated record;
  v_actor_name text;
  v_label text;
begin
  if not public._can_manage_business_request(request_id_param) then
    raise exception 'You are not authorized to edit this plan item.';
  end if;

  update business_requests
  set
    plan_time = plan_time_param,
    plan_label = case when clear_label then null
      when plan_label_param is not null then nullif(trim(plan_label_param), '')
      else plan_label end
  where id = request_id_param
  returning id, plan_time, plan_label into v_updated;

  if v_updated.id is null then
    raise exception 'Request not found.';
  end if;

  select display_name into v_actor_name from profiles where id = auth.uid();
  v_label := coalesce(v_updated.plan_label, 'this part of the plan');

  perform _notify_other_plan_participants(
    request_id_param,
    auth.uid(),
    'plan_item_time_changed',
    '🕐 Plan updated',
    coalesce(v_actor_name, 'Someone on the plan') || ' updated the time for ' || v_label || ' — open the plan to see the new time.'
  );

  return jsonb_build_object('requestId', v_updated.id, 'planTime', v_updated.plan_time, 'planLabel', v_updated.plan_label);
end;
$$;
