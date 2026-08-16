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

// Nearby 2.0 vision layer 7, "Business reliability score as a real
// differentiator" (see CLAUDE.md's "Nearby 2.0 Vision" doc) -- the one
// real gap beyond what already existed: a genuinely comparative,
// per-partner ranking, not just one blended marketplace-wide number.
// Admin-only, same gate as the two functions above. Silent (empty array)
// below the RPC's own real 5-opportunity threshold per partner -- never
// padded with a partner that doesn't have enough real history to rank
// honestly yet.
export async function getMarketplaceReliabilityRankings() {
  const { data, error } = await supabase.rpc('get_marketplace_reliability_rankings');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Nearby 2.0 vision layer 2, "The intent graph / learning system" -- the
// vision doc's own text calls this "the slowest-maturing layer... not a
// build question yet." This is deliberately NOT a trained model or a
// fabricated "understanding" -- it's the real, honest cross-user
// aggregation infrastructure (category x real day/time bucket, across
// every user at once, not just one person's own history) the doc's own
// text describes as the raw material a graph would eventually be built
// from. Silent below a real double threshold (10+ submissions AND 3+
// distinct users per bucket) server-side -- never padded, never shown
// for what could be one person's own repeated submissions mistaken for a
// cross-user pattern.
export async function getCrossUserIntentPatterns() {
  const { data, error } = await supabase.rpc('get_cross_user_intent_patterns');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Closes "no impression/dismissal analytics for either new Home nudge card"
// (V2_ACCEPTANCE_REPORT_2026-08-15.md §10) -- real shown/dismissed/acted
// counts per nudge type, from home_nudge_events (see services/
// intentOutcomes.js's recordNudgeEvent), the one number that would
// actually validate whether either nudge earns its own screen real
// estate. Admin-only, same gate as every other function in this file.
export async function getHomeNudgeStats() {
  const { data, error } = await supabase.rpc('get_home_nudge_stats');
  if (error) throw new Error(error.message);
  return data ?? [];
}
