-- Item 147 (owner, approved 2026-10-17, HIGH PRIORITY SECURITY): a gathering row is readable only by someone who may see it.
-- Scope + audit: PRODUCT_AUDIT/ITEM_147_NON_PUBLIC_GATHERING_ROWS_SCOPE_2026-10-17.md.
-- Found live before this migration: `gatherings` had one SELECT policy, `Anyone can view gatherings` (qual = true), so ANY
-- caller, signed out included, read every invite-only / friends / community gathering's title, description, host, time,
-- area, etc. Item 146 fixed only the coordinates.
-- This migration:
--   1. ONE rule, decided in the database: public._gathering_row_visible(<the row's own columns>). Host; anyone with a join
--      row (any state) or a pending/accepted personal invite; the business that partners on it (hosting_partner_id) or has a
--      pending/approved partnership request for it; else not blocked either way with the host + the women-only rule +
--      visibility everyone (link-only included: it is reachable by id, never listed), friends of the host, community
--      members; invite_only = invitees only. Signed out = nothing. It takes the row's columns (no re-read of the table), so
--      the host's own `insert ... returning` / `update ... returning` passes on the new row.
--      _viewer_can_see_gathering(id) (get_plan_stops, get_gathering_group_insights) now reads the row and calls it: one rule.
--   2. The SELECT policy on gatherings uses it (replaces `Anyone can view gatherings`). Column grants (item 146) unchanged.
--      Signed-out visitors keep exactly what a public invite link shows (get_public_gathering_invite_preview, unchanged).
--   3. By-id RPCs that returned facts about any gathering id now apply the same rule: get_gathering_distances (pin +
--      distance), get_gathering_approved_counts, get_gathering_attendee_breakdown, get_gathering_first_timer_count; and the
--      id lists get_bounded_nearby_gathering_ids, get_trending_gathering_ids only return gatherings the caller may see.
--   4. Joining, Interested and inviting cannot be used to gain visibility: a BEFORE INSERT trigger on gathering_interest
--      (own join), gathering_interested (own Interested) and social_invites (own gathering invite) refuses a gathering the
--      caller may not see, with the same 'Gathering not found' a missing id gets (existence is not revealed). Before this, a
--      join row granted visibility and join_gathering did not check friends/community visibility; the women-only INSERT
--      policy on gathering_interest read gatherings as the caller, so with private rows it would have silently passed.
--   5. Q&A and cover photos follow the gathering: gathering_questions' read (was `true`, anon included) and ask policies,
--      and the gathering-photos bucket's read policy (was bucket-only), require the gathering row to be readable by the
--      caller (an exists() under the gatherings policy itself, so there is still one rule).
-- Same signatures, one overload each; execute grants unchanged. _viewer_can_see_gathering stays never client-callable;
-- _gathering_row_visible is executable by anon + authenticated because the gatherings policy calls it (a policy's function
-- must be executable by every role it applies to); it answers only about the caller's own relation to a gathering.

-- 1. The one rule -------------------------------------------------------------------------------------------------------
create or replace function public._gathering_row_visible(
  g_id uuid, g_host_id uuid, g_visibility text, g_women_only boolean, g_community_id uuid, g_hosting_partner_id uuid)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
revoke execute on function public._gathering_row_visible(uuid, uuid, text, boolean, uuid, uuid) from public;
grant execute on function public._gathering_row_visible(uuid, uuid, text, boolean, uuid, uuid) to anon, authenticated;

create or replace function public._viewer_can_see_gathering(gathering_id_param uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((
    select public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)
    from gatherings g where g.id = gathering_id_param), false);
$function$;
revoke all on function public._viewer_can_see_gathering(uuid) from public, anon, authenticated;

-- a storage folder name that is not a uuid is no gathering
create or replace function public._uuid_or_null(v text)
 returns uuid
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end;
$function$;
revoke execute on function public._uuid_or_null(text) from public;
grant execute on function public._uuid_or_null(text) to anon, authenticated;

-- 2. Rows -----------------------------------------------------------------------------------------------------------------
drop policy if exists "Anyone can view gatherings" on public.gatherings;
create policy "Gatherings visible to who may see them" on public.gatherings for select
  using (public._gathering_row_visible(id, host_id, visibility, women_only, community_id, hosting_partner_id));

-- 3. By-id RPCs and id lists ----------------------------------------------------------------------------------------------
create or replace function public.get_gathering_distances(my_lat double precision, my_lng double precision, gathering_ids uuid[])
 returns table(id uuid, distance_miles double precision, fuzzed_lat double precision, fuzzed_lng double precision)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    g.id,
    (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(my_lat)) * cos(radians(p.pin_lat)) * cos(radians(p.pin_lng) - radians(my_lng)) +
        sin(radians(my_lat)) * sin(radians(p.pin_lat))
      ))
    )) as distance_miles,
    p.pin_lat as fuzzed_lat,
    p.pin_lng as fuzzed_lng
  from gatherings g
  cross join lateral private.gathering_pin(g.id, g.precise_lat, g.precise_lng) p
  where g.id = any(gathering_ids)
    and g.precise_lat is not null
    and g.precise_lng is not null
    and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id);
