-- Universal Plan, pass D: budget is a first-class part of the Plan read layer.
--
-- Budget is really captured in two places only: business_requests (budget_min/max) and occasion_group_plans
-- (budget_min/max). plans had budget_max only, so a plan could never carry a range and a request's minimum was lost.
-- This adds plans.budget_min, keeps both columns in sync from those two sources (create + update), backfills them, and
-- has get_plan_overview return ONE budget (min, max, source: plan | group_plan | business_request) taken from the first
-- source that really has one -- min and max always from the same source. Occasions, matches and gatherings capture no
-- budget, so their plans honestly report none; nothing is invented or derived. get_plan_overview keeps its signature.

alter table public.plans add column if not exists budget_min numeric;

-- business request -> plan (primary requests only; add-ons stay plan-less, 20261104)
create or replace function public.create_plan_from_business_request()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.parent_request_id is null then
    insert into public.plans (
      plan_type, created_by, title, scheduled_at, location_lat, location_lng,
      party_size, budget_min, budget_max, status, resulting_business_request_id
    ) values (
      'business_request', new.requester_id, coalesce(new.raw_text, new.category),
      new.date::timestamptz, new.latitude, new.longitude,
      new.party_size, new.budget_min, new.budget_max, 'draft', new.id
    );
  end if;
  return new;
end;
$function$;

create or replace function public.sync_plan_budget_from_business_request()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.plans set budget_min = new.budget_min, budget_max = new.budget_max
  where resulting_business_request_id = new.id
    and (budget_min is distinct from new.budget_min or budget_max is distinct from new.budget_max);
  return new;
end;
$$;
drop trigger if exists on_business_request_budget_sync_plan on public.business_requests;
create trigger on_business_request_budget_sync_plan after update of budget_min, budget_max on public.business_requests
  for each row execute function public.sync_plan_budget_from_business_request();

-- occasion group plan -> plan
create or replace function public.create_plan_from_group_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.plans (plan_type, created_by, title, scheduled_at, budget_min, budget_max, status, occasion_group_plan_id, occasion_type, who_for_name)
  values ('group_occasion', new.host_id, new.title, new.scheduled_date::timestamptz, new.budget_min, new.budget_max,
          public._group_plan_status_to_plan_status(new.status), new.id, new.occasion_type, new.who_for_name)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.sync_plan_from_group_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.plans set
    title = new.title,
    scheduled_at = new.scheduled_date::timestamptz,
    budget_min = new.budget_min,
    budget_max = new.budget_max,
    status = public._group_plan_status_to_plan_status(new.status),
    occasion_type = new.occasion_type,
    who_for_name = new.who_for_name
  where occasion_group_plan_id = new.id;
  return new;
end;
$$;
drop trigger if exists on_group_plan_updated_sync_plan on public.occasion_group_plans;
create trigger on_group_plan_updated_sync_plan after update of title, scheduled_date, budget_min, budget_max, status, occasion_type, who_for_name on public.occasion_group_plans
  for each row execute function public.sync_plan_from_group_plan();

revoke all on function public.sync_plan_budget_from_business_request() from public, anon, authenticated;

-- backfill
update public.plans p set budget_min = br.budget_min, budget_max = br.budget_max
from public.business_requests br
where p.resulting_business_request_id = br.id and (p.budget_min is distinct from br.budget_min or p.budget_max is distinct from br.budget_max);
update public.plans p set budget_min = g.budget_min, budget_max = g.budget_max
from public.occasion_group_plans g
where p.occasion_group_plan_id = g.id and (p.budget_min is distinct from g.budget_min or p.budget_max is distinct from g.budget_max);

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
  v_budget jsonb;
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
    'plan', jsonb_build_object('id', p.id, 'plan_type', p.plan_type, 'occasion_type', p.occasion_type, 'title', p.title,
      'scheduled_at', p.scheduled_at, 'location_label', p.location_label, 'party_size', p.party_size,
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
