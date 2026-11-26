-- Rollback of 20270377: back to the daily friend-request limit alone (20270376 state). Newest first.
drop trigger if exists zz_log_friend_request on public.friendships;
drop trigger if exists zz_rate_limit_friend_request on public.friendships;
drop function if exists public._log_friend_request();
drop function if exists public._rate_limit_friend_request();
drop trigger if exists on_friend_request_count_daily on public.friendships;
drop function if exists public._count_friend_request_daily();
-- the daily limit's check + counter back in one BEFORE trigger (20270361's text)
CREATE OR REPLACE FUNCTION public.enforce_friend_request_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 15;
begin
  if private.trusted_write_active() /* 20270361: never the forgeable flag */ then
    return new;
  end if;

  select friend_requests_sent_today, friend_requests_sent_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.requested_by for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can send up to % friend requests per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set friend_requests_sent_today = v_current_count + 1, friend_requests_sent_date = v_today_in_user_tz
  where id = new.requested_by;
  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: the caller's value, not 'false'

  return new;
end;
$function$;
delete from private.rate_limit_rules where action = 'friend_request';
delete from private.limited_action_log where field = 'friend_request';

create or replace function private.rate_limit_count(p_action text, uid uuid, since timestamptz)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case p_action
    when 'direct_message' then (select count(*) from messages where sender_id = uid and created_at > since)
    when 'group_message' then
        (select count(*) from gathering_messages where sender_id = uid and created_at > since)
      + (select count(*) from community_messages where sender_id = uid and created_at > since)
      + (select count(*) from plan_messages where sender_id = uid and created_at > since)
    when 'business_message' then (select count(*) from business_messages where sender_id = uid and created_at > since)
    when 'invitation' then (select count(*) from social_invites where inviter_id = uid and created_at > since)
    when 'report' then (select count(*) from reports where reporter_id = uid and created_at > since
                                                       and not private.is_urgent_report_reason(reason))
    when 'urgent_report' then (select count(*) from reports where reporter_id = uid and created_at > since
                                                              and private.is_urgent_report_reason(reason))
    when 'business_request' then (select count(*) from business_requests where requester_id = uid and created_at > since)
    when 'name_change' then (select count(*) from private.limited_action_log where user_id = uid and field = 'name' and changed_at > since)
    when 'photo_change' then (select count(*) from private.limited_action_log where user_id = uid and field = 'photo' and changed_at > since)
    when 'commercial_post' then (select count(*) from private.limited_action_log where user_id = uid and field = 'commercial_post' and changed_at > since)
    when 'gathering_create' then (select count(*) from private.limited_action_log where user_id = uid and field = 'gathering' and changed_at > since)
  end;
$function$;
revoke all on function private.rate_limit_count(text, uuid, timestamptz) from public, anon, authenticated;

alter table private.limited_action_log drop constraint if exists limited_action_log_field_check;
alter table private.limited_action_log add constraint limited_action_log_field_check
  check (field in ('name', 'photo', 'commercial_post', 'gathering'));
alter table private.rate_limit_rules drop constraint if exists rate_limit_rules_action_check;
alter table private.rate_limit_rules add constraint rate_limit_rules_action_check
  check (action in ('direct_message', 'group_message', 'business_message', 'invitation', 'report',
                    'urgent_report', 'business_request', 'name_change', 'photo_change',
                    'commercial_post', 'gathering_create'));
