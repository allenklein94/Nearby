-- Item 79 (CLAUDE.md, "businesses get a new demand signal"). User's own
-- examples: "14 birthday groups are looking for dinner this weekend." /
-- "8 groups are looking for graduation celebrations." / "23 users are
-- looking for date-night experiences Friday." -- consumer intent ->
-- business supply, instead of business posts an ad -> hopes someone sees
-- it.
--
-- Audited the real current state before writing anything: "Match Radar"
-- (get_aggregated_demand_for_partner(), 20260815/20260913, rendered on
-- BusinessDashboardScreen) already delivers most of this vision --
-- real, anonymized, geo-scoped counts of open business_requests, already
-- broken down by category/party-size/soonest-date/time-of-day AND (since
-- the "intelligent demand inbox" plan's Phase 4d) by dominant occasion
-- WITHIN each category. notify_aggregated_demand_threshold() already
-- pushes a business the moment real category demand nearby crosses 2.
--
-- The real, concrete gap against this item's own literal examples: every
-- existing signal is CATEGORY-first (occasion is a footnote inside a
-- category row: "14 people are looking for Restaurants -- mostly
-- birthday (9 of 14)"). This item's own examples are OCCASION-first,
-- cross-category ("8 groups are looking for graduation celebrations" --
-- no category named at all) and time-window-qualified ("this weekend" /
-- "Friday"). That framing didn't exist anywhere. This migration adds it
-- as a genuinely new, complementary rollup -- get_aggregated_demand_for_
-- partner() itself is untouched, not replaced.
--
-- get_occasion_demand_for_partner() mirrors that function's own real
-- geo-eligibility rule (within the REQUESTER's own stated radius_miles of
-- this business, same as its own real fan-out logic) but groups by
-- business_requests.occasion instead of category, and additionally
-- reports weekend_request_count -- a real count of how many of those open
-- requests fall on the upcoming Friday-through-Sunday window, since two
-- of the item's own three examples are explicitly weekend/day-qualified.
-- dominant_category/dominant_category_count answer "what should a
-- business DO about this occasion demand" the same way dominant_period
-- already answers "when." No new signal invented -- occasion, category,
-- date, and party_size were all already real, collected columns.
--
-- notify_occasion_demand_threshold() is the occasion-primary sibling of
-- notify_aggregated_demand_threshold() -- same real "crosses 2 nearby,
-- fires once" shape, keyed on occasion rather than category, so a
-- business gets proactively told about a surging occasion pattern even
-- when no single category alone has crossed its own threshold yet (e.g.
-- graduation demand split across "Restaurants," "Photography," and
-- "Venues" would never trip the category trigger on its own).
--
-- The real strategic connection this item calls for ("businesses can
-- respond to that demand," "consumer intent -> business supply") is made
-- concrete in the client: the new dashboard section's CTA opens the
-- existing Occasion Package composer (Item 68, "Businesses could create
-- occasion-specific offers") pre-selected to the surging occasion --
-- Match Radar's own existing "Turn into an offer" button opens a generic,
-- single-date availability posting instead, which is the right response
-- to raw category demand but not to a recurring, named-occasion pattern;
-- an Occasion Package (a durable, multi-guest, priced, day-of-week-scoped
-- offer) is the more apt supply-side answer to "N groups keep asking
-- about graduation."

create or replace function public.get_occasion_demand_for_partner(partner_id_param uuid)
returns table(
  occasion_type text,
  request_count bigint,
  total_party_size bigint,
  soonest_date date,
  weekend_request_count bigint,
  dominant_category text,
  dominant_category_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_lat double precision;
  v_lng double precision;
  v_weekend_start date;
  v_weekend_end date;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = partner_id_param;
  if v_lat is null or v_lng is null then
    return;
  end if;

  -- The upcoming Friday-through-Sunday window (today counts if today
  -- already falls in it) -- a real, disclosed judgment call for what
  -- "this weekend" means, not a measured fact.
  v_weekend_start := current_date + (((5 - extract(dow from current_date)::int) + 7) % 7);
  v_weekend_end := v_weekend_start + 2;

  return query
  with nearby_open as (
    select br.occasion as req_occasion, br.category as req_category, br.party_size, br.date as req_date
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and br.occasion is not null
    and br.latitude is not null and br.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= br.radius_miles
  ),
  categories as (
    select req_occasion, req_category, count(*) as cat_count
    from nearby_open
    where req_category is not null
    group by 1, 2
  ),
  ranked_categories as (
    select req_occasion, req_category, cat_count,
      row_number() over (partition by req_occasion order by cat_count desc) as rn
    from categories
  )
  select
    n.req_occasion as occasion_type,
    count(*)::bigint as request_count,
    coalesce(sum(coalesce(n.party_size, 1)), 0)::bigint as total_party_size,
    min(n.req_date) as soonest_date,
    count(*) filter (where n.req_date between v_weekend_start and v_weekend_end)::bigint as weekend_request_count,
    rc.req_category as dominant_category,
    rc.cat_count as dominant_category_count
  from nearby_open n
  left join ranked_categories rc on rc.req_occasion = n.req_occasion and rc.rn = 1
  group by n.req_occasion, rc.req_category, rc.cat_count
  order by count(*) desc
  limit 10;
end;
$function$;

revoke all on function public.get_occasion_demand_for_partner(uuid) from public, anon;
grant execute on function public.get_occasion_demand_for_partner(uuid) to authenticated;

create or replace function public.notify_occasion_demand_threshold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_service_key text;
  v_partner record;
  v_prior_count integer;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.occasion is null or new.latitude is null or new.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner sharing the
    -- same occasion, regardless of category -- mirroring notify_
    -- aggregated_demand_threshold()'s own "within the requester's own
    -- radius_miles of the business" rule, just cross-category.
    select count(*) into v_prior_count
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.occasion = new.occasion
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as its category sibling -- fires once
    -- when real nearby demand for this occasion first reaches 2, never
    -- again for the 3rd/4th/etc. request.
    if v_prior_count = 1 then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', _occasion_emoji(new.occasion) || ' Growing ' || _occasion_noun(new.occasion) || ' demand nearby',
              'body', '2 or more groups nearby are now planning a ' || lower(_occasion_noun(new.occasion)) || ' -- near ' || v_partner.name || '.',
              'data', jsonb_build_object('type', 'occasion_demand_growing', 'partner_id', v_partner.id, 'occasion_type', new.occasion)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function public.notify_occasion_demand_threshold() from public, anon;

drop trigger if exists business_requests_occasion_demand_notify on public.business_requests;
create trigger business_requests_occasion_demand_notify
  after insert on public.business_requests
  for each row execute function public.notify_occasion_demand_threshold();
