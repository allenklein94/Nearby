-- Owner decisions 2026-10-22/23 (Google compliance follow-up, PRODUCT_AUDIT/GOOGLE_MAPS_COMPLIANCE_AUDIT_2026-10-22.md section 4):
-- before 2026-10-22, tapping a Google venue in Create stored Google's coordinates as the gathering's point, and which older
-- gatherings came from that path was never recorded. Their points are cleared, the gatherings and their relationships kept.
--   - NO coordinate backup (owner: another copy would defeat the purpose). private.legacy_location_cleanup keeps only
--     non-location metadata to audit and recover the affected records (no client access).
--   - Every copy is cleared: gatherings.precise_lat/lng, area (2-decimal), wide_area (1-decimal), plans.location_lat/lng of the
--     plans made from them. A business request made for such a gathering holds the point in NOT NULL columns, so it is
--     deleted (owner: test data; its plan and history go with it by cascade), its non-location fields kept in the log (never
--     its typed text or note: the 180-day raw-text purge must not be bypassed).
--   - The point-move trigger (20270334) no longer labels a cleared point 'host_pin': a missing point has no source and no
--     place ID (and a check now refuses a source without a point).
--   - notify_gathering_updated no longer treats a cleared area as an update: no "was updated" push for this cleanup.
--   - Only past gatherings can be cleared (the function refuses an upcoming one), so no gathering without a point can reach
--     location-dependent discovery (every nearby/distance/trending read is upcoming-only and skips a missing point).
--   - Permanent (owner, 2026-10-23): a gathering's plan no longer copies its point. Nothing reads plans.location_lat/lng for a
--     gathering plan (plans read the live gathering, 20270254; the meet-up point is get_gathering_meetup_point), and the copy
--     outlived a deleted gathering (ON DELETE SET NULL). Business-request plans unchanged.
-- area becomes nullable (a cleared gathering has none); a point still needs its area.

create table if not exists private.legacy_location_cleanup (
  id bigint generated always as identity primary key,
  object_kind text not null check (object_kind in ('gathering', 'gathering_plan', 'business_request', 'business_request_plan')),
  object_id uuid not null,
  action text not null check (action in ('cleared', 'deleted')),
  cleared_columns text[] not null,
  metadata jsonb not null,
  reason text not null,
  done_at timestamptz not null default now()
);
revoke all on table private.legacy_location_cleanup from public, anon, authenticated;

alter table public.gatherings alter column area drop not null;
alter table public.gatherings drop constraint if exists gatherings_point_needs_area;
alter table public.gatherings add constraint gatherings_point_needs_area
  check (area is not null or (precise_lat is null and precise_lng is null));
alter table public.gatherings drop constraint if exists gatherings_location_source_needs_point;
alter table public.gatherings add constraint gatherings_location_source_needs_point
  check (location_source is null or (precise_lat is not null and precise_lng is not null));

create or replace function public._gathering_location_provenance_on_move()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.precise_lat is distinct from old.precise_lat or new.precise_lng is distinct from old.precise_lng then
    if new.precise_lat is null and new.precise_lng is null then
      -- a cleared point has no source and no place ID
      new.location_source := null;
      new.google_place_id := null;
    elsif new.location_source is not distinct from old.location_source then
      new.location_source := 'host_pin';
      new.google_place_id := null;
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.notify_gathering_updated()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  recipient record;
  time_changed boolean;
begin
  time_changed := old.scheduled_at is distinct from new.scheduled_at;

  -- a cleared area (20270338: a point removed by Nearby, never a host edit) is not an update anyone is told about
  if not time_changed and old.title = new.title
     and (old.area is not distinct from new.area or new.area is null) then
    return new;
  end if;


  for recipient in
    select gi.user_id from gathering_interest gi
     where gi.gathering_id = new.id and gi.status = 'approved'
    union
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = new.id
       and new.scheduled_at >= now()
       and not exists (select 1 from blocks b
                        where (b.blocker_id = new.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = new.host_id))
  loop
    if coalesce((select notify_planning from profiles where id = recipient.user_id), true) then
      perform public._send_push(recipient.user_id, 'Gathering Updated', case
            when time_changed then '"' || new.title || '" changed to a new time — tap to see details.'
            else '"' || new.title || '" was updated — tap to see details.'
          end, jsonb_build_object('type', 'gathering_updated', 'gathering_id', new.id));
    end if;
  end loop;

  return new;
end;
$function$;

create or replace function public.create_plan_from_gathering()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_plan_type text;
begin
  v_plan_type := case when new.party_type = 'friends' then 'friend_hangout' else 'gathering' end;

  -- no copy of the gathering's point (20270338): the gathering is the one location source
  insert into public.plans (
    plan_type, created_by, title, scheduled_at,
    party_size, status, resulting_gathering_id
  ) values (
    v_plan_type, new.host_id, new.title, new.scheduled_at,
    new.capacity, 'confirmed', new.id
  );
  return new;
