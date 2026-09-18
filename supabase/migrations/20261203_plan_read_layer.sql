-- Universal Plan, pass A: `plans` becomes the aggregation/read identity for the whole user-facing Plan experience.
--
-- Before: plans rows existed only for gatherings / business_requests / date_proposals (triggers), so an Occasion or a
-- Group Occasion Plan had no Plan identity and nothing could answer "tell me everything about this plan".
-- Now:
--   1. Every occasion and every occasion group plan gets its own plans row (plan_type 'occasion' / 'group_occasion',
--      the specific kind -- birthday, graduation, ... -- in plans.occasion_type). Created by trigger for new rows,
--      backfilled for existing ones, kept in sync on update. Deleting the source deletes the plan (FK cascade).
--   2. plans.parent_plan_id links a downstream plan (the gathering / business request / date that resulted from an
--      occasion) under the occasion's plan. link_occasion_to_plan / link_occasion_group_plan_to_plan set it, and the
--      backfill sets it from the existing resulting_plan_id links. occasions.resulting_plan_id keeps its current
--      meaning ("the downstream plan"), so every existing flow/RPC is untouched.
--   3. get_plan_overview(plan_id) is the ONE read layer: who, occasion, group plan, activity, business, offers,
--      reservation, children and a lifecycle of real facts (booleans + real statuses, no invented stage), in one jsonb.
-- Existing screens/RPCs keep using their own tables; new Plan functionality should read through get_plan_overview.
-- plan_type 'birthday'/'anniversary' stay valid (unused): the type of an occasion lives in occasion_type instead.

alter table public.plans drop constraint if exists plans_plan_type_check;
alter table public.plans add constraint plans_plan_type_check check (plan_type in (
  'dating_date', 'friend_hangout', 'gathering', 'birthday', 'anniversary', 'business_request', 'occasion', 'group_occasion'
));

alter table public.plans
  add column if not exists occasion_id uuid references public.occasions(id) on delete cascade,
  add column if not exists occasion_group_plan_id uuid references public.occasion_group_plans(id) on delete cascade,
  add column if not exists occasion_type text,
  add column if not exists who_for_name text,
  add column if not exists parent_plan_id uuid references public.plans(id) on delete set null;

create unique index if not exists plans_occasion_id_key on public.plans(occasion_id) where occasion_id is not null;
create unique index if not exists plans_occasion_group_plan_id_key on public.plans(occasion_group_plan_id) where occasion_group_plan_id is not null;
create index if not exists plans_parent_plan_idx on public.plans(parent_plan_id) where parent_plan_id is not null;

-- ---------------------------------------------------------------- occasion -> plan
create or replace function public.create_plan_from_occasion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.plans (plan_type, created_by, title, scheduled_at, status, occasion_id, occasion_type, who_for_name)
  values ('occasion', new.user_id, new.title,
          case when new.date_precision = 'exact' then new.occasion_date::timestamptz end,
          'draft', new.id, new.occasion_type, new.who_for_name)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.sync_plan_from_occasion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.plans set
    title = new.title,
    scheduled_at = case when new.date_precision = 'exact' then new.occasion_date::timestamptz end,
    occasion_type = new.occasion_type,
    who_for_name = new.who_for_name
  where occasion_id = new.id;
  return new;
end;
$$;

drop trigger if exists on_occasion_created_make_plan on public.occasions;
create trigger on_occasion_created_make_plan after insert on public.occasions
  for each row execute function public.create_plan_from_occasion();
drop trigger if exists on_occasion_updated_sync_plan on public.occasions;
create trigger on_occasion_updated_sync_plan after update of title, occasion_date, occasion_type, who_for_name, date_precision on public.occasions
  for each row execute function public.sync_plan_from_occasion();

-- ---------------------------------------------------------------- group occasion plan -> plan
create or replace function public._group_plan_status_to_plan_status(s text)
returns text language sql immutable as $$
  select case s when 'cancelled' then 'cancelled' when 'decided' then 'confirmed' when 'fulfilled' then 'confirmed' else 'draft' end;
