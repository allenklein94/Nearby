-- Item 134 (owner, 2026-09-28): one object, many views -- every surface references the canonical object by its id, never a
-- copy that can drift. Audit found two creation-time copies being SHOWN as if current: (1) a gathering's Plan row copies the
-- gathering's title, start time, place and capacity at creation (create_plan_from_gathering) and nothing ever updates them, so
-- after a host edit the Plan detail would show the old time; (2) an experience stop copies its gathering/posting title and the
-- business name. The read layer now reads the live object by id (the plan's own gathering; the stop's gathering / posting /
-- business) and keeps the stored copy only as a fallback when the object is gone. No data rewritten, no column dropped; same
-- signatures, single overloads. Gathering stop titles stay private-aware (_viewer_can_see_gathering, item 131).

CREATE OR REPLACE FUNCTION public.get_plan_overview(plan_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  p plans%rowtype;
  v_parent plans%rowtype;
  v_group occasion_group_plans%rowtype;
  v_match matches%rowtype;
  v_occ occasions%rowtype;
  v_gathering_id uuid;
  v_br_id uuid;
  v_dp_id uuid;
  v_offers jsonb;
  v_res jsonb;
  v_activity jsonb;
  v_budget jsonb;
  g_own gatherings%rowtype; -- item 134: the plan's own gathering, read live (the plan row only holds a creation-time copy)
begin
  if v_uid is null then return null; end if;
  select * into p from plans where id = plan_id_param;
  if not found then return null; end if;

  if p.parent_plan_id is not null then select * into v_parent from plans where id = p.parent_plan_id; end if;

  if not public._can_view_plan(p.id, v_uid) then return null; end if;
  if p.resulting_gathering_id is not null then select * into g_own from gatherings where id = p.resulting_gathering_id; end if;

  if p.occasion_group_plan_id is not null then select * into v_group from occasion_group_plans where id = p.occasion_group_plan_id; end if;
  if p.match_id is not null then select * into v_match from matches where id = p.match_id; end if;
  if p.occasion_id is not null then select * into v_occ from occasions where id = p.occasion_id; end if;

  -- The plan's own real resources, else the newest child's.
  v_gathering_id := coalesce(p.resulting_gathering_id,
    (select c.resulting_gathering_id from plans c where c.parent_plan_id = p.id and c.resulting_gathering_id is not null order by c.created_at desc limit 1),
    (select br.gathering_id from business_requests br where br.id = p.resulting_business_request_id));
  v_br_id := coalesce(p.resulting_business_request_id,
    (select c.resulting_business_request_id from plans c where c.parent_plan_id = p.id and c.resulting_business_request_id is not null order by c.created_at desc limit 1),
    (select br.id from business_requests br where v_group.id is not null and br.group_plan_id = v_group.id order by br.created_at desc limit 1),
    (select br.id from business_requests br where v_gathering_id is not null and br.gathering_id = v_gathering_id and br.parent_request_id is null order by br.created_at desc limit 1),
    (select br.id from business_requests br where v_match.id is not null and br.match_id = v_match.id and br.parent_request_id is null order by br.created_at desc limit 1));
  v_dp_id := coalesce(p.resulting_date_proposal_id,
    (select c.resulting_date_proposal_id from plans c where c.parent_plan_id = p.id and c.resulting_date_proposal_id is not null order by c.created_at desc limit 1));

  -- One budget, from the first place a real one was captured: the plan itself, its group occasion plan, its business
  -- request. Min and max always come from the same source; nothing is inferred when none exists.
  v_budget := case
    when p.budget_min is not null or p.budget_max is not null then jsonb_build_object('min', p.budget_min, 'max', p.budget_max, 'source', 'plan')
    when v_group.budget_min is not null or v_group.budget_max is not null then jsonb_build_object('min', v_group.budget_min, 'max', v_group.budget_max, 'source', 'group_plan')
    else (select jsonb_build_object('min', br.budget_min, 'max', br.budget_max, 'source', 'business_request')
          from business_requests br where br.id = v_br_id and (br.budget_min is not null or br.budget_max is not null))
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'partner_id', o.partner_id, 'business_name', bp.name, 'title', o.offer_title,
      'price', o.offer_price, 'price_is_per_person', o.price_is_per_person, 'status', o.status,
      'proposed_time', o.proposed_time, 'accepted_at', o.accepted_at) order by o.created_at desc), '[]'::jsonb)
  into v_offers
  from business_request_offers o left join brand_partners bp on bp.id = o.partner_id
  where v_br_id is not null and o.request_id = v_br_id;

  select jsonb_build_object('id', r.id, 'offer_id', r.offer_id, 'status', r.status, 'provider', r.provider, 'confirmed_at', r.confirmed_at)
  into v_res
  from business_reservations r join business_request_offers o on o.id = r.offer_id
  where v_br_id is not null and o.request_id = v_br_id
  order by r.created_at desc limit 1;

  select case
    when v_gathering_id is not null then (select jsonb_build_object('kind', 'gathering', 'id', g.id, 'title', g.title,
        'scheduled_at', g.scheduled_at, 'area', g.area, 'interest_tag', g.interest_tag) from gatherings g where g.id = v_gathering_id)
    when v_group.winning_option_id is not null then (select jsonb_build_object('kind', 'group_option', 'id', w.id, 'title', w.label,
        'activity_type', w.activity_type, 'option_kind', w.option_kind) from occasion_group_plan_options w where w.id = v_group.winning_option_id)
  end into v_activity;

  return jsonb_build_object(
    'plan', jsonb_build_object('id', p.id, 'plan_type', p.plan_type, 'occasion_type', p.occasion_type, 'title', case when g_own.id is not null then g_own.title else p.title end,
      'scheduled_at', case when g_own.id is not null then g_own.scheduled_at else p.scheduled_at end,
      'location_label', case when g_own.id is not null then coalesce(g_own.area, p.location_label) else p.location_label end,
      'party_size', case when g_own.id is not null then g_own.capacity else p.party_size end,
      'budget_max', v_budget->'max', 'budget_min', v_budget->'min', 'budget_source', v_budget->'source',
      'status', p.status, 'created_at', p.created_at),
    'who', jsonb_build_object(
      'host', (select jsonb_build_object('id', pr.id, 'display_name', pr.display_name) from profiles pr where pr.id = p.created_by),
      'for_name', p.who_for_name,
      'organizers', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'display_name', pr.display_name))
        from plan_organizers po join profiles pr on pr.id = po.user_id where po.plan_id = p.id), '[]'::jsonb),
      'participants', case when v_match.id is not null then (select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', pr.id, 'display_name', pr.display_name, 'status', 'matched', 'is_organizer', false)), '[]'::jsonb)
        from profiles pr where pr.id in (v_match.user_a, v_match.user_b))
        when v_group.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
          'user_id', pr.id, 'display_name', pr.display_name, 'status', gp.status, 'is_organizer', gp.is_organizer))
        from occasion_group_plan_participants gp join profiles pr on pr.id = gp.user_id
        where gp.group_plan_id = v_group.id and gp.user_id is not null), '[]'::jsonb) end,
      'attendee_count', case when p.resulting_gathering_id is null then 0 else
        (select count(*) from gathering_interest gi where gi.gathering_id = p.resulting_gathering_id and gi.status = 'approved') end,
      'guest_count', case when v_group.id is null then 0 else (select count(*) from occasion_group_plan_participants gp
        where gp.group_plan_id = v_group.id and gp.guest_token is not null) end),
    'match', case when v_match.id is not null then jsonb_build_object('id', v_match.id, 'matched_at', v_match.matched_at,
        'kind', case when v_match.source_friendship_id is not null or v_match.source_gathering_id is not null then 'friend' else 'dating' end,
        'other_user_id', case when v_uid = v_match.user_a then v_match.user_b else v_match.user_a end,
        'other_display_name', (select pr.display_name from profiles pr where pr.id = case when v_uid = v_match.user_a then v_match.user_b else v_match.user_a end)) end,
    'occasion', case when v_occ.id is not null then jsonb_build_object('id', v_occ.id, 'occasion_type', v_occ.occasion_type,
        'title', v_occ.title, 'occasion_date', v_occ.occasion_date, 'date_precision', v_occ.date_precision,
        'recurs_annually', v_occ.recurs_annually, 'surprise_mode', v_occ.surprise_mode) end,
    'group_plan', case when v_group.id is not null then jsonb_build_object('id', v_group.id, 'status', v_group.status,
        'scheduled_date', v_group.scheduled_date, 'when_preset', v_group.when_preset, 'experience_level', v_group.experience_level,
        'surprise_mode', v_group.surprise_mode) end,
    'activity', v_activity,
    'business_request', (select jsonb_build_object('id', br.id, 'status', br.status, 'category', br.category,
        'party_size', br.party_size, 'plan_time', br.plan_time, 'plan_label', br.plan_label) from business_requests br where br.id = v_br_id),
    'date_proposal_id', v_dp_id,
    'offers', v_offers,
    'reservation', v_res,
    'parent', case when v_parent.id is not null then jsonb_build_object('id', v_parent.id, 'plan_type', v_parent.plan_type, 'title', v_parent.title) end,
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'plan_type', c.plan_type,
        'title', coalesce((select g.title from gatherings g where g.id = c.resulting_gathering_id), c.title), 'status', c.status)
        order by c.created_at) from plans c where c.parent_plan_id = p.id), '[]'::jsonb),
    'lifecycle', jsonb_build_object(
      'status', p.status,
      'has_activity', v_activity is not null,
      'has_business', v_br_id is not null,
      'has_offer', jsonb_array_length(v_offers) > 0,
      'has_accepted_offer', exists (select 1 from jsonb_array_elements(v_offers) x where x->>'accepted_at' is not null),
      'has_reservation', v_res is not null,
      'reservation_status', v_res->>'status')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_plan_stops(plan_id_param uuid)
 RETURNS TABLE(id uuid, sort_order integer, component_key text, component_label text, stop_type text, ref_id uuid, partner_id uuid, title text, subtitle text, category text, request_id uuid, stop_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.sort_order, s.component_key, s.component_label, s.stop_type, s.ref_id, s.partner_id,
         -- item 134: the stop points at its object; its title is read live (the stored copy only for a gone object, or a
         -- gathering the viewer may no longer see, so a rename after it went private is never revealed)
         case when s.stop_type = 'gathering' then
                case when public._viewer_can_see_gathering(s.ref_id) then coalesce(g.title, s.title) else s.title end
              else case when ba.id is not null then ba.title else s.title end end as title,
         case when s.stop_type = 'gathering' then s.subtitle else coalesce(bp.name, s.subtitle) end as subtitle,
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
  left join public.gatherings g on s.stop_type = 'gathering' and g.id = s.ref_id
  left join public.business_availability ba on s.stop_type = 'business_availability' and ba.id = s.ref_id
  left join public.brand_partners bp on bp.id = coalesce(ba.partner_id, s.partner_id)
  where s.plan_id = plan_id_param and public._can_view_plan(plan_id_param, auth.uid())
  order by s.sort_order;
$function$;

CREATE OR REPLACE FUNCTION public._night_stops_json(plan_id_param uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'order', s.sort_order,
      'componentLabel', s.component_label,
      'stopType', s.stop_type,
      'title', case when s.stop_type = 'gathering'
                    then coalesce((select g.title from gatherings g where g.id = s.ref_id and g.is_public is true and g.visibility = 'everyone'), 'A gathering')
                    else coalesce((select ba.title from business_availability ba where ba.id = s.ref_id), s.title) end,
      'subtitle', case when s.stop_type = 'gathering'
                       then (select s.subtitle from gatherings g where g.id = s.ref_id and g.is_public is true and g.visibility = 'everyone')
                       else coalesce((select bp.name from brand_partners bp where bp.id = s.partner_id), s.subtitle) end,
      'state', case
        when s.stop_type = 'gathering' then
          case when exists (select 1 from gathering_interest gi join plans pl on pl.id = s.plan_id
                             where gi.gathering_id = s.ref_id and gi.user_id = pl.created_by and gi.status = 'approved')
               then 'booked' else 'chosen' end
        when s.request_id is null then 'chosen'
        else coalesce((
          select case c.status
                   when 'cancelled' then 'cancelled'
                   when 'completed' then 'done'
                   when 'confirmed' then 'booked'
                   else case when exists (select 1 from business_request_offers o where o.request_id = s.request_id and o.status = 'offered')
                             then 'offer_received' else 'requested' end
                 end
          from plans c where c.parent_plan_id = s.plan_id and c.resulting_business_request_id = s.request_id limit 1
        ), 'requested')
      end) order by s.sort_order), '[]'::jsonb)
  from plan_stops s where s.plan_id = plan_id_param;
$function$;
