import { supabase } from './supabase';

const FREE_DAILY_VOICE_NOTE_LIMIT = 3;

// Voice notes carry real, ongoing storage and bandwidth cost per
// file, unlike text messages — a reasonable, low-friction place for
// a free-tier limit that doesn't touch actual relationship-building
// (text messaging remains completely unlimited).
export async function checkVoiceNoteLimit(isPremiumUser) {
  if (isPremiumUser) {
    return { allowed: true };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return { allowed: true };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', userId)
    .not('audio_url', 'is', null)
    .gte('created_at', startOfDay.toISOString());

  if (error) {
    console.error('checkVoiceNoteLimit error', error);
    return { allowed: true };
  }

  if ((count ?? 0) >= FREE_DAILY_VOICE_NOTE_LIMIT) {
    return {
      allowed: false,
      reason: `Free accounts get ${FREE_DAILY_VOICE_NOTE_LIMIT} voice notes per day. Upgrade to Premium for unlimited voice notes, or send a text message instead.`,
    };
  }

  return { allowed: true };
}