// Business Intelligence Phase 8 (see CLAUDE.md's own locked plan): the
// central entitlement service every gated feature reads from. Every
// real enforcement already happens server-side (check_business_
// entitlement(), called from inside the mutating/reading RPCs
// themselves) -- this client layer is purely a UX-decision helper for
// deciding what to render, never the real gate. "Client-side hiding is
// not security," per the plan's own locked rule.

import { supabase } from './supabase';

// Real, human-readable labels for the fixed feature keys seeded in
// plan_entitlements -- shared so every screen renders the identical
// name for the identical feature, never independently re-worded.
export const ENTITLEMENT_FEATURE_LABELS = {
  signature_experiences: 'More Signature Experiences',
  advanced_match_radar: 'Advanced Match Radar',
  missed_match_reporting: 'Missed-Match Reporting',
  category_outcomes: 'Performance by Category',
  ai_offer_recommendations: 'AI Offer Recommendations',
  business_moments: 'Business Moments',
  ai_level_2: 'Routine AI Automation',
  ai_level_3: 'Controlled AI Autopilot',
};

// The real, locked display names for the tier column's own values --
// per direct instruction, the customer-facing product says "Core", not
// "Basic," until pricing is actually finalized. `tier` itself (the real
// brand_partners.tier value) stays 'basic' internally -- only the label
// changes.
export const TIER_DISPLAY_LABELS = {
  basic: 'Core',
  growth: 'Growth',
  brand: 'Brand',
};

export function tierDisplayLabel(tier) {
  return TIER_DISPLAY_LABELS[tier] ?? tier;
}

// Real, owner-scoped read of a business's whole plan -- one round trip
// for every feature, matching this file's own established "fetch once,
// derive everything else client-side" convention.
export async function getBusinessEntitlements(partnerId) {
  const { data, error } = await supabase.rpc('get_business_entitlements', { partner_id_param: partnerId });
  if (error) throw new Error(error.message);
  return data; // { tier, features: { [feature]: { enabled, limit_value } } }
}

// A plain client-side convenience over an already-fetched entitlements
// object -- never trusted as the real gate on its own.
export function hasEntitlement(entitlements, feature) {
  return !!(entitlements?.features?.[feature]?.enabled);
}

export function entitlementLimit(entitlements, feature) {
  return entitlements?.features?.[feature]?.limit_value ?? null;
}

// A real, honest "how close to the cap am I" check -- purely a UX
// convenience (e.g. disabling a "+ Add" button before the server would
// reject it anyway), never a substitute for the real server-side count
// check already inside create_business_experience() and friends.
export function checkLimit(entitlements, feature, currentUsage) {
  const limit = entitlementLimit(entitlements, feature);
  if (limit === null) return { atLimit: false, limit: null };
  return { atLimit: currentUsage >= limit, limit };
}

// Every entitlement-gated RPC this pass built raises one of two real,
// recognizable error shapes -- ENTITLEMENT_LIMIT:<feature> (a hard cap)
// or ENTITLEMENT_REQUIRED:<feature> (the feature isn't on this tier at
// all). Parsed once here so every call site can react the same way,
// matching this codebase's established OFFER_LOCKED-style convention.
// The real, admin-only dev tier switch -- reachable only from the new
// admin screen, never surfaced to a real business. Both RPCs re-check
// is_admin server-side; the client-side gate (SettingsScreen's own
// isAdmin-gated row) is purely a nicety, not the real enforcement.
export async function adminListBusinesses(searchTerm = null) {
  const { data, error } = await supabase.rpc('admin_list_businesses', { search_param: searchTerm || null });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function adminSetBusinessTier(partnerId, tier) {
  const { data, error } = await supabase.rpc('admin_set_business_tier', { partner_id_param: partnerId, tier_param: tier });
  if (error) throw new Error(error.message);
  return data;
}

export function parseEntitlementError(error) {
  const message = error?.message ?? String(error ?? '');
  const limitMatch = message.match(/ENTITLEMENT_LIMIT:([a-z0-9_]+)/i);
  if (limitMatch) return { kind: 'limit', feature: limitMatch[1] };
  const requiredMatch = message.match(/ENTITLEMENT_REQUIRED:([a-z0-9_]+)/i);
  if (requiredMatch) return { kind: 'required', feature: requiredMatch[1] };
  return null;
}
