-- Trust & safety fix 2 (owner, 2026-10-27; audit B2): suspension is real and enforced by the backend.
-- Before: the admin "Suspend User" button updated another person's profile directly; RLS let it change 0 rows and the
-- screen still said "Suspended" (proven in a rolled-back transaction). No suspension existed anywhere.
-- Now:
--   profiles.suspended_at        set/cleared ONLY by admin_suspend_user / admin_reinstate_user (guard trigger).
--   admin_suspend_user(...)      admin only, never yourself. Hides the profile (profile_hidden, which every read of
--                                another person's profile already honours) and, by default, ends every session and
--                                refuses sign-in (auth.users.banned_until, the ban Supabase Auth itself enforces).
--                                Records who did it, when, why and from which report.
--   admin_reinstate_user(...)    undoes exactly that: the profile's earlier hidden choice is restored, sign-in allowed.
--   account_moderation_actions   the audit trail (append-only, admins read it; no client writes at all).
--   Social actions refused       a suspended person's own inserts/updates on the 24 social tables below raise
--                                'account_suspended' (whatever the path: app, direct API, or a server function acting
--                                for them). Reports, blocks, leaving/deleting own content and account deletion stay
--                                possible. Rows written by someone else (e.g. a host) or by the service role never
--                                count as the suspended person acting.
--   Discovery                    get_friend_discovery_candidates now applies the profile-visibility rule (it ignored
--                                hidden profiles; the client hid them afterwards) and skips suspended accounts.
--   Gatherings                   a suspended host's gatherings stay visible to the people already in them / invited,
--                                never to anyone new (_gathering_row_visible), so nobody new can join them.
-- Requires 20270350 (friend candidates' id_verified column).

alter table public.profiles add column if not exists suspended_at timestamptz;
-- N6 (20270348): a viewer reads only granted profiles columns. Others see only unhidden profiles, and a suspended one is
-- hidden, so for anyone but the person and an admin this is never set.
grant select (suspended_at) on public.profiles to authenticated;

create or replace function private.account_suspended(uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select suspended_at is not null from public.profiles where id = uid), false);
$function$;
revoke all on function private.account_suspended(uuid) from public, anon, authenticated;

create table if not exists public.account_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('suspend', 'reinstate')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  report_id uuid references public.reports(id) on delete set null,
  admin_id uuid references auth.users(id) on delete set null,
  sessions_ended boolean not null default false,
  previous_profile_hidden boolean,
  created_at timestamptz not null default now()
);
create index if not exists account_moderation_actions_user_idx on public.account_moderation_actions (user_id, created_at desc);
alter table public.account_moderation_actions enable row level security;
revoke all on public.account_moderation_actions from public, anon, authenticated;
grant select on public.account_moderation_actions to authenticated;
drop policy if exists "Admins read moderation actions" on public.account_moderation_actions;
create policy "Admins read moderation actions" on public.account_moderation_actions
  for select to authenticated using (check_is_admin(auth.uid()));

-- suspended_at only through the two admin functions; while suspended the person can't unhide their own profile.
create or replace function public._guard_suspension()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if tg_op = 'INSERT' then
      new.suspended_at := null;
    else
      new.suspended_at := old.suspended_at;
      if old.suspended_at is not null then
        new.profile_hidden := old.profile_hidden;
      end if;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public._guard_suspension() from public, anon, authenticated;
drop trigger if exists block_client_suspension_edit on public.profiles;
create trigger block_client_suspension_edit before insert or update on public.profiles
  for each row execute function public._guard_suspension();

create or replace function public._refuse_suspended_actor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and private.account_suspended(auth.uid()) then
    raise exception 'This account is suspended' using errcode = '42501', hint = 'account_suspended';
  end if;
  return new;
end;
$function$;
revoke all on function public._refuse_suspended_actor() from public, anon, authenticated;

