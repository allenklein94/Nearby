-- Item 39 (owner, 2026-10-11): "A friend is nearby". Design + owner decisions: PRODUCT_AUDIT/ITEM_39_FRIEND_NEARBY_DESIGN_2026-10-11.md.
-- The first feature that tells one person anything about where another is, so it is built as mutual, revocable consent,
-- never tracking:
--   * consent is OFF by default; only set_friend_nearby_sharing(true) turns it on (called only by the Settings toggle).
--   * a person is "nearby" to a viewer only if: accepted friendship (never matches), no block either way, BOTH have sharing
--     on, BOTH fixes are fresh (< 30 min), and the fixes are < ~1 mi apart. Decided on every read; nothing is cached.
--   * get_nearby_friends() returns at most ONE friend (id, display_name, photo_url): no coordinates, distance, direction,
--     time or freshness. Every "not nearby" cause (far / off / stale / blocked / not a friend / rate-limited) = no row.
--   * one fix row per person, overwritten (no history or trail), rounded to 3 decimals, never readable by any client,
--     deleted when sharing is turned off, purged by cron once stale, cascades on account deletion.
--   * spoofing mitigations (residual accepted by the owner: they reduce probing, they cannot stop a determined spoofer):
--     a fix is accepted at most every 5 min unless the person moved >= 0.25 mi, never closer than 30 s apart, never one that
--     implies > 100 mph from a fresh previous fix, at most 20 accepted per hour; reads are limited to 20 per 10 min.
--   * no push, no event, no analytics: nothing here calls _send_push / _emit_event or writes behavior_events.
-- These are disposable presence facts, not ask text, so they are not in the raw-ask purge; the cron purge is their retention.

create table if not exists public.friend_nearby_sharing (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled_at timestamptz not null default now()
);
alter table public.friend_nearby_sharing enable row level security;
revoke all on public.friend_nearby_sharing from public, anon, authenticated;

create table if not exists public.friend_nearby_fixes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  fixed_at timestamptz not null default now(),
  hour_start timestamptz not null default now(),
  hour_count integer not null default 1
);
alter table public.friend_nearby_fixes enable row level security;
revoke all on public.friend_nearby_fixes from public, anon, authenticated;

create table if not exists public.friend_nearby_reads (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null default now(),
  read_count integer not null default 0
);
alter table public.friend_nearby_reads enable row level security;
revoke all on public.friend_nearby_reads from public, anon, authenticated;

-- The parameters, in one place (initial owner values, 2026-10-11; not immutable product constants).
create or replace function public.friend_nearby_params()
returns jsonb language sql immutable set search_path to 'public' as $function$
  select jsonb_build_object(
    'max_fix_age_minutes', 30,
    'nearby_miles', 1.0,
    'min_report_interval_minutes', 5,
    'move_bypass_miles', 0.25,
    'min_report_gap_seconds', 30,
    'max_speed_mph', 100,
    'max_reports_per_hour', 20,
    'max_reads_per_window', 20,
    'read_window_minutes', 10
  );
$function$;
revoke all on function public.friend_nearby_params() from public, anon;
grant execute on function public.friend_nearby_params() to authenticated;

-- Consent. On = a row; off = the consent row AND the stored fix are deleted in this one statement block.
create or replace function public.set_friend_nearby_sharing(on_param boolean)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(on_param, false) then
    insert into friend_nearby_sharing (user_id) values (auth.uid()) on conflict (user_id) do nothing;
    return true;
  end if;
  delete from friend_nearby_fixes where user_id = auth.uid();
  delete from friend_nearby_sharing where user_id = auth.uid();
  return false;
end;
$function$;
revoke all on function public.set_friend_nearby_sharing(boolean) from public, anon;
grant execute on function public.set_friend_nearby_sharing(boolean) to authenticated;

create or replace function public.get_my_friend_nearby_sharing()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select auth.uid() is not null and exists (select 1 from friend_nearby_sharing where user_id = auth.uid());
$function$;
revoke all on function public.get_my_friend_nearby_sharing() from public, anon;
grant execute on function public.get_my_friend_nearby_sharing() to authenticated;

