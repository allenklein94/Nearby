-- Gathering creation limits by trust level (owner, 2026-10-30: 5 a day for new accounts, 15 for established; staged
-- after 20270361, deploy only with its own approval). Uses the ONE rate-limit mechanism of 20270356 (rules in
-- private.rate_limit_rules, trust level from private.trust_level: established = verified phone + 7 days, 20270358).
--
-- Rules (owner):
--   * every gathering a person creates counts, whatever its visibility (public, friends-only, private);
--   * editing never counts (the check runs on INSERT only);
--   * cancelling or deleting never gives the allowance back: each creation leaves a timestamp in
--     private.limited_action_log ('gathering'), counted over the last 24 hours, and nothing removes it early;
--   * occurrences the server generates for an existing recurring series (generate_next_recurring_gathering, cron, no
--     signed-in person) never count; only a creation by the signed-in host does;
--   * restricted (suspended) accounts: 20270351 already refuses them; nothing here changes that;
--   * attending, joining, accepting invitations: untouched (other tables);
--   * reaching the limit never restricts, flags or bans an account: it only refuses that one creation.
-- Refusal = hint 'gathering_limit' (the app shows its own sentence in the person's language).
--
-- Replaces the old flat limit (on_gathering_created_enforce_limit: 10 per local calendar day for everyone, which also
-- counted generated recurring occurrences). Only its trigger is dropped: the function and the profiles counter columns
-- stay (unused), so the rollback just recreates the trigger.

alter table private.rate_limit_rules drop constraint if exists rate_limit_rules_action_check;
alter table private.rate_limit_rules add constraint rate_limit_rules_action_check
  check (action in ('direct_message', 'group_message', 'business_message', 'invitation', 'report',
                    'urgent_report', 'business_request', 'name_change', 'photo_change',
                    'commercial_post', 'gathering_create'));

alter table private.limited_action_log drop constraint if exists limited_action_log_field_check;
alter table private.limited_action_log add constraint limited_action_log_field_check
  check (field in ('name', 'photo', 'commercial_post', 'gathering'));

-- private.rate_limit_count: + gathering_create (otherwise identical to 20270356)
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

create or replace function public._rate_limit_gathering_create()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hint text;
begin
  -- only a creation by the signed-in host counts (server-generated recurring occurrences have no signed-in person)
  if auth.uid() is null or auth.uid() is distinct from new.host_id then
    return new;
  end if;
  begin
    perform private.enforce_rate_limit('gathering_create');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'rate_limited' then raise; end if;
    -- the shared check's refusal, said as the gathering limit
    raise exception 'You''ve reached the limit for creating gatherings for now. Please try again later.'
      using errcode = 'P0001', hint = 'gathering_limit';
  end;
  insert into private.limited_action_log (user_id, field) values (new.host_id, 'gathering');
  return new;
end;
$function$;
revoke all on function public._rate_limit_gathering_create() from public, anon, authenticated;

drop trigger if exists on_gathering_created_enforce_limit on public.gatherings;
drop trigger if exists zz_rate_limit_gathering_create on public.gatherings;
create trigger zz_rate_limit_gathering_create before insert on public.gatherings
  for each row execute function public._rate_limit_gathering_create();

-- The numbers (owner, 2026-10-30): starting thresholds, to be reviewed against real usage.
insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values
  ('gathering_create', 'new',         86400, 5),
  ('gathering_create', 'established', 86400, 15)
on conflict (action, trust_level, window_seconds) do update set max_count = excluded.max_count;
