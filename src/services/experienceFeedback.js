import { supabase } from './supabase';
import { EMPTY_EXPERIENCE_FEEDBACK, experienceFeedbackFromRow } from '../utils/experienceFeedback';

// Owner item 35: the person's latest "How was it?" word per host / business / kind (get_my_experience_feedback, owner-only,
// auth.uid() inside). Read through utils/experienceFeedback.js by every ranking surface. A failure = no feedback (ranking
// unchanged). Cached 60 s like the learned affinity; cleared when the person answers "How was it?".
let experienceFeedbackCache = null;
export async function getMyExperienceFeedback() {
  if (experienceFeedbackCache && Date.now() - experienceFeedbackCache.at < 60000) return experienceFeedbackCache.value;
  const { data, error } = await supabase.rpc('get_my_experience_feedback');
  if (error) {
    console.error('getMyExperienceFeedback error', error);
    return EMPTY_EXPERIENCE_FEEDBACK;
  }
  const value = experienceFeedbackFromRow(Array.isArray(data) ? data[0] : data);
  experienceFeedbackCache = { at: Date.now(), value };
  return value;
}
export function resetExperienceFeedbackCache() { experienceFeedbackCache = null; }
