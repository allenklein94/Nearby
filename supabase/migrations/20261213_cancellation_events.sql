-- Cancellation reason analytics. Every ROOT cancellation (reservation, request, gathering, occasion group plan) is recorded
-- automatically with who cancelled; the reason is optional and attached afterwards by set_cancellation_reason, so a
-- reason can never gate a real cancel and no existing RPC gained a parameter (no overload risk). Cascaded cancellations
-- (a group plan cancelling its gathering) are not counted separately. Owner-visible insight only, never auto-reweights
-- matching (same rule as decline patterns).

create table if not exists public.cancellation_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('business_reservation', 'business_request', 'gathering', 'occasion_group_plan')),
  entity_id uuid not null,
  partner_id uuid references public.brand_partners(id) on delete set null,
  cancelled_by uuid references public.profiles(id) on delete set null,
  actor_role text not null check (actor_role in ('business', 'requester', 'host')),
  reason_code text check (reason_code in ('changed_plans', 'scheduling_conflict', 'found_another_option', 'cost', 'group_fell_through',
                                          'too_busy', 'unable_to_fulfil', 'closed_or_unavailable', 'other')),
  created_at timestamptz not null default now()
);
create index if not exists cancellation_events_partner_idx on public.cancellation_events(partner_id, created_at) where partner_id is not null;
create index if not exists cancellation_events_actor_idx on public.cancellation_events(cancelled_by, created_at desc);
alter table public.cancellation_events enable row level security;
revoke all on public.cancellation_events from public, anon, authenticated;

create or replace function public._record_cancellation(entity_type_param text, entity_id_param uuid, partner_id_param uuid, actor_role_param text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if coalesce(current_setting('app.cancel_cascade', true), '') = 'true' then return; end if;
  insert into cancellation_events (entity_type, entity_id, partner_id, cancelled_by, actor_role)
  values (entity_type_param, entity_id_param, partner_id_param, auth.uid(), actor_role_param);
end;
$function$;
revoke all on function public._record_cancellation(text, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.set_cancellation_reason(entity_type_param text, entity_id_param uuid, reason_param text)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid;
begin
  if reason_param not in ('changed_plans', 'scheduling_conflict', 'found_another_option', 'cost', 'group_fell_through',
                          'too_busy', 'unable_to_fulfil', 'closed_or_unavailable', 'other') then
    raise exception 'Invalid cancellation reason.';
  end if;
  -- Only the person who cancelled can say why, once, and only just after.
  select id into v_id from cancellation_events
  where entity_type = entity_type_param and entity_id = entity_id_param and cancelled_by = auth.uid()
    and reason_code is null and created_at > now() - interval '1 day'
  order by created_at desc limit 1 for update;
  if v_id is null then return false; end if;
  update cancellation_events set reason_code = reason_param where id = v_id;
  return true;
end;
$function$;
revoke all on function public.set_cancellation_reason(text, uuid, text) from public, anon;

create or replace function public.get_partner_cancellation_patterns(partner_id_param uuid, days_back_param integer default 30)
returns table(actor_role text, reason_code text, cancel_count bigint)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;
  return query
  select ce.actor_role, coalesce(ce.reason_code, 'no_reason_given'), count(*)
  from cancellation_events ce
  where ce.partner_id = partner_id_param
    and ce.entity_type = 'business_reservation'
    and ce.created_at >= now() - make_interval(days => coalesce(days_back_param, 30))
  group by 1, 2
  order by count(*) desc;
end;
$function$;
revoke all on function public.get_partner_cancellation_patterns(uuid, integer) from public, anon;

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
$function$
;

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
  perform _record_cancellation('business_request', request_id_param, null, 'requester');

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
$function$
;

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
  service_key text;
begin
  select scheduled_at, title into v_scheduled_at, v_title from gatherings where id = gathering_id_param and host_id = auth.uid() for update;
  if v_scheduled_at is null then
    raise exception 'Gathering not found.';
  end if;
  if v_scheduled_at < now() then
    raise exception 'This gathering has already happened and can no longer be cancelled.';
  end if;

  perform _record_cancellation('gathering', gathering_id_param, null, 'host');

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
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_occasion_group_plan(plan_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan occasion_group_plans%rowtype;
  v_child plans%rowtype;
  v_offer record;
  v_res jsonb;
  v_participant record;
  v_wants boolean;
  service_key text;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if not found or v_plan.status not in ('voting', 'voting_business', 'decided', 'fulfilled') then
    raise exception 'This plan cannot be cancelled.';
  end if;

  perform _record_cancellation('occasion_group_plan', plan_id_param, null, 'host');
  -- The cascade below is part of this one cancellation, not separate ones to analyze.
  perform set_config('app.cancel_cascade', 'true', true);

  -- Everything that was made from this plan (only exists once it is fulfilled).
  select * into v_child from plans where id = v_plan.resulting_plan_id;
  if v_child.id is not null and v_child.status <> 'completed' then
    if v_child.resulting_business_request_id is not null then
      for v_offer in
        select o.id from business_request_offers o
        where o.status = 'accepted'
          and o.request_id in (select id from business_requests
                               where id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id)
      loop
        v_res := _cancel_reservation_by_offer(v_offer.id);
        if v_res->>'reason' = 'payment_captured' then
          raise exception 'A payment has already been made for this plan. Contact the business directly to arrange a refund.';
        end if;
      end loop;
      update business_request_offers set status = 'cancelled'
      where status in ('pending', 'offered')
        and request_id in (select id from business_requests
                           where id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id);
      update business_requests set status = 'cancelled'
      where status = 'open' and (id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id);
    end if;
    if v_child.resulting_gathering_id is not null then
      -- Only the gathering's own host can cancel it (cancel_gathering checks); a gathering someone else hosts, or one that
      -- already happened, is left alone rather than blocking the cancellation.
      begin
        perform cancel_gathering(v_child.resulting_gathering_id);
      exception when others then
        null;
      end;
    end if;
    update plans set status = 'cancelled' where id = v_child.id and status <> 'completed';
  end if;

  update occasion_group_plans set status = 'cancelled', cancelled_at = now() where id = plan_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null then
    for v_participant in
      select user_id from occasion_group_plan_participants
      where group_plan_id = plan_id_param and status in ('invited', 'joined') and user_id is not null and user_id <> auth.uid()
    loop
      select coalesce(notify_planning, true) into v_wants from profiles where id = v_participant.user_id;
      if v_wants then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_participant.user_id,
            'title', '🚫 Plan cancelled',
            'body', v_plan.title || ' was cancelled by the host.',
            'data', jsonb_build_object('type', 'occasion_group_plan_cancelled', 'plan_id', plan_id_param)
          )
        );
      end if;
    end loop;
  end if;
end;
$function$
;