$function$;

create or replace function public.get_gathering_approved_counts(gathering_ids uuid[])
 returns table(gathering_id uuid, approved_count integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(array_length(gathering_ids, 1), 0) > 500 then
    raise exception 'Too many gatherings';
  end if;
  return query
    select gi.gathering_id, count(*)::integer
    from public.gathering_interest gi
    join public.gatherings g on g.id = gi.gathering_id
    where gi.gathering_id = any (gathering_ids)
      and gi.status = 'approved'
      and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)
    group by gi.gathering_id;
end;
$function$;

create or replace function public.get_gathering_attendee_breakdown(gathering_id_param uuid)
 returns table(total_attending bigint, new_attendees bigint, returning_attendees bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with this_gathering as (
    select gi.user_id, gi.created_at, g.host_id, g.recurring_series_id
    from gathering_interest gi
    join gatherings g on g.id = gi.gathering_id
    where gi.gathering_id = gathering_id_param and gi.status = 'approved'
      and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)
  )
  select
    count(*) as total_attending,
    count(*) filter (
      where not exists (
        select 1 from gathering_interest gi2
        join gatherings g2 on g2.id = gi2.gathering_id
        where gi2.user_id = tg.user_id
        and g2.host_id = tg.host_id
        and gi2.status = 'approved'
        and gi2.created_at < tg.created_at
      )
    ) as new_attendees,
    count(*) filter (
      where exists (
        select 1 from gathering_interest gi2
        join gatherings g2 on g2.id = gi2.gathering_id
        where gi2.user_id = tg.user_id
        and g2.host_id = tg.host_id
        and gi2.status = 'approved'
        and gi2.created_at < tg.created_at
      )
    ) as returning_attendees
  from this_gathering tg;
$function$;

