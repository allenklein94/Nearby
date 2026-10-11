-- Every business and every business application, with its category declaration (group, primary tag, secondary tags),
-- its availability-posting categories, and what it serves today (business_served_tags). Public business name only.
select 'business' as kind, b.id::text as id, b.name, case when b.active then 'active' else 'inactive' end as status,
  b.category as group_key, b.subcategory as primary_tag, b.categories as secondary_tags,
  (select array_agg(distinct ba.category) from business_availability ba where ba.partner_id = b.id and ba.category is not null) as availability_tags,
  (select array_agg(t order by t) from unnest(business_served_tags(b.id)) t) as serves
from brand_partners b
union all
select 'application', a.id::text, a.business_name, a.status::text, a.category, a.subcategory, a.categories, null, null
from business_partner_requests a
order by 1, 2;
