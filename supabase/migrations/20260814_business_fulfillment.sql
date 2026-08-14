-- Intent Layer + Business Fulfillment, Phase 2 (see CLAUDE.md's "Intent
-- Layer + Business Fulfillment" plan). The 1:1 consumer -> business
-- request/offer/reservation lifecycle: request -> opportunity -> offer ->
-- accept -> reservation -> complete, with real server-side reservation
-- integrity (no double-accepting the same slot) and expiration/decline/
-- cancellation branches. No payment collection here -- deliberately
-- deferred, matches this file's own standing "needs the user present for
-- that decision" stance on the existing business-billing gap.

-- ---------- TABLE: business_requests ----------
-- The consumer's ask. category reuses create-assistant's own
-- VALID_CATEGORIES list verbatim (24 tags) so the two never drift apart.
create table if not exists public.business_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text not null,
  category text,
  party_size integer,
  budget_min integer,
  budget_max integer,
  date date,
  time_window_start time,
  time_window_end time,
  latitude double precision not null,
  longitude double precision not null,
  radius_miles double precision not null default 15,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'open',
  constraint business_requests_status_check check (status in ('open', 'fulfilled', 'expired', 'cancelled')),
  constraint business_requests_category_check check (category is null or category in (
    'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
    'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
    'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
    'Volunteering', 'Meditation', 'Running'
  )),
  constraint business_requests_party_size_check check (party_size is null or party_size > 0),
  constraint business_requests_budget_check check (
    (budget_min is null or budget_min >= 0)
    and (budget_max is null or budget_max >= 0)
    and (budget_min is null or budget_max is null or budget_min <= budget_max)
  ),
  constraint business_requests_radius_check check (radius_miles > 0)
);

alter table public.business_requests enable row level security;

create index if not exists business_requests_requester_id_idx on public.business_requests(requester_id);
create index if not exists business_requests_open_expires_idx on public.business_requests(status, expires_at) where status = 'open';

-- ---------- TABLE: business_request_offers ----------
-- One row per (request_id, partner_id) -- collapses opportunity-sent ->
-- offer-submitted -> accepted -> reservation -> completion into a single
-- lifecycle row with a status enum + per-phase timestamps, matching this
-- schema's own demonstrated preference (e.g. gathering_interest's
-- on_my_way_at/checked_in_at) over a table per state transition.
create table if not exists public.business_request_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.business_requests(id) on delete cascade,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  offer_type text,
  offer_price numeric(10,2),
  offer_description text,
  proposed_time timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  responded_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  status text not null default 'pending',
  constraint business_request_offers_status_check check (status in (
    'pending', 'offered', 'accepted', 'declined', 'expired', 'cancelled', 'completed'
  )),
  constraint business_request_offers_offer_type_check check (offer_type is null or offer_type in (
    'standard', 'discount', 'perk', 'upgrade', 'alt_time'
  )),
  constraint business_request_offers_price_check check (offer_price is null or offer_price >= 0),
  constraint business_request_offers_unique_partner unique (request_id, partner_id)
);

alter table public.business_request_offers enable row level security;

create index if not exists business_request_offers_request_id_idx on public.business_request_offers(request_id);
create index if not exists business_request_offers_partner_id_idx on public.business_request_offers(partner_id);

-- Server-side reservation integrity: guarantees only one offer per request
-- can ever win, enforced at the database level -- same anti-double-approval
-- pattern already established by business_partner_requests_pending_unique
-- and the FOR UPDATE lock in join_gathering()'s capacity check.
create unique index if not exists business_request_offers_one_winner_idx
  on public.business_request_offers(request_id)
  where status in ('accepted', 'completed');

-- ---------- RLS: business_requests ----------
create policy "Requesters can view their own business requests"
on public.business_requests for select
using (auth.uid() = requester_id);

