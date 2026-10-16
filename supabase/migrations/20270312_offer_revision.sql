-- Item 118 (owner, 2026-10-16, approved): ONE business revision of a sent offer, PRICE AND TIME ONLY.
-- Build plan + owner decisions: PRODUCT_AUDIT/ITEM_118_ONE_OFFER_REVISION_BUILD_PLAN_2026-10-16.md.
--   * business_request_offers.revision (0 or 1: one revision is the structural maximum) + revised_at. Only a reply the
--     business wrote can be revised (never availability / package / auto_reply: the business changes what it posted).
--   * revise_business_offer: the business that sent it, while the offer is 'offered', the request open and the offer valid,
--     before the customer acts (accept/decline end 'offered'). Price only goes DOWN or stays (offer_price lower or equal, a
--     discount_pct bigger or equal, within the business's cap); a price or discount the reply never had can't be added.
--     Times: the reply's own time(s) move earlier or later, same number of times (item 119's checks). Nothing else
--     changes: description, title, included items, package, media, validity, window. No text or media = no screening.
--   * Group plans: a revision CLEARS that offer's confirmations; everyone confirms the current terms again. The business
--     is never told whether anyone had confirmed (a refusal would reveal a group plan).
--   * Accepting books only the terms the person saw: accept_business_offer and confirm_group_plan_offer take
--     seen_revision_param and refuse when the offer changed since. accept_business_offer now locks the offer row first
--     (it read it unlocked, so an accept racing a revision could have booked the old price).
--   * Event BUSINESS_OFFER_REVISED -> one calm push "{business} updated their offer" (type business_offer_revised,
--     medium priority, the request's collapse key so it replaces the request's notification in place, item 62); never
--     sent if the offer is no longer open at hand-off. Participants whose confirmation was cleared are asked to confirm again.
--   * The card shows the current terms only (no previous price, no savings); the client adds one word, "Updated".
-- Old signatures are dropped (no second overload); new functions revoke public/anon.

alter table public.business_request_offers add column if not exists revision smallint not null default 0;
alter table public.business_request_offers add column if not exists revised_at timestamptz;
alter table public.business_request_offers drop constraint if exists business_request_offers_revision_check;
alter table public.business_request_offers add constraint business_request_offers_revision_check check (
  revision between 0 and 1
  and (revision = 0 or (revised_at is not null and availability_id is null and package_id is null and auto_reply is null))
);
comment on column public.business_request_offers.revision is
  'Item 118: 1 once the business changed this offer''s price and/or time (at most once). Accepts must name the revision they saw.';
comment on column public.business_request_offers.revised_at is 'Item 118: when the one revision was made.';

alter table public.domain_events drop constraint if exists domain_events_type_check;
alter table public.domain_events add constraint domain_events_type_check check (type in (
  'GATHERING_CREATED', 'INVITATION_SENT', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED',
  'BUSINESS_REQUEST_SENT', 'BUSINESS_OFFER_SENT', 'BUSINESS_OFFER_ACCEPTED', 'OFFER_REDEEMED',
  'BUSINESS_OFFER_REVISED'));

-- Same mute group as the reply push it replaces (src/constants/notificationPreferences.js NOTIFICATION_GROUP_BY_TYPE).
insert into public.notification_type_groups (type, group_key) values ('business_offer_revised', 'business_offers')
on conflict (type) do update set group_key = excluded.group_key;

