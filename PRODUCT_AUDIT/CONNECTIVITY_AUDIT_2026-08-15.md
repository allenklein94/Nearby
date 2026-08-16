# Nearby — Full-System Connectivity & Integration Audit (2026-08-15)

**STATUS UPDATE (2026-08-15, same day, direct follow-up pass) — every concrete, actionable
finding in this report is now fixed.** This document is kept as the original point-in-time
report (nothing below this banner has been rewritten to pretend the bugs were never there) —
read `CLAUDE.md`'s "Aug 15 2026 — connectivity audit fixes" sections for the full build/
verification record. Quick map, so this file alone tells you what's still real vs. now closed:
- **Findings C1, C2, C3** (§B items 2/3/5, §D, Domain C) — **FIXED**,
  `supabase/migrations/20260815_v4_group_plan_fixes.sql`. Verified live against production with
  real disposable test data (including reproducing the exact race/orphan scenarios and
  confirming they no longer occur) and via 3 separate from-scratch migration replays.
- **Finding G.1** (§B item 1, §G.1 — group plans invisible from Home/Activity/Plans/pending
  count) — **FIXED**. `getMyGroupPlans()`/`getMyPendingGroupPlanInvites()`
  (`services/groupPlans.js`) now feed Home's "Your Plans", `PlansScreen`, `ActivityScreen`'s
  Invitations group, and `getPendingInvitesCount()`. Verified live under real RLS
  (`set role authenticated`), not just as `postgres`.
