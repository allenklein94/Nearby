-- Rollback for 20270409: back to 20270322's get_gathering_approved_counts (count only, no trending column), same grants.
-- A new build on the rolled-back database reads no `trending` value, so it shows Trending nowhere (missing = not trending);
-- build <= 87 is unaffected either way.
drop function if exists public.get_gathering_approved_counts(uuid[]);

create function public.get_gathering_approved_counts(gathering_ids uuid[])
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

revoke all on function public.get_gathering_approved_counts(uuid[]) from public, anon;
grant execute on function public.get_gathering_approved_counts(uuid[]) to authenticated, service_role;
