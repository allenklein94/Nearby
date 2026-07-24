import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const WINDOW_DAYS = 14;
const NOTICE_THRESHOLD = 10;
const ACTIVE_DAYS_THRESHOLD = 5;
const DISMISS_COOLDOWN_DAYS = 7;

function storageKeyFor(userId) {
  return `nearby-confidence-mode-dismissed-${userId}`;
}

// A gentle, caring signal — not a penalty. If someone has reached out
// to a lot of people recently with no mutual match, that's genuinely
// discouraging, and this exists purely to offer a pause, never to
// restrict or punish. It only checks, never nags: once dismissed, it
// stays quiet for a full week regardless of what happens next.
//
// Two independent signals now, either of which can trigger this:
// heavy outreach with no matches (original), or heavy browsing
// activity with no matches (new) — someone opening the app day after
// day without a single match is a genuinely different, and arguably
// more discouraging, pattern than someone sending lots of Notices.
export async function shouldOfferBreak(userId) {
  const dismissedAt = await AsyncStorage.getItem(storageKeyFor(userId));
  if (dismissedAt) {
    const daysSinceDismissed = (Date.now() - new Date(dismissedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDismissed < DISMISS_COOLDOWN_DAYS) return false;
  }

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { count: matchCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .gte('matched_at', windowStart);

  if ((matchCount ?? 0) > 0) return false;

  const { count: noticeCount } = await supabase
    .from('notices')
    .select('id', { count: 'exact', head: true })
    .eq('from_user', userId)
    .gte('created_at', windowStart);

  if ((noticeCount ?? 0) >= NOTICE_THRESHOLD) return true;

  const { data: presenceRows } = await supabase
    .from('presence_reports')
    .select('reported_at')
    .eq('user_id', userId)
    .gte('reported_at', windowStart);

  const activeDays = new Set(
    (presenceRows ?? []).map((r) => new Date(r.reported_at).toDateString())
  );

  return activeDays.size >= ACTIVE_DAYS_THRESHOLD;
}

export async function dismissBreakSuggestion(userId) {
  await AsyncStorage.setItem(storageKeyFor(userId), new Date().toISOString());
}