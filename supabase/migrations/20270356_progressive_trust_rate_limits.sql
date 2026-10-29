-- Trust & safety I2 (owner, 2026-10-28 requirements; direction approved with refinements 2026-10-29): server-side
-- RATE LIMITS by trust level. Staged after 20270355; deploy only with its own approval.
-- This migration builds the mechanism only and ENFORCES NOTHING: private.rate_limit_rules starts empty and
-- private.trust_settings.established_min_account_age starts null. The numbers are a separate migration (20270358), so the
-- mechanism and the numbers are reviewed and deployed as two steps.
--
-- Two separate mechanisms (owner, 2026-10-29):
--   1. Rate limits (this file): automatic, only about VOLUME of one's own activity in a time window. Refused with
--      hint 'rate_limited' and a friendly sentence; nothing is recorded against the person, nothing tightens on its own.
--   2. Account restriction: only the admin's suspension (20270351), on evidence / review. Reports never restrict and
--      never lower anyone's limits (a report is not counted against the reported person anywhere here).
--
-- Trust levels (no score, nothing visible): 'restricted' = suspended (already refused every social action by 20270351);
-- 'established' = verified phone AND account at least trust_settings.established_min_account_age old (null = nobody is
-- established yet; account age alone never suffices: the phone is required too); 'new' = everyone else.
-- Actions limited (each counted from the rows the person really wrote; no counter columns to drift):
--   direct_message    1:1 messages (only inside a mutual match: an established relationship)
--   group_message     gathering + community + plan chat messages together (members / attendees)
--   business_message  messages in a business conversation, either side
--   invitation        gathering / community invitations sent (social_invites; friends only today)
--   report            reports filed for ordinary reasons (a cap protects admins from floods; reports never restrict anyone)
--   urgent_report     reports for an urgent safety reason (private.is_urgent_report_reason: harassment / abuse, an
--                     underage user): NOT counted against the ordinary cap, only against their own, much higher ceiling
--   commercial_post   public posts that carry commercial contact details (owner decision 2026-10-29: "business-like posting"
--                     = REPEATED commercial solicitation, not event organizing): a public gathering (visibility 'everyone')
--                     or public community whose title/name or description contains a link, an email address or a phone
--                     number (private.has_commercial_contact), counted when created that way or when an edit adds one.
--                     An ordinary gathering, even with a price or a time, never counts.
--   business_request  requests sent to businesses (beyond the existing 10-minute duplicate check)
--   name_change       changes of display name after it was first set
--   photo_change      main-photo replacements after the first + extra photos added or replaced
-- Stranger outreach (friend requests, waves) already has its own daily limits; relationship actions get their own rows,
-- so more generous numbers for friends / matches / attendees are a matter of the approved rows. Account age never raises
-- an unsolicited-outreach limit: those actions get the same numbers at both levels (20270358).
-- Not limited here: service-role and trusted server writes (app.trusted_update), anyone not signed in (RLS refuses them).

create table if not exists private.trust_settings (
  id boolean primary key default true check (id),
  established_min_account_age interval check (established_min_account_age is null or established_min_account_age >= interval '0'),
  updated_at timestamptz not null default now()
);
insert into private.trust_settings (id) values (true) on conflict (id) do nothing;

create table if not exists private.rate_limit_rules (
  action text not null check (action in ('direct_message', 'group_message', 'business_message', 'invitation', 'report',
                                         'urgent_report', 'business_request', 'name_change', 'photo_change',
                                         'commercial_post')),
  trust_level text not null check (trust_level in ('new', 'established')),
  window_seconds integer not null check (window_seconds between 60 and 2592000),
  max_count integer not null check (max_count >= 1),
  primary key (action, trust_level, window_seconds)
);

-- name / photo changes and commercial posts leave a timestamp so they can be counted (kept 30 days, the longest window)
create table if not exists private.limited_action_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  field text not null check (field in ('name', 'photo', 'commercial_post')),
  changed_at timestamptz not null default now()
);
create index if not exists limited_action_log_user_idx on private.limited_action_log (user_id, field, changed_at desc);
revoke all on private.trust_settings, private.rate_limit_rules, private.limited_action_log from public, anon, authenticated;

-- Urgent safety reasons (the values ReportBlockModal saves): exempt from the ordinary report cap.
create or replace function private.is_urgent_report_reason(p text)
returns boolean
language sql
immutable
as $function$
  select coalesce(p in ('Harassment or abuse', 'Underage user'), false);
