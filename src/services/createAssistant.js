import { supabase, functionUrl } from './supabase';

// The Create Assistant -- a free, unbranded natural-language box on
// CreateHubScreen that classifies what the user's typing into an intent
// plus best-effort prefill fields, routing to the right creation flow.
// Distinct from the premium-gated AI Concierge (services/aiConcierge.js):
// this is never labeled "AI" in the UI and has no premium gate, per the
// user's own call that Premium should sell convenience, not permission to
// use Create at all. No specific date/time extraction -- the user still
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