-- The one revision.
create or replace function public.revise_business_offer(offer_id_param uuid, offer_price_param numeric DEFAULT NULL::numeric, discount_pct_param numeric DEFAULT NULL::numeric, proposed_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, proposed_time_alt_param timestamp with time zone DEFAULT NULL::timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  o record;
  r record;
  v_msg text;
  v_cleared uuid[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  -- Offer first, then its request: the same lock order as the accepts, so a revision and an accept serialize.
  select * into o from business_request_offers where id = offer_id_param for update;
  if o is null or o.partner_id <> v_partner_id then
    raise exception 'Offer not found.';
  end if;
  select * into r from business_requests where id = o.request_id for update;

  if o.status <> 'offered' then
    raise exception 'This offer is no longer open.';
  end if;
  if r.status <> 'open' or (r.expires_at is not null and r.expires_at <= now()) then
    raise exception 'This request is no longer open.';
  end if;
  if o.valid_until is not null and o.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;
  if o.availability_id is not null or o.package_id is not null or o.auto_reply is not null then
    raise exception 'This was an automatic reply. Change what you posted instead.';
  end if;
  if o.revision >= 1 then
    raise exception 'You''ve already changed this offer once.';
  end if;

  -- Price: only down or the same; never added where the reply had none.
  if o.offer_price is null then
    if offer_price_param is not null then
      raise exception 'This offer has no price to change.';
    end if;
  else
    if offer_price_param is null or offer_price_param < 0 then
      raise exception 'Enter the new price.';
    end if;
    if offer_price_param > o.offer_price then
      raise exception 'A changed price can only be lower or the same.';
    end if;
  end if;
  if o.discount_pct is null then
    if discount_pct_param is not null then
      raise exception 'This offer has no discount to change.';
    end if;
  else
    if discount_pct_param is null or discount_pct_param > 100 then
      raise exception 'Enter the new discount.';
    end if;
    if discount_pct_param < o.discount_pct then
      raise exception 'A changed discount can only be bigger or the same.';
    end if;
    -- the cap trigger skips offers that are already 'offered', so the business's cap is checked here
    v_msg := public._discount_cap_violation(o.partner_id, o.offer_type, discount_pct_param);
    if v_msg is not null then
      raise exception '%', v_msg;
    end if;
  end if;

  -- Time: the reply's own time(s), earlier or later, the same number of times (item 119's rules for two).
  if o.proposed_time is null then
    if proposed_time_param is not null or proposed_time_alt_param is not null then
      raise exception 'This offer has no time to change.';
    end if;
  else
    if proposed_time_param is null then
      raise exception 'Pick the time.';
    end if;
    if (o.proposed_time_alt is null) <> (proposed_time_alt_param is null) then
      raise exception 'Keep the same number of times.';
    end if;
    if proposed_time_param <= now() or (proposed_time_alt_param is not null and proposed_time_alt_param <= now()) then
      raise exception 'Pick times that are later than now.';
    end if;
    if proposed_time_alt_param = proposed_time_param then
      raise exception 'The second time is the same as the first.';
    end if;
  end if;

  if offer_price_param is not distinct from o.offer_price
     and discount_pct_param is not distinct from o.discount_pct
     and proposed_time_param is not distinct from o.proposed_time
     and proposed_time_alt_param is not distinct from o.proposed_time_alt then
    raise exception 'Nothing changed.';
  end if;

  update business_request_offers
  set offer_price = offer_price_param,
      discount_pct = discount_pct_param,
      proposed_time = proposed_time_param,
      proposed_time_alt = proposed_time_alt_param,
      revision = 1,
      revised_at = now()
  where id = o.id;

  -- Group plans: earlier confirmations were for the old terms; nobody's consent carries over.
  with d as (delete from group_plan_offer_confirmations where offer_id = o.id returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_cleared from d;

  perform public._emit_event('BUSINESS_OFFER_REVISED', 'business_request_offer', o.id, auth.uid(), 'revise_business_offer',
    jsonb_build_object('request_id', o.request_id, 'partner_id', o.partner_id, 'offer_id', o.id, 'reconfirm', to_jsonb(v_cleared)),
    'BUSINESS_OFFER_REVISED:' || o.id);

  return jsonb_build_object('success', true, 'offerId', o.id, 'revision', 1);
end;
$function$;

-- The revision's notification: the requester's one reply notification is replaced in place (collapse key); anyone whose
-- group confirmation was cleared is asked to confirm the current terms. Medium priority (no sound); never the signature.
create or replace function public._on_business_offer_revised(e domain_events)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  o record;
  v_requester uuid;
  v_category text;
  v_occ_type text;
  v_name text;
  v_title text;
  v_proposal uuid;
  v_user uuid;
begin
  select * into o from business_request_offers where id = e.object_id;
  if not found then return; end if;
  select requester_id, category into v_requester, v_category from business_requests where id = o.request_id;
  select c.occasion_type into v_occ_type from public._occasion_context_for_business_request(o.request_id) c;
  select name into v_name from brand_partners where id = o.partner_id;
  v_title := public._offer_push_emoji(v_category, v_occ_type) || ' ' || coalesce(v_name, 'A business') || ' updated their offer';

  perform public._notify_event_recipient(e.id, v_requester,
    coalesce((select notify_business from profiles where id = v_requester), true),
    v_title, 'See the current terms for your ' || public._business_reply_what(o.request_id) || '.',
    jsonb_build_object('type', 'business_offer_revised', 'request_id', o.request_id, 'offer_id', o.id,
                       'collapse_key', 'offers:' || o.request_id));

  select id into v_proposal from group_plan_proposals where resulting_request_id = o.request_id limit 1;
  for v_user in select (jsonb_array_elements_text(coalesce(e.payload->'reconfirm', '[]'::jsonb)))::uuid loop
    continue when v_user = v_requester;
    perform public._notify_event_recipient(e.id, v_user, true,
      v_title, 'Confirm the current terms in your group plan.',
      jsonb_build_object('type', 'business_offer_revised', 'request_id', o.request_id, 'offer_id', o.id,
                         'proposal_id', v_proposal));
  end loop;
end;
$function$;

drop function if exists public.accept_business_offer(uuid, timestamptz);
drop function if exists public.confirm_group_plan_offer(uuid, uuid, timestamptz);

-- accept_business_offer: + seen_revision_param; the offer row is locked first.
CREATE OR REPLACE FUNCTION public.accept_business_offer(offer_id_param uuid, chosen_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, seen_revision_param smallint DEFAULT NULL::smallint)
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
  -- Item 118: the offer row is locked first (then its request), the same order as revise_business_offer and the group
  -- accept, so an accept and a revision never interleave: whichever commits second sees the other's result. Before this,
  -- the offer was read unlocked, so an accept racing a revision could have booked the price it read before the change.
  select * into v_offer from business_request_offers where id = offer_id_param for update;
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
  -- Item 118: book only the terms the person saw. seen_revision_param = the revision on their card (null = 0, an app
  -- from before revisions); a revision since then refuses, and the refreshed card shows the current terms.
  if coalesce(seen_revision_param, 0) <> v_offer.revision then
    raise exception 'This offer just changed. Check the new terms.';
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

-- confirm_group_plan_offer: + seen_revision_param.
CREATE OR REPLACE FUNCTION public.confirm_group_plan_offer(proposal_id_param uuid, offer_id_param uuid, chosen_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, seen_revision_param smallint DEFAULT NULL::smallint)
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
  -- Item 118: a participant confirms only the terms they saw (a revision cleared every earlier confirmation).
  if coalesce(seen_revision_param, 0) <> v_offer.revision then
    raise exception 'This offer just changed. Check the new terms.';
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

-- get_business_opportunities: + the business's own offer fields the revise sheet needs (its own reply; nothing about the customer).
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
      bro.offer_title, bro.included_items, bro.discount_pct, bro.valid_until, bro.available_from, bro.available_until,
      bro.auto_reply, bro.revision, bro.revised_at,
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

-- _push_outbox_deliver: + a revised-offer push is not sent once that offer is no longer open.
CREATE OR REPLACE FUNCTION public._push_outbox_deliver(outbox_id_param bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_key text;
  v_req bigint;
begin
  select * into o from push_outbox where id = outbox_id_param for update;
  if not found or o.status not in ('pending', 'retry') then
    return coalesce(o.status, 'missing');
  end if;
  -- Item 62: a reply push is worded from the request's LIVE open replies at the moment it is handed off (first try or retry)
  if o.data->>'type' = 'business_offer_received' and o.data ? 'collapse_key' then
    if not public._refresh_reply_push(o.id) then
      update push_outbox set status = 'failed', last_error = 'not sent: no open reply left on this request', updated_at = now()
      where id = o.id;
      return 'failed';
    end if;
    select * into o from push_outbox where id = outbox_id_param;
  end if;
  -- Item 118: "X updated their offer" goes out only while that offer is still open (accepted, withdrawn or expired by the
  -- hand-off = nothing it says is still useful).
  if o.data->>'type' = 'business_offer_revised' and not exists (
       select 1 from business_request_offers where id = (o.data->>'offer_id')::uuid and status = 'offered') then
    update push_outbox set status = 'failed', last_error = 'not sent: the updated offer is no longer open', updated_at = now()
    where id = o.id;
    return 'failed';
  end if;
  begin
    -- test switch, transaction-local only: lets the journey prove a failed hand-off is kept and retried
    if current_setting('app.push_handoff_test_failure', true) = 'on' then
      raise exception 'simulated hand-off failure';
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if v_key is null then
      raise exception 'service_role_key is not configured';
    end if;
    select net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('recipient_id', o.recipient_id, 'title', o.title, 'body', o.body, 'data', o.data)
    ) into v_req;
    update push_outbox set status = 'queued', net_request_id = v_req, attempts = attempts + 1, last_error = null,
                           updated_at = now()
    where id = o.id;
    return 'queued';
  exception when others then
    update push_outbox set status = 'retry', attempts = attempts + 1, last_error = left(sqlerrm, 500),
                           next_attempt_at = now() + make_interval(mins => least(5 * (attempts + 1), 20)), updated_at = now()
    where id = o.id;
    return 'retry';
  end;
end;
$function$;

-- _dispatch_domain_event: + BUSINESS_OFFER_REVISED.
create or replace function public._dispatch_domain_event(event_id_param bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e public.domain_events;
begin
  select * into e from domain_events where id = event_id_param;
  if not found then return; end if;
  case e.type
    when 'GATHERING_CREATED' then perform public._on_gathering_created(e);
    when 'INVITATION_SENT' then perform public._on_invitation_sent(e);
    when 'BUSINESS_REQUEST_SENT' then perform public._on_business_request_sent(e);
    when 'BUSINESS_OFFER_SENT' then perform public._on_business_offer_sent(e);
    when 'BUSINESS_OFFER_ACCEPTED' then perform public._on_business_offer_accepted(e);
    when 'BUSINESS_OFFER_REVISED' then perform public._on_business_offer_revised(e);
    else null;  -- recorded, no notification
  end case;
end;
$function$;

revoke all on function public.revise_business_offer(uuid, numeric, numeric, timestamptz, timestamptz) from public, anon;
grant execute on function public.revise_business_offer(uuid, numeric, numeric, timestamptz, timestamptz) to authenticated, service_role;

revoke all on function public._on_business_offer_revised(public.domain_events) from public, anon, authenticated;

revoke all on function public.accept_business_offer(uuid, timestamptz, smallint) from public, anon;
grant execute on function public.accept_business_offer(uuid, timestamptz, smallint) to authenticated, service_role;

revoke all on function public.confirm_group_plan_offer(uuid, uuid, timestamptz, smallint) from public, anon;
grant execute on function public.confirm_group_plan_offer(uuid, uuid, timestamptz, smallint) to authenticated, service_role;
