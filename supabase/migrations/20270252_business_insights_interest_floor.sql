-- Item 131 audit, owner decision (2026-09-28, LOCKED): "Your community's top interests" on the business dashboard aggregated
-- the profile interests of the business's FOLLOWERS with no minimum, so a business with one follower saw that person's lasting
-- interests. An interest is now shown only when at least demand_min_people() (5) DISTINCT followers share it; below that it is
-- suppressed entirely (no smaller count is shown). The top-five limit is unchanged. This supersedes "a business's own
-- first-party stats are never floored" for lasting consumer interests. Same signature, single overload; best-time unchanged.
create or replace function public.get_business_insights(partner_id_param uuid)
 returns table(top_interests text[], best_hour_of_day integer, best_time_sample timestamp with time zone, best_time_gatherings integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return query select array[]::text[], null::integer, null::timestamptz, null::integer;
    return;
  end if;

  return query
  select
    coalesce(
      (
        select array_agg(interest order by cnt desc, interest)
        from (
          select interest, count(distinct bf.user_id) as cnt
          from business_followers bf
          join profiles p on p.id = bf.user_id
          cross join unnest(coalesce(p.interests, array[]::text[])) as interest
          where bf.brand_partner_id = partner_id_param
          group by interest
          having count(distinct bf.user_id) >= demand_min_people()
          order by cnt desc, interest
          limit 5
        ) sub
      ),
      array[]::text[]
    ) as top_interests,
    best.hr as best_hour_of_day,
    best.sample as best_time_sample,
    best.n as best_time_gatherings
  from (select 1) one
  left join lateral (
    select extract(hour from g.scheduled_at)::int as hr,
           max(g.scheduled_at) as sample,
           count(distinct g.id)::int as n
    from gatherings g
    join gathering_interest gi on gi.gathering_id = g.id and gi.status = 'approved'
    where g.hosting_partner_id = partner_id_param
    group by extract(hour from g.scheduled_at)
    order by count(*) desc, extract(hour from g.scheduled_at)
    limit 1
  ) best on true;
end;
$function$;

revoke all on function public.get_business_insights(uuid) from public, anon;
grant execute on function public.get_business_insights(uuid) to authenticated;
