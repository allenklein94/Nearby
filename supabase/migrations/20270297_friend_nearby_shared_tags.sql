-- Item 40 (owner, 2026-10-11): "Friend + activity collision". When the ONE nearby friend (item 39) and the viewer both declared
-- an interest, Home can say "You + {Name} might like this" on a gathering of that interest. The only new fact is which of the
-- viewer's OWN declared interests the friend declared too, the same fact get_friends_interested_in already gives an accepted
-- friend ("Sam is into Coffee"); never the friend's other interests, never learned behaviour, never anything about location.
-- Eligibility is unchanged from 20270296 (mutual opt-in, accepted friend, no block, both fresh, < ~1 mi, read limit): the
-- shared tags come only with the one row that passes it. The return type changes, so the old function is dropped first.
drop function if exists public.get_nearby_friends();

create function public.get_nearby_friends()
returns table(friend_id uuid, display_name text, photo_url text, shared_tags text[])
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
    select pr.id, pr.display_name, pr.photo_url,
           coalesce((select array_agg(distinct t order by t)
                     from unnest(coalesce(pr.interests, array[]::text[])) t
                     where t = any (coalesce(me.interests, array[]::text[]))), array[]::text[])
    from friendships f
    join lateral (select case when f.user_a = v_me then f.user_b else f.user_a end as other) o on true
    join friend_nearby_sharing s on s.user_id = o.other
    join friend_nearby_fixes x on x.user_id = o.other
    join profiles pr on pr.id = o.other
    join profiles me on me.id = v_me
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
