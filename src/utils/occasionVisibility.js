// Item 109 (CLAUDE.md, "Security/privacy should be designed in from day one
// ... make the visibility model explicit ... default to the most private
// reasonable setting"): a personal Occasion record is never anything other
// than Private (owner-only) or Shared-with-one-explicitly-picked-person --
// there is no Friends/Public tier for this object, and there never should
// be one (it's a personal note about someone, not a social post). This
// makes that already-true structural fact visible to the user instead of
// leaving it an invisible RLS/RPC rule they just have to trust -- see
// get_upcoming_occasions()'s own real access check, which this mirrors:
// owner, or the one real connected_user_id, and nobody else, ever.
//
// Deliberately does NOT special-case surprise_mode here -- a surprise
// occasion is still exactly "Private" from everyone but the owner (the
// celebrated person structurally can never be connected_user_id while
// surprise_mode is true, per the DB's own CHECK constraint); the existing
// 🔒 surprise indicator already shown elsewhere communicates the surprise
// *intent*, this function communicates who can actually see the record.
export function describeOccasionPrivacy(occasion) {
  if (!occasion) return null;
  if (occasion.connected_user_id) {
    const name = occasion.who_for_name || 'them';
    return { icon: '👤', label: `Shared with ${name}` };
  }
  return { icon: '🔒', label: 'Private' };
}