-- A plain EXISTS subquery here would create a genuine RLS recursion cycle
-- with business_request_offers' own "Requesters can view offers on their
-- own requests" SELECT policy (which itself queries business_requests) --
-- the identical shape of bug this schema already hit once for
-- communities/community_members, fixed there via is_community_visible_to().
-- Same fix here: a SECURITY DEFINER helper bypasses business_request_offers'
-- RLS for this one check, breaking the cycle.
create or replace function public.business_request_offer_exists_for_caller(request_id_param uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.business_request_offers bro
    join public.profiles p on p.managed_partner_id = bro.partner_id
    where bro.request_id = request_id_param
    and p.id = auth.uid()
  );
$$;

revoke all on function public.business_request_offer_exists_for_caller(uuid) from public, anon;
grant execute on function public.business_request_offer_exists_for_caller(uuid) to authenticated;

create policy "Businesses can view requests they've received an opportunity for"
on public.business_requests for select
using (public.business_request_offer_exists_for_caller(business_requests.id));

-- ---------- RLS: business_request_offers ----------
create policy "Requesters can view offers on their own requests"
on public.business_request_offers for select
using (
  exists (
    select 1 from public.business_requests br
    where br.id = business_request_offers.request_id
    and br.requester_id = auth.uid()
  )
);

create policy "Business owners can view their own offer rows"
on public.business_request_offers for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.managed_partner_id = business_request_offers.partner_id
  )
);

-- No INSERT/UPDATE policy on either table, matching this schema's
-- established "no direct client write on an owner/lifecycle-sensitive
-- table" convention (e.g. business_customer_notes) -- every write goes
-- through a SECURITY DEFINER RPC below.

-- ---------- FUNCTION: create_business_request ----------
-- Creates the consumer's ask, then fans it out to nearby active
-- businesses as real 'pending' opportunity rows -- capped at
-- BUSINESS_REQUEST_FANOUT_CAP (10, a plain stated default, not derived
-- from any real usage data this app doesn't have yet, same convention as
-- the 50-message pagination page size) so a single request can't
-- overwhelm every business on the platform, the exact "don't notify every
-- eligible business on every request" concern this plan flagged.
-- Deliberately NOT filtered by brand_partners.category (a 6-bucket
-- business-type taxonomy) against category_param (this table's own
-- 24-tag gathering-activity taxonomy) -- no reliable crosswalk between
-- the two exists today, and most partners have no category set at all
-- yet (confirmed live: production has exactly one categorized partner) --
-- a wrongly-excluded business is a worse outcome than showing a business
-- a request slightly outside its usual category and letting it
-- self-select on the Business Opportunities inbox. Flagged as a real,
-- deliberately deferred refinement, not an oversight.
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

  -- A request whose own computed expiry already fell in the past (e.g.
  -- "today" submitted after that day's window already passed) still gets
  -- a real, short floor rather than being born already-expired.
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

  with eligible as (
    select p.id, (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) as distance_miles
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
  )
  insert into business_request_offers (request_id, partner_id)
  select v_request_id, id
  from eligible
  where distance_miles <= coalesce(radius_miles_param, 15)
  order by distance_miles asc
  limit 10;

  get diagnostics v_notified_count = row_count;

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) to authenticated;

-- ---------- FUNCTION: submit_business_offer ----------
-- Business responds to a real, still-open opportunity with real offer
-- terms -- flexible offer shape (offer_type), never hard-coded to
-- discount. Looked up by request_id + the caller's own managed_partner_id
-- (a request can only ever have one offer row per partner, so this is
-- always unambiguous), matching the same profiles.managed_partner_id
-- ownership check confirm_offer_redemption() already established.
create or replace function public.submit_business_offer(
  request_id_param uuid,
  offer_type_param text,
  offer_description_param text,
  offer_price_param numeric default null,
  proposed_time_param timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
  from business_requests where id = request_id_param;
  if v_request_status is null then
    raise exception 'Request not found.';
  end if;
  if v_request_status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;

  update business_request_offers
  set status = 'offered',
      offer_type = offer_type_param,
      offer_description = offer_description_param,
      offer_price = offer_price_param,
      proposed_time = proposed_time_param,
      responded_at = now()
  where id = v_row.id;

  -- Notify the consumer a real offer came in -- not gated on a dedicated
  -- notify_* preference, since none exists for this new event type;
  -- follows the same unconditional-send precedent already established for
  -- business_partner_approved/denied pushes.
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into v_partner_name from brand_partners where id = v_partner_id;
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_requester_id,
      'title', 'New offer for your request!',
      'body', coalesce(v_partner_name, 'A business') || ' responded to "' || left(v_raw_text, 60) || '"',
      'data', jsonb_build_object('type', 'business_offer_received', 'request_id', request_id_param, 'offer_id', v_row.id)
    )
  );

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$function$;

