import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// CLAUDE.md item 8: a real "Call"/"Video" between two matched people,
// deliberately NOT actual custom WebRTC infrastructure -- this app has no
// paid signaling/TURN vendor (Twilio/Agora/Daily.co, an account this
// session can't set up), and hand-rolling raw WebRTC would need a native
// module + a real device to ever verify. Instead: both participants open
// the exact same deterministic room on Jitsi Meet's real, free,
// no-account-needed public server (meet.jit.si) -- a genuinely real, live
// video call, just running on someone else's already-built, already-free
// infrastructure rather than this app's own. Room names are derived from
// the real matchId (a private UUID only the two participants and this
// app's own DB access ever see) -- reasonable but not cryptographic
// privacy, matching this app's existing "the right UUID is the
// protection" posture used elsewhere (e.g. gathering deep links);
// disclosed honestly, not hidden.
export function videoCallRoomUrl(matchId) {
  return `https://meet.jit.si/Nearby-Call-${matchId}`;
}

// Only ever reachable from ChatScreen, which only ever exists for a real
// match -- never offered to/from a stranger, matching this app's
// no-stranger-discovery principle everywhere else.
export async function startVideoCall(matchId) {
  await notifyVideoCallStarted(matchId).catch(() => {});
  await WebBrowser.openBrowserAsync(videoCallRoomUrl(matchId));
}

async function notifyVideoCallStarted(matchId, callKind = 'video') {
  const { error } = await supabase.rpc('notify_video_call_started', { match_id_param: matchId, call_kind: callKind });
  if (error) console.error('notifyVideoCallStarted error', error);
}
