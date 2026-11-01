-- Friend-request burst limit (owner, 2026-11-01: "5 friend requests per rolling 10 minutes"; staged after 20270376,
-- deploy only with its own approval). The existing 15-per-local-day limit (enforce_friend_request_daily_limit, trigger
-- on_friend_request_enforce_limit) is NOT changed: this adds a second, short-window limit beside it.
--
-- Uses the ONE rate-limit mechanism of 20270356 (rules in private.rate_limit_rules, checked by private.enforce_rate_limit):
--   * same number at both trust levels (friend requests are unsolicited outreach: account age never raises them, 20270358);
--   * counted from private.limited_action_log ('friend_request'), one row per friend request REALLY created. The row is
--     written by an AFTER INSERT trigger, so a refused insert (duplicate pair 23505, block policy, missing phone,
--     suspension, the daily limit, this limit) or a skipped "on conflict do nothing" insert never counts. A retry of a
--     request that failed costs nothing; a retry of one that succeeded is refused as a duplicate and costs nothing.
--   * a request that is later declined or removed still counts for its 10 minutes (the log row stays; nothing gives
--     the allowance back early), so cancel-and-resend can't get around it;
--   * only a request made by the signed-in person for themselves counts (auth.uid() = requested_by, status 'pending');
--     the mutual Connect in friend discovery (respond_to_friend_discovery_swipe: an accepted friendship written as a
--     trusted server write) and other server writes never count, exactly as for the daily limit;
--   * simultaneous requests: the check locks the sender's profiles row first (the same row the daily limit locks), so
--     two requests from one person are decided one after the other and the second sees the first one's log row;
--   * reaching the limit never restricts, flags, scores or asks to verify an account: it refuses that one request.
-- Refusal = hint 'friend_request_limit' (the app shows its own sentence in the person's language).
-- The daily limit's refusal (unchanged limit and English text) now also carries a hint, 'friend_request_daily_limit',
-- so the app shows that sentence in the person's language too (owner, 2026-11-01; it was English-only).
--
-- Daily counter fix (owner, 2026-11-01): the daily limit used to add one to profiles.friend_requests_sent_today in its
-- BEFORE INSERT trigger. Postgres runs BEFORE triggers before it checks a conflict, so an "on conflict do nothing" insert
-- of an existing pair (a direct API call; the app never sends one) used a daily slot without creating a request. Now the
-- BEFORE trigger only locks + checks (unchanged limit, message and scope), and the +1 happens in an AFTER INSERT trigger,
-- which runs only for a row really written. The profiles-row lock taken before the check is held to the end of the
-- transaction, so simultaneous requests are still decided one at a time and each sees the previous one's +1.

alter table private.rate_limit_rules drop constraint if exists rate_limit_rules_action_check;
alter table private.rate_limit_rules add constraint rate_limit_rules_action_check
  check (action in ('direct_message', 'group_message', 'business_message', 'invitation', 'report',
                    'urgent_report', 'business_request', 'name_change', 'photo_change',
                    'commercial_post', 'gathering_create', 'friend_request'));

alter table private.limited_action_log drop constraint if exists limited_action_log_field_check;
alter table private.limited_action_log add constraint limited_action_log_field_check
  check (field in ('name', 'photo', 'commercial_post', 'gathering', 'friend_request'));

-- private.rate_limit_count: + friend_request (otherwise identical to 20270362)
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
    when 'friend_request' then (select count(*) from private.limited_action_log where user_id = uid and field = 'friend_request' and changed_at > since)
  end;
$function$;
revoke all on function private.rate_limit_count(text, uuid, timestamptz) from public, anon, authenticated;

-- The check (before the insert). Only the signed-in person's own new pending request is checked.
create or replace function public._rate_limit_friend_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hint text;
begin
  if auth.uid() is null or auth.uid() is distinct from new.requested_by or new.status is distinct from 'pending'
     or private.trusted_write_active() then
    return new;
  end if;
  -- one sender's requests are decided one at a time (the daily limit locks the same row; same order, no deadlock)
  perform 1 from profiles where id = new.requested_by for update;
  begin
    perform private.enforce_rate_limit('friend_request');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'rate_limited' then raise; end if;
    raise exception 'You''ve sent several friend requests in a short time. Please wait a few minutes and try again.'
      using errcode = 'P0001', hint = 'friend_request_limit';
  end;
  return new;
end;
$function$;
revoke all on function public._rate_limit_friend_request() from public, anon, authenticated;

-- The count (after the insert): only a row that was really written leaves a timestamp.
create or replace function public._log_friend_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or auth.uid() is distinct from new.requested_by or new.status is distinct from 'pending'
     or private.trusted_write_active() then
    return null;
  end if;
  insert into private.limited_action_log (user_id, field) values (new.requested_by, 'friend_request');
  return null;
end;
$function$;
revoke all on function public._log_friend_request() from public, anon, authenticated;

drop trigger if exists zz_rate_limit_friend_request on public.friendships;
create trigger zz_rate_limit_friend_request before insert on public.friendships
  for each row execute function public._rate_limit_friend_request();
drop trigger if exists zz_log_friend_request on public.friendships;
create trigger zz_log_friend_request after insert on public.friendships
  for each row execute function public._log_friend_request();

-- The daily limit: check only (before the insert). Same limit, message, scope and lock as 20270361.
CREATE OR REPLACE FUNCTION public.enforce_friend_request_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
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
    -- 20270377: same English sentence (older builds keep showing it), plus a hint the app maps to its own sentence
    raise exception 'You can send up to % friend requests per day. Try again tomorrow.', v_daily_limit
      using hint = 'friend_request_daily_limit';
  end if;

  return new;  -- 20270377: the +1 is written after the insert (_count_friend_request_daily), only for a real row
end;
$function$;

-- The daily counter: +1 after the insert (same day reading and scope as the check: every non-trusted insert).
create or replace function public._count_friend_request_daily()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_trusted text := current_setting('app.trusted_update', true);
  v_timezone text;
  v_today date;
begin
  if private.trusted_write_active() then
    return null;
  end if;
  select coalesce(timezone, 'UTC') into v_timezone from profiles where id = new.requested_by;
  begin
    v_today := (now() at time zone v_timezone)::date;
  exception when others then
    v_today := current_date;
  end;
  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set friend_requests_sent_today = case when friend_requests_sent_date = v_today then friend_requests_sent_today + 1 else 1 end,
      friend_requests_sent_date = v_today
  where id = new.requested_by;
  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true);
  return null;
end;
$function$;
revoke all on function public._count_friend_request_daily() from public, anon, authenticated;
drop trigger if exists on_friend_request_count_daily on public.friendships;
create trigger on_friend_request_count_daily after insert on public.friendships
  for each row execute function public._count_friend_request_daily();

-- The numbers (owner, 2026-11-01): 5 per rolling 10 minutes, both levels; the daily 15 stays where it is.
insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values
  ('friend_request', 'new',         600, 5),
  ('friend_request', 'established', 600, 5)
on conflict (action, trust_level, window_seconds) do update set max_count = excluded.max_count;
