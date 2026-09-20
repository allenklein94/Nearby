-- Item 67: an offer past its own valid_until cannot be accepted by ANY path (group-plan confirm previously skipped it).
CREATE OR REPLACE FUNCTION public._accept_business_offer_internal(offer_id_param uuid)
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
  service_key text;
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

  update business_request_offers set status = 'accepted', accepted_at = now() where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id and id <> offer_id_param and status in ('pending', 'offered');

  update business_requests set status = 'fulfilled' where id = v_request.id;

  select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
  if v_managing_profiles is not null then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    for i in 1 .. array_length(v_managing_profiles, 1) loop
      continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_managing_profiles[i],
          'title', 'Your offer was accepted!',
          'body', 'A customer accepted your offer: ' || coalesce(public.business_safe_request_summary(v_request.id), 'a request'),
          'data', jsonb_build_object('type', 'business_offer_accepted', 'request_id', v_request.id, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_group_plan_offer(proposal_id_param uuid, offer_id_param uuid)
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
  service_key text;
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

  insert into group_plan_offer_confirmations (proposal_id, offer_id, user_id)
  values (proposal_id_param, offer_id_param, auth.uid())
  on conflict (offer_id, user_id) do nothing;

  select count(*) into v_required_count from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted';
  select count(*) into v_confirmed_count from group_plan_offer_confirmations where proposal_id = proposal_id_param and offer_id = offer_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_confirmed_count < v_required_count then
    if service_key is not null then
      for v_notify_row in
        select gpp.user_id from group_plan_participants gpp
        where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted' and gpp.user_id <> auth.uid()
        and not exists (select 1 from group_plan_offer_confirmations c where c.offer_id = offer_id_param and c.user_id = gpp.user_id)
      loop
        continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_notify_row.user_id,
            'title', 'Confirm your group plan offer',
            'body', 'Someone in your group confirmed a business offer -- confirm your spot too.',
            'data', jsonb_build_object('type', 'group_plan_offer_pending', 'proposal_id', proposal_id_param, 'offer_id', offer_id_param)
          )
        );
      end loop;
    end if;
    return jsonb_build_object('success', true, 'allConfirmed', false, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count);
  end if;

  v_accept_result := public._accept_business_offer_internal(offer_id_param);

  select occasion_type, who_for_name into v_occ_type, v_occ_who
  from _occasion_context_for_business_request(v_proposal.resulting_request_id);

  if v_occ_type is not null then
    v_final_title := _occasion_emoji(v_occ_type) || ' Reservation Confirmed!';
    if v_occ_who is not null then
      v_final_body := 'Your group''s reservation for ' || v_occ_who || '''s ' || _occasion_noun(v_occ_type) || ' is confirmed!';
    else
      v_final_body := 'Everyone confirmed -- your group''s ' || lower(_occasion_noun(v_occ_type)) || ' reservation is locked in.';
    end if;
  else
    v_final_title := 'Group plan reservation confirmed!';
    v_final_body := 'Everyone confirmed -- your group plan reservation is locked in.';
  end if;

  if service_key is not null then
    for v_notify_row in
      select user_id from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted'
    loop
      continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_notify_row.user_id,
          'title', v_final_title,
          'body', v_final_body,
          'data', jsonb_build_object('type', 'group_plan_reservation_confirmed', 'proposal_id', proposal_id_param, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true, 'allConfirmed', true, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count) || v_accept_result;
end;
$function$;
