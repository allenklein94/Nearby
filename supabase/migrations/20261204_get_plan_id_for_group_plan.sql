-- Lets an invited participant (not just the host) open the Plan detail for a group occasion plan. plans RLS is
-- creator-only, so the client can't look the plans row up directly; this returns only the plan's id, and only to the
-- host/participants of that group plan (is_occasion_group_plan_participant). get_plan_overview then does its own access check.
create or replace function public.get_plan_id_for_group_plan(group_plan_id_param uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id from plans p
  where p.occasion_group_plan_id = group_plan_id_param
    and is_occasion_group_plan_participant(group_plan_id_param, auth.uid());
$$;

revoke all on function public.get_plan_id_for_group_plan(uuid) from public, anon;
grant execute on function public.get_plan_id_for_group_plan(uuid) to authenticated, service_role;
