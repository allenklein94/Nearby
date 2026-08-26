// Business Intelligence Phase 6 (see CLAUDE.md's own locked plan, Steps
// 2-3): thin client wrappers over the real AI Trust Engine RPCs. Every
// real enforcement happens server-side (the entitlement checks inside
// set_business_ai_trust_level()/upsert_business_ai_policy(), the
// ownership checks inside every RPC here) -- this layer is purely a
// convenience/UX-decision helper, matching services/entitlements.js's own
// established "client-side hiding is not security" posture.
import { supabase } from './supabase';

// A real, human-readable label per fixed action_type value -- the only
// one this pass builds is 'auto_respond_offer', but this stays a real
// lookup (not an inline string) so a future action_type doesn't need a
// second place to add its label.
export const AI_ACTION_TYPE_LABELS = {
  auto_apply_attribute_suggestion: 'Auto-applied a suggested profile detail',
  auto_respond_offer: 'Auto-sent an offer',
};

// Real, human-readable copy per fixed "blocked" reason -- mirrors the
// established MISSED_MATCH_REASON_LABELS convention (businessFulfillment.js)
// rather than showing a raw enum value.
export const AI_BLOCKED_REASON_LABELS = {
  category_mismatch: "The request's category didn't match this policy.",
  party_size_out_of_range: "The party size was larger than this policy allows.",
  hours_mismatch: "The request fell outside this policy's active hours.",
  experience_inactive: 'The linked offer template is no longer active.',
};

export async function getBusinessAiTrustLevel(partnerId) {
  const { data, error } = await supabase
    .from('brand_partners')
    .select('ai_trust_level')
    .eq('id', partnerId)
    .single();
  if (error) throw new Error(error.message);
  return data?.ai_trust_level ?? 0;
}

export async function setBusinessAiTrustLevel(partnerId, level) {
  const { error } = await supabase.rpc('set_business_ai_trust_level', {
    partner_id_param: partnerId,
    level_param: level,
  });
  if (error) throw new Error(error.message);
}

export async function getBusinessAiPolicies(partnerId) {
  const { data, error } = await supabase
    .from('business_ai_policies')
    .select('*')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function upsertBusinessAiPolicy(policyId, partnerId, { name, trustLevel, actionType = 'auto_respond_offer', conditions, enabled = true }) {
  const { data, error } = await supabase.rpc('upsert_business_ai_policy', {
    policy_id_param: policyId ?? null,
    partner_id_param: partnerId,
    name_param: name,
    trust_level_param: trustLevel,
    action_type_param: actionType,
    conditions_param: conditions,
    enabled_param: enabled,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteBusinessAiPolicy(policyId) {
  const { error } = await supabase.rpc('delete_business_ai_policy', { policy_id_param: policyId });
  if (error) throw new Error(error.message);
}

// The real, immutable AI Activity Log -- spec item 28 made visible,
// same "the actual audit log made visible, not just a backend table
// nothing shows" precedent as the existing "🕓 Recent AI Suggestions"
// list built in an earlier pass. RLS already scopes this to the real
// owner's own partner_id; this is a thin, capped read.
//
// Also resolves, for every real auto_respond_offer row, the real live
// status of the specific business_request_offers row it created --
// there's no offer_id column on ai_actions (the schema's own locked
// input_ref/actual_action jsonb shape doesn't carry one), but
// (request_id, partner_id) is the same real uniqueness the underlying
// upsert already relies on, so one batched follow-up query resolves it
// honestly rather than adding a new column for this. This is what lets
// the UI offer a real "Withdraw Offer" action only while the offer is
// still genuinely 'offered' -- the actual mitigation path for a bad
// auto-response, not a fake second undo.
export async function getAiActivityLog(partnerId, limit = 50) {
  const { data, error } = await supabase
    .from('ai_actions')
    .select('*')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const requestIds = [...new Set(
    rows
      .filter((r) => r.action_type === 'auto_respond_offer' && r.input_ref?.request_id)
      .map((r) => r.input_ref.request_id)
  )];

  if (requestIds.length === 0) return rows;

  const { data: offers, error: offersError } = await supabase
    .from('business_request_offers')
    .select('id, request_id, status')
    .eq('partner_id', partnerId)
    .in('request_id', requestIds);
  if (offersError) {
    // Non-fatal -- the activity log itself already loaded; the row just
    // won't get a real Withdraw action offered this pass.
    console.error('getAiActivityLog: offer lookup failed', offersError);
    return rows;
  }

  const offerByRequest = new Map((offers ?? []).map((o) => [o.request_id, o]));
  return rows.map((r) => {
    if (r.action_type !== 'auto_respond_offer' || !r.input_ref?.request_id) return r;
    const offer = offerByRequest.get(r.input_ref.request_id);
    return offer ? { ...r, offerId: offer.id, offerStatus: offer.status } : r;
  });
}

// The one reversible action type this pass adds -- see undo_ai_action()'s
// own real, deliberately narrow rollback scope. auto_respond_offer is
// never undoable here; its own real mitigation is the already-existing
// withdrawBusinessOffer() (services/businessFulfillment.js), surfaced
// directly from the Activity Log row instead of a fake second undo.
export async function undoAiAction(actionId) {
  const { data, error } = await supabase.rpc('undo_ai_action', { action_id_param: actionId });
  if (error) throw new Error(error.message);
  return data;
}
