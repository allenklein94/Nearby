-- Behaviour review signals (owner, 2026-10-30: close the four remaining trust & safety gaps before launch). Staged after
-- 20270362, separate from the 0348-0362 sequence; deploy only with its own approval. This migration builds the detection
-- foundations and ACTIVATES NOTHING: private.behavior_signal_settings starts all null / false, so no event is recorded, no
-- signal is noted and no case opens until the owner approves numbers in a separate migration (as 0356 -> 0358).
--
-- What it can detect (deterministic rules, no AI, no score):
--   repeated_messages   the same (or near-identical, trigram) text of at least N characters sent by one person into at
--                       least N distinct conversations within a window. A group chat is ONE conversation however many
--                       people are in it. Not counted: chats of the sender's own gatherings / communities / plans
--                       (announcements to your own groups), replies a business sends from its business side.
--   join_burst          joins of at least N distinct gatherings within a window. A recurring series counts once; leaving
--                       and re-joining one gathering counts once; joining a gathering you were invited to never counts;
--                       status changes (RSVP / approval / waitlist) never count (INSERT only). Joining is NEVER capped.
--   location_switching  presence reports the `report-presence` edge function already REJECTS as implausible travel
--                       (> 700 mph since the person's previous report) that point to at least N distinct ~1-degree cells
--                       within a window (max 60 min). Only the coarse cell is kept, for 1 hour (presence's own retention);
--                       no coordinates, no movement history, no device data. Accepted reports (real travel, flights)
--                       never count. Needs the report-presence change in the same commit, deployed with this migration.
--   limit_burst         reaching at least N DIFFERENT 0356 rate limits within a window (the allowed action that uses the
--                       last unit of a rule). A refused attempt cannot be recorded (its transaction rolls back), so this
--                       counts reaching, not refusals. Reports (ordinary and urgent) never count against the reporter.
-- A signal is a private note about one person. A REVIEW CASE (the 0357 queue, signal 'behavior') opens only when
-- review_cases_enabled AND either signals of at least case_min_signal_kinds distinct kinds fall within case_window_hours
-- (corroboration), or a kind listed in case_alone_kinds (each intrinsically multi-evidence) is present. One open case per
-- person (later signals extend it); at most max_new_cases_per_day new behaviour cases a day (flood protection; signals are
-- still noted and a later signal re-evaluates). NOTHING here bans, suspends, hides, restricts or limits anyone, or tells
-- anyone; acting on a case is the admin's existing suspension (20270351). Reports are not an input.
-- Never breaks the action it observes: every detector runs in its own exception block. Concurrency: while a detector is
-- on, it holds a per-person transaction lock (behavior_detect, then behavior_signal, then the queue lock: always that
-- order), so one person's parallel messages / joins are counted together; other people never wait on it.
-- Also: (sender_id, created_at) indexes on the five message tables (0356's rate-limit counts and this detector read them).

create table if not exists private.behavior_signal_settings (
  id boolean primary key default true check (id),
  repeat_msg_min_conversations integer check (repeat_msg_min_conversations is null or repeat_msg_min_conversations >= 2),
  repeat_msg_window_minutes integer check (repeat_msg_window_minutes is null or repeat_msg_window_minutes between 5 and 1440),
  repeat_msg_min_chars integer check (repeat_msg_min_chars is null or repeat_msg_min_chars between 1 and 500),
  repeat_msg_min_similarity real check (repeat_msg_min_similarity is null or repeat_msg_min_similarity between 0.6 and 1),
  join_burst_min_gatherings integer check (join_burst_min_gatherings is null or join_burst_min_gatherings >= 3),
  join_burst_window_minutes integer check (join_burst_window_minutes is null or join_burst_window_minutes between 5 and 1440),
  location_min_cells integer check (location_min_cells is null or location_min_cells >= 2),
  location_window_minutes integer check (location_window_minutes is null or location_window_minutes between 5 and 60),
  limit_burst_min_actions integer check (limit_burst_min_actions is null or limit_burst_min_actions >= 2),
  limit_burst_window_minutes integer check (limit_burst_window_minutes is null or limit_burst_window_minutes between 5 and 1440),
  review_cases_enabled boolean not null default false,
  case_min_signal_kinds integer check (case_min_signal_kinds is null or case_min_signal_kinds between 2 and 4),
  case_window_hours integer check (case_window_hours is null or case_window_hours between 1 and 168),
  case_alone_kinds text[] not null default '{}'
    check (case_alone_kinds <@ array['repeated_messages', 'join_burst', 'location_switching', 'limit_burst']),
  max_new_cases_per_day integer check (max_new_cases_per_day is null or max_new_cases_per_day >= 1),
  updated_at timestamptz not null default now()
);
insert into private.behavior_signal_settings (id) values (true) on conflict (id) do nothing;

-- Short-lived raw events (only while a detector is active): joins, limits reached, rejected location jumps (coarse cell).
create table if not exists private.behavior_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('gathering_join', 'limit_reached', 'location_jump')),
  ref text not null,
  at timestamptz not null default now()
);
create index if not exists behavior_events_user_idx on private.behavior_events (user_id, kind, at desc);

create table if not exists private.behavior_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('repeated_messages', 'join_burst', 'location_switching', 'limit_burst')),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  hits integer not null default 1 check (hits >= 1),
  evidence jsonb not null default '{}'::jsonb
);
create index if not exists behavior_signals_user_idx on private.behavior_signals (user_id, last_at desc);
revoke all on private.behavior_signal_settings, private.behavior_events, private.behavior_signals
  from public, anon, authenticated;

