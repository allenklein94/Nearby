import { isWithinRightNowWindow } from './rightNowWindow';
import { matchesDateFilter, TONIGHT_START_HOUR } from './gatheringDateFilter';
import { gatheringTimeBadge } from './gatheringTimeLabel';
import { attendeeTotal } from './gatheringFullness';
import { TRENDING_ATTENDANCE_MIN } from '../constants/trending';
import { friendsInterestReason } from './friendInterests';
import { compareTierVectors } from '../constants/signalPriority';
import { becauseYouLikeReason, reasonText } from '../constants/recommendationReasonVocabulary';

// The reason a section itself stands for (owner, 2026-10-04): it leads the card's two shown reasons in that section.
// Only sections that ARE a reason have one; Now / Tonight / This Weekend are timing, already on the card's when line.
// Built with the same builders the card's reasons use, so it matches only when the card really carries it.
export function sectionLeadReason(sectionKey, g, { friendInterestByTag = {} } = {}) {
  if (!g) return null;
  if (sectionKey === 'because') return g.interest_tag ? becauseYouLikeReason(g.interest_tag) : null;
  if (sectionKey === 'friends') return g.interest_tag ? friendsInterestReason(g.interest_tag, friendInterestByTag?.[g.interest_tag]) : null;
  if (sectionKey === 'trending') {
    const n = attendeeTotal(g);
    return n >= TRENDING_ATTENDANCE_MIN ? reasonText('attendingCount', { count: n }) : null;
  }
  return null;
}

// Discover's contextual sections (owner item 91; order re-set 2026-09-27 to the one ranking ladder): after the search box and
// the Browse rail, the All view reads as Happening Now -> Tonight -> Because you like X -> Friends are into X -> Trending Near
// You -> This Weekend (Trending, popularity, sits below the two personal sections).
// ONE dedupe chain: a gathering shows in the first section it qualifies for and never again below it. Every section is
// backed by a real signal and is omitted when empty (no placeholder):
//   now       = inside the canonical Right Now window (matchesDateFilter 'now')
//   tonight   = still to start today; titled "Tonight" only when every item carries the TONIGHT badge, else "Today"
//   trending  = at least TRENDING_ATTENDANCE_MIN approved attendees (the one shared floor)
//   because   = the person's DECLARED interest with the most nearby gatherings (never behavior-only: item 60)
//   friends   = a tag accepted friends declared (get_friends_interested_in), worded by friendsInterestReason
//   weekend   = this weekend
// `score` is the screen's own scoring (adds g.fit with its tier vector); sections never invent a reason of their own. Inside every
// section items are ordered by the one ladder (compareDiscover: fit.rankVector, then nearest).
export const HAPPENING_NOW_CAP = 6;
export const SECTION_CAP = 4;

