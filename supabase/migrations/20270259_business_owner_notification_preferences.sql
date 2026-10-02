-- Item 143 (2026-10-02, owner): business-owner notifications are separate from customer Businesses notifications.
--
-- Same store and same check as item 142 (profiles.notification_mutes, applied once in _send_push); four OWNER groups
-- join it: owner_requests, owner_offers, owner_reservations, owner_demand. The old owner-only store
-- (business_notification_prefs, applied in send-push) is folded in and dropped, so there is one preference system.
--
-- Audit of the business-looking types by their real RECIPIENT (from the live senders):
--   to the CUSTOMER (requester / follower): business_offer_received, business_update, business_recall_outreach,
--     business_offer_declined, business_offer_withdrawn, business_request_all_declined, business_reservation_confirmed,
--     business_reservation_cancelled, business_partnership_response (the gathering host who asked a business)
--   to the OWNER (managed_partner_id): business_opportunity_received, business_opportunities_digest,
--     business_request_cancelled, business_request_expiring, business_offer_accepted, business_offer_review_result,
--     reservation_cancelled_by_customer, aggregated_demand_growing, occasion_demand_growing
--   account notices to an applicant (never muted): business_partner_approved, business_partner_denied,
--     business_partner_needs_info
-- Fixes: the old owner map wrongly listed four CUSTOMER types (offer declined/withdrawn, reservation confirmed/cancelled),
-- so an owner muting "Offer responses" also silenced their own bookings as a customer; and every owner sender read
-- notify_business, which item 142 derives from the CUSTOMER switches. Owner senders now read nothing but the owner groups.
-- notify_business stays derived from the customer groups only (customer senders keep reading it).
--
-- Existing choices kept: (1) business_notification_prefs rows become owner_* groups; (2) an owner whose customer Business
-- groups are both off had owner alerts off before (they all read notify_business), so their owner groups are muted too.

alter table public.profiles drop constraint if exists profiles_notification_mutes_known;
alter table public.profiles add constraint profiles_notification_mutes_known check (notification_mutes <@ array[
  'plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions', 'dating',
  'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
  'owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand']::text[]);

