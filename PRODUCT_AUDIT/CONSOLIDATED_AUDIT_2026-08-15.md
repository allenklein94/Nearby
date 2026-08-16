# Nearby — Consolidated Backend/Connectivity Audit (through 2026-08-15)

**Purpose**: a single reference that merges nine separate audit-style reports written between
2026-08-09 and 2026-08-15 into one status ledger and one narrative, so a reader doesn't have to
cross-reference nine files (with different dates, different scopes, and — in a few cases —
findings that were later fixed by a *different* report than the one that found them) to answer
"what's actually still broken in this backend right now."

**This file supersedes none of its sources** — each original is left exactly as written (several
of them are point-in-time audit snapshots that intentionally were never edited after the fact, so
the record of what was true *when found* stays intact). This document is a synthesis layer on top,
re-verified against the live repo one more time while consolidating (see the "Re-verified while
consolidating" callouts below) so its status column reflects the actual current codebase, not just
what each source claimed as of its own write date.

**Source reports consolidated here** (all in `PRODUCT_AUDIT/`, chronological):
1. `CRITICAL_MISSING_FEATURES.md` (2026-08-09 refresh) — ranked gap list
2. `AUDIT_CHANGELOG.md` (2026-08-09) — the running FIXED/STILL-PRESENT classification log
3. `SCALABILITY_AUDIT.md` (2026-08-10) — client-fetch/polling scalability pass
4. `ARCHITECTURE_HARDENING_AUDIT_2026-08-15.md` — RPC race-condition audit
5. `V2_ACCEPTANCE_REPORT_2026-08-15.md` — independent acceptance review of the "Nearby 2.0" diff
6. `V3_V4_PHASES_A_D_AUDIT_2026-08-15.md` — Phases A–D (demand intelligence + group plans) handoff
7. `CONNECTIVITY_AUDIT_2026-08-15.md` — full-system connectivity/integration audit
8. `connectivity_domain_C_group_merge.md` — the one fully-completed background-fork deep-dive
   (Phase D group plans), folded into #7
9. `PRODUCTION_ARCHITECTURE_2026-08-15.md` — synthesized reference architecture (not itself a
   findings report, but the authoritative current-state doc these findings resolve into)

**Deliberately not folded in**: the UI/IA/UX-design-review cluster (`UI_IA_REVIEW_FOR_EXTERNAL_AI`,
`CURRENT_UI_MAP`, `HOME_VISUAL_HIERARCHY_AUDIT`, `INTENT_LAYER_*` walkthroughs, `CORAL_AUDIT_PROGRESS`,
the `DELTA_REPORT`s, `IA_CLEANUP_STATUS_CHECK`) and the original 2026-08-08 handoff-package
reference docs that aren't themselves findings reports (`PRODUCT_OVERVIEW`, `FEATURE_MATRIX`,
`SCREEN_INVENTORY`, `NAVIGATION_AND_IA`, `USER_FLOWS`, `PRODUCT_FLYWHEEL`, `PRODUCT_RISKS`,
`UX_GAPS`, `DATABASE_AND_DATA_MODEL`, `IMPLEMENTATION_NOTES`, `AI_HANDOFF`) — per direct scope
instruction, this consolidation covers the backend/connectivity-audit thread only.

---

## 1. Executive summary

As of 2026-08-15, **every concrete, actionable finding across all nine source reports has been
fixed**, with one exception that's deliberate (payment processing, never attempted by design) and
a handful of items explicitly marked "not reached" by their own audits (never claimed clean, never
independently re-verified since). Re-running the spot-checks below while consolidating confirms
the fix claims hold in the current codebase, not just in each report's own after-the-fact banner.

The overall shape of the last week's work: a real, complex, same-day-shipped feature (Phase D
group plans) shipped with two real race conditions and one real state-cleanup gap, plus was
completely disconnected from the app's own primary "what's going on with me" surfaces (Home,
Activity, the dedicated Plans screen) — all of which are now fixed. Two independent, unrelated
architecture-hardening passes (one general RPC audit, one specific to the V2 diff) each found one
real privacy/correctness defect in work shipped that same day — both fixed within hours of being
found. A messaging-polling pattern that was actively wasting bandwidth on every open chat screen,
continuously, was found and replaced with real-time subscriptions plus real pagination. A set of
smaller, older gaps (debug code shipped to production, an admin self-escalation exploit, several
unbounded browse queries) from the original 2026-08-08/09 audit passes are all now closed.

**What remains genuinely open**, consolidated into one list rather than scattered across nine
files, is in §3 below — read that section if you only read one part of this document.

---

## 2. Master status ledger

Every finding from all nine sources, one row each, deduplicated where the same underlying issue
was named more than once across reports (noted in the "Also found by" column).

**Status key**: ✅ FIXED (verified) · ✅ FIXED (re-verified while consolidating, see §4) ·
🟡 OPEN — deliberate/deferred · ⚪ NOT REACHED — genuinely never independently checked, not
claimed clean.

