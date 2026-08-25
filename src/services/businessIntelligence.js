// Business Intelligence & Opportunity Engine, Phase 1 (see CLAUDE.md's own
// plan) -- thin client wrappers over the two new Phase 1 pieces: the
// Attribute Provenance / AI Suggestion / Audit log, and the temporary
// (time-bounded) Business Priority Signal layer. Neither invents a new
// write path -- both are additive to already-existing, already-working
// flows (the deterministic category classifier, Teach Nearby, and the
// existing permanent priority_attributes/priority_time_windows chips).
import { supabase } from './supabase';

// Fire-and-forget by design, matching this codebase's own established
// "secondary, non-fatal write" convention (recordIntentSelection,
// logBusinessAcquisitionEvent, etc.) -- a failed suggestion log must never
// block the real UI flow (the classifier banner, Teach Nearby) it's
// quietly instrumenting. Returns the real suggestion id on success, or
// null on any failure (network, RLS, etc.) so a caller can skip the
// respond-to-it step gracefully rather than call it with a bad id.
export async function recordBusinessAttributeSuggestion(
  partnerId,
  attributeKey,
  attributeValue,
  source,
  reason = null,
  confidence = null
) {
  try {
    const { data, error } = await supabase.rpc('record_business_attribute_suggestion', {
      partner_id_param: partnerId,
      attribute_key_param: attributeKey,
      attribute_value_param: attributeValue,
      source_param: source,
      reason_param: reason,
      confidence_param: confidence,
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('recordBusinessAttributeSuggestion failed', e);
    return null;
  }
}

// Not fire-and-forget -- this is the real approve/reject action a real
// person is explicitly taking, so a failure must surface, not be
// swallowed. suggestionId may be null (e.g. the record call above failed
// silently) -- callers should skip calling this at all in that case, not
// call it with a null id.
export async function respondToBusinessAttributeSuggestion(suggestionId, approved) {
  if (!suggestionId) return;
  const { error } = await supabase.rpc('respond_to_business_attribute_suggestion', {
    suggestion_id_param: suggestionId,
    approved_param: approved,
  });
  if (error) throw error;
}

export async function getBusinessAttributeSuggestions(partnerId, limit = 10) {
  const { data, error } = await supabase
    .from('business_attribute_suggestions')
    .select('id, attribute_key, attribute_value, source, status, reason, created_at, reviewed_at')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function setBusinessPrioritySignal(partnerId, category, strength, expiresAt) {
  const { data, error } = await supabase.rpc('set_business_priority_signal', {
    partner_id_param: partnerId,
    category_param: category,
    strength_param: strength,
    expires_at_param: expiresAt,
  });
  if (error) throw error;
  return data;
}

export async function clearBusinessPrioritySignal(signalId) {
  const { error } = await supabase.rpc('clear_business_priority_signal', {
    signal_id_param: signalId,
  });
  if (error) throw error;
}

export async function getActiveBusinessPrioritySignals(partnerId) {
  const { data, error } = await supabase
    .from('business_priority_signals')
    .select('id, category, strength, expires_at')
    .eq('partner_id', partnerId)
    .eq('active', true)
    .order('expires_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
