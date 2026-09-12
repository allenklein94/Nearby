-- Item 51 (CLAUDE.md, "cancellation needs to propagate everywhere"): a
-- direct user critique that cancelling a Gathering or Community was only
-- ever a partial state change. Real audit findings, verified against the
-- live schema before writing anything here:
--
-- 1. cancel_gathering()/cancel_community() only ever cancelled business
--    requests still 'open' and offers still 'pending'/'offered'. Once an
--    offer is ACCEPTED (business_requests.status flips to 'fulfilled', so
--    it no longer matches the 'open' filter), cancelling the parent
--    gathering/community left a real, confirmed business_reservations row
--    -- possibly with a captured Stripe payment -- completely untouched.
--    The business would still expect a customer who's no longer coming;
--    the requester would still see a "confirmed" reservation for an event
--    that no longer exists. This is the real gap behind "business
--    connection is handled" / "reservation gets handled if applicable."
-- 2. gatherings are hard-deleted on cancellation (cancel_gathering's own
--    pre-existing "delete-based mechanism," see CLAUDE_HISTORY.md Sep 6
--    2026), and plans.resulting_gathering_id had ON DELETE CASCADE -- so
--    the plans table's own row for that gathering was silently destroyed
--    rather than marked cancelled. This table has no current client
--    reader (verified: no `.from('plans')` call exists anywhere in src/),
--    so there's no live user-facing symptom today, but it's the one table
--    that literally models "calendars/plans update" and shouldn't lose
--    history the moment something it once represented is cancelled.
-- 3. Every other propagation concern the user listed was checked directly
--    against live code and found already correct, so deliberately NOT
--    touched here: attendee notification already exists
--    (notify_gathering_cancelled()/cancel_community()'s own member loop);
--    gatherings are hard-deleted so recommendation surfaces and stale
--    pushes can't reference them (GatheringDetailScreen already renders
--    "This gathering isn't available anymore" for a dead deep link, not a
--    crash or blank screen); communities already gate every browse/search
--    query on status='active' (Item 50, Finding 3); community
--    recommendation has no separate promotion trigger to begin with.

-- _cancel_reservation_by_offer(): the actual state-transition logic
-- extracted out of cancel_business_reservation() (shipped one migration
-- ago) so it can be shared by that RPC and by the two cascade call sites
-- below, instead of copy-pasting the same payment-blocked/capacity-restore
-- logic three times. Never granted to authenticated/anon -- every caller
-- is itself a SECURITY DEFINER function that has already independently
-- verified the caller's authorization to trigger this cancellation; this
-- helper only knows how to do the transition safely, not who's allowed to
-- ask for it. Returns a status instead of raising, so a captured/
-- authorized payment on one reservation can never abort an entire
-- gathering/community cancellation that's cancelling several at once.
create or replace function public._cancel_reservation_by_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_reservation record;
  v_payment_id uuid;
  v_payment_blocked boolean;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null or v_offer.status <> 'accepted' then
    return jsonb_build_object('cancelled', false, 'reason', 'not_accepted');
  end if;

  select * into v_reservation from business_reservations where offer_id = offer_id_param for update;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    return jsonb_build_object('cancelled', false, 'reason', 'not_confirmed');
  end if;

  select id into v_payment_id from business_payments where reservation_id = v_reservation.id for update;
  select exists(
    select 1 from business_payments where id = v_payment_id and status in ('captured', 'authorized')
  ) into v_payment_blocked;
  if v_payment_blocked then
    return jsonb_build_object('cancelled', false, 'reason', 'payment_captured');
  end if;

  update business_request_offers set status = 'cancelled', cancelled_at = now() where id = offer_id_param;
  update business_reservations set status = 'cancelled' where id = v_reservation.id;
  update business_payments set status = 'cancelled'
    where id = v_payment_id and status in ('not_required', 'pending');

  if v_offer.availability_id is not null then
    update business_availability
    set remaining_capacity = case when remaining_capacity is not null then remaining_capacity + 1 else remaining_capacity end,
        status = case when status = 'filled' and remaining_capacity is not null then 'active' else status end
    where id = v_offer.availability_id;
  end if;

  return jsonb_build_object('cancelled', true, 'offer_id', offer_id_param, 'request_id', v_offer.request_id, 'partner_id', v_offer.partner_id);
end;
$function$;

revoke all on function public._cancel_reservation_by_offer(uuid) from public, anon, authenticated;

-- cancel_business_reservation() re-created on the same signature, now
-- calling the shared helper instead of inlining the same logic -- no
-- client-visible behavior change from the version shipped one migration
-- ago (same auth checks, same rejection messages, same notifications).
create or replace function public.cancel_business_reservation(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_partner_id uuid;
  v_is_business boolean;
  v_partner_name text;
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
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.cancel_business_reservation(uuid) from public, anon;
grant execute on function public.cancel_business_reservation(uuid) to authenticated;

-- plans.resulting_gathering_id: SET NULL instead of CASCADE, so a
-- cancelled gathering's own plan row survives (as 'cancelled', set below
-- in cancel_gathering) rather than being destroyed. No current reader in
-- the client, but this is a data-integrity fix regardless -- a "plan" for
-- something that got cancelled should say so, not disappear.
alter table public.plans drop constraint plans_resulting_gathering_id_fkey;
alter table public.plans
  add constraint plans_resulting_gathering_id_fkey
  foreign key (resulting_gathering_id) references public.gatherings(id) on delete set null;

