# Nearby — Product Coherence Audit (2026-08-23)

**Read-only. No application code was touched to produce this.** Every claim below is grounded
in the current repository, not a prior session's memory of it — checked via direct code
reading (navigation params, RPC call sites, screen wiring), the same method this codebase's own
history uses for its "flywheel trace" audits, not a simulator run (no simulator/device access
exists in the environment that produced this). Findings are recommendations for a future,
separately-authorized pass — nothing here has been implemented, per direct instruction.

**Context this audit was run under**: after a heavy multi-day build streak, the standing risk
flipped from *underbuilding* to *fragmenting* — several real user jobs now have more than one
way to accomplish them, built at different times by different passes that didn't always know
about each other. The literal trigger was a pasted screenshot showing two separate business-help
banners on one gathering screen. **Headline finding, stated up front so it isn't buried**: that
specific duplication, and two others named in the same report (AskBusiness vs. MakeAPlan,
Insights vs. Momentum), were **already fixed the same day**, in a convergence pass earlier in
this project's own history (see CLAUDE.md's "Aug 23 2026 — convergence pass: P0/P1/P2"). Verified
directly against current code, not assumed:

- `GatheringDetailScreen.js` now shows one primary "🏪 Find a Business for This Plan →" action
  that expands into the user's own two real underlying mechanisms — never two competing banners.
- `MakeAPlanScreen.js` now has a real `partnerId` mode (business-anchored, no live offer needed)
  alongside its original `offerId` mode — one screen, two real entry contexts.
- `InsightsScreen.js` no longer exists as a file; its content was merged into `MomentumScreen.js`
  ("Your Activity"), and `Insights` is not a registered route.

So this audit is *not* re-discovering those three — it's checking what's real *today*, past that
already-closed work, and looking for what's still open or newly introduced.

---

## AUDIT 1 — 30-Second / Comprehension

**Can a brand-new person understand Nearby, unassisted, in 30 seconds?**

The core hook is legible: Home's hero is a single intent box ("What do you want to do?"),
already given a real visual hero treatment (shadow, larger heading, distinct from every other
card on the screen — a documented, deliberate Aug 14 pass). Typing an ask resolves against real
existing supply (gatherings/communities/friends/perks/businesses) before ever falling through to
"ask a business" — a genuinely different, defensible pitch versus a plain browse app, and it's
the first thing on the screen.

**Real friction against a 30-second read**:
- **Home is long.** Even after a documented hierarchy pass (Aug 14) that cut the header count
  from ~19 sections to a real 5 (Your Plans / Nearby Right Now / Happening Near You / Because You
  Like… / Continue Your Communities), plus contextual banner clusters (pending invites, perks,
  weather, since-away) and a quick-stats row, a first-time scroll still passes through a lot
  before reaching the bottom. None of it is individually unjustified — every section is real,
  signal-backed content, not filler — but the *cumulative* first impression is "there's a lot
  here," which cuts against a 30-second read even though no single section is the problem.
- **Four bottom tabs (Home / People / Create / Activity) plus two header icons (Messages,
  Profile)** is a real, already-converged shape — better than most apps this scope reaches. But
  a first-time user has no way to know "Messages" and "Profile" live in the header, not the tab
  bar, until they notice the two small icons — a minor but real discoverability gap, not a
  structural one.
- **The required onboarding wizard is genuinely light** (3 steps: About You → Photo →
  Interests, already rebuilt from a single crammed form specifically to reduce this friction,
  progress dots, Sign Out safety valve on every step) — this is a real strength, not a gap.

---

## AUDIT 2 — Convergence

**The user's own rule, applied fresh against current code**: *if two screens perform
substantially the same job but originated from different parts of the app, find the canonical
job and converge the entry points into it — don't reflexively preserve both.*

