-- Experience plans: reorder and remove stops after creation (owner only).
--
-- Reorder is cosmetic: it changes plan_stops.sort_order only and never touches a request, offer, reservation or child plan
-- (no combined date/time exists yet, so order carries no scheduling meaning). Allowed on a stop in any state, incl. booked.
--
-- Remove cancels ONLY what is attached to that one stop, through the EXISTING cancellation paths (no new notification or
-- cancellation system): an open request -> cancel_business_request; an accepted reservation -> cancel_business_reservation
-- (both record cancellation_events and notify the business). Then the stop is deleted, the child plan detached from the
-- night, the remaining stops renumbered, and the parent night's status re-derived. The parent plan, other stops and
-- unrelated requests are never touched. Idempotent: removing an already-removed stop is a no-op; a request that is already
-- cancelled is not cancelled or notified again. A stop whose plan is already completed cannot be removed (it is history).
-- A payment-captured reservation makes the underlying cancel raise, which rolls the whole removal back (fail closed).
-- A night keeps at least two stops (the creation rule); to end it entirely the person cancels the plan instead.
-- Removing a GATHERING stop only removes it from the night; it does not leave the gathering (attendance is separate).

-- sort_order was 1..6 (creation caps a night at 6); widen the column check so a renumber can shift in two steps.
alter table public.plan_stops drop constraint if exists plan_stops_sort_order_check;
alter table public.plan_stops add constraint plan_stops_sort_order_check check (sort_order between 1 and 200);