- **§F finding** (GroupPlanScreen has no realtime subscription) — **FIXED**, plus a much larger
  bug found while verifying it: the `supabase_realtime` publication only ever had **one** table
  in it (`messages`) — every other realtime channel in this app (gathering/community/business
  chat, message reactions, every relationship-tools collaborative screen,
  `GatheringsScreen`'s live attendee count) had never actually been able to receive a live
  event. Fixed via `supabase/migrations/20260815_v5_realtime_publication_fix.sql`, an idempotent
  migration adding all 16 real tables any client channel subscribes to.
- **§B.8** (documentation gap for `20260815_v2_audit_fixes.sql`) — **FIXED**; that migration and
  its own bugs are now recorded in `CLAUDE.md`.
- **Top-10 item 6** (stale `proposed_time` on the business offer modal) — **FIXED**, one-line
  local-state reset in `BusinessDashboardScreen.js`.
- **Top-10 item 7** (two-round-trip group-plan consent cost) — **not a defect**, per this
  report's own original framing — explicitly working as designed, nothing to fix.
- **Everything marked NOT REACHED/UNVERIFIED below is still exactly that** — a full type/
  contract sweep across all ~40 service files, a full RLS resweep beyond group plans,
  gathering/`gathering_interest` state-machine re-verification, and performance/scale beyond
  `SCALABILITY_AUDIT.md` were explicitly **not** attempted in the same follow-up pass, per this
  report's own §I item 7 recommendation to keep each as its own dedicated future pass rather
  than bundle them in. No manual simulator/device run-through has been done for anything in this
  report or its fixes — standing limitation, same as everywhere else in this codebase's history.

---

**Scope note, stated honestly up front rather than padded**: the original plan for this audit
was 8 parallel research domains covering all 24 sections of the requested spec exhaustively.
Background-fork dispatch proved unreliable in this environment (two forks misread their own
scope as "you're the orchestrator" and produced no usable output before erroring; one hit a real
session-limit API error mid-run) — see `CONNECTIVITY_AUDIT_PROGRESS.md` for the full account.
One fork did produce a genuinely thorough result (the Phase D / group-plan deep-dive, kept
verbatim as `connectivity_domain_C_group_merge.md` and folded in below). Everything else in this
report is direct code-reading by the primary session, focused on the **highest-risk, newest, and
least-previously-scrutinized** surfaces — Phase D group plans (this app's most complex
distributed-state feature, added the same day), cross-feature visibility of that feature from
Home/Activity/Plans/notifications, notification-type routing completeness, navigation dead-links,
and a fake-connectivity sweep — rather than a uniform re-verification of all 24 sections. Where a
claim rests on this codebase's own extensive prior build log (`CLAUDE.md`) rather than something
independently re-verified this pass, it's marked as such. Nothing here modifies any code.

---

## A. Executive Summary

**Overall assessment: Mostly integrated, with one real, confirmed architectural gap in the
newest feature (Phase D group plans) that keeps it from being fully part of the system it was
built into.**

Estimated connectivity: **~85%.** Reasoning: the core consumer↔business request/offer/accept
lifecycle (the oldest and most-exercised part of the system) is genuinely solid — state
transitions are DB-enforced with row locks, RLS is correctly scoped everywhere checked, every
real push-notification type sent from the backend has a real client-side route (42/42 verified,
zero gaps either direction), navigation has zero dangling `navigate()` calls to unregistered
routes, and a sweep for TODOs/mock data/placeholder logic came back clean. The deduction is
concentrated almost entirely in one place: **Phase D (group plans) is functionally complete and
internally correct in isolation, but is invisible from every aggregate surface in the app**
(Home, Activity, the dedicated Plans screen, the pending-invites count) **and has two real race
conditions plus one real state-cleanup gap** in its own internal logic. That single feature
accounts for the majority of the P1 findings below. Everything else audited this pass reads as
genuinely connected, not just visually present.

This is not a "fully integrated" 95%+ verdict because: (1) Group plans, a real and recently-
shipped feature, has a real "Feature A works, Feature B works, A→B is broken" gap — exactly the
shape of problem this audit was asked to find; (2) two real race conditions exist in
`confirm_group_plan_offer` and (more narrowly) cross-proposal double-commitment; (3) this pass
did not reach several of the originally-planned domains (performance/scale beyond what
`SCALABILITY_AUDIT.md` already covered, a full type-contract sweep across every service file,
exhaustive failure-mode reasoning for every mutation) — those are marked NOT REACHED below, not
assumed clean.

---

## B. Top 10 Connectivity Problems (ranked)

1. **[FIXED 2026-08-15, same day] P1 — Group plans are entirely absent from Home, Activity, the dedicated Plans screen, and
   the app-wide pending-invites count.** The only way to discover a pending group-plan invite,
   a budget that needs your re-consent, or an offer waiting on your confirmation is a push
   notification tap — if it's missed, dismissed, or the device didn't receive it, there is no
   other path to it anywhere in the app. See §G.1 below.
2. **[FIXED 2026-08-15, same day] P1 — `confirm_group_plan` merges a participant's individual request without cascading to
   that request's own already-generated `business_request_offers` rows**, leaving orphaned
   `pending`/`offered` offers that render incoherently (a blank, unexplained row on the business
   dashboard; a live but always-server-rejected "Accept This Offer" button next to the correct
   "went to a group plan" banner on the consumer's screen). Domain C Finding C1.
3. **[FIXED 2026-08-15, same day] P1 — `confirm_group_plan_offer` has no row lock on its quorum-counting path** — the exact
   "last person to act triggers an irreversible transaction" race this codebase's own Aug 15
   architecture-hardening pass explicitly closed for `accept_business_offer`/
   `approve_gathering_interest`, left open here because this function was added the same day but
   in a different migration. Concrete failure: 2 of 2 remaining confirmations tapped
   concurrently can both read "not yet at quorum" and never trigger acceptance even though the
   true committed state has reached quorum. Domain C Finding C2.
4. **[FIXED 2026-08-15, same day] P2 — `GroupPlanScreen` has no realtime subscription**, only a focus-triggered refetch — a
   participant actively viewing the screen while another participant confirms/leaves/gets
   excluded sees stale state (a stale "N of M confirmed" count in particular) until they
   navigate away and back. Every other multi-party live-coordination surface in this codebase
   (chat, both group-chat variants, business messaging) uses a real Supabase Realtime channel;
   this is the one new exception.
5. **[FIXED 2026-08-15, same day] P2 — No exclusivity between two concurrently-pending group-plan proposals inviting the same
   person's still-open request** — a real, DB-unenforced gap (no unique constraint), narrower
   window than #2/#3 but the same underlying class of problem: one person's party size/capacity
   can be double-committed across two unrelated group plans. Domain C Finding C3.
6. **[FIXED 2026-08-15, same day] P2 — `business_request_offers.proposed_time`/offer-type edit history has one known,
   previously-disclosed non-blocking gap** (re-selecting "Alt. time" after switching away can
   leave a stale proposed time attached) — carried over from CLAUDE.md's own disclosed-not-fixed
   list, re-confirmed still true, not re-litigated in depth this pass; included here only so it
   isn't silently dropped from a connectivity report that's specifically about exactly this class
   of gap.
7. **[NOT A DEFECT — no fix needed] P3 — Two-round-trip consent cost for every real group plan** (accept invite → get reset to
   `invited` the moment the initiator sets a budget, even on the very first budget-set call →
   re-accept) is a real, working-as-designed UX cost of rule 7's own re-consent requirement, not
   a defect — flagged because it's exactly the kind of "does the state machine actually work the
   way the product intends" question this audit asks, and it's worth the product owner knowing
   it applies on the *first* budget-set, not just later changes.
8. **[FIXED 2026-08-15, same day] P3 (documentation gap, not a code gap) — `20260815_v2_audit_fixes.sql` and its own source
   report (`PRODUCT_AUDIT/V2_ACCEPTANCE_REPORT_2026-08-15.md`) are both real, applied, and
   correct, but CLAUDE.md's own build log — which otherwise documents literally every other
   schema change in this repo's history — never mentions either.** A future session reading only
   CLAUDE.md (which explicitly tells every session to do exactly that) would not know this fix
   exists and could plausibly reintroduce the `intent_visibility` bypass or the UTC-bucketing bug
   it fixed. Low severity (the fix itself is correct and live) but a real process gap.
9. **UNVERIFIED, flagged not assumed — realtime coverage beyond chat/group-plan wasn't
   exhaustively re-audited this pass.** CLAUDE.md documents several previously-found-and-fixed
   realtime channel leaks (`ChatScreen.js`'s messages/reactions channels not cleaned up on
   unmount, fixed same day as found). Whether every *newer* screen added since (Business
   dashboards, `MarketValidationScreen`, `MyBusinessApplicationScreen`, etc.) that might
   plausibly want realtime either has it correctly or correctly doesn't need it was not
   independently re-swept this pass — marked NOT REACHED, not clean.
10. **UNVERIFIED, flagged not assumed — full type/contract consistency sweep (service function
    return shape vs. what every calling screen destructures) across the whole app was not done
    this pass**, beyond what was incidentally checked while reading the group-plan and
    notification-routing code. This is exactly the class of bug CLAUDE.md's own history has
    found more than once in isolated spot-checks (e.g. the `bonus_notices`/`is_admin` guarded-
    column gaps, the `loadingInitial` destructuring gap across 4 chat screens) — a systematic
    sweep of this kind across all ~40 service files was in the original 8-domain plan (Domain A)
    but wasn't completed given the tooling issues; worth a dedicated future pass, not assumed
    clean by omission here.

---

## C. Critical Dependency Map

```
User → Profile → Friends/Matches → intent (ask) → business_requests (individual)
                                                       │
                          ┌────────────────────────────┼─────────────────────────────┐
                          ▼                             ▼                             ▼
                  _business_request_fanout      resolveConnectedRequests       (Tier 2: friend's
                  → business_request_offers       (Home intent resolver)        own open request
                  (pending)                                                     surfaced to you)
                          │
                          ▼
              Business responds (submit_business_offer) ──► offer.status = 'offered'
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
   Solo accept path              Group plan path (NEW, Phase D)
   accept_business_offer()       propose_group_plan → respond_to_group_plan (per-participant
   (requester-only, blocked        consent) → set_group_plan_budget (re-consent reset) →
   entirely if request.group_      confirm_group_plan (creates ONE shared business_requests
   plan_id is set — verified)      row, flips each source request to 'merged' — ⚠ does NOT
              │                    cascade to that source request's own pending/offered
              │                    offers, Finding C1) → fan-out again on the shared request
              │                    → confirm_group_plan_offer (per-participant quorum, ⚠ no
              │                    row lock on the count read, Finding C2) →
              │                    _accept_business_offer_internal (same accept logic, minus
              │                    ownership check)
              ▼                        ▼
     business_requests.status='fulfilled', offer.status='accepted', offer.completed_at later
              │
              ▼
     Notification fires (verified: every real backend push `type` has a matching client route,
     42/42, zero gap) → routeNotificationTap() → correct screen
              │
              ▼
     Downstream UI: BusinessRequestDetailScreen (✅ correct), BusinessDashboardScreen (✅ for
     solo; ⚠ blank/unexplained row for a merged-and-orphaned offer, Finding C1),
     Home "Your Plans" / PlansScreen / ActivityScreen — ❌ BROKEN LINK: none of these three
     know group_plan_proposals/group_plan_participants exist at all. A pending or confirmed
     group plan is 100% invisible from every one of Nearby's three primary "what's going on
     with me" surfaces.
```

**Broken links found in this map, stated plainly**:
- `business_requests(merged).status` → its own child `business_request_offers` rows: **link
  missing** (Finding C1).
- `group_plan_proposals`/`group_plan_participants` → `Home` / `ActivityScreen` / `PlansScreen` /
  `getPendingInvitesCount()`: **link missing entirely** (Finding G.1, this pass's own new
  finding, detail below).
- Everything else in the diagram above was traced and confirmed connected (Request→Offer→Accept→
  Notification→correct downstream screen), including the solo (non-group) path end-to-end.

---

## D. State-Machine Problems

### `business_requests.status`: `open → fulfilled | expired | cancelled | merged`
- All 4 terminal-ish transitions are DB-enforced (RPC-gated), no client-only enforcement found.
- `cancel_business_request` and `expire_stale_business_requests` both correctly cascade to child
  `business_request_offers` (flip pending/offered → cancelled/expired in the same statement
  block).
- **`confirm_group_plan`'s `open → merged` transition is the one exception that does NOT
  cascade** — Finding C1. This is a genuine, isolated gap in an otherwise-consistent pattern
  (every other "this request stops being open" path in the schema does cascade).

### `business_request_offers.status`: `pending → offered → accepted | declined | expired |
cancelled → completed`
- Double-accept prevented by a real partial unique index (`unique(request_id) where status in
  ('accepted','completed')`) — re-confirmed present.
- `accept_business_offer` correctly refuses to fire for a `group_plan_id`-bearing request when
  called by the plain requester path — re-verified against the *current* function body, not an
  older migration (Domain C).
- **Race**: `confirm_group_plan_offer`'s path to `_accept_business_offer_internal` is reachable
  without a lock on the count read — Finding C2, a real, reproducible "both callers see
  sub-quorum, neither triggers, but the true state is at quorum" scenario under READ COMMITTED.

### `group_plan_proposals.status`: `pending → confirmed | cancelled | expired`
- `respond_to_group_plan` correctly double-response-guards and expiry-guards.
- `confirm_group_plan` correctly requires `pending` and is itself lock-guarded (no duplicate
  merged-request creation on a retried call).
- **Cross-proposal gap**: no DB constraint prevents the same still-open individual request from
  being a live participant in two *different* concurrently-pending proposals — Finding C3.

### `gatherings` / `gathering_interest.status`
- Not independently re-traced this pass (CLAUDE.md documents a real, previously-found-and-fixed
  race here too — `approve_gathering_interest`'s missing lock, fixed in the Aug 15
  architecture-hardening pass, with a live regression test proving the fix holds). Not
  re-verified against current code this pass — carried forward as **UNVERIFIED (not re-checked,
  not assumed broken)**.

---

## E. Database / RLS Problems

- **Group-plan RLS, re-verified this pass, no gap found**: `group_plan_proposals` SELECT is
  `initiator_id = auth.uid() OR is_group_plan_participant(...)`; `group_plan_participants` and
  `group_plan_offer_confirmations` both correctly scope to the same helper; the two additive
  policies on `business_requests`/`business_request_offers` for group-plan visibility are
  correctly `AND`-scoped to `is_group_plan_participant`, not a blanket widen. `is_group_plan_
  participant()` itself correctly refuses to answer for a pair not involving the caller (same
  defensive shape as the codebase's existing `is_blocked()`). **No security gap found in this
  specific area.**
- **`20260815_v2_audit_fixes.sql` (background finding, not part of this pass's own primary
  scope, but real and worth restating)**: fixed a genuine `intent_visibility='nobody'` bypass in
  `get_my_group_intent_signals()` and its notify trigger (an opted-out user's name/request was
  still surfaced to their network) and a UTC-vs-local-timezone bucketing bug in
  `get_cross_user_intent_patterns()`. Both are already fixed and live — flagged here only
  because CLAUDE.md's own changelog never records either the bug or the fix, a documentation
  gap (§B.8).
- **Everything else RLS-related** (the ~50 other tables) was **not independently re-audited this
  pass** — CLAUDE.md's own history documents an extensive, real prior security-hardening effort
  (the `is_blocked()` SECURITY DEFINER fix, the admin-self-escalation fix, the business-RPC
  ownership-check fix, the AI-rate-limit-ownership fix — all with live-verified before/after
  proof at the time). Not re-verified this pass; carried forward as **UNVERIFIED, not
  re-checked, not assumed broken or clean**.

---

## F. Realtime Problems

- **`GroupPlanScreen.js` has zero realtime subscription** — confirmed via direct read, only a
  single `useFocusEffect(() => { load(); })`. Every comparable multi-party live-coordination
  screen in this app (1:1 chat, gathering chat, community chat, business conversation) has a
  real Realtime channel. This is a real, isolated inconsistency for the app's newest
  multi-party-coordination surface. P2 — not a correctness bug (data is never wrong, just
  stale-until-refocus), but a real UX gap for exactly the kind of "did the last person just
  confirm" moment where staleness matters most.
- **Everything else realtime-related**: **NOT REACHED this pass.** CLAUDE.md documents a real,
  fixed history here (leaked channels in `ChatScreen.js`, missing realtime replaced for polling
  in `GatheringChatScreen.js`/`CommunityChatScreen.js`/`BusinessConversationScreen.js`) — not
  independently re-verified this pass whether anything has regressed since, and whether every
  screen added after that pass (there have been many) correctly does or doesn't need a
  subscription. Flagged as a real gap in this audit's own coverage, not claimed clean.

---

## G. UX / Data-Consistency Problems

### G.1 — NEW FINDING, this pass, P1: group plans are invisible from every aggregate "what's
going on with me" surface

Verified directly, not inferred:
- `src/services/homeDashboard.js` — zero references to `group_plan` anywhere in the file.
- `src/screens/ActivityScreen.js` — zero references.
- `src/screens/PlansScreen.js` (the dedicated Upcoming/Hosting/Past screen, built specifically
  to be "the one canonical place for every upcoming commitment," per its own CLAUDE.md build
  notes) — zero references to `group_plan` or `business_request`.
- `getPendingInvitesCount()` (`homeDashboard.js:111-122`, the function behind Home's
  pending-invites banner **and** the Inbox tab badge count) sums exactly three sources —
  pending host-approval gathering requests, pending friend requests, pending social invites —
  and has zero awareness that `group_plan_participants` rows with `status='invited'` exist.
- The **only** way to reach `GroupPlanScreen` anywhere in the app is: (a) tapping one of the 5
  real `group_plan_*` push notifications (verified correctly routed, §Top-10 item — but a missed
  or dismissed push is a dead end), or (b) already being on the exact
  `BusinessRequestDetailScreen` for the specific individual request that started the group plan,
  which itself surfaces a "View Group Plan"/"Confirm With the Group" link only when you happen to
  navigate back to that specific original request.

**Why it matters**: this is the textbook "Feature A works by itself, Feature B works by itself,
A→B is broken" shape the audit was asked to find. Group Plans (Phase D) is a fully-built, mostly-
correct (2 real races aside) feature that is functionally quarantined from the rest of the app's
own navigation model — a user who misses the one push notification for a pending budget-reset,
a "your confirmation is needed" nudge, or a newly-received offer on their group plan has no
other way to discover it, ever, short of remembering the exact original request screen.

**Recommended fix**: add group-plan awareness to `getPendingInvitesCount()` (a 4th `Promise.all`
branch counting `group_plan_participants` rows with `status='invited'` for the caller, plus
rows needing the caller's `group_plan_offer_confirmations` action) and to `getHomeDashboard()`'s
"Your Plans" computation (a confirmed group plan's resulting `business_requests` row should
appear there the same way any other upcoming plan does — it already has `group_plan_id` set,
which is a real, queryable signal). Backend/RPC-adjacent for the count; frontend query-shape
change for Home/Activity/Plans. Low risk of breaking anything else — purely additive.

### G.2 — Finding C1 (Domain C), restated here since it's fundamentally a UX/data-consistency
problem, not just a state-machine one

A merged individual request's own already-generated offer rows are shown incoherently on both
the business dashboard (a blank row, unexplained) and the consumer's own request-detail screen
(a live "Accept This Offer" button next to the correct "this became a group plan" banner, that
always dead-ends in a server rejection if tapped). See §B.2/§D for full detail.

### G.3 — Everything else (Home vs. Activity vs. Plans "upcoming" definitions, participant-count
duplication elsewhere, etc.)

**NOT independently re-verified this pass.** CLAUDE.md's own build log documents a real, multi-
round effort specifically targeting this exact class of problem for the non-group-plan parts of
the app (the IA restructure rounds 2 and 3, Activity's Needs-Attention/Today/Earlier split, the
narrowed same-day-only "Today" window vs. Home's full "Your Plans" — explicitly designed so the
two surfaces have genuinely different jobs rather than duplicating the same fact). This wasn't
re-read line-by-line this pass to independently confirm it still holds after everything built
on top of it since (in particular: does anything built after that IA work — the V2/V3/V4 passes,
Phase D — introduce a *new* duplicate-computation the way group plans did for pending-invite
counting?). Flagged as **UNVERIFIED, not re-checked, not assumed clean or broken.**

---

## H. Missing Functionality (product needs it, codebase doesn't have it — or has it but it's
disconnected)

- **Group plans have no aggregate-visibility surface** — covered in full above (G.1). This is
  "implemented + disconnected," not "missing entirely": every piece exists, it's just not wired
  into the app's own primary navigation hubs.
- **`confirm_group_plan`'s cascade-to-child-offers step is missing entirely** — a real, small,
  well-scoped gap (§B.2), not a design question; the fix pattern already exists twice elsewhere
  in the same schema (`cancel_business_request`, `expire_stale_business_requests`) to copy from.
- **No row-lock on `confirm_group_plan_offer`'s quorum count** is a missing safeguard, not a
  missing feature — the fix is one `for update` clause, matching a pattern this exact codebase
  already applied to 3 other functions the same day this one was built.
- Everything else nominated as "missing" in the original 24-section spec (a true payment
  processor, load testing/production monitoring, an AI-driven single blended match score, etc.)
  is **already explicitly and deliberately not built**, per CLAUDE.md's own standing, repeatedly-
  reaffirmed decisions — not re-litigated here as a fresh finding.

---

## I. Recommended Fix Order (dependency-aware, not just "fix P0s first")

**All 6 items below are now FIXED (2026-08-15, same day, direct follow-up pass) — see the STATUS
UPDATE banner at the top of this file and `CLAUDE.md`'s own "connectivity audit fixes" sections
for the full build/verification record. Fix order below is left exactly as originally
recommended, for the record — items 1-3 were bundled into one migration as suggested (#3 note),
#4/#5 landed together in a second pass, #6 is this file's own sibling doc-fix.**

1. **[FIXED] `confirm_group_plan_offer` row lock (Finding C2)** — smallest, most isolated fix (one
   `for update` clause on 2 rows already being read), and it's the one true correctness bug with
   silent-data-loss potential (a reservation that should have happened doesn't) in this whole
   report. Fix this first because every other group-plan fix below touches the same function
   family and should be built/tested against the corrected locking behavior, not around it.
2. **[FIXED] `confirm_group_plan` cascade-to-offers (Finding C1)** — database/RPC layer, same migration
   file family as #1, no frontend change needed once shipped (existing UI gates already
   correctly suppress a properly-`expired` offer with zero further work). Do this second because
   it's the other real state-corruption-adjacent bug and, like #1, is purely additive SQL with a
   copy-paste-able pattern already proven twice elsewhere in this schema.
3. **[FIXED] Cross-proposal exclusivity (Finding C3)** — same layer, same family, lower urgency (narrower
   race window) — bundle into the same migration as #1/#2 since all three touch the same
   functions and this is the natural point to also close this while already in the file.
4. **[FIXED] Group-plan visibility on Home/Activity/Plans/pending-count (Finding G.1)** — depends on #1-3
   being done first only in the sense that it's better to wire up a *correct* group-plan state
   into the app's primary surfaces than a still-racy one; not a hard technical dependency, but
   the right sequencing. This is the single highest-product-value fix in this whole report — a
   fully-built feature is currently unreachable for anyone who misses one push notification.
5. **[FIXED] `GroupPlanScreen` realtime subscription (Finding, §F)** — frontend-only, independent of 1-4,
   can happen in parallel with any of them. **This fix's own verification surfaced a much larger
   bug**: the `supabase_realtime` publication only had one table in it (`messages`) — every other
   realtime channel in the app had never been able to receive a live event. Fixed in the same
   migration (`20260815_v5_realtime_publication_fix.sql`).
6. **[FIXED] CLAUDE.md documentation gap for `20260815_v2_audit_fixes.sql`** — pure documentation, zero
   code risk, do whenever convenient; matters only so a future session doesn't rediscover or
   accidentally reintroduce either bug it already fixed.
7. **[STILL OPEN, unchanged] The NOT REACHED items** (full type/contract sweep, full realtime-leak resweep beyond
   GroupPlanScreen, full RLS resweep beyond group plans, gathering/gathering_interest state-
   machine re-verification, performance/scale beyond the existing `SCALABILITY_AUDIT.md`) —
   recommend a dedicated follow-up pass per item, not bundled into the same session as 1-6 above,
   given how much ground each one covers on its own (see `CONNECTIVITY_AUDIT_PROGRESS.md`'s own
   domain-scope descriptions for exactly what each would need to cover).

---

## Connectivity Matrix (this pass's actual coverage — original point-in-time table, left
unedited; see the STATUS UPDATE banner at the top of this file for what's since been fixed)

| Area | UI | Backend | DB | RLS | Realtime | Notifications | Navigation |
|---|---|---|---|---|---|---|---|
| Solo business request→offer→accept | 🟢 | 🟢 | 🟢 | 🟢 (spot-checked, group-plan-adjacent) | ⚪ n/a | 🟢 (42/42 routed) | 🟢 |
| Group plans (Phase D) | 🟡 (2 races + 1 orphan-state bug) → **all FIXED 2026-08-15** | 🟡 → **FIXED** | 🟢 (RLS itself clean) | 🟢 | 🔴 (none) → **FIXED, real channel added** | 🟢 (routing correct, just unreachable without the push) | 🔴 (invisible from Home/Activity/Plans) → **FIXED** |
| Notification routing (all 42 real types) | 🟢 | 🟢 | ⚪ | ⚪ | ⚪ | 🟢 | 🟢 |
| Navigation graph (registered vs. called routes) | 🟢 (zero dangling calls found) | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | 🟢 |
| Fake-connectivity sweep (TODO/mock/placeholder) | 🟢 (clean) | 🟢 (clean) | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| Gathering/gathering_interest state machine | ⚪ NOT REACHED | ⚪ NOT REACHED | ⚪ NOT REACHED | ⚪ NOT REACHED | ⚪ NOT REACHED | ⚪ NOT REACHED | ⚪ NOT REACHED |
| Home/Activity/Plans non-group-plan consistency | ⚪ NOT REACHED (relies on prior CLAUDE.md work, not re-verified) | | | | | | |
| Full type/contract sweep, full RLS resweep, performance/scale | ⚪ NOT REACHED | | | | | | |
| *(new, found during the fix pass, not part of the original audit)* Realtime publication had only 1 of 16 needed tables | 🔴 → **FIXED, all 16 tables added** (`20260815_v5_realtime_publication_fix.sql`) | | | | | | |

**🟢 = verified this pass with real citations. 🟡 = verified, real issue found. 🔴 = verified,
broken. ⚪ = not applicable to this row, or explicitly not reached this pass (never claimed
clean by omission). Rows still marked NOT REACHED remain genuinely not reached — the follow-up
fix pass did not attempt them, per §I item 7's own recommendation.**

---

*Full Phase D detail with line-by-line evidence: `connectivity_domain_C_group_merge.md`. Audit
process/method record: `CONNECTIVITY_AUDIT_PROGRESS.md`.*
