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

export async function addOccasion({ occasionType, title, occasionDate, recursAnnually = true, connectedUserId = null }) {
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
    })
    .select()
    .single();
  if (error) {
    console.error('addOccasion error', error);
    return { error: error.message };
  }
  return { data };
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
