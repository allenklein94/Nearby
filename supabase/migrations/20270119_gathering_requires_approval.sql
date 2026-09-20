-- Who can join? A gathering is Anyone (default: one tap, auto-approved, as public gatherings already were) or
-- Require approval (host reviews each request). `requires_approval` layers on the existing rule: a non-public
-- (invite-only) gathering still goes to host review; capacity still waitlists first. Also gives the host the missing
-- half of moderation: decline a pending/waitlisted request or remove an attendee.
alter table public.gatherings add column if not exists requires_approval boolean not null default false;

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
  if v_capacity is not null and v_approved_count >= v_capacity then
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

-- Host declines a request or removes an attendee (pending / waitlisted / approved). Deleting the row is enough: the
-- person can no longer see the gathering's attendee-only content, and blocks still prevent a re-request. Removing an
-- approved attendee from a full gathering promotes the earliest waitlisted person, exactly like leave_gathering.
-- A declined (not-yet-approved) requester gets a neutral push; a removed attendee gets none (no confrontation).
create or replace function public.host_remove_gathering_attendee(interest_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row gathering_interest%rowtype;
  v_host uuid; v_capacity integer; v_title text; v_scheduled timestamptz;
  v_promoted_id uuid; v_promoted_user uuid; v_service_key text;
begin
  select * into v_row from gathering_interest where id = interest_id_param;
  if not found then raise exception 'Request not found'; end if;
  select host_id, capacity, title, scheduled_at into v_host, v_capacity, v_title, v_scheduled
    from gatherings where id = v_row.gathering_id for update;
  if v_host is distinct from auth.uid() then raise exception 'Only the host can do this'; end if;
  if v_scheduled < now() then raise exception 'This gathering has already happened'; end if;

  delete from gathering_interest where id = interest_id_param;

  if v_row.status = 'approved' and v_capacity is not null then
    select id into v_promoted_id from gathering_interest
     where gathering_id = v_row.gathering_id and status = 'waitlisted' order by created_at asc limit 1 for update;
    if v_promoted_id is not null then
      update gathering_interest set status = 'approved' where id = v_promoted_id returning user_id into v_promoted_user;
      insert into matches (user_a, user_b, source_gathering_id)
      values (least(v_host, v_promoted_user), greatest(v_host, v_promoted_user), v_row.gathering_id)
      on conflict (user_a, user_b) do update set source_gathering_id = v_row.gathering_id
        where matches.source_gathering_id is null;
    end if;
  end if;

  if v_row.status <> 'approved'
     and coalesce((select notify_planning from profiles where id = v_row.user_id), true) then
    select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_row.user_id,
        'title', 'Update on your request',
        'body', 'The host couldn''t approve your request to join "' || v_title || '".',
        'data', jsonb_build_object('type', 'gathering_updated', 'gathering_id', v_row.gathering_id)
      )
    );
  end if;
  return jsonb_build_object('removed', true, 'promoted_user_id', v_promoted_user);
end;
$fn$;
revoke all on function public.host_remove_gathering_attendee(uuid) from public, anon;
grant execute on function public.host_remove_gathering_attendee(uuid) to authenticated;
