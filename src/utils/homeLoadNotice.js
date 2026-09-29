import { tr } from '../i18n/translate';
import { joinAnd } from '../i18n/list';
// Global rule 7: a failed load is not an empty result. A screen records which sources threw and turns that into one
// honest line, or null when everything loaded.
// Parts, subject and sentence are read in the person's language (ui.homeParts.loadNotice); English is unchanged.
const HOME_LABELS = { people: 'people', gatherings: 'gatherings', interests: 'interests', interested: 'interested', groupPlans: 'groupPlans', offers: 'offers' };

const ACTIVITY_LABELS = { people: 'crossedPaths', businessUpdates: 'businessUpdates', businessActivity: 'businessActivity' };

export function loadNotice(failures, labels, subject) {
  const names = [...new Set(failures ?? [])].map((k) => labels[k]).filter(Boolean).map((k) => tr(`ui.homeParts.loadNotice.part.${k}`));
  if (names.length === 0) return null;
  return tr('ui.homeParts.loadNotice.frame', { subject: tr(`ui.homeParts.loadNotice.subject.${subject}`), list: joinAnd(names) });
}

export const homeLoadNotice = (failures) => loadNotice(failures, HOME_LABELS, 'home');
export const activityLoadNotice = (failures) => loadNotice(failures, ACTIVITY_LABELS, 'activity');
