-- Capacity means TOTAL people in the gathering, INCLUDING the host, everywhere (owner decision 2026-09-26).
-- Before this, the join/approve/waitlist/set-capacity functions compared approved GUESTS against capacity (the host is never a
-- gathering_interest row), so a capacity-4 gathering held 5 people, while Create labelled it "2-4 people" and
-- _gathering_party_size / the plan trigger already read it as the total. The column is unchanged (no gathering in production has
-- a capacity set, so no data is rewritten); the guest limit is derived in ONE place: _gathering_guest_limit = capacity - 1.
-- capacity 1 = the host alone (every join waitlists). Bodies patched from the live definitions; signatures unchanged.

create or replace function public._gathering_guest_limit(capacity_param integer)
returns integer language sql immutable set search_path = public
as $$ select case when capacity_param is null then null else greatest(capacity_param - 1, 0) end $$;
revoke all on function public._gathering_guest_limit(integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_gathering(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host_id uuid;
  v_is_public boolean;
  v_requires_approval boolean;
  v_women_only boolean;
  v_capacity integer;
  v_visibility text;
  v_user_id uuid := auth.uid();
  v_gender text;
  v_is_blocked boolean;
  v_has_invite boolean;
  v_approved_count integer;
  v_status text;
  v_new_match_id uuid;
  v_row_count integer;
begin
  -- Locks the gathering row so two concurrent joiners can't both read
  -- "one spot left" and both get approved.
  select host_id, is_public, women_only, capacity, visibility, requires_approval
  into v_host_id, v_is_public, v_women_only, v_capacity, v_visibility, v_requires_approval
  from gatherings where id = gathering_id_param for update;

  if v_host_id is null then
    raise exception 'Gathering not found';
  end if;
  if v_host_id = v_user_id then
    raise exception 'Cannot express interest in your own gathering';
  end if;

  if v_visibility = 'invite_only' then
    select exists(
      select 1 from social_invites
      where invite_type = 'gathering'
        and target_id = gathering_id_param
        and invitee_id = v_user_id
        and status = 'accepted'
    ) into v_has_invite;
    if not v_has_invite then
      raise exception 'This gathering is invite-only. Ask the host for an invite.';
    end if;
  end if;

  if v_women_only then
    select gender into v_gender from profiles where id = v_user_id;
    if lower(coalesce(v_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_user_id)
    or (blocker_id = v_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot express interest in this gathering';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';

  -- At/over capacity always waitlists, regardless of public/host-approval --
  -- "no spot available" is the same fact either way. Under capacity keeps
  -- today's exact behavior: public auto-approves, host-approval stays
  -- pending for the host to review.
  if v_capacity is not null and v_approved_count >= public._gathering_guest_limit(v_capacity) then
    v_status := 'waitlisted';
  elsif v_is_public and not coalesce(v_requires_approval, false) then
    v_status := 'approved';
  else
    v_status := 'pending';
  end if;

  insert into gathering_interest (gathering_id, user_id, status)
  values (gathering_id_param, v_user_id, v_status)
  on conflict (gathering_id, user_id) do nothing;
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    -- Already had an active request (pending/approved/waitlisted) --
    -- idempotent, return their existing status rather than erroring.
    -- If that existing status is already 'approved', a real match was
    -- already created the first time -- look it up instead of a
    -- hardcoded null, so a retried/double-tapped call reports the
    -- real match_id it already has, not a false "no match" answer.
    select status into v_status from gathering_interest
    where gathering_id = gathering_id_param and user_id = v_user_id;
    if v_status = 'approved' then
      select id into v_new_match_id from matches
      where user_a = least(v_host_id, v_user_id) and user_b = greatest(v_host_id, v_user_id);
    end if;
    return jsonb_build_object('status', v_status, 'match_id', v_new_match_id);
  end if;

  if v_status = 'approved' then
    insert into matches (user_a, user_b, source_gathering_id)
    values (least(v_host_id, v_user_id), greatest(v_host_id, v_user_id), gathering_id_param)
    on conflict (user_a, user_b) do update
      set source_gathering_id = gathering_id_param
      where matches.source_gathering_id is null
    returning id into v_new_match_id;
    if v_new_match_id is null then
      select id into v_new_match_id from matches
      where user_a = least(v_host_id, v_user_id) and user_b = greatest(v_host_id, v_user_id);
    end if;
  end if;

  return jsonb_build_object('status', v_status, 'match_id', v_new_match_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_gathering_interest(interest_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gathering_id uuid;
  v_interested_user_id uuid;
  v_current_status text;
  v_host_id uuid;
  v_women_only boolean;
  v_capacity integer;
  v_scheduled timestamptz;
  v_interested_gender text;
  v_new_match_id uuid;
  v_is_blocked boolean;
  v_approved_count integer;
begin
  select gathering_id, user_id, status into v_gathering_id, v_interested_user_id, v_current_status
  from gathering_interest where id = interest_id for update;

  if v_gathering_id is null then
    raise exception 'Interest request not found';
  end if;
  if v_current_status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  select host_id, women_only, capacity, scheduled_at into v_host_id, v_women_only, v_capacity, v_scheduled
  from gatherings where id = v_gathering_id for update;

  if v_host_id != auth.uid() then
    raise exception 'Only the host can approve interest';
  end if;
  if v_scheduled < now() then
    raise exception 'This request has expired: the gathering has already happened';
  end if;
  if v_host_id = v_interested_user_id then
    raise exception 'Cannot match with yourself';
  end if;
  if v_women_only then
    select gender into v_interested_gender from profiles where id = v_interested_user_id;
    if lower(coalesce(v_interested_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_interested_user_id)
    or (blocker_id = v_interested_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot approve interest from a blocked user';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = v_gathering_id and status = 'approved';

  if v_capacity is not null and v_approved_count >= public._gathering_guest_limit(v_capacity) then
    update gathering_interest set status = 'waitlisted' where id = interest_id;
    return jsonb_build_object('status', 'waitlisted', 'match_id', null);
  end if;

  update gathering_interest set status = 'approved' where id = interest_id;
  insert into matches (user_a, user_b, source_gathering_id)
  values (least(v_host_id, v_interested_user_id), greatest(v_host_id, v_interested_user_id), v_gathering_id)
  on conflict (user_a, user_b) do update
    set source_gathering_id = v_gathering_id
    where matches.source_gathering_id is null
  returning id into v_new_match_id;
  if v_new_match_id is null then
    select id into v_new_match_id from matches
    where user_a = least(v_host_id, v_interested_user_id) and user_b = greatest(v_host_id, v_interested_user_id);
  end if;
  return jsonb_build_object('status', 'approved', 'match_id', v_new_match_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public._promote_from_waitlist(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host uuid; v_capacity integer; v_needs_approval boolean;
  v_approved integer; v_pending integer;
  v_next uuid; v_next_user uuid;
begin
  select host_id, capacity, (not coalesce(is_public, true)) or coalesce(requires_approval, false)
    into v_host, v_capacity, v_needs_approval
    from gatherings where id = gathering_id_param;
  if v_host is null or v_capacity is null then return null; end if;

  select count(*) filter (where status = 'approved'), count(*) filter (where status = 'pending')
    into v_approved, v_pending
    from gathering_interest where gathering_id = gathering_id_param;
  if v_approved >= public._gathering_guest_limit(v_capacity) then return null; end if;
  if v_needs_approval and v_approved + v_pending >= public._gathering_guest_limit(v_capacity) then return null; end if;

  select id into v_next from gathering_interest
   where gathering_id = gathering_id_param and status = 'waitlisted'
   order by created_at asc limit 1 for update;
  if v_next is null then return null; end if;

  if v_needs_approval then
    update gathering_interest set status = 'pending' where id = v_next returning user_id into v_next_user;
    return jsonb_build_object('user_id', v_next_user, 'status', 'pending');
  end if;

  update gathering_interest set status = 'approved' where id = v_next returning user_id into v_next_user;
  insert into matches (user_a, user_b, source_gathering_id)
  values (least(v_host, v_next_user), greatest(v_host, v_next_user), gathering_id_param)
  on conflict (user_a, user_b) do update set source_gathering_id = gathering_id_param
    where matches.source_gathering_id is null;
  return jsonb_build_object('user_id', v_next_user, 'status', 'approved');
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_gathering_capacity(gathering_id_param uuid, capacity_param integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- capacity is TOTAL people including the host, so it must hold every approved guest plus the host.
  if capacity_param is not null and capacity_param < v_approved + 1 then
    raise exception '% people are already going, including you. Remove someone first, or choose % or more.', v_approved + 1, v_approved + 1;
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
$function$;