drop trigger if exists zz_refuse_suspended_actor on public.messages;
create trigger zz_refuse_suspended_actor before insert or update on public.messages
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.message_reactions;
create trigger zz_refuse_suspended_actor before insert or update on public.message_reactions
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.gathering_messages;
create trigger zz_refuse_suspended_actor before insert or update on public.gathering_messages
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.community_messages;
create trigger zz_refuse_suspended_actor before insert or update on public.community_messages
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.plan_messages;
create trigger zz_refuse_suspended_actor before insert or update on public.plan_messages
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.business_messages;
create trigger zz_refuse_suspended_actor before insert or update on public.business_messages
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.photo_comments;
create trigger zz_refuse_suspended_actor before insert or update on public.photo_comments
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.gathering_questions;
create trigger zz_refuse_suspended_actor before insert or update on public.gathering_questions
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.gathering_feedback;
create trigger zz_refuse_suspended_actor before insert or update on public.gathering_feedback
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.notices;
create trigger zz_refuse_suspended_actor before insert or update on public.notices
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.friendships;
create trigger zz_refuse_suspended_actor before insert or update on public.friendships
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.friend_discovery_swipes;
create trigger zz_refuse_suspended_actor before insert or update on public.friend_discovery_swipes
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.social_invites;
create trigger zz_refuse_suspended_actor before insert or update on public.social_invites
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.gatherings;
create trigger zz_refuse_suspended_actor before insert or update on public.gatherings
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.gathering_interest;
create trigger zz_refuse_suspended_actor before insert or update on public.gathering_interest
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.gathering_interested;
create trigger zz_refuse_suspended_actor before insert or update on public.gathering_interested
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.communities;
create trigger zz_refuse_suspended_actor before insert or update on public.communities
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.community_members;
create trigger zz_refuse_suspended_actor before insert or update on public.community_members
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.stories;
create trigger zz_refuse_suspended_actor before insert or update on public.stories
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.profile_photos;
create trigger zz_refuse_suspended_actor before insert or update on public.profile_photos
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.business_requests;
create trigger zz_refuse_suspended_actor before insert or update on public.business_requests
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.occasion_group_plans;
create trigger zz_refuse_suspended_actor before insert or update on public.occasion_group_plans
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.occasion_group_plan_participants;
create trigger zz_refuse_suspended_actor before insert or update on public.occasion_group_plan_participants
  for each row execute function public._refuse_suspended_actor();
drop trigger if exists zz_refuse_suspended_actor on public.plan_shares;
create trigger zz_refuse_suspended_actor before insert or update on public.plan_shares
  for each row execute function public._refuse_suspended_actor();

