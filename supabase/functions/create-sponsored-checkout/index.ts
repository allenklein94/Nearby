import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
import { classifyContent } from '../_shared/contentClassifier.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');

// Sponsored Spotlight checkout (item 44, phase 2). Nearby is the merchant and the business is the CUSTOMER: a one-time
// Stripe-hosted Checkout Session on the PLATFORM account (not the Connect flow used for consumer payments). Nearby never
// sees card data. The price comes from the database (sponsored_price), never from the client. Nothing here can mark a
// placement paid: only the signature-verified sponsored-stripe-webhook does that.
//
// TEST MODE ONLY until the owner approves live. A live key is refused unless BOTH secrets are set by the owner:
// STRIPE_LIVE_APPROVED (the existing money gate) and SPONSORED_LEGAL_REVIEW_COMPLETE (the advertising-disclosure /
// legal review recorded as done). No code path sets either.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const PROBLEMS: Record<string, [number, string]> = {
  not_a_business_owner: [403, 'Only a business owner can buy a spotlight.'],
  business_inactive: [409, 'Your business is not active yet.'],
  needs_address: [409, 'Add your business address before buying a spotlight.'],
  category_not_sponsorable: [409, "Spotlights aren't available for your category yet."],
  bad_start: [422, 'Pick a start date from tomorrow up to 60 days ahead.'],
  already_holding: [409, 'You already have a spotlight booked or in checkout.'],
  slot_taken: [409, 'That week is already taken in your area for your category. Try another start date.'],
  bad_item: [422, 'That item cannot be promoted.'],
  terms_not_accepted: [422, 'Please accept the current spotlight terms to continue.'],
  screening_not_clean: [422, "We can't run that text as an ad. Please edit it and try again."],
};

function toFormParams(obj: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') parts.push(...toFormParams(value as Record<string, unknown>, k));
    else parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`);
  }
  return parts;
}

serve(async (req) => {
  try {
    if (!STRIPE_SECRET_KEY) return json({ error: "Payments aren't set up yet. Check back soon." }, 503);
    if (/^(sk|rk)_live_/.test(STRIPE_SECRET_KEY)
        && (Deno.env.get('STRIPE_LIVE_APPROVED') !== 'true' || Deno.env.get('SPONSORED_LEGAL_REVIEW_COMPLETE') !== 'true')) {
      return json({ error: "Live payments aren't approved yet. Check back soon." }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth' }, 401);
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: userData, error: userError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !userData?.user) return json({ error: 'Invalid session' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const itemKind = body?.itemKind === 'offer' ? 'offer' : body?.itemKind === 'business' ? 'business' : null;
    const itemId = typeof body?.itemId === 'string' ? body.itemId : null;
    const startDate = typeof body?.startDate === 'string' ? body.startDate : '';
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    // Acceptance is explicit (a ticked box, not a default) and is recorded against the terms version the person saw.
    const termsVersion = typeof body?.termsVersion === 'string' ? body.termsVersion : '';
    if (body?.acceptedTerms !== true || !termsVersion) return json({ error: PROBLEMS.terms_not_accepted[1], code: 'terms_not_accepted' }, 422);
    if (!itemKind || (itemKind === 'offer' && !itemId)) return json({ error: 'Choose what to promote.' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return json({ error: PROBLEMS.bad_start[1] }, 422);
    const startsAt = new Date(`${startDate}T00:00:00Z`);
    if (Number.isNaN(startsAt.getTime()) || startsAt.toISOString().slice(0, 10) !== startDate) return json({ error: PROBLEMS.bad_start[1] }, 422);
    if (title.length < 1 || title.length > 80) return json({ error: 'The headline must be 1 to 80 characters.' }, 422);
    if (description.length > 200) return json({ error: 'The description can be at most 200 characters.' }, 422);

    // Eligibility + availability BEFORE spending a screening call (as the caller, so ownership comes from their session).
    const asUser = createClient(SUPABASE_URL!, ANON_KEY!, { global: { headers: { Authorization: authHeader } } });
    const { data: check, error: checkError } = await asUser.rpc('check_my_sponsored_slot', { starts_param: startsAt.toISOString() });
    if (checkError) return json({ error: 'Could not check availability. Please try again.' }, 500);
    if (!check?.ok) {
      const [status, message] = PROBLEMS[check?.problem] ?? [409, 'A spotlight is not available right now.'];
      return json({ error: message, code: check?.problem }, status);
    }

    // The ad text is owner-typed, so it is screened like any other owner content. A screening SERVICE failure fails closed.
    const result = await classifyContent(
      `A local business wants to show this as a paid "Sponsored" card to people browsing nearby.\nHeadline: ${title}\nDescription: ${description || '(none)'}`
    );
    if (!result) return json({ error: "We couldn't review this right now. Please try again in a bit.", code: 'screening_unavailable' }, 503);
    if (result.riskTier !== 'low') return json({ error: PROBLEMS.screening_not_clean[1], code: 'screening_not_clean' }, 422);

    const { data: begun, error: beginError } = await admin.rpc('sponsored_begin_purchase', {
      user_id_param: userId, item_kind_param: itemKind, item_id_param: itemId, starts_param: startsAt.toISOString(),
      title_param: title, description_param: description || null, screening_tier_param: 'low', terms_version_param: termsVersion,
    });
    if (beginError) {
      const code = /sponsored:(\w+)/.exec(beginError.message || '')?.[1];
      const [status, message] = (code && PROBLEMS[code]) || [500, 'Could not start the purchase. Please try again.'];
      return json({ error: message, code }, status);
    }
    const purchase = Array.isArray(begun) ? begun[0] : begun;

    const webBase = (Deno.env.get('BUSINESS_WEB_URL') || 'https://allenklein94.github.io/Nearby/business/').replace(/\/?$/, '/');
    const params = {
      mode: 'payment',
      client_reference_id: purchase.payment_id,
      success_url: `${webBase}?sponsored=success`,
      cancel_url: `${webBase}?sponsored=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60 + 60,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: purchase.currency,
          unit_amount: purchase.amount_cents,
          product_data: {
            name: 'Nearby Sponsored Spotlight (7 days)',
            description: `Starts ${startDate}. Shown in Perks and Places browse and always labeled Sponsored.`,
          },
        },
      }],
      metadata: { payment_id: purchase.payment_id, placement_id: purchase.placement_id },
      payment_intent_data: { metadata: { payment_id: purchase.payment_id, placement_id: purchase.placement_id } },
    };
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `sponsored-${purchase.payment_id}`,
      },
      body: toFormParams(params).join('&'),
    });
    const session = await res.json().catch(() => null);
    if (!res.ok || !session?.id || !session?.url) {
      console.error('create-sponsored-checkout: Stripe session failed', res.status, session?.error?.message);
      await admin.rpc('sponsored_release_hold', { payment_id_param: purchase.payment_id });
      return json({ error: "We couldn't start checkout. You have not been charged. Please try again." }, 502);
    }
    await admin.rpc('sponsored_attach_checkout_session', { payment_id_param: purchase.payment_id, session_id_param: session.id });
    return json({ url: session.url, expiresAt: session.expires_at ?? null });
  } catch (e) {
    console.error('create-sponsored-checkout error', String(e));
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
