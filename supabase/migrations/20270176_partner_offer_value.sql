-- Item 85: "1 redemption -> $12" for the business. The dollar figure is the OWNER'S OWN price on offers that were really
-- redeemed (status 'completed', confirmed by the visit/code), never an estimate of spend or earnings: a per-person price
-- is multiplied by the request's real party size, and an offer with no price (or a per-person price with no party size)
-- is COUNTED as a redemption but contributes no dollars and is reported separately, so nothing is invented.
-- Owner-only, first-party figure about the owner's own customers (not demand about strangers), so it is not floored.
create or replace function get_partner_offer_value(partner_id_param uuid)
returns table (
  month_redemptions bigint, month_value numeric, month_unpriced bigint,
  all_redemptions bigint, all_value numeric, all_unpriced bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  return query
  with done as (
    select o.completed_at,
      case
        when o.offer_price is null then null
        when o.price_is_per_person then case when r.party_size is null then null else o.offer_price * r.party_size end
        else o.offer_price
      end as value
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where o.partner_id = partner_id_param and o.status = 'completed'
  )
  select
    count(*) filter (where completed_at >= date_trunc('month', now())),
    coalesce(sum(value) filter (where completed_at >= date_trunc('month', now())), 0),
    count(*) filter (where completed_at >= date_trunc('month', now()) and value is null),
    count(*),
    coalesce(sum(value), 0),
    count(*) filter (where value is null)
  from done;
end;
$$;
revoke all on function get_partner_offer_value(uuid) from public, anon;
grant execute on function get_partner_offer_value(uuid) to authenticated;
