-- "Occasion architecture should not be a silo" (CLAUDE.md, direct user
-- request, 2026-09-12): the user asked for an Occasion entity with
-- occasion type / person being celebrated / date / participants /
-- preferences / plan / location / business / status / notifications, built
-- to reuse categories/people/gathering/intent/business/notification systems
-- rather than invent a parallel one. Auditing what's real today (occasions
-- + occasion_group_plans, both already reusing people/business/
-- notification systems) against that list found the entire model already
-- holds EXCEPT one real, concrete gap: once a celebration is actually acted
-- on (a real business_request or gathering gets created downstream, via
-- CelebrateSomethingScreen's existing hand-off), neither occasions nor
-- occasion_group_plans ever learns that happened. The unified `plans`
-- object (20260914_plans_unified_object.sql, "Phase G") already exists
-- precisely to be the one cross-system pointer for "what real thing did
-- this turn into" -- gatherings/business_requests/date_proposals already
-- populate it via triggers -- but nothing ever linked an Occasion to the
-- plans row its own downstream action produced. This migration closes
-- exactly that link, plus two smaller structural gaps the same audit found:
--
--   1. `occasions` gets `who_for_name`/`who_for_friend_id` -- the exact
--      same structured "person being celebrated" shape
--      occasion_group_plans already has (this table's own title column
--      currently conflates person+occasion as free text, e.g. "Mom's
--      Birthday", with no queryable field behind it).
--   2. `occasions` and `occasion_group_plans` both get `resulting_plan_id`
--      (a real FK into the existing `plans` table) + `occasions` also gets
--      `last_planned_at` -- an honest, derived-from-a-real-link "was this
--      acted on" signal, not a fabricated status enum with its own
--      separate lifecycle to keep in sync (this repo's own "no invented
--      signals" convention). `occasion_group_plans.status` gains a real
--      4th value, 'fulfilled', set the moment a real resulting plan is
--      linked -- safe to add for this table specifically since (unlike
--      the recurring `occasions` table) a group plan is a genuinely
--      one-time, non-recurring object.
--   3. Two new SECURITY DEFINER RPCs (link_occasion_to_plan /
--      link_occasion_group_plan_to_plan) do the actual linking -- each
--      looks up the real `plans` row the existing triggers already
--      created for whichever resulting gathering/business_request id the
--      client passes, and is a no-op (not an error) if that row isn't
--      found yet, since this is always called best-effort/non-blocking
--      from the client right after the real creation call succeeds.
--
-- "preferences" (the user's own listed field) is deliberately NOT given
-- its own stored column here -- it's already served by the existing,
-- shared intent-resolver scoring system (favoriteBusinessBonus/
-- pastPlanBonus/attributeAndCuisineBonus/occasionBonus in
-- intentResolverScoring.js), which is exactly the "reuse the existing
-- system, don't build a second one" instruction this whole change is
-- following. "location"/"business" are likewise deliberately not stored
-- directly on the occasion -- they already live on whichever real
-- gathering/business_request the linked plans row points to; duplicating
-- them here would be exactly the kind of second copy that drifts.

alter table public.occasions
  add column if not exists who_for_name text,
  add column if not exists who_for_friend_id uuid references public.profiles(id) on delete set null,
  add column if not exists resulting_plan_id uuid references public.plans(id) on delete set null,
  add column if not exists last_planned_at timestamptz;

alter table public.occasion_group_plans
  add column if not exists resulting_plan_id uuid references public.plans(id) on delete set null;

alter table public.occasion_group_plans drop constraint if exists occasion_group_plans_status_check;
alter table public.occasion_group_plans
  add constraint occasion_group_plans_status_check
  check (status in ('voting', 'decided', 'cancelled', 'fulfilled'));

-- Old 1-arg signature is being replaced with a wider RETURNS TABLE column
-- list -- explicit drop first, per this repo's own standing
-- CREATE OR REPLACE gotcha (a column-list change creates a second overload
-- rather than replacing the original).
drop function if exists public.get_upcoming_occasions(integer);

create or replace function public.get_upcoming_occasions(days_ahead_param integer default 30)
returns table(
  occasion_id uuid,
  owner_id uuid,
  owner_display_name text,
  connected_user_id uuid,
  occasion_type text,
  title text,
  who_for_name text,
  who_for_friend_id uuid,
  occasion_date date,
  days_until integer,
  resulting_plan_id uuid,
  last_planned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  r record;
  v_year int;
  v_month int;
  v_day int;
  v_next_date date;
  v_days_until int;
begin
  if v_caller is null then
    return;
  end if;

  for r in
    select o.id, o.user_id, p.display_name as owner_display_name, o.connected_user_id,
           o.occasion_type, o.title, o.who_for_name, o.who_for_friend_id,
           o.occasion_date, o.recurs_annually, o.resulting_plan_id, o.last_planned_at
    from occasions o
    join profiles p on p.id = o.user_id
    where o.user_id = v_caller
       or (
         o.connected_user_id = v_caller
         and (
           exists (
             select 1 from friendships f
             where f.status = 'accepted'
               and ((f.user_a = v_caller and f.user_b = o.user_id) or (f.user_b = v_caller and f.user_a = o.user_id))
           )
           or exists (
             select 1 from matches m
             where (m.user_a = v_caller and m.user_b = o.user_id) or (m.user_b = v_caller and m.user_a = o.user_id)
           )
         )
       )
  loop
    if r.recurs_annually then
      v_year := extract(year from current_date)::int;
      v_month := extract(month from r.occasion_date)::int;
      v_day := extract(day from r.occasion_date)::int;

      begin
        v_next_date := make_date(v_year, v_month, v_day);
      exception when others then
        v_next_date := make_date(v_year, 2, 28);
      end;

      if v_next_date < current_date then
        begin
          v_next_date := make_date(v_year + 1, v_month, v_day);
        exception when others then
          v_next_date := make_date(v_year + 1, 2, 28);
        end;
      end if;

      v_days_until := v_next_date - current_date;
    else
      v_next_date := r.occasion_date;
      v_days_until := v_next_date - current_date;
      if v_days_until < 0 then
        continue;
      end if;
    end if;

    if v_days_until between 0 and days_ahead_param then
      occasion_id := r.id;
      owner_id := r.user_id;
      owner_display_name := r.owner_display_name;
      connected_user_id := r.connected_user_id;
      occasion_type := r.occasion_type;
      title := r.title;
      who_for_name := r.who_for_name;
      who_for_friend_id := r.who_for_friend_id;
      occasion_date := v_next_date;
      days_until := v_days_until;
      resulting_plan_id := r.resulting_plan_id;
      last_planned_at := r.last_planned_at;
      return next;
    end if;
  end loop;

  return;
end;
$$;

revoke all on function public.get_upcoming_occasions(integer) from public, anon;
grant execute on function public.get_upcoming_occasions(integer) to authenticated;

-- ---- Linking RPCs ----

-- Best-effort, called right after the client's own real create call
-- (submitBusinessRequest / createGathering) already succeeded -- looks up
-- the plans row the existing on_business_request_created_make_plan /
-- on_gathering_created_make_plan triggers already created for that exact
-- resulting id. A caller who passes an id with no matching plans row yet
-- (a genuine race, or a stale/foreign id) gets a quiet no-op, never an
-- error -- this is metadata enrichment, not a required step in the real
-- creation flow.
create or replace function public.link_occasion_to_plan(
  occasion_id_param uuid,
  resulting_gathering_id_param uuid default null,
  resulting_business_request_id_param uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  end if;
end;
$function$;

revoke all on function public.link_occasion_to_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_occasion_to_plan(uuid, uuid, uuid) to authenticated;

-- Any real joined participant may link (not host-only) -- matches this
-- object's own existing multi-actor shape, where any joined participant
-- (not just the host) can independently re-enter CelebrateSomethingScreen
-- from the decided card and submit their own business requests. Only
-- fires the status transition to 'fulfilled' from 'decided' -- a
-- 'cancelled' plan can never be linked (there's nothing left to fulfill).
create or replace function public.link_occasion_group_plan_to_plan(
  group_plan_id_param uuid,
  resulting_gathering_id_param uuid default null,
  resulting_business_request_id_param uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  end if;
end;
$function$;

revoke all on function public.link_occasion_group_plan_to_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_occasion_group_plan_to_plan(uuid, uuid, uuid) to authenticated;
