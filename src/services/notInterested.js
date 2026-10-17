import { supabase } from './supabase';
import { resetExperienceFeedbackCache } from './experienceFeedback';

// "Not interested" (owner idea "153", utils/notInterested.js): the person's own private word, written only through the three
// owner-scoped RPCs of migration 20270327. The table itself has no client grant; the hide list and the kind words come back
// through get_my_experience_feedback (services/experienceFeedback.js).
//
// Session store: Home and Discover read the server's list once per load; what this device dismissed or undid since then is
// kept here so both surfaces agree at once (a gathering dismissed on Home is not offered again on Discover).
const session = { dismissed: new Map(), undone: new Set() }; // dismissed: gathering id -> its kind (interest_tag)
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export function notInterestedSession() {
  return { dismissed: new Set(session.dismissed.keys()), undone: new Set(session.undone) };
}
export function subscribeNotInterested(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Returns { kindDownRanked } from the server.
export async function dismissRecommendedGathering(gatheringId, interestTag = null) {
  const { data, error } = await supabase.rpc('dismiss_recommended_gathering', { gathering_id_param: gatheringId });
  if (error) throw new Error(error.message);
  resetExperienceFeedbackCache();
  session.undone.delete(gatheringId);
  session.dismissed.set(gatheringId, interestTag);
  notify();
  return { kindDownRanked: !!data?.kind_down_ranked };
}

export async function undoDismissRecommendedGathering(gatheringId) {
  const { error } = await supabase.rpc('undo_dismiss_recommended_gathering', { gathering_id_param: gatheringId });
  if (error) throw new Error(error.message);
  resetExperienceFeedbackCache();
  session.dismissed.delete(gatheringId);
  session.undone.add(gatheringId);
  notify();
}

// Settings -> What Nearby has noticed -> Forget: every Not interested on that kind (its gatherings come back too).
export async function forgetNotInterestedCategory(category) {
  const { error } = await supabase.rpc('forget_my_not_interested_category', { category_param: category });
  if (error) throw new Error(error.message);
  resetExperienceFeedbackCache();
  for (const [id, tag] of session.dismissed) if (tag === category) session.dismissed.delete(id);
  notify();
}

// Clear my activity history removes every Not interested too (server side, clear_my_behavior_history).
export function afterActivityCleared() {
  resetExperienceFeedbackCache();
  session.dismissed.clear();
  notify();
}
