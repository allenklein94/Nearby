// Item 46 follow-up (CLAUDE.md, "personalization should determine what
// appears first" -- the "mainly uses Friends should have Friends content
// prioritized" example). Pure, dependency-free decision function --
// same "testable in isolation" shape every other scoring/pattern
// function in this codebase already follows.
//
// A single visit to the other sub-mode used to be able to flip the
// remembered default immediately (discover_last_people_submode in
// AsyncStorage) -- real, but not what "mainly uses" means. This only
// lets real, durable usage counts (profiles.people_submode_dating_uses/
// people_submode_friends_uses, incremented server-side by
// record_people_submode_use()) override that remembered value once
// there's a real, clearly skewed signal -- otherwise it defers to the
// existing last-used/default behavior untouched, matching item 47's
// "don't over-personalize too early" discipline.
const MIN_TOTAL_FOR_SIGNAL = 5;

// Onboarding motivations ("What brought you here today?") are the user's own stated intent, so they
// set the starting sub-mode for someone with no usage and no remembered choice yet: dates-only ->
// dating, friends/activity-only -> friends, anything mixed or absent -> the long-standing dating default.
const DATING_MOTIVATIONS = ['Go on dates'];
const FRIEND_MOTIVATIONS = ['Make new friends', 'Meet new people', 'Find activity partners'];

export function subModeFromMotivations(motivations) {
  const list = Array.isArray(motivations) ? motivations : [];
  const dating = list.some((m) => DATING_MOTIVATIONS.includes(m));
  const friends = list.some((m) => FRIEND_MOTIVATIONS.includes(m));
  if (friends && !dating) return 'friends';
  return 'dating';
}

export function resolveDefaultPeopleSubMode({ datingUses = 0, friendsUses = 0, lastUsedSubMode = null, motivations = null } = {}) {
  const total = datingUses + friendsUses;
  if (total >= MIN_TOTAL_FOR_SIGNAL && datingUses !== friendsUses) {
    return friendsUses > datingUses ? 'friends' : 'dating';
  }
  if (lastUsedSubMode === 'dating' || lastUsedSubMode === 'friends') return lastUsedSubMode;
  return subModeFromMotivations(motivations);
}