-- The ONE review queue (0357) also holds behaviour cases: one subject person, evidence = counts only (never message text,
-- never a location).
alter table private.account_review_cases alter column sha256 drop not null;
alter table private.account_review_cases add column if not exists subject_user uuid references auth.users(id) on delete cascade;
alter table private.account_review_cases add column if not exists evidence jsonb;
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'behavior'));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern'));
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null) and (signal = 'behavior') = (subject_user is not null));
create unique index if not exists account_review_cases_one_open_behavior on private.account_review_cases (subject_user)
  where status = 'open' and signal = 'behavior';

create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at desc);
create index if not exists gathering_messages_sender_created_idx on public.gathering_messages (sender_id, created_at desc);
create index if not exists community_messages_sender_created_idx on public.community_messages (sender_id, created_at desc);
create index if not exists plan_messages_sender_created_idx on public.plan_messages (sender_id, created_at desc);
create index if not exists business_messages_sender_created_idx on public.business_messages (sender_id, created_at desc);

-- Text compared for repeats: lower case, letters and digits only, single spaces.
create or replace function private.normalized_message(p text)
returns text
language sql
immutable
as $function$
  select nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]]+', ' ', 'g'), '\s+', ' ', 'g')), '');
$function$;
revoke all on function private.normalized_message(text) from public, anon, authenticated;