delete from public.notification_type_groups;
insert into public.notification_type_groups (type, group_key) values
  ('gathering_invite', 'plans_invitations'),
  ('group_plan_invite', 'plans_invitations'),
  ('occasion_group_plan_invite', 'plans_invitations'),
  ('date_proposal', 'plans_invitations'),
  ('experience_shared', 'plans_invitations'),
  ('gathering_approved', 'plans_changes'),
  ('gathering_waitlisted', 'plans_changes'),
  ('gathering_interest', 'plans_changes'),
  ('gathering_updated', 'plans_changes'),
  ('gathering_cancelled', 'plans_changes'),
  ('date_proposal_response', 'plans_changes'),
  ('plan_organizer_added', 'plans_changes'),
  ('plan_confirmed', 'plans_changes'),
  ('plan_reservation_cancelled', 'plans_changes'),
  ('plan_cancelled', 'plans_changes'),
  ('plan_addon_removed', 'plans_changes'),
  ('plan_item_time_changed', 'plans_changes'),
  ('group_plan_response', 'plans_changes'),
  ('group_plan_confirmed', 'plans_changes'),
  ('group_plan_offer_pending', 'plans_changes'),
  ('group_plan_reservation_confirmed', 'plans_changes'),
  ('group_plan_removed', 'plans_changes'),
  ('social_offer_received', 'plans_changes'),
  ('social_offer_responded', 'plans_changes'),
  ('occasion_group_plan_decided', 'plans_changes'),
  ('occasion_group_plan_voting_business', 'plans_changes'),
  ('occasion_group_plan_stalled', 'plans_changes'),
  ('occasion_group_plan_date_set', 'plans_changes'),
  ('occasion_group_plan_cancelled', 'plans_changes'),
  ('occasion_group_plan_guest_rsvp', 'plans_changes'),
  ('occasion_surprise_revealed', 'plans_changes'),
  ('gathering_reminder', 'plans_reminders'),
  ('gathering_business_reminder', 'plans_reminders'),
  ('recurring_gathering', 'plans_reminders'),
  ('friend_request', 'friends_activity'),
  ('friend_accepted', 'friends_activity'),
  ('friend_discovery_match', 'friends_activity'),
  ('friend_joined_gathering', 'friends_activity'),
  ('new_story', 'friends_activity'),
  ('preference_poll_received', 'friends_activity'),
  ('birthday', 'friends_occasions'),
  ('birthday_upcoming', 'friends_occasions'),
  ('anniversary_upcoming', 'friends_occasions'),
  ('occasion_upcoming', 'friends_occasions'),
  ('match', 'dating'),
  ('new_match', 'dating'),
  ('message', 'dating'),
  ('wave', 'dating'),
  ('video_call', 'dating'),
  ('screenshot', 'dating'),
  ('match_reminder', 'dating'),
  ('playlist_addition', 'dating'),
  ('trip_idea_addition', 'dating'),
  ('shared_decision_addition', 'dating'),
  ('constitution_addition', 'dating'),
  ('memory_addition', 'dating'),
  ('stress_test_addition', 'dating'),
  ('timeline_addition', 'dating'),
  ('business_offer_received', 'business_offers'),
  ('business_update', 'business_offers'),
  ('business_recall_outreach', 'business_offers'),
  ('business_offer_withdrawn', 'business_responses'),
  ('business_offer_declined', 'business_responses'),
  ('business_request_all_declined', 'business_responses'),
  ('business_reservation_confirmed', 'business_responses'),
  ('business_reservation_cancelled', 'business_responses'),
  ('business_partnership_response', 'business_responses'),
  ('recommended_gathering', 'discover_recommendations'),
  ('recommended_business_availability', 'discover_recommendations'),
  ('group_intent_signal', 'discover_recommendations'),
  ('first_mission_reminder', 'discover_recommendations'),
  ('momentum_streak_nudge', 'discover_recommendations'),
  ('reward_tier_nudge', 'discover_recommendations'),
  ('crossed_paths_sighting', 'discover_nearby_people'),
  ('community_area_demand_growing', 'communities'),
  ('community_cancelled', 'communities'),
  ('business_opportunity_received', 'owner_requests'),
  ('business_opportunities_digest', 'owner_requests'),
  ('business_request_cancelled', 'owner_requests'),
  ('business_request_expiring', 'owner_requests'),
  ('business_offer_accepted', 'owner_offers'),
  ('business_offer_review_result', 'owner_offers'),
  ('reservation_cancelled_by_customer', 'owner_reservations'),
  ('aggregated_demand_growing', 'owner_demand'),
  ('occasion_demand_growing', 'owner_demand');

-- Keep what people already chose (both sources), in canonical order.
create or replace function public._canonical_notification_mutes(m text[])
returns text[] language sql immutable set search_path to 'public' as $$
  select coalesce(array(select g from unnest(array[
    'plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions', 'dating',
    'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
    'owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand']) with ordinality u(g, i)
    where g = any (m) order by i), '{}');
$$;
revoke all on function public._canonical_notification_mutes(text[]) from public, anon, authenticated;

do $mig$
begin
  if to_regclass('public.business_notification_prefs') is not null then
    update public.profiles p set notification_mutes = public._canonical_notification_mutes(p.notification_mutes || array(
        select 'owner_' || g from unnest(b.muted_groups) g where g in ('requests', 'offers', 'reservations', 'demand')))
      from public.business_notification_prefs b
     where b.user_id = p.id and b.muted_groups <> '{}';
  end if;
end $mig$;
update public.profiles set notification_mutes = public._canonical_notification_mutes(notification_mutes ||
    array['owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand'])
 where managed_partner_id is not null and notification_mutes @> array['business_offers', 'business_responses'];

