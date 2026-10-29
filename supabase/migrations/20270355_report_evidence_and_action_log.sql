-- Trust & safety I3 (owner priority 2026-10-28; audit fix 8): a report carries the reported content and a record of
-- what the admin did. Staged after 20270348-20270354; deploy only with its own approval.
-- Before: a report stored reason + free text only (no link to the message, nothing kept if the message was deleted or
-- disappeared), and "Mark Resolved" left no trace of who resolved it or why.
-- Now:
--   reports.content_type / content_id   optional reference to what was reported: a 1:1 message, a gathering / community /
--                                       plan / business message, or a whole 1:1 chat ('match_chat').
--   reports.content_excerpt (+ sent_at, captured_at)
--                                       a copy of that content taken by the SERVER at the moment of the report, read as
--                                       the reporter (security invoker, so only content the reporter could already see),
--                                       and only content the reported person wrote: a 1:1 chat keeps the reported
--                                       person's last 20 messages there. Whatever the client sends in these columns is
--                                       replaced. Survives the message being deleted or disappearing.
--   Evidence is fixed: after insert nobody (admins included) can change who / what / why / the copy; only `resolved`.
--   report_actions                      append-only log (admins read it; no client writes): every resolve / reopen,
--                                       whatever the path, with the admin and time; admin_resolve_report records the
--                                       outcome (no action / action taken) + a note. Suspensions stay in
--                                       account_moderation_actions (20270351), linked by report id.
-- Not changed: who can report (anyone signed in, about anyone), the reasons, a report about a profile (no content),
-- and reports still go when either account is deleted (retention is an owner decision, recorded in the fixes doc).

alter table public.reports
  add column if not exists content_type text,
  add column if not exists content_id uuid,
  add column if not exists content_excerpt text,
  add column if not exists content_sent_at timestamptz,
  add column if not exists content_captured_at timestamptz;

alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat'));
alter table public.reports drop constraint if exists reports_content_pair_check;
alter table public.reports add constraint reports_content_pair_check check ((content_type is null) = (content_id is null));

-- Runs as the reporter (no SECURITY DEFINER): every read below goes through the same RLS as their own app.
create or replace function public._capture_report_content()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sender uuid;
  v_body text;
  v_at timestamptz;
begin
  new.content_excerpt := null;
  new.content_sent_at := null;
  new.content_captured_at := null;
  if new.content_type is null then
    return new;
  end if;

  if new.content_type = 'match_chat' then
    if not exists (select 1 from matches m
                    where m.id = new.content_id
                      and ((m.user_a = new.reporter_id and m.user_b = new.reported_id)
                        or (m.user_b = new.reporter_id and m.user_a = new.reported_id))) then
      raise exception 'That chat isn''t with this person' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    select left(string_agg(to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC: '
                           || coalesce(nullif(btrim(x.body), ''), '[' || coalesce(x.media_type, 'media') || ']'),
                           E'\n' order by x.created_at), 4000),
           max(x.created_at)
      into v_body, v_at
      from (select mm.body, mm.media_type, mm.created_at from messages mm
             where mm.match_id = new.content_id and mm.sender_id = new.reported_id
             order by mm.created_at desc limit 20) x;
    new.content_excerpt := v_body;
    new.content_sent_at := v_at;
    new.content_captured_at := now();
    return new;
  end if;

  if new.content_type = 'message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[' || coalesce(m.media_type, 'media') || ']'), m.created_at
      into v_sender, v_body, v_at from messages m where m.id = new.content_id;
  elsif new.content_type = 'gathering_message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[media]'), m.created_at
      into v_sender, v_body, v_at from gathering_messages m where m.id = new.content_id;
  elsif new.content_type = 'community_message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[media]'), m.created_at
      into v_sender, v_body, v_at from community_messages m where m.id = new.content_id;
  elsif new.content_type = 'plan_message' then
    select m.sender_id, m.body, m.created_at
      into v_sender, v_body, v_at from plan_messages m where m.id = new.content_id;
  elsif new.content_type = 'business_message' then
    select m.sender_id, m.body, m.created_at
      into v_sender, v_body, v_at from business_messages m where m.id = new.content_id;
  end if;

  -- not visible to the reporter, gone, or written by someone else: refused, never attached to the wrong person
  if v_sender is null or v_sender is distinct from new.reported_id then
    raise exception 'That message isn''t from this person' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  new.content_excerpt := left(v_body, 2000);
  new.content_sent_at := v_at;
  new.content_captured_at := now();
  return new;
