-- Temporal rule for the two remaining invitation/request state machines
-- (2026-09-20), same as social_invites (20270125): a past event can be
-- viewed but not accepted, and a missed invite is "expired", not "declined".
--
-- 1. Gathering join requests: the host can no longer approve a pending
--    request on a gathering that has already happened. (No stored status:
--    a pending request on a past gathering is displayed "expired" by the
--    client; join_gathering already refused past gatherings.)
-- 2. Occasion group-plan invites (member + guest link): accepting a plan
--    whose date has passed is refused; dismissing records 'expired'.
--    scheduled_date is a plain date, so a plan only expires once that date
--    has ended in EVERY timezone (UTC - 12h), never early for the people on
--    the day itself. No date = never expires.

alter table public.occasion_group_plan_participants
  drop constraint if exists occasion_group_plan_participants_status_check;
alter table public.occasion_group_plan_participants
  add constraint occasion_group_plan_participants_status_check
  check (status in ('invited', 'joined', 'declined', 'expired'));

create or replace function public._occasion_plan_is_past(scheduled_date_param date)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $$
  select coalesce(scheduled_date_param < ((now() at time zone 'utc') - interval '12 hours')::date, false);
$$;
revoke all on function public._occasion_plan_is_past(date) from public, anon;
grant execute on function public._occasion_plan_is_past(date) to authenticated, service_role;

-- Same signature: replaced in place.
create or replace function public.respond_to_occasion_group_plan(plan_id_param uuid, accept boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_past boolean;
begin
  select public._occasion_plan_is_past(scheduled_date) into v_past
  from occasion_group_plans where id = plan_id_param;
  v_past := coalesce(v_past, false);

  if v_past and accept then
    raise exception 'This invitation has expired: the plan date has already passed';
  end if;

  update occasion_group_plan_participants
  set status = case when v_past then 'expired' when accept then 'joined' else 'declined' end,
      responded_at = now()
  where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'invited';

  if not found then
    raise exception 'No pending invite found for this plan.';
  end if;
end;
$function$;

-- Guest link: past plan -> accept refused; a decline records 'expired' and
-- the host is not told the guest "can't make it".
create or replace function public.respond_to_occasion_group_plan_guest_invite(token_param uuid, accept_param boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_participant record;
  v_plan record;
  v_new_status text;
  service_key text;
  v_wants_notif boolean;
  v_past boolean;
begin
  select * into v_participant from occasion_group_plan_participants
  where guest_token = token_param and user_id is null;
  if v_participant is null then
    raise exception 'This invite link is no longer valid.';
  end if;

  select * into v_plan from occasion_group_plans where id = v_participant.group_plan_id;
  if v_plan is null or v_plan.status = 'cancelled' then
    raise exception 'This plan is no longer available.';
  end if;
  if v_participant.status <> 'invited' then
    raise exception 'This invite has already been responded to.';
  end if;

  v_past := public._occasion_plan_is_past(v_plan.scheduled_date);
  if v_past and accept_param then
    raise exception 'This invitation has expired: the plan date has already passed';
  end if;

  v_new_status := case when v_past then 'expired' when accept_param then 'joined' else 'declined' end;

  update occasion_group_plan_participants
  set status = v_new_status, responded_at = now()
  where id = v_participant.id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_plan.host_id;
  if not v_past and service_key is not null and v_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_plan.host_id,
        'title', case when accept_param then '🎉 ' || v_participant.guest_name || ' is in!' else '🙈 ' || v_participant.guest_name || ' can''t make it' end,
        'body', v_participant.guest_name || (case when accept_param then ' is coming to ' else ' can''t make it to ' end) || v_plan.title || '.',
        'data', jsonb_build_object('type', 'occasion_group_plan_guest_rsvp', 'plan_id', v_plan.id)
      )
    );
  end if;

  return jsonb_build_object('guestStatus', v_new_status);
end;
$function$;

revoke all on function public.respond_to_occasion_group_plan_guest_invite(uuid, boolean) from public;
grant execute on function public.respond_to_occasion_group_plan_guest_invite(uuid, boolean) to anon, authenticated;

-- Host approval of a gathering join request: refuse once the gathering is past.
create or replace function public.approve_gathering_interest(interest_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if v_capacity is not null and v_approved_count >= v_capacity then
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

revoke all on function public.approve_gathering_interest(uuid) from public, anon;
grant execute on function public.approve_gathering_interest(uuid) to authenticated, service_role;
