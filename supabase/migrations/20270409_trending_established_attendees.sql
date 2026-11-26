-- Trending needs established attendees (owner, 2026-11-11; staged, after 20270408; ships with a NEW app build, never build <= 87).
--
-- Before: "🔥 Trending" (badge, Discover section, Home trending list, Trending filter) was decided on the phone from the approved
-- attendee count alone (>= 5). Five accounts created the same day (or five accounts the host invited) made any gathering
-- "Trending" without a single established person going.
--
-- After: get_gathering_approved_counts keeps `approved_count` EXACTLY as before (the "N attending" fact, capacity, ranking points,
-- build <= 87's own Trending check) and adds one yes/no column `trending`:
--   true  = at least 5 approved attendees whose account is Established right now (private.trust_level: verified phone + account
--           age >= the established age, not suspended), never counting the host;
--   false = anything else.
-- The server returns ONLY the yes/no answer, never an established-attendee count (a count beside approved_count would reveal how
-- many attendees are new accounts). Joining, invitations (an invited established joiner counts like any other), Interested,
-- attendance figures and the popularity ranking are unchanged. Nobody is blocked, ranked down, labelled or notified.
-- The 5 is the client's TRENDING_ATTENDANCE_MIN (src/constants/trending.js; guard trendingEstablished.test.js keeps them equal).
-- Not touched: get_trending_gathering_ids (no app caller; returns ids + counts, makes no Trending claim).
-- A changed return type needs drop + create; same name, argument, language, owner checks and grants as 20270147 / 20270322.

drop function if exists public.get_gathering_approved_counts(uuid[]);

create function public.get_gathering_approved_counts(gathering_ids uuid[])
 returns table(gathering_id uuid, approved_count integer, trending boolean)
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
    select gi.gathering_id,
           count(*)::integer,
           (count(*) filter (where gi.user_id <> g.host_id and private.trust_level(gi.user_id) = 'established')) >= 5
    from public.gathering_interest gi
    join public.gatherings g on g.id = gi.gathering_id
    where gi.gathering_id = any (gathering_ids)
      and gi.status = 'approved'
      and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)
    group by gi.gathering_id;
end;
$function$;

revoke all on function public.get_gathering_approved_counts(uuid[]) from public, anon;
grant execute on function public.get_gathering_approved_counts(uuid[]) to authenticated, service_role;
