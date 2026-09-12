-- Item 68 ("Businesses could create occasion-specific offers," CLAUDE.md) --
-- a business can now publish a durable, named "occasion package" (a
-- restaurant's "Birthday Package": dessert + a group table, minimum 6
-- guests, available Fri/Sat, $X/person; a bowling alley's "Birthday Group
-- Package"; a spa's "Birthday Group Experience"; a golf course's "Birthday
-- Golf Package"). This is a genuinely different concept from
-- business_availability (a one-time posted time-boxed slot) and from
-- brand_partners.priority_occasions (a flat "we want more of this occasion"
-- appetite signal, 20260913_business_priority_occasions.sql): a package is
-- a standing, structured PRODUCT -- its own name, real included line items,
-- a minimum party size, a per-person price, and which days of the week it's
-- offered -- that exists independent of any specific date. Nearby's job, per
-- the user's own framing, becomes matching a real occasion to this real
-- local supply, not displaying an advertisement.
--
-- Reuses established precedent throughout rather than inventing new shapes:
-- occasion_type reuses the exact same 16-value vocabulary business_requests.
-- occasion/brand_partners.priority_occasions already share (widened by
-- 20261016_celebrate_occasion_vocabulary_expansion.sql /
-- 20261023_life_event_occasion_downstream_fix.sql); available_days reuses
-- business_fulfillment_policies.active_days' own exact shape (smallint[],
-- 0=Sunday..6=Saturday matching Postgres extract(dow from date), null means
-- "every day," 20260915_v2_active_days_availability.sql); RLS is enabled
-- with zero client policies, every access through a SECURITY DEFINER RPC,
-- the same posture this schema now uses for every newer lifecycle-sensitive
-- table (occasion_group_plans, recommendation_push_log, etc.) rather than
-- business_fulfillment_policies' older direct-SELECT-policy shape.
--
-- REAL BUG FOUND AND FIXED IN THE SAME MIGRATION, same domain (occasion
-- vocabulary), disclosed rather than silently bundled: create_business_
-- request()/create_business_request_for_gathering()/create_business_
-- request_for_match() have each, since 20260912_business_request_occasion.sql
-- first introduced occasion_param, carried their OWN inline copy of the
-- occasion validation list -- and none of the three was ever updated when
-- 20261016_celebrate_occasion_vocabulary_expansion.sql widened the real
-- column CHECK from 8 to 16 values. Confirmed live: the column itself has
-- accepted 'graduation'/'baby_shower'/'engagement'/'housewarming'/
-- 'promotion'/'farewell'/'milestone'/'life_event' since Sep 16 2026, but
-- these three functions' own inline checks still reject all 8 of them with
-- "Invalid occasion" -- a real, live, latent bug: any consumer flow
-- submitting one of those 8 occasions through any of these three functions
-- (e.g. "Celebrate Something" wizard's own business-options step, live
-- since Item 61's "connect it to businesses" fast-follow) would hit a hard
-- submission failure, never previously caught because no simulator/device
-- session has exercised this path live. Fixed here, in the same migration
-- that's already touching this exact vocabulary domain.

create table if not exists public.business_occasion_packages (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  occasion_type text not null,
  name text not null,
  description text,
  included_items text[] not null default '{}',
  min_guests integer,
  price_per_person numeric(10,2),
  available_days smallint[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_occasion_packages_occasion_type_check check (occasion_type in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'life_event', 'other'
  )),
  constraint business_occasion_packages_name_check check (length(trim(name)) > 0),
  constraint business_occasion_packages_min_guests_check check (min_guests is null or min_guests > 0),
  constraint business_occasion_packages_price_check check (price_per_person is null or price_per_person >= 0),
  constraint business_occasion_packages_available_days_check check (
    available_days is null or available_days <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

create index if not exists business_occasion_packages_partner_id_idx on public.business_occasion_packages(partner_id);
create index if not exists business_occasion_packages_occasion_type_idx on public.business_occasion_packages(occasion_type) where active = true;

alter table public.business_occasion_packages enable row level security;
-- Zero client policies, by design -- every read/write goes through one of
-- the SECURITY DEFINER RPCs below (get_my_occasion_packages for the owning
-- business, search_occasion_packages for a consumer's own resolver query),
-- matching this repo's own established posture for newer tables like this.

-- The one other real schema change: business_request_offers needs to be
-- able to say WHICH package (if any) an offer was matched against, the
-- same real traceability availability_id already gives for a matched
-- business_availability posting.
alter table public.business_request_offers
  add column if not exists package_id uuid references public.business_occasion_packages(id) on delete set null;

-- ---------- FUNCTION: create_occasion_package ----------
create or replace function public.create_occasion_package(
  occasion_type_param text,
  name_param text,
  description_param text default null,
  included_items_param text[] default '{}',
  min_guests_param integer default null,
  price_per_person_param numeric default null,
  available_days_param smallint[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_package_id uuid;
  v_items text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if name_param is null or length(trim(name_param)) = 0 then
    raise exception 'Give this package a real name.';
  end if;

  if occasion_type_param is null or occasion_type_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
  end if;

  if min_guests_param is not null and min_guests_param <= 0 then
    raise exception 'Minimum guests must be a positive number.';
  end if;

  if price_per_person_param is not null and price_per_person_param < 0 then
    raise exception 'Price per person cannot be negative.';
  end if;

  if available_days_param is not null and not (available_days_param <@ array[0,1,2,3,4,5,6]::smallint[]) then
    raise exception 'Invalid day of week';
  end if;

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  insert into business_occasion_packages (
    partner_id, occasion_type, name, description, included_items,
    min_guests, price_per_person, available_days
  ) values (
    v_partner_id, occasion_type_param, trim(name_param),
    nullif(trim(coalesce(description_param, '')), ''),
    coalesce(v_items, '{}'), min_guests_param, price_per_person_param, available_days_param
  ) returning id into v_package_id;

  return jsonb_build_object('packageId', v_package_id);
end;
$function$;

revoke all on function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) from public, anon;
grant execute on function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) to authenticated;

-- ---------- FUNCTION: update_occasion_package ----------
create or replace function public.update_occasion_package(
  package_id_param uuid,
  occasion_type_param text,
  name_param text,
  description_param text default null,
  included_items_param text[] default '{}',
  min_guests_param integer default null,
  price_per_person_param numeric default null,
  available_days_param smallint[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_items text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if not exists (
    select 1 from business_occasion_packages where id = package_id_param and partner_id = v_partner_id
  ) then
    raise exception 'Package not found.';
  end if;

  if name_param is null or length(trim(name_param)) = 0 then
    raise exception 'Give this package a real name.';
  end if;

  if occasion_type_param is null or occasion_type_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
  end if;

  if min_guests_param is not null and min_guests_param <= 0 then
    raise exception 'Minimum guests must be a positive number.';
  end if;

  if price_per_person_param is not null and price_per_person_param < 0 then
    raise exception 'Price per person cannot be negative.';
  end if;

  if available_days_param is not null and not (available_days_param <@ array[0,1,2,3,4,5,6]::smallint[]) then
    raise exception 'Invalid day of week';
  end if;

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  update business_occasion_packages
  set occasion_type = occasion_type_param,
      name = trim(name_param),
      description = nullif(trim(coalesce(description_param, '')), ''),
      included_items = coalesce(v_items, '{}'),
      min_guests = min_guests_param,
      price_per_person = price_per_person_param,
      available_days = available_days_param,
      updated_at = now()
  where id = package_id_param and partner_id = v_partner_id;

  return jsonb_build_object('packageId', package_id_param);
end;
$function$;

revoke all on function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]) from public, anon;
grant execute on function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]) to authenticated;

-- ---------- FUNCTION: set_occasion_package_active ----------
-- A pause/resume toggle distinct from delete -- a business can take a
-- package off the market temporarily (e.g. fully booked this season)
-- without losing its own configured terms.
create or replace function public.set_occasion_package_active(package_id_param uuid, active_param boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  update business_occasion_packages
  set active = active_param, updated_at = now()
  where id = package_id_param and partner_id = v_partner_id;

  if not found then
    raise exception 'Package not found.';
  end if;
end;
$function$;

revoke all on function public.set_occasion_package_active(uuid, boolean) from public, anon;
grant execute on function public.set_occasion_package_active(uuid, boolean) to authenticated;

-- ---------- FUNCTION: delete_occasion_package ----------
-- A safe hard delete -- unlike business_availability (which can carry real
-- consumer commitments once matched), a package is just a business's own
-- standing product description. Any already-created business_request_offers
-- row that was matched against this package keeps its own real history;
-- package_id there is ON DELETE SET NULL, never cascaded.
create or replace function public.delete_occasion_package(package_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  delete from business_occasion_packages where id = package_id_param and partner_id = v_partner_id;

  if not found then
    raise exception 'Package not found.';
  end if;
end;
$function$;

revoke all on function public.delete_occasion_package(uuid) from public, anon;
grant execute on function public.delete_occasion_package(uuid) to authenticated;

-- ---------- FUNCTION: get_my_occasion_packages ----------
-- Every one of the caller's own packages, active or paused, for their own
-- management screen -- search_occasion_packages below is the separate,
-- narrower, active-only consumer-facing read.
create or replace function public.get_my_occasion_packages()
returns setof business_occasion_packages
language sql
stable
security definer
set search_path to 'public'
as $$
  select bop.*
  from business_occasion_packages bop
  join profiles pr on pr.managed_partner_id = bop.partner_id
  where pr.id = auth.uid()
  order by bop.created_at desc;
$$;

revoke all on function public.get_my_occasion_packages() from public, anon;
grant execute on function public.get_my_occasion_packages() to authenticated;

-- ---------- FUNCTION: search_occasion_packages ----------
-- The consumer-facing read, mirroring search_policy_only_businesses' own
-- shape exactly (a narrow, read-only, SECURITY DEFINER RPC over an
-- owner-scoped table -- a business's own standing offering is intentionally
-- discoverable supply, same posture as a manual availability posting;
-- businesses are not subject to the no-stranger-discovery rule). Requires
-- a real occasion -- there's no meaningful "occasion package" search
-- without one. min_guests is a real hard feasibility filter (same
-- discipline as search_active_business_availability's own party-size
-- floor) since a party genuinely below a package's stated minimum can't
-- book it; available_days is NOT filtered here (the resolver only ever has
-- a coarse date bucket, not a confirmed date) -- it's returned so the
-- caller can render it as an honest "why" reason instead.
create or replace function public.search_occasion_packages(
  occasion_type_param text,
  latitude_param double precision default null,
  longitude_param double precision default null,
  party_size_param integer default null,
  radius_miles_param double precision default 25
)
returns table (
  id uuid,
  partner_id uuid,
  partner_name text,
  category text,
  name text,
  description text,
  included_items text[],
  min_guests integer,
  price_per_person numeric,
  available_days smallint[],
  distance_miles double precision
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    bop.id, bop.partner_id, p.name as partner_name, p.category,
    bop.name, bop.description, bop.included_items, bop.min_guests,
    bop.price_per_person, bop.available_days,
    case
      when latitude_param is null or longitude_param is null or p.latitude is null or p.longitude is null then null
      else (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      ))
    end as distance_miles
  from business_occasion_packages bop
  join brand_partners p on p.id = bop.partner_id and p.active = true
  where bop.active = true
  and occasion_type_param is not null
  and bop.occasion_type = occasion_type_param
  and (party_size_param is null or bop.min_guests is null or party_size_param >= bop.min_guests)
  and p.latitude is not null and p.longitude is not null
  and (
    latitude_param is null or longitude_param is null
    or (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
  )
  order by distance_miles asc nulls last, bop.created_at desc
  limit 6;
$$;

revoke all on function public.search_occasion_packages(text, double precision, double precision, integer, double precision) from public, anon;
grant execute on function public.search_occasion_packages(text, double precision, double precision, integer, double precision) to authenticated;

-- ---------- FUNCTION: _match_request_to_package (internal helper) ----------
-- Mirrors _match_request_to_availability's own preferred-binding block
-- (20260822_availability_preferred_binding.sql) plus a general scan, the
-- same two-part shape: a specific package the consumer already reviewed
-- and tapped (in the resolver, via CelebrateSomethingScreen's own
-- "options" step) is directly bound at 'offered' status immediately --
-- honest, since the business already explicitly published these exact
-- terms, the same real-declared-intent reasoning that already justifies
-- an immediate 'offered' row for a matched business_availability posting.
-- The general scan then catches any OTHER real package match for the same
-- occasion within radius, so a request created without ever going through
-- the resolver (e.g. a plain AskBusinessScreen submission with occasion
-- set) still surfaces real package supply, not just a preferred pick.
-- Deliberately does NOT write to business_match_exclusions (the missed-
-- match instrumentation _match_request_to_availability maintains) -- a
-- real, disclosed, bounded scope decision for this first increment, not
-- an oversight.
create or replace function public._match_request_to_package(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  occasion_param text,
  party_size_param integer,
  date_param date,
  preferred_package_id_param uuid default null
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
  v_pkg record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  v_offer_price numeric;
  i integer;
begin
  if occasion_param is null then
    return 0;
  end if;

  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_package_id_param is not null then
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true
    where bop.id = preferred_package_id_param
    and bop.active = true
    and bop.occasion_type = occasion_param
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      v_offer_price := case
        when v_preferred.price_per_person is not null and party_size_param is not null
          then v_preferred.price_per_person * party_size_param
        else v_preferred.price_per_person
      end;

      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, package_id, status, responded_at)
      values (
        request_id_param, v_preferred.partner_id, 'standard',
        v_preferred.name || coalesce(': ' || v_preferred.description, ''),
        v_offer_price, v_preferred.id, 'offered', now()
      )
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_price = excluded.offer_price, package_id = excluded.package_id, responded_at = now()
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
                'title', 'Your occasion package was just matched!',
                'body', '"' || v_preferred.name || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
                'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
              )
            );
          end loop;
        end if;
      end if;
    end if;
  end if;

  for v_pkg in
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true
    where bop.active = true
    and bop.occasion_type = occasion_param
    and (preferred_package_id_param is null or bop.id != preferred_package_id_param)
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and (
      date_param is null or bop.available_days is null
      or extract(dow from date_param)::smallint = any(bop.available_days)
    )
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by bop.created_at desc
    limit 5
  loop
    -- Same "don't recount an already-offered partner as new" discipline as
    -- the preferred-binding block above and _match_request_to_availability's
    -- own general loop: _business_request_fanout() (which always runs
    -- FIRST in create_business_request, before any of the three matchers)
    -- already inserts a 'pending' row for every nearby partner -- an
    -- earlier version of this loop wrongly used `not exists (...)` to skip
    -- any partner already in business_request_offers, which excluded
    -- EVERY nearby partner (since fanout had already inserted their row)
    -- and meant this general scan could never actually fire. The correct
    -- shape, matching the availability matcher exactly: always attempt the
    -- INSERT ... ON CONFLICT DO UPDATE ... WHERE status = 'pending' upgrade,
    -- and only count it as a genuinely new match when it wasn't already
    -- 'offered' before (by a package OR anything else) -- found live via a
    -- disposable rolled-back transaction before this fix.
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_pkg.partner_id
    ) into v_already_offered;

    v_offer_price := case
      when v_pkg.price_per_person is not null and party_size_param is not null
        then v_pkg.price_per_person * party_size_param
      else v_pkg.price_per_person
    end;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, package_id, status, responded_at)
    values (
      request_id_param, v_pkg.partner_id, 'standard',
      v_pkg.name || coalesce(': ' || v_pkg.description, ''),
      v_offer_price, v_pkg.id, 'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, package_id = excluded.package_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_pkg.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your occasion package was just matched!',
              'body', '"' || v_pkg.name || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
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

revoke all on function public._match_request_to_package(uuid, double precision, double precision, double precision, text, integer, date, uuid) from public, anon, authenticated;

-- ---------- create_business_request: +preferred_package_id_param, occasion vocabulary fix ----------
-- Real live 16-arg body (pulled fresh, byte-for-byte, from
-- 20260927_business_semantic_tags_expansion.sql -- confirmed the latest
-- actual redefinition) + a 17th trailing preferred_package_id_param + the
-- occasion validation widened from the stale 8-value list to the real,
-- live 16-value vocabulary (see this migration's own header comment) + a
-- call to _match_request_to_package alongside the existing three matchers.
drop function if exists public.create_business_request(
  text, double precision, double precision, text, integer, integer, integer,
  date, time without time zone, time without time zone, double precision,
  uuid, uuid, text[], text, text
);

create or replace function public.create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  party_size_param integer default null,
  budget_min_param integer default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time without time zone default null,
  time_window_end_param time without time zone default null,
  radius_miles_param double precision default 15,
  submission_id_param uuid default null,
  preferred_availability_id_param uuid default null,
  attributes_param text[] default null,
  cuisine_param text default null,
  occasion_param text default null,
  preferred_package_id_param uuid default null
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
  v_ai_new_count integer;
  v_package_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if attributes_param is not null and not (attributes_param <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
    'kid_friendly', 'quiet', 'casual', 'upscale',
    'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront',
    'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused'
  ]::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
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
    radius_miles, expires_at, submission_id, attributes, cuisine, occasion
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid()),
    coalesce(attributes_param, '{}'), cuisine_param, occasion_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param, preferred_availability_id_param, party_size_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), party_size_param, time_window_start_param, time_window_end_param) into v_policy_new_count;
  select public._match_request_to_package(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), occasion_param, party_size_param, date_param, preferred_package_id_param) into v_package_new_count;
  select public._ai_auto_respond_to_business_requests(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, party_size_param, time_window_start_param, time_window_end_param) into v_ai_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0) + coalesce(v_package_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time without time zone, time without time zone, double precision, uuid, uuid, text[], text, text, uuid) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time without time zone, time without time zone, double precision, uuid, uuid, text[], text, text, uuid) to authenticated;