revoke all on function public.submit_business_offer(uuid, text, text, numeric, timestamptz) from public, anon;
grant execute on function public.submit_business_offer(uuid, text, text, numeric, timestamptz) to authenticated;

-- ---------- FUNCTION: decline_business_offer ----------
create or replace function public.decline_business_offer(request_id_param uuid)
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

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status not in ('pending', 'offered') then
    raise exception 'This request has already been resolved.';
  end if;

  update business_request_offers
  set status = 'declined', responded_at = now()
  where id = v_row.id;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.decline_business_offer(uuid) from public, anon;
grant execute on function public.decline_business_offer(uuid) to authenticated;

-- ---------- FUNCTION: accept_business_offer ----------
-- Locks the parent business_requests row FOR UPDATE first, same race-
-- condition discipline as join_gathering()'s capacity check, so two
-- concurrent accepts on sibling offers of the same request can't both
-- win -- the second one to reach the lock sees status <> 'open' and is
-- rejected. The partial unique index above is the second, DB-level
-- backstop if that's ever somehow bypassed.
create or replace function public.accept_business_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
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

  -- Notify whoever manages the winning business -- there can genuinely be
  -- more than one profile with the same managed_partner_id, so this
  -- notifies all of them rather than assuming exactly one owner.
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

-- ---------- FUNCTION: complete_business_reservation ----------
-- Either party to the winning reservation can mark it complete -- the
-- consumer confirming they showed up, or the business confirming the
-- visit happened. Outcome/rating shape (a real gathering_feedback-style
-- follow-up) is deliberately not built here -- flagged in the plan as
-- Phase 2's own separate design pass, not this migration's job.
create or replace function public.complete_business_reservation(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_partner_id uuid;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id;
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();

  if auth.uid() <> v_request.requester_id and (v_partner_id is null or v_partner_id <> v_offer.partner_id) then
    raise exception 'You are not part of this reservation.';
  end if;

  update business_request_offers
  set status = 'completed', completed_at = now()
  where id = offer_id_param;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.complete_business_reservation(uuid) from public, anon;
grant execute on function public.complete_business_reservation(uuid) to authenticated;

-- ---------- FUNCTION: cancel_business_request ----------
create or replace function public.cancel_business_request(request_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from business_requests
  where id = request_id_param and requester_id = auth.uid()
  for update;

  if v_status is null then
    raise exception 'Request not found.';
  end if;
  if v_status <> 'open' then
    raise exception 'This request can no longer be cancelled.';
  end if;

  update business_requests set status = 'cancelled' where id = request_id_param;

  update business_request_offers
  set status = 'cancelled'
  where request_id = request_id_param
  and status in ('pending', 'offered');

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.cancel_business_request(uuid) from public, anon;
grant execute on function public.cancel_business_request(uuid) to authenticated;

-- ---------- FUNCTION: expire_stale_business_requests (cron only) ----------
-- Not granted to authenticated/anon -- runs only via the pg_cron job
-- below, as postgres (the function owner), same convention already
-- established by generate_monthly_invoices.
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
end;
$function$;

revoke all on function public.expire_stale_business_requests() from public, anon, authenticated;

select cron.schedule(
  'expire-stale-business-requests',
  '18 * * * *',
  $$select public.expire_stale_business_requests();$$
);