-- A system reason for a cancellation caused by removing the stop (never offered in the user's reason picker).
alter table public.cancellation_events drop constraint if exists cancellation_events_reason_code_check;
alter table public.cancellation_events add constraint cancellation_events_reason_code_check check (reason_code in (
  'changed_plans', 'scheduling_conflict', 'found_another_option', 'cost', 'group_fell_through',
  'too_busy', 'unable_to_fulfil', 'closed_or_unavailable', 'other', 'stop_removed'));

-- The business must not learn that its request was one stop of a multi-part night, so its own pattern view reads a
-- removed stop as an ordinary change of plans.
create or replace function public.get_partner_cancellation_patterns(partner_id_param uuid, days_back_param integer default 30)
returns table(actor_role text, reason_code text, cancel_count bigint)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;
  return query
  select ce.actor_role,
         case when ce.reason_code = 'stop_removed' then 'changed_plans' else coalesce(ce.reason_code, 'no_reason_given') end,
         count(*)
  from cancellation_events ce
  where ce.partner_id = partner_id_param
    and ce.entity_type = 'business_reservation'
    and ce.created_at >= now() - make_interval(days => coalesce(days_back_param, 30))
  group by 1, 2
  order by count(*) desc;
end;
$function$;
revoke all on function public.get_partner_cancellation_patterns(uuid, integer) from public, anon;

-- The parent-status derivation, extracted unchanged so removal can re-run it (the trigger only fires on child changes).
create or replace function public._sync_parent_plan_status(parent_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type text;
  v_current text;
  v_next text;
  v_live int;
  v_confirmed int;
  v_completed int;
  v_total int;
  v_stops int;
begin
  if parent_id_param is null then return; end if;
  select plan_type, status into v_type, v_current from plans where id = parent_id_param;
  if v_type not in ('occasion', 'experience') then return; end if;

  select count(*) filter (where status in ('draft', 'confirmed')),
         count(*) filter (where status = 'confirmed'),
         count(*) filter (where status = 'completed'),
         count(*)
    into v_live, v_confirmed, v_completed, v_total
  from plans where parent_plan_id = parent_id_param;

  if v_type = 'occasion' then
    v_next := case
      when v_total = 0 then v_current
      when v_live > 0 then case when v_confirmed > 0 then 'confirmed' else 'draft' end
      when v_completed > 0 then 'completed'
      else 'cancelled'
    end;
  else
    select count(*) into v_stops from plan_stops where plan_id = parent_id_param and stop_type = 'business_availability';
    v_next := case
      when v_total = 0 then v_current
      when v_live > 0 then case when v_total >= v_stops and v_confirmed = v_live then 'confirmed' else 'draft' end
      when v_total < v_stops then 'draft'
      when v_completed > 0 then 'completed'
      else 'cancelled'
    end;
  end if;

  if v_next is distinct from v_current then
    update plans set status = v_next where id = parent_id_param;
  end if;
end;
$function$;
revoke all on function public._sync_parent_plan_status(uuid) from public, anon, authenticated;

create or replace function public.sync_parent_plan_status_from_children()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.parent_plan_id is null then return null; end if;
  perform public._sync_parent_plan_status(new.parent_plan_id);
  return null;
end;
$function$;
revoke all on function public.sync_parent_plan_status_from_children() from public, anon;

-- Renumber a night's stops to 1..n in the given order without tripping unique (plan_id, sort_order): shift out of range first.
create or replace function public._renumber_plan_stops(plan_id_param uuid, ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update plan_stops set sort_order = sort_order + 100 where plan_id = plan_id_param;
  update plan_stops s set sort_order = o.ord
  from unnest(ordered_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.plan_id = plan_id_param;
end;
$function$;
revoke all on function public._renumber_plan_stops(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.reorder_experience_stops(plan_id_param uuid, ordered_stop_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_have uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select status into v_status from plans
   where id = plan_id_param and created_by = v_uid and plan_type = 'experience' for update;
  if not found then raise exception 'Not your experience'; end if;
  if v_status not in ('draft', 'confirmed') then raise exception 'This night has ended and can no longer be changed.'; end if;

  select array_agg(id order by id) into v_have from plan_stops where plan_id = plan_id_param;
  if ordered_stop_ids is null
     or array_length(ordered_stop_ids, 1) is distinct from coalesce(array_length(v_have, 1), 0)
     or (select array_agg(x order by x) from unnest(ordered_stop_ids) x) is distinct from v_have then
    raise exception 'The new order must list each stop of this night exactly once.';
  end if;

  perform public._renumber_plan_stops(plan_id_param, ordered_stop_ids);
end;
$function$;

create or replace function public.remove_experience_stop(stop_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_plan_id uuid;
  v_status text;
  v_stop plan_stops%rowtype;
  v_req business_requests%rowtype;
  v_child_status text;
  v_offer_id uuid;
  v_event_id uuid;
  v_cancelled boolean := false;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select plan_id into v_plan_id from plan_stops where id = stop_id_param;
  -- Idempotent: an already-removed stop is a no-op (no second cancellation, no second notification).
  if v_plan_id is null then return jsonb_build_object('removed', false, 'cancelled_request', false); end if;

  select status into v_status from plans
   where id = v_plan_id and created_by = v_uid and plan_type = 'experience' for update;
  if not found then raise exception 'Not your experience'; end if;
  if v_status not in ('draft', 'confirmed') then raise exception 'This night has ended and can no longer be changed.'; end if;

  select * into v_stop from plan_stops where id = stop_id_param;
  if not found then return jsonb_build_object('removed', false, 'cancelled_request', false); end if;
  if (select count(*) from plan_stops where plan_id = v_plan_id) <= 2 then
    raise exception 'A night needs at least two stops. Cancel the plan instead to end it.';
  end if;

  if v_stop.request_id is not null then
    select status into v_child_status from plans
     where resulting_business_request_id = v_stop.request_id and created_by = v_uid order by created_at desc limit 1;
    if v_child_status = 'completed' then
      raise exception 'This stop is already done and stays in your night.';
    end if;

    -- Only this stop's own request Plan leaves the night; detach first so its cancellation cannot cascade to the parent.
    update plans set parent_plan_id = null where resulting_business_request_id = v_stop.request_id and parent_plan_id = v_plan_id;

    select * into v_req from business_requests where id = v_stop.request_id for update;
    if v_req.status = 'open' then
      perform public.cancel_business_request(v_req.id);
      v_cancelled := true;
      select id into v_event_id from cancellation_events
       where entity_type = 'business_request' and entity_id = v_req.id and cancelled_by = v_uid and reason_code is null
       order by created_at desc limit 1;
    elsif v_req.status = 'fulfilled' then
      select id into v_offer_id from business_request_offers where request_id = v_req.id and status = 'accepted' limit 1;
      if v_offer_id is not null then
        perform public.cancel_business_reservation(v_offer_id);
        v_cancelled := true;
        select id into v_event_id from cancellation_events
         where entity_type = 'business_reservation' and entity_id = v_offer_id and cancelled_by = v_uid and reason_code is null
         order by created_at desc limit 1;
      end if;
    end if;
    -- Any other request state (cancelled / expired / merged) is already over: nothing to cancel or notify.
    if v_event_id is not null then
      update cancellation_events set reason_code = 'stop_removed' where id = v_event_id;
    end if;
  end if;

  delete from plan_stops where id = stop_id_param;
  perform public._renumber_plan_stops(v_plan_id,
    coalesce((select array_agg(id order by sort_order) from plan_stops where plan_id = v_plan_id), '{}'::uuid[]));
  perform public._sync_parent_plan_status(v_plan_id);

  return jsonb_build_object('removed', true, 'cancelled_request', v_cancelled);
end;
$function$;

revoke all on function public.reorder_experience_stops(uuid, uuid[]) from public, anon;
revoke all on function public.remove_experience_stop(uuid) from public, anon;
grant execute on function public.reorder_experience_stops(uuid, uuid[]) to authenticated;
grant execute on function public.remove_experience_stop(uuid) to authenticated;
