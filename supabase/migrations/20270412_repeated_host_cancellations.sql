-- Repeated host cancellations (owner, 2026-11-12, idea 34 follow-up). Staged after 20270411, deploy only with its own
-- approval and only after 20270385 + 20270386 (and 20270363/20270365, whose case rules it feeds). Server-only: no client,
-- string or screen change, so every app build (incl. 87) behaves exactly as before.
--
-- 20270385's create_cancel catches a host who cancels FRESH gatherings (within 48 h of creating them). It misses a host who
-- posts well ahead, lets people join, then cancels. This adds one deterministic, advisory signal on the same machinery:
--   repeated_cancellations  a host cancelling (cancel_gathering) or deleting (the API's own delete) at least N gatherings
--                           within a rolling window of days, each before its start and each with at least M APPROVED
--                           attendees other than the host at the moment it was cancelled. A recurring series counts once.
--                           Not counted: an attendee leaving or withdrawing (never deletes a gathering), an admin removal
--                           (20270393: the admin is not the host), an account deletion (no signed-in host), a gathering
--                           that already started, an empty / one-guest / pending-only / waitlist-only gathering, and
--                           anything cancelled before the host's latest CLOSED behaviour case (a case an admin closed is
--                           never re-raised from the same cancellations; only fresh ones count).
-- Approved starting numbers (owner 2026-11-12, a proposed starting point, not calibrated on usage data): 3 within 30 days,
-- each with >= 2 approved attendees besides the host. Opens a review case on its own; corroboration family = create_cancel's
-- (the two never corroborate each other). Case rules unchanged: one open case per person (later signals extend it), 20 new
-- cases a day with overflow kept, a closed case never reopened by a signal.
-- NOTHING here refuses, delays, hides, cancels, ranks, restricts, scores or notifies anyone: the detector runs in
-- 20270385's exception block and the cancellation always goes through. The log gains one count (approved_others): no names,
-- ids, title or location. Rows logged before this migration have no count and never count here. Kept 30 days (unchanged).

do $$
begin
  if to_regclass('private.gathering_signal_settings') is null or to_regclass('private.gathering_cancel_log') is null then
    raise exception '20270412 needs 20270385 (gathering review signals) first';
  end if;
  if not exists (select 1 from private.gathering_signal_settings where id and cancel_min_count is not null) then
    raise exception '20270412 needs 20270386 (gathering review signal thresholds) first';
  end if;
end $$;

-- 1. Settings (null = off) + the minimal count on the log
alter table private.gathering_signal_settings
  add column if not exists repeat_cancel_min_count integer
    check (repeat_cancel_min_count is null or repeat_cancel_min_count >= 2),
  add column if not exists repeat_cancel_window_days integer
    check (repeat_cancel_window_days is null or repeat_cancel_window_days between 1 and 30),  -- the log is kept 30 days
  add column if not exists repeat_cancel_min_attendees integer
    check (repeat_cancel_min_attendees is null or repeat_cancel_min_attendees >= 1);
alter table private.gathering_cancel_log
  add column if not exists approved_others integer check (approved_others is null or approved_others >= 0);

-- 2. Kind
alter table private.behavior_signals drop constraint if exists behavior_signals_kind_check;
alter table private.behavior_signals add constraint behavior_signals_kind_check
  check (kind in ('repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                  'discovery_limit', 'discovery_limit_repeated',
                  'attendee_surge', 'attendee_surge_new', 'create_cancel', 'large_public_gathering',
                  'repeated_cancellations'));
alter table private.behavior_signal_settings drop constraint if exists behavior_signal_settings_case_alone_kinds_check;
alter table private.behavior_signal_settings add constraint behavior_signal_settings_case_alone_kinds_check
  check (case_alone_kinds <@ array['repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                                   'discovery_limit_repeated', 'attendee_surge_new', 'create_cancel',
                                   'large_public_gathering', 'repeated_cancellations']);

-- 3. Case rule: 20270385's, verbatim, plus the cancellation family.
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
  -- families: 20270382's discovery pair, 20270385's attendee-surge pair, 20270412's cancellation pair (a family never
  -- corroborates itself)
  select count(distinct case when kind = 'discovery_limit_repeated' then 'discovery_limit'
                             when kind = 'attendee_surge_new' then 'attendee_surge'
                             when kind = 'repeated_cancellations' then 'create_cancel' else kind end) into v_families
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