$function$;
revoke all on function private.is_urgent_report_reason(text) from public, anon, authenticated;

-- Commercial contact details: a link, an email address, or a phone number (10-15 digits in one run of digits and phone
-- punctuation, after removing ISO dates and clock times so "2026-11-04 10:00" never counts). Prices never count.
create or replace function private.has_commercial_contact(p text)
returns boolean
language plpgsql
immutable
as $function$
declare
  v text := lower(coalesce(p, ''));
  m text[];
begin
  if v = '' then return false; end if;
  if v ~ '(https?://|www\.)' then return true; end if;
  if v ~ '\m[a-z0-9-]+\.(com|net|org|io|co|biz|info|shop|store|ly|me|app|link|site|online)\M' then return true; end if;
  if v ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then return true; end if;
  v := regexp_replace(v, '\d{4}-\d{1,2}-\d{1,2}', ' ', 'g');
  v := regexp_replace(v, '\d{1,2}:\d{2}', ' ', 'g');
  for m in select regexp_matches(v, '\+?[0-9][0-9 ().-]{8,}[0-9]', 'g') loop
    if length(regexp_replace(m[1], '[^0-9]', '', 'g')) between 10 and 15 then return true; end if;
  end loop;
  return false;
end;
$function$;
revoke all on function private.has_commercial_contact(text) from public, anon, authenticated;

