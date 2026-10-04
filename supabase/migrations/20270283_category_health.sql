-- Category health (owner, 2026-10-04): an INTERNAL, structured view of where supply is missing, per canonical category
-- and area. Instrumentation for V1 taxonomy health; no screen, no app or business reader (service role only).
--
-- Metrics, all from existing structured fields:
--   supply (inventory, NOT people-derived, never floored)
--     gatherings_created     gatherings created in the window whose interest_tag resolves to the category
--     upcoming_gatherings    gatherings in the category that start after now (stock, not windowed)
--     businesses_serving     active businesses whose canonical served tags (business_served_tags, the one routing rule:
--                            declared tags, else the whole major) include the category (stock, not windowed)
--   demand that supply failed (people-derived, floored at demand_min_people(), DISTINCT PEOPLE)
--     asks_no_result_people        typed asks (not business_partner proposals) with had_any_result = false, category from
--                                  the structured record (intent_submissions.category, else the original snapshot's
--                                  interpretation), resolved through the taxonomy
--     requests_unreached_people    business requests that reached no business: no business_request_offers row at all
--                                  (the same "reached" definition as request_journey / request_funnel_summary, item 153)
--
-- Privacy boundary (locked, items 128/130/166): raw ask text is never read here; an ask with no recorded category is not
-- counted (no "unmapped" bucket, no term list, nothing inferred from words). A structured empty result says supply failed,
-- not what the person typed. No person id leaves the view. A demand figure below the floor is NULL; an all-areas figure is
-- also NULL when the shown area figures would let a hidden area's count (1 to floor-1) be worked out by subtraction.
--
-- Area = the existing coarse wide_area grid (0.1 degree, the bucket the app already writes on profiles, gatherings and
-- typed asks), computed for businesses and requests from their coordinates with the app's exact rounding (half up). NULL
-- area = not recorded (e.g. a typed ask with no location permission). Window for the created/demand metrics = the latest
-- four COMPLETE ISO weeks in UTC, the same window as the item-127 trend views.

create or replace function public._health_area(lat double precision, lng double precision)
returns text language sql immutable as $$
  select case when lat is not null and lng is not null
    then (floor(lat * 10 + 0.5) / 10)::text || ',' || (floor(lng * 10 + 0.5) / 10)::text end;
$$;
revoke all on function public._health_area(double precision, double precision) from public, anon, authenticated;

create or replace view public.category_health_by_area as
with b as (
  select date_trunc('week', now()) as cw
),
tags as (
  select g.id as tag_id, g.key as tag_key, g.tag, g.group_key, g.business_only
  from category_tag_groups g where g.retired_at is null
),
gath as (
  select c.tag_id, coalesce(g.wide_area, _health_area(g.precise_lat::float8, g.precise_lng::float8)) as area,
         g.created_at, g.scheduled_at
  from gatherings g
  cross join lateral (
    select r.current_tag_id as tag_id from resolve_category_tag(g.interest_tag) r
    where r.matched_via <> 'id' limit 1
  ) c
  where g.interest_tag is not null
),
biz as (
  select t.tag_id, _health_area(p.latitude, p.longitude) as area, p.id as partner_id
  from brand_partners p
  cross join lateral unnest(business_served_tags(p.id)) st(name)
  join tags t on t.tag = st.name
  where p.active
),
ask as (
  select c.tag_id, s.wide_area as area, s.user_id as person
  from intent_submissions s
  cross join b
  left join lateral (
    select t.interpretation from typed_ask_snapshots t
    where t.submission_id = s.id and t.parent_snapshot_id is null
    order by t.created_at, t.id limit 1
  ) snap on true
  cross join lateral (
    select r.current_tag_id as tag_id from resolve_category_tag(coalesce(s.category, snap.interpretation->>'category')) r
    where r.matched_via <> 'id' limit 1
  ) c
  where s.intent_kind is distinct from 'business_partner'
    and s.had_any_result = false
    and s.user_id is not null
    and s.created_at >= b.cw - interval '28 days' and s.created_at < b.cw
),
req as (
  select c.tag_id, _health_area(r.latitude, r.longitude) as area, r.requester_id as person
  from business_requests r
  cross join b
  cross join lateral (
    select x.current_tag_id as tag_id from resolve_category_tag(r.category) x
    where x.matched_via <> 'id' limit 1
  ) c
  where r.requester_id is not null
    and not exists (select 1 from business_request_offers o where o.request_id = r.id)
    and r.created_at >= b.cw - interval '28 days' and r.created_at < b.cw
),
keys as (
  select tag_id, area from gath union select tag_id, area from biz
  union select tag_id, area from ask union select tag_id, area from req
),
raw as (
  select k.tag_id, k.area,
    (select count(*) from gath g, b where g.tag_id = k.tag_id and g.area is not distinct from k.area
       and g.created_at >= b.cw - interval '28 days' and g.created_at < b.cw) as gatherings_created,
    (select count(*) from gath g where g.tag_id = k.tag_id and g.area is not distinct from k.area
       and g.scheduled_at > now()) as upcoming_gatherings,
    (select count(distinct z.partner_id) from biz z where z.tag_id = k.tag_id and z.area is not distinct from k.area) as businesses_serving,
    (select count(distinct a.person) from ask a where a.tag_id = k.tag_id and a.area is not distinct from k.area) as ask_people,
    (select count(distinct q.person) from req q where q.tag_id = k.tag_id and q.area is not distinct from k.area) as req_people
  from keys k
)
select t.tag_id, t.tag_key, t.tag, t.group_key, t.business_only, r.area,
       (b.cw - interval '28 days')::date as window_from, (b.cw - interval '1 day')::date as window_to,
       r.gatherings_created, r.upcoming_gatherings, r.businesses_serving,
       case when r.ask_people >= demand_min_people() then r.ask_people end as asks_no_result_people,
       case when r.req_people >= demand_min_people() then r.req_people end as requests_unreached_people
