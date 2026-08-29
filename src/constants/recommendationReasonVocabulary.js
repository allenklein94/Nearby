// P1 item 4 (CLAUDE.md, Aug 28 2026 Full Coherence Audit): one shared,
// semantic vocabulary for *why* something is recommended -- Interest /
// Distance / Time / Context / Availability / Capacity / Popularity --
// reused across Best Pick + Ask Nearby (both source their reasons from
// services/gatherings.js's getGatheringFitReasons()), Nearby Right Now
// (services/homeRecommendations.js), and Friends (FriendDiscoverySwipeCards.js's
// own shared-context line). This deliberately does NOT merge those four
// systems' independent scoring formulas into one universal score --
// each surface still computes its own real numeric score from its own
// real signals, on its own real weight scale (SCORE_INTEREST_MATCH etc.
// in intentResolverScoring.js, completely untouched by this module).
// This only gives the *reason text* those formulas already produce one
// canonical home, tagged with a real semantic category, so two surfaces
// that mean the exact same thing can never silently drift out of sync --
// a real, previously-existing risk: the weather-context reason strings
// were independently re-typed, verbatim, in both homeRecommendations.js
// and intentResolver.js before this, with no shared source between them.

export const REASON_CATEGORIES = {
  INTEREST: 'interest',
  DISTANCE: 'distance',
  TIME: 'time',
  CONTEXT: 'context',
  AVAILABILITY: 'availability',
  CAPACITY: 'capacity',
  POPULARITY: 'popularity',
};

// One real Ionicons glyph per category, matching this app's established
// icon-not-emoji convention for UI chrome (see CLAUDE.md's own "extended
// Ionicons to the rest of Home's emoji" entries). Used by ReasonList.js
// to render a consistent icon next to any reason line, regardless of
// which of the four surfaces produced it.
export const REASON_CATEGORY_ICONS = {
  [REASON_CATEGORIES.INTEREST]: 'heart-outline',
  [REASON_CATEGORIES.DISTANCE]: 'location-outline',
  [REASON_CATEGORIES.TIME]: 'time-outline',
  [REASON_CATEGORIES.CONTEXT]: 'sparkles-outline',
  [REASON_CATEGORIES.AVAILABILITY]: 'storefront-outline',
  [REASON_CATEGORIES.CAPACITY]: 'people-outline',
  [REASON_CATEGORIES.POPULARITY]: 'flame-outline',
};

// Canonical, shared reason text -- for the handful of reasons that
// genuinely ARE (or should be) byte-identical across two or more of the
// four surfaces. Every surface below imports these instead of
// re-typing the same string inline, closing the real duplication named
// above. Reasons that are legitimately surface-specific in their exact
// wording (a formatted distance label like "0.3 mi away", a real
// attendee count, a friend-discovery shared-context count) are NOT
// forced through here -- collapsing those into one generic string would
// throw away real, more-specific information one surface already has
// that another doesn't.
export const REASON_TEXT = {
  MATCHES_INTERESTS: { text: 'Matches your interests', category: REASON_CATEGORIES.INTEREST },
  HAPPENING_TODAY: { text: 'Happening today', category: REASON_CATEGORIES.TIME },
  WEATHER_GOOD_INDOOR: { text: 'A good indoor option with weather coming in', category: REASON_CATEGORIES.CONTEXT },
  WEATHER_GOOD_OUTDOOR: { text: 'Great weather for this', category: REASON_CATEGORIES.CONTEXT },
};

// A real, deterministic classifier over every reason string already in
// use somewhere in this app today (grepped, not guessed) -- exact
// matches first, then a small set of real parameterized patterns (an
// attendee/first-timer/interest/community/mutual-friend count, a
// formatted distance label, a fullness/capacity label, a business-
// availability confidence label). Returns null, never a guess, for
// anything that doesn't genuinely match a known real shape -- matching
// this file's own "no invented numbers" convention applied to
// classification instead of a number.
const EXACT_MATCHES = new Map([
  [REASON_TEXT.MATCHES_INTERESTS.text, REASON_CATEGORIES.INTEREST],
  [REASON_TEXT.HAPPENING_TODAY.text, REASON_CATEGORIES.TIME],
  [REASON_TEXT.WEATHER_GOOD_INDOOR.text, REASON_CATEGORIES.CONTEXT],
  [REASON_TEXT.WEATHER_GOOD_OUTDOOR.text, REASON_CATEGORIES.CONTEXT],
  // homeRecommendations.js's own simpler distance reason -- a real,
  // deliberately different string from getGatheringFitReasons()'s
  // formatted distanceLabel (see this module's own header comment for
  // why the two aren't collapsed into one shared literal).
  ['Close by', REASON_CATEGORIES.DISTANCE],
  ['Beginner friendly', REASON_CATEGORIES.CONTEXT],
  ['You loved a gathering with this host before', REASON_CATEGORIES.CONTEXT],
  ['You loved this business last time', REASON_CATEGORIES.CONTEXT],
  ["You're already a member", REASON_CATEGORIES.CONTEXT],
  ['A public community — not yet joined', REASON_CATEGORIES.CONTEXT],
  ['May be available — business confirmation required', REASON_CATEGORIES.AVAILABILITY],
]);

const PATTERN_MATCHES = [
  // getGatheringFitReasons()'s real attendee-count reason.
  { pattern: /^\d+ (person|people) attending$/, category: REASON_CATEGORIES.POPULARITY },
  // getGatheringFitReasons()'s real first-timer-count reason.
  { pattern: /^\d+ attendees? (is|are) also first-timers?$/, category: REASON_CATEGORIES.CONTEXT },
  // getGatheringById()'s real formatted distanceLabel ("Very close" or
  // "0.3 mi away").
  { pattern: /^(Very close|\d+(\.\d+)? mi away)$/, category: REASON_CATEGORIES.DISTANCE },
  // FriendDiscoverySwipeCards.js's real sharedBits entries.
  { pattern: /^\d+ interests? in common$/, category: REASON_CATEGORIES.INTEREST },
  { pattern: /^in \d+ of your communities$/, category: REASON_CATEGORIES.CONTEXT },
  { pattern: /^\d+ mutual friends?$/, category: REASON_CATEGORIES.CONTEXT },
  // Friend Discovery's own real, fixed 3-value coarse distance bucket
  // (services/friendDiscovery.js -- never an exact distance).
  { pattern: /^(Nearby|A few miles away|In the wider area)$/, category: REASON_CATEGORIES.DISTANCE },
  // gatheringFullnessLabel() (utils/gatheringFullness.js) and the
  // resolver's own more detailed "🔒 Full — Join Waitlist (N/M spots
  // taken)" subtitle -- both real capacity signals, not a fabricated
  // one invented for this module.
  { pattern: /^🔒 Full — Join Waitlist/, category: REASON_CATEGORIES.CAPACITY },
  { pattern: /^(🔥|🟢) \d+ spots? left$/, category: REASON_CATEGORIES.CAPACITY },
  // intentResolver.js's real business-availability confidence labels
  // (HomeScreen.js's INTENT_RESULT_TYPE_LABELS) -- confirmed live,
  // never fabricated for this module.
  { pattern: /^🟢 A business has this ready$/, category: REASON_CATEGORIES.AVAILABILITY },
  { pattern: /^🟡 A business may be able to help$/, category: REASON_CATEGORIES.AVAILABILITY },
];

export function categorizeReasonText(text) {
  if (!text) return null;
  if (EXACT_MATCHES.has(text)) return EXACT_MATCHES.get(text);
  for (const { pattern, category } of PATTERN_MATCHES) {
    if (pattern.test(text)) return category;
  }
  return null;
}
