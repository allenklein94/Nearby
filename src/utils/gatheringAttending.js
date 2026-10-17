// The attending section's rules (components/GatheringAttendingSection.js, once the separate Gathering Hub screen;
// screen-reduction audit B1, 2026-10-08). Pure, so tests can read them.
import { tr } from '../i18n/translate';
import { timeWindowParts } from './timeWindow';
import { isGatheringOver, checkInWindowState } from './gatheringCompletion';

// The section's countdown line. WHICH phase comes only from the one temporal engine (timeWindowParts: over at start + the
// host's duration, else start + 30 min), the same rule as Home's Completed (item 34) and the check-in window; this only words
// the time left before the start. Never "Happening now" once the gathering has ended (it used to say so for a fixed 3 h).
export function getCountdownLabel(gathering, now = Date.now()) {
  if (!gathering?.scheduled_at) return null;
  const p = timeWindowParts({ start: gathering.scheduled_at, durationMinutes: gathering.duration_minutes ?? null }, new Date(now), 'event');
  if (p.phase === 'live' || p.phase === 'ending_soon') return tr('ui.gatheringHub.happeningNow');
  if (p.phase !== 'upcoming') return null;
  const mins = Math.round((p.startMs - p.nowMs) / 60000);
  if (mins < 60) return tr('ui.gatheringHub.startsInMin', { count: mins });
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? tr('ui.gatheringHub.startsInHoursMins', { hours, mins: remMins }) : tr('ui.gatheringHub.startsInHours', { hours });
}

// What the attending section shows at `now`, from the one end rule (owner, 2026-10-17, LOCKED: the end is exclusive):
//   showHaveFun  checked in and not over ("Have fun! We'll see you afterwards" + who's here); gone AT the end
//   showOnMyWay  a guest (not the host), not over, not already in the Have-fun panel ("I'm on my way")
//   showCheckIn  as showOnMyWay AND inside the check-in window [start - 30 min, end) ("I'm here — check in")
export function attendingDayOf(gathering, now = new Date()) {
  const isOver = isGatheringOver(gathering, now);
  const showHaveFun = !!gathering?.myAttendee?.checked_in_at && !isOver;
  const showOnMyWay = !!gathering && !gathering.isHost && !isOver && !showHaveFun;
  return { isOver, showHaveFun, showOnMyWay, showCheckIn: showOnMyWay && checkInWindowState(gathering, now) === 'open' };
}

// Only the host and approved attendees get the day-of block (the Hub's own rule).
export function showsAttendingSection(gathering) {
  return !!gathering && (gathering.isHost === true || gathering.myStatus === 'approved');
}
