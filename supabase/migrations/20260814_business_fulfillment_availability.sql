-- Intent Layer + Business Fulfillment, Phase 4 (see CLAUDE.md's "Intent
-- Layer + Business Fulfillment" plan, phase 4: "Proactive business
-- availability" -- "we have 4 empty seats tonight," businesses posting
-- time-boxed availability the resolver can match against open requests
-- without a consumer asking first). Two-way matching, both real:
--   - posting availability immediately scans currently-open
--     business_requests and offers to each real match
--   - a new business_request (solo or gathering-sourced) immediately
--     scans currently-active availability and offers from each real match
-- Both directions upsert a real 'offered' business_request_offers row
-- (never a bare 'pending' placeholder) with the availability's own real
-- terms, since the business already declared them in advance -- this is
-- what makes it "without a consumer asking first," not a new UI surface.
--
-- Real reservation integrity for the *shared* scarcity a single
-- availability posting introduces (one posting can match many different
-- open requests, but "4 seats" is still only 4 seats total across all of
-- them) -- capacity is decremented with a FOR UPDATE lock only at
-- ACCEPT time (being offered doesn't consume a slot, only being accepted
-- does), same discipline as join_gathering()'s capacity check and Phase
-- 2's own accept_business_offer() per-request winner lock.

-- ---------- TABLE: business_availability ----------
create table if not exists public.business_availability (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  category text,
  title text not null,
  description text,
  offer_type text,
  price numeric(10,2),
  capacity integer,
  remaining_capacity integer,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  radius_miles double precision not null default 15,
  created_at timestamptz not null default now(),
  status text not null default 'active',
  constraint business_availability_status_check check (status in ('active', 'expired', 'cancelled', 'filled')),
  constraint business_availability_offer_type_check check (offer_type is null or offer_type in (
    'standard', 'discount', 'perk', 'upgrade', 'alt_time'
  )),
  constraint business_availability_category_check check (category is null or category in (
    'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
    'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
    'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
    'Volunteering', 'Meditation', 'Running'
  )),
  constraint business_availability_capacity_check check (capacity is null or capacity > 0),
  constraint business_availability_remaining_check check (remaining_capacity is null or remaining_capacity >= 0),
  constraint business_availability_window_check check (ends_at > starts_at),
  constraint business_availability_price_check check (price is null or price >= 0)
);

alter table public.business_availability enable row level security;

create index if not exists business_availability_partner_id_idx on public.business_availability(partner_id);
create index if not exists business_availability_active_ends_idx on public.business_availability(status, ends_at) where status = 'active';

create policy "Business owners can view their own availability postings"
on public.business_availability for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.managed_partner_id = business_availability.partner_id
  )
);

-- No INSERT/UPDATE policy -- every write goes through a SECURITY DEFINER
-- RPC below, matching this schema's established convention.

alter table public.business_request_offers
  add column if not exists availability_id uuid references public.business_availability(id) on delete set null;

-- ---------- FUNCTION: _match_request_to_availability (internal helper) ----------
-- One direction of the two-way match: given a just-created request's own
-- real fields, find active availability postings that genuinely fit and
-- upsert a real 'offered' row for each. Locked down the same way
-- _business_request_fanout already is -- verified in the Phase 3 pass
-- that a nested SECURITY DEFINER call bypasses this safely; not
-- independently exposed to clients, since it takes a raw request id with
-- no ownership check of its own.
create or replace function public._match_request_to_availability(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  category_param text,
  date_param date,
  time_window_start_param time,
  time_window_end_param time
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_matched_count integer := 0;
  v_avail record;
begin
  for v_avail in
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or ba.remaining_capacity > 0)
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
    order by ba.created_at desc
    limit 5
  loop
    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_avail.partner_id, v_avail.offer_type, coalesce(v_avail.description, v_avail.title), v_avail.price, v_avail.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      v_matched_count := v_matched_count + 1;
    end if;
  end loop;

  return v_matched_count;
