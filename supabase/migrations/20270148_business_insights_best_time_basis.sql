-- "Best-performing time" was an hour-of-day taken in the database's timezone
-- (UTC) and printed as if it were the owner's local clock, from any sample
-- size, and weighted by attendee rows. It now also returns a real sample
-- start time from the winning group (so the client shows the owner's LOCAL
-- hour) and how many distinct gatherings the figure rests on, so the screen
-- can state its basis ("most attended start time, from N gatherings").
-- Return shape changes, so drop the old signature first (single overload).
drop function if exists public.get_business_insights(uuid);

create function public.get_business_insights(partner_id_param uuid)
returns table (top_interests text[], best_hour_of_day integer, best_time_sample timestamptz, best_time_gatherings integer)
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
        select array_agg(interest order by cnt desc)
        from (
          select interest, count(*) as cnt
          from business_followers bf
          join profiles p on p.id = bf.user_id
          cross join unnest(coalesce(p.interests, array[]::text[])) as interest
          where bf.brand_partner_id = partner_id_param
          group by interest
          order by cnt desc
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
grant execute on function public.get_business_insights(uuid) to authenticated, service_role;
