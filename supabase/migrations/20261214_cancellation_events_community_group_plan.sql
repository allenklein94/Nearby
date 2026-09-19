-- Cancellation analytics: cover the two remaining real cancels (community, legacy group plan proposal). stopRecurringSeries only
-- sets a flag on a gathering (nothing is cancelled), so it is deliberately not recorded.
alter table public.cancellation_events drop constraint if exists cancellation_events_entity_type_check;
alter table public.cancellation_events add constraint cancellation_events_entity_type_check
  check (entity_type in ('business_reservation', 'business_request', 'gathering', 'occasion_group_plan', 'community', 'group_plan'));

CREATE OR REPLACE FUNCTION public.cancel_community(community_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform _record_cancellation('community', community_id_param, null, 'host');

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
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_group_plan(proposal_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id <> auth.uid() then
    raise exception 'Only the person who proposed this group plan can cancel it.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan can no longer be cancelled.';
  end if;

  update group_plan_proposals set status = 'cancelled', cancelled_at = now() where id = proposal_id_param;
  perform _record_cancellation('group_plan', proposal_id_param, null, 'host');

  -- Finding C3's other real half: free up every participant's
  -- source_request_id (this migration's own new partial unique index)
  -- now that this proposal is dead, so they can be invited into a future
  -- group plan. Individual source requests themselves were never touched
  -- pre-confirmation -- nothing to restore there, they're still exactly
  -- as they were.
  update group_plan_participants
  set status = 'left'
  where proposal_id = proposal_id_param and status in ('invited', 'accepted');

  return jsonb_build_object('success', true);
end;
$function$
;