create or replace function private.trust_level(uid uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_age interval := (select established_min_account_age from private.trust_settings where id);
  v_created timestamptz;
begin
  if uid is null then return 'new'; end if;
  if private.account_suspended(uid) then return 'restricted'; end if;
  if v_age is null or not private.has_verified_phone(uid) then return 'new'; end if;
  select created_at into v_created from auth.users where id = uid;
  if v_created is not null and v_created <= now() - v_age then return 'established'; end if;
  return 'new';
end;
$function$;
revoke all on function private.trust_level(uuid) from public, anon, authenticated;

-- How many times `uid` did `action` since `since` (the rows they really wrote).
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
  end;
$function$;
revoke all on function private.rate_limit_count(text, uuid, timestamptz) from public, anon, authenticated;

-- The ONE check. Every rule for this action + the person's level must have room for one more.
create or replace function private.enforce_rate_limit(p_action text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_level text;
  r record;
begin
  if v_uid is null or coalesce(current_setting('app.trusted_update', true), '') = 'true' then return; end if;
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
revoke all on function private.enforce_rate_limit(text) from public, anon, authenticated;

create or replace function public._rate_limit_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.enforce_rate_limit(tg_argv[0]);
  return new;
end;
$function$;
revoke all on function public._rate_limit_insert() from public, anon, authenticated;

drop trigger if exists zz_rate_limit on public.messages;
create trigger zz_rate_limit before insert on public.messages
  for each row execute function public._rate_limit_insert('direct_message');
drop trigger if exists zz_rate_limit on public.gathering_messages;
create trigger zz_rate_limit before insert on public.gathering_messages
  for each row execute function public._rate_limit_insert('group_message');
drop trigger if exists zz_rate_limit on public.community_messages;
create trigger zz_rate_limit before insert on public.community_messages
  for each row execute function public._rate_limit_insert('group_message');
drop trigger if exists zz_rate_limit on public.plan_messages;
create trigger zz_rate_limit before insert on public.plan_messages
  for each row execute function public._rate_limit_insert('group_message');
drop trigger if exists zz_rate_limit on public.business_messages;
create trigger zz_rate_limit before insert on public.business_messages
  for each row execute function public._rate_limit_insert('business_message');
drop trigger if exists zz_rate_limit on public.social_invites;
create trigger zz_rate_limit before insert on public.social_invites
  for each row execute function public._rate_limit_insert('invitation');
-- Reports: the reason decides which cap applies (urgent safety reasons have their own, higher one).
create or replace function public._rate_limit_report()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.enforce_rate_limit(case when private.is_urgent_report_reason(new.reason) then 'urgent_report' else 'report' end);
  return new;
end;
$function$;
revoke all on function public._rate_limit_report() from public, anon, authenticated;
drop trigger if exists zz_rate_limit on public.reports;
create trigger zz_rate_limit before insert on public.reports
  for each row execute function public._rate_limit_report();
drop trigger if exists zz_rate_limit on public.business_requests;
create trigger zz_rate_limit before insert on public.business_requests
  for each row execute function public._rate_limit_insert('business_request');

-- Name and photo changes: the first name / main photo is not a change; a later one is checked, then logged.
create or replace function public._rate_limit_profile_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or auth.uid() is distinct from new.id
     or coalesce(current_setting('app.trusted_update', true), '') = 'true' then
    return new;
  end if;
  if old.display_name is not null and new.display_name is distinct from old.display_name then
    perform private.enforce_rate_limit('name_change');
    insert into private.limited_action_log (user_id, field) values (new.id, 'name');
  end if;
  if old.photo_url is not null and new.photo_url is not null and new.photo_url is distinct from old.photo_url then
    perform private.enforce_rate_limit('photo_change');
    insert into private.limited_action_log (user_id, field) values (new.id, 'photo');
  end if;
  return new;
end;
$function$;
revoke all on function public._rate_limit_profile_change() from public, anon, authenticated;
drop trigger if exists zz_rate_limit_profile_change on public.profiles;
create trigger zz_rate_limit_profile_change before update of display_name, photo_url on public.profiles
  for each row execute function public._rate_limit_profile_change();

create or replace function public._rate_limit_extra_photo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or auth.uid() is distinct from new.user_id
     or coalesce(current_setting('app.trusted_update', true), '') = 'true' then
    return new;
  end if;
  if tg_op = 'INSERT' or new.photo_url is distinct from old.photo_url then
    perform private.enforce_rate_limit('photo_change');
    insert into private.limited_action_log (user_id, field) values (new.user_id, 'photo');
  end if;
  return new;
end;
$function$;
revoke all on function public._rate_limit_extra_photo() from public, anon, authenticated;
drop trigger if exists zz_rate_limit_extra_photo on public.profile_photos;
create trigger zz_rate_limit_extra_photo before insert or update of photo_url on public.profile_photos
  for each row execute function public._rate_limit_extra_photo();

-- Commercial posts: a public gathering / community whose text carries commercial contact details, when created that way
-- or when an edit adds them (an edit of an already-counted post is not counted again).
create or replace function public._rate_limit_commercial_post()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_public boolean;
  v_new boolean;
  v_old boolean := false;
  v_trusted text := current_setting('app.trusted_update', true);
begin
  -- app.trusted_update is NOT a bypass here: the live gathering daily-limit trigger (enforce_gathering_daily_limit) sets
  -- it and leaves it on for the rest of the request, so every gathering insert would otherwise skip this check. A post a
  -- person creates or edits counts whichever path wrote it.
  if auth.uid() is null then
    return new;
  end if;
  if tg_table_name = 'gatherings' then
    v_owner := new.host_id;
    v_public := new.visibility = 'everyone';
    v_new := private.has_commercial_contact(new.title) or private.has_commercial_contact(new.description);
    if tg_op = 'UPDATE' then
      v_old := old.visibility = 'everyone'
               and (private.has_commercial_contact(old.title) or private.has_commercial_contact(old.description));
    end if;
  else
    v_owner := new.creator_id;
    v_public := coalesce(new.is_public, false);
    v_new := private.has_commercial_contact(new.name) or private.has_commercial_contact(new.description);
    if tg_op = 'UPDATE' then
      v_old := coalesce(old.is_public, false)
               and (private.has_commercial_contact(old.name) or private.has_commercial_contact(old.description));
    end if;
  end if;
  if auth.uid() is distinct from v_owner or not v_public or not v_new or v_old then
    return new;
  end if;
  perform set_config('app.trusted_update', 'false', true);
  perform private.enforce_rate_limit('commercial_post');
  perform set_config('app.trusted_update', coalesce(v_trusted, ''), true);
  insert into private.limited_action_log (user_id, field) values (v_owner, 'commercial_post');
  return new;
end;
$function$;
revoke all on function public._rate_limit_commercial_post() from public, anon, authenticated;
drop trigger if exists zz_rate_limit_commercial_post on public.gatherings;
create trigger zz_rate_limit_commercial_post before insert or update of title, description, visibility on public.gatherings
  for each row execute function public._rate_limit_commercial_post();
drop trigger if exists zz_rate_limit_commercial_post on public.communities;
create trigger zz_rate_limit_commercial_post before insert or update of name, description, is_public on public.communities
  for each row execute function public._rate_limit_commercial_post();

-- Change timestamps older than the longest window are not needed.
create or replace function private.purge_limited_action_log()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.limited_action_log where changed_at < now() - interval '30 days';
$function$;
revoke all on function private.purge_limited_action_log() from public, anon, authenticated;
select cron.schedule('purge-limited-action-log', '17 4 * * *', 'select private.purge_limited_action_log();');
