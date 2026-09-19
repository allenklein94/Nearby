-- Experience stops follow their own request: after the person continues a business stop through the existing ask flow, the
-- stop is linked to that request (owner-only RPC), the request's own Plan becomes a CHILD of the experience Plan, and the
-- parent status is derived from its children exactly like an occasion parent's (see sync_parent_plan_status_from_children).
-- Stop state is DERIVED in get_plan_stops from the child plan + the request's offers; nothing new is stored but the link.

alter table public.plan_stops add column if not exists request_id uuid references public.business_requests(id) on delete set null;

create or replace function public.link_experience_stop_request(stop_id_param uuid, request_id_param uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_stop public.plan_stops%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into v_stop from public.plan_stops where id = stop_id_param;
  if not found or not exists (select 1 from public.plans where id = v_stop.plan_id and created_by = v_uid and plan_type = 'experience') then
    raise exception 'Not your experience';
  end if;
  if v_stop.stop_type <> 'business_availability' then raise exception 'Only business stops are requested'; end if;
  if not exists (select 1 from public.business_requests where id = request_id_param and requester_id = v_uid) then
    raise exception 'Not your request';
  end if;
  -- One request per stop; re-linking the same request is a no-op.
  -- (A stop whose earlier request was cancelled may be requested again; the old request's Plan stays a cancelled child.)
  if v_stop.request_id is not null and v_stop.request_id <> request_id_param
     and not exists (select 1 from public.plans where resulting_business_request_id = v_stop.request_id and status = 'cancelled') then
    raise exception 'This stop already has a request';
  end if;
  if exists (select 1 from public.plan_stops where request_id = request_id_param and id <> stop_id_param) then
    raise exception 'That request is already part of a stop';
  end if;

  update public.plan_stops set request_id = request_id_param where id = stop_id_param;
  -- The request's own Plan (created by trigger) becomes a child; the child trigger then recomputes the parent's status.
  update public.plans set parent_plan_id = v_stop.plan_id
   where resulting_business_request_id = request_id_param and created_by = v_uid and parent_plan_id is null;
end;
$$;

create or replace function public.sync_parent_plan_status_from_children()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parent_id uuid;
  v_type text;
  v_current text;
  v_next text;
  v_live int;
  v_confirmed int;
  v_completed int;
  v_total int;
  v_stops int;
begin
  v_parent_id := new.parent_plan_id;
  if v_parent_id is null then return null; end if;
  select plan_type, status into v_type, v_current from plans where id = v_parent_id;
  if v_type not in ('occasion', 'experience') then return null; end if;

  select count(*) filter (where status in ('draft', 'confirmed')),
         count(*) filter (where status = 'confirmed'),
         count(*) filter (where status = 'completed'),
         count(*)
    into v_live, v_confirmed, v_completed, v_total
  from plans where parent_plan_id = v_parent_id;

  if v_type = 'occasion' then
    v_next := case
      when v_total = 0 then v_current
      when v_live > 0 then case when v_confirmed > 0 then 'confirmed' else 'draft' end
      when v_completed > 0 then 'completed'
      else 'cancelled'
    end;
  else
    -- An experience is only as settled as ALL its business stops: it stays 'draft' until every business stop has a
    -- request and every live one is confirmed; it ends (completed/cancelled) only when no stop is still live.
    select count(*) into v_stops from plan_stops where plan_id = v_parent_id and stop_type = 'business_availability';
    v_next := case
      when v_total = 0 then v_current
      when v_live > 0 then case when v_total >= v_stops and v_confirmed = v_live then 'confirmed' else 'draft' end
      when v_total < v_stops then 'draft'
      when v_completed > 0 then 'completed'
      else 'cancelled'
    end;
  end if;

  if v_next is distinct from v_current then
    update plans set status = v_next where id = v_parent_id;
  end if;
  return null;
end;
$function$;

drop function if exists public.get_plan_stops(uuid);
create or replace function public.get_plan_stops(plan_id_param uuid)
returns table (id uuid, sort_order integer, component_key text, component_label text, stop_type text, ref_id uuid,
               partner_id uuid, title text, subtitle text, category text, request_id uuid, stop_state text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.sort_order, s.component_key, s.component_label, s.stop_type, s.ref_id, s.partner_id, s.title, s.subtitle,
         s.category, s.request_id,
         case
           when s.stop_type = 'gathering' then
             case when exists (select 1 from public.gathering_interest gi where gi.gathering_id = s.ref_id and gi.user_id = auth.uid() and gi.status = 'approved')
                  then 'booked' else 'chosen' end
           when s.request_id is null then 'chosen'
           else coalesce((
             select case c.status
                      when 'cancelled' then 'cancelled'
                      when 'completed' then 'done'
                      when 'confirmed' then 'booked'
                      else case when exists (select 1 from public.business_request_offers o where o.request_id = s.request_id and o.status = 'offered')
                                then 'offer_received' else 'requested' end
                    end
             from public.plans c where c.parent_plan_id = s.plan_id and c.resulting_business_request_id = s.request_id limit 1
           ), 'requested')
         end as stop_state
  from public.plan_stops s
  where s.plan_id = plan_id_param and public._can_view_plan(plan_id_param, auth.uid())
  order by s.sort_order;
$$;

revoke all on function public.link_experience_stop_request(uuid, uuid) from public, anon;
revoke all on function public.get_plan_stops(uuid) from public, anon;
grant execute on function public.link_experience_stop_request(uuid, uuid) to authenticated;
grant execute on function public.get_plan_stops(uuid) to authenticated;
