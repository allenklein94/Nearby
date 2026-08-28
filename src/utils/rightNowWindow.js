// Universal Signal Remediation Pass, P2 item 8 (CLAUDE.md, Aug 28 2026) --
// one real, canonical definition of "Right Now," closing the audit's own
// confirmed finding: two independent, mutually-inconsistent meanings of
// "now" shared the same English words across adjacent surfaces.
// GatheringsScreen.js's own "Right Now" filter chip already used a real,
// narrow window (recently started, or starting soon) -- the audit's own
// text names this as "the more precise of the two... the ask box's
// dateWindow classification is the one that should likely adopt the
// narrower definition, not the reverse"
// (PRODUCT_AUDIT/UNIVERSAL_SIGNAL_RECOMMENDATION_AUDIT_2026-08-28.md,
// finding 7). create-assistant's dateWindow classification, by contrast,
// only ever had a broad full-calendar-day bucket for "right now"-shaped
// free text to fall into (its own prompt collapsed "tonight"/"right now"
// into one bucket, 'tonight') -- a user typing "something right now" got
// the same wide match as someone typing "sometime today."
//
// This file is the one real source of the narrow window's numeric
// definition -- GatheringsScreen.js and intentResolverScoring.js both
// import it instead of each keeping their own copy, matching the
// established utils/weatherBias.js precedent (one shared, screen-
// independent pure utility, imported by both a screen and a resolver
// service, rather than hand-rolled re-derivations of the same rule).
//
// NOT touched by this file, and disclosed rather than silently assumed:
// create-assistant (the deployed Edge Function) never computes this
// window's numeric math itself -- it only emits a categorical dateWindow
// string ('now'/'today'/'tonight'/etc.); the actual time-window
// arithmetic always happens client-side, in matchesDateWindow() (see
// intentResolverScoring.js). So there's no cross-runtime constant to
// duplicate into the Edge Function's own source, and no structural
// limitation to disclose there -- once the real division of labor is
// traced directly, create-assistant only ever needed a genuine 'now'
// value added to its own classification vocabulary (distinct from
// 'tonight', which stays a full-day match -- "tonight" and "right now"
// are real, different asks, previously conflated into one bucket by the
// model's own prompt), not a copy of this file's own numbers.
//
// Also disclosed, a real, separate finding found while re-verifying this
// item, NOT fixed here since it's outside this item's own locked scope
// (extracting GatheringsScreen.js's window and repointing create-
// assistant/intentResolverScoring.js's "now" bucket at it, nothing more):
// homeDashboard.js's own, differently-named `happeningNow` signal (Home's
// "Happening Near You" row) uses a window that looks identical at a
// glance (the same two numbers, 30min/2h) but is actually the mirror
// image of this one -- [-2h, +30min] (mostly backward-looking, "already
// started") rather than this file's [-30min, +2h] (mostly forward-
// looking, "starting soon"). GatheringsScreen.js's own pre-existing
// comment claimed the two windows were "the same," which this pass found
// to be inaccurate on direct inspection (plug in a concrete timestamp on
// both and the resulting ranges don't match). Left untouched --
// homeDashboard.js's signal is a distinct, already-shipped Home feature
// this item was never scoped to touch, and reconciling the two needs its
// own explicit product decision (which framing is actually correct for
// "Happening Near You": mostly-past or mostly-future), not a silent
// change bundled into this pass.

export const RIGHT_NOW_WINDOW_PAST_MS = 30 * 60 * 1000; // 30 minutes
export const RIGHT_NOW_WINDOW_FUTURE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Real, narrow definition of "Right Now": a gathering (or any scheduled
// item) that started up to 30 minutes ago, or starts within the next 2
// hours. `now` is injectable for deterministic testing; defaults to the
// real current time for every real caller.
export function isWithinRightNowWindow(scheduledAt, now = new Date()) {
  const date = new Date(scheduledAt);
  const nowMs = now.getTime();
  return date.getTime() >= nowMs - RIGHT_NOW_WINDOW_PAST_MS && date.getTime() <= nowMs + RIGHT_NOW_WINDOW_FUTURE_MS;
}
