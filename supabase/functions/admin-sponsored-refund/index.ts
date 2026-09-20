import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');

// Sponsored Spotlight refund (item 44). Stripe money movement, so it is a NAMED-APPROVER action: the database only lets
// a platform admin who is also on sponsored_finance_approvers request one, computes the amount itself from the locked
// refund rules, and writes the audit row (who / what / when / which payment). This function only relays that decision to
// Stripe. It never changes placement or payment state: Stripe's charge.refunded event, verified by
// sponsored-stripe-webhook, is what stops serving. Live keys are refused unless BOTH owner-set approvals exist.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const REFUSALS: Record<string, [number, string]> = {
  not_an_approver: [403, 'You are not an approved finance approver.'],
  reason_required: [422, 'A reason (3 to 500 characters) is required.'],
  unknown_payment: [404, 'That payment was not found.'],
  not_refundable: [409, 'That payment is not refundable.'],
  nothing_left: [409, 'That payment has already been fully refunded.'],
  already_started: [409, 'The spotlight has already started, so a full refund does not apply.'],
  not_flagged: [409, 'That payment is not flagged as late.'],
  bad_days: [422, 'Undelivered days must be 1 to 7.'],
  bad_kind: [422, 'Unknown refund type.'],
  already_in_flight: [409, 'A refund for this payment is already in progress.'],
};

serve(async (req) => {
  try {
    if (!STRIPE_SECRET_KEY) return json({ error: 'Payments are not set up.' }, 503);
    if (STRIPE_SECRET_KEY.startsWith('sk_live_') || STRIPE_SECRET_KEY.startsWith('rk_live_')) {
      if (Deno.env.get('STRIPE_LIVE_APPROVED') !== 'true' || Deno.env.get('SPONSORED_LEGAL_REVIEW_COMPLETE') !== 'true') {
        return json({ error: 'Live payments are not approved.' }, 503);
      }
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth' }, 401);
    const body = await req.json().catch(() => ({}));
    const paymentId = typeof body?.paymentId === 'string' ? body.paymentId : '';
    const kind = typeof body?.kind === 'string' ? body.kind : '';
    const reason = typeof body?.reason === 'string' ? body.reason : '';
    const days = Number.isInteger(body?.undeliveredDays) ? body.undeliveredDays : null;
    if (!paymentId || !kind) return json({ error: 'Choose a payment and a refund type.' }, 400);

    // As the CALLER: the database decides who may refund and how much.
    const asUser = createClient(SUPABASE_URL!, ANON_KEY!, { global: { headers: { Authorization: authHeader } } });
    const { data: reqRows, error: reqError } = await asUser.rpc('admin_sponsored_request_refund', {
      payment_id_param: paymentId, kind_param: kind, undelivered_days_param: days, reason_param: reason,
    });
    if (reqError) {
      const code = /sponsored_refund:(\w+)/.exec(reqError.message || '')?.[1];
      const [status, message] = (code && REFUSALS[code]) || [401, 'Not allowed.'];
      return json({ error: message, code }, status);
    }
    const action = Array.isArray(reqRows) ? reqRows[0] : reqRows;
    if (!action?.action_id) return json({ error: 'Could not start the refund.' }, 500);

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `sponsored-refund-${action.action_id}`,
      },
      body: `payment_intent=${encodeURIComponent(action.payment_intent_id)}&amount=${action.amount_cents}&metadata[action_id]=${action.action_id}`,
    });
    const refund = await res.json().catch(() => null);
    if (!res.ok || !refund?.id) {
      const msg = refund?.error?.message ?? `HTTP ${res.status}`;
      console.error('admin-sponsored-refund: Stripe refused', res.status, msg);
      await admin.rpc('sponsored_admin_record_refund', { action_id_param: action.action_id, stripe_refund_id_param: null, ok_param: false, error_param: msg });
      return json({ error: 'Stripe did not accept the refund. Nothing was refunded.' }, 502);
    }
    await admin.rpc('sponsored_admin_record_refund', { action_id_param: action.action_id, stripe_refund_id_param: refund.id, ok_param: true, error_param: null });
    return json({ refunded: true, amountCents: action.amount_cents, refundId: refund.id });
  } catch (e) {
    console.error('admin-sponsored-refund error', String(e));
    return json({ error: 'Something went wrong. Nothing was refunded.' }, 500);
  }
});
