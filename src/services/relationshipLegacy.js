import { supabase } from './supabase';

export async function submitLegacyEntry(matchId, entry) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('relationship_legacy_entries')
    .insert({
      match_id: matchId,
      submitted_by: userId,
      what_surprised_us: entry.whatSurprisedUs || null,
      what_almost_ended_us: entry.whatAlmostEndedUs || null,
      what_made_us_stronger: entry.whatMadeUsStronger || null,
      what_we_wish_we_discussed_earlier: entry.whatWeWishWeDiscussedEarlier || null,
    });

  if (error) throw error;
}

export async function getLegacyEntries(limit = 30) {
  const { data, error } = await supabase
    .from('relationship_legacy_entries')
    .select('id, what_surprised_us, what_almost_ended_us, what_made_us_stronger, what_we_wish_we_discussed_earlier, created_at')
    .limit(limit);

  if (error) {
    console.error('getLegacyEntries error', error);
    return [];
  }

  return (data ?? []).sort(() => Math.random() - 0.5);
}