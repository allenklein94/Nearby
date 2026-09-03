import { supabase, functionUrl } from './supabase';

// "Intelligent demand inbox" Phase 3 (see CLAUDE.md, Sep 3 2026 section) --
// a real AI-powered fast path on the business apply screen. Takes the
// business owner's own free-text description and returns a real, best-
// effort category/attributes/cuisine/priorityOccasions extraction, every
// field already re-validated server-side against the real, live CHECK-
// constraint vocabularies (business-onboarding-assistant/index.ts) --
// never trusted raw here either. The caller always shows this back for
// the owner to review/edit before it's ever submitted, matching this
// app's already-locked "AI suggests, never silently commits" convention.
export async function classifyBusinessDescription(text) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sign in to use this.');

  const response = await fetch(functionUrl('business-onboarding-assistant'), {
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
