-- Business Intelligence & Opportunity Engine, Phase 4 -- "Learning" (see
-- CLAUDE.md's own locked plan). Two real pieces: (a) missed-match
-- instrumentation -- a real exclusion-reason log inside the existing
-- matching functions, surfaced only through an aggregated RPC, never a
-- raw per-event dump; (b) a business x category outcome breakdown,
-- extending the existing whole-partner reputation RPC (get_partner_
-- offer_reputation) the same way, grouped by real business_requests
-- category instead of collapsed across every category at once.
--
-- Locked scope decision for (a), stated plainly so it isn't
-- re-litigated: only _match_request_to_policy() and
-- _match_request_to_availability() are instrumented, not
-- _business_request_fanout(). The fan-out is plain distance/reputation
-- ranking over every active partner -- there is no business-side
-- "eligibility setting" that can genuinely fail there, so logging "too
-- far" for every partner within some radius on every request would be
-- indiscriminate noise, not an actionable signal. The policy/
-- availability matchers are different: a business explicitly opted in
-- (an active fulfillment policy or availability posting) and can
-- genuinely act on why it didn't auto-match -- raise a party-size cap,
-- widen active hours, add a category, restock capacity.
--
-- A second, real, disclosed scope boundary: only candidates that are
-- genuinely within the request's own real search radius are evaluated
-- at all (the exact same distance bound the matching functions already
-- use) -- so "out_of_radius" is never a real logged reason here (nothing
-- outside radius is ever considered a near miss worth logging). And a
-- policy/availability that satisfies every real predicate but simply
-- lost out to the existing `limit 5` ranking cutoff (more than 5 equally-
-- eligible candidates for one request) is not logged as an exclusion
-- this pass -- a real, rarer case at this app's actual production
-- volume, flagged rather than silently built.

-- availability_id is nullable and only ever set for source='availability'
-- -- a real, live-tested correction, not the original design: a
-- fulfillment policy is naturally one-per-partner (business_fulfillment_
-- policies has its own real `unique(partner_id)`), but a business can
-- have *several* real active availability postings at once, each a
-- distinct, independently-actionable near-miss. A first draft of this
-- migration deduped on (request_id, partner_id, source) alone -- live
-- testing against a real partner with 3 active postings caught this
-- immediately: only one arbitrary posting's reason ever got logged, and
-- it wasn't reliably the most relevant one. availability_id makes each
-- real posting its own row.
create table if not exists public.business_match_exclusions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.business_requests(id) on delete cascade,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  source text not null,
  reason text not null,
  availability_id uuid references public.business_availability(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint business_match_exclusions_source_check check (source in ('policy', 'availability')),
  constraint business_match_exclusions_reason_check check (reason in (
    'no_auto_accept', 'party_size_out_of_range', 'hours_mismatch',
    'category_mismatch', 'zero_capacity', 'date_or_time_mismatch'
  )),
  constraint business_match_exclusions_availability_id_check check (
    (source = 'availability' and availability_id is not null)
    or (source = 'policy' and availability_id is null)
  )
);

create index if not exists business_match_exclusions_partner_id_idx on public.business_match_exclusions(partner_id);

-- Two separate partial unique indexes, not one combined constraint --
-- NULL never equals NULL for uniqueness purposes, so a single
-- (request_id, partner_id, source, availability_id) constraint would
-- silently fail to dedupe the policy case (availability_id always null
-- there). Matches this schema's own established partial-unique-index
-- convention (e.g. business_request_offers_one_winner_idx).
create unique index if not exists business_match_exclusions_policy_unique_idx
  on public.business_match_exclusions(request_id, partner_id)
  where source = 'policy';

create unique index if not exists business_match_exclusions_availability_unique_idx
  on public.business_match_exclusions(request_id, partner_id, availability_id)
  where source = 'availability';

alter table public.business_match_exclusions enable row level security;

-- Owner-only SELECT, matching this schema's established "owner-scoped
-- log table" posture (e.g. business_profile_views, business_acquisition_
-- events) -- defense in depth on top of the real UI surface, which only
-- ever shows an aggregated rollup (get_missed_match_summary below), never
-- these raw rows. No INSERT/UPDATE/DELETE policy at all -- only the two
-- SECURITY DEFINER matching functions below write here.
drop policy if exists "Business owners can view their own match exclusions" on public.business_match_exclusions;
create policy "Business owners can view their own match exclusions"
on public.business_match_exclusions for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.managed_partner_id = business_match_exclusions.partner_id
  )
);

