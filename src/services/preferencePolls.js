// Item 100 (CLAUDE.md, "Let the recipient contribute preferences without
// spoiling the surprise") -- see 20261120_who_for_preference_signals.sql
// for the full two-half design (passive profile preferences + active
// disguised-question polls). This file is the client wrapper for both.
import { supabase } from './supabase';

// ---- (A) passive: a person's own standing dining preferences ----
// No RPC needed -- profiles' own existing "Users can update own profile"
// RLS policy already lets a user edit their own row directly, the exact
// same mechanism ProfileScreen.js already uses for `interests`.

export async function updateMyDiningPreferences({ cuisinePreferences, venuePreferences }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('profiles')
    .update({ cuisine_preferences: cuisinePreferences, venue_preferences: venuePreferences })
    .eq('id', user.id);
  if (error) return { error: error.message };
  return { success: true };
}

// ---- (B) active: a real, disguised quick-question poll ----

export async function sendPreferencePoll(targetId, questionKey, occasionContext = null) {
  const { data, error } = await supabase.rpc('send_preference_poll', {
    target_id_param: targetId,
    question_key_param: questionKey,
    occasion_context_param: occasionContext,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function answerPreferencePoll(pollId, answerKeys) {
  const { error } = await supabase.rpc('answer_preference_poll', {
    poll_id_param: pollId,
    answer_keys_param: answerKeys,
  });
  if (error) throw new Error(error.message);
  return { success: true };
}

// Target-facing -- a plain neutral question, never occasion_context (the
// RPC itself never selects that column for this read, see the migration).
export async function getMyPendingPreferencePolls() {
  const { data, error } = await supabase.rpc('get_my_pending_preference_polls');
  if (error) {
    console.error('getMyPendingPreferencePolls error', error);
    return [];
  }
  return data ?? [];
}

// Asker-facing -- occasion_context + answer_keys both visible, since only
// the asker themselves can ever call this for their own sent polls.
export async function getMyAskedPreferencePolls(targetId = null) {
  const { data, error } = await supabase.rpc('get_my_asked_preference_polls', {
    target_id_param: targetId,
  });
  if (error) {
    console.error('getMyAskedPreferencePolls error', error);
    return [];
  }
  return data ?? [];
}

// The real merge point both examples in the item feed into one signal:
// a person's own standing declared preferences (profiles.cuisine_preferences/
// venue_preferences -- already visible to a connected friend via profiles'
// existing RLS policy, the same one ViewProfileScreen already reads
// through) plus any real, already-answered poll for that same person
// (fresher/more specific than a standing declaration, so it's merged in
// rather than treated as a competing source). Best-effort: an unauthenticated
// caller, a stranger with no real connection, or either query failing all
// degrade to an honest empty signal -- this personalizes ranking, it never
// gates or blocks it. Never reveals anything to the person being asked
// about; both reads here are either the caller's own profile-read access
// or the caller's own asker-scoped poll history.
export async function getWhoForPreferenceSignals(whoForFriendId) {
  if (!whoForFriendId) return { cuisineKeys: [], venueKeys: [] };

  const [profileResult, askedResult] = await Promise.allSettled([
    supabase.from('profiles').select('cuisine_preferences, venue_preferences').eq('id', whoForFriendId).maybeSingle(),
    getMyAskedPreferencePolls(whoForFriendId),
  ]);

  const profileRow = profileResult.status === 'fulfilled' ? profileResult.value.data : null;
  const cuisineKeys = new Set(Array.isArray(profileRow?.cuisine_preferences) ? profileRow.cuisine_preferences : []);
  const venueKeys = new Set(Array.isArray(profileRow?.venue_preferences) ? profileRow.venue_preferences : []);

  const askedPolls = askedResult.status === 'fulfilled' ? askedResult.value : [];
  for (const poll of askedPolls) {
    if (!Array.isArray(poll.answerKeys) || poll.answerKeys.length === 0) continue;
    if (poll.questionKey === 'cuisine_mood') poll.answerKeys.forEach((k) => cuisineKeys.add(k));
    if (poll.questionKey === 'venue_vibe') poll.answerKeys.forEach((k) => venueKeys.add(k));
  }

  return { cuisineKeys: Array.from(cuisineKeys), venueKeys: Array.from(venueKeys) };
}
