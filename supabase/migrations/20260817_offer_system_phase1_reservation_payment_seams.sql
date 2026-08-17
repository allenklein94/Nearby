-- "The Offer System" Phase 1 (see CLAUDE.md's "The Offer System: Request ->
-- Offer -> Commitment" plan, Decisions 2/5/6, all locked directly by the
-- user). Splits "Offer Accepted" from "Reservation Confirmed" into two real
-- objects instead of one conflated status, builds the inert Payment seam
-- Stripe/a real reservation provider will plug into later, and closes the
-- three real Offer-lifecycle gaps the user's own review surfaced (a real
-- viewed_at read-receipt, a real withdrawn status distinct from declined,
-- and Failed staying on the Reservation object rather than re-collapsing
-- what this migration just split apart).
--
-- Locked state shape, given directly by the user, not to be re-derived:
--   Offer -> Offer Accepted -> Reservation Requested -> Reservation
--   Confirmed -> Experience Confirmed
-- "Experience Confirmed" is deliberately NOT a new stored object here --
-- it's a derived state (business_requests.status = 'fulfilled' AND the
-- linked business_reservations.status = 'confirmed'), matching this
-- schema's own established "collapse into a status enum, don't
-- over-normalize" preference (e.g. gathering_interest's on_my_way_at/
-- checked_in_at) rather than inventing a table for every node in the
-- vision doc's own diagram.
--
-- Nearby is itself the initial reservation provider (provider = 'nearby',
-- auto-confirms immediately) -- zero behavior change for any real user
-- today. A real external provider (Resy/OpenTable) plugs into this exact
-- seam later without a second migration, per the user's own explicit
-- "external providers sit underneath Nearby's own concepts" instruction.

-- ---------- business_request_offers: lifecycle refinements ----------
alter table public.business_request_offers
  add column if not exists viewed_at timestamptz;

alter table public.business_request_offers
  drop constraint if exists business_request_offers_status_check;
alter table public.business_request_offers
  add constraint business_request_offers_status_check check (status in (
    'pending', 'offered', 'accepted', 'declined', 'expired', 'cancelled', 'completed', 'withdrawn'
  ));

-- ---------- TABLE: business_reservations ----------
-- One row per accepted offer -- the real "Reservation" object the vision
-- doc's own diagram asks for, distinct from the Offer's own status.
create table if not exists public.business_reservations (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.business_request_offers(id) on delete cascade,
  status text not null default 'requested',
  provider text not null default 'nearby',
  provider_reference text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  constraint business_reservations_status_check check (status in (
    'requested', 'confirmed', 'failed', 'cancelled'
  ))
);

alter table public.business_reservations enable row level security;

create index if not exists business_reservations_offer_id_idx on public.business_reservations(offer_id);

create policy "Requesters can view reservations on their own accepted offers"
on public.business_reservations for select
using (
  exists (
    select 1 from public.business_request_offers bro
    join public.business_requests br on br.id = bro.request_id
    where bro.id = business_reservations.offer_id
    and br.requester_id = auth.uid()
  )
);

create policy "Business owners can view reservations on their own offers"
on public.business_reservations for select
using (
  exists (
    select 1 from public.business_request_offers bro
    join public.profiles p on p.managed_partner_id = bro.partner_id
    where bro.id = business_reservations.offer_id
    and p.id = auth.uid()
  )
);

-- No INSERT/UPDATE policy -- every write goes through accept_business_offer()/
-- complete_business_reservation() below, matching this schema's established
-- "no direct client write on a lifecycle-sensitive table" convention.

-- ---------- TABLE: business_payments ----------
-- The Decision 5 seam: a real Payment object, permanently inert until a
-- real processor is connected in a future, explicitly separate pass.
-- status stays 'not_required' for every row this whole pass -- nothing
-- here ever actually charges anyone.
create table if not exists public.business_payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.business_reservations(id) on delete cascade,
  status text not null default 'not_required',
  amount numeric(10,2),
  currency text not null default 'usd',
  payer_id uuid references public.profiles(id),
  provider text,
  provider_transaction_id text,
  created_at timestamptz not null default now(),
  constraint business_payments_status_check check (status in (
    'not_required', 'pending', 'authorized', 'captured', 'failed', 'refunded'
  ))
);

alter table public.business_payments enable row level security;

create index if not exists business_payments_reservation_id_idx on public.business_payments(reservation_id);

create policy "Requesters can view their own payment rows"
on public.business_payments for select
using (
  exists (
    select 1 from public.business_reservations res
    join public.business_request_offers bro on bro.id = res.offer_id
    join public.business_requests br on br.id = bro.request_id
    where res.id = business_payments.reservation_id
    and br.requester_id = auth.uid()
  )
);

