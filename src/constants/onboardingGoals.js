// Onboarding step 1 ("What do you want Nearby to help you do?") and step 3 ("What are you looking for?").
// Both are stored in the one existing profiles.onboarding_motivations array (no schema change): goals as their labels, and the
// looking-for choice as the SAME tokens the rest of the app already reads ('Go on dates' / 'Make new friends' drive the starting
// People sub-mode in peopleSubModePreference.js and Friend Discovery opt-in in CompleteProfileScreen), so nothing downstream
// changes and older accounts' labels keep working.
export const ONBOARDING_GOALS = [
  { key: 'meet_people', icon: '👥', label: 'Meet people' },
  { key: 'things_to_do', icon: '🎉', label: 'Find things to do' },
  { key: 'make_plans', icon: '🗓️', label: 'Make plans' },
  { key: 'discover_places', icon: '📍', label: 'Discover places' },
  { key: 'celebrations', icon: '🎂', label: 'Plan celebrations' },
  { key: 'businesses', icon: '🏪', label: 'Find businesses and offers' },
];

export const CELEBRATIONS_GOAL_LABEL = 'Plan celebrations';

export const LOOKING_FOR_OPTIONS = [
  { key: 'dating', icon: '❤️', label: 'Dating', tokens: ['Go on dates'] },
  { key: 'friends', icon: '🤝', label: 'Friends', tokens: ['Make new friends'] },
  { key: 'both', icon: '✨', label: 'Both', tokens: ['Go on dates', 'Make new friends'] },
  { key: 'skip', icon: '⏭️', label: 'Skip for now', tokens: [] },
];

// goals: array of goal labels; lookingFor: a LOOKING_FOR_OPTIONS key or null.
export function motivationsFromAnswers({ goals = [], lookingFor = null } = {}) {
  const tokens = LOOKING_FOR_OPTIONS.find((o) => o.key === lookingFor)?.tokens ?? [];
  return [...new Set([...goals, ...tokens])];
}

// Only someone who said they want to plan celebrations sees the (optional) occasions step at the end.
export function wantsCelebrationsStep(motivations) {
  return Array.isArray(motivations) && motivations.includes(CELEBRATIONS_GOAL_LABEL);
}

// Home reflects the saved goals: one shortcut per goal the user picked, each going to a screen that already exists (no new
// destinations). Shown in the canonical goal order; empty for anyone who picked none (older accounts, or a skipped step), so
// Home is unchanged for them and no placeholder is invented.
const GOAL_DESTINATIONS = {
  'Meet people': { route: 'Discover', params: { initialMode: 'people' }, action: 'Meet someone new' },
  'Find things to do': { route: 'Discover', params: { initialMode: 'things' }, action: 'Find something to do' },
  'Make plans': { route: 'MakeAPlan', params: undefined, action: 'Make a plan' },
  'Discover places': { route: 'Places', params: undefined, action: 'Discover places' },
  'Plan celebrations': { route: 'CelebrateSomething', params: undefined, action: 'Plan a celebration' },
  'Find businesses and offers': { route: 'BrandOffers', params: undefined, action: 'Offers from businesses' },
};

export function goalShortcuts(motivations) {
  if (!Array.isArray(motivations)) return [];
  return ONBOARDING_GOALS
    .filter((g) => motivations.includes(g.label) && GOAL_DESTINATIONS[g.label])
    .map((g) => ({ key: g.key, icon: g.icon, label: GOAL_DESTINATIONS[g.label].action, ...GOAL_DESTINATIONS[g.label] }));
}

// Editing goals later (Settings) changes only the goal labels; the looking-for tokens and any other stored values stay as they are.
const GOAL_LABELS = ONBOARDING_GOALS.map((g) => g.label);
export function motivationsWithGoals(existing, goalLabels) {
  const kept = (Array.isArray(existing) ? existing : []).filter((m) => !GOAL_LABELS.includes(m));
  return [...new Set([...goalLabels.filter((l) => GOAL_LABELS.includes(l)), ...kept])];
}

export function goalLabelsFrom(motivations) {
  return Array.isArray(motivations) ? motivations.filter((m) => GOAL_LABELS.includes(m)) : [];
}
