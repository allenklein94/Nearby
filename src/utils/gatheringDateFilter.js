import { isWithinRightNowWindow } from './rightNowWindow';

// Discover/People-Friends parity plan, item 1 (CLAUDE.md): this was
// GatheringsScreen.js's own local DATE_OPTIONS/matchesDateFilter, moved
// here verbatim so DiscoverHubScreen.js's in-place "Happening Now/Today/
// This Weekend" quick filters use the exact same real date-bucket logic
// as the dedicated Gatherings screen's own "When" filter, rather than a
// second, independently-invented definition of "today"/"this weekend"
// that could quietly drift from this one.
export const DATE_OPTIONS = [
  { key: 'anytime', label: 'Anytime' },
  { key: 'now', label: 'Right Now' },
  { key: 'soon', label: 'Starting Soon' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This Weekend' },
  { key: 'week', label: 'This Week' },
];

// "Starting Soon" -- a real, narrower window than "Right Now"'s symmetric
// +/- window: starts in the next 90 minutes and hasn't started yet.
const SOON_WINDOW_MS = 90 * 60 * 1000;

export function matchesDateFilter(scheduledAt, filterKey) {
  if (filterKey === 'anytime') return true;
  const date = new Date(scheduledAt);
  const now = new Date();

  if (filterKey === 'now') {
    return isWithinRightNowWindow(scheduledAt, now);
  }

  if (filterKey === 'soon') {
    return date.getTime() > now.getTime() && date.getTime() <= now.getTime() + SOON_WINDOW_MS;
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayStart = startOfDay(now);

  if (filterKey === 'today') {
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    return date >= todayStart && date < tomorrowStart;
  }

  if (filterKey === 'tomorrow') {
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dayAfterStart = new Date(tomorrowStart);
    dayAfterStart.setDate(dayAfterStart.getDate() + 1);
    return date >= tomorrowStart && date < dayAfterStart;
  }

  if (filterKey === 'weekend') {
    const dayOfWeek = todayStart.getDay();
    // Sunday (0) is already inside the current weekend -- (6 - 0 + 7) % 7
    // would wrap all the way to next Saturday, silently excluding the rest
    // of today. Same fix as intentResolverScoring.js's matchesDateWindow.
    const daysUntilSaturday = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
    const saturdayStart = new Date(todayStart);
    saturdayStart.setDate(saturdayStart.getDate() + daysUntilSaturday);
    const mondayStart = new Date(saturdayStart);
    mondayStart.setDate(mondayStart.getDate() + 2);
    return date >= saturdayStart && date < mondayStart;
  }

  if (filterKey === 'week') {
    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return date >= todayStart && date < weekEnd;
  }

  return true;
}
