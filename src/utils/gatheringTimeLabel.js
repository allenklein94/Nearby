import { isWithinRightNowWindow } from './rightNowWindow';
import { whenLabel } from './timeContext';

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Deliberately NOT utils/timeContext.js's own getTimePeriod() -- that
// function checks day-of-week *before* hour-of-day (Sat/Sun always reports
// 'weekend', regardless of what time it is), which is exactly right for
// Home's own greeting/quick-picks section label but wrong here: a real
// Saturday-evening gathering must still badge as TONIGHT, not have its
// same-day evening status swallowed by "it happens to be the weekend."
// Same 18:00 threshold getTimePeriod itself uses for 'evening' -- not a new
// cutoff invented for this file, just applied without the weekend override.
function isEveningHour(date) {
  return date.getHours() >= 18;
}

// Phase 8 (CLAUDE.md, Discover visual hierarchy) -- one shared time-bucket
// eyebrow label for a gathering's own scheduled_at, composed from this
// app's existing canonical "Right Now" window (utils/rightNowWindow.js)
// rather than a third, independently-invented time system for just one
// screen. "This Weekend" only fires for a gathering 1-6 days out that lands
// on a real Saturday/Sunday -- never today (already covered by Right Now/
// Today/Tonight above) and never a same-day weekend gathering counted twice.
export function gatheringTimeBadge(scheduledAt, now = new Date()) {
  if (!scheduledAt) return null;
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return null;

  if (isWithinRightNowWindow(scheduledAt, now)) return 'RIGHT NOW';

  if (isSameCalendarDay(date, now)) {
    return isEveningHour(date) ? 'TONIGHT' : 'TODAY';
  }

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAway = Math.round((dateStart - todayStart) / 86400000);
  const dayOfWeek = date.getDay();
  if (daysAway >= 1 && daysAway <= 6 && (dayOfWeek === 0 || dayOfWeek === 6)) return 'THIS WEEKEND';

  return 'UPCOMING';
}

// The full "Tonight · 7:30 PM" line for card copy: the shared clearest-wording rule (timeContext.js whenLabel), which
// also says "Happening now" / "Starts in 45 min" and uses Tonight from 6 PM.
export function gatheringTimeLine(scheduledAt, now = new Date()) {
  if (!scheduledAt) return null;
  return whenLabel(scheduledAt, now);
}
