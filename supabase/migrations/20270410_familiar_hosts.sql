-- Host familiarity as a ranking tie-breaker (owner, 2026-11-11; staged, after 20270409; ships with a NEW app build).
--
-- Personalization only, never trust: nothing here touches private.trust_level, rate limits, moderation, visibility or access,
-- and nothing is shown to anyone. The app reads it to break ties between gatherings that rank EQUALLY on everything else
-- (src/utils/hostFamiliarity.js): a gathering hosted by someone the viewer has really been at gatherings with comes first.
--
-- get_my_familiar_hosts() -> (person_id, shared_count) for the signed-in viewer only:
--   shared_count = distinct gatherings that have ENDED (public._gathering_ends_at, the one end rule) within the last 365 days
--   where the viewer and that person were both there: the viewer an approved attendee and the person the host or an approved
--   attendee, or the viewer the host and the person an approved attendee. Capped at 3 (more never weighs more).
--   Never the viewer; never someone blocked either way (viewer_blocked_either_way); never a suspended account.
--   Upcoming or in-progress gatherings never count (owner: a coordinated group can't farm familiarity by joining fake
--   gatherings ahead of time; each one has to actually end, and the viewer has to have been in it themselves).
-- Existing data only (gathering_interest + gatherings); no new table, column, tracking or write. Participation is not proof
-- that people met, so this stays a modest relevance signal, never a credibility measure.
-- Signed-out callers are refused; anon/public have no EXECUTE.

create function public.get_my_familiar_hosts()
 returns table(person_id uuid, shared_count integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  return query
    with ended as (
      select g.id, g.host_id
      from public.gatherings g
      where g.scheduled_at > now() - interval '365 days'
        and public._gathering_ends_at(g.scheduled_at, g.duration_minutes) <= now()
    ),
    mine as (
      -- ended gatherings the viewer was at: as an approved attendee, or as the host
      select e.id, e.host_id from ended e
      where e.host_id = v_me
         or exists (select 1 from public.gathering_interest gi where gi.gathering_id = e.id and gi.user_id = v_me and gi.status = 'approved')
    ),
    together as (
      select m.id, m.host_id as other from mine m where m.host_id <> v_me
      union
      select m.id, gi.user_id from mine m
      join public.gathering_interest gi on gi.gathering_id = m.id and gi.status = 'approved' and gi.user_id <> v_me
    )
    select t.other, least(count(distinct t.id), 3)::integer
    from together t
    join public.profiles p on p.id = t.other and p.suspended_at is null
    where not public.viewer_blocked_either_way(t.other)
    group by t.other;
end;
$function$;

revoke all on function public.get_my_familiar_hosts() from public, anon;
grant execute on function public.get_my_familiar_hosts() to authenticated, service_role;
