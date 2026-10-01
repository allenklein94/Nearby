import { formatLocalHour } from './timeLabels';
import { tr } from '../i18n/translate';
import { bizCount } from '../i18n/bizFormat';

// The dashboard's "most attended start time" line. It states what it is
// (the start hour whose gatherings drew the most approved attendees), in the
// owner's local clock, with the number of gatherings it rests on -- it never
// says "best-performing" off an unstated sample. null when there is no basis.
export function bestTimeLine(insights) {
  const hour = formatLocalHour(insights?.best_time_sample);
  const n = bizCount(insights?.best_time_gatherings, 'gatherings', 'gathering');
  if (!hour || !n) return null;
  return tr('ui.bizHelp.mostAttendedStart', { hour, n });
}