end;
$function$;

revoke all on function public._match_request_to_availability(uuid, double precision, double precision, double precision, text, date, time, time) from public, anon, authenticated;

-- ---------- FUNCTION: post_business_availability ----------
-- Owner-only. Immediately scans currently-open business_requests for a
-- real match (same fields/logic as the reverse direction above, just
-- walking the other table) and upserts a real 'offered' row for each --
-- capped at 10, matching the existing fan-out cap's "don't overwhelm
-- supply/demand" reasoning, applied here to the request side instead.
create or replace function public.post_business_availability(
  category_param text,
  title_param text,
  description_param text,
  offer_type_param text,
  price_param numeric,
  capacity_param integer,
  starts_at_param timestamptz,
  ends_at_param timestamptz,
  radius_miles_param double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_availability_id uuid;
  v_matched_count integer := 0;
  v_req record;
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;
  if title_param is null or length(trim(title_param)) = 0 then
    raise exception 'Give this availability a real title.';
  end if;
  if ends_at_param <= starts_at_param then
    raise exception 'End time must be after the start time.';
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = v_partner_id;
  if v_lat is null or v_lng is null then
    raise exception 'Set your business address before posting availability.';
  end if;

  insert into business_availability (
    partner_id, category, title, description, offer_type, price,
    capacity, remaining_capacity, starts_at, ends_at, radius_miles
  ) values (
    v_partner_id, category_param, trim(title_param), description_param, offer_type_param, price_param,
    capacity_param, capacity_param, starts_at_param, ends_at_param, coalesce(radius_miles_param, 15)
  ) returning id into v_availability_id;

  for v_req in
    select br.*
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and (category_param is null or br.category is null or br.category = category_param)
    and (
      br.date is null
      or br.date between starts_at_param::date and ends_at_param::date
    )
    and (
      br.date is null or br.time_window_start is null or br.time_window_end is null
      or (br.date + br.time_window_start, br.date + br.time_window_end) overlaps (starts_at_param, ends_at_param)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= least(br.radius_miles, coalesce(radius_miles_param, 15))
    order by br.created_at desc
    limit 10
  loop
    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (v_req.id, v_partner_id, offer_type_param, coalesce(description_param, title_param), price_param, v_availability_id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      v_matched_count := v_matched_count + 1;

      select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_req.requester_id,
          'title', 'New offer for your request!',
          'body', trim(title_param) || ' just became available for "' || left(v_req.raw_text, 60) || '"',
          'data', jsonb_build_object('type', 'business_offer_received', 'request_id', v_req.id)
        )
      );
    end if;
  end loop;

  return jsonb_build_object('availabilityId', v_availability_id, 'matchedCount', v_matched_count);
end;
$function$;

revoke all on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision) from public, anon;
grant execute on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision) to authenticated;

-- ---------- FUNCTION: cancel_business_availability ----------
-- Also expires any not-yet-accepted offers this posting had already
-- generated -- the business's declared terms no longer exist, so an
-- 'offered' row sourced from it is no longer honest to leave standing.
create or replace function public.cancel_business_availability(availability_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_row record;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_availability where id = availability_id_param for update;
  if v_row is null or v_row.partner_id <> v_partner_id then
    raise exception 'Availability posting not found.';
  end if;
  if v_row.status not in ('active') then
    raise exception 'This posting is no longer active.';
  end if;

  update business_availability set status = 'cancelled' where id = availability_id_param;

  update business_request_offers
  set status = 'expired'
  where availability_id = availability_id_param
  and status in ('pending', 'offered');

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.cancel_business_availability(uuid) from public, anon;
grant execute on function public.cancel_business_availability(uuid) to authenticated;

-- ---------- FUNCTION: get_my_business_availability ----------
create or replace function public.get_my_business_availability(partner_id_param uuid)
returns setof business_availability
language sql
stable
security definer
set search_path to 'public'
as $$
  select ba.* from business_availability ba
  join profiles p on p.id = auth.uid() and p.managed_partner_id = ba.partner_id
  where ba.partner_id = partner_id_param
  order by ba.created_at desc;
$$;

revoke all on function public.get_my_business_availability(uuid) from public, anon;
grant execute on function public.get_my_business_availability(uuid) to authenticated;

-- ---------- create_business_request / create_business_request_for_gathering: re-pointed to also match availability ----------
-- Pure additive extension of the Phase 2/3 bodies -- everything already
-- there (validation, the pending fan-out via _business_request_fanout)
-- is unchanged; one new call added at the end so a brand-new request
-- also immediately checks active availability, closing the "without a
-- consumer asking first" loop from both directions.
create or replace function public.create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  party_size_param integer default null,
  budget_min_param integer default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time default null,
  time_window_end_param time default null,
  radius_miles_param double precision default 15
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
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
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
    radius_miles, expires_at
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  perform public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) to authenticated;

