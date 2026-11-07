-- Admin-controlled temporary restrictions (owner, 2026-11-07; staged after 20270398). Between "nothing" and a full suspension
-- (20270351): after reviewing the evidence, an admin pauses one or more specific actions on one account for a set time.
--   NOTHING here is automatic: no signal, report, score or limit ever creates a restriction. Only admin_restrict_account does,
--   called by an admin (check_is_admin), never on themselves, with a written reason (10-1000 chars) and a duration of 1-30 days.
--   It ends by itself at expires_at (checked at the moment of each action, so no job is needed and it can never "stick"). An
--   admin may lift it earlier, with a written reason. Every restriction and every lift is kept in an append-only record.
--   The person is told, at the refused action, what is paused and until when (hint 'account_restricted', detail = JSON
--   {"capability", "until"}; the app shows it in their language). It is never hidden or silent, and nothing else changes for
--   them: profile, discovery, existing friends, chats and plans all stay as they are.
-- Capabilities (what each pauses; only writes made BY the restricted person, never rows someone else writes):
--   messages         new messages in every chat (1:1, gathering, community, plan, business), photo comments, gathering questions
--   invitations      new invitations (social_invites: gatherings, communities, plans)
--   friend_requests  new friend requests, Connect / like in friend discovery, waves and notices
--   gatherings       creating a gathering or a community (editing an existing one stays possible)
--   offers           as a business manager: sending or changing a reply, posting / changing availability, perks or updates
--                    (automatic replies already set up keep answering: a customer's request must never fail because of the
--                    business; deactivate or suspend the business for that)
--   links            adding a NEW link to public text or a message (profile, gathering, community, questions, comments, chats);
--                    a link already there may stay; uses 20270396's link detector
-- Not covered (deliberately, first version): discovery reach (would change every discovery reader), editing an existing message.
-- Retention: a restriction and its record are deleted 12 months after it ended (expired or lifted), and with the account,
--   EXCEPT while the report or review case it was decided from is under an active legal hold (20270395): then the purge
--   keeps it until that hold is released. A restriction is not itself a hold target (holds stay on reports, removal
--   records and review cases); a restriction made without a report or case can't be held this way. Account deletion still
--   removes it (same as 20270357's case members; a hold doesn't stop an account deletion today).
-- Requires 20270351 (account_moderation_actions pattern, check_is_admin), 20270357 (account_review_cases), 20270395
-- (legal holds), 20270396 (ugc_links).

create table if not exists private.account_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('messages', 'invitations', 'friend_requests', 'gatherings', 'offers', 'links')),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  report_id uuid references public.reports(id) on delete set null,
  review_case_id uuid references private.account_review_cases(id) on delete set null,
  admin_id uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null,
  lift_reason text check (lift_reason is null or length(btrim(lift_reason)) between 10 and 1000),
  check (expires_at > starts_at and expires_at <= starts_at + interval '30 days'),
  check ((lifted_at is null) = (lift_reason is null))
);
create index if not exists account_restrictions_active_idx on private.account_restrictions (user_id, capability, expires_at) where lifted_at is null;
revoke all on private.account_restrictions from public, anon, authenticated;