end;
$function$;
revoke all on function public._capture_report_content() from public, anon, authenticated;

drop trigger if exists capture_report_content on public.reports;
create trigger capture_report_content before insert on public.reports
  for each row execute function public._capture_report_content();

-- Evidence never changes after the report is filed; only `resolved` may (admins, by the existing policy).
create or replace function public._freeze_report_evidence()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.id := old.id;
  new.reporter_id := old.reporter_id;
  new.reported_id := old.reported_id;
  new.reason := old.reason;
  new.details := old.details;
  new.created_at := old.created_at;
  new.content_type := old.content_type;
  new.content_id := old.content_id;
  new.content_excerpt := old.content_excerpt;
  new.content_sent_at := old.content_sent_at;
  new.content_captured_at := old.content_captured_at;
  return new;
end;
$function$;
revoke all on function public._freeze_report_evidence() from public, anon, authenticated;

drop trigger if exists freeze_report_evidence on public.reports;
create trigger freeze_report_evidence before update on public.reports
  for each row execute function public._freeze_report_evidence();

create table if not exists public.report_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  action text not null check (action in ('resolved', 'resolved_no_action', 'resolved_action_taken', 'reopened')),
  note text check (note is null or length(btrim(note)) between 1 and 1000),
  admin_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists report_actions_report_idx on public.report_actions (report_id, created_at desc);
alter table public.report_actions enable row level security;
revoke all on public.report_actions from public, anon, authenticated;
grant select on public.report_actions to authenticated;
drop policy if exists "Admins read report actions" on public.report_actions;
create policy "Admins read report actions" on public.report_actions
  for select to authenticated using (check_is_admin(auth.uid()));

-- Every change of `resolved`, whatever the path (incl. the old app's direct "Mark Resolved"), leaves a row.
create or replace function public._log_report_resolution()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.report_action_logged', true), '') = 'true' then
    return null;
  end if;
  if coalesce(new.resolved, false) is distinct from coalesce(old.resolved, false) then
    insert into report_actions (report_id, action, admin_id)
    values (new.id, case when coalesce(new.resolved, false) then 'resolved' else 'reopened' end, auth.uid());
  end if;
  return null;
end;
$function$;
revoke all on function public._log_report_resolution() from public, anon, authenticated;

drop trigger if exists log_report_resolution on public.reports;
create trigger log_report_resolution after update of resolved on public.reports
  for each row execute function public._log_report_resolution();

-- The admin's resolve, with its outcome and a note. Admin only. Returns { already } when it was resolved before.
create or replace function public.admin_resolve_report(report_id_param uuid, outcome_param text, note_param text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_resolved boolean;
  v_note text := nullif(btrim(coalesce(note_param, '')), '');
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if outcome_param not in ('no_action', 'action_taken') then
    raise exception 'Choose an outcome' using errcode = '22023', hint = 'report_outcome';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters' using errcode = '22023', hint = 'report_note_length';
  end if;
  select coalesce(resolved, false) into v_resolved from reports where id = report_id_param for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002', hint = 'report_not_found';
  end if;
  if v_resolved then
    return jsonb_build_object('already', true);
  end if;
  perform set_config('app.report_action_logged', 'true', true);
  update reports set resolved = true where id = report_id_param;
  perform set_config('app.report_action_logged', 'false', true);
  insert into report_actions (report_id, action, note, admin_id)
  values (report_id_param, 'resolved_' || outcome_param, v_note, v_admin);
  return jsonb_build_object('already', false);
end;
$function$;
revoke all on function public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
