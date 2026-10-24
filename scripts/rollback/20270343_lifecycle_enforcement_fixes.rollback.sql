-- Rollback for migration 20270343 (restores the production definitions read 2026-10-24 before it was applied).
drop trigger if exists gathering_client_update_guard on public.gatherings;
drop function if exists public._gathering_client_update_guard();
drop function if exists public._gathering_has_active_booking(uuid);
CREATE OR REPLACE FUNCTION public.join_gathering(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host_id uuid;
  v_is_public boolean;
  v_requires_approval boolean;
  v_women_only boolean;
  v_capacity integer;
  v_visibility text;
  v_user_id uuid := auth.uid();
  v_gender text;
  v_is_blocked boolean;
  v_has_invite boolean;
  v_approved_count integer;
  v_status text;
  v_new_match_id uuid;
  v_row_count integer;
begin
  -- Locks the gathering row so two concurrent joiners can't both read
  -- "one spot left" and both get approved.
  select host_id, is_public, women_only, capacity, visibility, requires_approval
  into v_host_id, v_is_public, v_women_only, v_capacity, v_visibility, v_requires_approval
  from gatherings where id = gathering_id_param for update;

  if v_host_id is null then
    raise exception 'Gathering not found';
  end if;
  if v_host_id = v_user_id then
    raise exception 'Cannot express interest in your own gathering';
  end if;

  if v_visibility = 'invite_only' then
    select exists(
      select 1 from social_invites
      where invite_type = 'gathering'
        and target_id = gathering_id_param
        and invitee_id = v_user_id
        and status = 'accepted'
    ) into v_has_invite;
    if not v_has_invite then
      raise exception 'This gathering is invite-only. Ask the host for an invite.';
    end if;
  end if;

  if v_women_only then
    select gender into v_gender from profiles where id = v_user_id;
    if lower(coalesce(v_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_user_id)
    or (blocker_id = v_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot express interest in this gathering';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';

  -- At/over capacity always waitlists, regardless of public/host-approval --
  -- "no spot available" is the same fact either way. Under capacity keeps
  -- today's exact behavior: public auto-approves, host-approval stays
  -- pending for the host to review.
  if v_capacity is not null and v_approved_count >= public._gathering_guest_limit(v_capacity) then
    v_status := 'waitlisted';
  elsif v_is_public and not coalesce(v_requires_approval, false) then
    v_status := 'approved';
  else
    v_status := 'pending';
  end if;

  insert into gathering_interest (gathering_id, user_id, status)
  values (gathering_id_param, v_user_id, v_status)
  on conflict (gathering_id, user_id) do nothing;
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    -- Already had an active request (pending/approved/waitlisted) --
    -- idempotent, return their existing status rather than erroring.
    -- If that existing status is already 'approved', a real match was
    -- already created the first time -- look it up instead of a
    -- hardcoded null, so a retried/double-tapped call reports the
    -- real match_id it already has, not a false "no match" answer.
    select status into v_status from gathering_interest
    where gathering_id = gathering_id_param and user_id = v_user_id;
    if v_status = 'approved' then
      select id into v_new_match_id from matches
      where user_a = least(v_host_id, v_user_id) and user_b = greatest(v_host_id, v_user_id);
    end if;
    return jsonb_build_object('status', v_status, 'match_id', v_new_match_id);
  end if;

  if v_status = 'approved' then
    insert into matches (user_a, user_b, source_gathering_id)
    values (least(v_host_id, v_user_id), greatest(v_host_id, v_user_id), gathering_id_param)
    on conflict (user_a, user_b) do update
      set source_gathering_id = gathering_id_param
      where matches.source_gathering_id is null
    returning id into v_new_match_id;
    if v_new_match_id is null then
      select id into v_new_match_id from matches
      where user_a = least(v_host_id, v_user_id) and user_b = greatest(v_host_id, v_user_id);
    end if;
  end if;

  return jsonb_build_object('status', v_status, 'match_id', v_new_match_id);
end;
$function$

;
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
  v_party smallint;
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
  -- Item 119b: picking the second time of a reply that made it for fewer people books that many (stored on the offer as
  -- proposed_party_size: the booking's headcount for every reader after this; null = the request's whole party). A group
  -- plan never books fewer: its participants only see the whole-party time, and this refuses the other.
  v_party := case when v_offer.proposed_party_size_alt is not null and v_time = v_offer.proposed_time_alt
                  then v_offer.proposed_party_size_alt else null end;
  if v_party is not null and exists (select 1 from group_plan_proposals where resulting_request_id = v_request.id) then
    raise exception 'Pick the time for your whole group.';
  end if;

  if v_offer.availability_id is not null then
    -- Item 116: hold the whole party (the request's party size), refused when it does not fit.
    v_held := public._take_availability_capacity(v_offer.availability_id, v_request.party_size);
  end if;

  update business_request_offers
  set status = 'accepted', accepted_at = now(), capacity_held = v_held, proposed_time = v_time, proposed_time_alt = null,
      proposed_party_size = v_party, proposed_party_size_alt = null
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
$function$

;
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
  -- Item 119b: the group path books the whole party only, never a reply's smaller-party time.
  if v_offer.proposed_party_size_alt is not null and v_time = v_offer.proposed_time_alt then
    raise exception 'Pick the time for your whole group.';
  end if;

  if v_offer.availability_id is not null then
    -- Item 116: hold the whole party (the request's party size), refused when it does not fit.
    v_held := public._take_availability_capacity(v_offer.availability_id, v_request.party_size);
  end if;

  update business_request_offers set status = 'accepted', accepted_at = now(), capacity_held = v_held, proposed_time = v_time, proposed_time_alt = null, proposed_party_size_alt = null where id = offer_id_param;

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
$function$

;
CREATE OR REPLACE FUNCTION public.invite_friend_to_gathering(gathering_id_param uuid, friend_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_state text;
  v_invite_id uuid;
begin
  if not coalesce((select allow_attendee_invites from gatherings where id = gathering_id_param), true)
     and auth.uid() is distinct from (select host_id from gatherings where id = gathering_id_param) then
    raise exception 'The host has turned off invitations for this gathering.';
  end if;

  v_state := private._gathering_invitee_state(gathering_id_param, auth.uid(), friend_id_param);

  if v_state = 'not_friend' then
    raise exception using message = 'You can only invite accepted friends', hint = 'invite_state:ineligible';
  elsif v_state = 'blocked' then
    raise exception using message = 'This person cannot be invited', hint = 'invite_state:ineligible';
  elsif v_state = 'going' then
    raise exception using message = 'Already going', hint = 'invite_state:going';
  elsif v_state = 'women_only' then
    raise exception using message = 'This gathering is women-only', hint = 'invite_state:ineligible';
  elsif v_state = 'host_blocked' then
    raise exception using message = 'This person cannot be invited to this gathering', hint = 'invite_state:ineligible';
  elsif v_state = 'invited' then
    raise exception using message = 'Already invited', hint = 'invite_state:invited';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), friend_id_param, 'gathering', gathering_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing
  returning id into v_invite_id;

  -- A concurrent invite of the same friend won the race: say so instead of a second success.
  if v_invite_id is null then
    raise exception using message = 'Already invited', hint = 'invite_state:invited';
  end if;

  -- Item 125: the invitation is an event; the notification layer decides the push.
  perform public._emit_event('INVITATION_SENT', 'social_invite', v_invite_id, auth.uid(), 'invite_friend_to_gathering',
    jsonb_build_object('invite_id', v_invite_id, 'gathering_id', gathering_id_param, 'invitee_id', friend_id_param),
    'INVITATION_SENT:' || v_invite_id);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.send_social_invite(invite_type_param text, target_id_param uuid, invitee_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite_id uuid;
begin
  if invite_type_param not in ('gathering', 'community') then
    raise exception 'Invalid invite type';
  end if;

  if invitee_id_param = auth.uid() then
    raise exception 'Cannot invite yourself';
  end if;

  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and ((user_a = auth.uid() and user_b = invitee_id_param)
        or (user_a = invitee_id_param and user_b = auth.uid()))
  ) then
    raise exception 'You can only invite friends';
  end if;

  if exists (
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = invitee_id_param)
       or (blocker_id = invitee_id_param and blocked_id = auth.uid())
  ) then
    raise exception 'This person cannot be invited';
  end if;

  if invite_type_param = 'gathering' and not exists (select 1 from gatherings where id = target_id_param) then
    raise exception 'Gathering not found';
  end if;

  if invite_type_param = 'community' and not exists (select 1 from communities where id = target_id_param) then
    raise exception 'Community not found';
  end if;

  if invite_type_param = 'gathering'
     and not coalesce((select allow_attendee_invites from gatherings where id = target_id_param), true)
     and auth.uid() is distinct from (select host_id from gatherings where id = target_id_param) then
    raise exception 'The host has turned off invitations for this gathering.';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), invitee_id_param, invite_type_param, target_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing
  returning id into v_invite_id;

  -- Item 125: recorded as INVITATION_SENT (this path never pushed; the notification layer keeps it that way).
  if v_invite_id is not null then
    perform public._emit_event('INVITATION_SENT', 'social_invite', v_invite_id, auth.uid(), 'send_social_invite',
      jsonb_build_object('invite_id', v_invite_id, 'invite_type', invite_type_param, 'target_id', target_id_param,
                         'invitee_id', invitee_id_param),
      'INVITATION_SENT:' || v_invite_id);
  end if;
end;
$function$

;
drop function if exists public._offer_gathering_id(uuid);
drop policy "Users can express interest, respecting women-only gatherings" on public.gathering_interest;
create policy "Users can express interest, respecting women-only gatherings" on public.gathering_interest
  for insert to authenticated
  with check (((auth.uid() = user_id) AND (status = 'pending'::text) AND (NOT (EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.id = gathering_interest.gathering_id) AND (g.women_only = true) AND (NOT (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.gender, ''::text)) = ANY (ARRAY['female'::text, 'woman'::text]))))))))))));