create table if not exists private.account_restriction_events (
  id uuid primary key default gen_random_uuid(),
  restriction_id uuid not null references private.account_restrictions(id) on delete cascade,
  user_id uuid not null,
  action text not null check (action in ('restrict', 'lift')),
  admin_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists account_restriction_events_user_idx on private.account_restriction_events (user_id, created_at desc);
revoke all on private.account_restriction_events from public, anon, authenticated;

-- the record is append-only: no update ever; a delete only through the cascade (restriction purged / account deleted)
create or replace function private._account_restriction_events_append_only()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Restriction records are append-only' using errcode = '42501';
  end if;
  if pg_trigger_depth() = 1 then
    raise exception 'Restriction records are append-only' using errcode = '42501';
  end if;
  return old;
end;
$function$;
revoke all on function private._account_restriction_events_append_only() from public, anon, authenticated;
drop trigger if exists append_only on private.account_restriction_events;
create trigger append_only before update or delete on private.account_restriction_events
  for each row execute function private._account_restriction_events_append_only();

-- a restriction row itself changes only once: the lift (by admin_lift_account_restriction); nothing else may be edited
create or replace function private._account_restrictions_guard()
returns trigger
language plpgsql
as $function$
begin
  if old.lifted_at is not null
     or new.lifted_at is null
     or (new.id, new.user_id, new.capability, new.reason, new.report_id, new.review_case_id, new.admin_id, new.starts_at, new.expires_at)
        is distinct from (old.id, old.user_id, old.capability, old.reason, old.report_id, old.review_case_id, old.admin_id, old.starts_at, old.expires_at)
  then
    raise exception 'A restriction can only be lifted, once' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function private._account_restrictions_guard() from public, anon, authenticated;
drop trigger if exists lift_only on private.account_restrictions;
create trigger lift_only before update on private.account_restrictions
  for each row execute function private._account_restrictions_guard();

-- The ONE reading: the latest end of an active restriction of this kind on this account (null = not restricted now).
create or replace function private.account_restricted_until(uid uuid, cap text)
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select max(r.expires_at) from private.account_restrictions r
   where r.user_id = uid and r.capability = cap and r.lifted_at is null and r.expires_at > now() and r.starts_at <= now();
$function$;
revoke all on function private.account_restricted_until(uuid, text) from public, anon, authenticated;

create or replace function private.refuse_restricted(uid uuid, cap text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_until timestamptz := private.account_restricted_until(uid, cap);
begin
  if v_until is not null then
    raise exception 'This action is paused on your account'
      using errcode = '42501', hint = 'account_restricted',
            detail = json_build_object('capability', cap, 'until', to_char(v_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text;
  end if;
end;
$function$;
revoke all on function private.refuse_restricted(uuid, text) from public, anon, authenticated;

-- The caller's OWN pause of one kind (null = none). Only for asking before the work: screen-business-content checks it
-- before spending a screening call or queuing an offer. It tells the person nothing they aren't told at the refused
-- action anyway; never anyone else's.
create or replace function public.get_my_account_restriction(capability_param text)
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select private.account_restricted_until(auth.uid(), capability_param) where auth.uid() is not null;
$function$;
revoke all on function public.get_my_account_restriction(text) from public, anon;
grant execute on function public.get_my_account_restriction(text) to authenticated;

-- Row trigger. tg_argv[0] = capability; tg_argv[1] = the column naming the actor ('' = the signed-in caller themselves);
-- for 'links', tg_argv[1..] = the text columns to look in. Runs only for a signed-in caller (service-role / cron writes and
-- rows written for someone else never count as the restricted person acting) and costs one indexed lookup when not restricted.
create or replace function private._refuse_restricted_actor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cap text := tg_argv[0];
  v_new jsonb;
  v_old jsonb;
  v_new_text text := '';
  v_old_text text := '';
  i int;
begin
  if v_uid is null then return new; end if;
  if not exists (select 1 from private.account_restrictions r
                  where r.user_id = v_uid and r.lifted_at is null and r.expires_at > now() and r.capability = v_cap) then
    return new;
  end if;
  v_new := to_jsonb(new);

  if v_cap = 'links' then
    v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    for i in 1 .. tg_nargs - 1 loop
      v_new_text := v_new_text || ' ' || coalesce(v_new ->> tg_argv[i], '');
      v_old_text := v_old_text || ' ' || coalesce(v_old ->> tg_argv[i], '');
    end loop;
    -- only a link that wasn't already there
    if exists (select 1 from unnest(coalesce(private.ugc_links(v_new_text), '{}')) l
                where l <> all (coalesce(private.ugc_links(v_old_text), '{}'))) then
      perform private.refuse_restricted(v_uid, v_cap);
    end if;
    return new;
  end if;

  if v_cap = 'offers' then
    -- only the business's own manager acting for it (a customer's write on the same row never counts)
    if (select managed_partner_id from profiles where id = v_uid) is distinct from (v_new ->> 'partner_id')::uuid then return new; end if;
    if tg_table_name = 'business_request_offers' then
      -- sending a reply (-> offered) or changing an open one; accepting, declining, cancelling, completing stay possible
      if v_new ->> 'status' <> 'offered' then return new; end if;
      if tg_op = 'UPDATE' and old.status = 'offered'
         and (to_jsonb(old) - 'viewed_at' - 'responded_at') = (v_new - 'viewed_at' - 'responded_at') then return new; end if;
    end if;
    perform private.refuse_restricted(v_uid, v_cap);
    return new;
  end if;

  -- the actor column (when given) must be the caller: rows the caller writes for someone else don't count
  if coalesce(tg_argv[1], '') <> '' and (v_new ->> tg_argv[1]) is distinct from v_uid::text then return new; end if;
  if tg_table_name = 'friend_discovery_swipes' and v_new ->> 'direction' <> 'like' then return new; end if;
  if tg_table_name = 'friendships' and v_new ->> 'status' <> 'pending' then return new; end if;
  perform private.refuse_restricted(v_uid, v_cap);
  return new;
end;
$function$;
revoke all on function private._refuse_restricted_actor() from public, anon, authenticated;

-- messages (insert only: a new message)
drop trigger if exists zz_refuse_restricted_messages on public.messages;
create trigger zz_refuse_restricted_messages before insert on public.messages
  for each row execute function private._refuse_restricted_actor('messages', 'sender_id');
drop trigger if exists zz_refuse_restricted_messages on public.gathering_messages;
create trigger zz_refuse_restricted_messages before insert on public.gathering_messages
  for each row execute function private._refuse_restricted_actor('messages', 'sender_id');
drop trigger if exists zz_refuse_restricted_messages on public.community_messages;
create trigger zz_refuse_restricted_messages before insert on public.community_messages
  for each row execute function private._refuse_restricted_actor('messages', 'sender_id');
drop trigger if exists zz_refuse_restricted_messages on public.plan_messages;
create trigger zz_refuse_restricted_messages before insert on public.plan_messages
  for each row execute function private._refuse_restricted_actor('messages', 'sender_id');
drop trigger if exists zz_refuse_restricted_messages on public.business_messages;
create trigger zz_refuse_restricted_messages before insert on public.business_messages
  for each row execute function private._refuse_restricted_actor('messages', 'sender_id');
drop trigger if exists zz_refuse_restricted_messages on public.photo_comments;
create trigger zz_refuse_restricted_messages before insert on public.photo_comments
  for each row execute function private._refuse_restricted_actor('messages', 'commenter_id');
drop trigger if exists zz_refuse_restricted_messages on public.gathering_questions;
create trigger zz_refuse_restricted_messages before insert on public.gathering_questions
  for each row execute function private._refuse_restricted_actor('messages', 'asker_id');

-- invitations
drop trigger if exists zz_refuse_restricted_invitations on public.social_invites;
create trigger zz_refuse_restricted_invitations before insert on public.social_invites
  for each row execute function private._refuse_restricted_actor('invitations', 'inviter_id');

-- friend requests, Connect / like, waves + notices
drop trigger if exists zz_refuse_restricted_friend_requests on public.friendships;
create trigger zz_refuse_restricted_friend_requests before insert on public.friendships
  for each row execute function private._refuse_restricted_actor('friend_requests', 'requested_by');
drop trigger if exists zz_refuse_restricted_friend_requests on public.friend_discovery_swipes;
create trigger zz_refuse_restricted_friend_requests before insert or update on public.friend_discovery_swipes
  for each row execute function private._refuse_restricted_actor('friend_requests', 'from_user');
drop trigger if exists zz_refuse_restricted_friend_requests on public.notices;
create trigger zz_refuse_restricted_friend_requests before insert on public.notices
  for each row execute function private._refuse_restricted_actor('friend_requests', 'from_user');

-- creating a gathering or a community
drop trigger if exists zz_refuse_restricted_gatherings on public.gatherings;
create trigger zz_refuse_restricted_gatherings before insert on public.gatherings
  for each row execute function private._refuse_restricted_actor('gatherings', 'host_id');
drop trigger if exists zz_refuse_restricted_gatherings on public.communities;
create trigger zz_refuse_restricted_gatherings before insert on public.communities
  for each row execute function private._refuse_restricted_actor('gatherings', 'creator_id');

-- business offers (the manager of that business only)
drop trigger if exists zz_refuse_restricted_offers on public.business_request_offers;
create trigger zz_refuse_restricted_offers before insert or update on public.business_request_offers
  for each row execute function private._refuse_restricted_actor('offers');
drop trigger if exists zz_refuse_restricted_offers on public.business_availability;
create trigger zz_refuse_restricted_offers before insert or update on public.business_availability
  for each row execute function private._refuse_restricted_actor('offers');
drop trigger if exists zz_refuse_restricted_offers on public.brand_offers;
create trigger zz_refuse_restricted_offers before insert or update on public.brand_offers
  for each row execute function private._refuse_restricted_actor('offers');
drop trigger if exists zz_refuse_restricted_offers on public.business_updates;
create trigger zz_refuse_restricted_offers before insert or update on public.business_updates
  for each row execute function private._refuse_restricted_actor('offers');

-- new links in public text and messages
drop trigger if exists zz_refuse_restricted_links on public.profiles;
create trigger zz_refuse_restricted_links before insert or update on public.profiles
  for each row execute function private._refuse_restricted_actor('links', 'display_name', 'bio', 'prompts', 'basics');
drop trigger if exists zz_refuse_restricted_links on public.gatherings;
create trigger zz_refuse_restricted_links before insert or update on public.gatherings
  for each row execute function private._refuse_restricted_actor('links', 'title', 'description');
drop trigger if exists zz_refuse_restricted_links on public.communities;
create trigger zz_refuse_restricted_links before insert or update on public.communities
  for each row execute function private._refuse_restricted_actor('links', 'name', 'description');
drop trigger if exists zz_refuse_restricted_links on public.gathering_questions;
create trigger zz_refuse_restricted_links before insert or update on public.gathering_questions
  for each row execute function private._refuse_restricted_actor('links', 'question_body', 'answer_body');
drop trigger if exists zz_refuse_restricted_links on public.photo_comments;
create trigger zz_refuse_restricted_links before insert or update on public.photo_comments
  for each row execute function private._refuse_restricted_actor('links', 'comment_text');
drop trigger if exists zz_refuse_restricted_links on public.messages;
create trigger zz_refuse_restricted_links before insert or update on public.messages
  for each row execute function private._refuse_restricted_actor('links', 'body');
drop trigger if exists zz_refuse_restricted_links on public.gathering_messages;
create trigger zz_refuse_restricted_links before insert or update on public.gathering_messages
  for each row execute function private._refuse_restricted_actor('links', 'body');
drop trigger if exists zz_refuse_restricted_links on public.community_messages;
create trigger zz_refuse_restricted_links before insert or update on public.community_messages
  for each row execute function private._refuse_restricted_actor('links', 'body');
drop trigger if exists zz_refuse_restricted_links on public.plan_messages;
create trigger zz_refuse_restricted_links before insert or update on public.plan_messages
  for each row execute function private._refuse_restricted_actor('links', 'body');
drop trigger if exists zz_refuse_restricted_links on public.business_messages;
create trigger zz_refuse_restricted_links before insert or update on public.business_messages
  for each row execute function private._refuse_restricted_actor('links', 'body');

-- ===== admin functions =====
create or replace function public.admin_restrict_account(
  user_id_param uuid, capabilities_param text[], days_param int, reason_param text,
  report_id_param uuid default null, review_case_id_param uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_caps text[];
  v_cap text;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_expires timestamptz;
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if user_id_param is null or user_id_param = v_admin then
    raise exception 'An admin can''t restrict their own account' using errcode = '42501', hint = 'restrict_self';
  end if;
  if not exists (select 1 from auth.users where id = user_id_param) then
    raise exception 'No such account' using errcode = 'P0002', hint = 'restrict_no_account';
  end if;
  if reason_param is null or length(btrim(reason_param)) not between 10 and 1000 then
    raise exception 'Write a reason (10 to 1000 characters)' using errcode = '22023', hint = 'restrict_reason';
  end if;
  if days_param is null or days_param not between 1 and 30 then
    raise exception 'A restriction lasts 1 to 30 days' using errcode = '22023', hint = 'restrict_duration';
  end if;
  select array_agg(distinct c order by c) into v_caps from unnest(capabilities_param) c where c is not null;
  if v_caps is null or exists (select 1 from unnest(v_caps) c
                                where c not in ('messages', 'invitations', 'friend_requests', 'gatherings', 'offers', 'links')) then
    raise exception 'Choose what to pause' using errcode = '22023', hint = 'restrict_capability';
  end if;
  if report_id_param is not null and not exists (select 1 from reports where id = report_id_param) then
    raise exception 'No such report' using errcode = 'P0002', hint = 'restrict_no_report';
  end if;
  if review_case_id_param is not null and not exists (select 1 from private.account_review_cases where id = review_case_id_param) then
    raise exception 'No such review case' using errcode = 'P0002', hint = 'restrict_no_case';
  end if;

  -- one admin decision at a time per account (two admins restricting at once both get recorded, never interleaved)
  perform pg_advisory_xact_lock(hashtextextended('account_restriction:' || user_id_param::text, 0));
  v_expires := now() + make_interval(days => days_param);
  foreach v_cap in array v_caps loop
    insert into private.account_restrictions (user_id, capability, reason, report_id, review_case_id, admin_id, expires_at)
      values (user_id_param, v_cap, btrim(reason_param), report_id_param, review_case_id_param, v_admin, v_expires)
      returning id into v_id;
    insert into private.account_restriction_events (restriction_id, user_id, action, admin_id, reason)
      values (v_id, user_id_param, 'restrict', v_admin, btrim(reason_param));
    v_ids := v_ids || v_id;
  end loop;
  return jsonb_build_object('restriction_ids', to_jsonb(v_ids), 'capabilities', to_jsonb(v_caps), 'expires_at', v_expires);
end;
$function$;
revoke all on function public.admin_restrict_account(uuid, text[], int, text, uuid, uuid) from public, anon;
grant execute on function public.admin_restrict_account(uuid, text[], int, text, uuid, uuid) to authenticated;

create or replace function public.admin_lift_account_restriction(restriction_id_param uuid, reason_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  r private.account_restrictions;
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if reason_param is null or length(btrim(reason_param)) not between 10 and 1000 then
    raise exception 'Write a reason (10 to 1000 characters)' using errcode = '22023', hint = 'restrict_reason';
  end if;
  select * into r from private.account_restrictions where id = restriction_id_param for update;
  if not found then
    raise exception 'No such restriction' using errcode = 'P0002', hint = 'restrict_not_found';
  end if;
  if r.user_id = v_admin then
    raise exception 'An admin can''t lift their own restriction' using errcode = '42501', hint = 'restrict_self';
  end if;
  if r.lifted_at is not null or r.expires_at <= now() then
    return jsonb_build_object('lifted', false, 'already', true, 'lifted_at', r.lifted_at, 'expires_at', r.expires_at);
  end if;
  update private.account_restrictions set lifted_at = now(), lifted_by = v_admin, lift_reason = btrim(reason_param)
   where id = restriction_id_param;
  insert into private.account_restriction_events (restriction_id, user_id, action, admin_id, reason)
    values (restriction_id_param, r.user_id, 'lift', v_admin, btrim(reason_param));
  return jsonb_build_object('lifted', true, 'already', false);
end;
$function$;
revoke all on function public.admin_lift_account_restriction(uuid, text) from public, anon;
grant execute on function public.admin_lift_account_restriction(uuid, text) to authenticated;

-- An account's restrictions, newest first (active ones and the ones that ended), with who decided and why.
create or replace function public.admin_list_account_restrictions(user_id_param uuid)
returns table (
  restriction_id uuid, capability text, reason text, report_id uuid, review_case_id uuid, admin_id uuid, admin_name text,
  starts_at timestamptz, expires_at timestamptz, lifted_at timestamptz, lifted_by uuid, lift_reason text, active boolean)
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
    select r.id, r.capability, r.reason, r.report_id, r.review_case_id, r.admin_id, p.display_name,
           r.starts_at, r.expires_at, r.lifted_at, r.lifted_by, r.lift_reason,
           (r.lifted_at is null and r.expires_at > now())
      from private.account_restrictions r
      left join profiles p on p.id = r.admin_id
     where r.user_id = user_id_param
     order by r.starts_at desc, r.id;
end;
$function$;
revoke all on function public.admin_list_account_restrictions(uuid) from public, anon;
grant execute on function public.admin_list_account_restrictions(uuid) to authenticated;

-- Retention: a restriction (and with it its record) is deleted 12 months after it ended. Never while active, never while
-- the report or review case it came from is under an active legal hold (20270395's lock, as its own purge jobs take it).
create or replace function private.purge_ended_account_restrictions()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.legal_hold_lock();
  delete from private.account_restrictions r
   where coalesce(r.lifted_at, r.expires_at) < now() - interval '12 months'
     and not (r.report_id is not null and private.report_on_legal_hold(r.report_id))
     and not (r.review_case_id is not null and private.case_on_legal_hold(r.review_case_id));
end;
$function$;
revoke all on function private.purge_ended_account_restrictions() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'purge-ended-account-restrictions') then
    perform cron.unschedule('purge-ended-account-restrictions');
  end if;
  perform cron.schedule('purge-ended-account-restrictions', '40 4 * * *', 'select private.purge_ended_account_restrictions()');
end
$do$;