-- Opens / extends the person's behaviour case when the approved case rule holds. Never touches the account.
create or replace function private.behavior_evaluate_case(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.behavior_signal_settings;
  v_kinds text[];
  v_evidence jsonb;
  v_case uuid;
begin
  select * into s from private.behavior_signal_settings where id;
  if not s.review_cases_enabled or s.case_window_hours is null or s.max_new_cases_per_day is null then return; end if;
  select array_agg(distinct kind),
         jsonb_agg(jsonb_build_object('kind', kind, 'first_at', first_at, 'last_at', last_at, 'hits', hits) || evidence
                   order by last_at desc)
    into v_kinds, v_evidence
    from private.behavior_signals
   where user_id = p_user and last_at > now() - make_interval(hours => s.case_window_hours);
  if v_kinds is null then return; end if;
  if not ((s.case_min_signal_kinds is not null and cardinality(v_kinds) >= s.case_min_signal_kinds)
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
  -- flood protection: a fixed number of new behaviour cases a day for the whole queue
  perform pg_advisory_xact_lock(hashtext('behavior_case_queue'));
  if (select count(*) from private.account_review_cases
       where signal = 'behavior' and opened_at > now() - interval '24 hours') >= s.max_new_cases_per_day then
    return;
  end if;
  insert into private.account_review_cases (signal, reason, subject_user, evidence)
    values ('behavior', 'behavior_pattern', p_user, jsonb_build_object('signals', v_evidence))
    on conflict (subject_user) where status = 'open' and signal = 'behavior' do nothing
    returning id into v_case;
  if v_case is not null then
    insert into private.account_review_case_members (case_id, user_id) values (v_case, p_user) on conflict do nothing;
  end if;
end;
$function$;
revoke all on function private.behavior_evaluate_case(uuid) from public, anon, authenticated;

-- Notes one signal (one row per person + kind while it keeps recurring within a day), then re-evaluates the case.
create or replace function private.behavior_note_signal(p_user uuid, p_kind text, p_evidence jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('behavior_signal:' || p_user::text));
  select id into v_id from private.behavior_signals
   where user_id = p_user and kind = p_kind and last_at > now() - interval '24 hours'
   order by last_at desc limit 1;
  if v_id is null then
    insert into private.behavior_signals (user_id, kind, evidence) values (p_user, p_kind, coalesce(p_evidence, '{}'::jsonb));
  else
    update private.behavior_signals set last_at = now(), hits = hits + 1, evidence = coalesce(p_evidence, evidence)
     where id = v_id;
  end if;
  perform private.behavior_evaluate_case(p_user);
end;
$function$;
revoke all on function private.behavior_note_signal(uuid, text, jsonb) from public, anon, authenticated;

-- repeated_messages: called after a person's own message insert.
create or replace function private.behavior_check_repeated_message(p_user uuid, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.behavior_signal_settings;
  v_norm text := private.normalized_message(p_body);
  v_since timestamptz;
  v_n integer;
begin
  select * into s from private.behavior_signal_settings where id;
  if s.repeat_msg_min_conversations is null or s.repeat_msg_window_minutes is null or s.repeat_msg_min_chars is null
     or s.repeat_msg_min_similarity is null then
    return;
  end if;
  if v_norm is null or length(v_norm) < s.repeat_msg_min_chars then return; end if;
  -- one detector run per person at a time: a parallel burst then sees its own earlier messages once they commit
  perform pg_advisory_xact_lock(hashtext('behavior_detect:' || p_user::text));
  v_since := now() - make_interval(mins => s.repeat_msg_window_minutes);
  select count(distinct conv) into v_n from (
      select 'm:' || m.match_id as conv, m.body from messages m
       where m.sender_id = p_user and m.created_at > v_since and m.body is not null
    union all
      select 'g:' || gm.gathering_id, gm.body from gathering_messages gm
       where gm.sender_id = p_user and gm.created_at > v_since
         and not exists (select 1 from gatherings g where g.id = gm.gathering_id and g.host_id = p_user)
    union all
      select 'c:' || cm.community_id, cm.body from community_messages cm
       where cm.sender_id = p_user and cm.created_at > v_since
         and not exists (select 1 from communities c where c.id = cm.community_id and c.creator_id = p_user)
    union all
      select 'p:' || pm.plan_id, pm.body from plan_messages pm
       where pm.sender_id = p_user and pm.created_at > v_since
         and not exists (select 1 from plans pl where pl.id = pm.plan_id and pl.created_by = p_user)
    union all
      select 'b:' || bm.partner_id || ':' || coalesce(bm.conversation_with_id::text, ''), bm.body from business_messages bm
       where bm.sender_id = p_user and bm.created_at > v_since and not coalesce(bm.from_business, false)
  ) x
  where private.normalized_message(x.body) = v_norm
     or (s.repeat_msg_min_similarity < 1
         and private.name_similarity(private.normalized_message(x.body), v_norm) >= s.repeat_msg_min_similarity);
  if v_n >= s.repeat_msg_min_conversations then
    perform private.behavior_note_signal(p_user, 'repeated_messages',
      jsonb_build_object('conversations', v_n, 'window_minutes', s.repeat_msg_window_minutes, 'chars', length(v_norm)));
  end if;
end;
$function$;
revoke all on function private.behavior_check_repeated_message(uuid, text) from public, anon, authenticated;

create or replace function public._behavior_message_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if auth.uid() is null or auth.uid() is distinct from new.sender_id or new.body is null then return null; end if;
    -- a business replying from its business side (read through jsonb: the other tables have no such column)
    if coalesce((to_jsonb(new) ->> 'from_business')::boolean, false) then return null; end if;
    perform private.behavior_check_repeated_message(new.sender_id, new.body);
  exception when others then
    raise warning 'behavior_check_repeated_message: %', sqlerrm;  -- never fails the message
  end;
  return null;
end;
$function$;
revoke all on function public._behavior_message_inserted() from public, anon, authenticated;
drop trigger if exists zz_behavior_signal on public.messages;
create trigger zz_behavior_signal after insert on public.messages
  for each row execute function public._behavior_message_inserted();
drop trigger if exists zz_behavior_signal on public.gathering_messages;
create trigger zz_behavior_signal after insert on public.gathering_messages
  for each row execute function public._behavior_message_inserted();
drop trigger if exists zz_behavior_signal on public.community_messages;
create trigger zz_behavior_signal after insert on public.community_messages
  for each row execute function public._behavior_message_inserted();
drop trigger if exists zz_behavior_signal on public.plan_messages;
create trigger zz_behavior_signal after insert on public.plan_messages
  for each row execute function public._behavior_message_inserted();
drop trigger if exists zz_behavior_signal on public.business_messages;
create trigger zz_behavior_signal after insert on public.business_messages
  for each row execute function public._behavior_message_inserted();

-- join_burst: a person's own new join row. Never refuses or delays the join.
create or replace function public._behavior_gathering_joined()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.behavior_signal_settings;
  v_ref text;
  v_n integer;
begin
  if auth.uid() is null or auth.uid() is distinct from new.user_id then return null; end if;
  begin
    select * into s from private.behavior_signal_settings where id;
    if s.join_burst_min_gatherings is null or s.join_burst_window_minutes is null then return null; end if;
    if exists (select 1 from social_invites i where i.invitee_id = new.user_id and i.target_id = new.gathering_id
                                               and i.invite_type = 'gathering') then
      return null;  -- invited: a solicited join
    end if;
    perform pg_advisory_xact_lock(hashtext('behavior_detect:' || new.user_id::text));  -- parallel joins counted together
    select coalesce(g.recurring_series_id, g.id)::text into v_ref from gatherings g where g.id = new.gathering_id;
    insert into private.behavior_events (user_id, kind, ref) values (new.user_id, 'gathering_join', coalesce(v_ref, new.gathering_id::text));
    select count(distinct ref) into v_n from private.behavior_events
     where user_id = new.user_id and kind = 'gathering_join'
       and at > now() - make_interval(mins => s.join_burst_window_minutes);
    if v_n >= s.join_burst_min_gatherings then
      perform private.behavior_note_signal(new.user_id, 'join_burst',
        jsonb_build_object('gatherings', v_n, 'window_minutes', s.join_burst_window_minutes));
    end if;
  exception when others then
    raise warning 'behavior join_burst: %', sqlerrm;  -- never fails the join
  end;
  return null;
end;
$function$;
revoke all on function public._behavior_gathering_joined() from public, anon, authenticated;
drop trigger if exists zz_behavior_signal on public.gathering_interest;
create trigger zz_behavior_signal after insert on public.gathering_interest
  for each row execute function public._behavior_gathering_joined();

-- limit_burst: the allowed action that reaches a rule's last unit (called from enforce_rate_limit).
create or replace function private.behavior_note_limit_reached(p_user uuid, p_action text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.behavior_signal_settings;
  v_actions text[];
begin
  if p_action in ('report', 'urgent_report') then return; end if;  -- reporting never counts against the reporter
  select * into s from private.behavior_signal_settings where id;
  if s.limit_burst_min_actions is null or s.limit_burst_window_minutes is null then return; end if;
  begin
    perform pg_advisory_xact_lock(hashtext('behavior_detect:' || p_user::text));
    insert into private.behavior_events (user_id, kind, ref) values (p_user, 'limit_reached', p_action);
    select array_agg(distinct ref order by ref) into v_actions from private.behavior_events
     where user_id = p_user and kind = 'limit_reached'
       and at > now() - make_interval(mins => s.limit_burst_window_minutes);
    if cardinality(v_actions) >= s.limit_burst_min_actions then
      perform private.behavior_note_signal(p_user, 'limit_burst',
        jsonb_build_object('actions', to_jsonb(v_actions), 'window_minutes', s.limit_burst_window_minutes));
    end if;
  exception when others then
    raise warning 'behavior limit_burst: %', sqlerrm;  -- never fails the action
  end;
end;
$function$;
revoke all on function private.behavior_note_limit_reached(uuid, text) from public, anon, authenticated;

-- private.enforce_rate_limit(text): body as after 20270361 + note when this action uses a rule's last unit.
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
  v_count bigint;
  v_reached boolean := false;
begin
  if v_uid is null or private.trusted_write_active() /* 20270361: never the forgeable flag */ then return; end if;
  if not exists (select 1 from private.rate_limit_rules where action = p_action) then return; end if;  -- nothing approved
  v_level := private.trust_level(v_uid);
  if v_level = 'restricted' then return; end if;  -- 20270351 refuses it on its own terms
  for r in select window_seconds, max_count from private.rate_limit_rules
            where action = p_action and trust_level = v_level loop
    v_count := private.rate_limit_count(p_action, v_uid, now() - make_interval(secs => r.window_seconds));
    if v_count >= r.max_count then
      raise exception 'You''ve reached the limit for this for now. Please try again later.'
        using errcode = 'P0001', hint = 'rate_limited';
    end if;
    if v_count + 1 >= r.max_count then v_reached := true; end if;
  end loop;
  if v_reached then
    perform private.behavior_note_limit_reached(v_uid, p_action);  -- 20270363: a review signal input, never a restriction
  end if;
end;
$function$;

-- location_switching: called by report-presence (service role) when it REJECTS a report as implausible travel. Keeps only
-- the ~1-degree cell of the rejected claim, for at most 1 hour.
create or replace function public.record_location_jump(p_user uuid, p_area text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.behavior_signal_settings;
  v_lat double precision;
  v_lng double precision;
  v_n integer;
begin
  select * into s from private.behavior_signal_settings where id;
  if s.location_min_cells is null or s.location_window_minutes is null or p_user is null then return false; end if;
  begin
    v_lat := split_part(p_area, ',', 1)::double precision;
    v_lng := split_part(p_area, ',', 2)::double precision;
  exception when others then
    return false;
  end;
  if v_lat is null or v_lng is null or abs(v_lat) > 90 or abs(v_lng) > 180 then return false; end if;
  if not exists (select 1 from auth.users where id = p_user) then return false; end if;
  perform pg_advisory_xact_lock(hashtext('behavior_detect:' || p_user::text));
  insert into private.behavior_events (user_id, kind, ref)
    values (p_user, 'location_jump', round(v_lat)::int || ',' || round(v_lng)::int);
  select count(distinct ref) into v_n from private.behavior_events
   where user_id = p_user and kind = 'location_jump'
     and at > now() - make_interval(mins => s.location_window_minutes);
  if v_n >= s.location_min_cells then
    perform private.behavior_note_signal(p_user, 'location_switching',
      jsonb_build_object('areas', v_n, 'window_minutes', s.location_window_minutes));
  end if;
  return true;
end;
$function$;
revoke all on function public.record_location_jump(uuid, text) from public, anon, authenticated;
grant execute on function public.record_location_jump(uuid, text) to service_role;

-- Retention: location cells 1 hour (presence's own), other events 48 hours (longest window 24 h), signals 30 days.
create or replace function private.purge_behavior_signals()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.behavior_events where kind = 'location_jump' and at < now() - interval '1 hour';
  delete from private.behavior_events where at < now() - interval '48 hours';
  delete from private.behavior_signals where last_at < now() - interval '30 days';
$function$;
revoke all on function private.purge_behavior_signals() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'purge-behavior-signals';
select cron.schedule('purge-behavior-signals', '*/10 * * * *', 'select private.purge_behavior_signals();');

-- Admin review list: as 20270357 + each case's evidence (counts only).
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
             'outcome', c.outcome, 'note', c.note, 'evidence', c.evidence,
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
