import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const WINDOW_DAYS = 14;
const NOTICE_THRESHOLD = 10;
const DISMISS_COOLDOWN_DAYS = 7;

function storageKeyFor(userId) {
  return `nearby-confidence-mode-dismissed-${userId}`;
}

export async function shouldOfferBreak(userId) {
  const dismissedAt = await AsyncStorage.getItem(storageKeyFor(userId));
  if (dismissedAt) {
    const daysSinceDismissed = (Date.now() - new Date(dismissedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDismissed < DISMISS_COOLDOWN_DAYS) return false;
  }

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { count: noticeCount } = await supabase
    .from('notices')
    .select('id', { count: 'exact', head: true })
    .eq('from_user', userId)
    .gte('created_at', windowStart);

  if ((noticeCount ?? 0) < NOTICE_THRESHOLD) return false;

  const { count: matchCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .gte('matched_at', windowStart);

  return (matchCount ?? 0) === 0;
}

export async function dismissBreakSuggestion(userId) {
  await AsyncStorage.setItem(storageKeyFor(userId), new Date().toISOString());
}