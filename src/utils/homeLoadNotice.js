// Global rule 7: a failed load is not an empty result. A screen records which sources threw and turns that into one
// honest line, or null when everything loaded.
const HOME_LABELS = {
  people: 'people nearby',
  gatherings: 'nearby gatherings',
  interests: 'your interests',
  interested: 'gatherings you are interested in',
  groupPlans: 'your group plans',
  offers: 'nearby perks',
};

const ACTIVITY_LABELS = {
  people: 'people who crossed paths with you',
  businessUpdates: 'updates from businesses you follow',
  businessActivity: 'business request updates',
};

export function loadNotice(failures, labels, subject) {
  const names = [...new Set(failures ?? [])].map((k) => labels[k]).filter(Boolean);
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Part of ${subject} didn't load (${list}), so what's shown may be incomplete.`;
}

export const homeLoadNotice = (failures) => loadNotice(failures, HOME_LABELS, 'Home');
export const activityLoadNotice = (failures) => loadNotice(failures, ACTIVITY_LABELS, 'Activity');
