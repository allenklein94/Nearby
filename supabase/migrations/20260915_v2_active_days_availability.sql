-- Business Web as an Operating System, Phase 2: real day-of-week/recurring
-- availability windows. Reuses the existing business_fulfillment_policies
-- table (widened), not a second, parallel schedule concept.
--
-- active_days smallint[] is nullable -- null means "every day," matching this
-- table's own established "absent means the widest/most permissive
-- interpretation" convention already used for its other nullable bound
-- columns (party_size_min/max, active_hours_start/end). A plain array of
-- 0-6 (Sunday-Saturday, matching Postgres's own extract(dow from date)
-- convention), CHECK-constrained to real values only.
--
-- _match_request_to_policy() gains one additive real day-of-week comparison
-- against the request's own real date, alongside its existing party-size/
-- hours/weather predicates -- a genuinely new predicate, not a replacement
-- of any existing one. Both live bodies below were pulled fresh from
-- production immediately before writing this migration (not reconstructed
-- from an earlier, possibly-stale local copy) -- every line outside the
-- new day-of-week predicate is preserved verbatim, including the
-- weather-dependent logic added in a later pass than the one that first
-- documented this function's shape.

alter table public.business_fulfillment_policies
  add column if not exists active_days smallint[];

alter table public.business_fulfillment_policies
  drop constraint if exists business_fulfillment_policies_active_days_check;

alter table public.business_fulfillment_policies
  add constraint business_fulfillment_policies_active_days_check
  check (
    active_days is null
    or active_days <@ array[0,1,2,3,4,5,6]::smallint[]
  );

-- business_match_exclusions.reason gains a new, additive value for this
-- predicate -- widen the CHECK, never repurpose a value, matching this
-- schema's own repeatedly-stated house rule.
alter table public.business_match_exclusions
  drop constraint if exists business_match_exclusions_reason_check;

alter table public.business_match_exclusions
  add constraint business_match_exclusions_reason_check
  check (
    reason = any (array[
      'no_auto_accept',
      'party_size_out_of_range',
      'hours_mismatch',
      'active_days_mismatch',
      'weather_unfavorable',
      'category_mismatch',
      'zero_capacity',
      'insufficient_capacity',
      'date_or_time_mismatch'
    ])
  );

-- Same 7-argument signature as the live function -- the new predicate reads
-- v_request_date, fetched via one widened select, never a new parameter --
-- so this is a genuine CREATE OR REPLACE, not a drop-then-create.
create or replace function public._match_request_to_policy(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  party_size_param integer,
  time_window_start_param time,
  time_window_end_param time
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_request_date date;
  service_key text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, date into v_raw_text, v_request_date from business_requests where id = request_id_param;

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
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
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

  -- Missed-match instrumentation: priority order stays the same reasoning
  -- as before -- can't auto-accept at all, then party size, then hours,
  -- then active days (the new predicate, inserted before weather so
  -- weather stays the real catch-all it already was), and by elimination
  -- weather is the only real predicate left once the first four all pass.
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
      when not (
        bfp.active_hours_start is null or bfp.active_hours_end is null
        or time_window_start_param is null or time_window_end_param is null
        or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
      ) then 'hours_mismatch'
      when not (
        bfp.active_days is null or v_request_date is null
        or extract(dow from v_request_date)::smallint = any(bfp.active_days)
      ) then 'active_days_mismatch'
      else 'weather_unfavorable'
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
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
  )
  on conflict (request_id, partner_id) where source = 'policy' do nothing;

  return v_new_count;
end;
$function$;

-- upsert_business_fulfillment_policy() gains a new trailing param -- an
-- added parameter creates a distinct orphaned overload per this schema's
-- own repeatedly-stated rule, so the old 12-arg signature is explicitly
-- dropped first, not left as a silent second overload. Every other line of
-- the real body, pulled fresh from production immediately before writing
-- this migration, is preserved verbatim.
drop function if exists public.upsert_business_fulfillment_policy(
  uuid, integer, integer, time, time, numeric, numeric, integer, numeric, integer, boolean, boolean
);

create function public.upsert_business_fulfillment_policy(
  partner_id_param uuid,
  party_size_min_param integer default null,
  party_size_max_param integer default null,
  active_hours_start_param time default null,
  active_hours_end_param time default null,
  min_spend_per_person_param numeric default null,
  max_discount_pct_param numeric default null,
  auto_accept_party_size_max_param integer default null,
  deposit_amount_param numeric default null,
  cancellation_window_hours_param integer default null,
  active_param boolean default true,
  weather_dependent_param boolean default false,
  active_days_param smallint[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business.';
  end if;

  if max_discount_pct_param is not null and (max_discount_pct_param < 0 or max_discount_pct_param > 100) then
    raise exception 'Max discount percent must be between 0 and 100.';
  end if;

  if active_days_param is not null and not (active_days_param <@ array[0,1,2,3,4,5,6]::smallint[]) then
    raise exception 'Active days must be between 0 (Sunday) and 6 (Saturday).';
  end if;

  insert into business_fulfillment_policies (
    partner_id, party_size_min, party_size_max, active_hours_start, active_hours_end,
    min_spend_per_person, max_discount_pct, auto_accept_party_size_max, deposit_amount,
    cancellation_window_hours, active, weather_dependent, active_days
  ) values (
    partner_id_param, party_size_min_param, party_size_max_param,
    active_hours_start_param, active_hours_end_param,
    min_spend_per_person_param, max_discount_pct_param, auto_accept_party_size_max_param,
    deposit_amount_param, cancellation_window_hours_param, coalesce(active_param, true),
    coalesce(weather_dependent_param, false), active_days_param
  )
  on conflict (partner_id) do update set
    party_size_min = excluded.party_size_min,
    party_size_max = excluded.party_size_max,
    active_hours_start = excluded.active_hours_start,
    active_hours_end = excluded.active_hours_end,
    min_spend_per_person = excluded.min_spend_per_person,
    max_discount_pct = excluded.max_discount_pct,
    auto_accept_party_size_max = excluded.auto_accept_party_size_max,
    deposit_amount = excluded.deposit_amount,
    cancellation_window_hours = excluded.cancellation_window_hours,
    active = excluded.active,
    -- A policy switching OFF weather_dependent also clears its own
    -- stale cache -- a business that un-checks the toggle should never
    -- have a leftover last_rain_risk silently re-applied if they later
    -- re-check it before the next hourly sweep runs.
    weather_dependent = excluded.weather_dependent,
    last_rain_risk = case when excluded.weather_dependent then business_fulfillment_policies.last_rain_risk else null end,
    last_weather_checked_at = case when excluded.weather_dependent then business_fulfillment_policies.last_weather_checked_at else null end,
    active_days = excluded.active_days,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.upsert_business_fulfillment_policy(uuid, integer, integer, time, time, numeric, numeric, integer, numeric, integer, boolean, boolean, smallint[]) from public, anon;
grant execute on function public.upsert_business_fulfillment_policy(uuid, integer, integer, time, time, numeric, numeric, integer, numeric, integer, boolean, boolean, smallint[]) to authenticated;