-- 4. The host's own cancellation / delete: 20270385's create_cancel unchanged + repeated_cancellations.
create or replace function public._gathering_signal_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.gathering_signal_settings;
  v_create_cancel boolean;
  v_repeat boolean;
  v_involved boolean;
  v_approved integer;
  v_n integer;
  v_since timestamptz;
  v_closed_at timestamptz;
begin
  begin
    select * into s from private.gathering_signal_settings where id;
    v_create_cancel := s.cancel_min_count is not null and s.cancel_window_days is not null and s.cancel_max_age_hours is not null;
    v_repeat := s.repeat_cancel_min_count is not null and s.repeat_cancel_window_days is not null
                and s.repeat_cancel_min_attendees is not null;
    if not v_create_cancel and not v_repeat then return old; end if;
    -- host-initiated only: the signed-in person deleting is the host (cancel_gathering and the API's own delete both run as
    -- the host; an admin removal runs as the admin, an account deletion has no signed-in person)
    if auth.uid() is null or old.host_id is null or auth.uid() is distinct from old.host_id then return old; end if;
    if old.scheduled_at <= now() or old.created_at is null then return old; end if;  -- only before the start
    v_involved := exists (select 1 from gathering_interest gi where gi.gathering_id = old.id and gi.user_id <> old.host_id)
               or exists (select 1 from social_invites i where i.target_id = old.id and i.invite_type = 'gathering'
                                                           and i.invitee_id <> old.host_id);
    -- approved attendees besides the host at the moment of cancelling (pending, waitlisted, invited never count)
    select count(distinct gi.user_id) into v_approved from gathering_interest gi
     where gi.gathering_id = old.id and gi.user_id <> old.host_id and gi.status = 'approved';
    perform pg_advisory_xact_lock(hashtext('gathering_cancel:' || old.host_id::text));
    insert into private.gathering_cancel_log (host_id, series_ref, created_at, scheduled_at, others_involved, approved_others)
      values (old.host_id, coalesce(old.recurring_series_id, old.id), old.created_at, old.scheduled_at, v_involved, v_approved);
    if v_create_cancel then  -- 20270385, unchanged
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
    end if;
    if v_repeat then
      -- only cancellations after the host's latest closed behaviour case: a closed case is never re-raised from the same ones
      select max(c.closed_at) into v_closed_at from private.account_review_cases c
       where c.signal = 'behavior' and c.subject_user = old.host_id and c.status = 'closed';
      v_since := greatest(now() - make_interval(days => s.repeat_cancel_window_days), coalesce(v_closed_at, '-infinity'));
      select count(distinct l.series_ref) into v_n from private.gathering_cancel_log l
       where l.host_id = old.host_id
         and l.approved_others >= s.repeat_cancel_min_attendees
         and l.cancelled_at > v_since
         and l.cancelled_at < l.scheduled_at;
      if v_n >= s.repeat_cancel_min_count then
        perform private.behavior_note_signal(old.host_id, 'repeated_cancellations',
          jsonb_build_object('cancellations', v_n, 'window_days', s.repeat_cancel_window_days,
                             'min_attendees', s.repeat_cancel_min_attendees));
      end if;
    end if;
  exception when others then
    raise warning 'gathering cancellation signals: %', sqlerrm;  -- never fails the cancellation
  end;
  return old;
end;
$function$;
revoke all on function public._gathering_signal_cancel() from public, anon, authenticated;

-- 5. The approved starting numbers (owner 2026-11-12) + may open a case alone (appended: existing order kept).
update private.gathering_signal_settings set
  repeat_cancel_min_count = 3, repeat_cancel_window_days = 30, repeat_cancel_min_attendees = 2, updated_at = now()
where id;
update private.behavior_signal_settings set
  case_alone_kinds = case_alone_kinds || array(select k from unnest(array['repeated_cancellations']) k where k <> all(case_alone_kinds)),
  updated_at = now()
where id;
