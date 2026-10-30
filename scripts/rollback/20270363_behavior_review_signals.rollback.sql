-- Rollback for migration 20270363 (behaviour review signals). Run before rolling back 20270362 and earlier (newest first).
-- WARNING: deletes every behaviour signal, event and behaviour review case (open and closed) with its admin note. Export
-- them first if the review history must be kept:  select * from private.account_review_cases where signal = 'behavior';
select cron.unschedule(jobid) from cron.job where jobname = 'purge-behavior-signals';
drop trigger if exists zz_behavior_signal on public.messages;
drop trigger if exists zz_behavior_signal on public.gathering_messages;
drop trigger if exists zz_behavior_signal on public.community_messages;
drop trigger if exists zz_behavior_signal on public.plan_messages;
drop trigger if exists zz_behavior_signal on public.business_messages;
drop trigger if exists zz_behavior_signal on public.gathering_interest;
drop function if exists public._behavior_message_inserted();
drop function if exists public._behavior_gathering_joined();
drop function if exists public.record_location_jump(uuid, text);
drop function if exists public.admin_list_behavior_case_overflow();
drop function if exists public.admin_open_behavior_case(uuid);
drop function if exists private.purge_behavior_signals();
drop function if exists private.behavior_check_repeated_message(uuid, text);
drop function if exists private.behavior_note_limit_reached(uuid, text);
drop function if exists private.behavior_note_signal(uuid, text, jsonb);
drop function if exists private.behavior_evaluate_case(uuid);
drop function if exists private.normalized_message(text);
drop index if exists public.messages_sender_created_idx;
drop index if exists public.gathering_messages_sender_created_idx;
drop index if exists public.community_messages_sender_created_idx;
drop index if exists public.plan_messages_sender_created_idx;
drop index if exists public.business_messages_sender_created_idx;
delete from private.account_review_cases where signal = 'behavior';
drop index if exists private.account_review_cases_one_open_behavior;
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names'));
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo'));
alter table private.account_review_cases drop column if exists evidence;
alter table private.account_review_cases drop column if exists subject_user;
alter table private.account_review_cases alter column sha256 set not null;
drop table if exists private.behavior_case_waiting;
drop table if exists private.behavior_case_overflow;
drop table if exists private.behavior_signals;
drop table if exists private.behavior_events;
drop table if exists private.behavior_signal_settings;

-- private.enforce_rate_limit(text): back to 20270361
CREATE OR REPLACE FUNCTION private.enforce_rate_limit(p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_level text;
  r record;
begin
  if v_uid is null or private.trusted_write_active() /* 20270361: never the forgeable flag */ then return; end if;
  if not exists (select 1 from private.rate_limit_rules where action = p_action) then return; end if;  -- nothing approved
  v_level := private.trust_level(v_uid);
  if v_level = 'restricted' then return; end if;  -- 20270351 refuses it on its own terms
  for r in select window_seconds, max_count from private.rate_limit_rules
            where action = p_action and trust_level = v_level loop
    if private.rate_limit_count(p_action, v_uid, now() - make_interval(secs => r.window_seconds)) >= r.max_count then
      raise exception 'You''ve reached the limit for this for now. Please try again later.'
        using errcode = 'P0001', hint = 'rate_limited';
    end if;
  end loop;
end;
$function$;

-- public.admin_list_account_review_cases(boolean): back to 20270357
create or replace function public.admin_list_account_review_cases(include_closed_param boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'signal', c.signal, 'reason', c.reason, 'status', c.status,
             'opened_at', c.opened_at, 'updated_at', c.updated_at, 'closed_at', c.closed_at,
             'outcome', c.outcome, 'note', c.note,
             'members', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'user_id', m.user_id, 'display_name', p.display_name,
                                  'suspended', p.suspended_at is not null, 'added_at', m.added_at) order by m.added_at), '[]'::jsonb)
                           from private.account_review_case_members m left join profiles p on p.id = m.user_id
                          where m.case_id = c.id))
           order by (c.status = 'open') desc, c.updated_at desc)
      from private.account_review_cases c
     where include_closed_param or c.status = 'open'), '[]'::jsonb);
end;
$function$;
revoke all on function public.admin_list_account_review_cases(boolean) from public, anon;
grant execute on function public.admin_list_account_review_cases(boolean) to authenticated;
