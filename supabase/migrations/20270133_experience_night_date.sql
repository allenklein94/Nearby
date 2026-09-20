-- Experience plans: ONE date for the whole night (owner-set, deterministic; never inferred).
--
-- Stored in the existing plans.scheduled_at as noon UTC of the chosen calendar date, so the plan overview (which already
-- returns scheduled_at) shows the right day in every timezone; the date is read back as the UTC date. Nothing else is
-- scheduled: each stop's request just starts from this date (client prefill, still editable per stop), no per-stop times are
-- invented and stop order carries no scheduling meaning. Owner-only, live nights only (draft/confirmed). NULL clears it.
-- Viewers (friends/matches and guest links) get the date in their existing narrow projection as 'nightDate'.

create or replace function public.set_experience_night_date(plan_id_param uuid, date_param date)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_plan plans%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into v_plan from plans
   where id = plan_id_param and created_by = v_uid and plan_type = 'experience' for update;
  if not found then raise exception 'Night not found'; end if;
  if v_plan.status not in ('draft', 'confirmed') then raise exception 'This night can no longer be changed'; end if;
  if date_param is not null and date_param < current_date - 1 then
    raise exception 'Pick a date that has not passed';
  end if;
  update plans
     set scheduled_at = case when date_param is null then null else (date_param::timestamp + interval '12 hours') at time zone 'UTC' end
   where id = v_plan.id;
  return true;
end;
$function$;
revoke all on function public.set_experience_night_date(uuid, date) from public, anon;

create or replace function public.get_shared_night(plan_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_plan plans%rowtype;
begin
  if v_uid is null then return null; end if;
  select p.* into v_plan from plans p
   where p.id = plan_id_param and p.plan_type = 'experience'
     and exists (select 1 from plan_shares s where s.plan_id = p.id and s.user_id = v_uid)
     and public._are_connected(p.created_by, v_uid);
  if not found then return null; end if;
  return jsonb_build_object(
    'planId', v_plan.id,
    'title', v_plan.title,
    'status', v_plan.status,
    'nightDate', (v_plan.scheduled_at at time zone 'UTC')::date,
    'hostDisplayName', (select display_name from profiles where id = v_plan.created_by),
    'stops', public._night_stops_json(v_plan.id)
  );
end;
$function$;

create or replace function public.get_public_shared_night(token_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'title', p.title,
    'status', p.status,
    'nightDate', (p.scheduled_at at time zone 'UTC')::date,
    'hostDisplayName', h.display_name,
    'guestName', s.guest_name,
    'expiresAt', s.expires_at,
    'stops', public._night_stops_json(p.id))
  into v_result
  from plan_shares s
  join plans p on p.id = s.plan_id and p.plan_type = 'experience'
  join profiles h on h.id = p.created_by
  where s.guest_token = token_param and s.user_id is null and (s.expires_at is null or s.expires_at > now());
  return v_result;
end;
$function$;
revoke all on function public.get_shared_night(uuid) from public, anon;
grant execute on function public.get_public_shared_night(uuid) to anon, authenticated;
