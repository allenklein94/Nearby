-- Real Stripe Connect wiring for the already-built, deliberately-inert
-- business_reservations/business_payments seams (Offer System Phase 1,
-- 2026-08-17) — closes step 1 of the "real next steps" list from the
-- 2026-08-27 locked Decision 2 in CLAUDE.md: direct charges, the business is
-- the merchant of record, Nearby never custodies consumer funds, Nearby's
-- own cut is collected automatically via a Stripe application fee on the
-- SAME charge (not a destination charge with a delayed transfer, which was
-- explicitly rejected in that decision).
--
-- Schema/RPC only — no live Stripe keys exist yet (confirmed directly via
-- the Management API's secrets list before writing this: no
-- STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PUBLISHABLE_KEY
-- anywhere), matching this file's own established "build the inert seam
-- now, it lights up once real keys exist" pattern already used once for
-- business_reservations/business_payments themselves. Every new column
-- here is honestly inert until (a) a real Stripe platform account exists
-- and (b) a business actually completes Connect onboarding.

-- ── Business-side: Stripe Connect account state ────────────────────────
-- One Express account per business, created lazily the first time an
-- owner starts onboarding. Every column here mirrors a real field Stripe's
-- own `account.updated` webhook event reports — nothing invented.
alter table brand_partners
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_requirements_due text[],
  add column if not exists stripe_account_created_at timestamptz,
  add column if not exists stripe_account_updated_at timestamptz;

create unique index if not exists brand_partners_stripe_account_id_idx
  on brand_partners (stripe_account_id) where stripe_account_id is not null;

-- ── Payment-side: the real Stripe fields a direct-charge PaymentIntent
-- needs, layered onto the existing business_payments seam ─────────────
-- application_fee_amount is Nearby's own real cut of this specific
-- charge, in dollars (matching `amount`'s own existing unit) — computed
-- once, at PaymentIntent-creation time, from a platform fee rate that
-- lives in code (create-business-payment-intent), not in this schema, per
-- the same "not a per-transaction decision" reasoning as any other
-- platform-wide config in this codebase. Never null once a real
-- PaymentIntent exists; null for every `not_required`/pre-Stripe row.
alter table business_payments
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id text,
  add column if not exists application_fee_amount numeric,
  add column if not exists failure_reason text;

create unique index if not exists business_payments_stripe_payment_intent_id_idx
  on business_payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- ── Webhook idempotency ─────────────────────────────────────────────────
-- Stripe's own delivery guarantee is "at least once" — a webhook handler
-- that isn't idempotent will double-process a retried delivery (e.g.
-- double-marking a payment captured is harmless, but re-running arbitrary
-- future event handling might not be). One row per real Stripe event id,
-- written before any handling logic runs; a duplicate insert is a no-op
-- signal to skip, not an error. No RLS needed — this table is written
-- exclusively by the stripe-connect-webhook Edge Function via the service
-- role, and never read by any client.
create table if not exists stripe_webhook_events (
  id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table stripe_webhook_events enable row level security;
revoke all on stripe_webhook_events from public, anon, authenticated;

-- ── accept_business_offer(): route the new payment row to a real,
-- honest 'pending' Stripe state instead of always 'not_required', when
-- (and only when) the accepting business has genuinely finished Connect
-- onboarding for this specific offer's price. Every other line of this
-- function is byte-for-byte unchanged from its live production body,
-- pulled fresh via the Management API before writing this migration —
-- the reservation-confirms-immediately / one-winner / push-notification
-- behavior this function already has is completely untouched. The actual
-- PaymentIntent itself is NOT created here — Postgres can't make a
-- synchronous outbound call to Stripe and hand a client_secret back to
-- the caller, so that step is a separate, deliberate follow-up call the
-- client makes to the new create-business-payment-intent Edge Function
-- right after this RPC returns paymentRequired: true.
create or replace function accept_business_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_reservation_id uuid;
  v_managing_profiles uuid[];
  service_key text;
  v_stripe_ready boolean;
  v_payment_status text;
  v_payment_provider text;
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

  -- Real, honest routing: a payable Stripe PaymentIntent can only follow
  -- when there's a real price AND the business has genuinely finished
  -- Connect onboarding (stripe_charges_enabled) — otherwise this stays
  -- exactly the pre-Stripe 'not_required' state, never a fabricated
  -- pending charge nothing downstream can actually collect.
  select stripe_charges_enabled into v_stripe_ready
  from brand_partners where id = v_offer.partner_id;

  if v_offer.offer_price is not null and coalesce(v_stripe_ready, false) then
    v_payment_status := 'pending';
    v_payment_provider := 'stripe';
  else
    v_payment_status := 'not_required';
    v_payment_provider := null;
  end if;

  insert into business_payments (reservation_id, status, amount, currency, payer_id, provider)
  values (v_reservation_id, v_payment_status, v_offer.offer_price, 'usd', auth.uid(), v_payment_provider);

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

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'paymentRequired', v_payment_status = 'pending'
  );
end;
$$;

-- No new client-facing grants needed — accept_business_offer already had
-- exactly the right ones (authenticated only), unchanged by this
-- CREATE OR REPLACE (same signature).
