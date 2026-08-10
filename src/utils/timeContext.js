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

const QUICK_PROMPTS_BY_PERIOD = {
  morning: [
    { icon: '☕', label: 'Coffee', category: 'Coffee' },
    { icon: '🏃', label: 'Morning Run', category: 'Fitness' },
    { icon: '🍳', label: 'Breakfast Meetup', category: 'Foodie' },
  ],
  afternoon: [
    { icon: '🥪', label: 'Lunch', category: 'Foodie' },
    { icon: '🤝', label: 'Volunteering', category: 'Volunteering' },
    { icon: '📚', label: 'Reading', category: 'Reading' },
  ],
  evening: [
    { icon: '🍽️', label: 'Dinner', category: 'Foodie' },
    { icon: '🎤', label: 'Concert', category: 'Concerts' },
    { icon: '🚶', label: 'Walk', category: 'Outdoors' },
  ],
  weekend: [
    { icon: '🏐', label: 'Beach Volleyball', category: 'Sports' },
    { icon: '🌱', label: 'Beach Cleanup', category: 'Outdoors' },
    { icon: '🍷', label: 'Wine Tasting', category: 'Wine' },
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
    PERIOD_LABEL_BY_CATEGORY[item.category][period] = { icon: item.icon, label: item.label };
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
      picks.push({ icon: flavor.icon, label: flavor.label, category: tag });
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
    if (flavor) return { icon: flavor.icon, label: flavor.label, category: tag };
    const style = styleForCategory(tag);
    return { icon: style.icon, label: tag, category: tag };
  });
}
