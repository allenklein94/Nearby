import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export async function createCheckIn({ matchId, matchName, scheduledAt }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('date_checkins')
    .insert({ user_id: userId, match_id: matchId, scheduled_at: scheduledAt, status: 'pending' })
    .select()
    .single();

  if (error) throw error;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'How did your date go?',
      body: `Checking in on your plans with ${matchName}. Let us know you're safe.`,
      data: { type: 'date_checkin', checkinId: data.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(scheduledAt),
    },
  });

  return data;
}

export function buildShareMessage(matchName, scheduledAt) {
  const formatted = new Date(scheduledAt).toLocaleString([], {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return `Hi — quick safety check-in. I'm meeting someone named ${matchName} (from the Nearby app) around ${formatted}. If you don't hear from me a few hours after that, please check in with me.`;
}

export async function respondToCheckIn(checkinId, status) {
  const { error } = await supabase
    .from('date_checkins')
    .update({ status })
    .eq('id', checkinId);
  if (error) throw error;
}

export async function getPendingCheckIns() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('date_checkins')
    .select('*, matches(id, user_a, user_b, a:profiles!matches_user_a_fkey(display_name), b:profiles!matches_user_b_fkey(display_name))')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: false });

  if (error) {
    console.error('getPendingCheckIns error', error);
    return [];
  }
  return data ?? [];
}