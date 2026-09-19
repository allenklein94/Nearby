import { supabase } from './supabase';

// Behavioral signal capture (private, owner-only -- see 20261215_behavior_events.sql). Fire-and-forget: a failure here
// must never affect the screen, and the server dedupes repeat events within an hour.
export function recordBehaviorEvent(eventType, entityType, entityId, category) {
  if (!entityId || !category) return;
  supabase
    .rpc('record_behavior_event', { event_type_param: eventType, entity_type_param: entityType, entity_id_param: entityId, category_param: category })
    .then(({ error }) => { if (error) console.error('recordBehaviorEvent error', error.message); })
    .catch(() => {});
}

export async function getMyBehaviorCategories(daysBack = 90) {
  const { data, error } = await supabase.rpc('get_my_behavior_categories', { days_back_param: daysBack });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function clearMyBehaviorHistory() {
  const { error } = await supabase.rpc('clear_my_behavior_history');
  if (error) throw new Error(error.message);
}
