// Phase J of the master onboarding->product wiring plan (CLAUDE.md, Sep 3
// 2026 audit finding 8, locked "Phase J" text further down that same
// section) -- an explicit recommendation signal-source-priority-by-maturity
// model, deliberately distinct from recommendationReasonVocabulary.js (that
// module tags reason *text* with a semantic "why" category -- Interest/
// Distance/Time/Context/Availability/Capacity/Popularity; this module tags
// a scoring *contribution* with a "how much do we trust this, for THIS
// caller, right now" provenance category, an orthogonal axis).
//
// Two things this module deliberately does NOT do, matching this file's
// oldest, most-repeated rule (no invented signals, no premature universal
// scoring algorithm):
//   - it never fabricates a "maturity score" from nothing -- maturity is
//     computed from exactly two real, already-observable facts: real
//     account age (profiles.created_at) and whether the account has any
//     real behavioral history at all (a non-empty getMyTopGatheringCategories()
//     result -- already fetched by getHomeDashboard() for the "Because
//     You're Into..." section, reused here with zero new query).
//   - it never merges the app's several independent scoring formulas into
//     one universal score. SCORE_INTEREST_MATCH/SCORE_CLOSE_DISTANCE/
//     SCORE_HAPPENING_NOW/SCORE_OWN_NETWORK (intentResolverScoring.js) are
//     completely untouched -- this module only ever scales an existing
//     point value that a caller (homeRecommendations.js, so far -- see
//     that file's own header comment) already computed on its own real
//     weight scale, it never invents a new one.
//
// The five real signal-source categories, and what "trust" means for each:
//   EXPLICIT     -- the user directly told Nearby (profiles.interests,
//                   social_comfort_level, a chosen target_interest_tag on
//                   an offer the caller is already scoped to see). Always
//                   real the instant it's given -- never dampened, no
//                   matter how new the account is.
//   BEHAVIORAL   -- derived from the account's own repeated real actions
//                   over time (e.g. a real attended-category pattern).
//                   Trustworthy once there's enough of it; a single early
//                   data point can just be noise, not a durable
//                   preference -- dampened for a low-maturity account.
//   SOCIAL       -- derived from the caller's own real connections
//                   (friends/matches/communities already doing the same
//                   thing). A real, present signal, but a second-hand
//                   proxy for the caller's own preference -- dampened for
//                   a low-maturity account, same reasoning as BEHAVIORAL.
//   CONTEXTUAL   -- a fact about the world right now (today's real
//                   weather, how far away something actually is, whether
//                   it's happening today) -- not a fact about the caller's
//                   history at all. Always real regardless of account age
//                   -- dampening this for a new user would make Home
//                   actively less useful on day one, the opposite of the
//                   "don't overwhelm a new user" goal this whole model
//                   exists to serve.
//   TRANSACTIONAL -- a specific, single past completed interaction the
//                   caller explicitly rated (e.g. get_my_positive_experience_
//                   signals()'s real loved-it/would-repeat history). The
//                   narrowest-scope, most overfit-prone class of the five
//                   -- one great night with one host is real, but weighing
//                   it as heavily for a brand-new account as it would be
//                   weighed for an account with a real track record risks
//                   over-personalizing on N=1 -- dampened for a
//                   low-maturity account.
export const SIGNAL_SOURCES = {
  EXPLICIT: 'explicit',
  BEHAVIORAL: 'behavioral',
  SOCIAL: 'social',
  CONTEXTUAL: 'contextual',
  TRANSACTIONAL: 'transactional',
};

// Never dampened, regardless of maturity -- see the two reasons in the
// header comment above (an explicit answer is real on day one; a
// contextual fact is true regardless of who's asking).
const ALWAYS_FULL_TRUST = new Set([SIGNAL_SOURCES.EXPLICIT, SIGNAL_SOURCES.CONTEXTUAL]);

// A real, small, disclosed threshold -- not derived from real usage data
// (this app doesn't have meaningfully sized cohorts of behavioral history
// yet to derive one from), stated plainly as a starting default rather
// than a fabricated precision, same posture this file already takes for
// e.g. MESSAGE_PAGE_SIZE or the "5+ opportunities" reliability-established
// thresholds elsewhere in this codebase. Revisit once real usage data
// exists to tune it against.
export const MATURITY_WINDOW_DAYS = 14;

// The floor a real behavioral-history data point earns even on a brand-new
// account -- a genuine interaction (the caller actually joined/hosted
// something) is itself real evidence, not noise, regardless of how few
// days old the account is; it just isn't yet enough evidence to earn full
// trust the way MATURITY_WINDOW_DAYS of real elapsed time does.
export const MIN_MATURITY_WITH_HISTORY = 0.5;

// Real inputs only: accountAgeDays (a real elapsed-time number, or
// null/undefined when unknown) and hasBehavioralHistory (a real boolean,
// or falsy when unknown). Both null/undefined resolves to full trust
// (1.0) -- a caller that doesn't wire either input up sees zero behavior
// change, matching this codebase's established "an omitted optional
// param must never change existing behavior" convention.
export function computeAccountMaturity({ accountAgeDays = null, hasBehavioralHistory = false } = {}) {
  if (accountAgeDays === null || accountAgeDays === undefined) return 1;
  const byAge = Math.max(0, Math.min(1, accountAgeDays / MATURITY_WINDOW_DAYS));
  return hasBehavioralHistory ? Math.max(byAge, MIN_MATURITY_WITH_HISTORY) : byAge;
}

// Scales a real, already-computed point value by the caller's own real
// maturity, but only for the three classes whose reliability genuinely
// depends on having enough real history behind them -- EXPLICIT/
// CONTEXTUAL always pass through unscaled. A null/undefined maturity
// (the caller never computed one) also passes every class through
// unscaled -- same "omitted input, unchanged behavior" rule as
// computeAccountMaturity above.
export function weightSignal(points, sourceCategory, maturity) {
  if (maturity === null || maturity === undefined) return points;
  if (ALWAYS_FULL_TRUST.has(sourceCategory)) return points;
  return points * maturity;
}
