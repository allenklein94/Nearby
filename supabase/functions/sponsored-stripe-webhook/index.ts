import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WEBHOOK_SECRET = Deno.env.get('STRIPE_SPONSORED_WEBHOOK_SECRET');

// Signature-verified receiver for Sponsored Spotlight payments (item 44, phase 2). This is the ONLY writer of paid
// status. It is a separate endpoint from stripe-connect-webhook (its own Stripe signing secret) so platform payments
// never mix with consumer Connect payments. verify_jwt is false: Stripe is not a signed-in user.
//   checkout.session.completed / async_payment_succeeded -> paid (only when payment_status = paid)
//   checkout.session.async_payment_failed / expired      -> slot released
//   charge.refunded / charge.dispute.created             -> serving stops (fail closed)
// Anything else is acknowledged and ignored. A live-mode event is refused unless the owner has approved live.

async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const timestamp = parts['t'];
  const expected = parts['v1'];
  if (!timestamp || !expected) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // replay window
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const computed = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (!WEBHOOK_SECRET) return new Response('Webhook not configured.', { status: 503 });
  const rawBody = await req.text();
  if (!(await verifySignature(rawBody, req.headers.get('Stripe-Signature'), WEBHOOK_SECRET))) {
    return new Response('Invalid signature.', { status: 400 });
  }
  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new Response('Invalid payload.', { status: 400 }); }

  if (event.livemode === true
      && (Deno.env.get('STRIPE_LIVE_APPROVED') !== 'true' || Deno.env.get('SPONSORED_LEGAL_REVIEW_COMPLETE') !== 'true')) {
    return new Response('Live payments are not approved.', { status: 503 });
  }

  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
  // Idempotency by Stripe event id. Unlike the Connect webhook, a processing failure removes the marker and returns 500
  // so Stripe retries: a paid event must never be silently dropped.
  const { error: dupe } = await admin.from('stripe_webhook_events').insert({ id: event.id, event_type: event.type });
  if (dupe) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });

  try {
    const obj = event.data?.object;
    let failure: string | null = null;
    if ((event.type === 'checkout.session.completed' && obj?.payment_status === 'paid') || event.type === 'checkout.session.async_payment_succeeded') {
      const { data, error } = await admin.rpc('sponsored_mark_paid', {
        session_id_param: obj.id, payment_intent_param: obj.payment_intent ?? null,
        amount_total_param: obj.amount_total ?? null, currency_param: obj.currency ?? null,
      });
      if (error) failure = error.message;
      else if (data === 'refund_due' || data === 'amount_mismatch') console.error('sponsored-stripe-webhook: needs a refund review', obj.id, data);
    } else if (event.type === 'checkout.session.async_payment_failed' && obj) {
      const { error } = await admin.rpc('sponsored_mark_unpaid', { session_id_param: obj.id, failed_param: true });
      if (error) failure = error.message;
    } else if (event.type === 'checkout.session.expired' && obj) {
      const { error } = await admin.rpc('sponsored_mark_unpaid', { session_id_param: obj.id, failed_param: false });
      if (error) failure = error.message;
    } else if (event.type === 'charge.refunded' && obj?.payment_intent) {
      const { error } = await admin.rpc('sponsored_mark_refunded', { payment_intent_param: obj.payment_intent, refunded_cents_param: obj.amount_refunded ?? 0 });
      if (error) failure = error.message;
    } else if (event.type === 'charge.dispute.created' && obj?.payment_intent) {
      const { error } = await admin.rpc('sponsored_mark_disputed', { payment_intent_param: obj.payment_intent });
      if (error) failure = error.message;
    }
    if (failure) throw new Error(failure);
  } catch (err) {
    console.error('sponsored-stripe-webhook handling error', event.type, String(err));
    await admin.from('stripe_webhook_events').delete().eq('id', event.id);
    return new Response('Processing failed.', { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
