-- Gathering review signals (owner idea 11, decisions 2026-11-02). Staged after 20270384, deploy only with its own approval.
-- Builds three detectors on 20270363's behaviour-review machinery and ACTIVATES NOTHING: private.gathering_signal_settings
-- starts all null, so no event is recorded, no log row is written, no signal is noted and no case opens until the owner's
-- numbers are set by a separate migration (20270386).
--
--   attendee_surge          at least N DISTINCT people newly joining ONE gathering (a recurring series counts as one) within
--                           a window. The host never counts; invited joins never count (same rule as join_burst); leaving
--                           and re-joining counts once. Noted on the HOST. Kind 'attendee_surge_new' when at least the set
--                           share of those joiners are New accounts (20270356 trust level): that kind may open a case alone;
--                           'attendee_surge' only corroborates. The two are one family (never corroborate each other).
--   create_cancel           a host cancelling or deleting at least N gatherings within a window of days, each before its
--                           start and within M hours of its creation, counting only gatherings someone else had joined or
--                           been invited to (an empty draft never counts); a recurring series counts once. Needs a minimal
--                           log, private.gathering_cancel_log: host id, series ref, created / scheduled / cancelled times and
--                           whether anyone else was involved. No title, no location, no attendee ids; kept 30 days.
--   large_public_gathering  a PUBLIC gathering (visibility 'everyone') whose capacity is set to at least N (create or edit),
--                           or whose approved attendance (host excluded) reaches M, whichever comes first. Once per
--                           gathering or recurring series (private.gathering_size_marks). Noted on the host.
--                           Repeat rule (owner): when the host's most recent closed behaviour case was closed
--                           'no_action' within the quiet period AND included a large_public_gathering signal, later
--                           size-only signals do nothing on their own; alongside a different signal they still count.
-- Case rules = 20270363/20270369/20270382's: one open case per person, corroboration by distinct families, alone kinds from
-- behavior_signal_settings.case_alone_kinds, a closed case is never reopened by a signal (new evidence is noted on it for an
-- admin), 20 new cases a day with overflow kept. NOTHING here refuses, delays, hides, cancels, restricts or notifies anyone:
-- every detector runs in its own exception block and the gathering, the join and the cancellation always go through.
-- Concurrency: a per-gathering (or per-host) transaction lock makes parallel joins / cancellations count together; a lock
-- cycle with another detector is caught by the exception block (that one signal may be missed; the action never fails).

-- 1. Settings (separate table: the 20270363 settings row keeps its exact shape)
create table if not exists private.gathering_signal_settings (
  id boolean primary key default true check (id),
  surge_min_joiners integer check (surge_min_joiners is null or surge_min_joiners >= 5),
  surge_window_minutes integer check (surge_window_minutes is null or surge_window_minutes between 5 and 1440),
  surge_new_share real check (surge_new_share is null or surge_new_share between 0.1 and 1),
  cancel_min_count integer check (cancel_min_count is null or cancel_min_count >= 2),
  cancel_window_days integer check (cancel_window_days is null or cancel_window_days between 1 and 30),
  cancel_max_age_hours integer check (cancel_max_age_hours is null or cancel_max_age_hours between 1 and 168),
  large_min_capacity integer check (large_min_capacity is null or large_min_capacity >= 10),
  large_min_attendees integer check (large_min_attendees is null or large_min_attendees >= 5),
  large_repeat_quiet_days integer check (large_repeat_quiet_days is null or large_repeat_quiet_days between 1 and 365),
  updated_at timestamptz not null default now()
);
insert into private.gathering_signal_settings (id) values (true) on conflict (id) do nothing;

create table if not exists private.gathering_cancel_log (
  id bigint generated always as identity primary key,
  host_id uuid not null references auth.users(id) on delete cascade,
  series_ref uuid not null,
  created_at timestamptz not null,
  scheduled_at timestamptz not null,
  cancelled_at timestamptz not null default now(),
  others_involved boolean not null
);
create index if not exists gathering_cancel_log_host_idx on private.gathering_cancel_log (host_id, cancelled_at desc);

