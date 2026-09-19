-- Experience plans: "Make it a night" -> the person picks one item per component -> ONE Plan holding the chosen stops in order.
-- A `plans` row of type 'experience' (thin wrapper, like every other plan) + ordered `plan_stops`. No new business-side concept:
-- each stop points at REAL existing supply (an active business_availability posting or a gathering); titles and partner ids are
-- resolved server-side, never trusted from the client. No date/time is invented (scheduled_at stays null), no reservation is
-- created here -- each stop continues through the existing per-supply flow (ask -> offer -> accept -> booked).

alter table public.plans drop constraint if exists plans_plan_type_check;
alter table public.plans add constraint plans_plan_type_check check (plan_type = any (array[
  'dating_date','friend_hangout','gathering','birthday','anniversary','business_request',
  'occasion','group_occasion','dating_match','friend_match','experience']));

create table if not exists public.plan_stops (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  sort_order integer not null check (sort_order between 1 and 6),
  component_key text not null,
  component_label text not null,
  stop_type text not null check (stop_type in ('business_availability', 'gathering')),
  ref_id uuid not null,
  partner_id uuid references public.brand_partners(id) on delete set null,
  title text not null,
  subtitle text,
  category text,
  created_at timestamptz not null default now(),
  unique (plan_id, sort_order)
);
create index if not exists plan_stops_plan_idx on public.plan_stops(plan_id);
alter table public.plan_stops enable row level security;
revoke all on public.plan_stops from public, anon, authenticated;
-- Reads go through get_plan_stops (view-checked); no direct table access.

create or replace function public.create_experience_plan(title_param text, stops_param jsonb, party_size_param integer default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan uuid;
  v_stop jsonb;
  v_ord integer := 0;
  v_type text;
  v_ref uuid;
  v_title text;
  v_subtitle text;
  v_partner uuid;
  v_category text;
  v_seen_components text[] := array[]::text[];
  v_component text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(stops_param) is distinct from 'array' then raise exception 'stops must be a list'; end if;
  if jsonb_array_length(stops_param) < 2 or jsonb_array_length(stops_param) > 6 then
    raise exception 'An experience needs between 2 and 6 stops';
  end if;
  if party_size_param is not null and (party_size_param < 1 or party_size_param > 500) then
    raise exception 'Invalid party size';
  end if;

  insert into public.plans (plan_type, created_by, title, party_size, status)
  values ('experience', v_uid, left(nullif(trim(coalesce(title_param, '')), ''), 80), party_size_param, 'draft')
  returning id into v_plan;

  for v_stop in select * from jsonb_array_elements(stops_param) loop
    v_ord := v_ord + 1;
    v_type := v_stop->>'stop_type';
    v_component := left(coalesce(v_stop->>'component_key', ''), 40);
    if v_component = '' or v_component = any(v_seen_components) then
      raise exception 'Each stop must be a different part of the experience';
    end if;
    v_seen_components := v_seen_components || v_component;
    begin
      v_ref := (v_stop->>'ref_id')::uuid;
    exception when others then raise exception 'Invalid stop';
    end;

    if v_type = 'business_availability' then
      select coalesce(ba.title, bp.name), bp.name, ba.partner_id, ba.category
        into v_title, v_subtitle, v_partner, v_category
      from public.business_availability ba
      join public.brand_partners bp on bp.id = ba.partner_id
      where ba.id = v_ref and ba.status = 'active' and ba.ends_at > now() and bp.active = true
        and (ba.remaining_capacity is null or ba.remaining_capacity > 0);
      if not found then raise exception 'That option is no longer available'; end if;
    elsif v_type = 'gathering' then
      select g.title, null, null, g.interest_tag into v_title, v_subtitle, v_partner, v_category
      from public.gatherings g where g.id = v_ref;
      if not found then raise exception 'That gathering no longer exists'; end if;
    else
      raise exception 'Unsupported stop type';
    end if;

    insert into public.plan_stops (plan_id, sort_order, component_key, component_label, stop_type, ref_id, partner_id, title, subtitle, category)
    values (v_plan, v_ord, v_component, left(coalesce(nullif(trim(v_stop->>'component_label'), ''), v_component), 60),
            v_type, v_ref, v_partner, v_title, v_subtitle, v_category);
  end loop;
  return v_plan;
end;
$$;

create or replace function public.get_plan_stops(plan_id_param uuid)
returns table (id uuid, sort_order integer, component_key text, component_label text, stop_type text, ref_id uuid,
               partner_id uuid, title text, subtitle text, category text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.sort_order, s.component_key, s.component_label, s.stop_type, s.ref_id, s.partner_id, s.title, s.subtitle, s.category
  from public.plan_stops s
  where s.plan_id = plan_id_param and public._can_view_plan(plan_id_param, auth.uid())
  order by s.sort_order;
$$;

revoke all on function public.create_experience_plan(text, jsonb, integer) from public, anon;
revoke all on function public.get_plan_stops(uuid) from public, anon;
grant execute on function public.create_experience_plan(text, jsonb, integer) to authenticated;
grant execute on function public.get_plan_stops(uuid) to authenticated;
