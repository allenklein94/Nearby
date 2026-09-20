-- Item 71: a host can change a gathering's maximum attendees after creating it. Raising (or removing) the limit promotes
-- the waitlist through the SAME helper as every other freed spot (approval-required gatherings turn them into pending
-- requests, otherwise they are approved); lowering below the people already attending is refused (the host removes
-- someone first, deliberately). Host-only, upcoming gatherings only.
create or replace function public.set_gathering_capacity(gathering_id_param uuid, capacity_param integer)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_host uuid; v_scheduled timestamptz; v_old integer;
  v_approved integer; v_waiting integer; v_promoted integer := 0; v_p jsonb; v_i integer := 0;
begin
  if capacity_param is not null and capacity_param < 1 then
    raise exception 'A gathering needs room for at least 1 person.';
  end if;
  select host_id, scheduled_at, capacity into v_host, v_scheduled, v_old
    from gatherings where id = gathering_id_param for update;
  if v_host is null then raise exception 'Gathering not found'; end if;
  if v_host is distinct from auth.uid() then raise exception 'Only the host can do this'; end if;
  if v_scheduled < now() then raise exception 'This gathering has already happened'; end if;

  select count(*) filter (where status = 'approved'), count(*) filter (where status = 'waitlisted')
    into v_approved, v_waiting from gathering_interest where gathering_id = gathering_id_param;
  if capacity_param is not null and capacity_param < v_approved then
    raise exception '% people are already attending. Remove someone first, or choose % or more.', v_approved, v_approved;
  end if;
  if v_old is not distinct from capacity_param then
    return jsonb_build_object('capacity', capacity_param, 'promoted', 0);
  end if;

  -- "No limit": the promotion helper works from a number, so hold the room open just long enough to seat everyone waiting.
  update gatherings set capacity = coalesce(capacity_param, (select count(*) from gathering_interest where gathering_id = gathering_id_param) + 1) where id = gathering_id_param;
  loop
    v_p := public._promote_from_waitlist(gathering_id_param);
    exit when v_p is null or v_i >= 200;
    v_promoted := v_promoted + 1; v_i := v_i + 1;
  end loop;
  if capacity_param is null then
    update gatherings set capacity = null where id = gathering_id_param;
  end if;
  return jsonb_build_object('capacity', capacity_param, 'promoted', v_promoted);
end;
$fn$;
revoke all on function public.set_gathering_capacity(uuid, integer) from public, anon;
grant execute on function public.set_gathering_capacity(uuid, integer) to authenticated;
