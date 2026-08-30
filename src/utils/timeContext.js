// "Today · 7:15 PM" / "Tomorrow · 7:15 PM" / "Fri, Aug 14 · 7:15 PM" — real
// calendar-relative formatting, not a generic date string.
export function formatHeroDateTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isSameDay(d, now)) return `Today · ${time}`;
  if (isSameDay(d, tomorrow)) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
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
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
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

// Real personalization, not a fabricated one: `topCategories` is the
// caller's own real most-attended interest tags (getMyTopGatheringCategories,
// already fetched by getHomeDashboard() for the "Because You're Into"
// section — reused here, not a new query). A category with an established
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
