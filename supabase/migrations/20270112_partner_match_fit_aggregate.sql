-- "How well your matches land": the business owner's own aggregate of the consumer's optional
-- "Good match?" answer (business_offer_outcomes.match_fit, added in 20270104). Existing stored data,
-- no new table. Owner-only; returns nothing unless >= demand_min_people() (5) DISTINCT people have
-- answered for this business; percentages only (no per-person answer, no identity, no free text).
create or replace function public.get_partner_match_fit(partner_id_param uuid)
returns table (people_count bigint, pct_yes numeric, pct_somewhat numeric, pct_no numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  return query
  with answers as (
    select boo.reviewer_id, boo.match_fit
    from public.business_offer_outcomes boo
    join public.business_request_offers bro on bro.id = boo.offer_id
    where bro.partner_id = partner_id_param and boo.match_fit is not null
  ), agg as (
    select count(distinct reviewer_id) as people,
           count(*) as n,
           count(*) filter (where match_fit = 'yes') as y,
           count(*) filter (where match_fit = 'somewhat') as s,
           count(*) filter (where match_fit = 'no') as o
    from answers
  )
  select agg.people,
         round(100.0 * agg.y / agg.n, 0),
         round(100.0 * agg.s / agg.n, 0),
         round(100.0 * agg.o / agg.n, 0)
  from agg
  where agg.people >= public.demand_min_people();
end;
$$;

revoke all on function public.get_partner_match_fit(uuid) from public, anon;
grant execute on function public.get_partner_match_fit(uuid) to authenticated;