const byDistance = (a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
// The one in-section order (constants/signalPriority.js): the tier vector when the screen supplies one, then nearest.
export function compareDiscover(a, b) {
  if (Array.isArray(a?.fit?.rankVector) && Array.isArray(b?.fit?.rankVector)) {
    return compareTierVectors(a.fit.rankVector, b.fit.rankVector) || byDistance(a, b);
  }
  return (b.fit?.score ?? 0) - (a.fit?.score ?? 0) || byDistance(a, b);
}

function pickTag(tags, remaining) {
  let best = null;
  for (const tag of tags) {
    const items = remaining.filter((g) => g.interest_tag === tag);
    if (items.length > 0 && (!best || items.length > best.items.length)) best = { tag, items };
  }
  return best;
}

export function buildDiscoverSections({
  gatherings = [],
  score = (g) => ({ ...g, fit: g.fit ?? { score: 0, reasons: [] } }),
  declared = [],
  friendInterestByTag = {},
  excludeIds = new Set(),
  now = new Date(),
  isInWindow = matchesDateFilter,
} = {}) {
  const used = new Set(excludeIds);
  const remaining = () => gatherings.filter((g) => g && !used.has(g.id));
  const take = (list, cap) => {
    const shown = list.slice(0, cap);
    for (const g of shown) used.add(g.id);
    return { items: shown, hasMore: list.length > cap };
  };
  const sections = [];

  const nowList = remaining().filter((g) => isInWindow(g.scheduled_at, 'now')).map(score).sort(compareDiscover);
  const nowTaken = take(nowList, HAPPENING_NOW_CAP);
  if (nowTaken.items.length) sections.push({ key: 'now', title: '⚡ Happening Now', ...nowTaken });

  const todayList = remaining().filter((g) => isInWindow(g.scheduled_at, 'today')).map(score).sort(compareDiscover);
  const todayTaken = take(todayList, SECTION_CAP);
  if (todayTaken.items.length) {
    const allTonight = todayTaken.items.every((g) => gatheringTimeBadge(g.scheduled_at, now) === 'TONIGHT');
    sections.push({ key: 'tonight', title: allTonight ? '🌙 Tonight' : '🌅 Today', dateFilter: 'today', ...todayTaken });
  }

  const because = pickTag([...new Set((declared ?? []).filter(Boolean))], remaining());
  if (because) {
    const taken = take(because.items.map(score).sort(compareDiscover), SECTION_CAP);
    sections.push({ key: 'because', title: `✨ Because you like ${because.tag}`, tag: because.tag, ...taken });
  }

  const friendTags = Object.entries(friendInterestByTag ?? {})
    .filter(([, e]) => Number(e?.friend_count ?? e?.count ?? 0) >= 1)
    .sort((a, b) => Number(b[1]?.friend_count ?? b[1]?.count ?? 0) - Number(a[1]?.friend_count ?? a[1]?.count ?? 0))
    .map(([tag]) => tag);
  const friends = friendTags.map((tag) => pickTag([tag], remaining())).find(Boolean);
  if (friends) {
    const title = friendsInterestReason(friends.tag, friendInterestByTag[friends.tag]);
    if (title) {
      const taken = take(friends.items.map(score).sort(compareDiscover), SECTION_CAP);
      sections.push({ key: 'friends', title: `🤝 ${title}`, tag: friends.tag, ...taken });
    }
  }

  const trendingList = remaining().filter((g) => attendeeTotal(g) >= TRENDING_ATTENDANCE_MIN).map(score)
    .sort(compareDiscover);
  const trendingTaken = take(trendingList, SECTION_CAP);
  if (trendingTaken.items.length) sections.push({ key: 'trending', title: '🔥 Trending Near You', ...trendingTaken });

  const weekendList = remaining().filter((g) => isInWindow(g.scheduled_at, 'weekend')).map(score).sort(compareDiscover);
  const weekendTaken = take(weekendList, SECTION_CAP);
  if (weekendTaken.items.length) sections.push({ key: 'weekend', title: '🌴 This Weekend', dateFilter: 'weekend', ...weekendTaken });

  return sections;
}

// Owner item 206: "See all" on Tonight/Today or This Weekend switches Discover into a FULL date view in place (no new screen).
// It lists every gathering in that window from the list Discover already holds (its Open now / Outdoor filters still apply),
// ordered by the same ladder; the capped sections are not shown while it is open, so nothing appears twice. Titled by the same
// rule as the section: "Tonight" only when every item is a tonight start, else "Today".
// Item 34 (owner, 2026-10-08): the same view also backs Discover's time chips (Happening Now · Today · This Weekend);
// 'now' = the canonical Right Now window (next 2 hours), the same as Home's Nearby Right Now.
export const DATE_VIEW_FILTERS = ['now', 'today', 'weekend'];
export const TIME_CHIPS = ['now', 'today', 'weekend'];
export function buildDiscoverDateView({
  gatherings = [],
  dateFilter,
  score = (g) => ({ ...g, fit: g.fit ?? { score: 0, reasons: [] } }),
  now = new Date(),
  isInWindow = matchesDateFilter,
} = {}) {
  if (!DATE_VIEW_FILTERS.includes(dateFilter)) return null;
  const inWindow = dateFilter === 'now' ? (at) => isWithinRightNowWindow(at, now) : isInWindow;
  const items = gatherings.filter((g) => g && inWindow(g.scheduled_at, dateFilter)).map(score).sort(compareDiscover);
  if (dateFilter === 'now') return { key: 'now', dateFilter, title: '⚡ Happening Now', items };
  if (dateFilter === 'weekend') return { key: 'weekend', dateFilter, title: '🌴 This Weekend', items };
  // Unlike the section, the full view also holds what is starting right now, so an evening start counts as tonight either way.
  const isTonight = (g) => {
    const badge = gatheringTimeBadge(g.scheduled_at, now);
    return badge === 'TONIGHT' || (badge === 'RIGHT NOW' && new Date(g.scheduled_at).getHours() >= TONIGHT_START_HOUR);
  };
  const allTonight = items.length > 0 && items.every(isTonight);
  return { key: 'tonight', dateFilter, title: allTonight ? '🌙 Tonight' : '🌅 Today', items };
}
