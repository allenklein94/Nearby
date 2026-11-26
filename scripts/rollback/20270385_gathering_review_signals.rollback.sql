-- Rollback for migration 20270385: back to 20270384's state. Signals of the four new kinds and the new events are deleted
-- (their kinds no longer exist); every review case (incl. ones these signals opened) is kept, as an admin decision record.
-- Run 20270386's rollback first if it was applied.
drop trigger if exists zz_gathering_signal_capacity on public.gatherings;
drop trigger if exists zz_gathering_signal_cancel on public.gatherings;
drop trigger if exists zz_gathering_signal_join on public.gathering_interest;
drop function if exists public._gathering_signal_capacity();
drop function if exists public._gathering_signal_cancel();
drop function if exists public._gathering_signal_join();
drop function if exists private.gathering_note_large(uuid, text, integer);

delete from private.behavior_signals where kind in ('attendee_surge', 'attendee_surge_new', 'create_cancel', 'large_public_gathering');
delete from private.behavior_events where kind = 'attendee_join';
update private.behavior_signal_settings
   set case_alone_kinds = array(select k from unnest(case_alone_kinds) k
                                 where k not in ('attendee_surge_new', 'create_cancel', 'large_public_gathering')) where id;
drop index if exists private.behavior_events_attendee_ref_idx;
alter table private.behavior_events drop constraint if exists behavior_events_kind_check;
alter table private.behavior_events add constraint behavior_events_kind_check
  check (kind in ('gathering_join', 'limit_reached', 'location_jump'));
alter table private.behavior_signals drop constraint if exists behavior_signals_kind_check;
alter table private.behavior_signals add constraint behavior_signals_kind_check
  check (kind in ('repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                  'discovery_limit', 'discovery_limit_repeated'));
alter table private.behavior_signal_settings drop constraint if exists behavior_signal_settings_case_alone_kinds_check;
alter table private.behavior_signal_settings add constraint behavior_signal_settings_case_alone_kinds_check
  check (case_alone_kinds <@ array['repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                                   'discovery_limit_repeated']);

drop table if exists private.gathering_signal_settings;
drop table if exists private.gathering_cancel_log;
drop table if exists private.gathering_size_marks;

-- private.behavior_evaluate_case exactly as 20270382
create or replace function private.behavior_evaluate_case(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_families integer;
  s private.behavior_signal_settings;
  v_kinds text[];
  v_evidence jsonb;
  v_case uuid;
  v_closed uuid;
  v_closed_at timestamptz;
  v_last_new timestamptz;
begin
  select * into s from private.behavior_signal_settings where id;
  if not s.review_cases_enabled or s.case_window_hours is null or s.max_new_cases_per_day is null then return; end if;
  select id, closed_at, new_evidence_at into v_closed, v_closed_at, v_last_new from private.account_review_cases
   where signal = 'behavior' and subject_user = p_user and status = 'closed'
   order by closed_at desc limit 1;
  select array_agg(distinct kind),
         jsonb_agg(jsonb_build_object('kind', kind, 'first_at', first_at, 'last_at', last_at, 'hits', hits) || evidence
                   order by last_at desc)
    into v_kinds, v_evidence
    from private.behavior_signals
   where user_id = p_user and last_at > now() - make_interval(hours => s.case_window_hours)
     and (v_closed_at is null or last_at > v_closed_at);
  if v_kinds is null then return; end if;
  -- 20270382: the two discovery-limit signals are one family (the repeated one never corroborates its own day)
  select count(distinct case when kind = 'discovery_limit_repeated' then 'discovery_limit' else kind end) into v_families
    from private.behavior_signals
   where user_id = p_user and last_at > now() - make_interval(hours => s.case_window_hours)
     and (v_closed_at is null or last_at > v_closed_at);
  if not ((s.case_min_signal_kinds is not null and v_families >= s.case_min_signal_kinds)
          or v_kinds && s.case_alone_kinds) then
    return;
  end if;
  select id into v_case from private.account_review_cases
   where signal = 'behavior' and subject_user = p_user and status = 'open' for update;
  if v_case is not null then
    update private.account_review_cases set evidence = jsonb_build_object('signals', v_evidence), updated_at = now()
     where id = v_case;
    return;
  end if;
  if v_closed is not null then
    -- decided before: note the new signals on that case (the admin may reopen it), never a fresh case
    if v_last_new is null or v_last_new < v_closed_at or v_last_new < now() - interval '24 hours' then
      perform 1 from private.account_review_cases where id = v_closed for update;
      insert into private.account_review_case_events (case_id, kind, subject, detail)
        values (v_closed, 'new_evidence', p_user, jsonb_build_object('signals', v_evidence));
      update private.account_review_cases set new_evidence_at = now(), updated_at = now() where id = v_closed;
    end if;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('behavior_case_queue'));
  if (select count(*) from private.account_review_cases
       where signal = 'behavior' and opened_at > now() - interval '24 hours') >= s.max_new_cases_per_day then
    insert into private.behavior_case_overflow (day, suppressed) values ((now() at time zone 'utc')::date, 1)
      on conflict (day) do update set suppressed = private.behavior_case_overflow.suppressed + 1;
    insert into private.behavior_case_waiting (user_id) values (p_user)
      on conflict (user_id) do update set last_at = now(), times = private.behavior_case_waiting.times + 1;
    return;
  end if;
  insert into private.account_review_cases (signal, reason, subject_user, evidence)
    values ('behavior', 'behavior_pattern', p_user, jsonb_build_object('signals', v_evidence))
    on conflict (subject_user) where status = 'open' and signal = 'behavior' do nothing
    returning id into v_case;
  if v_case is not null then
    insert into private.account_review_case_members (case_id, user_id) values (v_case, p_user) on conflict do nothing;
    delete from private.behavior_case_waiting where user_id = p_user;
  end if;
end;
$function$;

revoke all on function private.behavior_evaluate_case(uuid) from public, anon, authenticated;

-- private.purge_behavior_signals exactly as 20270363
create or replace function private.purge_behavior_signals()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.behavior_events where kind = 'location_jump' and at < now() - interval '1 hour';
  delete from private.behavior_events where at < now() - interval '48 hours';
  delete from private.behavior_signals where last_at < now() - interval '30 days';
  delete from private.behavior_case_waiting where last_at < now() - interval '30 days';
  delete from private.behavior_case_overflow where day < (now() at time zone 'utc')::date - 90;
$function$;
revoke all on function private.purge_behavior_signals() from public, anon, authenticated;