$$;

create or replace function public.create_plan_from_group_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.plans (plan_type, created_by, title, scheduled_at, budget_max, status, occasion_group_plan_id, occasion_type, who_for_name)
  values ('group_occasion', new.host_id, new.title, new.scheduled_date::timestamptz, new.budget_max,
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
    budget_max = new.budget_max,
    status = public._group_plan_status_to_plan_status(new.status),
    occasion_type = new.occasion_type,
    who_for_name = new.who_for_name
  where occasion_group_plan_id = new.id;
  return new;
end;
$$;

drop trigger if exists on_group_plan_created_make_plan on public.occasion_group_plans;
create trigger on_group_plan_created_make_plan after insert on public.occasion_group_plans
  for each row execute function public.create_plan_from_group_plan();
drop trigger if exists on_group_plan_updated_sync_plan on public.occasion_group_plans;
create trigger on_group_plan_updated_sync_plan after update of title, scheduled_date, budget_max, status, occasion_type, who_for_name on public.occasion_group_plans
  for each row execute function public.sync_plan_from_group_plan();

revoke all on function public.create_plan_from_occasion(), public.sync_plan_from_occasion(),
  public.create_plan_from_group_plan(), public.sync_plan_from_group_plan(),
  public._group_plan_status_to_plan_status(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- backfill
insert into public.plans (plan_type, created_by, title, scheduled_at, status, occasion_id, occasion_type, who_for_name, created_at)
select 'occasion', o.user_id, o.title, case when o.date_precision = 'exact' then o.occasion_date::timestamptz end,
       'draft', o.id, o.occasion_type, o.who_for_name, o.created_at
from public.occasions o
where not exists (select 1 from public.plans p where p.occasion_id = o.id);

insert into public.plans (plan_type, created_by, title, scheduled_at, budget_max, status, occasion_group_plan_id, occasion_type, who_for_name, created_at)
select 'group_occasion', g.host_id, g.title, g.scheduled_date::timestamptz, g.budget_max,
       public._group_plan_status_to_plan_status(g.status), g.id, g.occasion_type, g.who_for_name, g.created_at
from public.occasion_group_plans g
where not exists (select 1 from public.plans p where p.occasion_group_plan_id = g.id);

update public.plans child set parent_plan_id = parent.id
from public.occasions o join public.plans parent on parent.occasion_id = o.id
where o.resulting_plan_id = child.id and child.parent_plan_id is null;

update public.plans child set parent_plan_id = parent.id
from public.occasion_group_plans g join public.plans parent on parent.occasion_group_plan_id = g.id
where g.resulting_plan_id = child.id and child.parent_plan_id is null;

-- ---------------------------------------------------------------- linking RPCs also set the parent
create or replace function public.link_occasion_to_plan(
  occasion_id_param uuid, resulting_gathering_id_param uuid default null, resulting_business_request_id_param uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_plan_id uuid;
begin
  if not exists (select 1 from occasions where id = occasion_id_param and user_id = auth.uid()) then
    raise exception 'This occasion does not belong to you.';
  end if;

  select id into v_plan_id from plans
  where created_by = auth.uid()
    and (
      (resulting_gathering_id_param is not null and resulting_gathering_id = resulting_gathering_id_param)
      or (resulting_business_request_id_param is not null and resulting_business_request_id = resulting_business_request_id_param)
    )
  order by created_at desc
  limit 1;

  if v_plan_id is not null then
    update occasions set resulting_plan_id = v_plan_id, last_planned_at = now() where id = occasion_id_param;
    update plans set parent_plan_id = (select id from plans where occasion_id = occasion_id_param)
    where id = v_plan_id and parent_plan_id is null;
  end if;
end;
$function$;

create or replace function public.link_occasion_group_plan_to_plan(
  group_plan_id_param uuid, resulting_gathering_id_param uuid default null, resulting_business_request_id_param uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_plan_id uuid;
begin
  if not is_occasion_group_plan_participant(group_plan_id_param, auth.uid()) then
    raise exception 'You are not part of this plan.';
  end if;

  if not exists (select 1 from occasion_group_plans where id = group_plan_id_param and status = 'decided') then
    return;
  end if;

  select id into v_plan_id from plans
  where created_by = auth.uid()
    and (
      (resulting_gathering_id_param is not null and resulting_gathering_id = resulting_gathering_id_param)
      or (resulting_business_request_id_param is not null and resulting_business_request_id = resulting_business_request_id_param)
    )
  order by created_at desc
  limit 1;

  if v_plan_id is not null then
    update occasion_group_plans
    set resulting_plan_id = v_plan_id, status = 'fulfilled'
    where id = group_plan_id_param and status = 'decided';

    update plans set parent_plan_id = (select id from plans where occasion_group_plan_id = group_plan_id_param)
    where id = v_plan_id and parent_plan_id is null;

    insert into plan_organizers (plan_id, user_id, added_by)
    select v_plan_id, ogpp.user_id, (select created_by from plans where id = v_plan_id)
    from occasion_group_plan_participants ogpp
    where ogpp.group_plan_id = group_plan_id_param
      and ogpp.is_organizer = true
      and ogpp.status = 'joined'
      and ogpp.user_id <> (select created_by from plans where id = v_plan_id)
    on conflict (plan_id, user_id) do nothing;
  end if;
end;
$function$;

-- ---------------------------------------------------------------- the read layer
-- Returns null when the caller has no access (creator, organizer, or participant of the plan's group plan; for a
-- child plan, anyone who can see its parent). Never returns another user's private data: people are limited to what a
-- participant of the plan may already see through the group plan itself.
create or replace function public.get_plan_overview(plan_id_param uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  p plans%rowtype;
  v_parent plans%rowtype;
  v_group occasion_group_plans%rowtype;
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

  v_allowed := is_plan_organizer(p.id, v_uid)
    or (p.occasion_group_plan_id is not null and is_occasion_group_plan_participant(p.occasion_group_plan_id, v_uid))
    or (v_parent.id is not null and (
         is_plan_organizer(v_parent.id, v_uid)
         or (v_parent.occasion_group_plan_id is not null and is_occasion_group_plan_participant(v_parent.occasion_group_plan_id, v_uid))));
  if not v_allowed then return null; end if;

  if p.occasion_group_plan_id is not null then select * into v_group from occasion_group_plans where id = p.occasion_group_plan_id; end if;
  if p.occasion_id is not null then select * into v_occ from occasions where id = p.occasion_id; end if;

  -- The plan's own real resources, else the newest child's.
  v_gathering_id := coalesce(p.resulting_gathering_id,
    (select c.resulting_gathering_id from plans c where c.parent_plan_id = p.id and c.resulting_gathering_id is not null order by c.created_at desc limit 1));
  v_br_id := coalesce(p.resulting_business_request_id,
    (select c.resulting_business_request_id from plans c where c.parent_plan_id = p.id and c.resulting_business_request_id is not null order by c.created_at desc limit 1),
    (select br.id from business_requests br where v_group.id is not null and br.group_plan_id = v_group.id order by br.created_at desc limit 1));
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
      'participants', case when v_group.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
          'user_id', pr.id, 'display_name', pr.display_name, 'status', gp.status, 'is_organizer', gp.is_organizer))
        from occasion_group_plan_participants gp join profiles pr on pr.id = gp.user_id
        where gp.group_plan_id = v_group.id and gp.user_id is not null), '[]'::jsonb) end,
      'guest_count', case when v_group.id is null then 0 else (select count(*) from occasion_group_plan_participants gp
        where gp.group_plan_id = v_group.id and gp.guest_token is not null) end),
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
