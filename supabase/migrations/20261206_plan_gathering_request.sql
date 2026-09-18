-- Universal Plan, pass C: standalone gatherings and business requests are first-class in the Plan read layer.
--
-- Both already got a plans row by trigger (20260914 / 20261104), but (a) rows created before those triggers landed were
-- never backfilled (25 gatherings -> 3 plans, 1 business request -> 0) and (b) get_plan_overview only let a plan's
-- creator/organizer/group-plan participant in, so a gathering's approved attendees and a request's group-plan / match /
-- gathering participants could never read "their" plan. This adds:
--   * backfill of missing gathering and primary business-request plans (add-ons stay plan-less, per 20261104);
--   * _plan_direct_access / _can_view_plan: ONE access predicate (creator/organizer, occasion group-plan participant,
--     match participant, approved gathering attendee, and for a request the same audiences business_requests RLS already
--     grants) used by get_plan_overview and by the new id lookup, so the two can never drift;
--   * get_plan_id_for_resource(kind, id): plan id behind a gathering / business request for anyone who may view it;
--   * get_plan_overview: a request's gathering becomes its activity, a gathering's/match's request becomes its business
--     request, and who.attendee_count (a count only -- no attendee names are exposed here).
-- get_plan_overview keeps its signature (single overload).

insert into public.plans (plan_type, created_by, title, scheduled_at, location_lat, location_lng, party_size, status, resulting_gathering_id, created_at)
select case when g.party_type = 'friends' then 'friend_hangout' else 'gathering' end, g.host_id, g.title, g.scheduled_at,
       g.precise_lat, g.precise_lng, g.capacity, 'confirmed', g.id, g.created_at
from public.gatherings g
where not exists (select 1 from public.plans p where p.resulting_gathering_id = g.id);

insert into public.plans (plan_type, created_by, title, scheduled_at, location_lat, location_lng, party_size, budget_max, status, resulting_business_request_id, created_at)
select 'business_request', br.requester_id, coalesce(br.raw_text, br.category), br.date::timestamptz, br.latitude, br.longitude,
       br.party_size, br.budget_max,
       case when br.status = 'fulfilled' then 'confirmed' when br.status in ('cancelled', 'expired') then 'cancelled' else 'draft' end,
       br.id, br.created_at
from public.business_requests br
where br.parent_request_id is null
  and not exists (select 1 from public.plans p where p.resulting_business_request_id = br.id);

create or replace function public._plan_direct_access(plan_id_param uuid, uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select uid is not null and exists (
    select 1 from plans p where p.id = plan_id_param and (
      is_plan_organizer(p.id, uid)
      or (p.occasion_group_plan_id is not null and is_occasion_group_plan_participant(p.occasion_group_plan_id, uid))
      or (p.match_id is not null and exists (select 1 from matches m where m.id = p.match_id and uid in (m.user_a, m.user_b)))
      or (p.resulting_gathering_id is not null and exists (select 1 from gathering_interest gi
            where gi.gathering_id = p.resulting_gathering_id and gi.user_id = uid and gi.status = 'approved'))
      or (p.resulting_business_request_id is not null and exists (select 1 from business_requests br
            where br.id = p.resulting_business_request_id and (
              (br.group_plan_id is not null and is_group_plan_participant(br.group_plan_id, uid))
              or (br.match_id is not null and is_match_participant(br.match_id, uid))
              or (br.gathering_id is not null and exists (select 1 from gathering_interest gi
                    where gi.gathering_id = br.gathering_id and gi.user_id = uid and gi.status = 'approved'))))))
  );
$$;

create or replace function public._can_view_plan(plan_id_param uuid, uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public._plan_direct_access(plan_id_param, uid)
    or public._plan_direct_access((select parent_plan_id from plans where id = plan_id_param), uid);
$$;

create or replace function public.get_plan_id_for_resource(kind_param text, resource_id_param uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select p.id from plans p
  where ((kind_param = 'gathering' and p.resulting_gathering_id = resource_id_param)
      or (kind_param = 'business_request' and p.resulting_business_request_id = resource_id_param))
    and public._can_view_plan(p.id, auth.uid())
  order by p.created_at desc limit 1;
$$;

revoke all on function public._plan_direct_access(uuid, uuid), public._can_view_plan(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_plan_id_for_resource(text, uuid) from public, anon;
grant execute on function public.get_plan_id_for_resource(text, uuid) to authenticated, service_role;

create or replace function public.get_plan_overview(plan_id_param uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
  v_allowed boolean;
begin
  if v_uid is null then return null; end if;
  select * into p from plans where id = plan_id_param;
  if not found then return null; end if;

  if p.parent_plan_id is not null then select * into v_parent from plans where id = p.parent_plan_id; end if;

  if not public._can_view_plan(p.id, v_uid) then return null; end if;

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
    'plan', jsonb_build_object('id', p.id, 'plan_type', p.plan_type, 'occasion_type', p.occasion_type, 'title', p.title,
      'scheduled_at', p.scheduled_at, 'location_label', p.location_label, 'party_size', p.party_size,
      'budget_max', coalesce(p.budget_max, v_group.budget_max), 'budget_min', v_group.budget_min,
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
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'plan_type', c.plan_type, 'title', c.title, 'status', c.status)
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

revoke all on function public.get_plan_overview(uuid) from public, anon;
grant execute on function public.get_plan_overview(uuid) to authenticated, service_role;
