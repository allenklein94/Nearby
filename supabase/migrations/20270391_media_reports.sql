-- Reporting a Story or gathering memory photo, removal by the host or an admin, and real file deletion (owner, 2026-11-05;
-- PRODUCT_AUDIT/PUBLIC_MEDIA_AUDIT_2026-11-05.md section 6). Staged after 20270390; own deploy approval. Reuses the existing report
-- path: public.reports, its caps, evidence freeze, admin queue, outcomes and 12-month retention. Needs 20270355, 20270370, 20270372,
-- 20270381 and 20270390. Turns nothing on: public, friends-only and video Stories stay off (20270390).
--
-- 1. reports.content_type 'story' (a row in stories: a Story, a gathering memory, a Business Moment). The server reads it AS THE
--    REPORTER (only what they can see; else refused, hint report_content_mismatch), locks the row, and sets reported_id to the
--    poster whatever the client sent. You can't report your own photo.
-- 2. Evidence: the server copies the facts (kind, audience, gathering, poster, time) into the report and holds that one file, in
--    place, in private.report_media_evidence. The file survives the Story expiring, the poster, host or admin removing it, the
--    gathering going, and the poster's account being deleted. No other file is touched. Clients can't overwrite or delete it:
--    the stories bucket has no client UPDATE or DELETE policy.
-- 3. How long: held while the report is open. Resolved 'no_action' = released at once. Resolved 'action_taken', or the plain
--    resolve older admin screens use = kept until the report's own 12-month purge (20270355). Reopening restores the hold if the
--    file still exists. A released or purged file goes when nothing else needs it.
-- 4. Admins only: admin_get_report_media + the Storage policy "Admins can view reported media" (signed links re-checked by
--    Storage), for held files only.
-- 5. Removal: remove_gathering_memory (the gathering's host) and admin_remove_reported_media. The row goes at once, so everyone
--    stops seeing it, and each removal is logged. The poster isn't told. Evidence is unaffected.
-- 6. Defect fixed: delete_expired_stories asked Storage to delete with a POST the API doesn't have (404), so no Story file was
--    ever deleted, on expiry or on removal; removing a row only made the file unreadable. Every deleted row now queues its
--    file, and the hourly job deletes up to 200 unheld, unreferenced files, one DELETE each (the only form that works on both
--    pg_net versions in use). Delivery is fire-and-forget, as before: a refused call isn't retried.

alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat',
                      'business_offer', 'business', 'story'));

-- 20270381's function with one more branch (story); every other branch unchanged. Runs as the reporter.
create or replace function public._capture_report_content()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sender uuid;
  v_body text;
  v_at timestamptz;
  v_partner uuid;
