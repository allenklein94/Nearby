// 10/10 roadmap Part 8 (see CLAUDE.md's "10/10 roadmap" plan): technical
// validation. Pure functions extracted out of intentResolver.js verbatim
// (no behavior change) so they're directly unit-testable without dragging
// in that file's own I/O-touching imports (expo-location, supabase, etc.)
// -- importing intentResolver.js itself in a plain Jest/Node environment
// would transitively import several native modules that throw outside a
// real React Native runtime. This file has zero external imports on
// purpose, matching timeContext.js's own "pure, no I/O" precedent.
// intentResolver.js imports every export here instead of defining its own
// copies -- same values, same logic, just factored out.

// Shared relevance weights, kept on the same scale
// getGatheringFitReasons() already established (interest match = 5, close
// distance = 3, happening today/now = 2) so every candidate type competes
// on one real, comparable axis instead of a fixed tier-fill order. See
// PRODUCT_AUDIT/INTENT_LAYER_INTEGRATION_AUDIT_2026-08-14.md for why this
// replaced the old sequential "gatherings fill 4 slots, then maybe
// friend-asks, then maybe perks" design -- that design let a handful of
// loosely-matching gatherings silently starve out a perfectly-matching
// perk or a business's own live availability, since nothing was ever
// scored against anything else.
export const SCORE_INTEREST_MATCH = 5;
export const SCORE_CLOSE_DISTANCE = 3;
export const SCORE_HAPPENING_NOW = 2;
// A real signal from the caller's own social graph (already a member /
// a friend independently asking for the same thing) is weighted a little
// above a plain interest-tag match, matching this app's standing
// no-stranger-discovery principle: your own network is worth more than an
// anonymous category match, but this is still a flat weight for a real,
// present signal -- not a fabricated score.
export const SCORE_OWN_NETWORK = 6;

// Finding 6 (PRODUCT_AUDIT/INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md): the
// 24-tag category system is the resolver's real precision ceiling --
// "pickleball" collapses to "Sports" with no narrowing anywhere. Expanding
// the taxonomy or building real sub-category matching is a genuinely large
// product decision, not attempted here -- this is a small, honest
// tie-breaker on top of category matching, not a replacement for it: a
// gathering whose own title literally contains a meaningful word from the
// caller's raw typed text (4+ characters, common stopwords excluded) gets
// a flat bonus at SCORE_HAPPENING_NOW's own weight, matching an existing
// scale rather than inventing a new one.
const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'want', 'looking', 'need',
  'something', 'anything', 'some', 'more', 'than', 'into', 'about',
  'tonight', 'today', 'tomorrow', 'weekend', 'people', 'group', 'find',
  'make', 'happen', 'around', 'there', 'their', 'them', 'they', 'what',
  'when', 'where', 'which', 'would', 'could', 'should', 'doing', 'like',
  'just', 'really', 'very', 'also', 'then', 'over', 'under', 'because',
  'being', 'been', 'were', 'your', 'mine', 'ours', 'theirs', 'each', 'other',
]);

