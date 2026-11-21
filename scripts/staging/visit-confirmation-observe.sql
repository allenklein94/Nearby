-- Visit confirmation (20270430-0432), staging section 2b: READ-ONLY. Run after each V step (staging only; it needs 0430's
-- columns, so it errors before 0430 is applied). One row per booking: who finished it, the no-show, the plan, and how many
-- OFFER_REDEEMED events exist (must be 1 only once the business confirmed, 0 for a customer's own mark).
select o.id as offer_id,
       b.name as business,
       o.status,
       o.customer_done_at is not null as customer_marked,
       o.visit_confirmed_at is not null as business_confirmed,
       exists (select 1 from business_visit_no_shows n where n.offer_id = o.id) as no_show,
       (select count(*) from domain_events e where e.type = 'OFFER_REDEEMED' and e.object_id = o.id) as redeemed_events,
       (select string_agg(p.status, ',') from plans p where p.resulting_business_request_id = o.request_id) as plan_status,
       r.status as reservation_status
from business_request_offers o
join brand_partners b on b.id = o.partner_id
left join business_reservations r on r.offer_id = o.id
where o.status in ('accepted', 'completed')
order by o.accepted_at desc nulls last;

-- The business figures 0430 switched, per business (confirmed visits only; customer marks never counted).
select b.name as business,
       count(*) filter (where o.status = 'completed') as status_completed,
       count(*) filter (where o.visit_confirmed_at is not null) as confirmed_visits,
       count(*) filter (where o.customer_done_at is not null and o.visit_confirmed_at is null) as customer_marked_only
from brand_partners b
left join business_request_offers o on o.partner_id = b.id
group by b.name order by b.name;
