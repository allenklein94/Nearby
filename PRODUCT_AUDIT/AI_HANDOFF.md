# AI Handoff — Executive Summary

*This document is a condensed entry point into the full `PRODUCT_AUDIT/` package for another AI
(or a human) doing an independent critique. Everything here is expanded, with citations, in the
other files in this folder. **This is a refresh of the 2026-08-08 original** — see
`AUDIT_CHANGELOG.md` for the complete item-by-item diff. Confidence markers:
**IMPLEMENTED** / **PARTIALLY IMPLEMENTED** / **NOT FOUND** / **UNCLEAR**, plus
**CONFIRMED LIVE** where this refresh actually re-tested a claim against production rather than
just re-reading code.*

## WHAT THE PRODUCT IS

Unchanged since the last audit: Nearby (React Native/Expo, Supabase backend) combines
proximity-based dating, group event hosting ("gatherings"), topic-based standing groups
("communities"), and a local-business perks/sponsorship layer into one app, with a large
secondary suite of post-match relationship-longevity tools. Full detail: `PRODUCT_OVERVIEW.md`.

## CURRENT STATE

Still a large, actively-developed, already-live app — **74 screens** (up from 73: one deleted,
two added), ~53 real database tables (**now all locally reproducible from committed migration
files, replay-verified against a truly empty database** — the single biggest change since the
last audit), ~106 RPCs. 21 commits / 69 files / +14,443/−461 lines landed between the last audit
and this refresh. Its core loops remain genuinely IMPLEMENTED and functional. **Nearly every
concrete bug the last audit found is now fixed** — this refresh's job was substantially "verify
the fixes actually hold," and for the security-shaped ones, that verification was done live
against production, not just by re-reading code.

## WHAT IS ALREADY BUILT

- **IMPLEMENTED and solid, CONFIRMED LIVE this refresh where noted**: authentication, profiles,
  gatherings (now with **live-verified server-side `invite_only` enforcement**, was UI-only),
  communities (the historical RLS-recursion bug **CONFIRMED LIVE fixed**, plus a new
  gathering→community seeding path), friends, 1:1 and group messaging (**both prior bugs — debug
  overlay, silent send failure — now FIXED**), business profiles/perks/redemption (now with a
  **real proof-of-redemption mechanism**), consumer Premium subscription, business billing math,
  a privacy-preserving proximity model (**re-confirmed live**: zero lat/lng columns on
  `profiles`), and the relationship-longevity suite (**now genuinely discoverable**, via a new
  consolidated hub).
- **New since the last audit, IMPLEMENTED**: business self-serve profile editing (closing a
  previously-silent double bug — the old address-edit path had zero UPDATE RLS policy and had
  never actually worked), persistent per-customer CRM notes/tags, a Business AI Assistant
  (structurally confirmed correct — ownership gate, rate limit, and a required dual-client
  `auth.uid()` pattern all live-verified — but the actual Anthropic call path itself remains
  unexercised, same disclosed gap as the other AI features below), a gathering→community seeding
  flow, and a cold-start push-notification-tap fix (a previously-undocumented gap where any push
  tap was silently dropped if the app launched from fully-closed).
