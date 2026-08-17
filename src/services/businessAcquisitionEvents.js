import { supabase } from './supabase';

// Business Partner acquisition experience, Milestone 1/2 (see CLAUDE.md). Fire-and-forget,
// matching this codebase's own established non-critical-write philosophy for exactly this
// kind of instrumentation (recordIntentSelection/recordNudgeEvent) — a failed log call never
// blocks or surfaces an error to the real apply flow it's attached to.
export async function logBusinessAcquisitionEvent(sessionId, event, { userId = null, partnerId = null } = {}) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = userId ?? sessionData?.session?.user?.id ?? null;
    await supabase.from('business_acquisition_events').insert({
      session_id: sessionId,
      user_id: myId,
      event,
      partner_id: partnerId,
    });
  } catch (e) {
    console.log('logBusinessAcquisitionEvent failed (non-fatal):', e.message);
  }
}
