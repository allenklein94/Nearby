-- Gathering Hub: the live, day-of experience for people who already joined
-- a gathering (distinct from GatheringDetailScreen, which is the
-- persuade-you-to-join page). Closes the "after you tap Join, then...
-- nothing" gap from the Aug 7 vision doc.
--
-- Two self-reported signals only — "on my way" and "checked in" are
-- exactly what they sound like: a tap, not GPS verification. No live
-- location sharing or ETA tracking is added here; this codebase has no
-- directions/ETA API integrated anywhere and gatherings only ever expose
-- fuzzed coordinates to the client by design (see get_gathering_distances).
-- Building real continuous location sharing between attendees who haven't
-- met yet is a materially different privacy posture and a distinct future
-- feature, not a checkbox on this pass.
alter table public.gathering_interest
  add column if not exists on_my_way_at timestamptz,
  add column if not exists checked_in_at timestamptz;

-- Mutations go through SECURITY DEFINER RPCs rather than a broad
-- self-UPDATE RLS policy on gathering_interest, matching this codebase's
-- convention (see the approve/deny policy comment in gathering_questions.sql)
-- of not opening full-row client UPDATE access to a table that also holds
-- `status`/`match_id`.
create or replace function public.set_gathering_on_my_way(gathering_id_param uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update gathering_interest
  set on_my_way_at = coalesce(on_my_way_at, now())
  where gathering_id = gathering_id_param
    and user_id = auth.uid()
    and status = 'approved';
$$;

create or replace function public.check_in_to_gathering(gathering_id_param uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update gathering_interest
  set checked_in_at = coalesce(checked_in_at, now())
  where gathering_id = gathering_id_param
    and user_id = auth.uid()
    and status = 'approved';
$$;

revoke all on function public.set_gathering_on_my_way(uuid) from public, anon;
grant execute on function public.set_gathering_on_my_way(uuid) to authenticated;

revoke all on function public.check_in_to_gathering(uuid) from public, anon;
grant execute on function public.check_in_to_gathering(uuid) to authenticated;

-- Exact coordinates ("Meet-Up Point") only for the host or someone already
-- approved to attend — the app has never exposed gatherings.precise_lat/lng
-- to the client directly (SAFE_GATHERING_FIELDS deliberately excludes it),
-- so this is a new, narrow, honest-need exception to that rule rather than
-- a change to it. Returns an empty set (not an error) for anyone else.
create or replace function public.get_gathering_meetup_point(gathering_id_param uuid)
returns table(latitude numeric, longitude numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select g.precise_lat, g.precise_lng
  from gatherings g
  where g.id = gathering_id_param
    and (
      g.host_id = auth.uid()
      or exists (
        select 1 from gathering_interest gi
        where gi.gathering_id = g.id
          and gi.user_id = auth.uid()
          and gi.status = 'approved'
      )
    );
$$;

revoke all on function public.get_gathering_meetup_point(uuid) from public, anon;
grant execute on function public.get_gathering_meetup_point(uuid) to authenticated;