-- ---------- create_business_request_for_gathering: occasion vocabulary fix only ----------
-- Same signature (no param added, so a plain CREATE OR REPLACE is safe --
-- no drop needed), real live body pulled byte-for-byte from
-- 20260912_business_request_occasion.sql (the latest actual redefinition),
-- occasion check widened to the real 16-value vocabulary. Not wired to
-- _match_request_to_package in this pass -- gathering-sourced business
-- requests picking up package supply is a real, disclosed, bounded fast-
-- follow, not core to this item.
create or replace function public.create_business_request_for_gathering(
  gathering_id_param uuid,
  raw_text_param text,
  category_param text default null,
  budget_max_param integer default null,
  radius_miles_param double precision default 15,
  occasion_param text default null
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

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
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
    radius_miles, expires_at, gathering_id, occasion
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_scheduled_at::date, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param, occasion_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null, null, v_party_size) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), v_party_size, null, null) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$;

revoke all on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision, text) from public, anon;
grant execute on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision, text) to authenticated;

-- ---------- create_business_request_for_match: occasion vocabulary fix only ----------
-- Same signature (no param added), real live body pulled byte-for-byte
-- from 20261001_plan_something_real_supply.sql (the latest actual
-- redefinition), occasion check widened to the real 16-value vocabulary.
-- Not wired to _match_request_to_package in this pass, same disclosed
-- fast-follow boundary as the gathering function above.
create or replace function public.create_business_request_for_match(
  match_id_param uuid,
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time without time zone default null,
  time_window_end_param time without time zone default null,
  radius_miles_param double precision default 15,
  occasion_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match record;
  v_proposal record;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
  v_category text;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
  end if;

  select * into v_match from matches where id = match_id_param;
  if v_match is null then
    raise exception 'Match not found.';
  end if;
  if auth.uid() <> v_match.user_a and auth.uid() <> v_match.user_b then
    raise exception 'You are not part of this match.';
  end if;

  select * into v_proposal
  from date_proposals
  where match_id = match_id_param and status = 'accepted'
  order by responded_at desc
  limit 1;

  if v_proposal is null then
    raise exception 'A plan must be proposed and accepted by your match before asking businesses.';
  end if;

  v_category := coalesce(category_param, v_proposal.category);

  select id into v_duplicate_id
  from business_requests
  where match_id = match_id_param and status = 'open'
  order by created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', 2);
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', 2);
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
    requester_id, raw_text, category, party_size, budget_max, date,
    time_window_start, time_window_end, latitude, longitude, radius_miles,
    expires_at, match_id, occasion
  ) values (
    auth.uid(), trim(raw_text_param), v_category, 2, budget_max_param, date_param,
    time_window_start_param, time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at, match_id_param, occasion_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), v_category, date_param, time_window_start_param, time_window_end_param, v_proposal.availability_id, 2) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), 2, time_window_start_param, time_window_end_param) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', 2);
end;
$function$;

revoke all on function public.create_business_request_for_match(uuid, text, double precision, double precision, text, integer, date, time without time zone, time without time zone, double precision, text) from public, anon;
grant execute on function public.create_business_request_for_match(uuid, text, double precision, double precision, text, integer, date, time without time zone, time without time zone, double precision, text) to authenticated;