create or replace function public.create_business_request_for_gathering(
  gathering_id_param uuid,
  raw_text_param text,
  category_param text default null,
  budget_max_param integer default null,
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
  perform public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$;

revoke all on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) from public, anon;
grant execute on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) to authenticated;

-- ---------- accept_business_offer: re-pointed to enforce shared availability capacity ----------
-- Additive to the Phase 2 body -- everything already there (per-request
-- winner lock, sibling-expiry, notification) is unchanged; the only new
-- logic is the availability-capacity check/decrement, which only ever
-- runs when the winning offer actually came from a posting (availability_id
-- is not null). Locks the availability row FOR UPDATE before checking
-- remaining_capacity, same discipline as join_gathering()'s capacity
-- check -- this is a genuinely different scarcity axis than the
-- per-request winner-uniqueness the partial unique index already
-- enforces (one posting's capacity is shared across many different
-- requests' offers, not scoped to a single request).
create or replace function public.accept_business_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
  service_key text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id <> auth.uid() then
    raise exception 'You do not own this request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;

  if v_offer.availability_id is not null then
    select * into v_availability from business_availability where id = v_offer.availability_id for update;
    if v_availability is not null and v_availability.remaining_capacity is not null then
      if v_availability.remaining_capacity <= 0 then
        raise exception 'This availability just filled up.';
      end if;
      update business_availability
      set remaining_capacity = remaining_capacity - 1,
          status = case when remaining_capacity - 1 <= 0 then 'filled' else status end
      where id = v_offer.availability_id;
    end if;
  end if;

  update business_request_offers
  set status = 'accepted', accepted_at = now()
  where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id
  and id <> offer_id_param
  and status in ('pending', 'offered');

  update business_requests
  set status = 'fulfilled'
  where id = v_request.id;

  select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
  if v_managing_profiles is not null then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    for i in 1 .. array_length(v_managing_profiles, 1) loop
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_managing_profiles[i],
          'title', 'Your offer was accepted!',
          'body', 'A customer accepted your offer on "' || left(v_request.raw_text, 60) || '"',
          'data', jsonb_build_object('type', 'business_offer_accepted', 'request_id', v_request.id, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.accept_business_offer(uuid) from public, anon;
grant execute on function public.accept_business_offer(uuid) to authenticated;

-- ---------- expire_stale_business_requests: also expire lapsed availability ----------
create or replace function public.expire_stale_business_requests()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update business_request_offers
  set status = 'expired'
  where status in ('pending', 'offered')
  and request_id in (
    select id from business_requests where status = 'open' and expires_at < now()
  );

  update business_requests
  set status = 'expired'
  where status = 'open' and expires_at < now();

  update business_request_offers
  set status = 'expired'
  where status in ('pending', 'offered')
  and availability_id in (
    select id from business_availability where status = 'active' and ends_at < now()
  );

  update business_availability
  set status = 'expired'
  where status = 'active' and ends_at < now();
end;
$function$;

revoke all on function public.expire_stale_business_requests() from public, anon, authenticated;
