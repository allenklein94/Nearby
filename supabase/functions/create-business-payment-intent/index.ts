import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');

// PLATFORM_FEE_BPS is Nearby's own real commission on a captured offer
// payment, in basis points (1000 = 10%). This is a placeholder default,
// not a locked business decision — no product/pricing conversation has
// picked a real number yet (matches CLAUDE.md's own "no invented numbers"
// convention: this is disclosed as a placeholder here and in CLAUDE.md's
// write-up, not silently presented as final). Change this one constant to
// change Nearby's cut everywhere a Stripe payment is actually created.
const PLATFORM_FEE_BPS = 1000;

// accept_business_offer() (see 20260827_stripe_connect_seams.sql) already
// decided WHETHER this offer needs a real Stripe payment — routing the new
// business_payments row to status='pending'/provider='stripe' only when
// the business has genuinely finished Connect onboarding. Postgres can't
// make a synchronous outbound call to Stripe and hand a client_secret back
// to its own caller, so that RPC deliberately stops at "a payment is
// needed" — this function is the deliberate follow-up call the client
// makes right after, to actually create the real PaymentIntent and get a
// client_secret to confirm with the Stripe SDK.
//
// This is a genuine Stripe Connect DIRECT charge, not a destination
// charge with a delayed transfer — the PaymentIntent is created with a
// Stripe-Account header, i.e. directly in the connected account's own
// context, so the business is the real merchant of record for the charge
// itself (chargebacks/disputes land on their account, not Nearby's) and
// Nearby only ever receives its own application_fee_amount slice,
// automatically, on the same charge. This matches CLAUDE.md's own Decision
// 2 prose ("the business is the merchant of record... Nearby never
// custodies consumer funds") more faithfully than a transfer_data-based
// destination charge would have — flagged here since an earlier session's
// own shorthand "next steps" note used destination-charge terminology
// loosely; the locked decision's own reasoning is what this function
// actually implements.

function toFormParams(obj: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(...toFormParams(value as Record<string, unknown>, paramKey));
    } else {
      parts.push(`${encodeURIComponent(paramKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

async function stripeRequest(
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, unknown>,
  stripeAccount?: string
) {
  const headers: Record<string, string> = { Authorization: `Bearer ${STRIPE_SECRET_KEY}` };
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount;
  let url = `https://api.stripe.com/v1/${path}`;
  let body: string | undefined;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = params ? toFormParams(params).join('&') : undefined;
  } else if (params) {
    url += `?${toFormParams(params).join('&')}`;
  }
  const res = await fetch(url, { method, headers, body });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || 'Stripe request failed.');
  }
  return json;
}

serve(async (req) => {
  try {
    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Payments aren't set up yet. Check back soon." }), { status: 503 });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing auth' }), { status: 401 });
    }
    const supabaseAuth = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
    }
    const myId = userData.user.id;

    const { offerId } = await req.json();
    if (!offerId || typeof offerId !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing offerId' }), { status: 400 });
    }

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const { data: offer } = await admin
      .from('business_request_offers')
      .select('id, request_id, partner_id, offer_price, status')
      .eq('id', offerId)
      .single();
    if (!offer) {
      return new Response(JSON.stringify({ error: 'Offer not found.' }), { status: 404 });
    }

    const { data: request } = await admin
      .from('business_requests')
      .select('id, requester_id, raw_text')
      .eq('id', offer.request_id)
      .single();
    if (!request || request.requester_id !== myId) {
      return new Response(JSON.stringify({ error: 'You do not own this request.' }), { status: 403 });
    }

    if (offer.status !== 'accepted') {
      return new Response(JSON.stringify({ error: 'This offer has not been accepted.' }), { status: 400 });
    }

    const { data: reservation } = await admin
      .from('business_reservations')
      .select('id')
      .eq('offer_id', offerId)
      .single();
    if (!reservation) {
      return new Response(JSON.stringify({ error: 'Reservation not found.' }), { status: 404 });
    }

    const { data: payment } = await admin
      .from('business_payments')
      .select('id, status, provider, amount, stripe_payment_intent_id')
      .eq('reservation_id', reservation.id)
      .single();
    if (!payment) {
      return new Response(JSON.stringify({ error: 'Payment record not found.' }), { status: 404 });
    }
    if (payment.status !== 'pending' || payment.provider !== 'stripe') {
      return new Response(JSON.stringify({ error: 'This offer does not need a Stripe payment.' }), { status: 400 });
    }

    const { data: partner } = await admin
      .from('brand_partners')
      .select('id, stripe_account_id, stripe_charges_enabled')
      .eq('id', offer.partner_id)
      .single();
    if (!partner?.stripe_account_id || !partner.stripe_charges_enabled) {
      // Real, disclosed edge case: the business finished Connect onboarding
      // at accept_business_offer() time but has since lost charges_enabled
      // (e.g. Stripe paused the account) — the pending payment row is left
      // exactly as-is rather than silently reassigned; a person here needs
      // a real resolution path (contact the business, or a future retry/
      // refund flow), not a fabricated success.
      return new Response(
        JSON.stringify({ error: 'This business is not currently able to accept payments through Stripe.' }),
        { status: 409 }
      );
    }

    // Idempotent retry: a client that already created a PaymentIntent (e.g.
    // the app was killed before confirming) gets the same intent's current
    // client_secret back, never a second charge for the same offer.
    if (payment.stripe_payment_intent_id) {
      const existing = await stripeRequest(
        'GET',
        `payment_intents/${payment.stripe_payment_intent_id}`,
        undefined,
        partner.stripe_account_id
      );
      return new Response(
        JSON.stringify({
          clientSecret: existing.client_secret,
          stripeAccountId: partner.stripe_account_id,
          amount: payment.amount,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const amountCents = Math.round(Number(payment.amount) * 100);
    const applicationFeeCents = Math.round((amountCents * PLATFORM_FEE_BPS) / 10000);

    const paymentIntent = await stripeRequest(
      'POST',
      'payment_intents',
      {
        amount: amountCents,
        currency: 'usd',
        application_fee_amount: applicationFeeCents,
        automatic_payment_methods: { enabled: true },
        metadata: {
          reservation_id: reservation.id,
          offer_id: offerId,
          request_id: request.id,
        },
        description: `Nearby offer: ${(request.raw_text || '').slice(0, 100)}`,
      },
      partner.stripe_account_id
    );

    await admin
      .from('business_payments')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        application_fee_amount: applicationFeeCents / 100,
      })
      .eq('id', payment.id);

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        stripeAccountId: partner.stripe_account_id,
        amount: payment.amount,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('create-business-payment-intent error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Something went wrong.' }), { status: 500 });
  }
});
