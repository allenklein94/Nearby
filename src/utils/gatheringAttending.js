// The attending section's rules (components/GatheringAttendingSection.js, once the separate Gathering Hub screen;
// screen-reduction audit B1, 2026-10-08). Pure, so tests can read them.
import { tr } from '../i18n/translate';

const HOURS_CONSIDERED_OVER = 3;

export function getCountdownLabel(scheduledAt, now = Date.now()) {
  const diffMs = new Date(scheduledAt).getTime() - now;
  if (diffMs > 0) {
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return tr('ui.gatheringHub.startsInMin', { count: mins });
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? tr('ui.gatheringHub.startsInHoursMins', { hours, mins: remMins }) : tr('ui.gatheringHub.startsInHours', { hours });
  }
  const hoursPast = -diffMs / (1000 * 60 * 60);
  if (hoursPast < HOURS_CONSIDERED_OVER) return tr('ui.gatheringHub.happeningNow');
  return null;
}

// Only the host and approved attendees get the day-of block (the Hub's own rule).
export function showsAttendingSection(gathering) {
  return !!gathering && (gathering.isHost === true || gathering.myStatus === 'approved');
}