- **PARTIALLY IMPLEMENTED**: business self-serve *onboarding* (editing is now fixed; *becoming*
  a partner is still admin-gated), AI features generally (all confirmed correctly deployed and
  structurally sound, but no session in this app's own history or either audit pass has
  exercised a real successful model call end-to-end — this sandbox cannot mint a live session
  token), the "return" retention loop (in-app CTAs now real; the proactive-push half still
  doesn't exist).
- **NOT FOUND, unchanged from the last audit**: any payment processor for business billing; a
  true self-serve business-claiming flow; a real backend search index.

## MOST IMPORTANT UX PROBLEMS — all four from the last audit are resolved

1. ~~`ChatScreen.js` renders a debug overlay in production~~ — **FIXED**, confirmed zero
   remaining references.
2. ~~6 of 11 relationship-longevity tools reachable only via a 13-button `Alert.alert()`~~ —
   **FIXED on both dimensions**: the menu was already a real component before the last audit's
   own snapshot, and a new consolidated hub now makes all 11 tools genuinely discoverable.
3. ~~4 chat-style screens silently lose a message on send failure~~ — **FIXED**, via a shared hook.
4. ~~3 retention screens are dead ends with no CTA~~ — **FIXED** (the CTA half; see product
   problems below for what's still missing).

**What remains, smaller in scope**: `ChemistryDiaryListScreen` still has no add-entry button,
`FeaturesOverviewScreen` still has zero tap-through, and — a genuinely new finding this refresh —
the hardcoded-backend-URL pattern the last audit found in 3 files is confirmed to exist in **15
files total**, not 3.

## MOST IMPORTANT PRODUCT PROBLEMS

1. **Unchanged, still the largest**: the business side has a fully-engineered billing
   *calculation* layer and zero ability to actually collect money — no payment processor exists.
2. ~~No confirmed proof-of-redemption mechanism~~ — **FIXED.** A real 6-digit confirmation-code
   flow now gates what counts toward billing.
3. **Narrowed, not closed**: the flywheel's "Return" step now has real in-app CTAs (was a pure
   dead end); the proactive push notification tying the same signal into a notification still
   doesn't exist. Still the sharpest single fall-out point in the loop, but a smaller gap than
   before.
4. ~~No path to invite a non-app-user to a specific event~~ — **FIXED.** A real share-link path
   exists now.
5. **New, genuinely closed since the last audit**: the flywheel's own biggest deliberately-
   unbuilt gap (no way to spin up a community from a one-off gathering's real attendees) is now
   built.

## MOST IMPORTANT TECHNICAL CONCERNS

1. ~~~45 of ~53 tables have no schema source in git~~ — **RESOLVED, replay-verified against a
   truly empty database**, not just statically read. One real regression was found and fixed
   *during this very refresh* (a duplicate-effect migration left un-archived, which would have
   broken a from-scratch project rebuild) — disclosed plainly rather than glossed over, since it
   shows the class of mistake is still possible even after the main fix landed.
2. ~~Previously-reported security fixes (blocking bypass, business-RPC PII exposure) weren't
   independently re-tested~~ — **RESOLVED.** Both, plus 6 more security-shaped claims this
   refresh could reach, were live-tested against production with real disposable test data,
   cleaned up afterward. All **CONFIRMED SECURE**.
3. **Unchanged**: `GatheringsScreen.js` (1421 lines) and `ChatScreen.js` (1442 lines) remain
   large single-file screens. `BusinessDashboardScreen.js` (1202 lines) now also crosses this
   threshold — a new observation from this session's own churn, not a new class of risk.

## TOP 10 RECOMMENDATIONS — updated for what's actually still open

1. **Integrate a real payment processor for business billing, or explicitly and permanently
   deprioritize the business-billing feature set.** Unchanged as the #1 recommendation — this is
   the last audit's top item and remains completely unaddressed.
2. **Build the proactive "you're on a streak"/"close to a tier" push notification.** Narrower
   than the last audit's #7 (the in-app CTA half is done), but this is now the single highest-
   leverage remaining gap in the retention loop — the data and the in-app half both already
   exist.
3. **Converge the hardcoded-Edge-Function-URL pattern onto the existing `functionUrl()` helper
   for the 12 remaining files**, not just the 3 already fixed — a real, now-fully-scoped cleanup
   item.
4. **Build a true self-serve business-claiming flow** (not just editing, which is now fixed) —
   the remaining half of the business-onboarding bottleneck.
5. **Decide explicitly whether the wide-open `gatherings`/`communities` RLS is an acceptable
   long-term risk posture for `invite_only`/private content**, now that join-time enforcement is
   real but row-visibility enforcement still isn't — a product decision, not a bug.
6. **Add the small remaining discoverability fixes**: a "+ Add Entry" button on
   `ChemistryDiaryListScreen`, tap-through on `FeaturesOverviewScreen`.
7. **Resolve the `AdminBusinessRequestsScreen` Approve/Deny integrity asymmetry** — confirmed
   real this refresh, not yet independently proven exploitable, worth closing regardless.
8. **Add a "withdraw my pending request" action** to `GatheringDetailScreen`'s host-approval
   waiting state.
9. **Split `GatheringsScreen.js`, `ChatScreen.js`, and now `BusinessDashboardScreen.js`** into
   smaller files before the next feature lands in any of them — the exact pattern that made the
   debug-overlay bug hide for as long as it did.
10. **Exercise at least one real end-to-end AI feature call** (any of `ai-concierge`,
    `create-assistant`, `business-ai-assistant`) with a real signed-in session — every one of
    them is structurally confirmed correct and none has ever actually been proven to produce a
    good result, across two audit passes now.
