-- Business Intelligence & Opportunity Engine, Phase 7 (Context): wire the
-- already-existing weather signals engine (Aug 22 2026, "V1") into a real
-- rule -- "patio availability drops when rain_risk is high" -- by
-- extending business_fulfillment_policies' own shape, per this plan's own
-- locked design, rather than building a second rules concept.
--
-- Real architecture constraint, checked directly before designing this:
-- get_weather_result()/submit_weather_request() are a real, live,
-- per-user, async submit-then-poll pair (a client submits, the server
-- fires two net.http_get calls, the client polls back later for the
-- result). _match_request_to_policy() runs synchronously, inline, inside
-- create_business_request()'s own transaction -- it cannot submit a
-- weather request and wait for a real HTTP round trip mid-transaction
-- without holding that transaction (and every row lock it's already
-- taken) open for however long OpenWeatherMap takes to respond, a real
-- reliability risk to a core write path this schema has never accepted
-- anywhere else.
--
-- Fixed by extending business_fulfillment_policies with a real, owner-
-- declared weather_dependent flag plus a small weather-signal CACHE
-- (last_rain_risk/last_weather_checked_at), refreshed on its own real,
-- bounded hourly cron sweep (matching this schema's own extensive
-- pg_cron precedent -- expire_stale_business_requests, send_momentum_
-- nudges, etc.) rather than a live call inside the matching transaction.
-- _match_request_to_policy() then only ever does a plain column read --
-- zero external HTTP dependency inside the request-creation path.
--
-- The refresh sweep deliberately does NOT reuse submit_weather_request()/
-- get_weather_result() -- both are scoped to a real signed-in caller's
-- own auth.uid() (get_weather_result's own lookup is
-- "where request_id = ... and user_id = auth.uid()"), and a cron
-- context has no real auth.uid() at all (it runs as postgres with no
-- JWT claims set) -- auth.uid() = null compared against a null user_id
-- column is itself null, never true, so reusing those two functions here
-- would silently never find its own just-submitted row. A small,
-- purpose-built inline fetch avoids that landmine.
--
-- Deliberately a simpler signal than the richer V1 forecast-derived
-- rain_risk (low/medium/high from a 24h-lookahead probability-of-
-- precipitation scan): this sweep only asks "is it raining/storming at
-- this business's location right now, as of our last hourly check" (the
-- same weather_condition_id < 700 threshold get_weather_result/
-- get_social_forecast already use for their own current-conditions
-- bucketing) -- re-implementing the full forecast-parsing loop a second
-- time for a cron job would be exactly the "duplicate the fetch/parse
-- logic in a function nothing else needs it for" cost this schema's own
-- Aug 22 2026 weather migration explicitly chose not to pay for
-- get_social_forecast's own sibling. An hourly refresh already gives a
-- genuinely fresh "right now" signal without needing a lookahead.
--
-- Only business_fulfillment_policies gets this -- not business_
-- availability. A one-time availability posting is made by an owner who
-- already knows current conditions at the moment they post it; the
-- standing policy is the one that's set-and-forget and can go stale
-- relative to real weather, which is exactly why it needs this rule and
-- a fresh one-time posting doesn't.

alter table public.business_fulfillment_policies
  add column if not exists weather_dependent boolean not null default false,
  add column if not exists last_rain_risk text,
  add column if not exists last_weather_checked_at timestamptz;

alter table public.business_fulfillment_policies
  add constraint business_fulfillment_policies_last_rain_risk_check
  check (last_rain_risk is null or last_rain_risk in ('low', 'high'));