begin
  new.content_excerpt := null;
  new.content_sent_at := null;
  new.content_captured_at := null;
  if new.content_type is null then
    return new;
  end if;

  if new.content_type = 'story' then
    -- read as the reporter: only a Story or memory they can see. Who posted it and the copy are set next, server side, by
    -- _capture_report_story.
    select st.user_id, st.created_at into v_sender, v_at from stories st where st.id = new.content_id;
    if v_sender is null then
      raise exception 'That photo isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    new.content_sent_at := v_at;
    new.content_captured_at := now();
    return new;
  end if;

  if new.content_type = 'business' then
    -- read as the reporter: only an active business they can see (brand_partners' own read policy)
    select bp.id,
           concat_ws(E'\n',
             nullif(btrim(bp.address), ''),
             nullif(btrim(bp.description), ''))
      into v_partner, v_body
      from brand_partners bp
     where bp.id = new.content_id;
    if v_partner is null then
      raise exception 'That business isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    -- it is about the business itself; its name is added next by _capture_report_business (server side)
    new.content_excerpt := left(coalesce(v_body, ''), 1800);
    new.content_captured_at := now();
    return new;
  end if;

  if new.content_type = 'business_offer' then
    -- read as the reporter: only an offer they can see (their own request, their group plan, match or gathering)
    select o.partner_id,
           concat_ws(E'\n',
             nullif(btrim(o.offer_title), ''),
             nullif(btrim(o.offer_description), ''),
             case when coalesce(array_length(o.included_items, 1), 0) > 0
                  then 'Included: ' || array_to_string(o.included_items, ', ') end,
             case when nullif(btrim(o.redemption_instructions), '') is not null
                  then 'Redemption: ' || btrim(o.redemption_instructions) end),
           coalesce(o.responded_at, o.created_at)
      into v_partner, v_body, v_at
      from business_request_offers o
     where o.id = new.content_id and o.offer_description is not null;
    if v_partner is null then
      raise exception 'That offer isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    -- who answers for it (its manager) + its name are set next by _capture_report_business_offer (server side)
    new.content_excerpt := left(coalesce(v_body, ''), 1800);
    new.content_sent_at := v_at;
    new.content_captured_at := now();
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

-- One row per report that names a photo; the file stays where it is. No client access.
create table if not exists private.report_media_evidence (
  report_id uuid primary key references public.reports(id) on delete cascade,
  story_id uuid not null,
  media_path text not null,
  media_type text not null,
  object_id uuid,                         -- storage.objects.id at the moment of the report; null = the file was already missing
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists report_media_evidence_path_idx on private.report_media_evidence (media_path);
revoke all on private.report_media_evidence from public, anon, authenticated;

-- Files waiting to be deleted from Storage. No client access.
create table if not exists private.story_file_cleanup (
  media_path text primary key,
  queued_at timestamptz not null default now()
);
revoke all on private.story_file_cleanup from public, anon, authenticated;

-- Who removed a photo that wasn't theirs. Ids and times only; kept 12 months. No client access.
create table if not exists private.story_media_removals (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null,
  gathering_id uuid,
  poster_id uuid references public.profiles(id) on delete set null,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_as text not null check (removed_as in ('host', 'admin')),
  report_id uuid,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now()
);
revoke all on private.story_media_removals from public, anon, authenticated;

-- Runs right after _capture_report_content (trigger names sort: ..._business, ..._offer, ..._story), which has already proved, as
-- the reporter, that they can see it (content_captured_at is set only then; a client can't set it). The row lock makes a report
-- and an expiry or removal happen one after the other: whichever comes second sees the first.
create or replace function private._capture_report_story()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_story stories%rowtype;
  v_title text;
begin
  if new.content_type is distinct from 'story' then
    return new;
  end if;
  if new.content_captured_at is null then
    raise exception 'That photo isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  select * into v_story from stories s where s.id = new.content_id for update;
  if not found then
    raise exception 'That photo isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  if v_story.user_id = new.reporter_id then
    raise exception 'You can''t report your own photo' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  new.reported_id := v_story.user_id;
  if v_story.gathering_id is not null then
    select g.title into v_title from gatherings g where g.id = v_story.gathering_id;
  end if;
  new.content_excerpt := left(case
      when v_story.gathering_id is not null then 'Gathering memory: ' || coalesce(v_title, '(no title)')
      when v_story.partner_id is not null then 'Business Moment'
      when v_story.is_public then 'Public Story'
      else 'Friends-only Story' end
    || ' (' || v_story.media_type || ')', 2000);
  return new;
end;
$function$;
revoke all on function private._capture_report_story() from public, anon, authenticated;

drop trigger if exists capture_report_content_story on public.reports;
create trigger capture_report_content_story before insert on public.reports
  for each row execute function private._capture_report_story();

create or replace function private._hold_reported_story_media()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.content_type = 'story' then
    insert into private.report_media_evidence (report_id, story_id, media_path, media_type, object_id)
    select new.id, s.id, s.media_path, s.media_type,
           (select o.id from storage.objects o where o.bucket_id = 'stories' and o.name = s.media_path)
      from stories s where s.id = new.content_id;
  end if;
  return null;
end;
$function$;
revoke all on function private._hold_reported_story_media() from public, anon, authenticated;

drop trigger if exists hold_reported_story_media on public.reports;
create trigger hold_reported_story_media after insert on public.reports
  for each row execute function private._hold_reported_story_media();

-- The outcome decides how long the file stays: every resolve and reopen writes one report_actions row, whatever the path.
create or replace function private._report_media_follow_outcome()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.action = 'resolved_no_action' then
    update private.report_media_evidence set released_at = now() where report_id = new.report_id and released_at is null;
  elsif new.action = 'reopened' then
    update private.report_media_evidence set released_at = null where report_id = new.report_id;
  end if;
  return null;
end;
$function$;
revoke all on function private._report_media_follow_outcome() from public, anon, authenticated;

drop trigger if exists report_media_follow_outcome on public.report_actions;
create trigger report_media_follow_outcome after insert on public.report_actions
  for each row execute function private._report_media_follow_outcome();

create or replace function private._queue_story_file()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into private.story_file_cleanup (media_path) values (old.media_path) on conflict (media_path) do nothing;
  return null;
end;
$function$;
revoke all on function private._queue_story_file() from public, anon, authenticated;

drop trigger if exists queue_story_file on public.stories;
create trigger queue_story_file after delete on public.stories
  for each row execute function private._queue_story_file();

-- Files the old job left behind (production held 2 files and 0 stories, read-only 2026-11-05): nobody can read them, and they
-- go on the next run. A file with a row is skipped by the job itself.
insert into private.story_file_cleanup (media_path)
select o.name from storage.objects o
 where o.bucket_id = 'stories' and not exists (select 1 from public.stories s where s.media_path = o.name)
on conflict (media_path) do nothing;

-- Baseline's function: same schedule, same rule for what expires (gathering memories stay). What changed: the delete now reaches
-- Storage, a held file is skipped, and it also clears removed photos and year-old removal rows. Service role only (20270310).
create or replace function public.delete_expired_stories()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  service_key text;
  v_path text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  delete from stories where expires_at <= now() and gathering_id is null;
  delete from private.story_media_removals where created_at < now() - interval '12 months';

  if service_key is null then
    return;
  end if;
  for v_path in
    select q.media_path from private.story_file_cleanup q
     where not exists (select 1 from stories s where s.media_path = q.media_path)
       and not exists (select 1 from private.report_media_evidence e where e.media_path = q.media_path and e.released_at is null)
     order by q.queued_at
     limit 200
     for update of q skip locked
  loop
    perform net.http_delete(
      url := 'https://enmosvippabmuqslzrox.supabase.co/storage/v1/object/stories/' || v_path,
      headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'apikey', service_key));
    delete from private.story_file_cleanup where media_path = v_path;
  end loop;
end;
$function$;
revoke all on function public.delete_expired_stories() from public, anon, authenticated, service_role;
grant execute on function public.delete_expired_stories() to service_role;

create or replace function public.remove_gathering_memory(story_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_story stories%rowtype;
begin
  if v_user is null or private.account_suspended(v_user) then
    raise exception 'That memory isn''t available' using errcode = '42501', hint = 'memory_not_removable';
  end if;
  select s.* into v_story from stories s
    join gatherings g on g.id = s.gathering_id
   where s.id = story_id_param and g.host_id = v_user
   for update of s;
  if not found then
    raise exception 'That memory isn''t available' using errcode = '42501', hint = 'memory_not_removable';
  end if;
  delete from stories where id = v_story.id;
  insert into private.story_media_removals (story_id, gathering_id, poster_id, removed_by, removed_as)
  values (v_story.id, v_story.gathering_id, v_story.user_id, v_user, 'host');
end;
$function$;
revoke all on function public.remove_gathering_memory(uuid) from public, anon;
grant execute on function public.remove_gathering_memory(uuid) to authenticated;

-- Paths are useless without the Storage policy below. Admin only. Reports that name no photo return no row.
create or replace function public.admin_get_report_media(report_ids_param uuid[])
returns table (report_id uuid, media_path text, media_type text, file_held boolean, still_live boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return query
    select e.report_id, e.media_path, e.media_type,
           e.released_at is null and exists (select 1 from storage.objects o where o.bucket_id = 'stories' and o.name = e.media_path),
           exists (select 1 from stories s where s.id = e.story_id)
      from private.report_media_evidence e
     where e.report_id = any(report_ids_param);
end;
$function$;
revoke all on function public.admin_get_report_media(uuid[]) from public, anon;
grant execute on function public.admin_get_report_media(uuid[]) to authenticated;

-- Removes the reported photo for everyone. The report stays open and the file stays held: the admin still resolves the report.
create or replace function public.admin_remove_reported_media(report_id_param uuid, note_param text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(note_param, '')), '');
  v_story stories%rowtype;
  v_story_id uuid;
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters' using errcode = '22023', hint = 'report_note_length';
  end if;
  select e.story_id into v_story_id from private.report_media_evidence e where e.report_id = report_id_param;
  if v_story_id is null then
    raise exception 'That report has no photo' using errcode = 'P0002', hint = 'report_not_found';
  end if;
  select * into v_story from stories s where s.id = v_story_id for update;
  if not found then
    return jsonb_build_object('already', true);
  end if;
  delete from stories where id = v_story.id;
  insert into private.story_media_removals (story_id, gathering_id, poster_id, removed_by, removed_as, report_id, note)
  values (v_story.id, v_story.gathering_id, v_story.user_id, v_admin, 'admin', report_id_param, v_note);
  return jsonb_build_object('already', false);
end;
$function$;
revoke all on function public.admin_remove_reported_media(uuid, text) from public, anon;
grant execute on function public.admin_remove_reported_media(uuid, text) to authenticated;

-- True only for a signed-in admin and a held file. Used by the Storage policy, so a signed link is issued only after this check.
create or replace function public.admin_report_media_visible(p_path text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and check_is_admin(auth.uid())
     and exists (select 1 from private.report_media_evidence e where e.media_path = p_path and e.released_at is null);
$function$;
revoke all on function public.admin_report_media_visible(text) from public, anon;
grant execute on function public.admin_report_media_visible(text) to authenticated;

drop policy if exists "Admins can view reported media" on storage.objects;
create policy "Admins can view reported media" on storage.objects
  for select to authenticated
  using (bucket_id = 'stories' and public.admin_report_media_visible(name));
