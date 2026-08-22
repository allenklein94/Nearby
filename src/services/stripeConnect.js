import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { supabase, functionUrl } from './supabase';

// Real Stripe Connect client wiring — closes step 1 of the 2026-08-27
// locked Decision 2 in CLAUDE.md (direct charges, business is merchant of
// record, Nearby never custodies consumer funds). Every function here is
// real and callable today, but genuinely inert until a real
// STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET/publishable key exist — the two
// Edge Functions this calls both 503 honestly when the platform key isn't
// configured (see business-stripe-connect-onboarding/index.ts).

export const STRIPE_PUBLISHABLE_KEY = Constants.expoConfig?.extra?.stripePublishableKey || '';

// Whether a real, usable Stripe publishable key has actually been
// configured yet — gates whether the payment-collection UI can even
// attempt to initialize the Stripe SDK, so an unconfigured platform never
// shows a broken "Pay" button.
export function isStripeConfigured() {
  return !!STRIPE_PUBLISHABLE_KEY;
}

async function callFunction(name, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(functionUrl(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error || 'Something went wrong.');
  }
  return json;
}

// Real Connect account status for the caller's own managed business —
// every field here is a plain, already-fetched column on brand_partners
// (20260827_stripe_connect_seams.sql), not a fresh Stripe API call, so
// this is cheap enough to call on every Business Dashboard load.
export async function getMyStripeConnectStatus() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('managed_partner_id')
    .eq('id', userId)
    .single();
  if (!profile?.managed_partner_id) return null;

  const { data: partner } = await supabase
    .from('brand_partners')
    .select(
      'id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_requirements_due'
    )
    .eq('id', profile.managed_partner_id)
    .single();
  if (!partner) return null;

  return {
    partnerId: partner.id,
    hasAccount: !!partner.stripe_account_id,
    chargesEnabled: !!partner.stripe_charges_enabled,
    payoutsEnabled: !!partner.stripe_payouts_enabled,
    detailsSubmitted: !!partner.stripe_details_submitted,
    requirementsDue: partner.stripe_requirements_due || [],
  };
}

// Opens Stripe's real hosted onboarding flow in an in-app browser session,
// then re-fetches real Connect status once the browser session closes —
// no deep-link route is needed for the return, since the caller is
// already signed in and already on their own dashboard (see the
// business-stripe-connect-onboarding function's own comment).
export async function startStripeOnboarding() {
  const { url } = await callFunction('business-stripe-connect-onboarding');
  await WebBrowser.openAuthSessionAsync(url, 'nearby://business-stripe-return');
  return getMyStripeConnectStatus();
}

// Creates (or, on a safe retry, re-fetches) a real Stripe PaymentIntent for
// an offer that was just accepted with paymentRequired: true. Returns the
// real client_secret + connected account id the Stripe SDK needs to
// confirm payment against — never persisted client-side beyond this call.
export async function createBusinessPaymentIntent(offerId) {
  return callFunction('create-business-payment-intent', { offerId });
}
