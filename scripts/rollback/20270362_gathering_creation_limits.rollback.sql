-- Rollback of 20270362: back to the old flat limit (10 per local day for everyone). Newest first.
drop trigger if exists zz_rate_limit_gathering_create on public.gatherings;
drop function if exists public._rate_limit_gathering_create();
delete from private.rate_limit_rules where action = 'gathering_create';
delete from private.limited_action_log where field = 'gathering';

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
  end;
$function$;
revoke all on function private.rate_limit_count(text, uuid, timestamptz) from public, anon, authenticated;

alter table private.limited_action_log drop constraint if exists limited_action_log_field_check;
alter table private.limited_action_log add constraint limited_action_log_field_check
  check (field in ('name', 'photo', 'commercial_post'));
alter table private.rate_limit_rules drop constraint if exists rate_limit_rules_action_check;
alter table private.rate_limit_rules add constraint rate_limit_rules_action_check
  check (action in ('direct_message', 'group_message', 'business_message', 'invitation', 'report',
                    'urgent_report', 'business_request', 'name_change', 'photo_change',
                    'commercial_post'));

create trigger on_gathering_created_enforce_limit before insert on public.gatherings
  for each row execute function enforce_gathering_daily_limit();
