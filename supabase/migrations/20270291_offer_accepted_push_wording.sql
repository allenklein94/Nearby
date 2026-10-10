-- Owner item 13 (2026-10-10): the business side of an accepted offer.
-- Push wording only: title "A customer accepted your offer" (true whether the
-- customer is new or returning), body = the business-safe request summary
-- (structured fields only, never the requester). Recipients, mute/dedupe,
-- payload (request_id + offer_id) and the customer-side half are unchanged.
-- Patched from the live body.

CREATE OR REPLACE FUNCTION public._on_business_offer_accepted(e domain_events)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  r record;
  v_profile uuid;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_title text;
  v_body text;
  v_proposal uuid;
  v_uid uuid;
begin
  select * into o from business_request_offers where id = e.object_id;
  if not found then return; end if;
  select * into r from business_requests where id = o.request_id;

  for v_profile in select id from profiles where managed_partner_id = o.partner_id loop
    perform public._notify_event_recipient(e.id, v_profile,
      true,
      'A customer accepted your offer',
      coalesce(public.business_safe_request_summary(r.id), 'Open it to see the booking.'),
      jsonb_build_object('type', 'business_offer_accepted', 'request_id', r.id, 'offer_id', o.id));
  end loop;

  if e.source = 'accept_business_offer' then
    select name into v_partner_name from brand_partners where id = o.partner_id;
    select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(r.id);
    if v_occ_type is not null then
      v_title := _occasion_emoji(v_occ_type) || ' Reservation Confirmed!';
      if v_occ_who is not null then
        v_body := 'Your reservation for ' || v_occ_who || '''s ' || _occasion_noun(v_occ_type) || ' is confirmed!';
      else
        v_body := 'Your ' || _occasion_noun(v_occ_type) || ' reservation is confirmed!';
      end if;
    else
      v_title := '✅ Reservation Confirmed!';
      v_body := 'Your reservation' || case when v_partner_name is not null then ' with ' || v_partner_name else '' end || ' is confirmed!';
    end if;
    perform public._notify_event_recipient(e.id, r.requester_id,
      coalesce((select notify_business from profiles where id = r.requester_id), true),
      v_title, v_body,
      jsonb_build_object('type', 'business_reservation_confirmed', 'request_id', r.id, 'offer_id', o.id));
    -- Item 90: everyone else on the plan learns it's confirmed too.
    perform _notify_other_plan_participants(r.id, r.requester_id, 'plan_confirmed', v_title, v_body,
      jsonb_build_object('offer_id', o.id));

  elsif e.source = 'confirm_group_plan_offer' then
    v_proposal := (e.payload->>'proposal_id')::uuid;
    select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(r.id);
    if v_occ_type is not null then
      v_title := _occasion_emoji(v_occ_type) || ' Reservation Confirmed!';
      if v_occ_who is not null then
        v_body := 'Your group''s reservation for ' || v_occ_who || '''s ' || _occasion_noun(v_occ_type) || ' is confirmed!';
      else
        v_body := 'Everyone confirmed -- your group''s ' || lower(_occasion_noun(v_occ_type)) || ' reservation is locked in.';
      end if;
    else
      v_title := 'Group plan reservation confirmed!';
      v_body := 'Everyone confirmed -- your group plan reservation is locked in.';
    end if;
    for v_uid in select user_id from group_plan_participants where proposal_id = v_proposal and status = 'accepted' loop
      perform public._notify_event_recipient(e.id, v_uid,
        coalesce((select notify_planning from profiles where id = v_uid), true),
        v_title, v_body,
        jsonb_build_object('type', 'group_plan_reservation_confirmed', 'proposal_id', v_proposal, 'offer_id', o.id));
    end loop;
  end if;
end;
$function$;