create or replace function public.admin_suspend_user(user_id_param uuid, reason_param text, report_id_param uuid default null, end_sessions_param boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_prev_hidden boolean;
  v_suspended_at timestamptz;
  v_reason text := nullif(btrim(coalesce(reason_param, '')), '');
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Only admins can suspend accounts' using errcode = '42501';
  end if;
  if user_id_param = v_admin then
    raise exception 'You can''t suspend your own account' using errcode = '42501', hint = 'own_account';
  end if;
  if v_reason is null then
    raise exception 'A reason is required' using errcode = '22023', hint = 'reason_required';
  end if;
  if report_id_param is not null and not exists (select 1 from reports where id = report_id_param and reported_id = user_id_param) then
    raise exception 'That report is not about this account' using errcode = '22023', hint = 'report_mismatch';
  end if;

  select coalesce(profile_hidden, false), suspended_at into v_prev_hidden, v_suspended_at
  from profiles where id = user_id_param for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_suspended_at is not null then
    return jsonb_build_object('suspended', true, 'already', true, 'suspended_at', v_suspended_at);
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set suspended_at = now(), profile_hidden = true where id = user_id_param
  returning suspended_at into v_suspended_at;
  perform set_config('app.trusted_update', 'false', true);

  if end_sessions_param then
    update auth.users set banned_until = now() + interval '100 years' where id = user_id_param;
    delete from auth.sessions where user_id = user_id_param;
  end if;

  insert into account_moderation_actions (user_id, action, reason, report_id, admin_id, sessions_ended, previous_profile_hidden)
  values (user_id_param, 'suspend', v_reason, report_id_param, v_admin, end_sessions_param, v_prev_hidden);

  return jsonb_build_object('suspended', true, 'already', false, 'suspended_at', v_suspended_at, 'sessions_ended', end_sessions_param);
end;
$function$;

create or replace function public.admin_reinstate_user(user_id_param uuid, reason_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_suspended_at timestamptz;
  v_prev_hidden boolean;
  v_reason text := nullif(btrim(coalesce(reason_param, '')), '');
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Only admins can reinstate accounts' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A reason is required' using errcode = '22023', hint = 'reason_required';
  end if;

  select suspended_at into v_suspended_at from profiles where id = user_id_param for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_suspended_at is null then
    return jsonb_build_object('suspended', false, 'already', true);
  end if;

  select previous_profile_hidden into v_prev_hidden from account_moderation_actions
  where user_id = user_id_param and action = 'suspend' order by created_at desc limit 1;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set suspended_at = null, profile_hidden = coalesce(v_prev_hidden, false) where id = user_id_param;
  perform set_config('app.trusted_update', 'false', true);
  update auth.users set banned_until = null where id = user_id_param;

  insert into account_moderation_actions (user_id, action, reason, admin_id)
  values (user_id_param, 'reinstate', v_reason, v_admin);

  return jsonb_build_object('suspended', false, 'already', false);
end;
$function$;

revoke all on function public.admin_suspend_user(uuid, text, uuid, boolean) from public, anon;
revoke all on function public.admin_reinstate_user(uuid, text) from public, anon;
grant execute on function public.admin_suspend_user(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.admin_reinstate_user(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public._gathering_row_visible(g_id uuid, g_host_id uuid, g_visibility text, g_women_only boolean, g_community_id uuid, g_hosting_partner_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_partner uuid;
begin
  if v_uid is null or g_id is null then return false; end if;
  if g_host_id = v_uid then return true; end if;
  -- already part of it (any request state) or personally invited
  if exists (select 1 from gathering_interest where gathering_id = g_id and user_id = v_uid) then return true; end if;
  if exists (select 1 from social_invites where invite_type = 'gathering' and target_id = g_id and invitee_id = v_uid
             and status in ('pending', 'accepted')) then return true; end if;
  -- the business that partners on it, or was asked to
  select managed_partner_id into v_partner from profiles where id = v_uid;
  if v_partner is not null and (
       v_partner = g_hosting_partner_id
       or exists (select 1 from business_partnership_requests r where r.target_type = 'gathering' and r.target_id = g_id
                  and r.partner_id = v_partner and r.status in ('pending', 'approved'))) then
    return true;
  end if;
  -- a suspended host's gatherings stay visible only to the people already in them (above), never to anyone new
  if private.account_suspended(g_host_id) then return false; end if;
  if public.viewer_blocked_either_way(g_host_id) then return false; end if;
  if coalesce(g_women_only, false)
     and lower(coalesce((select gender from profiles where id = v_uid), '')) not in ('female', 'woman') then return false; end if;
  return case g_visibility
    when 'everyone' then true
    when 'friends' then public.viewer_is_friend_of(g_host_id)
    when 'community' then g_community_id is not null
      and exists (select 1 from community_members where community_id = g_community_id and user_id = v_uid)
    else false
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_friend_discovery_candidates(limit_param integer DEFAULT 20)
 RETURNS TABLE(id uuid, display_name text, photo_url text, bio text, interests text[], photo_verified boolean, id_verified boolean, shared_interest_count integer, shared_community_count integer, mutual_friend_count integer, distance_bucket text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_my_interests text[];
  v_my_wide_area text;
  v_my_lat double precision;
  v_my_lng double precision;
  v_i_opted_in boolean;
begin
  if v_me is null then
    return;
  end if;

  select profiles.open_to_friend_discovery, profiles.interests, profiles.wide_area
  into v_i_opted_in, v_my_interests, v_my_wide_area
  from profiles where profiles.id = v_me;

  if not coalesce(v_i_opted_in, false) then
    return;
  end if;

  if v_my_wide_area is not null then
    v_my_lat := split_part(v_my_wide_area, ',', 1)::double precision;
    v_my_lng := split_part(v_my_wide_area, ',', 2)::double precision;
  end if;

  return query
  with my_friends as (
    select case when f.user_a = v_me then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = v_me or f.user_b = v_me)
  ),
  my_communities as (
    select community_id from community_members where user_id = v_me
  ),
  candidates as (
    select
      p.id, p.display_name, p.photo_url, p.bio, p.interests, p.wide_area, p.photo_verified, p.id_verified,
      cardinality(array(select unnest(p.interests) intersect select unnest(v_my_interests))) as shared_interest_count,
      (select count(*) from community_members cm where cm.user_id = p.id and cm.community_id in (select community_id from my_communities))::integer as shared_community_count,
      (select count(*) from friendships f2
        where f2.status = 'accepted'
        and ((f2.user_a = p.id and f2.user_b in (select friend_id from my_friends))
          or (f2.user_b = p.id and f2.user_a in (select friend_id from my_friends))))::integer as mutual_friend_count,
      case
        when p.wide_area is null or v_my_lat is null then null
        else 3958.8 * acos(least(1.0, greatest(-1.0,
          cos(radians(v_my_lat)) * cos(radians(split_part(p.wide_area, ',', 1)::double precision)) * cos(radians(split_part(p.wide_area, ',', 2)::double precision) - radians(v_my_lng)) +
          sin(radians(v_my_lat)) * sin(radians(split_part(p.wide_area, ',', 1)::double precision))
        )))
      end as distance_miles
    from profiles p
    where p.id <> v_me
    and p.open_to_friend_discovery = true
    -- only profiles others may see at all (the profiles read policy's rule) and never a suspended account
    and coalesce(p.photo_verified, false) and not coalesce(p.profile_hidden, false) and p.suspended_at is null
    and not is_blocked(v_me, p.id)
    and not exists (
      select 1 from friendships f
      where (f.user_a = v_me and f.user_b = p.id) or (f.user_a = p.id and f.user_b = v_me)
    )
    and not exists (
      select 1 from matches m
      where (m.user_a = v_me and m.user_b = p.id) or (m.user_a = p.id and m.user_b = v_me)
    )
    and not exists (
      select 1 from friend_discovery_swipes s
      where s.from_user = v_me and s.to_user = p.id
    )
  )
  select
    c.id, c.display_name, c.photo_url, c.bio, c.interests, c.photo_verified, c.id_verified,
    c.shared_interest_count, c.shared_community_count, c.mutual_friend_count,
    case
      when c.distance_miles is null then null
      when c.distance_miles < 3 then 'Nearby'
      when c.distance_miles < 15 then 'A few miles away'
      else 'In the wider area'
    end as distance_bucket
  from candidates c
  order by (c.shared_interest_count + c.shared_community_count + c.mutual_friend_count) desc,
    c.distance_miles asc nulls last,
    random()
  limit limit_param;
end;
$function$;
