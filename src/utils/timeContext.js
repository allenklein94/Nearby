import { tr } from '../i18n/translate';
// The clearest honest temporal wording for an upcoming/current scheduled time (owner item 47). One function decides:
//   started <= 30 min ago         -> "Happening now"     (the canonical Right Now past window; no duration is invented,
//                                                          so anything that started earlier just shows its start time)
//   starts within the next hour   -> "Starts in 45 min"
//   later today                   -> "Today · 6:30 PM"   ("Tonight · 8 PM" from 6 PM on)
//   tomorrow                      -> "Tomorrow · 7 PM"
//   otherwise                     -> "Fri, Aug 14 · 7:15 PM"
// Whole-hour times drop ":00" ("7 PM"). Bare "Happening today" is never used: a time is always stronger.
export const STARTS_IN_WINDOW_MIN = 60;
const HAPPENING_NOW_PAST_MS = 30 * 60 * 1000;

function shortTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/^(\d{1,2}):00(\s?[AP]M)$/i, '$1$2');
}

// The decision behind whenLabel, as data, so another language can word the same answer (i18n/format.js localWhen).
//   { form: 'now' } | { form: 'startsIn', minutes } | { form: 'today' | 'tonight' | 'tomorrow' | 'date', date }
// `endIso` (optional): the end the host gave (start + the host-chosen length, item 188 follow-up). With it, a clock form
// carries `end` and reads as a range ("Tonight · 7–10 PM"); without it nothing is invented.
export function whenParts(iso, now = new Date(), endIso = null) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const e = endIso == null ? null : new Date(endIso);
  const end = e && Number.isFinite(e.getTime()) && e.getTime() > d.getTime() ? e : null;
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0 && -diffMs <= HAPPENING_NOW_PAST_MS) return { form: 'now', date: d };
  if (diffMs > 0 && diffMs <= STARTS_IN_WINDOW_MIN * 60000) return { form: 'startsIn', minutes: Math.max(1, Math.ceil(diffMs / 60000)), date: d };
  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(d, now)) return { form: d.getHours() >= 18 ? 'tonight' : 'today', date: d, end };
  if (isSameDay(d, tomorrow)) return { form: 'tomorrow', date: d, end };
  return { form: 'date', date: d, end };
}

// "7–10 PM", "6:30–9 PM", "11 AM–1 PM": the AM/PM is said once when both ends share it.
export function clockRange(start, end) {
  const a = shortTime(start);
  const b = shortTime(end);
  const pa = a.match(/\s?([AP]M)$/i);
  const pb = b.match(/\s?([AP]M)$/i);
  return pa && pb && pa[1].toUpperCase() === pb[1].toUpperCase() ? `${a.slice(0, a.length - pa[0].length)}–${b}` : `${a}–${b}`;
}

