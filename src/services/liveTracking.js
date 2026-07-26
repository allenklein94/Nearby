import { supabase } from './supabase';

const GITHUB_PAGES_BASE = 'https://allenklein94.github.io/Nearby';

// A time-limited, revocable live location share for a specific date
// or meetup — genuinely different from Crossed Paths' coarse,
// rounded proximity detection. This shares real coordinates, so it's
// strictly user-initiated, has a real enforced expiration, and can
// be stopped by the sharer at any moment. The viewing link works for
// anyone (a trusted contact doesn't need the Nearby app at all).
export async function startLiveTracking(durationHours = 3) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Not signed in');

  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('live_tracking_sessions')
    .insert({ user_id: userId, expires_at: expiresAt.toISOString() })
    .select()
    .single();

  if (error) throw error;

  return {
    sessionId: data.id,
    shareUrl: `${GITHUB_PAGES_BASE}/track.html?session=${data.id}`,
    expiresAt,
  };
}

export async function stopLiveTracking(sessionId) {
  const { error } = await supabase
    .from('live_tracking_sessions')
    .update({ active: false })
    .eq('id', sessionId);
  if (error) throw error;
}

export async function getMyActiveLiveTrackingSession() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('live_tracking_sessions')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error('getMyActiveLiveTrackingSession error', error);
    return null;
  }
  return data;
}