-- ---------- Real submit-then-apply split for the refresh sweep ----------
-- A FIRST DRAFT of this sweep (a single function that both submitted the
-- net.http_get call AND polled net._http_response for the result, all
-- inside its own one PL/pgSQL call) was written, applied, and then
-- PROVEN WRONG by live testing, not just reasoned about: pg_net's own
-- background worker only ever sees a queued request once the
-- transaction that enqueued it has committed -- and a single top-level
-- statement (which is what one function call, or one cron job tick, is)
-- never commits until it returns. Confirmed directly against production
-- with a disposable DO block: after 8 real seconds of polling *inside
-- the same transaction*, the response was still unresolved; the exact
-- same request_id, checked again from a genuinely separate subsequent
-- call, had already resolved. So a single-function poll-in-place design
-- cannot ever work here, no matter how generous the attempt cap -- it
-- isn't a latency problem, it's a transaction-visibility one.
--
-- Fixed by giving this sweep the identical two-phase submit/poll shape
-- get_weather_result()/submit_weather_request() already use for a live
-- user's own request, just cron-scheduled instead of client-triggered:
-- one function submits every real weather-dependent partner's fetch and
-- returns immediately (so its own transaction commits right away,
-- making every queued request visible to pg_net's worker); a second,
-- separately-scheduled function later reads back whatever's resolved by
-- then. Neither function ever polls inside its own transaction.
create table if not exists public.weather_dependent_policy_refresh_queue (
  id bigint generated by default as identity primary key,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  request_id bigint not null,
  submitted_at timestamptz not null default now(),
  unique (partner_id)
);

alter table public.weather_dependent_policy_refresh_queue enable row level security;
-- No policies at all -- cron/SECURITY DEFINER-only, matching this
-- migration's own established "no client grant" posture for the sweep
-- itself. Nothing here is ever meant to be readable by a real client.

-- ---------- FUNCTION: submit_weather_dependent_policy_refreshes ----------
-- Cron-only. For every real, active, weather-dependent policy whose
-- partner has real coordinates and doesn't already have a real pending
-- request less than 10 minutes old (so a still-resolving prior request
-- isn't silently duplicated), fires one real OpenWeatherMap
-- current-conditions call and records the pending request -- never
-- waits for a response itself.
create or replace function public.submit_weather_dependent_policy_refreshes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  api_key text;
  v_partner record;
  v_request_id bigint;
  v_submitted_count integer := 0;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'openweather_api_key';

  for v_partner in
    select distinct bp.id as partner_id, bp.latitude, bp.longitude
    from business_fulfillment_policies fp
    join brand_partners bp on bp.id = fp.partner_id
    where fp.weather_dependent = true
    and fp.active = true
    and bp.latitude is not null
    and bp.longitude is not null
    and not exists (
      select 1 from weather_dependent_policy_refresh_queue q
      where q.partner_id = bp.id and q.submitted_at > now() - interval '10 minutes'
    )
  loop
    select net.http_get(
      url := format(
        'https://api.openweathermap.org/data/2.5/weather?lat=%s&lon=%s&appid=%s&units=imperial',
        v_partner.latitude, v_partner.longitude, api_key
      )
    ) into v_request_id;

    insert into weather_dependent_policy_refresh_queue (partner_id, request_id, submitted_at)
    values (v_partner.partner_id, v_request_id, now())
    on conflict (partner_id) do update
      set request_id = excluded.request_id, submitted_at = excluded.submitted_at;

    v_submitted_count := v_submitted_count + 1;
  end loop;

  return v_submitted_count;
end;
$function$;

revoke all on function public.submit_weather_dependent_policy_refreshes() from public, anon, authenticated;

-- ---------- FUNCTION: apply_weather_dependent_policy_refreshes ----------
-- Cron-only. Reads back whatever's genuinely resolved by now for every
-- still-pending request, writes the real signal onto the matching
-- policy row, and clears that queue entry. A request still unresolved
-- after 10 real minutes is given up on (removed from the queue without
-- touching the cached signal -- stale, never silently wrong) rather
-- than polled forever.
create or replace function public.apply_weather_dependent_policy_refreshes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pending record;
  v_response_content text;
  v_response jsonb;
  v_condition_id integer;
  v_applied_count integer := 0;
begin
  for v_pending in
    select * from weather_dependent_policy_refresh_queue
  loop
    select content into v_response_content from net._http_response where id = v_pending.request_id;

    if v_response_content is not null then
      v_response := v_response_content::jsonb;
      v_condition_id := (v_response -> 'weather' -> 0 ->> 'id')::integer;

      update business_fulfillment_policies
      set last_rain_risk = case when v_condition_id < 700 then 'high' else 'low' end,
          last_weather_checked_at = now()
      where partner_id = v_pending.partner_id and weather_dependent = true;

      delete from weather_dependent_policy_refresh_queue where id = v_pending.id;
      v_applied_count := v_applied_count + 1;
    elsif v_pending.submitted_at <= now() - interval '10 minutes' then
      delete from weather_dependent_policy_refresh_queue where id = v_pending.id;
    end if;
  end loop;

  return v_applied_count;
end;
$function$;

revoke all on function public.apply_weather_dependent_policy_refreshes() from public, anon, authenticated;

select cron.schedule(
  'submit-weather-dependent-policy-refreshes',
  '0 * * * *',
  $$select public.submit_weather_dependent_policy_refreshes();$$
);

select cron.schedule(
  'apply-weather-dependent-policy-refreshes',
  '*/5 * * * *',
  $$select public.apply_weather_dependent_policy_refreshes();$$
);

-- ---------- _match_request_to_policy(): weather predicate wired in ----------
-- Pulled the live function body fresh via the Management API before
-- editing (confirmed matching the committed Phase 4 migration) -- every
-- other line below is byte-for-byte unchanged; the only real edits are
-- the new weather predicate added to both the matching loop's WHERE and
-- the missed-match exclusion INSERT's own "not matched" filter/CASE.
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

  -- Missed-match instrumentation (Phase 4, extended here for the new
  -- weather predicate): priority order stays the same reasoning as
  -- before -- can't auto-accept at all, then party size, then hours,
  -- and now, by elimination, weather is the only real predicate left
  -- once the first three all pass.
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

revoke all on function public._match_request_to_policy(uuid, double precision, double precision, double precision, integer, time, time) from public, anon, authenticated;

-- ---------- business_match_exclusions.reason: widen the CHECK ----------
-- Additive only, matching this schema's own "widen the CHECK, never
-- repurpose an existing value" convention -- every existing row's own
-- reason value is unaffected.
alter table public.business_match_exclusions drop constraint business_match_exclusions_reason_check;
alter table public.business_match_exclusions add constraint business_match_exclusions_reason_check check (reason in (
  'no_auto_accept', 'party_size_out_of_range', 'hours_mismatch', 'weather_unfavorable',
  'category_mismatch', 'zero_capacity', 'date_or_time_mismatch'
));

-- ---------- upsert_business_fulfillment_policy(): weather_dependent param ----------
-- Signature changes (a new param) -- explicit DROP + CREATE, matching
-- this schema's own established discipline for exactly this situation.
drop function if exists public.upsert_business_fulfillment_policy(uuid, integer, integer, time, time, numeric, numeric, integer, numeric, integer, boolean);

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
  weather_dependent_param boolean default false
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

  insert into business_fulfillment_policies (
    partner_id, party_size_min, party_size_max, active_hours_start, active_hours_end,
    min_spend_per_person, max_discount_pct, auto_accept_party_size_max, deposit_amount,
    cancellation_window_hours, active, weather_dependent
  ) values (
    partner_id_param, party_size_min_param, party_size_max_param,
    active_hours_start_param, active_hours_end_param,
    min_spend_per_person_param, max_discount_pct_param, auto_accept_party_size_max_param,
    deposit_amount_param, cancellation_window_hours_param, coalesce(active_param, true),
    coalesce(weather_dependent_param, false)
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
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.upsert_business_fulfillment_policy(uuid, integer, integer, time, time, numeric, numeric, integer, numeric, integer, boolean, boolean) from public, anon;
grant execute on function public.upsert_business_fulfillment_policy(uuid, integer, integer, time, time, numeric, numeric, integer, numeric, integer, boolean, boolean) to authenticated;