end;
$function$;

-- Clears every stored copy of these gatherings' points. Only past gatherings whose point has no recorded source.
create or replace function private.clear_unverified_gathering_points(p_ids uuid[], p_reason text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_ids uuid[];
  v_req_ids uuid[];
  v_gatherings int;
  v_plans int;
  v_requests int;
  v_request_plans int;
begin
  select array_agg(id) into v_ids from gatherings where id = any(p_ids);
  if coalesce(cardinality(v_ids), 0) <> coalesce(cardinality(p_ids), 0) then
    raise exception 'Unknown gathering in the list';
  end if;
  if v_ids is null then
    return jsonb_build_object('gatherings', 0, 'gathering_plans', 0, 'business_requests', 0, 'business_request_plans', 0);
  end if;
  if exists (select 1 from gatherings where id = any(v_ids) and scheduled_at >= now()) then
    raise exception 'Only past gatherings can have their point cleared';
  end if;
  if exists (select 1 from gatherings where id = any(v_ids) and (location_source is not null or google_place_id is not null)) then
    raise exception 'Only points with no recorded source are cleared';
  end if;

  select array_agg(id) into v_req_ids from business_requests where gathering_id = any(v_ids);

  insert into private.legacy_location_cleanup (object_kind, object_id, action, cleared_columns, metadata, reason)
  select 'business_request_plan', p.id, 'deleted', array['location_lat', 'location_lng', 'location_label'],
         -- title = the request's typed text (create_plan_from_business_request), so it is left out too
         to_jsonb(p) - array['location_lat', 'location_lng', 'location_label', 'title'], p_reason
    from plans p where p.resulting_business_request_id = any(v_req_ids);
  get diagnostics v_request_plans = row_count;

  insert into private.legacy_location_cleanup (object_kind, object_id, action, cleared_columns, metadata, reason)
  select 'business_request', r.id, 'deleted', array['latitude', 'longitude', 'area_key'],
         to_jsonb(r) - array['latitude', 'longitude', 'area_key', 'raw_text', 'note_for_business'], p_reason
    from business_requests r where r.id = any(v_req_ids);
  get diagnostics v_requests = row_count;
  delete from business_requests where id = any(v_req_ids);

  insert into private.legacy_location_cleanup (object_kind, object_id, action, cleared_columns, metadata, reason)
  select 'gathering_plan', p.id, 'cleared', array['location_lat', 'location_lng', 'location_label'],
         jsonb_build_object('gathering_id', p.resulting_gathering_id, 'created_by', p.created_by), p_reason
    from plans p
   where p.resulting_gathering_id = any(v_ids)
     and (p.location_lat is not null or p.location_lng is not null or p.location_label is not null);
  get diagnostics v_plans = row_count;
  update plans set location_lat = null, location_lng = null, location_label = null
   where resulting_gathering_id = any(v_ids)
     and (location_lat is not null or location_lng is not null or location_label is not null);

  insert into private.legacy_location_cleanup (object_kind, object_id, action, cleared_columns, metadata, reason)
  select 'gathering', g.id, 'cleared', array['precise_lat', 'precise_lng', 'area', 'wide_area'],
         jsonb_build_object('host_id', g.host_id, 'title', g.title, 'created_at', g.created_at, 'scheduled_at', g.scheduled_at,
                            'approved_attendees', (select count(*) from gathering_interest gi
                                                    where gi.gathering_id = g.id and gi.status = 'approved')), p_reason
    from gatherings g where g.id = any(v_ids);
  get diagnostics v_gatherings = row_count;
  update gatherings
     set precise_lat = null, precise_lng = null, area = null, wide_area = null, location_source = null, google_place_id = null
   where id = any(v_ids);

  return jsonb_build_object('gatherings', v_gatherings, 'gathering_plans', v_plans,
                            'business_requests', v_requests, 'business_request_plans', v_request_plans);
end;
$function$;

revoke all on function private.clear_unverified_gathering_points(uuid[], text) from public, anon, authenticated;

-- The production cleanup: past gatherings created before the provenance work (2026-10-22) whose point has no source.
-- Production had exactly 26 (all test accounts, owner-approved 2026-10-23); more means something changed, so stop.
do $$
declare
  v_ids uuid[];
  v_result jsonb;
begin
  select array_agg(id) into v_ids from gatherings
   where location_source is null and google_place_id is null
     and (precise_lat is not null or precise_lng is not null)
     and created_at < '2026-10-22' and scheduled_at < now();
  if coalesce(cardinality(v_ids), 0) > 26 then
    raise exception 'Expected at most 26 legacy gatherings, found %', cardinality(v_ids);
  end if;
  v_result := private.clear_unverified_gathering_points(coalesce(v_ids, '{}'),
    '20270338: point possibly Google-derived (pre-provenance Create venue tap), cleared per owner 2026-10-23');
  raise notice 'legacy gathering points cleared: %', v_result;
end $$;
