// Global rule 7: a failed load is not an empty result. Home's dashboard records which sources threw
// (`dashboard.loadFailures`); this turns that into one honest line, or null when everything loaded.
const LABELS = {
  people: 'people nearby',
  gatherings: 'nearby gatherings',
  interests: 'your interests',
  interested: 'gatherings you are interested in',
  groupPlans: 'your group plans',
};

export function homeLoadNotice(failures) {
  const names = [...new Set(failures ?? [])].map((k) => LABELS[k]).filter(Boolean);
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Part of Home didn't load (${list}), so what's shown may be incomplete.`;
}
