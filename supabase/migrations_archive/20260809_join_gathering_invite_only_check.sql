-- Closes a real, previously-accepted-risk gap: join_gathering() never read
-- gatherings.visibility at all, so an invite_only gathering fell through to
-- the same branch as any other host-approval gathering (is_public is false
-- there too) — a stranger who was never invited could still land a real
-- 'pending' row in the host's approval queue by calling the RPC directly,
-- since only the client UI gated the Join button, not the RPC itself. See
-- CLAUDE.md's "Relationship hub consolidation + invite-only join hardening"
-- section for the full context this was found and closed under.
--
-- Community privacy was checked at the same time and needs no equivalent
-- fix: community_members' real INSERT policy already requires
-- (is_public = true OR creator_id = auth.uid()) server-side.

create or replace function public.join_gathering(gathering_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_host_id uuid;
  v_is_public boolean;
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
  select host_id, is_public, women_only, capacity, visibility
  into v_host_id, v_is_public, v_women_only, v_capacity, v_visibility
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

  -- At/over capacity always waitlists, regardless of public/host-approval —
  -- "no spot available" is the same fact either way. Under capacity keeps
  -- today's exact behavior: public auto-approves, host-approval stays
  -- pending for the host to review.
  if v_capacity is not null and v_approved_count >= v_capacity then
    v_status := 'waitlisted';
  elsif v_is_public then
    v_status := 'approved';
  else
    v_status := 'pending';
  end if;

  insert into gathering_interest (gathering_id, user_id, status)
  values (gathering_id_param, v_user_id, v_status)
  on conflict (gathering_id, user_id) do nothing;
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    -- Already had an active request (pending/approved/waitlisted) —
    -- idempotent, return their existing status rather than erroring.
    select status into v_status from gathering_interest
    where gathering_id = gathering_id_param and user_id = v_user_id;
    return jsonb_build_object('status', v_status, 'match_id', null);
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

revoke all on function public.join_gathering(uuid) from public, anon;
grant execute on function public.join_gathering(uuid) to authenticated;
