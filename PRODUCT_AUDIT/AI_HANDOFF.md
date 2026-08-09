# AI Handoff — Executive Summary

*This document is a condensed entry point into the full `PRODUCT_AUDIT/` package for another
AI (or a human) doing an independent critique. Everything here is expanded, with citations, in
the other 11 files in this folder. Confidence markers used throughout this whole package:
**IMPLEMENTED** (directly confirmed working in code) / **PARTIALLY IMPLEMENTED** (real but with
a confirmed gap) / **REFERENCED BUT NOT IMPLEMENTED** (none found in this app — see note below)
/ **NOT FOUND** / **UNCLEAR** (would need a specific further check, named explicitly where used).*

## WHAT THE PRODUCT IS

Nearby (React Native/Expo, Supabase backend) combines proximity-based dating, group event
hosting ("gatherings"), topic-based standing groups ("communities"), and a local-business
perks/sponsorship layer into one app, with a large secondary suite of post-match
relationship-longevity tools (Chemistry Diary, Shared Decisions, Trip Planning, a Relationship
Constitution, an Emergency Kit, a "Rehearsal Room," a Goodbye Archive, etc.). Full detail:
`PRODUCT_OVERVIEW.md`.

## CURRENT STATE

This is a large, actively-developed, already-live app — 73 screens, ~53 real database tables,
~44 RPCs, 562 commits. It is not a prototype. Its core loops (discover→join→create→gather,
matching, messaging, community membership, business perks) are genuinely IMPLEMENTED and
functional in the code reviewed. It also carries several concrete, currently-live bugs
(see below) and one major structural gap in how its own schema is source-controlled.

## WHAT IS ALREADY BUILT

- **IMPLEMENTED and solid**: authentication, profiles, gatherings (with capacity/waitlist,
  visibility scoping, live hub, host reputation), communities (roles, calendar), friends
  (requests, circles, mutual-friend surfacing), 1:1 and group messaging (functionally, modulo
  bugs below), business profiles/perks/redemption-with-unlock-thresholds, consumer Premium
  subscription (RevenueCat), business billing math (contract-based, cron-scheduled invoice
  generation), a genuinely privacy-preserving proximity model (no client ever gets another
  person's precise location), and a large relationship-longevity feature suite.
- **PARTIALLY IMPLEMENTED**: business self-serve onboarding (dashboard admits it can't edit its
  own profile yet), AI features (real Anthropic-backed Edge Functions exist and are deployed
  per the app's own history, but end-to-end success was never exercised in a real session by
  anyone who documented it), several safety/security fixes described in the app's own history
  as resolved but not independently re-verified live in this audit (blocking, business-RPC
  ownership checks).
- **REFERENCED BUT NOT IMPLEMENTED**: none found at the level this audit could check — no
  dangling "Coming Soon" UI or broken references to nonexistent routes were observed.
- **NOT FOUND**: any payment processor for business billing; any proof-of-redemption mechanism
  for perks; any self-serve business profile-claiming flow; a real backend search index (search
  is a client-side filter today).

## MOST IMPORTANT UX PROBLEMS

1. `ChatScreen.js` — the app's most-used screen — renders a debug overlay and a literal
   "DEBUG:" error string to real users in production, due to an always-false `__DEV__ ===
   undefined` check.
2. 6 of the app's 11 relationship-longevity tools (arguably its biggest differentiator) are
   reachable only through a single 13-button `Alert.alert()`, an API pattern documented as
   unreliable past 3 buttons on Android — this may be a functional-access bug, not just a
   discoverability nit.
3. 4 separate chat-style screens silently lose a user's message on send failure.
4. 3 real, well-built retention screens (Insights, Momentum, Rewards) are dead ends with no
   outbound CTA — full detail: `UX_GAPS.md`.

## MOST IMPORTANT PRODUCT PROBLEMS

1. The business side of the flywheel has a fully-engineered billing *calculation* layer and
   zero ability to actually collect money (no payment processor).
2. No confirmed mechanism to verify a perk redemption actually happened in person — undermines
   trust in the billing built on top of redemption counts.
3. The "Return" step of the product flywheel is fully instrumented (real streak/delta/tier data)
   and never activated (no proactive nudge uses any of it) — full detail: `PRODUCT_FLYWHEEL.md`.
4. No path exists to invite a non-app-user to a specific event — only to the app generally.

## MOST IMPORTANT TECHNICAL CONCERNS

1. **~45 of ~53 real production database tables have no schema source anywhere in this git
   repository** — they exist only in the live production database. This is the single largest
   technical risk in the codebase: no reproducible environment, no code-reviewable schema
   history for most of the app, no disaster-recovery story beyond the live database itself.
   Full detail: `DATABASE_AND_DATA_MODEL.md`.
2. A handful of previously-reported security fixes (a blocking-bypass bug, business-RPC PII
   exposure) are described as resolved in the app's own internal history but were not
   independently re-tested live in this audit pass — worth fresh verification given severity.
3. Two of the app's largest, most-trafficked screens (`GatheringsScreen.js` at 1421 lines,
   `ChatScreen.js`) carry substantial logic in single files — a real contributor to bugs like
   #1 above going unnoticed.

## TOP 10 RECOMMENDATIONS

1. Fix the `ChatScreen.js` debug-overlay condition immediately — this is shipping visibly
   broken UI to every real user today.
2. Device-test the 13-button `ChatScreen` `Alert.alert` on real Android hardware before doing
   anything else with the relationship-longevity feature set — determine whether this is a
   discoverability problem or an access problem.
3. Stand up a real local/CI-tracked schema (even a one-time full pg_dump committed to the repo,
   going forward paired with real migration discipline) before building anything else on top of
   the current production-only schema.
4. Re-verify live, today, that the `is_blocked()` fix and the business-RPC ownership-check
   fixes actually hold in production — both are safety/privacy-critical and both were only
   confirmed via this app's own internal history, not by this audit.
5. Decide and build a real proof-of-redemption mechanism before scaling the business-billing
   side any further — the billing math is ahead of the trust model it depends on.
6. Either integrate a payment processor for business billing or explicitly deprioritize the
   business-billing feature set until that's planned — draft invoices with no collection path
   is not a viable end state.
7. Add outbound CTAs to `Insights`/`Momentum`/`Rewards` and build one real proactive "you're on
   a streak" / "you're close to a tier" notification — this is the cheapest, highest-leverage
   fix available given the underlying data already exists.
8. Fix the silent-send-failure pattern once, in a shared place, across all 4 chat-style screens.
9. Give the relationship-longevity tools (or whichever survive recommendation #2's test) a real
   entry point from Settings, matching the pattern already used for their 5 siblings that *are*
   listed there.
10. Resolve the small crop of confirmed dead code (`NoticesScreen.js`, the dangling
    `MatchesScreen` import) and the hardcoded-URL/key pattern in `LoginScreen.js`/
    `ProfileScreen.js`/`RehearsalRoomScreen.js` — low effort, removes real maintenance risk.