| # | Finding | Severity | Source(s) | Status |
|---|---|---|---|---|
| 1 | Group plans invisible from Home/Activity/Plans/pending-count | P1 | Connectivity Audit §G.1, §B.1 | ✅ FIXED — `20260815`, `getMyGroupPlans()`/`getMyPendingGroupPlanInvites()` wired into all 3 surfaces |
| 2 | `confirm_group_plan` doesn't cascade-expire a merged participant's own already-generated offers | P1 | Connectivity Audit §B.2, Domain C Finding C1 | ✅ FIXED — `20260815_v4_group_plan_fixes.sql` |
| 3 | `confirm_group_plan_offer` has no row lock on its quorum-count read (concurrent last-two-confirmations race) | P1 | Connectivity Audit §B.3, Domain C Finding C2 | ✅ FIXED — same migration, `for update` added |
| 4 | `GroupPlanScreen` has no realtime subscription (focus-refetch only) | P2 | Connectivity Audit §B.4, §F | ✅ FIXED — real channel added |
| 5 | No exclusivity between two concurrently-pending group plans inviting the same open request (double-commit) | P2 | Connectivity Audit §B.5, Domain C Finding C3 | ✅ FIXED — same migration, partial unique index |
| 6 | Stale `proposed_time` when switching an offer's type away from and back to "Alt. time" | P2/P3 | Connectivity Audit §B.6 | ✅ FIXED — one-line local-state reset |
| 7 | Two-round-trip consent cost for every group plan (accept → reset on budget-set → re-accept) | P3 | Connectivity Audit §B.7, Domain C (design-tradeoff note) | 🟡 NOT A DEFECT — working as designed, explicitly not scheduled for a fix |
| 8 | CLAUDE.md never documented `20260815_v2_audit_fixes.sql` or the bugs it fixed | P3 (process) | Connectivity Audit §B.8 | ✅ FIXED — documented |
| 9 | **`supabase_realtime` publication had only 1 of 16 needed tables** — every realtime channel in the app except 1:1 chat had never been able to receive a live event | P1 (found during fix, not in original scope) | Connectivity Audit §I.5 | ✅ FIXED — `20260815_v5_realtime_publication_fix.sql`, idempotent, re-applied twice to prove it |
| 10 | `accept_business_offer()` — TOCTOU race, offer row read unlocked then blind-updated | P1 | Architecture Hardening Audit #1 | ✅ FIXED — `for update` lock added, live-reproduced before/after |
| 11 | `approve_gathering_interest()` — no status guard/lock; a retried approve on an already-approved row can demote it back to `waitlisted` | P1 | Architecture Hardening Audit #2 | ✅ FIXED — lock + `status='pending'` guard, live-reproduced before/after |
| 12 | `get_my_group_intent_signals()` ignores `profiles.intent_visibility` — an opted-out user's name/request still surfaces to their network | P1 (privacy regression) | V2 Acceptance Report, Defect A | ✅ FIXED — `20260815_v2_audit_fixes.sql`, filter added to match its sibling RPC |
| 13 | `get_cross_user_intent_patterns()` buckets time-of-day in UTC, not the submitter's local time — every non-UTC user's pattern data is wrong, day-of-week can flip near midnight UTC | P1/P2 (correctness) | V2 Acceptance Report, Defect B | ✅ FIXED — same migration, real `local_period` column captured client-side |
| 14 | No impression/dismissal analytics for the predictive or group-intent Home nudge cards | Low (instrumentation gap) | V2 Acceptance Report §10 | ✅ FIXED 2026-08-16 — `home_nudge_events` + `get_home_nudge_stats()`, wired into Home and a new "🔔 Home Nudge Performance" section on `MarketValidationScreen.js`, verified live end-to-end with hand-checked-exact numbers |
| 15 | No spatial/composite index on `(category, lat, lng)` for `business_requests`/`brand_partners` — every insert now runs 2 extra trigger-nested sequential scans | Low today, real risk at scale | V2 Acceptance Report §9 | ✅ FIXED 2026-08-16 — `20260816_business_demand_index_hardening.sql`, two partial B-tree indexes (not a new spatial-index type, consistent with this schema's existing bounding-box approach elsewhere), verified live + via replay |
| 16 | Duplicate-tap protection missing on the two new Home "act" buttons (predictive/group-intent nudges) | Low | V2 Acceptance Report §8 | ✅ FIXED 2026-08-16 — both buttons now share the intent box's own `disabled={intentThinking}` guard |
| 17 | Group Plans Phase D (14-rule spec) — full build | New feature, not a defect | V3/V4 Audit §5 | ✅ BUILT + VERIFIED LIVE (4 scenarios) + VERIFIED VIA REPLAY |
| 18 | Phase A (time-window granularity on aggregated demand) | New feature | V3/V4 Audit §2 | ✅ BUILT + VERIFIED (2 real bugs caught and fixed during build — ambiguous-column-name, migration filename ordering) |
| 19 | Phase B (one-tap "turn demand into an offer") | New feature | V3/V4 Audit §3 | ✅ BUILT + VERIFIED (1 real bug caught during build — synthetic-event-as-param footgun) |
| 20 | Phase C (reliability-weighted fan-out/offer ordering) | New feature | V3/V4 Audit §4 | ✅ BUILT + VERIFIED LIVE + VERIFIED VIA REPLAY (1 real bug caught before ever touching a DB — swapped SELECT columns) |
| 21 | All 4 messaging surfaces (1:1, gathering, community, business) re-fetch entire history on a 3–4s timer while a screen is open — continuous, present-tense cost, not a future risk | 🔴 P0-shaped | Scalability Audit §1 | ✅ FIXED — real-time channels replaced polling on all 4 (Aug 10, verified in code, see §4) |
| 22 | `getBusinessConversations()` downloads every message across every conversation just to build a one-line-per-customer list — worst shape in the whole scalability pass | 🔴 | Scalability Audit §2 | ✅ FIXED — dedicated `DISTINCT ON` summary RPC, verified live + replay |
| 23 | `getPublicCommunities()` — unbounded, same shape as the pre-fix gatherings bug | 🟠 | Scalability Audit §3 | ✅ FIXED — `.limit(200)` (confirmed live in current code, §4) |
| 24 | `getNearbyBusinesses()` — unbounded fetch, distance filtered client-side | 🟠 | Scalability Audit §4 | ✅ FIXED — `.order().limit(300)` (confirmed live in current code, §4) |
| 25 | `getCommunityMembers()` — full roster, no cap | 🟠 | Scalability Audit §5 | ✅ FIXED — `.limit(200)` |
| 26 | Activity notices feed — unbounded, refetched every visit | 🟠 | Scalability Audit §6 | ✅ FIXED — `.limit(200)` |
| 27 | No payment processor integrated for business billing | P1 | Critical Missing Features #1 | 🟡 OPEN — deliberately deferred, needs the user present for a real external account/money decision, not attempted |
| 28 | Hardcoded backend Edge Function URLs — found in 3 files originally, then 12 more | P1 | Critical Missing Features #2, Audit Changelog | ✅ FIXED — confirmed 0 remaining hits outside the one legitimate `SUPABASE_URL` constant (re-verified while consolidating, §4) |
| 29 | Business self-serve onboarding — *becoming* a partner is still admin-approval-gated (not a self-claim flow); *editing* an existing profile was fixed separately | P1 | Critical Missing Features #4 | 🟡 OPEN BY DESIGN — re-confirmed live in current code (§4); this is a deliberate, explicitly-restated decision, not an oversight |
| 30 | Proactive "you're on a streak / close to a reward tier" push notification | P1 | Critical Missing Features #5 | ✅ ALREADY BUILT, audit's own claim was stale — `send_momentum_nudges()` cron function exists and does exactly this (re-verified while consolidating, §4) |
| 31 | Client-side (non-indexed) search across gatherings/communities/perks | P2 | Critical Missing Features #6 | ✅ FIXED — real trigram-indexed server-side search exists for all 3 (confirmed in Scalability Audit's own 🟢 section) |
| 32 | `GatheringsScreen.js`/`ChatScreen.js`/`BusinessDashboardScreen.js` remain large single-file mega-screens | P2 | Critical Missing Features #7 | 🟡 OPEN — style/maintainability observation, explicitly deferred pending a real reason to touch each file |
| 33 | `ChemistryDiaryListScreen.js` has no "+ Add Entry" button | P2 | Critical Missing Features #8 | ✅ ALREADY FIXED, re-verified 2026-08-16 — a real "+ Add Entry" button exists (`startNewEntry`); the Aug 9 "still present" classification was stale |
| 34 | `FeaturesOverviewScreen.js` has zero tap-to-navigate | P2 | Critical Missing Features #9 | ✅ CONFIRMED BY DESIGN, re-verified 2026-08-16 — genuinely a static glossary with zero `navigate()` calls anywhere in the file, not a broken nav; not a gap |
| 35 | `AdminBusinessRequestsScreen`'s Approve(RPC)/Deny(raw update) integrity asymmetry | P2 | Critical Missing Features #10 | ✅ ALREADY FIXED, re-verified 2026-08-16 — both Approve and Deny call real RPCs (`approve_business_partner_request`/`deny_business_partner_request`); the Aug 9 "still present" classification was stale |
| 36 | No "withdraw request" action for a pending host-approval gathering join | P2 | Critical Missing Features #11 | ✅ ALREADY FIXED, re-verified 2026-08-16 — `GatheringDetailScreen.js`'s pending panel has a real, working "Withdraw Request" action; the Aug 9 "still present" classification was stale |
| 37 | `ActivityBell.js` fully unreferenced component; stray duplicate `src/services/src/services/textModeration.js` | P2 (dead code) | Critical Missing Features #12 | ✅ RESOLVED — neither file exists in the repo any longer (re-verified while consolidating, §4) |
| 38 | `ChatScreen.js` production debug overlay shipped to real users | 🔴 P0 (original 2026-08-08 audit) | Audit Changelog | ✅ FIXED (long-standing, re-confirmed by Aug 9 refresh) |
| 39 | Admin self-escalation — any authenticated user could set their own `is_admin = true` | 🔴 P0 | (Carried in Production Architecture §6, not a standalone report but load-bearing) | ✅ FIXED — trigger guard added, live-confirmed both directions |
| 40 | `is_blocked()` ran under caller's own RLS — a blocked party could still see/message the person who blocked them | 🔴 P0 | Audit Changelog, Production Architecture §6 | ✅ FIXED — made SECURITY DEFINER with an internal caller-identity guard |
| 41 | `community_members`/`communities` RLS mutually recursive — `select ... where user_id = auth.uid()` genuinely infinite-looped | 🔴 P0 | Production Architecture §6 | ✅ FIXED — `is_community_visible_to()` breaks the cycle |
| 42 | `gatherings` table had no `SELECT` grant for `authenticated` at all (pre-dated and independent of RLS) | 🔴 P0 | Production Architecture §6 | ✅ FIXED — grant added |
| 43 | Schema-reproducibility — ~45 of ~53 tables had no local migration; a fresh empty project couldn't be rebuilt from committed files | 🔴 P0 | Audit Changelog | ✅ FIXED — baseline squash + 29-file replay verified clean from empty, re-verified again for the V2/V3-V4 diffs specifically |
| 44 | Schema-reproducibility regression — a duplicate-effect migration left un-archived, would have broken a from-scratch replay | 🔴 P0 (found during the Aug 9 refresh itself) | Audit Changelog | ✅ FIXED within the same pass that found it |
| 45 | Business-facing RPC ownership checks (`get_business_dashboard_stats` and 4 siblings) trusted a caller-supplied `partner_id` with no ownership check — real cross-business data leak | 🔴 P0 | Audit Changelog | ✅ FIXED, live re-verified for all 8 functions across two passes |
| 46 | `check_and_increment_ai_use` (shared AI rate-limit RPC) had no caller-ownership check — any user could burn another account's AI quota | P1 | (Production Architecture §6, carried from earlier session) | ✅ FIXED |
| 47 | `bonus_notices` (a real spendable currency) was writable directly by the client with no guard | P1 | (Production Architecture §6) | ✅ FIXED — moved behind two RPCs + trigger guard |
| 48 | Silent send-failure pattern duplicated across 4 chat-style screens (composer cleared before send confirms, no error surfaced) | P1 | Audit Changelog | ✅ FIXED — one shared `useChatComposer` hook |
| 49 | No proof-of-redemption mechanism for business perks | P1 | Audit Changelog | ✅ FIXED — real 6-digit confirmation-code flow, billing now only counts confirmed redemptions |
| 50 | `invite_only` gathering join had no server-side enforcement — only the UI hid the button | P1 | (carried in Production Architecture §6) | ✅ FIXED — `join_gathering()` now hard-requires a real accepted invite |
| 51 | Full 20-step product-flywheel trace | Verification pass | Audit Changelog | ✅ DONE — no new BROKEN/MISSING transition found; 2 real gaps from an earlier trace confirmed fixed |
| 52 | Realtime-leak resweep beyond `GroupPlanScreen` — whether every screen added since the last realtime cleanup pass correctly has/doesn't need a subscription | Verification pass (was ⚪ NOT REACHED) | Connectivity Audit §F | ✅ RE-VERIFIED CLEAN 2026-08-16 — all 13 real `.channel()` screens have proper cleanup; all 16 real subscribed table names are covered by the `supabase_realtime` publication, confirmed live (`pg_publication_tables` count = 16) |

---

## 3. What's genuinely still open (read this if nothing else)

**Updated 2026-08-16** — every concretely fixable item from this section's original 2026-08-15
version has now been closed (rows 14, 15, 16, and the realtime-resweep half of item 5 below); see
§5.7 for the full account. What's left is either a deliberate standing decision or something this
sandboxed environment genuinely cannot do:

1. **No payment processor for business billing.** Invoice math runs correctly and on schedule;
   nothing has ever collected money. Deliberately not attempted — needs the user present for a
   real external account and a real money-movement decision, not something to build
   autonomously. (Row 27)
2. **Business partner *onboarding* stays admin-approval-gated**, not a true self-claim flow —
   re-confirmed still true in current code as of 2026-08-16. This is a restated, deliberate
   decision (not an oversight), but it remains the actual scaling bottleneck for adding new
   partners without manual review. (Row 29)
3. **Two of the three NOT REACHED sweeps from the Connectivity Audit are still genuinely not
   reached** — both explicitly large enough to deserve their own dedicated pass rather than a
   rushed, shallow version bundled into whatever session happens to be open (matching the
   Connectivity Audit's own §I item 7 recommendation):
   - A full type/contract sweep (service function return shape vs. what every calling screen
     destructures) across all ~40 service files — this exact class of bug has bitten this
     codebase more than once already (the `bonus_notices`/`is_admin` guarded-column gaps, a
     `loadingInitial` destructuring gap across 4 chat screens).
   - A full RLS resweep beyond group plans and the specific tables touched in the 2026-08-16
     pass — the other ~50 tables' policies were not independently re-audited; carried forward as
     genuinely unverified, not assumed clean or broken.
   - `gathering_interest`/`gatherings` state-machine re-verification beyond the two specific
     race fixes already made (Architecture Hardening Audit).
   - **The realtime-leak resweep, the third item in this original list, is now closed** — see
     row 52 and §5.7.
4. **Whether the Anthropic classifier call itself behaves correctly end-to-end** is still
   unverified — no live signed-in session has ever been available in this sandbox to mint a real
   access token and actually exercise it. (Duplicate-tap protection *downstream* of that call,
   row 16, is now fixed — see §5.7 — this is specifically about the classifier call's own live
   behavior, which remains untestable here.)
5. **No manual simulator/device run-through has ever been performed, for any feature, in this
   codebase's entire history.** This is the single most-repeated line across every one of the
   nine source reports and the wider build log. Every fix in this document was verified via live
   SQL against production with disposable test data, from-scratch migration replays, and clean
   bundle exports/parses — never an actual tap-through on a running app. This is the largest
   standing risk going into any real pilot: rendering, layout, gesture, and timing issues are
   entirely unverified across the whole app.
6. **Load testing and a real production-monitoring dashboard have never been attempted** — both
   need live deployed infrastructure and real traffic this sandbox has never had access to.

---

## 4. Re-verified while consolidating (2026-08-15)

Rather than trust each source report's own "fixed" banner at face value, the following claims
were independently spot-checked against the current repo before being marked ✅ in §2 above (not
a full re-audit — a targeted check of the items where staleness seemed most likely, i.e. where a
later report's fix wasn't obviously cross-referenced by name in an earlier one):

- **Hardcoded backend URLs** (row 28): `grep -rn "enmosvippabmuqslzrox.supabase.co" src/` returns
  exactly one hit — `src/services/supabase.js`, the one legitimate place the constant is defined.
  Zero of the 12 files named in the Aug 9 refresh still hardcode it. Confirmed fixed.
- **Momentum/streak proactive push** (row 30): `CRITICAL_MISSING_FEATURES.md` (written 2026-08-09)
  claimed no such trigger existed anywhere. `send_momentum_nudges()` is a real function
  (originally `supabase/migrations_archive/20260809_momentum_reward_nudges.sql`, now folded into
  the baseline) that computes both a real weekly-streak signal and a real reward-tier-proximity
  signal and sends a real push for each (`momentum_streak_nudge` type, "🔥 Keep your streak
  going"). This is exactly the mechanism the audit said was missing — the claim was stale at the
  moment it was written (this function may have landed the same day, just after that specific
  grep was run), not a fix that happened later. Reclassified from "still open" to "already built."
- **Dead code** (`ActivityBell.js`, `src/services/src/services/textModeration.js`, row 37): both
  paths were searched for directly — neither file exists in the current repo. Confirmed resolved
  (both were flagged as trivial one-line deletions in the original finding; they're gone now).
- **Business partner onboarding still admin-gated** (row 29): `approve_business_partner_request`
  is still a real, live RPC (`supabase/migrations/20260810_business_partner_review_notifications.sql`)
  requiring an admin call — confirmed the gate is still there, matching the deliberate-decision
  framing recorded in the build history (business partnership stays admin-gated "for now," a
  restated decision, not a forgotten gap).
- **Scalability fixes** (rows 21–26): read the current source directly.
  - `getPublicCommunities()` — `.limit(200)` present.
  - `getNearbyBusinesses()` — `.order('created_at', ...).limit(300)` present.
  - `ActivityScreen.js`'s notices query — `.limit(200)` present, with an inline comment citing
    "Scalability audit step 10."
  - `GatheringChatScreen.js`/`CommunityChatScreen.js`/`BusinessConversationScreen.js` all contain
    an explicit code comment recording that the old `setInterval(load, ...)` poll was removed
    (`"Was a setInterval(load, 3000) re-downloading the entire message..."`) — confirmed the
    polling pattern itself is gone, replaced by realtime channels, not just capped.
  All five confirmed fixed in the current codebase, not just claimed fixed in a report.

Not re-verified while consolidating (carried forward at each source's own last-recorded status,
per §3 item 6): rows 33–36.

---

## 5. Section detail, by report

### 5.1 Connectivity & Integration (full-system audit + Phase D deep-dive)

**Scope actually covered**: not the originally-planned 8-domain/24-section sweep (background-fork
dispatch proved unreliable in this environment — two forks misread their own scope, one hit a
session-limit API error) — one fork (the Phase D/group-plan deep-dive) produced a genuinely
thorough result and was kept verbatim; everything else is direct code-reading by the primary
session, targeted at the newest, highest-risk, least-scrutinized surface (Phase D group plans,
shipped the same day) rather than a uniform re-verification of everything.

**What was found solid, not just assumed**: the core consumer↔business request/offer/accept
lifecycle is genuinely connected end-to-end — DB-enforced state transitions with row locks, RLS
correctly scoped everywhere checked, all 42 real push-notification types have a real client route
with zero gaps either direction, zero dangling `navigate()` calls to unregistered routes, a
fake-connectivity sweep for TODOs/mock data/placeholder logic came back clean.

**What was actually broken, now all fixed** (rows 1–9): Phase D group plans were functionally
complete and internally correct in isolation but invisible from every aggregate "what's going on
with me" surface (Home, Activity, the dedicated Plans screen, the pending-invites count) — the
single highest-product-value finding in the whole pass, since it meant a fully-built feature was
reachable only via one of 5 push-notification types, with zero other path if the push was missed.
Plus two real race conditions specific to Phase D's own RPCs (Domain C Findings C1/C2/C3, detailed
in the standalone Domain C report), and — found while verifying the `GroupPlanScreen` realtime
fix, not part of the original ask — a much bigger, previously-undetected bug: the
`supabase_realtime` publication had only ever had **one table** in it (`messages`), meaning
gathering chat, community chat, business conversation, message reactions, every relationship-tools
collaborative screen, and `GatheringsScreen`'s live attendee count had never actually been able to
receive a live event, independent of whether each screen's own client code subscribed correctly.
This is the real root cause behind a "not verified: an actual live message arriving on a second
device" gap disclosed several times earlier in this codebase's history — not a coincidence.

**Domain C (group plans) specifics**: all 7 RPCs correctly re-derive caller identity from
`auth.uid()`; the proposal-row lock discipline is correct (a leave and a confirm racing each other
correctly serialize); double-response and expiry guards on invite-response are real; the budget
re-consent reset genuinely resets every accepted non-initiator participant, including on the
*first* budget-set call (a real, disclosed UX cost — two full accept round-trips per group plan —
not a defect); roster finalization correctly excludes anyone not truly accepted before summing
party size; `accept_business_offer` genuinely cannot be called solo on a group-plan request. The
three real defects (cascade gap, quorum-lock race, cross-proposal double-commit) were each fixed
in the same migration and each individually reproduced live before and after the fix — not just
argued closed.

### 5.2 Architecture hardening (RPC race-condition audit)

A targeted, code-level read of every live SECURITY DEFINER RPC governing the app's core state
machines — pulled via `pg_get_functiondef()` against production, not reconstructed from migration
files, since a later `CREATE OR REPLACE` can drift from what a migration file alone shows. Found
and fixed two real races (rows 10–11): `accept_business_offer()`'s unlocked offer-row read
followed by a blind update (a concurrent decline or cron-expiry landing in that window could
silently overwrite an accepted offer back over), and `approve_gathering_interest()`'s complete
absence of a status guard or lock (a retried/double-tapped approve on an already-approved row
could re-count capacity including itself and silently demote an already-approved attendee back to
waitlisted — reproduced live, not just reasoned about). Everything else read
(`submit_business_offer`, `decline_business_offer`, `complete_business_reservation`,
`cancel_business_request`, `join_gathering`/`leave_gathering`, `respond_to_social_invite`, the
hourly expiry cron) was confirmed already correctly guarded — no change needed. Not reached:
`respondToFriendRequest()` (idempotent, no scarcity resource, lower risk by inspection),
`set_community_member_role`, and a dedicated adversarial pass on the two coupon/perk scarcity axes
beyond what was already covered incidentally.

### 5.3 V2 acceptance report ("Nearby 2.0" partial build — 3 commits, 11 files)

An independently-conducted acceptance review (not a self-report) of a specific, narrower diff
than CLAUDE.md's own loose "Nearby 2.0" umbrella term — six vision-doc layers (predictive nudge,
group-intent signals + push, aggregated demand + push, multi-option result grouping, cross-user
demand patterns, marketplace reliability rankings). 12 of 16 requirements verified clean with real
disposable-data tests against production (hand-checked arithmetic, not just "the function runs").
Two confirmed defects, both fixed same-day and re-verified live by reproducing the exact original
failing scenario a second time after the fix (rows 12–13): a real privacy regression (an opted-out
user's name/request still surfaced through the new group-intent signal, bypassing a privacy
control shipped the same day) and a real correctness bug (cross-user pattern time-of-day bucketing
computed in UTC instead of the submitter's local time, silently wrong for every non-UTC user, with
a day-of-week flip risk near UTC midnight — the same "weekend boundary" class of bug this codebase
has caught and fixed three separate times elsewhere, reintroduced here server-side). Final verdict
at acceptance time: 🟡 substantially complete with specific, real, confirmed defects — not 🟢, not
🔴. Both defects are now fixed (see rows 12–13); the report's own lower-severity open items (rows
14–16) remain open, not silently resolved by the defect fixes.

### 5.4 V3/V4 Phases A–D (marketplace intelligence + group-plan mechanism)

A handoff-style document (not itself an independent audit — written by the building session, with
explicit confidence markers for what was and wasn't independently verified) covering four phases:
real time-window granularity on already-collected demand data (Phase A), a one-tap shortcut from
viewing demand into posting an offer against it (Phase B), reliability-weighted marketplace
ordering using data that already existed but was never *used* for ranking before (Phase C), and
the group-plan mechanism itself (Phase D — see §5.1's Domain C detail for the independent audit of
this same feature). Real bugs were caught and fixed *during* each phase's own build, before ever
reaching a database in two cases — an ambiguous-column-name bug only surfaces at call time not
apply time (Phase A), a migration-filename-ordering bug that would have silently clobbered a newer
function definition on a true from-scratch rebuild despite working fine against already-live
production (Phase A), a synthetic-event-object-as-parameter footgun (Phase B), and a copy-paste
column-swap bug in an `INSERT ... SELECT` caught by re-reading the file before it ever touched a
database (Phase C). Phase D's build deliberately was not designed by the coding session — the open
design questions (consent, ownership, budget reconciliation) were surfaced to the user, who
returned a locked 14-rule specification; the build is a literal implementation of that spec, with
proportionately more verification (four distinct live test scenarios, an actual RLS role-switch
test, not just RPC-internal `auth.uid()` checks) than Phases A–C received.

### 5.5 Scalability (client-fetch/polling patterns)

Prompted by an earlier, single fix (`getNearbyGatherings()` moved from "download everything,
filter on device" to a real SQL-bounded RPC) — this audit asked whether that pattern was unique or
recurring, via a full read-only pass across all 273 Supabase queries in `src/services/*.js` plus
the four message-loading screens. The headline finding wasn't about table size at all: **all four
messaging surfaces re-fetched their entire conversation history on a fixed 3–4 second timer, for
as long as the screen stayed open** — continuous, present-tense cost independent of how long any
conversation's history currently was, not a future "once it gets long" risk. One surface (1:1
chat) had a redundant poll running *alongside* an already-working realtime channel, for reasons
that weren't obvious from the client code alone (turned out to be piggybacking a read-receipt
mark onto the timer, not covering a real gap). A second, even worse shape existed on the business
side: `getBusinessConversations()` downloaded every message across every conversation for a
partner just to build a one-line-per-customer preview list — cost scaling with both customer count
and history length at once, to produce a result needing one row per customer, called *twice* per
dashboard load. Below that, three plain unbounded-browse-query instances of the exact
`getNearbyGatherings()`-shaped bug (communities, businesses, notices) were found still live,
invisible only because the underlying tables were still small in production. All of the above are
now fixed — confirmed directly in the current source (§4), not just claimed. The audit's own 🟡
tier (personal-scale queries like `getMyTimeline()`, `getAllPendingRequests()`) was correctly left
alone — self-limiting by nature of the feature, not a real platform-wide growth risk.

### 5.6 Critical missing features + audit changelog (2026-08-08/09 baseline)

The original, broadest-scope audit pass — a full codebase read plus a 2026-08-09 refresh that
independently re-verified every P0 from the original against live production with real disposable
data (not just re-reading the code a second time). All 6 original P0s were confirmed fixed by the
refresh, with 4 of the 6 independently re-tested live rather than trusted from the building
session's own word: the `ChatScreen.js` production debug overlay, the admin self-escalation
exploit, the `is_blocked()` RLS-bypass bug, the business-RPC ownership-check leak, a
`community_members`/`communities` mutually-recursive RLS bug (genuinely infinite-looped on the
simplest possible query), a missing `SELECT` grant on `gatherings` for the `authenticated` role
entirely independent of RLS, and the schema-reproducibility gap (~45 of ~53 tables had no local
migration at all — a fresh empty Supabase project could not have been rebuilt from committed
files). One genuinely new regression was found and fixed *within* the same refresh pass that was
checking for regressions: a duplicate-effect migration left un-archived, which would have broken a
from-scratch replay the moment it was attempted. The remaining P1/P2 items from this cluster are
reflected individually in the master ledger (§2, rows 27–37) rather than repeated here.

### 5.7 Fix pass on this document's own "still open" list (2026-08-16)

Direct follow-up, same day as this document's own creation plus one: the user asked to fix what
this document itself listed as still open in §3. Four concrete items were closed, three re-scoped
sweeps were confirmed still genuinely out of scope for a single pass (not silently claimed done),
and five items turned out to already be fixed — a stale "still open" classification carried
forward from an earlier source report that hadn't cross-referenced a later same-day fix.

**Fixed**:
- **Duplicate-tap protection on Home's two nudge "act" buttons** (row 16) — both now share the
  main intent box's own `disabled={intentThinking}` guard, closing the exact gap the V2
  acceptance report named (a fast double-tap could previously fire `handleHomeIntentSubmit()`
  twice).
- **Composite indexes for the flagged spatial-scan risk** (row 15,
  `20260816_business_demand_index_hardening.sql`) — `business_requests_open_category_idx
  (category, expires_at) where status='open'` and `brand_partners_active_coords_idx (id) where
  active and lat/lng not null`, closing the real (if not-yet-triggered-at-current-volume) cost
  named in V2 Acceptance Report §9. Plain partial B-tree indexes, not a new spatial-index type —
  deliberately consistent with this schema's existing bounding-box-then-haversine approach
  everywhere else it does proximity filtering. Verified live (`pg_indexes`) and via a 42-file
  from-scratch migration replay.
- **Home nudge impression/dismissal/action analytics** (row 14,
  `20260816_home_nudge_analytics.sql`) — new `home_nudge_events` table (same owner-scoped RLS
  shape as `intent_submissions`/`intent_outcomes`, no RPC needed for writes), a
  `recordNudgeEvent()` client call wired into all three real lifecycle points on Home (shown —
  deduped per nudge instance per session via an in-memory ref, since this screen's
  `useFocusEffect` re-runs on every tab-back and would otherwise inflate impressions; dismissed;
  acted), and a new admin-only `get_home_nudge_stats()` RPC feeding a new "🔔 Home Nudge
  Performance" section on `MarketValidationScreen.js`. **Verified live end-to-end**, not just
  applied: real disposable test rows as a real profile, RLS isolation confirmed both ways (a
  stranger sees 0 rows and is rejected inserting under someone else's `user_id`), the admin RPC
  rejected for a non-admin and returned hand-checked-exact numbers for the admin
  (`predictive: 2 shown/1 dismissed(50%)/0 acted`, `group_intent: 1 shown/0 dismissed/1
  acted(100%)`) — all test rows deleted afterward.
- **Realtime-leak resweep beyond `GroupPlanScreen`** (row 52, was NOT REACHED) — re-checked, not
  re-flagged: all 13 screens using `.channel(` have proper `removeChannel`/`unsubscribe` cleanup,
  and every real table name any of them subscribes to via `postgres_changes` is covered by the
  16-table `supabase_realtime` publication — confirmed live (`pg_publication_tables` count = 16,
  matching the client-side count exactly), not just read from the migration file.

**Re-verified and found already fixed, not actually open** (rows 33–36) — each was carried
forward in earlier source reports as "last known STILL PRESENT" without a fresh check; direct
reads of the current code show all four were already closed, most likely by a same-day fix in an
earlier report that a later, broader-scope report never cross-referenced: `ChemistryDiaryListScreen.js`
has a real "+ Add Entry" button; `AdminBusinessRequestsScreen.js`'s Approve and Deny both call
real RPCs (no asymmetry); `GatheringDetailScreen.js`'s pending panel has a real "Withdraw
Request" action; `FeaturesOverviewScreen.js`'s lack of tap-through is confirmed by design (a
static glossary), not a defect.

**Confirmed still genuinely out of scope for this pass, not attempted** — the full type/contract
sweep and the full RLS resweep beyond group plans and the tables touched here are both real,
large, dedicated-pass-shaped audits (dozens of files / ~50 tables respectively); rushing a
shallow version of either would produce lower-confidence findings than this codebase's own
established rigor for a change of this kind. Payment processing and the business-onboarding
admin-gate remain deliberate standing decisions, not gaps. No manual device run-through, load
testing, or the Anthropic classifier's own live behavior were attempted — all three remain
genuinely outside what this sandboxed environment can do.

Verification for the whole pass: all four touched/new client files parsed clean via `@babel/core`;
the full 42-test Jest suite passed unchanged; a full `npx expo export --platform ios` completed
with no bundling errors; both new migrations replayed clean (exit 0) alongside all 40 prior
migration files from a truly empty database, with every new object confirmed to exist in the
freshly-rebuilt schema.

---

## 6. Verification methodology (carried from the source reports, applies throughout)

- **Live production verification**: real SQL executed against the actual production database
  (`enmosvippabmuqslzrox`) via the Supabase Management API, using real disposable test rows and,
  where relevant, `set_config('request.jwt.claims', ...)` or an actual `set role authenticated`
  role switch (the latter is the only way to prove RLS is enforced at the table level, not just
  that an RPC's internal `auth.uid()` check happens to be correct). All test data deleted
  afterward, production independently confirmed back to its exact pre-test row counts.
- **From-scratch migration replay**: the entire `supabase/migrations/` folder applied in filename
  order, `psql -v ON_ERROR_STOP=1`, against a truly empty Postgres database (a locally-run
  `supabase/postgres:15.1.0.147` Docker image, schema dropped and recreated). This is the only way
  to prove a fresh project can be rebuilt from committed files alone — live-production
  verification alone cannot catch a migration-ordering or duplicate-definition conflict, since
  production was never rebuilt from these files in the first place.
- **Client verification**: every touched/new JavaScript file parsed directly via `@babel/core`
  with the project's Expo preset, plus a full `npx expo export --platform ios` to confirm the app
  still bundles with no resolution errors. Where applicable, the existing Jest suite re-run.
- **What none of the above proves**: no manual simulator or physical-device run-through has ever
  occurred for any feature described in any of the nine source reports. This is stated plainly and
  repeatedly in every one of them, not hedged — see §3 item 7.

---

## 7. Document map (originals, for anyone who needs the full transcript behind a summarized line)

| Topic | Full source |
|---|---|
| Group plans — connectivity gaps + Domain C race conditions | `CONNECTIVITY_AUDIT_2026-08-15.md`, `connectivity_domain_C_group_merge.md`, `CONNECTIVITY_AUDIT_PROGRESS.md` |
| RPC race-condition hardening | `ARCHITECTURE_HARDENING_AUDIT_2026-08-15.md` |
| V2 diff acceptance (predictive/group-intent/demand/rankings) | `V2_ACCEPTANCE_REPORT_2026-08-15.md` |
| Phases A–D (time-window demand, offer shortcut, reliability ranking, group plans) | `V3_V4_PHASES_A_D_AUDIT_2026-08-15.md` |
| Current architecture snapshot (state machines, RLS rules, analytics funnel, known limitations) | `PRODUCTION_ARCHITECTURE_2026-08-15.md` |
| Client fetch/polling scalability | `SCALABILITY_AUDIT.md` |
| Original ranked gap list + refresh classification | `CRITICAL_MISSING_FEATURES.md`, `AUDIT_CHANGELOG.md` |
| Full build-by-build history behind every fix referenced above | `CLAUDE.md` |

*No application code was changed to produce this document. Where this document's status column
disagrees with a source report's own point-in-time text, that's intentional — the source reports
are frozen snapshots (several explicitly say so in their own opening lines); this document is the
one place meant to stay current.*