-- ---------- FUNCTION: _match_request_to_policy (re-pointed) ----------
-- Pulled fresh from the live database before editing (byte-identical to
-- the last committed migration, no drift to reconcile). The real
-- matching loop below (eligibility, ordering, limit 5, the actual offer
-- insert, the push notification) is completely unchanged -- the only
-- addition is the new INSERT ... SELECT at the end, logging one real,
-- deterministic exclusion reason per active-but-non-matching policy
-- within the same real radius bound the matcher itself already uses.
create or replace function public._match_request_to_policy(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  party_size_param integer,
  time_window_start_param time without time zone,
  time_window_end_param time without time zone
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bfp.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name
    from business_fulfillment_policies bfp
    join brand_partners p on p.id = bfp.partner_id and p.active = true
    left join reputation r on r.partner_id = bfp.partner_id
    where bfp.active = true
    and bfp.auto_accept_party_size_max is not null
    and p.latitude is not null and p.longitude is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bfp.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, status, responded_at)
    values (
      request_id_param, v_policy.partner_id, 'standard',
      'Automatically accepted -- within ' || coalesce(v_policy.partner_name, 'this business') || '''s standing party-size policy.',
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_policy.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Auto-accepted a new request!',
              'body', 'Your fulfillment policy auto-accepted: "' || left(coalesce(v_raw_text, ''), 60) || '"',
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  -- Missed-match instrumentation (Phase 4): every real active,
  -- in-radius policy that did NOT satisfy the exact same predicate set
  -- as the matching loop above gets exactly one real, deterministic
  -- exclusion reason. Priority order: a policy that can't auto-accept
  -- at all is the most fundamental gap; then a genuine party-size
  -- mismatch; then, by elimination, an hours mismatch (the only
  -- predicate left once the first two pass).
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    bfp.partner_id,
    'policy',
    case
      when bfp.auto_accept_party_size_max is null then 'no_auto_accept'
      when not (
        (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
        and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
        and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
      ) then 'party_size_out_of_range'
      else 'hours_mismatch'
    end,
    null
  from business_fulfillment_policies bfp
  join brand_partners p on p.id = bfp.partner_id and p.active = true
  where bfp.active = true
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= radius_miles_param
  and not (
    bfp.auto_accept_party_size_max is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
  )
  on conflict (request_id, partner_id) where source = 'policy' do nothing;

  return v_new_count;
end;
$function$;

-- ---------- FUNCTION: _match_request_to_availability (re-pointed) ----------
-- Same treatment as _match_request_to_policy above -- the real matching
-- logic (including the separate preferred_availability_id_param
-- fast-path, which is a single directed lookup, not a candidate-pool
-- scan, and is deliberately not instrumented) is byte-for-byte
-- unchanged; only the new INSERT ... SELECT at the end is added.
create or replace function public._match_request_to_availability(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  category_param text,
  date_param date,
  time_window_start_param time without time zone,
  time_window_end_param time without time zone,
  preferred_availability_id_param uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_avail record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_availability_id_param is not null then
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true
    where ba.id = preferred_availability_id_param
    and ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
      values (request_id_param, v_preferred.partner_id, v_preferred.offer_type, coalesce(v_preferred.description, v_preferred.title), v_preferred.price, v_preferred.id, 'offered', now())
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        if service_key is null then
          select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
        end if;
        select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_preferred.partner_id;
        if v_managing_profiles is not null then
          for i in 1 .. array_length(v_managing_profiles, 1) loop
            perform net.http_post(
              url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
              headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
              body := jsonb_build_object(
                'recipient_id', v_managing_profiles[i],
                'title', 'Your availability was just matched!',
                'body', '"' || v_preferred.title || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
                'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
              )
            );
          end loop;
        end if;
      end if;
    end if;
  end if;

  for v_avail in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true
    left join reputation r on r.partner_id = ba.partner_id
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and p.latitude is not null and p.longitude is not null
    and (
      date_param is null
      or date_param between ba.starts_at::date and ba.ends_at::date
    )
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      ba.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_avail.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_avail.partner_id, v_avail.offer_type, coalesce(v_avail.description, v_avail.title), v_avail.price, v_avail.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_avail.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your availability was just matched!',
              'body', '"' || v_avail.title || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  -- Missed-match instrumentation (Phase 4): same treatment as the policy
  -- matcher above. Priority order: an explicit category mismatch is the
  -- most legible reason; then zero remaining capacity; then, by
  -- elimination, a date/time overlap failure.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    ba.partner_id,
    'availability',
    case
      when category_param is not null and ba.category is not null and ba.category <> category_param then 'category_mismatch'
      when not (ba.remaining_capacity is null or ba.remaining_capacity > 0) then 'zero_capacity'
      else 'date_or_time_mismatch'
    end,
    ba.id
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true
  where ba.status = 'active'
  and ba.ends_at > now()
  and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= least(radius_miles_param, ba.radius_miles)
  and not (
    (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and (date_param is null or date_param between ba.starts_at::date and ba.ends_at::date)
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
  )
  on conflict (request_id, partner_id, availability_id) where source = 'availability' do nothing;

  return v_new_count;
end;
$function$;

-- ---------- FUNCTION: get_missed_match_summary ----------
-- The real, aggregated-only surface for business_match_exclusions --
-- never returns a raw row (no request_id, no created_at), only real
-- counts grouped by source/reason over a real recent window. Owner-only.
create or replace function public.get_missed_match_summary(
  partner_id_param uuid,
  days_back_param integer default 30
)
returns table (
  source text,
  reason text,
  exclusion_count bigint
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  return query
  select bme.source, bme.reason, count(*)
  from business_match_exclusions bme
  where bme.partner_id = partner_id_param
  and bme.created_at >= now() - make_interval(days => coalesce(days_back_param, 30))
  group by bme.source, bme.reason
  order by count(*) desc;
end;
$function$;

revoke all on function public.get_missed_match_summary(uuid, integer) from public, anon;
grant execute on function public.get_missed_match_summary(uuid, integer) to authenticated;

-- ---------- FUNCTION: get_partner_category_outcomes ----------
-- The other real half of Phase 4 -- extends get_partner_offer_reputation's
-- own exact funnel-stat shape (response/acceptance/completion rate) plus
-- outcome-capture satisfaction (business_offer_outcomes), grouped by the
-- real business_requests.category instead of collapsed across every
-- category at once. Owner-gated (unlike get_partner_offer_reputation,
-- which is deliberately public-safe for a consumer deciding whether to
-- trust one offer) -- this is a per-category breakdown of a business's
-- own performance, positioned as an internal Insights-tab tool, matching
-- get_business_insights' own owner-only posture, not a second public
-- reputation surface. Gated at the same real 5+ minimum sample per
-- category this schema already uses for the whole-partner version, so a
-- category with only 1-2 real opportunities never reads as a damning (or
-- flattering) percentage.
create or replace function public.get_partner_category_outcomes(partner_id_param uuid)
returns table (
  category text,
  total_opportunities bigint,
  response_rate numeric,
  acceptance_rate numeric,
  completion_rate numeric,
  rated_count bigint,
  pct_satisfied numeric,
  pct_would_repeat numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  return query
  select
    coalesce(br.category, 'Uncategorized') as category,
    count(*) as total_opportunities,
    round(100.0 * count(*) filter (where bro.responded_at is not null) / nullif(count(*), 0), 1) as response_rate,
    round(100.0 * count(*) filter (where bro.status in ('accepted', 'completed')) / nullif(count(*) filter (where bro.responded_at is not null), 0), 1) as acceptance_rate,
    round(100.0 * count(*) filter (where bro.status = 'completed') / nullif(count(*) filter (where bro.status in ('accepted', 'completed')), 0), 1) as completion_rate,
    count(distinct boo.id) as rated_count,
    round(100.0 * count(distinct boo.id) filter (where boo.satisfaction_rating in ('loved_it', 'good')) / nullif(count(distinct boo.id), 0), 1) as pct_satisfied,
    round(100.0 * count(distinct boo.id) filter (where boo.would_repeat in ('yes', 'maybe')) / nullif(count(distinct boo.id), 0), 1) as pct_would_repeat
  from business_request_offers bro
  join business_requests br on br.id = bro.request_id
  left join business_offer_outcomes boo on boo.offer_id = bro.id
  where bro.partner_id = partner_id_param
  group by coalesce(br.category, 'Uncategorized')
  having count(*) >= 5
  order by count(*) desc;
end;
$function$;

revoke all on function public.get_partner_category_outcomes(uuid) from public, anon;
grant execute on function public.get_partner_category_outcomes(uuid) to authenticated;
