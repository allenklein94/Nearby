import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');

// Real Stripe Connect onboarding-link creation — closes step 1 of the
// 2026-08-27 locked Decision 2 in CLAUDE.md (direct charges, business is
// merchant of record). A business owner taps "Connect Stripe" on their
// dashboard; this creates (or reuses) their real Express account and hands
// back a real, one-time onboarding URL for the client to open in a browser
// (WebBrowser.openAuthSessionAsync). No live STRIPE_SECRET_KEY exists in
// this project yet (confirmed directly via the Management API's secrets
// list before writing this) — every real call here will honestly 503 until
// one is configured, matching this codebase's own established
// "inert seam, lights up once real keys exist" convention.

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

async function stripeRequest(path: string, params?: Record<string, unknown>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? toFormParams(params).join('&') : undefined,
  });
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

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: profile } = await admin
      .from('profiles')
      .select('managed_partner_id')
      .eq('id', myId)
      .single();
    const partnerId = profile?.managed_partner_id;
    if (!partnerId) {
      return new Response(JSON.stringify({ error: 'You do not manage a business.' }), { status: 403 });
    }

    const { data: partner } = await admin
      .from('brand_partners')
      .select('id, name, stripe_account_id')
      .eq('id', partnerId)
      .single();
    if (!partner) {
      return new Response(JSON.stringify({ error: 'Business not found.' }), { status: 404 });
    }

    let accountId = partner.stripe_account_id;
    if (!accountId) {
      const account = await stripeRequest('accounts', {
        type: 'express',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { name: partner.name || undefined },
      });
      accountId = account.id;
      await admin
        .from('brand_partners')
        .update({ stripe_account_id: accountId, stripe_account_created_at: new Date().toISOString() })
        .eq('id', partnerId);
    }

    // Both URLs land on the same in-app deep link — the client opens this
    // whole flow via WebBrowser.openAuthSessionAsync and just re-fetches
    // real Connect status the moment that browser session closes, rather
    // than needing a NavigationContainer linking.config entry (unlike the
    // gathering/business-profile deep links, nothing here needs to resolve
    // to a *different* screen depending on the tap — the caller is already
    // signed in, already on their own dashboard, mid-flow).
    const accountLink = await stripeRequest('account_links', {
      account: accountId,
      refresh_url: 'nearby://business-stripe-return?status=refresh',
      return_url: 'nearby://business-stripe-return?status=complete',
      type: 'account_onboarding',
    });

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('business-stripe-connect-onboarding error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Something went wrong.' }), { status: 500 });
  }
});