export function extractMeaningfulWords(rawText) {
  if (!rawText) return [];
  const words = rawText.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

export function titleMentionBonus(title, meaningfulWords) {
  if (!title || meaningfulWords.length === 0) return 0;
  const lowerTitle = title.toLowerCase();
  return meaningfulWords.some((w) => lowerTitle.includes(w)) ? SCORE_HAPPENING_NOW : 0;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Same coarse date-window vocabulary GatheringsScreen.js's own date-filter
// chips already use (today/tomorrow/weekend) — kept as a small,
// self-contained equivalent here rather than importing from a screen file,
// so this new service has no dependency on any screen. "tonight"/"now"
// both fold into "today" for matching purposes — no time-of-day precision
// beyond that. This is intentional: it matches this codebase's standing
// "AI never infers a specific date/time" rule (see CLAUDE.md's Create 2.0
// section) — dateWindow is a coarse bucket for filtering *existing*
// results, never a specific date or clock time used to create/publish
// anything.
export function matchesDateWindow(scheduledAt, dateWindow) {
  if (!dateWindow || dateWindow === 'flexible') return true;
  const date = new Date(scheduledAt);
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  if (dateWindow === 'today' || dateWindow === 'tonight' || dateWindow === 'now') {
    return date >= todayStart && date < tomorrowStart;
  }
  if (dateWindow === 'tomorrow') {
    const dayAfterStart = new Date(tomorrowStart);
    dayAfterStart.setDate(dayAfterStart.getDate() + 1);
    return date >= tomorrowStart && date < dayAfterStart;
  }
  if (dateWindow === 'weekend') {
    const dayOfWeek = todayStart.getDay();
    // Sunday (0) is itself the tail end of the *current* weekend, not 6
    // days before the next one -- `(6 - dayOfWeek + 7) % 7` wrapped Sunday
    // all the way around to next Saturday, silently excluding the rest of
    // today (and everything scheduled later today) from a "this weekend"
    // match. Bug found during Aug 15 2026 stabilization-pass bug hunt.
    const daysUntilSaturday = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
    const saturdayStart = new Date(todayStart);
    saturdayStart.setDate(saturdayStart.getDate() + daysUntilSaturday);
    const mondayStart = new Date(saturdayStart);
    mondayStart.setDate(mondayStart.getDate() + 2);
    return date >= saturdayStart && date < mondayStart;
  }
  return true;
}

// Translates the same coarse dateWindow vocabulary above into a real date
// *range* for comparing against business_requests.date (a plain date
// column, unlike gatherings' scheduled_at timestamp) — the exact same
// today/tomorrow/weekend boundaries matchesDateWindow already uses, kept
// as a genuine range rather than collapsing to a single date. Returns
// {start: null, end: null} for 'flexible'/unset, meaning "don't filter by
// date" — matches the RPC's own (date_start_param is null or ...)
// passthrough.
export function dateWindowToDateRange(dateWindow) {
  if (!dateWindow || dateWindow === 'flexible') return { start: null, end: null };
  const now = new Date();
  const todayStart = startOfDay(now);
  if (dateWindow === 'today' || dateWindow === 'tonight' || dateWindow === 'now') {
    const d = todayStart.toISOString().slice(0, 10);
    return { start: d, end: d };
  }
  if (dateWindow === 'tomorrow') {
    const d = new Date(todayStart);
    d.setDate(d.getDate() + 1);
    const s = d.toISOString().slice(0, 10);
    return { start: s, end: s };
  }
  if (dateWindow === 'weekend') {
    const dayOfWeek = todayStart.getDay();
    // Same fix as matchesDateWindow() above -- see its comment.
    const daysUntilSaturday = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
    const saturday = new Date(todayStart);
    saturday.setDate(saturday.getDate() + daysUntilSaturday);
    const sunday = new Date(saturday);
    sunday.setDate(sunday.getDate() + 1);
    return { start: saturday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
  }
  return { start: null, end: null };
}

// getGatheringFitReasons() (services/gatherings.js) is the shared scorer
// Home's Best Pick and GatheringDetailScreen's "Why this fits you" already
// use -- but its real score also adds up to +10 for attendee count and +1
// for beginner-friendly, neither of which belongs on the *cross-type*
// scale this resolver actually documents (interest match/close distance/
// happening today, same SCORE_* constants every other branch below uses).
// Left uncalled for scoring here on purpose -- a popular gathering would
// otherwise systematically outrank a perfectly-fitting perk or business
// availability posting, the exact bias PRODUCT_AUDIT/
// INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md found. getGatheringFitReasons()
// is still called by intentResolver.js for its `reasons` text (a real,
// richer subtitle) -- only the *score* it returns is unused, so Home's
// Best Pick and GatheringDetailScreen (both real, already-shipped,
// unmodified) are unaffected by this.
export function scoreGatheringForResolver(gathering) {
  let score = 0;
  if (gathering.matchesYourInterests) score += SCORE_INTEREST_MATCH;
  if (gathering.distanceMiles !== null && gathering.distanceMiles !== undefined && gathering.distanceMiles < 2) {
    score += SCORE_CLOSE_DISTANCE;
  }
  const scheduled = new Date(gathering.scheduled_at);
  const now = new Date();
  const isToday = scheduled.getFullYear() === now.getFullYear() && scheduled.getMonth() === now.getMonth() && scheduled.getDate() === now.getDate();
  if (isToday) score += SCORE_HAPPENING_NOW;
  return score;
}
