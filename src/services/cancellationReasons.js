import { supabase } from './supabase';

// Best-effort by design: the cancel already happened, so a failure here must never surface as an error.
export async function setCancellationReason(entityType, entityId, reason) {
  try {
    const { data, error } = await supabase.rpc('set_cancellation_reason', {
      entity_type_param: entityType, entity_id_param: entityId, reason_param: reason,
    });
    if (error) console.error('setCancellationReason error', error);
    return !error && data === true;
  } catch (e) {
    console.error('setCancellationReason failed', e);
    return false;
  }
}

export async function getPartnerCancellationPatterns(partnerId, daysBack = 30) {
  const { data, error } = await supabase.rpc('get_partner_cancellation_patterns', {
    partner_id_param: partnerId, days_back_param: daysBack,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}
