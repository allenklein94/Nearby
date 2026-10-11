-- SELF-TEST of 14_business_impact.sql (generated: the same query with synthetic fixtures in place of real rows). READ-ONLY (one SELECT; nothing is created or changed).
-- Re-run this immediately before the migration: production will have more businesses by then (live market seeding).
--
-- For every business (brand_partners) and every pending/approved application (business_partner_requests) it compares what
-- the declaration covers TODAY (the live business_served_tags rule) with what the SAME declaration would cover after the
-- proposed V1 mapping, and flags every declaration the pass would make invalid. It never proposes a change to a business's
-- declaration; it only shows the effect.
--
-- The proposed mapping is written out below (`moved`, `added`, `retired`, `customer_only`, `group_map`) and must stay
-- identical to PRODUCT_AUDIT/item168_prep/mapping.json (the cross-check script compares them).
--
-- business_served_tags today: primary tag + secondary tags + availability-posting tags; a business with NO primary tag and
-- NO secondary tags additionally serves every tag of its group (the "group-only" fallback). That fallback is where a move
-- silently changes coverage, so it is computed both ways here.
with
moved(tag, new_group) as (values
  ('Fitness','sports_fitness'),('Gyms','sports_fitness'),('Yoga','sports_fitness'),('Pilates','sports_fitness'),
  ('Cycling','sports_fitness'),('Running','sports_fitness'),('Martial Arts','sports_fitness'),('Climbing','sports_fitness'),
  ('Skating','sports_fitness'),('Sports','sports_fitness'),('Pickleball','sports_fitness'),('Padel','sports_fitness'),
  ('Tennis','sports_fitness'),('Basketball','sports_fitness'),('Soccer','sports_fitness'),('Volleyball','sports_fitness'),
  ('Golf','sports_fitness'),('Swimming','sports_fitness'),
  ('Boating','outdoors_nature'),('Water Sports','outdoors_nature'),
  ('Family Resorts','travel_experiences'),('Glamping','travel_experiences'),('Hotels','travel_experiences'),
  ('Resorts','travel_experiences'),('Road Trip','travel_experiences'),('Romantic Getaways','travel_experiences'),
  ('Spa Resorts','travel_experiences'),('Staycation','travel_experiences'),('Vacation Rentals','travel_experiences'),
  ('Weekend Getaway','travel_experiences')
),
added(tag, grp) as (values
  ('Tea','food_drink'),('Distilleries','food_drink'),
  ('Axe Throwing','activities_recreation'),('Laser Tag','activities_recreation'),('Go-Karts','activities_recreation'),
  ('Paintball','activities_recreation'),('Trampoline Parks','activities_recreation'),('Horseback Riding','activities_recreation'),
  ('Recreation Centers','activities_recreation'),
  ('Personal Training','sports_fitness'),
  ('Grocery','shopping'),('Sporting Goods','shopping'),('Toys','shopping'),('Bookstores','shopping'),('Beauty Supply','shopping'),
  ('Pet Sitting','pets'),
  ('House Painting','home_local_services'),('Storage','home_local_services'),('Contractors','home_local_services'),('Home Security','home_local_services'),
  ('Auto Parts','auto_transportation'),('Dealerships','auto_transportation'),('Gas Stations','auto_transportation'),('Transportation Services','auto_transportation')
),
retired(tag) as (values ('Pet Friendly Places'),('Pet Friendly Stays')),
customer_only(tag) as (values ('Dating'),('Date Night'),('First Date'),('Double Date'),('Couples'),('Group Hangouts'),('Make New Friends')),
group_map(old_key, new_key) as (values ('stay_getaway','travel_experiences')),  -- the only group key that stops existing
max_secondary(n) as (values (5)),
-- Tag -> group, before and after.
tags_before as (select tag, group_key as grp from category_tag_groups where retired_at is null),
tags_after as (
  select t.tag, coalesce(m.new_group, t.grp) as grp from tags_before t left join moved m using (tag)
  where t.tag not in (select tag from retired)
  union all select tag, grp from added
),
decl as (
  -- SELF-TEST FIXTURES (synthetic, never stored): one per rule the script must catch.
  select * from (values
    ('fixture', null::uuid, 'F1 group-only Activities', 'active', 'activities_recreation', null::text, '{}'::text[], '{}'::text[]),
    ('fixture', null, 'F2 group-only Stay & Getaway', 'active', 'stay_getaway', null, '{}', '{}'),
    ('fixture', null, 'F3 primary Gyms (moves)', 'active', 'activities_recreation', 'Gyms', '{}', '{}'),
    ('fixture', null, 'F4 secondary Pet Friendly Places (retires)', 'active', 'pets', 'Dog Walking', '{Pet Friendly Places}', '{}'),
    ('fixture', null, 'F5 primary Date Night (customer-only)', 'active', 'dating_social', 'Date Night', '{}', '{}'),
    ('fixture', null, 'F6 group-only Dating & Social', 'active', 'dating_social', null, '{}', '{}'),
    ('fixture', null, 'F7 six secondaries', 'active', 'food_drink', 'Coffee', '{Bakeries,Breakfast,Brunch,Pastries,Wine,Foodie}', '{}'),
    ('fixture', null, 'F8 group-only Pets', 'active', 'pets', null, '{}', '{}'),
    ('fixture', null, 'F9 explicit Hotels + Tours (no coverage change)', 'active', 'stay_getaway', 'Hotels', '{Tours}', '{}')
  ) f(kind, id, name, status, grp, primary_tag, secondary, posted)
),
calc as (
  select d.*,
    (d.primary_tag is null and cardinality(d.secondary) = 0) as group_only,
    coalesce((select new_key from group_map where old_key = d.grp), d.grp) as grp_after,
    -- covered today
    array(select distinct t from (
      select d.primary_tag as t union select unnest(d.secondary) union select unnest(d.posted)
      union select tb.tag from tags_before tb where d.primary_tag is null and cardinality(d.secondary) = 0 and tb.grp = d.grp
    ) s where t is not null order by t) as serves_before,
    -- covered after, same declaration (retired and customer-only tags no longer count)
    array(select distinct t from (
      select d.primary_tag as t union select unnest(d.secondary) union select unnest(d.posted)
      union select ta.tag from tags_after ta
        where d.primary_tag is null and cardinality(d.secondary) = 0
          and ta.grp = coalesce((select new_key from group_map where old_key = d.grp), d.grp)
    ) s where t is not null and t not in (select tag from retired) and t not in (select tag from customer_only) order by t) as serves_after
  from decl d
)
select kind, id, name, status, grp as group_before, grp_after as group_after, primary_tag, secondary, posted,
  group_only,
  array(select unnest(serves_before) except select unnest(serves_after) order by 1) as stops_serving,
  array(select unnest(serves_after) except select unnest(serves_before) order by 1) as starts_serving,
  -- declarations the pass makes invalid or inconsistent (never fixed silently)
  array_remove(array[
    case when primary_tag in (select tag from retired) then 'primary tag retired' end,
    case when exists (select 1 from unnest(secondary) s where s in (select tag from retired)) then 'secondary tag retired' end,
    case when primary_tag in (select tag from customer_only) then 'primary tag becomes customer-only' end,
    case when exists (select 1 from unnest(secondary) s where s in (select tag from customer_only)) then 'secondary tag becomes customer-only' end,
    case when group_only and grp = 'dating_social' then 'group-only Dating & Social: group no longer business-selectable without Speed Dating / Singles Events / Social Clubs' end,
    case when cardinality(secondary) > (select n from max_secondary) then 'more than 5 secondary categories' end,
    case when primary_tag is not null and (select ta.grp from tags_after ta where ta.tag = primary_tag) is distinct from grp_after
      then 'group must follow its moved primary tag: ' || grp_after || ' -> ' || coalesce((select ta.grp from tags_after ta where ta.tag = primary_tag), '?') end,
    case when grp is distinct from grp_after then 'stored group key renamed: ' || grp || ' -> ' || grp_after end
  ], null) as flags,
  serves_before, serves_after
from calc
order by kind, name;