create or replace function public.cancel_gathering(gathering_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_scheduled_at timestamptz;
  v_title text;
  v_accepted_offer record;
  v_cancel_result jsonb;
  v_request record;
  v_managing_profiles uuid[];
  service_key text;
begin
  select scheduled_at, title into v_scheduled_at, v_title from gatherings where id = gathering_id_param and host_id = auth.uid() for update;
  if v_scheduled_at is null then
    raise exception 'Gathering not found.';
  end if;
  if v_scheduled_at < now() then
    raise exception 'This gathering has already happened and can no longer be cancelled.';
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_accepted_offer in
    select o.id as offer_id, o.partner_id, o.request_id
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where r.gathering_id = gathering_id_param and o.status = 'accepted'
  loop
    select * into v_request from business_requests where id = v_accepted_offer.request_id;
    v_cancel_result := _cancel_reservation_by_offer(v_accepted_offer.offer_id);
    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_accepted_offer.partner_id;

    if (v_cancel_result->>'cancelled')::boolean then
      if v_request.requester_id <> auth.uid() and coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_request.requester_id,
            'title', 'Your reservation was cancelled',
            'body', 'The gathering "' || v_title || '" was cancelled, so your reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.',
            'data', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id)
          )
        );
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'A reservation was cancelled',
              'body', 'The gathering "' || v_title || '" was cancelled, so the reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.',
              'data', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id)
            )
          );
        end loop;
      end if;
    elsif v_cancel_result->>'reason' = 'payment_captured' then
      if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_request.requester_id,
            'title', 'Action needed on your reservation',
            'body', 'The gathering "' || v_title || '" was cancelled, but you already paid for "' || left(v_request.raw_text, 60) || '" -- contact the business directly to arrange a refund.',
            'data', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id)
          )
        );
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'A customer''s gathering was cancelled',
              'body', 'The gathering behind an already-paid reservation for "' || left(v_request.raw_text, 60) || '" was cancelled -- the customer may reach out about a refund.',
              'data', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  update plans set status = 'cancelled' where resulting_gathering_id = gathering_id_param;

  update business_requests set status = 'cancelled'
    where gathering_id = gathering_id_param and status = 'open';
  update business_request_offers set status = 'cancelled'
    where request_id in (select id from business_requests where gathering_id = gathering_id_param)
      and status in ('pending', 'offered');

  delete from gatherings where id = gathering_id_param;
  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.cancel_community(community_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_name text;
  service_key text;
  member_row record;
  v_accepted_offer record;
  v_cancel_result jsonb;
  v_request record;
  v_managing_profiles uuid[];
begin
  select status, name into v_status, v_name from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This community is already cancelled.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'cancelled' where id = community_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_accepted_offer in
    select o.id as offer_id, o.partner_id, o.request_id
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where r.community_id = community_id_param and o.status = 'accepted'
  loop
    select * into v_request from business_requests where id = v_accepted_offer.request_id;
    v_cancel_result := _cancel_reservation_by_offer(v_accepted_offer.offer_id);
    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_accepted_offer.partner_id;

    if (v_cancel_result->>'cancelled')::boolean then
      if v_request.requester_id <> auth.uid() and coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_request.requester_id,
            'title', 'Your reservation was cancelled',
            'body', 'The community "' || v_name || '" was cancelled, so your reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.',
            'data', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id)
          )
        );
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'A reservation was cancelled',
              'body', 'The community "' || v_name || '" was cancelled, so the reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.',
              'data', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id)
            )
          );
        end loop;
      end if;
    elsif v_cancel_result->>'reason' = 'payment_captured' then
      if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_request.requester_id,
            'title', 'Action needed on your reservation',
            'body', 'The community "' || v_name || '" was cancelled, but you already paid for "' || left(v_request.raw_text, 60) || '" -- contact the business directly to arrange a refund.',
            'data', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id)
          )
        );
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'A community was cancelled',
              'body', 'The community behind an already-paid reservation for "' || left(v_request.raw_text, 60) || '" was cancelled -- the customer may reach out about a refund.',
              'data', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  update business_requests set status = 'cancelled'
    where community_id = community_id_param and status = 'open';
  update business_request_offers set status = 'cancelled'
    where request_id in (select id from business_requests where community_id = community_id_param)
      and status in ('pending', 'offered');

  for member_row in
    select user_id from community_members where community_id = community_id_param and user_id <> auth.uid()
  loop
    continue when not coalesce((select notify_community from profiles where id = member_row.user_id), true);
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', member_row.user_id,
        'title', 'A community was cancelled',
        'body', '"' || v_name || '" has been cancelled by its creator.',
        'data', jsonb_build_object('type', 'community_cancelled')
      )
    );
  end loop;

  return jsonb_build_object('success', true);
end;
$function$;