-- A foreground fix. Returns nothing either way (the client learns nothing about whether it was kept).
create or replace function public.report_friend_nearby_fix(lat_param double precision, lng_param double precision)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  p jsonb := friend_nearby_params();
  v_lat double precision;
  v_lng double precision;
  v_prev friend_nearby_fixes%rowtype;
  v_moved numeric;
  v_elapsed_s double precision;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if lat_param is null or lng_param is null or lat_param not between -90 and 90 or lng_param not between -180 and 180 then
    raise exception 'invalid coordinates';
  end if;
  if not exists (select 1 from friend_nearby_sharing where user_id = auth.uid()) then return; end if; -- off: store nothing

  v_lat := round(lat_param::numeric, 3)::double precision;
  v_lng := round(lng_param::numeric, 3)::double precision;
  select * into v_prev from friend_nearby_fixes where user_id = auth.uid() for update;

  if found then
    v_elapsed_s := extract(epoch from (now() - v_prev.fixed_at));
    v_moved := coalesce(_trip_miles(v_prev.lat, v_prev.lng, v_lat, v_lng), 0);
    if v_elapsed_s < (p->>'min_report_gap_seconds')::int then return; end if;
    if v_elapsed_s < (p->>'min_report_interval_minutes')::int * 60 and v_moved < (p->>'move_bypass_miles')::numeric then return; end if;
    -- impossible travel since a still-fresh previous fix (after a stale gap any place is plausible)
    if v_elapsed_s < (p->>'max_fix_age_minutes')::int * 60
       and v_moved > (p->>'max_speed_mph')::numeric * (v_elapsed_s / 3600.0) then return; end if;
    if now() - v_prev.hour_start < interval '1 hour' and v_prev.hour_count >= (p->>'max_reports_per_hour')::int then return; end if;
    update friend_nearby_fixes set lat = v_lat, lng = v_lng, fixed_at = now(),
      hour_start = case when now() - v_prev.hour_start < interval '1 hour' then v_prev.hour_start else now() end,
      hour_count = case when now() - v_prev.hour_start < interval '1 hour' then v_prev.hour_count + 1 else 1 end
    where user_id = auth.uid();
  else
    insert into friend_nearby_fixes (user_id, lat, lng) values (auth.uid(), v_lat, v_lng);
  end if;
end;
$function$;
revoke all on function public.report_friend_nearby_fix(double precision, double precision) from public, anon;
grant execute on function public.report_friend_nearby_fix(double precision, double precision) to authenticated;

-- At most ONE eligible friend, by name. Every non-eligible case is simply no row.
create or replace function public.get_nearby_friends()
returns table(friend_id uuid, display_name text, photo_url text)
language plpgsql security definer set search_path to 'public' as $function$
declare
  p jsonb := friend_nearby_params();
  v_me uuid := auth.uid();
  v_reads friend_nearby_reads%rowtype;
  v_mine friend_nearby_fixes%rowtype;
  v_fresh interval;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  v_fresh := make_interval(mins => (p->>'max_fix_age_minutes')::int);

  -- read rate limit (over it: nothing, same as "no one nearby")
  insert into friend_nearby_reads (user_id, window_start, read_count) values (v_me, now(), 0)
    on conflict (user_id) do nothing;
  select * into v_reads from friend_nearby_reads where user_id = v_me for update;
  if now() - v_reads.window_start >= make_interval(mins => (p->>'read_window_minutes')::int) then
    update friend_nearby_reads set window_start = now(), read_count = 1 where user_id = v_me;
  elsif v_reads.read_count >= (p->>'max_reads_per_window')::int then
    return;
  else
    update friend_nearby_reads set read_count = read_count + 1 where user_id = v_me;
  end if;

  -- the viewer must be sharing AND have a fresh fix of their own
  if not exists (select 1 from friend_nearby_sharing where user_id = v_me) then return; end if;
  select * into v_mine from friend_nearby_fixes where user_id = v_me;
  if not found or v_mine.fixed_at < now() - v_fresh then return; end if;

  return query
    select pr.id, pr.display_name, pr.photo_url
    from friendships f
    join lateral (select case when f.user_a = v_me then f.user_b else f.user_a end as other) o on true
    join friend_nearby_sharing s on s.user_id = o.other
    join friend_nearby_fixes x on x.user_id = o.other
    join profiles pr on pr.id = o.other
    where f.status = 'accepted'
      and (f.user_a = v_me or f.user_b = v_me)
      and x.fixed_at >= now() - v_fresh
      and not viewer_blocked_either_way(o.other)
      and _trip_miles(v_mine.lat, v_mine.lng, x.lat, x.lng) < (p->>'nearby_miles')::numeric
    order by pr.display_name, pr.id
    limit 1;
end;
$function$;
revoke all on function public.get_nearby_friends() from public, anon;
grant execute on function public.get_nearby_friends() to authenticated;

-- Retention: a stale fix means nothing; delete it. Old read windows too.
create or replace function public.purge_friend_nearby()
returns void language sql security definer set search_path to 'public' as $function$
  delete from friend_nearby_fixes where fixed_at < now() - make_interval(mins => (friend_nearby_params()->>'max_fix_age_minutes')::int);
  delete from friend_nearby_reads where window_start < now() - interval '1 day';
$function$;
revoke all on function public.purge_friend_nearby() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'purge-friend-nearby';
select cron.schedule('purge-friend-nearby', '*/10 * * * *', 'select public.purge_friend_nearby();');
