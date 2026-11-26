-- Rollback for migration 20270412: back to 20270385/20270386's state. The repeated_cancellations signals are removed (the
-- restored kind check can't hold them); review cases they opened stay (their evidence is a copy). Cancellations, gatherings
-- and every other signal untouched.
update private.behavior_signal_settings
   set case_alone_kinds = array(select k from unnest(case_alone_kinds) k where k <> 'repeated_cancellations'), updated_at = now()
 where id;
delete from private.behavior_signals where kind = 'repeated_cancellations';
alter table private.behavior_signal_settings drop constraint if exists behavior_signal_settings_case_alone_kinds_check;
alter table private.behavior_signal_settings add constraint behavior_signal_settings_case_alone_kinds_check
  check (case_alone_kinds <@ array['repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                                   'discovery_limit_repeated', 'attendee_surge_new', 'create_cancel',
                                   'large_public_gathering']);
alter table private.behavior_signals drop constraint if exists behavior_signals_kind_check;
alter table private.behavior_signals add constraint behavior_signals_kind_check
  check (kind in ('repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                  'discovery_limit', 'discovery_limit_repeated',
                  'attendee_surge', 'attendee_surge_new', 'create_cancel', 'large_public_gathering'));

-- 20270385's functions, verbatim
create or replace function private.behavior_evaluate_case(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_families integer;
  s private.behavior_signal_settings;
  v_quiet_days integer := (select large_repeat_quiet_days from private.gathering_signal_settings where id);
  v_alone text[];
  v_kinds text[];
  v_evidence jsonb;
  v_case uuid;
  v_closed uuid;
  v_closed_at timestamptz;
begin
  select * into s from private.behavior_signal_settings where id;
  if not s.review_cases_enabled or s.case_window_hours is null or s.max_new_cases_per_day is null then return; end if;
  v_alone := s.case_alone_kinds;
  select id, closed_at into v_closed, v_closed_at
    from private.account_review_cases
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
  -- 20270385 repeat rule: any of the person's behaviour cases closed 'no_action' within the quiet period that was about a
  -- large public gathering silences later size-only signals: they never act alone (the signal itself stays recorded).
  if v_quiet_days is not null and exists (
       select 1 from private.account_review_cases c
        where c.signal = 'behavior' and c.subject_user = p_user and c.status = 'closed' and c.outcome = 'no_action'
          and c.closed_at > now() - make_interval(days => v_quiet_days)
          and coalesce(c.evidence -> 'signals', '[]'::jsonb) @> '[{"kind": "large_public_gathering"}]'::jsonb) then
    if v_kinds <@ array['large_public_gathering'] then return; end if;
    v_alone := array_remove(v_alone, 'large_public_gathering');
  end if;
  -- families: 20270382's discovery pair, 20270385's attendee-surge pair (a family never corroborates itself)
  select count(distinct case when kind = 'discovery_limit_repeated' then 'discovery_limit'
                             when kind = 'attendee_surge_new' then 'attendee_surge' else kind end) into v_families
    from private.behavior_signals
   where user_id = p_user and last_at > now() - make_interval(hours => s.case_window_hours)
     and (v_closed_at is null or last_at > v_closed_at);
  if not ((s.case_min_signal_kinds is not null and v_families >= s.case_min_signal_kinds)
          or v_kinds && v_alone) then
    return;
  end if;
  select id into v_case from private.account_review_cases
   where signal = 'behavior' and subject_user = p_user and status = 'open' for update;
  if v_case is not null then
    -- signals refreshed; other keys (previous_case_id) kept
    update private.account_review_cases set evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object('signals', v_evidence),
                                            updated_at = now()
     where id = v_case;
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
    values ('behavior', 'behavior_pattern', p_user,
            jsonb_build_object('signals', v_evidence) || case when v_closed is null then '{}'::jsonb
                                                              else jsonb_build_object('previous_case_id', v_closed) end)
    on conflict (subject_user) where status = 'open' and signal = 'behavior' do nothing
    returning id into v_case;
  if v_case is not null then
    insert into private.account_review_case_members (case_id, user_id) values (v_case, p_user) on conflict do nothing;
    delete from private.behavior_case_waiting where user_id = p_user;
  end if;
end;
$function$;
revoke all on function private.behavior_evaluate_case(uuid) from public, anon, authenticated;

create or replace function public._gathering_signal_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.gathering_signal_settings;
  v_involved boolean;
  v_n integer;
begin
  begin
    select * into s from private.gathering_signal_settings where id;
    if s.cancel_min_count is null or s.cancel_window_days is null or s.cancel_max_age_hours is null then return old; end if;
    if auth.uid() is null or old.host_id is null or auth.uid() is distinct from old.host_id then return old; end if;
    if old.scheduled_at <= now() or old.created_at is null then return old; end if;  -- only before the start
    v_involved := exists (select 1 from gathering_interest gi where gi.gathering_id = old.id and gi.user_id <> old.host_id)
               or exists (select 1 from social_invites i where i.target_id = old.id and i.invite_type = 'gathering'
                                                           and i.invitee_id <> old.host_id);
    perform pg_advisory_xact_lock(hashtext('gathering_cancel:' || old.host_id::text));
    insert into private.gathering_cancel_log (host_id, series_ref, created_at, scheduled_at, others_involved)
      values (old.host_id, coalesce(old.recurring_series_id, old.id), old.created_at, old.scheduled_at, v_involved);
    select count(distinct l.series_ref) into v_n from private.gathering_cancel_log l
     where l.host_id = old.host_id and l.others_involved
       and l.cancelled_at > now() - make_interval(days => s.cancel_window_days)
       and l.cancelled_at - l.created_at <= make_interval(hours => s.cancel_max_age_hours)
       and l.cancelled_at < l.scheduled_at;
    if v_n >= s.cancel_min_count then
      perform private.behavior_note_signal(old.host_id, 'create_cancel',
        jsonb_build_object('cancellations', v_n, 'window_days', s.cancel_window_days,
                           'within_hours', s.cancel_max_age_hours));
    end if;
  exception when others then
    raise warning 'gathering create_cancel: %', sqlerrm;  -- never fails the cancellation
  end;
  return old;
end;
$function$;
revoke all on function public._gathering_signal_cancel() from public, anon, authenticated;

alter table private.gathering_cancel_log drop column if exists approved_others;
alter table private.gathering_signal_settings
  drop column if exists repeat_cancel_min_count,
  drop column if exists repeat_cancel_window_days,
  drop column if exists repeat_cancel_min_attendees;