### Already converged — cite these, don't touch them
- **`AskBusinessScreen`** is a genuine single canonical destination reached from **5 different
  real contexts** (Home's intent-result tap for a matched business posting, Home's empty-fallback
  "ask nearby businesses" path, Home's own "Try a Wider Radius" retry, `DateProposalScreen`'s
  "Find Somewhere to Go," and `GatheringDetailScreen`'s merged business-help chooser) — one
  screen, five entry contexts, no duplicate screen anywhere. This is the pattern every other
  convergence finding below should be measured against.
- **`RequestBusinessPartnerScreen`** — same shape, 4 real entry contexts (Create's AI-classified
  "business_partner" intent, Home's own equivalent, the gathering chooser, a community's own
  direct link), one screen.
- **`GroupPlanScreen`** — 7 real entry contexts (a push notification, `BusinessRequestDetail`'s
  three own states, `ActivityScreen`, Home's "Your Plans," `PlansScreen`), one screen.
- **`DiscoverHubScreen`** — one browse/search/map surface, reached from Create's own "browse
  what's already out there" link and Home's own quick shortcuts, not duplicated anywhere.
- **People tab** already matches the target "People → Friends / Dating" model exactly —
  `PeopleScreen.js`'s own `PEOPLE_MODES` is literally `[Dating → Nearby, Friends →
  FriendDiscovery]`. Nothing to converge here; already at the target shape.

### Real, still-open convergence questions

**P1 — `GatheringsScreen` vs. `PlansScreen`: two screens render overlapping "gatherings I'm
going to/hosting" data, and this is a deliberate decision, not an oversight — but it's exactly
the shape this audit exists to surface, so it's named explicitly rather than assumed settled.**
`PlansScreen` (reached from Profile's "Your Plans," Home's "See All Plans") is a real, pure
commitment-calendar view — Upcoming/Hosting/Past, tap-through only, no edit/cancel/approve
actions. `GatheringsScreen`'s own Attending/Hosting tabs show much of the same underlying data
*plus* the real management actions (approve requests, edit, cancel, invite) — and is reached
from `GatheringDetailScreen`'s own "Manage attendees →" link, `DiscoverHubScreen`, Home's
"gatherings today" stat row, and `MomentumScreen`. The split is real and defensible (a pure
calendar glance vs. an active-management surface), but it means the *same core object* — a
gathering you're committed to — renders differently, with a different action set, depending on
which of two screens you happened to land on. Worth an explicit decision, not a silent "this is
fine because it was already reasoned through once."

**P1 — "Rewards" and "Your Activity" (Momentum) are two separate "how am I doing" screens,
correctly not merged, but the split isn't obviously legible from the entry points alone.**
Rewards tracks a real loyalty-tier signal (redemption count against 3 fixed thresholds); Your
Activity tracks a real social-participation streak/deltas/vibe-breakdown/achievements. These are
genuinely different core objects (spend-side loyalty currency vs. social participation) and
should very likely stay separate — flagged in Audit 2's own "keep separate" list below, not as a
merge candidate. The finding here is narrower: Profile shows them as two adjacent rows with
similar visual weight and no framing that tells a first-time reader why they're different
things. A one-line subtitle difference (already present for other rows) would resolve this
cheaply if ever revisited — not urgent enough for P0/P1 on its own, noted here for completeness
and folded into P2 below.

**P2 — the gathering-creation-time "ask local businesses" checkbox and the post-creation "Find a
Business for This Plan" banner are two real, different moments in the same job, and the second
already correctly defers to the first's own consent — but a returning host who ticked the box at
creation time and later opens the gathering sees a *third* wording** ("You asked us to look for
local business options. Ready to see what's available?") that isn't visually connected to either
the original checkbox or the merged banner's own two options. Not a duplication of mechanism —
already one real underlying pipeline — but a real, minor continuity gap in how the same decision
is narrated back to the host across two visits.

**DEFERRED — Inbox's own split into a bottom-tab "Activity" plus a header-icon "Messages" is a
real, deliberate architectural choice (Phase 5, "Build everything" plan) that doesn't fully match
the target one-product model's "Inbox → Messages / Connections / actionable activity" framing,
which describes one umbrella destination.** Today there is no single "Inbox" screen at all —
Activity and Messages are two independently-reachable surfaces (Activity via the tab bar,
Messages via a persistent header icon on all 4 tabs). This was a real, considered decision at the
time (not an oversight — CLAUDE.md documents the reasoning), and the header-icon pattern means
Messages is never more than one tap away regardless of which tab you're on, which meaningfully
softens the "split" concern. Flagged as deferred rather than a fix: reversing this would be a
real navigation-architecture change, and per this file's own Feature Freeze posture, that's
exactly the kind of change that should wait for real usage signal, not be guessed at from an
audit.

---

## AUDIT 3 — One-Product / Ecosystem

Checked against the target reference model (People / Discover / Plans / Businesses / Inbox, with
weather/birthdays/availability/offers/transportation/interests as *intelligence flowing through*
those five, never their own destination) — this is a measurement, not a rebuild spec.

**Confirmed no standalone "Weather" screen exists anywhere** — weather is purely embedded
intelligence (Home's "Right Now" card, plus a real scoring bonus inside `homeRecommendations.js`
that ranks outdoor/indoor gatherings by real forecast risk). This matches the target model
exactly, with zero gap.

### The 12 flow traces

For each: does the user stay in one mental model; does information carry forward or get
re-typed; is the user forced into an unrelated screen; does the business relationship feel
native or bolted on; does the user understand what happened; unnecessary handoffs; consistent
status labels; a better convergence point available.

1. **Person → Friend.** `FriendsScreen`/`FriendDiscovery` (People tab) → `send_friend_request` →
   accept → real `friendships` row. Coherent, one mental model, no handoff. **Clean.**
2. **Person → Date.** `DiscoveryScreen` (People → Dating) → swipe → mutual like → `matches` row →
   `ChatScreen`. Coherent. **Clean.**
3. **Person → Gathering.** A match/friend's own open ask surfaces via the intent resolver's Tier
   2 ("connected people with a compatible ask") or a direct invite. Information carries forward
   correctly (party size, category). **Clean.**
4. **Gathering → Business.** The now-merged "Find a Business for This Plan" banner. One primary
   action, real chooser underneath it. **Clean, per Audit 2's own confirmation above.**
5. **Gathering → Business Offer.** `create_business_request_for_gathering()` → fan-out → real
   competing offers on `BusinessRequestDetailScreen`, reliability-ranked. Real state labels
   throughout (`offered`/`accepted`/`declined`/`expired`). The word "Confirmed" surfaces at this
   layer too, in a different sense than PlanCard's own controlled vocabulary — see the
   terminology finding below. **Mostly clean, one real terminology overlap.**
6. **Business Offer → Confirmed Visit.** `accept_business_offer()` → a real, separate
   `business_reservations` row (`requested → confirmed`, distinct from the Offer's own
   `accepted` status — a deliberate, already-documented split so "the consumer accepted" and
   "the venue actually confirmed" are never conflated). This is a genuine strength — most apps
   collapse these two facts into one status. **Clean, and a real strength.**
7. **Date → Business.** `DateProposalScreen` (propose → explicit mutual accept, "Match ≠ Date" is
   real and enforced server-side, not just a client convention) → "Find Somewhere to Go" →
   `AskBusinessScreen` in match mode → same real offer/accept pipeline as flow 5. Information
   carries forward (both participants, no re-typing party size — it's hardcoded to 2 server-side,
   correctly not user-editable). **Clean, a real strength — this is the flow the pasted external
   feedback specifically asked for, and it already exists end-to-end.**
8. **Birthday/occasion → Plan.** A real advance-notice Home nudge ("🎂 {name}'s birthday is in N
   days — want to plan something?") computed from real `birthdate` data, tapping straight into
   `CreateGathering` with a real prefilled title, no auto-submit. **Clean.**
9. **Weather → Recommendation.** Real forecast-derived bonus/penalty folded into
   `homeRecommendations.js`'s scoring, plus an explicit "N indoor gatherings today" suggestion
   list on bad-weather days. **Clean**, though genuinely time-boxed to a current-conditions API,
   not a real hourly forecast — a known, disclosed data-quality gap elsewhere in this project's
   own history, not new to this audit.
10. **Recommendation → Plan.** "Nearby Right Now" (Home) → a perk-type recommendation gets a
    real "📅 Make a plan →" link straight into `MakeAPlanScreen`; a gathering-type recommendation
    correctly gets no such button (joining the existing gathering already *is* the one-tap
    commitment — building a second "make a plan" action on top would create a literal duplicate
    gathering, and this was explicitly reasoned through and avoided). **Clean, and the "avoided a
    real bug" reasoning here is itself a strength worth preserving.**
11. **Plan → Transportation.** A real Uber deep link ("🚗 Get an Uber there") on the Gathering
    Hub's meet-up point and on every accepted-business-offer card — deliberately just a
    destination-prefilled deep link, not a booking/payment integration, avoiding scope Nearby
    doesn't need. **Clean, and the deliberate restraint here (no fake booking flow) is a real
    strength.**
12. **Completed Visit → Future Recommendation.** `get_my_positive_experience_signals()` (real
    past `gathering_feedback`/`business_offer_outcomes` ratings) feeds a real scoring bonus back
    into `homeRecommendations.js` for a host/business the caller rated positively before, with an
    honest itemized reason ("You loved a gathering with this host before"). **Clean, and a real
    example of the loop the target model describes actually closing.**

**Overall verdict on the 12 flows**: genuinely strong. 10 of 12 trace cleanly with no unnecessary
handoff and real information carry-forward; the two flagged issues are a real terminology overlap
(flow 5) and a known, pre-existing data-quality ceiling (flow 9), neither structural.

### The core object — WHO + WHAT + WHEN + WHERE + WHY + BUSINESS + OFFER

The architecture is genuinely converging around one real object, not building competing
versions of it — `business_requests` is the one shared table every one of flows 4, 5, 7, and 10
writes into and reads from, regardless of which of 4 real origins created it (a solo ask, a
gathering, a confirmed date, a group-plan merge). That's the strongest structural signal in the
whole codebase for "one product, not five bolted together." The one place this gets genuinely
harder to see is **Group Plans**, which introduces a second, adjacent object
(`group_plan_proposals`) sitting *in front of* `business_requests` rather than folding into it —
correct, since a group plan's own roster-consent state has no equivalent anywhere else, but it
means a fifth real "how did this request get created" path exists that the other four don't
share code with as directly. Not a bug — flagged so a future reader understands why Group Plans
reads as slightly more separate than the other four origins.

---

## AUDIT 4 — UI/UX

Per direct instruction, this section is about usability/hierarchy/comprehension/interaction, not
aesthetic preference — nothing below is "this would look nicer."

**Terminology — one real, worth-fixing overlap, not urgent.** The word **"Confirmed"** means at
least three different things depending on which screen it's read on: (a) a `PlanCard`'s
controlled-vocabulary badge, meaning "your own commitment to this plan is locked in"; (b) a
`GroupPlanScreen` proposal's own status text ("Confirmed — a real request is out to nearby
businesses"), meaning the *roster* is locked, not that a venue has agreed to anything yet; (c) a
real `business_reservations.status`, meaning the venue itself has actually confirmed. A user
reading "Confirmed" in a group-plan context could reasonably believe a table is booked when only
the group's own membership is settled. **P1** — not broken, but a real source of the kind of
subtle misread this audit exists to catch, and it sits exactly at the "many states" business →
plan → offer → visit system the audit's own scope called out as worth extra scrutiny.

**Terminology — internal vocabulary leaking into user copy: none found.** Checked the highest-
risk surfaces (business-offer state machine, group plans, the intent resolver) directly — no
occurrence of "resolver," "tier," "SECURITY DEFINER," "fulfillment," "RPC," or similar internal
language in any user-facing string across the screens read for this pass.

**States — the empty/loading/error/pending/accepted/declined/cancelled/completed sweep is
genuinely mature.** This codebase has an unusually thorough, previously-audited history here
(a dedicated Aug 15 2026 pass added real load-error states + retry to every screen found
missing one, plus a shared `LoadErrorState` component reused everywhere) — nothing new surfaced
in this pass beyond the one terminology overlap above.

**Visual hierarchy — Home's primary action is genuinely legible** (real shadow/size treatment
distinct from every other card, per the Aug 14 hierarchy pass); the one real residual concern
is length/cumulative weight, already named in Audit 1, not a hierarchy defect within any single
section.

**Interaction consistency — no new finding.** Confirmation patterns for destructive actions
(cancel a gathering, decline an offer, withdraw a proposal) were spot-checked and are
consistent with this codebase's own established `Alert.alert(...)` convention throughout.

---

## FINAL PRIORITIZATION

### P0 — Fix immediately
*(None found.)* Every named "duplication" this audit set out to check was either already fixed
same-day (Request Business Partner/Ask Local Businesses, AskBusiness/MakeAPlan, Insights/
Momentum) or was never actually a duplication once traced against current code. This is a real,
positive finding in its own right, not an empty section by default.

### P1 — Fix before adding more major features
1. **The "Confirmed" terminology overlap** (Audit 4) — a real, if narrow, misread risk sitting
   exactly in the highest-state-complexity part of the app. Cheapest fix, if picked up: rename
   `GroupPlanScreen`'s own proposal-confirmed copy to something that doesn't reuse the word
   "Confirmed" for a roster-lock event distinct from a venue confirmation.
2. **`GatheringsScreen` vs. `PlansScreen`** (Audit 2) — not broken, but worth an explicit,
   documented decision (keep both with today's real split, or converge further) rather than
   leaving it as an implicit "we reasoned through this once" — exactly the shape of thing this
   audit exists to surface for review, not silently re-confirm.

### P2 — Polish later
1. Profile's Rewards/Your Activity rows could use a one-line subtitle differentiator, matching
   other rows on the same screen — cheap, not urgent.
2. The gathering-creation "ask local businesses" checkbox's three different narrations across a
   host's first visit, later visits, and the merged banner — a real continuity gap, low stakes.
3. Messages/Profile living in header icons rather than the tab bar has no on-screen affordance
   telling a first-time user they exist there — minor discoverability gap.

### DEFERRED — do not touch yet
1. Whether Activity/Messages should re-merge into one literal "Inbox" screen to match the target
   model's naming — a real navigation-architecture question that should wait for actual usage
   data, not be guessed at from an audit, matching this file's own standing Feature Freeze
   posture.
2. Weather's current-conditions-only data ceiling — a known, pre-existing, disclosed gap; a real
   fix needs a genuine forecast API integration decision, not a UI change.

---

### 1. The 5 highest-impact simplifications
1. Give Home's overall length a real "how much is too much" review — not by cutting sections
   (every one is real, justified content), but by re-checking whether the banner cluster +
   quick-stats row + 5 major sections still reads as "a lot" on first open, now that the app has
   grown well past the state the last hierarchy pass was measured against.
2. Resolve the "Confirmed" terminology overlap (P1 above).
3. Add the one-line differentiator between Rewards and Your Activity on Profile.
4. A small, one-time first-open hint pointing at the header Messages/Profile icons (this app
   already has a real "first-run moment" mechanism on Home — the same pattern could extend here
   cheaply).
5. Resolve the GatheringsScreen/PlansScreen split explicitly (P1 above) — even if the outcome is
   "keep both, here's why," writing that decision down converts an implicit judgment call into
   an explicit one a future session won't have to re-derive from scratch.

### 2. The 5 highest-impact convergence opportunities
1. GatheringsScreen ↔ PlansScreen (P1).
2. The "Confirmed" status word across GroupPlanScreen/PlanCard/business_reservations (P1).
3. Rewards ↔ Your Activity framing (not a merge candidate — a labeling clarity opportunity).
4. The gathering-creation-checkbox-to-banner narration continuity (P2).
5. *(No fifth genuine, currently-open convergence opportunity was found beyond these four —
   stated plainly rather than padded to reach a round number.)*

### 3. Screens that should be eliminated
None. Every screen checked in this pass earns its place — including the ones that overlap in
content (GatheringsScreen/PlansScreen), since each serves a real, distinct job even where the
underlying data overlaps.

### 4. Screens that should become canonical destinations
None needed — the canonical-destination pattern is already real and working for every job
checked (AskBusiness, RequestBusinessPartner, GroupPlan, DiscoverHub, People's two modes).

### 5. Terminology that should be standardized
"Confirmed" (P1 above) is the one real, concrete finding. No other systemic terminology drift
was found in this pass.

### 6. Navigation changes
None recommended this pass. The 4-tab + 2-header-icon shape is coherent and was itself the
product of a prior, deliberate restructuring pass — reopening it now, on this audit's evidence
alone, would be exactly the kind of premature architecture change the DEFERRED section above
warns against.

### 7. Flows that should remain intentionally separate
- **Dating vs. Friends** — already correctly kept as two separate matching systems (different
  opt-ins, different swipe tables, different safety rules) under one shared "People Nearby"
  entry model. Confirmed still true; do not merge the underlying engines.
- **Rewards vs. Your Activity** — different core objects (loyalty currency vs. social
  participation); a labeling clarity fix (P2), not a merge.
- **GroupPlanScreen's own object vs. the other 4 request-origins** — correctly separate, since
  roster-consent has no equivalent elsewhere; not a convergence gap, a real distinct job.
- **`GatheringDetailScreen`'s "🎯 Ask a specific business" vs. "📍 Ask nearby businesses"** —
  already correctly converged at the *entry-point* level (one banner, one chooser) while staying
  two real, different transactions underneath (a formal partnership request vs. a broadcast fan-
  out). Do not collapse these into one mechanism — they have genuinely different guarantees.

### 8. Schema/architecture changes that should explicitly NOT be made
- Do **not** fold `group_plan_proposals` into `business_requests` — the roster-consent state it
  tracks (invited/accepted/left, per participant, before a request even exists) has no analog on
  `business_requests` and would either be lost or bolt an unrelated concept onto a table four
  other real flows already depend on staying simple.
- Do **not** merge `business_reservations.status` into the Offer's own status — the deliberate
  split (flow 6 above) is a real strength, not overlap to clean up; collapsing it would
  reintroduce the exact "accepted ≠ confirmed" conflation this codebase already fixed once.
- Do **not** attempt a real forecast-API integration as part of resolving the weather
  terminology/data-quality note — that's a genuine new external dependency/cost decision, not a
  UI fix, and belongs in its own explicitly-scoped future pass if ever picked up.

---

## Direct answers

**A. Can a brand-new user understand Nearby in 30 seconds?** Mostly yes — the intent box is a
real, legible hook and the core "ask, we check what's real nearby first" pitch is clear within
the first screen. The honest caveat: Home's cumulative length means "understand the pitch" and
"feel like you've seen everything at a glance" are two different bars, and only the first one is
cleanly met in 30 seconds.

**B. Does Nearby currently feel like one product?** Yes, more than the pasted screenshot's own
framing suggested — the 12-flow trace found a real, converging core object
(`business_requests`) underneath four of the app's most different-feeling surfaces (a solo ask,
a gathering, a date, a group plan), and the specific duplications the outside report named were
already resolved same-day. The one place it doesn't fully cohere is naming (the "Confirmed"
overlap), not architecture.

**C. What are the biggest remaining sources of cognitive load?** Home's cumulative length (not
any one section), and the "Confirmed" word meaning three different things depending on which
screen it's read on.

**D. What are the biggest duplicate/converging user jobs?** None found at P0. The two real,
open P1 items (GatheringsScreen/PlansScreen, the "Confirmed" overlap) are both narrower and
lower-stakes than what the pasted report assumed going in.

**E. If feature development stopped today, what would be fixed before launch?** The "Confirmed"
terminology overlap, and an explicit written decision on GatheringsScreen vs. PlansScreen —
both P1, both cheap relative to their potential for real user confusion, and both are the kind
of thing a real device pass with a real first-time user would likely surface immediately, which
this codebase has never had the chance to run.
