-- Universal Plan, pass B: a dating match and a friend connection each get a Plan identity.
--
-- A match row (romantic, or friend-sourced via friendships.status='accepted' / a gathering) now has its own plans row
-- (plan_type 'dating_match' / 'friend_match', plans.match_id, one per match, cascade on delete). The date/hangout
-- proposals made inside that match (already plans rows, plan_type 'dating_date' / 'friend_hangout') hang under it via
-- parent_plan_id, so "tell me everything about this relationship's plans" is one get_plan_overview call. Nothing
-- existing changes meaning: date_proposals still create their own plan row, PlansScreen queries filter on
-- resulting_date_proposal_id so the new match rows never appear in Plans lists. A friendship IS a match row here
-- (create_match_on_friendship_accepted), so 'friend' is the same code path keyed off source_friendship_id.
-- plans RLS stays creator-only; both match participants read through get_plan_overview (null for anyone else) and
-- find the id through get_plan_id_for_match.

alter table public.plans drop constraint if exists plans_plan_type_check;
alter table public.plans add constraint plans_plan_type_check check (plan_type in (
  'dating_date', 'friend_hangout', 'gathering', 'birthday', 'anniversary', 'business_request', 'occasion', 'group_occasion',
  'dating_match', 'friend_match'
));

alter table public.plans add column if not exists match_id uuid references public.matches(id) on delete cascade;
create unique index if not exists plans_match_id_key on public.plans(match_id) where match_id is not null;

create or replace function public._match_plan_type(source_friendship_id uuid, source_gathering_id uuid)
returns text language sql immutable as $$
  select case when source_friendship_id is not null or source_gathering_id is not null then 'friend_match' else 'dating_match' end;
$$;

create or replace function public.create_plan_from_match()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.plans (plan_type, created_by, status, match_id, created_at)
  values (public._match_plan_type(new.source_friendship_id, new.source_gathering_id), new.user_a, 'draft', new.id, new.matched_at)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_match_created_make_plan on public.matches;
create trigger on_match_created_make_plan after insert on public.matches
  for each row execute function public.create_plan_from_match();

-- date/hangout proposals become children of their match's plan
create or replace function public.create_plan_from_date_proposal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan_type text;
  v_parent uuid;
begin
  select case
    when m.source_gathering_id is not null or m.source_friendship_id is not null then 'friend_hangout'
    else 'dating_date'
  end into v_plan_type
  from public.matches m where m.id = new.match_id;

  select id into v_parent from public.plans where match_id = new.match_id;

  insert into public.plans (plan_type, created_by, title, status, resulting_date_proposal_id, parent_plan_id)
  values (coalesce(v_plan_type, 'dating_date'), new.proposed_by, new.plan_text, 'draft', new.id, v_parent);
  return new;
end;
$$;

-- backfill
insert into public.plans (plan_type, created_by, status, match_id, created_at)
select public._match_plan_type(m.source_friendship_id, m.source_gathering_id), m.user_a, 'draft', m.id, m.matched_at
from public.matches m
where not exists (select 1 from public.plans p where p.match_id = m.id);

update public.plans child set parent_plan_id = parent.id
from public.date_proposals dp join public.plans parent on parent.match_id = dp.match_id
where child.resulting_date_proposal_id = dp.id and child.parent_plan_id is null;

-- the plan id behind a match, for either participant (plans RLS is creator-only)
create or replace function public.get_plan_id_for_match(match_id_param uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select p.id from plans p join matches m on m.id = p.match_id
  where p.match_id = match_id_param and auth.uid() in (m.user_a, m.user_b);
$$;

revoke all on function public.create_plan_from_match(), public._match_plan_type(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_plan_id_for_match(uuid) from public, anon;
grant execute on function public.get_plan_id_for_match(uuid) to authenticated, service_role;

-- get_plan_overview: same signature (single overload), now also understands match plans
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

  v_allowed := is_plan_organizer(p.id, v_uid)
    or (p.match_id is not null and exists (select 1 from matches m where m.id = p.match_id and v_uid in (m.user_a, m.user_b)))
    or (v_parent.match_id is not null and exists (select 1 from matches m where m.id = v_parent.match_id and v_uid in (m.user_a, m.user_b)))
    or (p.occasion_group_plan_id is not null and is_occasion_group_plan_participant(p.occasion_group_plan_id, v_uid))
    or (v_parent.id is not null and (
         is_plan_organizer(v_parent.id, v_uid)
         or (v_parent.occasion_group_plan_id is not null and is_occasion_group_plan_participant(v_parent.occasion_group_plan_id, v_uid))));
  if not v_allowed then return null; end if;

  if p.occasion_group_plan_id is not null then select * into v_group from occasion_group_plans where id = p.occasion_group_plan_id; end if;
  if p.match_id is not null then select * into v_match from matches where id = p.match_id; end if;
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
      'participants', case when v_match.id is not null then (select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', pr.id, 'display_name', pr.display_name, 'status', 'matched', 'is_organizer', false)), '[]'::jsonb)
        from profiles pr where pr.id in (v_match.user_a, v_match.user_b))
        when v_group.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
          'user_id', pr.id, 'display_name', pr.display_name, 'status', gp.status, 'is_organizer', gp.is_organizer))
        from occasion_group_plan_participants gp join profiles pr on pr.id = gp.user_id
        where gp.group_plan_id = v_group.id and gp.user_id is not null), '[]'::jsonb) end,
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