create table if not exists private.gathering_size_marks (
  series_ref uuid primary key,
  host_id uuid references auth.users(id) on delete cascade,
  marked_at timestamptz not null default now()
);

revoke all on private.gathering_signal_settings, private.gathering_cancel_log, private.gathering_size_marks
  from public, anon, authenticated;

-- 2. Kinds
alter table private.behavior_events drop constraint if exists behavior_events_kind_check;
alter table private.behavior_events add constraint behavior_events_kind_check
  check (kind in ('gathering_join', 'limit_reached', 'location_jump', 'attendee_join'));
create index if not exists behavior_events_attendee_ref_idx on private.behavior_events (ref, at desc) where kind = 'attendee_join';

alter table private.behavior_signals drop constraint if exists behavior_signals_kind_check;
alter table private.behavior_signals add constraint behavior_signals_kind_check
  check (kind in ('repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                  'discovery_limit', 'discovery_limit_repeated',
                  'attendee_surge', 'attendee_surge_new', 'create_cancel', 'large_public_gathering'));
alter table private.behavior_signal_settings drop constraint if exists behavior_signal_settings_case_alone_kinds_check;
alter table private.behavior_signal_settings add constraint behavior_signal_settings_case_alone_kinds_check
  check (case_alone_kinds <@ array['repeated_messages', 'join_burst', 'location_switching', 'limit_burst',
                                   'discovery_limit_repeated', 'attendee_surge_new', 'create_cancel',
                                   'large_public_gathering']);

-- 3. Case rule: as after 20270382 + the attendee-surge family + the large-gathering repeat rule.
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
  v_closed_outcome text;
  v_closed_evidence jsonb;
  v_last_new timestamptz;
begin
  select * into s from private.behavior_signal_settings where id;
  if not s.review_cases_enabled or s.case_window_hours is null or s.max_new_cases_per_day is null then return; end if;
  v_alone := s.case_alone_kinds;
  select id, closed_at, new_evidence_at, outcome, evidence
    into v_closed, v_closed_at, v_last_new, v_closed_outcome, v_closed_evidence
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
  -- 20270385: a large-gathering case closed 'no_action' within the quiet period silences later size-only signals: they
  -- never act alone, and with nothing else in the window nothing happens (not even new evidence on that case).
  if v_quiet_days is not null and v_closed_outcome = 'no_action'
     and v_closed_at > now() - make_interval(days => v_quiet_days)
     and coalesce(v_closed_evidence -> 'signals', '[]'::jsonb) @> '[{"kind": "large_public_gathering"}]'::jsonb then
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