export function whenLabel(iso, now = new Date(), endIso = null) {
  const p = whenParts(iso, now, endIso);
  if (!p) return null;
  if (p.form === 'now') return 'Happening now';
  if (p.form === 'startsIn') return `Starts in ${p.minutes} min`;
  const time = p.end ? clockRange(p.date, p.end) : shortTime(p.date);
  if (p.form === 'today') return `Today · ${time}`;
  if (p.form === 'tonight') return `Tonight · ${time}`;
  if (p.form === 'tomorrow') return `Tomorrow · ${time}`;
  return `${p.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

// Kept as the shared name every card already calls; it now picks the clearest wording (see whenLabel).
export function formatHeroDateTime(iso, now = new Date(), endIso = null) {
  return whenLabel(iso, now, endIso) ?? '';
}

// Aug 30 2026 (CLAUDE.md) -- Home's "Friends' Activity" cards used to show
// only a title and host name, with zero time context -- a gathering
// scheduled hours earlier the same day read identically to one starting in
// 10 minutes. Returns real, honest wording either way: an upcoming/imminent
// event still gets formatHeroDateTime's own calendar-relative string; an
// already-past one gets a real elapsed-time label ("2 hrs ago") plus
// `isPast: true` so the caller can also flip verb tense ("hosted" vs
// "is hosting") -- never silently ambiguous between the two.
export function describeFriendGatheringTiming(iso) {
  const scheduled = new Date(iso);
  const now = new Date();
  const diffMs = now - scheduled;
  if (diffMs <= 0) {
    return { isPast: false, text: formatHeroDateTime(iso) };
  }
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) {
    return { isPast: true, text: diffMin <= 1 ? 'Just now' : `${diffMin} min ago` };
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return { isPast: true, text: `${diffHr} hr${diffHr === 1 ? '' : 's'} ago` };
  }
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) {
    return { isPast: true, text: 'Yesterday' };
  }
  return { isPast: true, text: formatHeroDateTime(iso) };
}

export function getGreeting() {
  const hour = new Date().getHours();
  // Read in the person's language (ui.homeParts.greeting); English: Good morning / Good afternoon / Good evening.
  if (hour < 12) return tr('ui.homeParts.greeting.morning');
  if (hour < 18) return tr('ui.homeParts.greeting.afternoon');
  return tr('ui.homeParts.greeting.evening');
}

export function getTimePeriod(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return 'weekend';
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

// Every entry's `category` is one of the ~25 canonical interest tags —
// the only real category data a gathering has (see INTEREST_OPTIONS in
// QuickPicksEditModal.js). A label like "Beach Volleyball" is a
// time-flavored *suggestion*, not a real sub-category the schema knows
// about — browsing by category alone would show every "Sports" gathering,
// not just volleyball ones. `searchTerm`, where present, is a single real
// word narrow enough to be worth combining with the category filter as an
// actual text search (via the same indexed searchGatherings() every
// screen's search box already uses) — omitted wherever the label and
// category already mean the same thing (Coffee/Coffee, Volunteering/
// Volunteering, Concert/Concerts), since searching there would only add a
// chance of a false-negative empty result with no real narrowing benefit.
const QUICK_PROMPTS_BY_PERIOD = {
  morning: [
    { icon: '☕', label: 'Coffee', category: 'Coffee' },
    { icon: '🏃', label: 'Morning Run', category: 'Fitness', searchTerm: 'run' },
    { icon: '🍳', label: 'Breakfast', category: 'Foodie', searchTerm: 'breakfast' },
  ],
  afternoon: [
    { icon: '🥪', label: 'Lunch', category: 'Foodie', searchTerm: 'lunch' },
    { icon: '🤝', label: 'Volunteering', category: 'Volunteering' },
    { icon: '📚', label: 'Reading', category: 'Reading' },
  ],
  evening: [
    { icon: '🍽️', label: 'Dinner', category: 'Foodie', searchTerm: 'dinner' },
    { icon: '🎤', label: 'Concert', category: 'Concerts' },
    { icon: '🚶', label: 'Walk', category: 'Outdoors', searchTerm: 'walk' },
  ],
  weekend: [
    { icon: '🏐', label: 'Beach Volleyball', category: 'Sports', searchTerm: 'volleyball' },
    { icon: '🌱', label: 'Beach Cleanup', category: 'Outdoors', searchTerm: 'cleanup' },
    { icon: '🍷', label: 'Wine Tasting', category: 'Wine', searchTerm: 'tasting' },
  ],
};

export function getQuickPrompts(period = getTimePeriod()) {
  return QUICK_PROMPTS_BY_PERIOD[period] ?? QUICK_PROMPTS_BY_PERIOD.evening;
}

// Inverted lookup — category tag -> { period: {icon, label} } — built from
// the same hardcoded defaults above, so a personalized pick for e.g.
// "Foodie" gets the exact same period-flavored icon/label
// (Breakfast/Lunch/Dinner) the static defaults already use, instead of a
// newly-invented one.
const PERIOD_LABEL_BY_CATEGORY = {};
for (const [period, items] of Object.entries(QUICK_PROMPTS_BY_PERIOD)) {
  for (const item of items) {
    PERIOD_LABEL_BY_CATEGORY[item.category] = PERIOD_LABEL_BY_CATEGORY[item.category] ?? {};
    PERIOD_LABEL_BY_CATEGORY[item.category][period] = { icon: item.icon, label: item.label, searchTerm: item.searchTerm };
  }
}

// Real personalization, not a fabricated one: `topCategories` is Home's
// "Because you like" list (blendedRanking.becauseYouLikeCategories, item 158:
// declared interests first, then categories learned from 2+ separate real
// choices), already fetched by getHomeDashboard() — reused here, not a new query. A category with an established
// period-flavored label/icon (from the static defaults above) keeps that
// flavor; anything else falls back to a generic icon (via categoryStyleFor,
// passed in so this stays a pure function) and the tag itself as the label
// — never an invented period-specific name. Remaining slots (up to 3) are
// backfilled from today's existing static defaults, so a brand-new account
// with no real history sees exactly what it sees today, unchanged.
export function getPersonalizedQuickPicks(period, topCategories, styleForCategory) {
  const periodDefaults = getQuickPrompts(period);
  if (!topCategories || topCategories.length === 0) return periodDefaults;

  const picks = [];
  const seen = new Set();

  for (const tag of topCategories) {
    if (picks.length >= 3) break;
    if (seen.has(tag)) continue;
    seen.add(tag);
    const flavor = PERIOD_LABEL_BY_CATEGORY[tag]?.[period];
    if (flavor) {
      picks.push({ icon: flavor.icon, label: flavor.label, category: tag, searchTerm: flavor.searchTerm });
    } else {
      const style = styleForCategory(tag);
      picks.push({ icon: style.icon, label: tag, category: tag });
    }
  }

  for (const item of periodDefaults) {
    if (picks.length >= 3) break;
    if (seen.has(item.category)) continue;
    seen.add(item.category);
    picks.push(item);
  }

  return picks;
}

// A user's own pinned selection, always shown as-is regardless of
// time-of-day — matches the fixed "Quick Picks: Coffee · Soccer · Running
// · Music" shape once a user has explicitly customized it, no period
// gating. Reuses the same period-flavor table for whatever the *current*
// period happens to be, purely for a nicer icon/label when one exists —
// the set of categories itself never changes by period once pinned.
export function getPinnedQuickPicks(pinnedCategories, period, styleForCategory) {
  return pinnedCategories.map((tag) => {
    const flavor = PERIOD_LABEL_BY_CATEGORY[tag]?.[period];
    if (flavor) return { icon: flavor.icon, label: flavor.label, category: tag, searchTerm: flavor.searchTerm };
    const style = styleForCategory(tag);
    return { icon: style.icon, label: tag, category: tag };
  });
}
