import { supabase } from './supabase';

export async function unmatch(matchId) {
  const { error } = await supabase.rpc('unmatch', { target_match_id: matchId });
  if (error) throw error;
}
// Phase 8 (CLAUDE.md, Discover visual hierarchy, section G) -- the real
// "matches" half of this app's connected set, deliberately mirroring
// friends.js's own getMyFriends() shape (same user_a/user_b resolution,
// same {id, display_name, photo_url} return, same log-and-return-[] on
// error) so the two halves compose cleanly in connections.js.
//
// This did not exist before: every other caller that needed "my matches"
// inlined its own ad hoc `matches` query (MatchesScreen, ChatScreen,
// ActivityScreen, memoryVault, RelationshipToolsScreen, ...), each
// selecting a different column set for its own screen. This is the one
// minimal, reusable version. The `matches` table has no status column --
// a row existing IS the match (see the baseline schema) -- so there is
// deliberately no status filter here, unlike friendships' 'accepted'.
export async function getMyMatches() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('matches')
    .select('id, user_a, user_b, a:profiles!matches_user_a_fkey(id, display_name, photo_url), b:profiles!matches_user_b_fkey(id, display_name, photo_url)')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);

  if (error) {
    console.error('getMyMatches error', error);
    return [];
  }

  return (data ?? []).map((row) => {
    const other = row.user_a === myId ? row.b : row.a;
    return { matchId: row.id, id: other?.id, display_name: other?.display_name, photo_url: other?.photo_url };
  });
}

// The exact counterpart to friends.js's filterToMyFriends(): given a list
// of user IDs (e.g. the approved attendees of a gathering), returns just
// the ones the current person is genuinely matched with. Never used to
// surface a stranger -- see CLAUDE.md's standing "no stranger discovery"
// rule.
export async function filterToMyMatches(userIds) {
  if (!userIds || userIds.length === 0) return [];
  const matches = await getMyMatches();
  return matches.filter((m) => m.id && userIds.includes(m.id));
}
