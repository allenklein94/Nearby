-- Owner item 150 (2026-10-03): the business dashboard separates its funnel stages for THIS calendar month:
-- Opportunities -> Offers sent -> Offers accepted -> Redemptions (+ the existing redeemed-offer value).
--
-- Each stage counts the business's OWN offer rows by the real moment that stage happened, in the current calendar
-- month (UTC month boundary, the same rule as get_partner_offer_value, so Redemptions here always equals the
-- "N redemptions" already shown beside the value):
--   opportunities  = a request reached the business        business_request_offers.created_at
--   offers_sent    = the business made an offer             a lifecycle event to 'offered' (20270267), which keeps the
--                                                           moment even if the offer is later withdrawn, expires or is
--                                                           not chosen; an auto-offer counts (it was sent on the
--                                                           business's own standing posting/package/policy). A business
--                                                           decline is never an offer sent.
--   accepted       = the customer accepted                  accepted_at (never cleared; a later cancellation does not
--                                                           undo that it was accepted)
--   redemptions    = the visit was confirmed (redeemed)     completed_at with status 'completed'
-- Event-time counts, not one cohort: an offer sent in September and accepted in October counts in each month's own
-- stage. No money here: the dollar line stays get_partner_offer_value (prices the business set on redeemed offers),
-- never "revenue" (item 149). Owner-only first-party figures, so not floored.
create or replace function public.get_partner_offer_funnel(partner_id_param uuid)
returns table (opportunities bigint, offers_sent bigint, accepted bigint, redemptions bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz := date_trunc('month', now());
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  return query
  select
    (select count(*) from business_request_offers o
      where o.partner_id = partner_id_param and o.created_at >= v_start),
    (select count(distinct e.offer_id) from business_lifecycle_events e
      join business_request_offers o on o.id = e.offer_id
      where o.partner_id = partner_id_param and e.object_kind = 'offer' and e.to_status = 'offered' and e.at >= v_start),
    (select count(*) from business_request_offers o
      where o.partner_id = partner_id_param and o.accepted_at >= v_start),
    (select count(*) from business_request_offers o
      where o.partner_id = partner_id_param and o.status = 'completed' and o.completed_at >= v_start);
end;
$$;
revoke all on function public.get_partner_offer_funnel(uuid) from public, anon;
grant execute on function public.get_partner_offer_funnel(uuid) to authenticated;