from raw r
join tags t on t.tag_id = r.tag_id
cross join b;
revoke all on public.category_health_by_area from public, anon, authenticated;

-- One row per live canonical category (zeros explicit), all areas together. Demand figures are distinct people across
-- areas, floored, and withheld when subtracting the shown area figures would reveal a hidden area's small count.
create or replace view public.category_health as
with b as (
  select date_trunc('week', now()) as cw
),
tags as (
  select g.id as tag_id, g.key as tag_key, g.tag, g.group_key, g.business_only
  from category_tag_groups g where g.retired_at is null
),
gath as (
  select c.tag_id, g.created_at, g.scheduled_at
  from gatherings g
  cross join lateral (
    select r.current_tag_id as tag_id from resolve_category_tag(g.interest_tag) r
    where r.matched_via <> 'id' limit 1
  ) c
  where g.interest_tag is not null
),
biz as (
  select t.tag_id, p.id as partner_id
  from brand_partners p
  cross join lateral unnest(business_served_tags(p.id)) st(name)
  join tags t on t.tag = st.name
  where p.active
),
ask as (
  select c.tag_id, s.user_id as person
  from intent_submissions s
  cross join b
  left join lateral (
    select t.interpretation from typed_ask_snapshots t
    where t.submission_id = s.id and t.parent_snapshot_id is null
    order by t.created_at, t.id limit 1
  ) snap on true
  cross join lateral (
    select r.current_tag_id as tag_id from resolve_category_tag(coalesce(s.category, snap.interpretation->>'category')) r
    where r.matched_via <> 'id' limit 1
  ) c
  where s.intent_kind is distinct from 'business_partner'
    and s.had_any_result = false
    and s.user_id is not null
    and s.created_at >= b.cw - interval '28 days' and s.created_at < b.cw
),
req as (
  select c.tag_id, r.requester_id as person
  from business_requests r
  cross join b
  cross join lateral (
    select x.current_tag_id as tag_id from resolve_category_tag(r.category) x
    where x.matched_via <> 'id' limit 1
  ) c
  where r.requester_id is not null
    and not exists (select 1 from business_request_offers o where o.request_id = r.id)
    and r.created_at >= b.cw - interval '28 days' and r.created_at < b.cw
),
shown as (
  select tag_id, coalesce(sum(asks_no_result_people), 0) as ask_shown, coalesce(sum(requests_unreached_people), 0) as req_shown
  from category_health_by_area group by tag_id
),
raw as (
  select t.tag_id,
    (select count(*) from gath g, b where g.tag_id = t.tag_id
       and g.created_at >= b.cw - interval '28 days' and g.created_at < b.cw) as gatherings_created,
    (select count(*) from gath g where g.tag_id = t.tag_id and g.scheduled_at > now()) as upcoming_gatherings,
    (select count(distinct z.partner_id) from biz z where z.tag_id = t.tag_id) as businesses_serving,
    (select count(distinct a.person) from ask a where a.tag_id = t.tag_id) as ask_people,
    (select count(distinct q.person) from req q where q.tag_id = t.tag_id) as req_people
  from tags t
)
select t.tag_id, t.tag_key, t.tag, t.group_key, t.business_only,
       (b.cw - interval '28 days')::date as window_from, (b.cw - interval '1 day')::date as window_to,
       r.gatherings_created, r.upcoming_gatherings, r.businesses_serving,
       case when r.ask_people >= demand_min_people()
             and not (r.ask_people - coalesce(s.ask_shown, 0) between 1 and demand_min_people() - 1)
            then r.ask_people end as asks_no_result_people,
       case when r.req_people >= demand_min_people()
             and not (r.req_people - coalesce(s.req_shown, 0) between 1 and demand_min_people() - 1)
            then r.req_people end as requests_unreached_people
from tags t
join raw r on r.tag_id = t.tag_id
left join shown s on s.tag_id = t.tag_id
cross join b;
revoke all on public.category_health from public, anon, authenticated;