create or replace function public.set_my_notification_group(group_param text, enabled_param boolean)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v text[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if group_param not in ('plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions',
      'dating', 'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
      'owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand') then
    raise exception 'Unknown notification type';
  end if;
  -- Owner groups are a business owner's own setting (same rule as before item 143).
  if group_param like 'owner\_%' and not exists (select 1 from profiles where id = auth.uid() and managed_partner_id is not null) then
    raise exception 'Only a business owner can change this.';
  end if;
  update profiles set notification_mutes = case
      when enabled_param then array_remove(notification_mutes, group_param)
      else public._canonical_notification_mutes(notification_mutes || group_param) end
    where id = auth.uid()
    returning notification_mutes into v;
  return v;
end;
$fn$;
revoke all on function public.set_my_notification_group(text, boolean) from public, anon;
grant execute on function public.set_my_notification_group(text, boolean) to authenticated;

-- The two older owner RPCs keep their signatures (older app builds call them) and now read/write the one store.
create or replace function public.get_my_business_notification_prefs()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select array(select substr(g, 7) from unnest(p.notification_mutes) g where g like 'owner\_%')
  from profiles p where p.id = auth.uid() and p.managed_partner_id is not null;
$$;
create or replace function public.set_my_business_notification_group(group_param text, muted_param boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if group_param not in ('requests', 'offers', 'reservations', 'demand') then
    raise exception 'Unknown notification group.';
  end if;
  perform public.set_my_notification_group('owner_' || group_param, not muted_param);
end;
$$;
revoke all on function public.get_my_business_notification_prefs(), public.set_my_business_notification_group(text, boolean) from public, anon;
grant execute on function public.get_my_business_notification_prefs(), public.set_my_business_notification_group(text, boolean) to authenticated, service_role;

drop table if exists public.business_notification_prefs;

-- Owner and account senders no longer read notify_business (patched from the live bodies). _send_push applies the owner
-- groups; account notices to an applicant are never muted. Customer-recipient checks in the same functions are unchanged.
-- _business_request_expiry_warning_candidates
CREATE OR REPLACE FUNCTION public._business_request_expiry_warning_candidates()
 RETURNS TABLE(offer_id uuid, request_id uuid, partner_id uuid, owner_id uuid, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id, r.id, o.partner_id, p.id, r.expires_at
  from business_request_offers o
  join business_requests r on r.id = o.request_id
  join brand_partners bp on bp.id = o.partner_id
  join profiles p on p.managed_partner_id = o.partner_id
  where o.status = 'pending'
    and r.status = 'open'
    and r.expires_at > now()
    and r.expires_at <= now() + interval '2 hours'
    and r.expires_at - greatest(r.created_at, o.created_at) > interval '2 hours'
    and coalesce(bp.active, true)
    and not ('owner_requests' = any (p.notification_mutes))
    and not exists (select 1 from business_request_offers w where w.request_id = r.id and w.status in ('accepted', 'completed'))
    and not exists (select 1 from business_request_expiry_warnings x where x.request_id = r.id and x.partner_id = o.partner_id);
$function$;

-- send_business_opportunity_digests
CREATE OR REPLACE FUNCTION public.send_business_opportunity_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_since timestamptz;
  v_count integer;
  v_sent integer := 0;
begin

  for v_row in
    select p.id as user_id, p.managed_partner_id as partner_id, s.last_digest_at
    from profiles p
    left join business_opportunity_digest_state s on s.user_id = p.id
    where p.managed_partner_id is not null
      and not ('owner_requests' = any (p.notification_mutes))
      and (s.last_digest_at is null or s.last_digest_at <= now() - interval '6 hours')
  loop
    v_since := coalesce(v_row.last_digest_at, now() - interval '1 day');
    select count(*) into v_count
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where o.partner_id = v_row.partner_id
      and o.status = 'pending'
      and o.created_at > v_since
      and r.status = 'open'
      and r.expires_at > now()
      and not public._opportunity_is_urgent(r.id)
      and not o.is_directed;
    continue when v_count = 0;

    perform public._send_push(v_row.user_id, v_count || ' new ' || case when v_count = 1 then 'opportunity' else 'opportunities' end || ' that fit your business', 'Nearby matched them for you. Open to view and reply.', jsonb_build_object('type', 'business_opportunities_digest', 'count', v_count));
    insert into business_opportunity_digest_state (user_id, last_digest_at) values (v_row.user_id, now())
    on conflict (user_id) do update set last_digest_at = excluded.last_digest_at;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$function$;

-- _on_business_offer_accepted
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
      'Your offer was accepted!',
      'A customer accepted your offer: ' || coalesce(public.business_safe_request_summary(r.id), 'a request'),
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

-- _on_business_offer_sent
CREATE OR REPLACE FUNCTION public._on_business_offer_sent(e domain_events)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_requester uuid;
  v_title text;
  v_body text;
  v_label text;
  v_profile uuid;
  v_summary text;
begin
  select * into o from business_request_offers where id = e.object_id;
  if not found then return; end if;

  if e.source in ('submit_business_offer', 'admin_review_business_content_screening') then
    select requester_id into v_requester from business_requests where id = o.request_id;
    select p.title, p.body into v_title, v_body from public._business_reply_push(o.id) p;
    perform public._notify_event_recipient(e.id, v_requester,
      coalesce((select notify_business from profiles where id = v_requester), true),
      v_title, v_body,
      jsonb_build_object('type', 'business_offer_received', 'request_id', o.request_id, 'offer_id', o.id));
    return;
  end if;

  v_summary := public.business_safe_request_summary(o.request_id);
  if e.source = 'match_availability' then
    select title into v_label from business_availability where id = (e.payload->>'availability_id')::uuid;
    v_title := 'Your availability was just matched!';
    v_body := '"' || v_label || '" matches a new request: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'match_package' then
    select name into v_label from business_occasion_packages where id = (e.payload->>'package_id')::uuid;
    v_title := 'Your occasion package was just matched!';
    v_body := '"' || v_label || '" matches a new request: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'match_policy' then
    v_title := 'Auto-accepted a new request!';
    v_body := 'Your fulfillment policy auto-accepted: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'ai_auto_respond' then
    select name into v_label from business_ai_policies where id = (e.payload->>'policy_id')::uuid;
    v_title := 'Your AI Automation auto-responded!';
    v_body := 'Policy "' || v_label || '" auto-sent an offer for: ' || v_summary;
  else
    return;
  end if;

  for v_profile in select id from profiles where managed_partner_id = o.partner_id loop
    perform public._notify_event_recipient(e.id, v_profile,
      -- the package match never honored the business mute (pre-item-125 behavior, kept exactly)
      true,
      v_title, v_body,
      jsonb_build_object('type', 'business_opportunity_received', 'request_id', o.request_id));
  end loop;
end;
$function$;

-- _on_business_request_sent
CREATE OR REPLACE FUNCTION public._on_business_request_sent(e domain_events)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_profile uuid;
  v_directed boolean;
begin
  select * into o from business_request_offers where id = e.object_id;
  if not found then return; end if;
  v_directed := coalesce((e.payload->>'directed')::boolean, false);
  if not v_directed and not public._opportunity_is_urgent(o.request_id) then
    return;
  end if;
  for v_profile in select id from profiles where managed_partner_id = o.partner_id loop
    perform public._notify_event_recipient(e.id, v_profile,
      true,
      case when v_directed then 'A customer asked for your business' else 'New opportunity nearby!' end,
      'New request: ' || public.business_safe_request_summary(o.request_id),
      jsonb_build_object('type', 'business_opportunity_received', 'request_id', o.request_id));
  end loop;
end;
$function$;

-- cancel_business_request
CREATE OR REPLACE FUNCTION public.cancel_business_request(request_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  v_primary_id uuid;
  v_plan record;
  v_is_primary boolean;
  v_actor_name text;
  v_cancelled_partner_ids uuid[];
  v_managing_id uuid;
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
  perform _record_cancellation('business_request', request_id_param, null, 'requester');

  update business_request_offers
  set status = 'cancelled'
  where request_id = request_id_param
  and status in ('pending', 'offered');

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
  if v_cancelled_partner_ids is not null then
    for i in 1 .. array_length(v_cancelled_partner_ids, 1) loop
      for v_managing_id in
        select id from profiles where managed_partner_id = v_cancelled_partner_ids[i]
      loop
        perform public._send_push(v_managing_id, 'A request was cancelled', 'A request you were considering was cancelled by the requester.', jsonb_build_object('type', 'business_request_cancelled', 'request_id', request_id_param));
      end loop;
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

-- cancel_business_reservation
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


  if v_is_business then
    if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
      perform public._send_push(v_request.requester_id, 'Your reservation was cancelled', 'The business cancelled your reservation for "' || left(v_request.raw_text, 60) || '"', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', offer_id_param));
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
        perform public._send_push(v_managing_profiles[i], 'A reservation was cancelled', 'A customer cancelled their reservation: ' || public.business_safe_request_summary(v_request.id), jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', offer_id_param));
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

-- cancel_community
CREATE OR REPLACE FUNCTION public.cancel_community(community_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_name text;
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
        perform public._send_push(v_request.requester_id, 'Your reservation was cancelled', 'The community "' || v_name || '" was cancelled, so your reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], 'A reservation was cancelled', 'The community "' || v_name || '" was cancelled, so the reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
        end loop;
      end if;
    elsif v_cancel_result->>'reason' = 'payment_captured' then
      if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform public._send_push(v_request.requester_id, 'Action needed on your reservation', 'The community "' || v_name || '" was cancelled, but you already paid for "' || left(v_request.raw_text, 60) || '" -- contact the business directly to arrange a refund.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], 'A community was cancelled', 'The community behind an already-paid reservation for "' || left(v_request.raw_text, 60) || '" was cancelled -- the customer may reach out about a refund.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
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
    perform public._send_push(member_row.user_id, 'A community was cancelled', '"' || v_name || '" has been cancelled by its creator.', jsonb_build_object('type', 'community_cancelled'));
  end loop;

  return jsonb_build_object('success', true);
end;
$function$;

-- cancel_gathering
CREATE OR REPLACE FUNCTION public.cancel_gathering(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scheduled_at timestamptz;
  v_title text;
  v_accepted_offer record;
  v_cancel_result jsonb;
  v_request record;
  v_managing_profiles uuid[];
begin
  select scheduled_at, title into v_scheduled_at, v_title from gatherings where id = gathering_id_param and host_id = auth.uid() for update;
  if v_scheduled_at is null then
    raise exception 'Gathering not found.';
  end if;
  if v_scheduled_at < now() then
    raise exception 'This gathering has already happened and can no longer be cancelled.';
  end if;

  perform _record_cancellation('gathering', gathering_id_param, null, 'host');


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
        perform public._send_push(v_request.requester_id, 'Your reservation was cancelled', 'The gathering "' || v_title || '" was cancelled, so your reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], 'A reservation was cancelled', 'The gathering "' || v_title || '" was cancelled, so the reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
        end loop;
      end if;
    elsif v_cancel_result->>'reason' = 'payment_captured' then
      if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform public._send_push(v_request.requester_id, 'Action needed on your reservation', 'The gathering "' || v_title || '" was cancelled, but you already paid for "' || left(v_request.raw_text, 60) || '" -- contact the business directly to arrange a refund.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], 'A customer''s gathering was cancelled', 'The gathering behind an already-paid reservation for "' || left(v_request.raw_text, 60) || '" was cancelled -- the customer may reach out about a refund.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
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

-- notify_aggregated_demand_threshold
CREATE OR REPLACE FUNCTION public.notify_aggregated_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner record;
  v_prior_count integer;
  v_requester_counted boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;


  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner in the same
    -- category, mirroring get_aggregated_demand_for_partner()'s own
    -- "within the requester's own radius_miles of the business" rule.
    -- Distinct PEOPLE (not requests), excluding the row being inserted; the push fires only when this
    -- request brings the count to the shared privacy floor (demand_min_people()), so no business is ever
    -- told about a group smaller than that.
    select count(distinct br.requester_id), coalesce(bool_or(br.requester_id = new.requester_id), false)
    into v_prior_count, v_requester_counted
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as the group-intent trigger above --
    -- fires once when real nearby demand for this category first reaches
    -- 2, never again for the 3rd/4th/etc. request.
    if v_prior_count = public.demand_min_people() - 1 and not v_requester_counted then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], 'Growing demand nearby', '5 or more people are now looking for ' || new.category || ' near ' || v_partner.name || '.', jsonb_build_object('type', 'aggregated_demand_growing', 'partner_id', v_partner.id, 'category', new.category));
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

-- notify_occasion_demand_threshold
CREATE OR REPLACE FUNCTION public.notify_occasion_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner record;
  v_prior_count integer;
  v_requester_counted boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.occasion is null or new.latitude is null or new.longitude is null then
    return new;
  end if;


  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner sharing the
    -- same occasion, regardless of category -- mirroring notify_
    -- aggregated_demand_threshold()'s own "within the requester's own
    -- radius_miles of the business" rule, just cross-category.
    -- Distinct PEOPLE (not requests), excluding the row being inserted; the push fires only when this
    -- request brings the count to the shared privacy floor (demand_min_people()), so no business is ever
    -- told about a group smaller than that.
    select count(distinct br.requester_id), coalesce(bool_or(br.requester_id = new.requester_id), false)
    into v_prior_count, v_requester_counted
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.occasion = new.occasion
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as its category sibling -- fires once
    -- when real nearby demand for this occasion first reaches 2, never
    -- again for the 3rd/4th/etc. request.
    if v_prior_count = public.demand_min_people() - 1 and not v_requester_counted then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], _occasion_emoji(new.occasion) || ' Growing ' || _occasion_noun(new.occasion) || ' demand nearby', '5 or more groups nearby are now planning a ' || lower(_occasion_noun(new.occasion)) || ' -- near ' || v_partner.name || '.', jsonb_build_object('type', 'occasion_demand_growing', 'partner_id', v_partner.id, 'occasion_type', new.occasion));
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

-- approve_business_partner_request
CREATE OR REPLACE FUNCTION public.approve_business_partner_request(request_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  new_partner_id uuid;
  matched_profile_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category, address, latitude, longitude, attributes, cuisine, priority_occasions, subcategory, categories)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude, req.attributes, req.cuisine, req.priority_occasions, req.subcategory, req.categories)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), resulting_partner_id = new_partner_id
  where id = request_id_param;

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'apply_approved', new_partner_id);

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'published', new_partner_id);

  if req.source = 'web' and req.applicant_phone is not null then
    select id into matched_profile_id from auth.users where phone = req.applicant_phone limit 1;
    if matched_profile_id is not null then
      perform public._claim_web_business_requests(matched_profile_id);
    end if;
  end if;

  if true then
    perform public._send_push(req.requester_id, 'You''re approved as a partner! 🎉', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id));
  end if;

  return new_partner_id;
end;
$function$;

-- deny_business_partner_request
CREATE OR REPLACE FUNCTION public.deny_business_partner_request(request_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can deny business partner requests';
  end if;

  update business_partner_requests
  set status = 'denied', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param and status = 'pending'
  returning * into req;

  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into business_acquisition_events (session_id, user_id, event)
  values (gen_random_uuid(), req.requester_id, 'apply_denied');

  if true then
    perform public._send_push(req.requester_id, 'Update on your partner application', coalesce(
          nullif(req.admin_notes, ''),
          'Your application for "' || req.business_name || '" wasn''t approved this time. You can submit a new application any time.'
        ), jsonb_build_object('type', 'business_partner_denied', 'request_id', request_id_param));
  end if;
end;
$function$;

-- request_more_business_partner_info
CREATE OR REPLACE FUNCTION public.request_more_business_partner_info(request_id_param uuid, notes_param text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review business partner requests';
  end if;

  if notes_param is null or trim(notes_param) = '' then
    raise exception 'A note is required so the applicant knows what to add.';
  end if;

  update business_partner_requests
  set status = 'needs_info', reviewed_at = now(), reviewed_by = auth.uid(), admin_notes = notes_param
  where id = request_id_param and status = 'pending'
  returning * into req;

  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  if true then
    perform public._send_push(req.requester_id, 'We need a bit more information', notes_param, jsonb_build_object('type', 'business_partner_needs_info', 'request_id', request_id_param));
  end if;
end;
$function$;
