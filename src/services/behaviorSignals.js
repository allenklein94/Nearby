import { supabase } from './supabase';
import { searchTopic } from '../utils/unifiedSearch';

// Behavioral signal capture (private, owner-only -- see 20261215_behavior_events.sql). Fire-and-forget: a failure here
// must never affect the screen, and the server dedupes repeat events within an hour.
export function recordBehaviorEvent(eventType, entityType, entityId, category) {
  if (!category || (entityType !== 'search' && !entityId)) return;
  try {
    Promise.resolve(supabase.rpc('record_behavior_event', { event_type_param: eventType, entity_type_param: entityType, entity_id_param: entityId ?? null, category_param: category }))
      .then((res) => { if (res?.error) console.error('recordBehaviorEvent error', res.error.message); })
      .catch(() => {});
  } catch {
    // never affects the screen
  }
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

// Item 95: a search counts toward an affinity only when its words name ONE canonical category (deterministic, the same
// resolver search uses). Only the category is stored, never the words; groups and cuisines are not learned from a search.
export function recordSearchBehavior(text) {
  const topic = searchTopic(text);
  if (topic?.kind !== 'tag') return;
  recordBehaviorEvent('search', 'search', null, topic.tags[0]);
}

// An accepted business offer: the request's own category (canonical by constraint), a deliberate act.
export function recordAcceptBehavior(requestId, category) {
  recordBehaviorEvent('accept', 'business_request', requestId, category);
}

export async function forgetBehaviorCategory(category) {
  const { error } = await supabase.rpc('forget_my_behavior_category', { category_param: category });
  if (error) throw new Error(error.message);
}

// The ONLY way a learned affinity becomes a visible profile interest: the person taps "Add to my interests" in Settings.
// Nothing calls this automatically (guarded by a test).
export async function addLearnedInterestToProfile(tag) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId || !tag) throw new Error('Not signed in.');
  const { data, error } = await supabase.from('profiles').select('interests').eq('id', userId).single();
  if (error) throw new Error(error.message);
  const current = Array.isArray(data?.interests) ? data.interests : [];
  if (current.includes(tag)) return current;
  const next = [...current, tag];
  const { error: updateError } = await supabase.from('profiles').update({ interests: next }).eq('id', userId);
  if (updateError) throw new Error(updateError.message);
  return next;
}
