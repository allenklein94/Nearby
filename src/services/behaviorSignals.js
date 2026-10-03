import { supabase } from './supabase';
import { searchTopic } from '../utils/unifiedSearch';
import { behaviorWeightMap } from '../constants/blendedRanking';
import { computeAccountMaturity } from '../constants/signalSourceMaturity';

// Behavioral signal capture (private, owner-only -- see 20261215_behavior_events.sql). Fire-and-forget: a failure here
// must never affect the screen, and the server dedupes repeat events within an hour.
function sendBehaviorEvent(params) {
  Promise.resolve(supabase.rpc('record_behavior_event', params))
    .then((res) => { if (res?.error) console.error('recordBehaviorEvent error', res.error.message); })
    .catch(() => {});
}

// Item 183 (owner, LOCKED): sensitive categories are never learned. An explicit search may RESOLVE to Faith & Spirituality,
// but no search, view, join, community or redemption in it becomes learned affinity, a ranking signal, a "Based on your
// recent activity" reason or a "What Nearby has noticed" row. Identical to the server's _category_never_learned
// (migration 20270280), which also refuses it; a person can still declare it as their own interest.
export const NEVER_LEARNED_CATEGORIES = Object.freeze(['Faith & Spirituality']);

export function recordBehaviorEvent(eventType, entityType, entityId, category) {
  if (!category || (entityType !== 'search' && !entityId)) return;
  if (NEVER_LEARNED_CATEGORIES.includes(category)) return;
  try {
    const params = { event_type_param: eventType, entity_type_param: entityType, entity_id_param: entityId ?? null, category_param: category };
    if (eventType !== 'join' || entityType !== 'gathering') { sendBehaviorEvent(params); return; }
    // Item 137: a gathering JOIN also sends where the person is right now, so the server can store how far the trip is
    // (miles only; the position is used once and discarded). Never asks for location permission; no fix = no trip.
    Promise.resolve()
      .then(() => require('./userLocation').getUserLocation({ ask: false })) // lazy: keeps expo-location off the other paths
      .catch(() => null)
      .then((l) => {
        const c = l?.coords;
        sendBehaviorEvent(c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
          ? { ...params, origin_lat_param: c.latitude, origin_lng_param: c.longitude } : params);
      });
  } catch {
    // never affects the screen
  }
}

// Owner item 156: the learned affinity a typed ask reads = exactly what Settings > "What Nearby has noticed" lists and Forget /
// Clear history remove (get_my_behavior_categories), plus the account maturity that dampens it. Cached 60 s. Any failure or an
// unknown account age = nothing learned (empty), so a typed ask ranks exactly as before.
let learnedCache = null;
export async function getMyLearnedAffinity() {
  if (learnedCache && Date.now() - learnedCache.at < 60000) return learnedCache.value;
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) return { behavior: {}, maturity: null };
  const [rows, { data: profile }] = await Promise.all([
    getMyBehaviorCategories(),
    supabase.from('profiles').select('created_at').eq('id', uid).single(),
  ]);
  const behavior = behaviorWeightMap(rows);
  const ageDays = profile?.created_at ? (Date.now() - new Date(profile.created_at).getTime()) / 86400000 : null;
  const value = ageDays == null
    ? { behavior: {}, maturity: null }
    : { behavior, maturity: computeAccountMaturity({ accountAgeDays: ageDays, hasBehavioralHistory: Object.keys(behavior).length > 0 }) };
  learnedCache = { at: Date.now(), value };
  return value;
}
export function resetLearnedAffinityCache() { learnedCache = null; }

export async function getMyBehaviorCategories(daysBack = 90) {
  const { data, error } = await supabase.rpc('get_my_behavior_categories', { days_back_param: daysBack });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function clearMyBehaviorHistory() {
  const { error } = await supabase.rpc('clear_my_behavior_history');
  learnedCache = null; // a typed ask right after Clear must not use what was cleared
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
  learnedCache = null; // same for Forget
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

// Undo for "Add to my interests" (item 124): takes back only the tag that tap added. Never used for anything else.
export async function removeAddedInterestFromProfile(tag) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId || !tag) throw new Error('Not signed in.');
  const { data, error } = await supabase.from('profiles').select('interests').eq('id', userId).single();
  if (error) throw new Error(error.message);
  const current = Array.isArray(data?.interests) ? data.interests : [];
  if (!current.includes(tag)) return current;
  const next = current.filter((t) => t !== tag);
  const { error: updateError } = await supabase.from('profiles').update({ interests: next }).eq('id', userId);
  if (updateError) throw new Error(updateError.message);
  return next;
}
