import { supabase, functionUrl } from './supabase';

// The Create Assistant -- a free, unbranded natural-language box on
// CreateHubScreen that classifies what the user's typing into an intent
// plus best-effort prefill fields, routing to the right creation flow.
// Never labeled "AI" in the UI and has no premium gate, per the user's
// own call that Premium should sell convenience, not permission to use
// Create at all. The separate premium-gated AI Concierge
// (services/aiConcierge.js, Discover's own natural-language box) was
// removed outright (Aug 14 2026, per the product-critique follow-through
// in CLAUDE.md) -- it was a second, competing "what do you want" resolver
// with a different candidate set and a different gate; Home's own intent
// box (services/intentResolver.js) is now the one canonical entry point.
// No specific date/time extraction -- the user still
// picks that on the gathering wizard's own step. As of the Intent Layer
// plan's Phase 1b, the response also carries a coarse dateWindow bucket
// (today/tonight/tomorrow/weekend/flexible) plus best-effort partySize/
// budgetMax -- all used only to filter which *existing* gatherings/perks
// the Home intent resolver surfaces first, never to create or publish
// anything.
export async function classifyCreateRequest(text) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sign in to use this.');

  const response = await fetch(functionUrl('create-assistant'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.error || "Couldn't process that right now.");
  }
  return result;
}

// Routes a classifyCreateRequest() result to its matching creation screen,
// carrying the caller's own typed text/category forward as a real prefill --
// never auto-submitted, the user always reviews/edits before publishing.
// Factored out here (Aug 27 2026 plan, Decision 5) so Home's own intent-box
// fallback and Discover's "Don't see what you're looking for? Create it ->"
// completion CTA share one routing rule instead of two that could drift.
// An `unclear` classification falls through to CreateGathering with the raw
// typed text as a literal title, matching this app's existing "never a dead
// end" convention for the identical case.
export function routeClassifiedIntentToCreation(navigation, result, typedText) {
  if (result.intent === 'gathering') {
    navigation.navigate('CreateGathering', { quickStartTitle: result.title, quickStartCategory: result.category });
  } else if (result.intent === 'community') {
    navigation.navigate('CreateCommunity', { quickStartTitle: result.title, quickStartCategory: result.category });
  } else if (result.intent === 'business_partner') {
    navigation.navigate('RequestBusinessPartner', { initialBusinessQuery: result.businessName ?? '' });
  } else {
    navigation.navigate('CreateGathering', { quickStartTitle: typedText, quickStartCategory: null });
  }
}
