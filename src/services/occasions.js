// Sep 14 2026 (CLAUDE.md, "global onboarding -> product wiring" master
// plan, Phase H) -- a general consumer Occasions object, additive to the
// already-real, already-live birthday nudge (services/friends.js's
// getUpcomingConnectedBirthdays -- left completely untouched). This
// covers the 5 other real, previously-unbuilt types: anniversary,
// graduation, milestone, life_event, other.
import { supabase } from './supabase';

export async function getMyOccasions() {
  const { data, error } = await supabase
    .from('occasions')
    .select('*')
    .order('occasion_date', { ascending: true });
  if (error) {
    console.error('getMyOccasions error', error);
    return [];
  }
  return data ?? [];
}

export async function addOccasion({ occasionType, title, occasionDate, recursAnnually = true, connectedUserId = null, whoForName = null, whoForFriendId = null }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };
  const { data, error } = await supabase
    .from('occasions')
    .insert({
      user_id: user.id,
      occasion_type: occasionType,
      title,
      occasion_date: occasionDate,
      recurs_annually: recursAnnually,
      connected_user_id: connectedUserId,
      who_for_name: whoForName,
      who_for_friend_id: whoForFriendId,
    })
    .select()
    .single();
  if (error) {
    console.error('addOccasion error', error);
    return { error: error.message };
  }
  return { data };
}

// "Occasion architecture should not be a silo" (CLAUDE.md, direct user
// request): once the wizard's own downstream hand-off actually creates a
// real gathering/business_request, this links the occasion to the real
// `plans` row that object's own existing trigger already created --
// closing the loop so "Nearby remembers... and helps you make it happen"
// is a real, queryable fact, not just a one-way fire-and-forget. Best-
// effort by design (see link_occasion_to_plan's own SQL comment) -- always
// called after the real creation already succeeded, never blocking it.
export async function linkOccasionToPlan({ occasionId, resultingGatheringId = null, resultingBusinessRequestId = null }) {
  const { error } = await supabase.rpc('link_occasion_to_plan', {
    occasion_id_param: occasionId,
    resulting_gathering_id_param: resultingGatheringId,
    resulting_business_request_id_param: resultingBusinessRequestId,
  });
  if (error) console.error('linkOccasionToPlan error', error);
}

// Item 62 (CLAUDE.md): "whether reminders are enabled" is a real per-
// occasion control, not just the blanket notify_social category toggle --
// a plain owner-scoped update (the table's own RLS policy already covers
// UPDATE via "for all"), same posture as delete/add above. Never touches
// any other occasion or preference.
export async function setOccasionReminderEnabled(occasionId, enabled) {
  const { error } = await supabase.from('occasions').update({ reminder_enabled: enabled }).eq('id', occasionId);
  if (error) {
    console.error('setOccasionReminderEnabled error', error);
    return false;
  }
  return true;
}

export async function deleteOccasion(occasionId) {
  const { error } = await supabase.from('occasions').delete().eq('id', occasionId);
  if (error) {
    console.error('deleteOccasion error', error);
    return false;
  }
  return true;
}

// Real, dismissible, days-ahead window -- own occasions plus a real
// connected person's occasion where the caller is genuinely still a
// friend/match (re-checked server-side at read time, not assumed from
// creation time).
export async function getUpcomingOccasions(daysAhead = 30) {
  const { data, error } = await supabase.rpc('get_upcoming_occasions', {
    days_ahead_param: daysAhead,
  });
  if (error) {
    console.error('getUpcomingOccasions error', error);
    return [];
  }
  return data ?? [];
}