-- 4. Large public gathering: one mark per gathering / series, then a signal on the host.
create or replace function private.gathering_note_large(p_gathering uuid, p_trigger text, p_value integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ref uuid;
  v_host uuid;
  v_mark uuid;
begin
  select coalesce(g.recurring_series_id, g.id), g.host_id into v_ref, v_host from gatherings g where g.id = p_gathering;
  if v_ref is null or v_host is null then return; end if;
  insert into private.gathering_size_marks (series_ref, host_id) values (v_ref, v_host)
    on conflict (series_ref) do nothing returning series_ref into v_mark;
  if v_mark is null then return; end if;  -- this gathering / series was already noted once
  perform private.behavior_note_signal(v_host, 'large_public_gathering',
    jsonb_build_object('gathering_id', p_gathering, 'trigger', p_trigger, p_trigger, p_value));
end;
$function$;
revoke all on function private.gathering_note_large(uuid, text, integer) from public, anon, authenticated;

create or replace function public._gathering_signal_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_min integer;
begin
  begin
    select large_min_capacity into v_min from private.gathering_signal_settings where id;
    if v_min is null or new.visibility is distinct from 'everyone' or coalesce(new.capacity, 0) < v_min then return null; end if;
    if tg_op = 'UPDATE' and old.visibility = 'everyone' and coalesce(old.capacity, 0) >= v_min then return null; end if;
    perform private.gathering_note_large(new.id, 'capacity', new.capacity);
  exception when others then
    raise warning 'gathering large_public_gathering (capacity): %', sqlerrm;  -- never fails the gathering
  end;
  return null;
end;
$function$;
revoke all on function public._gathering_signal_capacity() from public, anon, authenticated;
drop trigger if exists zz_gathering_signal_capacity on public.gatherings;
create trigger zz_gathering_signal_capacity after insert or update of capacity, visibility on public.gatherings
  for each row execute function public._gathering_signal_capacity();

-- 5. Joins: attendee surge (own new join row) + large attendance (any row reaching 'approved').
create or replace function public._gathering_signal_join()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.gathering_signal_settings;
  g record;
  v_ref uuid;
  v_n integer;
  v_new integer;
begin
  begin
    select * into s from private.gathering_signal_settings where id;
    select id, host_id, visibility, coalesce(recurring_series_id, id) as ref into g from gatherings where id = new.gathering_id;
    if g.id is null or g.host_id is null or new.user_id = g.host_id then return null; end if;
    v_ref := g.ref;

    -- attendee surge: the joiner's own new row (an approval by the host is an UPDATE and never counts)
    if tg_op = 'INSERT' and s.surge_min_joiners is not null and s.surge_window_minutes is not null
       and auth.uid() is not null and auth.uid() = new.user_id
       and not exists (select 1 from social_invites i where i.invitee_id = new.user_id and i.target_id = new.gathering_id
                                                      and i.invite_type = 'gathering') then
      perform pg_advisory_xact_lock(hashtext('gathering_surge:' || v_ref::text));  -- parallel joins counted together
      insert into private.behavior_events (user_id, kind, ref) values (new.user_id, 'attendee_join', v_ref::text);
      select count(distinct e.user_id),
             count(distinct e.user_id) filter (where private.trust_level(e.user_id) = 'new')
        into v_n, v_new
        from private.behavior_events e
       where e.kind = 'attendee_join' and e.ref = v_ref::text
         and e.at > now() - make_interval(mins => s.surge_window_minutes);
      if v_n >= s.surge_min_joiners then
        perform private.behavior_note_signal(g.host_id,
          case when s.surge_new_share is not null and v_new >= ceil(v_n * s.surge_new_share) then 'attendee_surge_new'
               else 'attendee_surge' end,
          jsonb_build_object('gathering_id', new.gathering_id, 'joiners', v_n, 'new_accounts', v_new,
                             'window_minutes', s.surge_window_minutes));
      end if;
    end if;

    -- large public gathering by attendance: approved guests (host excluded) reach the number
    if s.large_min_attendees is not null and g.visibility = 'everyone' and new.status = 'approved'
       and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
      perform pg_advisory_xact_lock(hashtext('gathering_size:' || new.gathering_id::text));
      select count(*) into v_n from gathering_interest gi
       where gi.gathering_id = new.gathering_id and gi.status = 'approved' and gi.user_id <> g.host_id;
      if v_n >= s.large_min_attendees then
        perform private.gathering_note_large(new.gathering_id, 'attendees', v_n);
      end if;
    end if;
  exception when others then
    raise warning 'gathering join signals: %', sqlerrm;  -- never fails the join
  end;
  return null;
end;
$function$;
revoke all on function public._gathering_signal_join() from public, anon, authenticated;
drop trigger if exists zz_gathering_signal_join on public.gathering_interest;
create trigger zz_gathering_signal_join after insert or update of status on public.gathering_interest
  for each row execute function public._gathering_signal_join();

-- 6. Create-then-cancel: the host's own cancellation / delete (cancel_gathering deletes the row).
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
drop trigger if exists zz_gathering_signal_cancel on public.gatherings;
create trigger zz_gathering_signal_cancel before delete on public.gatherings
  for each row execute function public._gathering_signal_cancel();

-- 7. Retention: as 20270363 + the cancel log 30 days, size marks 180 days (a mark only stops a second signal).
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
  delete from private.gathering_cancel_log where cancelled_at < now() - interval '30 days';
  delete from private.gathering_size_marks where marked_at < now() - interval '180 days';
$function$;
revoke all on function private.purge_behavior_signals() from public, anon, authenticated;
