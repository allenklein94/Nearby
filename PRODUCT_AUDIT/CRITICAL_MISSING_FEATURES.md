# Critical Missing Features / Gaps — Ranked

*Basis ONLY on what was directly observed in this codebase across the other audit files —
nothing here is inferred from a roadmap doc, comment, or discussion. P0 = actively broken or
blocking today · P1 = important, real product/business impact · P2 = valuable later, not urgent.*

## P0 — actively broken or high-severity, today

1. **`ChatScreen.js` renders a debug overlay + literal "DEBUG:" text to every real user, on
   every message bubble.** A `__DEV__ === undefined` check that's always false means this ships
   in production, not just dev builds. This is the app's single most-used screen. Independently
   re-verified in this pass. *Why it matters*: directly, visibly undermines trust/polish in the
   core messaging surface the entire "connect" half of the flywheel depends on.
2. **6 of 11 relationship-longevity screens are reachable only via a 13-button
   `Alert.alert()`**, an API documented as unreliable beyond 3 buttons on Android. *Why it
   matters*: this app's stated key differentiator (see `PRODUCT_OVERVIEW.md`) may be
   functionally inaccessible, not just hard to find, for a meaningful share of the user base —
   this needs an actual device test before anything else about this feature set is prioritized.
3. **~45 of ~53 real production database tables have no `CREATE TABLE` anywhere in this git
   repository.** *Why it matters*: no way to reconstruct the schema from source control, no way
   to stand up a real staging environment, no code-reviewable history for the majority of the
   data model, and a single point of failure for disaster recovery. This is infrastructure risk
   underneath every other feature in the app.
4. **The historical `is_blocked()` safety bug (blocked users could still see/message their
   blocker) is reported fixed but was not independently re-verified live in this pass.** *Why
   it matters*: blocking is the app's core user-safety primitive; an unconfirmed fix to it is a
   standing risk until someone actually re-runs the live test.
5. **Several business-facing analytics RPCs reportedly had no ownership check** (any
   authenticated user could pull another business's named-attendee PII) — reported fixed, not
   independently re-verified. *Why it matters*: a real PII exposure if the fix doesn't hold;
   businesses trusting this platform with their customer data is core to the whole business
   side of the product.
6. **4 chat-style screens (1:1, gathering, community, business) silently drop a user's message
   on send failure**, after already clearing the composer. *Why it matters*: silent data loss
   in the core communication primitive, with zero user-facing signal that anything went wrong.

## P1 — important, real product/business impact

7. **No payment processor is integrated for business billing.** Real usage-based invoice math
   runs on a schedule and writes real `draft` invoices — but no money has ever moved and none
   can, today. *Why it matters*: this is the entire business-side revenue model, fully
   engineered on the accounting side and completely absent on the collection side.
8. **No proof-of-redemption mechanism was found for business perks.** *Why it matters*: if a
   redemption can be recorded without the business actually confirming the visit happened, the
   billing built on top of redemption counts inherits that trust gap — directly undermines
   point 7's entire premise.
9. **Business self-serve onboarding is incomplete** — no confirmed self-claim flow for
   `managed_partner_id`, and the dashboard admits it can't edit the business's own
   name/description/logo yet. *Why it matters*: a real bottleneck on scaling the number of
   active local businesses without manual/support intervention per partner.
10. **No proactive "return" nudge exists**, despite `Insights`/`Momentum`/`Rewards` computing
    exactly the real signals (streaks, deltas, tier proximity) that should drive one. *Why it
    matters*: per `PRODUCT_FLYWHEEL.md`, this is the sharpest fall-out point in the entire
    loop — the retention signal is fully instrumented and never activated.
11. **No path exists to invite a non-app-user to a specific gathering/event** — only to the app
    generally (referral code) or to an existing friend already on the app (`social_invites`).
    *Why it matters*: this caps the viral surface of the app's single strongest growth
    mechanic (a specific, real-world event is a much stronger invite hook than a generic
    referral code).
12. **`Insights`, `Momentum`, and `Rewards` are all dead-end screens with no outbound CTA.**
    *Why it matters*: real, honest data with nothing driving action off of it — a retention
    opportunity that's built but inert.
13. **No nudge to join the community behind a gathering a user just attended.** *Why it
    matters*: per `PRODUCT_FLYWHEEL.md`, this is a natural, low-effort conversion point in the
    Gather→Community step that currently requires the user to notice and act on their own.
14. **Whether a business can unilaterally host its own gathering (vs. only sponsor a
    consumer's) is UNCLEAR from the code reviewed.** *Why it matters*: materially affects how
    much value a business can get from the platform without depending on a consumer host first
    — worth a direct product/engineering answer, not left ambiguous.

## P2 — valuable later, not urgent

15. **`PlacesScreen.js`'s empty state never renders** due to a malformed `FlatList` prop. Minor,
    isolated, easy fix, low current traffic relative to other screens.
16. **`OnboardingRecommendationsScreen`'s recommendation cards all navigate identically**
    regardless of which was tapped — undermines a first-impression personalization moment, but
    a small, isolated fix.
17. **`NoticesScreen.js` is fully dead code** and **`MatchesScreen`'s `RootNavigator.js` import
    is a dangling maintenance trap** — both hygiene issues, not user-facing.
18. **Search across gatherings/communities/perks is a client-side filter, not a real backend
    index.** Fine at today's data volume; a real ceiling once any metro area has hundreds of
    active gatherings.
19. **Hardcoded backend URLs/keys appear inline in at least 3 components** (`LoginScreen.js`,
    `ProfileScreen.js`, `RehearsalRoomScreen.js`) instead of going through the shared services
    layer — a consistency/maintainability issue, not a live security hole by itself (the keys
    involved are publishable/anon-tier), but a pattern worth converging.
20. **`GatheringsScreen.js` (1421 lines) and `ChatScreen.js` are large, single-file mega-screens**
    carrying substantial business logic directly in the component. Not a functional defect
    today, but a real contributor to bugs like item 1 going unnoticed, and a growing
    maintenance cost.
