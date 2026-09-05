alter table public.gatherings
  add column if not exists show_group_insights boolean not null default true;

-- Real aggregate-only surface, modeled on get_missed_match_summary() /
-- get_partner_decline_patterns()'s shape: SECURITY DEFINER, does 100% of
-- the math and thresholding server-side, returns zero raw per-attendee
-- rows. profiles' own SELECT RLS is row-level only (no column
-- restriction) and would already leak birthdate/gender_identity for
-- verified+visible attendees via a naive client join while silently
-- dropping hidden/unverified ones (skewing any client-side aggregate) --
-- this function reads profiles directly (bypassing RLS) specifically to
-- aggregate over ALL approved attendees correctly, then discards the raw
-- rows entirely before returning.
create or replace function public.get_gathering_group_insights(gathering_id_param uuid)
returns table (
  approved_count integer,
  makeup_tier text,         -- 'none' | 'coarse' | 'precise'
  age_coarse_label text,    -- e.g. 'Mostly 25-34' / 'Mixed ages' (coarse tier only)
  gender_coarse_label text, -- e.g. 'Mostly women' / 'Mixed group' (coarse tier only)
  age_buckets jsonb,        -- [{label, pct}], precise tier only, pre-suppressed
  gender_buckets jsonb,     -- [{label, pct}], precise tier only, pre-suppressed
  interest_names text[],    -- top 3 tags, coarse tier (no counts)
  interest_counts jsonb     -- [{tag, count}], precise tier
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
  v_party_type text;
  v_show boolean;
  v_tier text;
  v_min_bucket integer := 2; -- flat floor: never show a bucket built from 1 person
  v_interest_names text[];
begin
  select party_type, show_group_insights into v_party_type, v_show
  from gatherings where id = gathering_id_param;

  select count(*) into v_count from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';

  -- Shared interests (names only) are allowed even when the makeup panel
  -- itself is suppressed -- they're not demographic and were part of the
  -- spec's small-group example too ("Shared interests: Coffee . Food .
  -- Music"). Computed once, returned regardless of tier below.
  select array_agg(tag order by cnt desc) into v_interest_names
  from (
    select unnest(p.interests) as tag, count(*) as cnt
    from gathering_interest gi join profiles p on p.id = gi.user_id
    where gi.gathering_id = gathering_id_param and gi.status = 'approved'
    group by tag order by count(*) desc limit 3
  ) top3;

  if v_count < 3 or coalesce(v_show, true) is false then
    return query select v_count, 'none'::text, null::text, null::text,
      '[]'::jsonb, '[]'::jsonb, coalesce(v_interest_names, '{}'::text[]), '[]'::jsonb;
    return;
  end if;

  if v_party_type = 'date' and v_count < 15 then
    return query select v_count, 'none'::text, null::text, null::text,
      '[]'::jsonb, '[]'::jsonb, coalesce(v_interest_names, '{}'::text[]), '[]'::jsonb;
    return;
  end if;

  v_tier := case
    when v_party_type = 'date' then 'coarse'          -- dating: coarse-only, even at 15+
    when v_count >= 10 then 'precise'                 -- regular: precise at GROUP_INSIGHTS_MIN
    else 'coarse'                                      -- regular 3-9: coarse
  end;

  -- Age buckets match the product spec's own 4-bucket example exactly
  -- (18-24 / 25-34 / 35-44 / 45+), not an invented finer scheme.
  return query
  with ages as (
    select case
      when extract(year from age(current_date, p.birthdate)) < 25 then '18-24'
      when extract(year from age(current_date, p.birthdate)) < 35 then '25-34'
      when extract(year from age(current_date, p.birthdate)) < 45 then '35-44'
      else '45+'
    end as bucket
    from gathering_interest gi join profiles p on p.id = gi.user_id
    where gi.gathering_id = gathering_id_param and gi.status = 'approved'
      and p.birthdate is not null
  ),
  age_agg as (select bucket as label, count(*) as cnt from ages group by bucket),
  -- Gender uses profiles.gender (the same field the existing women_only
  -- gathering_interest RLS policy already keys off), not gender_identity
  -- (a richer array field used elsewhere) -- consistency with an
  -- already-load-bearing convention, not a new one. gender_hidden opt-out
  -- and null gender are both excluded entirely (never lumped into a false
  -- "Other" -- unknown is not a real bucket).
  genders as (
    select case
      when lower(p.gender) in ('female', 'woman') then 'Women'
      when lower(p.gender) in ('male', 'man') then 'Men'
      else 'Other'
    end as bucket
    from gathering_interest gi join profiles p on p.id = gi.user_id
    where gi.gathering_id = gathering_id_param and gi.status = 'approved'
      and coalesce(p.gender_hidden, false) = false and p.gender is not null
  ),
  gender_agg as (select bucket as label, count(*) as cnt from genders group by bucket),
  age_total as (select coalesce(sum(cnt), 0) as t from age_agg),
  gender_total as (select coalesce(sum(cnt), 0) as t from gender_agg),
  age_top as (select label, cnt from age_agg order by cnt desc limit 1),
  gender_top as (select label, cnt from gender_agg order by cnt desc limit 1),
  interests as (
    select unnest(p.interests) as tag
    from gathering_interest gi join profiles p on p.id = gi.user_id
    where gi.gathering_id = gathering_id_param and gi.status = 'approved'
  ),
  interest_agg as (select tag, count(*) as cnt from interests group by tag)
  select
    v_count,
    v_tier,
    -- Coarse label: a real 60%+ dominance test computed server-side from
    -- real counts, never derived client-side from array order (which
    -- would be a weaker, order-only heuristic) and never itself shipping
    -- a count/pct over the wire.
    case when v_tier = 'coarse' then
      (select case when (select t from age_total) = 0 then null
                    when at.cnt::numeric / nullif((select t from age_total), 0) >= 0.6
                    then 'Mostly ' || at.label else 'Mixed ages' end
       from age_top at)
    else null end,
    case when v_tier = 'coarse' then
      (select case when (select t from gender_total) = 0 then null
                    when gt.cnt::numeric / nullif((select t from gender_total), 0) >= 0.6
                    then 'Mostly ' || lower(gt.label) else 'Mixed group' end
       from gender_top gt)
    else null end,
    case when v_tier = 'precise' then
      coalesce((select jsonb_agg(jsonb_build_object('label', label,
                  'pct', round(100.0 * cnt / nullif((select t from age_total), 0)))
                  order by cnt desc)
                from age_agg where cnt >= v_min_bucket), '[]'::jsonb)
    else '[]'::jsonb end,
    case when v_tier = 'precise' then
      coalesce((select jsonb_agg(jsonb_build_object('label', label,
                  'pct', round(100.0 * cnt / nullif((select t from gender_total), 0)))
                  order by cnt desc)
                from gender_agg where cnt >= v_min_bucket), '[]'::jsonb)
    else '[]'::jsonb end,
    coalesce(v_interest_names, '{}'::text[]),
    case when v_tier = 'precise' then
      coalesce((select jsonb_agg(jsonb_build_object('tag', tag, 'count', cnt) order by cnt desc)
                from interest_agg), '[]'::jsonb)
    else '[]'::jsonb end;
end;
$function$;

revoke all on function public.get_gathering_group_insights(uuid) from public, anon;
grant execute on function public.get_gathering_group_insights(uuid) to authenticated;
