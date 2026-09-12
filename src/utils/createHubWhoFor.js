// Item 64 (CLAUDE.md, direct user request): "The Create flow should
// explicitly ask: Who is this for? Me / A friend / Family / Someone
// else." The user's own framing: this isn't a cosmetic question -- it's
// the difference between Nearby being a tool only for the user's own
// activities and a tool for organizing experiences for the people they
// care about.
//
// CreateHubScreen.js asks this once, up front, using the exact same
// whoFor vocabulary CelebrateSomethingScreen's own who_for step already
// established ('me'/'friend'/'family'/'someone_else') so the two never
// drift. Occasion has full structural support for this already
// (who_for_name/who_for_friend_id, real columns) -- these two pure
// functions cover the two other primary destinations that don't have (and
// don't need) any new schema: a real title/text PREFILL only, always
// fully editable, never auto-submitted. Community is deliberately not
// covered here -- it's a shared, ongoing entity, not something "for" one
// person, and forcing a signal onto it would be exactly the kind of
// fabricated context this app's own conventions warn against.
export function composeWhoForPhrase(whoForName) {
  return whoForName ? `${whoForName}'s` : 'Their';
}

export function buildGatheringQuickStartTitle(whoFor, whoForName) {
  if (!whoFor || whoFor === 'me') return null;
  return `${composeWhoForPhrase(whoForName)} Gathering`;
}

export function buildAskBusinessPrefillText(whoFor, whoForName) {
  if (!whoFor || whoFor === 'me') return null;
  return whoForName ? `Something for ${whoForName}` : 'Something for someone special';
}

export function buildOccasionWhoForParams({ whoFor, whoForName, whoForFriendId }) {
  if (!whoFor) return {};
  return {
    initialWhoFor: whoFor,
    initialWhoForName: whoForName?.trim() || null,
    initialWhoForFriendId: whoFor !== 'me' ? (whoForFriendId ?? null) : null,
  };
}