create policy "Business owners can view payment rows on their own offers"
on public.business_payments for select
using (
  exists (
    select 1 from public.business_reservations res
    join public.business_request_offers bro on bro.id = res.offer_id
    join public.profiles p on p.managed_partner_id = bro.partner_id
    where res.id = business_payments.reservation_id
    and p.id = auth.uid()
  )
);

-- No INSERT/UPDATE policy, same convention as business_reservations.

-- ---------- FUNCTION: mark_business_offer_viewed ----------
-- A real, honest read-receipt -- set the first time the consumer's own
-- session actually opens that specific offer, never assumed from
-- delivery. Idempotent by construction (only ever sets it once, via the
-- "viewed_at is null" guard) -- a repeat call is a harmless no-op, not an
-- error, matching this schema's own established "duplicate write is a
-- no-op, not a failure" convention (e.g. addFriendToCircle's 23505 swallow).
create or replace function public.mark_business_offer_viewed(offer_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update business_request_offers bro
  set viewed_at = now()
  from business_requests br
  where bro.id = offer_id_param
  and bro.request_id = br.id
  and br.requester_id = auth.uid()
  and bro.viewed_at is null;
end;
$function$;

revoke all on function public.mark_business_offer_viewed(uuid) from public, anon;
grant execute on function public.mark_business_offer_viewed(uuid) to authenticated;

-- ---------- FUNCTION: withdraw_business_offer ----------
-- The real, previously-unrepresentable gap Decision 6 named: a business
-- rescinding an offer it already sent, before the consumer accepted it.
-- Distinct from decline_business_offer() (never offered in the first
-- place) and from the existing post-hoc cancellation path.
create or replace function public.withdraw_business_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_row record;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_request_offers
  where id = offer_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'Offer not found.';
  end if;
  if v_row.status <> 'offered' then
    raise exception 'This offer can no longer be withdrawn.';
  end if;

  update business_request_offers
  set status = 'withdrawn', responded_at = now()
  where id = offer_id_param;

  select requester_id, raw_text into v_requester_id, v_raw_text
  from business_requests where id = v_row.request_id;
  select name into v_partner_name from brand_partners where id = v_partner_id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_requester_id,
      'title', 'An offer was withdrawn',
      'body', coalesce(v_partner_name, 'A business') || ' withdrew its offer on "' || left(v_raw_text, 60) || '"',
      'data', jsonb_build_object('type', 'business_offer_withdrawn', 'request_id', v_row.request_id, 'offer_id', offer_id_param)
    )
  );

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.withdraw_business_offer(uuid) from public, anon;
grant execute on function public.withdraw_business_offer(uuid) to authenticated;

-- ---------- accept_business_offer: re-pointed to also create the real Reservation + Payment rows ----------
-- Additive to the Phase 2/3/4 body (pulled fresh, byte-for-byte, from the
-- last live migration before editing) -- everything already there
-- (per-request winner lock, sibling-expiry, availability-capacity
-- decrement, notification) is unchanged. The only new logic: once the
-- winning offer is flipped to 'accepted', a real business_reservations
-- row is created and immediately confirmed (Nearby is the only provider
-- today), and a real, permanently-inert business_payments row is created
-- alongside it -- the seam Decision 5 asks for, not a fabricated charge.
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
  v_reservation_id uuid;
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

  insert into business_reservations (offer_id, status, provider, confirmed_at)
  values (offer_id_param, 'confirmed', 'nearby', now())
  returning id into v_reservation_id;

  insert into business_payments (reservation_id, status, amount, currency, payer_id)
  values (v_reservation_id, 'not_required', v_offer.offer_price, 'usd', auth.uid());

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

  return jsonb_build_object('success', true, 'reservationId', v_reservation_id);
end;
$function$;

revoke all on function public.accept_business_offer(uuid) from public, anon;
grant execute on function public.accept_business_offer(uuid) to authenticated;

-- ---------- complete_business_reservation: re-pointed to check/update business_reservations too ----------
-- Real addition, not cosmetic: now verifies a confirmed Reservation
-- genuinely exists before allowing completion, matching the "never skip
-- a state" principle this whole initiative is built around -- an offer
-- can't jump straight from 'accepted' to 'completed' if its own
-- Reservation somehow never reached 'confirmed'.
create or replace function public.complete_business_reservation(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_reservation record;
  v_partner_id uuid;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  select * into v_reservation from business_reservations where offer_id = offer_id_param for update;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
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
