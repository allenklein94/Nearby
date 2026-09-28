-- Item 127 (2026-09-28, owner decision): category trends from EXISTING canonical data. Analysis only.
--
-- Two sources, never mixed: typed asks (intent_submissions, the one row per typed ask; a business-partnership proposal,
-- intent_kind 'business_partner', is not consumer intent and is left out, as in Match Radar) and business requests.
-- Four dimensions from structured fields only:
--   tag       the canonical leaf tag: the recorded category resolved through the taxonomy (case, former names and merges
--             follow resolve_category_tag, so a renamed or merged tag counts under its current name); a value that is not a
--             category is simply not counted (no "unmatched" bucket, item 30 stays locked)
--   group     the tag's parent group; for a typed ask with no tag, the group the ask itself was narrowed to, if a real one
--   occasion  the ask's recorded interpretation / the request's occasion
--   who_for   the ask's recorded party type (typed asks only: a business request does not store who it is for, by the
--             minimum-payload rule, so that dimension is reported as not_recorded, never guessed)
-- Counts are DISTINCT PEOPLE per period (ten asks for Coffee by one person in a period = 1). Weeks are ISO weeks (Monday)
-- in the database clock (UTC). The comparison is the latest four COMPLETE weeks vs the four before (the current partial
-- week is only in the weekly view). A % change is shown only when BOTH periods have at least 5 people; otherwise the
-- counts are shown with trend_status insufficient_data, and 0 + 0 is no_activity (every live consumer tag and group is
-- listed, so zero activity is explicit, not missing). No raw text, no user id, no per-person row leaves the database:
-- the person-level facts live in a function no client role can run (a view's reader must be able to call it, so the
-- service role keeps execute, as it already reads the base tables); all three are internal (no client/business grant).

create or replace function public._category_trend_facts()
returns table (source text, person uuid, week date, dimension text, value text)
language sql
stable
set search_path to 'public'
as $function$
  with ev as (
    select 'typed_ask'::text as source, s.user_id as person, s.created_at,
           coalesce(s.category, snap.interpretation->>'category') as raw_tag,
           snap.interpretation->>'category_group' as ask_group,
           snap.interpretation->>'occasion' as occasion,
           snap.interpretation->>'party_type' as who_for
    from intent_submissions s
    left join lateral (
      select t.interpretation from typed_ask_snapshots t
      where t.submission_id = s.id and t.parent_snapshot_id is null
      order by t.created_at, t.id limit 1
    ) snap on true
    where s.intent_kind is distinct from 'business_partner'
    union all
    select 'business_request', r.requester_id, r.created_at, r.category, null, r.occasion, null
    from business_requests r
  ),
  canon as (
    select e.source, e.person, date_trunc('week', e.created_at)::date as week, c.tag,
           coalesce(c.group_key, case when e.ask_group = any (category_major_keys()) then e.ask_group end) as grp,
           e.occasion, e.who_for
    from ev e
    left join lateral (
      select g.tag, g.group_key
      from resolve_category_tag(e.raw_tag) r
      join category_tag_groups g on g.id = r.current_tag_id
      where e.raw_tag is not null and r.matched_via <> 'id'
      limit 1
    ) c on true
    where e.person is not null
  )
  select source, person, week, 'tag', tag from canon where tag is not null
  union all select source, person, week, 'group', grp from canon where grp is not null
  union all select source, person, week, 'occasion', occasion from canon where occasion is not null
  union all select source, person, week, 'who_for', who_for from canon where who_for is not null
$function$;
revoke all on function public._category_trend_facts() from public, anon, authenticated;

-- distinct people per source x dimension x value x week (the current partial week included)
create or replace view public.category_trends_weekly as
select f.source, f.dimension, f.value, f.week, count(distinct f.person) as people
from public._category_trend_facts() f
group by f.source, f.dimension, f.value, f.week;
revoke all on public.category_trends_weekly from public, anon, authenticated;

-- latest four complete weeks vs the four before
create or replace view public.category_trends as
with b as (
  select date_trunc('week', now())::date as cw
),
f as (
  select f.* from public._category_trend_facts() f, b where f.week >= b.cw - 56 and f.week < b.cw
),
agg as (
  select f.source, f.dimension, f.value,
         count(distinct f.person) filter (where f.week >= b.cw - 28) as recent_people,
         count(distinct f.person) filter (where f.week < b.cw - 28) as prior_people
  from f, b
  group by f.source, f.dimension, f.value
),
sources as (select unnest(array['typed_ask', 'business_request']) as source),
universe as (
  select s.source, 'tag'::text as dimension, g.tag as value
  from sources s, category_tag_groups g where g.retired_at is null and not g.business_only
  union
  select s.source, 'group', k from sources s, unnest(category_major_keys()) k
  union
  select a.source, a.dimension, a.value from agg a
),
rows as (
  select u.source, u.dimension, u.value,
         coalesce(a.recent_people, 0) as recent_people, coalesce(a.prior_people, 0) as prior_people
  from universe u
  left join agg a on a.source = u.source and a.dimension = u.dimension and a.value = u.value
)
select r.source, r.dimension, r.value,
       b.cw - 28 as recent_from, b.cw - 1 as recent_to, b.cw - 56 as prior_from, b.cw - 29 as prior_to,
       r.recent_people, r.prior_people,
       case when r.recent_people = 0 and r.prior_people = 0 then 'no_activity'
            when r.recent_people < 5 or r.prior_people < 5 then 'insufficient_data'
            else 'comparable' end as trend_status,
       case when r.recent_people >= 5 and r.prior_people >= 5
            then round(100.0 * (r.recent_people - r.prior_people) / r.prior_people, 1) end as pct_change
from rows r, b
union all
-- a dimension a source does not record is said so, never shown as zero
select 'business_request', 'who_for', null, b.cw - 28, b.cw - 1, b.cw - 56, b.cw - 29, null, null, 'not_recorded', null
from b;
revoke all on public.category_trends from public, anon, authenticated;
