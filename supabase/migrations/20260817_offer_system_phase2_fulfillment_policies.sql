-- "The Offer System" Phase 2 (see CLAUDE.md's own plan, Gap 2): a real,
-- standing, owner-configured "fulfillment policy" a business sets once and
-- that governs every future matching request automatically -- the actual
-- mechanism behind the vision doc's own example ("party size 2-8, hours
-- 5-10 PM, minimum spend $40/person, max discount 15%, auto-accept
-- parties <=4, deposit $50, cancellation 2 hours").
--
-- Resolved during build, per the plan's own "resolve during build" notes:
--   - One policy row per partner (a real `unique(partner_id)`), not a
--     small ordered set -- the simplest shape that still covers the real
--     "the business isn't surrendering control to the marketplace" need,
--     and matches this Business Dashboard's own existing "one settings
--     form, not a list manager" convention (e.g. the single Business
--     Profile card, not a list of profiles).
--   - `active_hours_start/end` as a single daily time-of-day window
--     (`time`, not `timestamptz`), not a day-of-week matrix -- the
--     simplest shape against `business_availability.starts_at/ends_at`'s
--     own convention, since a day-of-week matrix would be real UI
--     complexity this pass wasn't asked to build.
--   - No `category` column -- the plan's own literal column list never
--     names one, and a standing fulfillment policy is a whole-business
--     rule (any category of request reaching this business), unlike a
--     single `business_availability` posting, which is already
--     category-scoped per posting.
--   - `min_spend_per_person`/`max_discount_pct`/`deposit_amount`/
--     `cancellation_window_hours` are stored-only policy terms, per the
--     plan's own explicit note ("deposit_amount stored only -- collection
--     is Phase 1's inert Payment seam, no charge fires") -- none of them
--     gate auto-accept eligibility, only `auto_accept_party_size_max`
--     (plus the party-size/hours bounds) does, matching the plan's own
--     checkpoint text verbatim.

create table if not exists public.business_fulfillment_policies (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null unique references public.brand_partners(id) on delete cascade,
  party_size_min integer,
  party_size_max integer,
  active_hours_start time,
  active_hours_end time,
  min_spend_per_person numeric(10,2),
  max_discount_pct numeric(5,2),
  auto_accept_party_size_max integer,
  deposit_amount numeric(10,2),
  cancellation_window_hours integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_fulfillment_policies_max_discount_check check (
    max_discount_pct is null or (max_discount_pct >= 0 and max_discount_pct <= 100)
  )
);

alter table public.business_fulfillment_policies enable row level security;

-- Owner-only SELECT RLS, no INSERT/UPDATE policy -- every write goes
-- through upsert_business_fulfillment_policy() below, matching this
-- schema's own established convention for a lifecycle-sensitive,
-- owner-scoped table (e.g. business_availability, business_reservations).
create policy "Business owners can view their own fulfillment policy"
on public.business_fulfillment_policies for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.managed_partner_id = business_fulfillment_policies.partner_id
  )
);

-- ---------- FUNCTION: upsert_business_fulfillment_policy ----------
create or replace function public.upsert_business_fulfillment_policy(
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
  active_param boolean default true
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
    cancellation_window_hours, active
  ) values (
    partner_id_param, party_size_min_param, party_size_max_param,
    active_hours_start_param, active_hours_end_param,
    min_spend_per_person_param, max_discount_pct_param, auto_accept_party_size_max_param,
    deposit_amount_param, cancellation_window_hours_param, coalesce(active_param, true)
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
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.upsert_business_fulfillment_policy(uuid, integer, integer, time, time, numeric, numeric, integer, numeric, integer, boolean) from public, anon;
grant execute on function public.upsert_business_fulfillment_policy(uuid, integer, integer, time, time, numeric, numeric, integer, numeric, integer, boolean) to authenticated;

-- ---------- FUNCTION: _match_request_to_policy (internal helper) ----------
-- The real "Level 1 -- automatic" mechanism for every future request, not
-- just a one-time availability posting: a request within an active
-- policy's real party-size/hours bounds AND at or under its
-- auto_accept_party_size_max gets a real, immediate 'offered' row, no
-- manual business step. Mirrors _match_request_to_availability()'s own
-- shape exactly (same reputation-ranked candidate ordering, same plain
-- INSERT ... ON CONFLICT (request_id, partner_id) DO UPDATE ... WHERE
-- status = 'pending' upgrade path, same push-notification convention) --
-- locked down the same way (no grants to authenticated/anon), callable
-- only via a nested nested SECURITY DEFINER call from
-- create_business_request()/create_business_request_for_gathering().
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

  return v_new_count;
end;
$function$;

revoke all on function public._match_request_to_policy(uuid, double precision, double precision, double precision, integer, time, time) from public, anon, authenticated;

-- ---------- create_business_request: extended to also match against policies ----------
-- Pulled fresh from its live body before editing -- every other line
-- (spam guard, expiry computation, submission_id re-validation, the
-- existing fan-out + availability-matching calls) is byte-for-byte
-- unchanged; the only addition is the new _match_request_to_policy() call
-- and folding its count into the total.
create or replace function public.create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null::text,
  party_size_param integer default null::integer,
  budget_min_param integer default null::integer,
  budget_max_param integer default null::integer,
  date_param date default null::date,
  time_window_start_param time without time zone default null::time without time zone,
  time_window_end_param time without time zone default null::time without time zone,
  radius_miles_param double precision default 15,
  submission_id_param uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
  end if;

  v_expires_at := case
    when date_param is not null and time_window_end_param is not null
      then (date_param + time_window_end_param)::timestamptz
    when date_param is not null
      then (date_param + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;

  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_min, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at, submission_id
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid())
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), party_size_param, time_window_start_param, time_window_end_param) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid) to authenticated;

-- ---------- create_business_request_for_gathering: extended the same way ----------
create or replace function public.create_business_request_for_gathering(
  gathering_id_param uuid,
  raw_text_param text,
  category_param text default null::text,
  budget_max_param integer default null::integer,
  radius_miles_param double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_host_id uuid;
  v_scheduled_at timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_party_size integer;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  select host_id, scheduled_at, precise_lat, precise_lng
  into v_host_id, v_scheduled_at, v_lat, v_lng
  from gatherings where id = gathering_id_param;

  if v_host_id is null then
    raise exception 'Gathering not found.';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can ask businesses on behalf of this gathering.';
  end if;
  if v_lat is null or v_lng is null then
    raise exception 'This gathering has no location set.';
  end if;

  select id into v_duplicate_id
  from business_requests
  where gathering_id = gathering_id_param and status = 'open'
  order by created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', null);
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', null);
  end if;

  select count(*) into v_party_size
  from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';
  v_party_size := coalesce(v_party_size, 0) + 1;

  v_expires_at := least(v_scheduled_at, now() + interval '30 days');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, latitude, longitude,
    radius_miles, expires_at, gathering_id
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_scheduled_at::date, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), v_party_size, null, null) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$;

revoke all on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) from public, anon;
grant execute on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) to authenticated;
