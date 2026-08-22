import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

// Real Stripe Connect webhook receiver — the other half of the write path
// that create-business-payment-intent starts. Stripe calls this directly
// (not a signed-in user), so verify_jwt is deliberately false on this
// function (matching the existing revenuecat-webhook precedent exactly),
// and the real authentication is a signature check against
// STRIPE_WEBHOOK_SECRET instead of a bearer token.
//
// Handles the three real event families this app's payment flow needs:
//   account.updated            -> real Connect onboarding status
//   payment_intent.succeeded   -> a direct charge actually captured
//   payment_intent.payment_failed -> a direct charge failed
//   charge.refunded            -> a captured charge was refunded
// Every other event type is acknowledged (200) and otherwise ignored —
// Stripe sends dozens of event types this app has no use for yet.

async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=')));
  const timestamp = parts['t'];
  const expectedSig = parts['v1'];
  if (!timestamp || !expectedSig) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time-ish comparison — genuinely constant-time isn't critical
  // here (a timing side-channel on a webhook secret already sitting behind
  // TLS + a random 90+ char signature is a low-value attack), but avoids
  // the most obvious short-circuit.
  if (computedSig.length !== expectedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < computedSig.length; i++) {
    diff |= computedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return diff === 0;
}

serve(async (req) => {
  if (!STRIPE_WEBHOOK_SECRET) {
    // Honest 503, not a silent 200 -- an unconfigured webhook secret means
    // this endpoint cannot verify anything Stripe sends it, so it must not
    // pretend to have processed the event.
    return new Response('Webhook not configured.', { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('Stripe-Signature');
  const verified = await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  if (!verified) {
    return new Response('Invalid signature.', { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid payload.', { status: 400 });
  }

  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  // Idempotency: Stripe's own delivery guarantee is "at least once." A
  // duplicate event id means this was already handled -- ack and stop,
  // never re-run handling logic a second time.
  const { error: insertError } = await admin
    .from('stripe_webhook_events')
    .insert({ id: event.id, event_type: event.type });
  if (insertError) {
    // Unique-violation on id = already processed. Any other insert error
    // is unexpected but still shouldn't cause Stripe to retry forever, so
    // acknowledge either way and log for manual review.
    console.log('stripe-connect-webhook: event already processed or insert failed', event.id, insertError.message);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  try {
    const obj = event.data?.object;

    if (event.type === 'account.updated' && obj) {
      await admin
        .from('brand_partners')
        .update({
          stripe_charges_enabled: !!obj.charges_enabled,
          stripe_payouts_enabled: !!obj.payouts_enabled,
          stripe_details_submitted: !!obj.details_submitted,
          stripe_requirements_due: obj.requirements?.currently_due ?? [],
          stripe_account_updated_at: new Date().toISOString(),
        })
        .eq('stripe_account_id', obj.id);
    } else if (event.type === 'payment_intent.succeeded' && obj) {
      await admin
        .from('business_payments')
        .update({ status: 'captured', stripe_charge_id: obj.latest_charge ?? null })
        .eq('stripe_payment_intent_id', obj.id);
    } else if (event.type === 'payment_intent.payment_failed' && obj) {
      await admin
        .from('business_payments')
        .update({
          status: 'failed',
          failure_reason: obj.last_payment_error?.message ?? 'Payment failed.',
        })
        .eq('stripe_payment_intent_id', obj.id);
    } else if (event.type === 'charge.refunded' && obj?.payment_intent) {
      await admin
        .from('business_payments')
        .update({ status: 'refunded' })
        .eq('stripe_payment_intent_id', obj.payment_intent);
    }
  } catch (err) {
    console.error('stripe-connect-webhook handling error:', event.type, err);
    // Still acknowledge -- the event is recorded in stripe_webhook_events
    // either way, so a processing bug here is visible via that table plus
    // logs, not via an endless Stripe retry storm.
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
