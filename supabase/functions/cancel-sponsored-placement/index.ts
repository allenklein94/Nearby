import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');

// A business cancels its OWN paid Sponsored Spotlight before it starts, for a full refund (owner decision 2026-09-20;
// locked refund policy). The database decides everything: it checks the caller owns the placement, that it is paid and
// has not started, computes the (full) amount, writes the audit row and PAUSES the placement so it cannot be served
// while the refund is in flight. This function only relays that to Stripe; a Stripe failure restores the placement.
// Ending it for good is done by Stripe's charge.refunded event through the verified webhook. Same live-key gate as the
// other sponsored functions (both owner approvals) -- test mode only until then.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const REFUSALS: Record<string, [number, string]> = {
  not_yours: [403, 'That spotlight is not yours.'],
  not_cancellable: [409, 'This spotlight can no longer be cancelled here. Only a paid spotlight that has not started can be.'],
  already_in_flight: [409, 'A cancellation is already in progress.'],
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
    const placementId = typeof body?.placementId === 'string' ? body.placementId : '';
    if (!placementId) return json({ error: 'Choose a spotlight to cancel.' }, 400);

    const asUser = createClient(SUPABASE_URL!, ANON_KEY!, { global: { headers: { Authorization: authHeader } } });
    const { data: rows, error: reqError } = await asUser.rpc('owner_request_sponsored_cancel', { placement_id_param: placementId });
    if (reqError) {
      const code = /sponsored_cancel:(\w+)/.exec(reqError.message || '')?.[1];
      const [status, message] = (code && REFUSALS[code]) || [401, 'Not allowed.'];
      return json({ error: message, code }, status);
    }
    const action = Array.isArray(rows) ? rows[0] : rows;
    if (!action?.action_id) return json({ error: 'Could not start the cancellation.' }, 500);

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
      console.error('cancel-sponsored-placement: Stripe refused', res.status, msg);
      await admin.rpc('sponsored_admin_record_refund', { action_id_param: action.action_id, stripe_refund_id_param: null, ok_param: false, error_param: msg });
      return json({ error: 'The refund could not be sent. Your spotlight is unchanged. Please try again.' }, 502);
    }
    await admin.rpc('sponsored_admin_record_refund', { action_id_param: action.action_id, stripe_refund_id_param: refund.id, ok_param: true, error_param: null });
    return json({ cancelled: true, amountCents: action.amount_cents });
  } catch (e) {
    console.error('cancel-sponsored-placement error', String(e));
    return json({ error: 'Something went wrong. Nothing was changed.' }, 500);
  }
});