create or replace function public.get_gathering_first_timer_count(gathering_id_param uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when auth.uid() is null or not public._viewer_can_see_gathering(gathering_id_param) then 0 else (
    select count(*)::int from gathering_interest gi
    where gi.gathering_id = gathering_id_param and gi.status = 'approved'
      and not public.viewer_blocked_either_way(gi.user_id)
      and not exists (
        select 1 from gathering_interest o join gatherings og on og.id = o.gathering_id
        where o.user_id = gi.user_id and o.status = 'approved' and o.gathering_id <> gathering_id_param and og.scheduled_at < now()
      )
  ) end;
$function$;

create or replace function public.get_bounded_nearby_gathering_ids(my_lat double precision, my_lng double precision, max_miles double precision, row_limit integer default 500)
 returns table(id uuid)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select g.id
  from gatherings g
  where g.host_id <> auth.uid()
    and g.discoverable = true
    and g.scheduled_at > now()
    and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)
    and (
      g.is_public = true
      or (
        g.precise_lat is not null
        and g.precise_lng is not null
        and g.precise_lat between my_lat - (max_miles / 69.0) - 0.0035 and my_lat + (max_miles / 69.0) + 0.0035
        and g.precise_lng between my_lng - (max_miles / (69.0 * greatest(cos(radians(my_lat)), 0.01))) - 0.0035
                              and my_lng + (max_miles / (69.0 * greatest(cos(radians(my_lat)), 0.01))) + 0.0035
        and exists (
          select 1 from private.gathering_pin(g.id, g.precise_lat, g.precise_lng) p
          where (3958.8 * acos(
              least(1.0, greatest(-1.0,
                cos(radians(my_lat)) * cos(radians(p.pin_lat)) * cos(radians(p.pin_lng) - radians(my_lng)) +
                sin(radians(my_lat)) * sin(radians(p.pin_lat))
              ))
            )) <= max_miles
        )
      )
    )
  order by g.scheduled_at asc
  limit row_limit;
$function$;

create or replace function public.get_trending_gathering_ids(area_param text)
 returns table(id uuid, interest_count bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select g.id, count(gi.id) as interest_count
  from gatherings g
  join gathering_interest gi on gi.gathering_id = g.id and gi.status = 'approved'
  where g.wide_area = area_param
  and g.discoverable = true
  and g.scheduled_at > now()
  and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)
  group by g.id
  order by interest_count desc
  limit 20;
$function$;

-- 4. Joining, Interested and inviting never grant visibility --------------------------------------------------------------
create or replace function public._own_gathering_write_needs_visibility()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_gathering uuid;
begin
  if v_uid is null then return new; end if; -- server-side writes (service role, cron) are not the caller's own
  if tg_table_name = 'social_invites' then
    if new.invite_type is distinct from 'gathering' then return new; end if;
    v_actor := new.inviter_id; v_gathering := new.target_id;
  else
    v_actor := new.user_id; v_gathering := new.gathering_id;
  end if;
  if v_actor = v_uid and not public._viewer_can_see_gathering(v_gathering) then
    raise exception 'Gathering not found';
  end if;
  return new;
end;
$function$;
revoke execute on function public._own_gathering_write_needs_visibility() from public, anon, authenticated;

drop trigger if exists own_join_needs_visibility on public.gathering_interest;
create trigger own_join_needs_visibility before insert on public.gathering_interest
  for each row execute function public._own_gathering_write_needs_visibility();
drop trigger if exists own_interested_needs_visibility on public.gathering_interested;
create trigger own_interested_needs_visibility before insert on public.gathering_interested
  for each row execute function public._own_gathering_write_needs_visibility();
drop trigger if exists own_gathering_invite_needs_visibility on public.social_invites;
create trigger own_gathering_invite_needs_visibility before insert on public.social_invites
  for each row execute function public._own_gathering_write_needs_visibility();

-- 5. Q&A and cover photos follow the gathering ----------------------------------------------------------------------------
drop policy if exists "Anyone can view gathering questions" on public.gathering_questions;
create policy "Gathering questions visible to who may see the gathering" on public.gathering_questions for select
  using (exists (select 1 from public.gatherings g where g.id = gathering_questions.gathering_id));
drop policy if exists "Users can ask their own gathering questions" on public.gathering_questions;
create policy "Users can ask their own gathering questions" on public.gathering_questions for insert
  with check (auth.uid() = asker_id and exists (select 1 from public.gatherings g where g.id = gathering_questions.gathering_id));

drop policy if exists "Anyone can view gathering cover photos" on storage.objects;
create policy "Gathering cover photos visible to who may see the gathering" on storage.objects for select
  using (bucket_id = 'gathering-photos'
         and exists (select 1 from public.gatherings g where g.id = public._uuid_or_null((storage.foldername(objects.name))[1])));
