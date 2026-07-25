import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const WINDOW_DAYS = 14;
const NOTICE_THRESHOLD = 10;
const ACTIVE_DAYS_THRESHOLD = 5;
const DISMISS_COOLDOWN_DAYS = 7;

function storageKeyFor(userId) {
  return `nearby-confidence-mode-dismissed-${userId}`;
}

// A gentle, caring signal — not a penalty. Two independent, honestly
// distinct reasons this can trigger: heavy outreach with no matches
// (the classic burnout case), or heavy browsing activity with no
// matches at all (analysis-paralysis — someone who keeps looking but
// never acts). Returns which reason fired so the UI can speak to it
// honestly rather than showing one generic message for two different
// situations.
export async function shouldOfferBreak(userId) {
  const dismissedAt = await AsyncStorage.getItem(storageKeyFor(userId));
  if (dismissedAt) {
    const daysSinceDismissed = (Date.now() - new Date(dismissedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDismissed < DISMISS_COOLDOWN_DAYS) return null;
  }

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { count: matchCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .gte('matched_at', windowStart);

  if ((matchCount ?? 0) > 0) return null;

  const { count: noticeCount } = await supabase
    .from('notices')
    .select('id', { count: 'exact', head: true })
    .eq('from_user', userId)
    .gte('created_at', windowStart);

  if ((noticeCount ?? 0) >= NOTICE_THRESHOLD) return 'heavy_outreach';

  const { data: presenceRows } = await supabase
    .from('presence_reports')
    .select('reported_at')
    .eq('user_id', userId)
    .gte('reported_at', windowStart);

  const activeDays = new Set(
    (presenceRows ?? []).map((r) => new Date(r.reported_at).toDateString())
  );

  if (activeDays.size >= ACTIVE_DAYS_THRESHOLD) {
    // Distinguishes "browsing a lot but never reaching out at all"
    // (analysis paralysis) from "reached out a lot with nothing yet"
    // (heavy_outreach) — different situations deserve different words.
    return (noticeCount ?? 0) === 0 ? 'analysis_paralysis' : 'heavy_browsing';
  }

  return null;
}

export async function dismissBreakSuggestion(userId) {
  await AsyncStorage.setItem(storageKeyFor(userId), new Date().toISOString());
}