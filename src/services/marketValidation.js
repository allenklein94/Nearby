// 10/10 roadmap Part 9 (see CLAUDE.md's "10/10 roadmap" plan): market
// validation dashboard. Both RPCs are admin-only (check_is_admin(auth.uid())
// gated server-side) -- these thin wrappers don't re-check admin status
// client-side, since the RPC itself is the real gate; a non-admin caller
// gets a real rejected promise, not a fabricated empty result.
import { supabase } from './supabase';

// Part 2's funnel stats (submission volume, % with a result, % reaching
// business fallback, % of results tapped through, % positive outcome,
// 30-day repeat-submission rate) -- built then, never rendered anywhere
// until now.
export async function getIntentFunnelStats() {
  const { data, error } = await supabase.rpc('get_intent_funnel_stats');
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

// Real 7/30-day return rate (from intent_submissions, the one real
// cross-session activity signal this app has) plus a marketplace-wide
// partner reliability rollup (response/acceptance/completion rate across
// every business's own business_request_offers rows, not just one).
export async function getMarketValidationStats() {
  const { data, error } = await supabase.rpc('get_market_validation_stats');
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}
