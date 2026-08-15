# Nearby — Full-System Connectivity & Integration Audit — PROGRESS TRACKER

Restart-safety scratch file, same convention as every other `*_PROGRESS.md` in this folder
(`REFRESH_PROGRESS.md`, `FLYWHEEL_TRACE_PROGRESS.md`, `UX_COHESION_SCREEN_AUDIT_PROGRESS.md`).
**If a codespace restart hits mid-audit, read this file + check which `connectivity_domain_*.md`
files exist in this folder to see what's actually done vs still pending, then resume from the
first NOT STARTED batch below.** This is a read-only audit — no application code is being
changed anywhere in this pass.

Requested Aug 15 2026: a full 24-section connectivity/integration audit (user's own detailed
spec, not summarized here — see the original request in conversation). Goal: prove, with actual
code citations, whether every entity/action in Nearby actually connects end-to-end through
UI → service → DB → RLS → realtime → notification → every downstream screen that should know
about it — not just that each piece works in isolation.

## Method

**Final correction (this note supersedes both notes that used to be here — two different rogue
forks each overwrote this section with their own confused narrative before dying; ground-truth
checked directly against disk, not trusted from either fork's self-report).** Real state as of
this correction: the background-fork approach for this audit proved unreliable in this
environment — forks given "you're part of an 8-domain audit, write your findings, don't touch
the tracker" repeatedly misread their own scope as "you're the orchestrator," ignored their
assigned domain, and both attempts to run Domain A/B this way produced no usable Domain A/B
output before erroring out (one hit a real session-limit API error mid-run). **One genuinely
excellent exception**: `connectivity_domain_C_group_merge.md` (18KB, real file:line citations,
3 concrete findings including a real unlocked race condition) was produced and is being kept
as-is — Domain C is DONE. Everything else is being redone by the **primary session directly**
(Read/Grep/Bash, no further subagents), writing straight into the final deliverable
(`CONNECTIVITY_AUDIT_2026-08-15.md`) section by section rather than through 7 more intermediate
per-domain files, to cut overhead. This tracker is now updated by the primary session only.

**Bonus finding surfaced by the dying Domain A fork before it errored, worth keeping**: a
migration `supabase/migrations/20260815_v2_audit_fixes.sql` exists and is applied — it fixes two
real defects (an `intent_visibility` privacy-opt-out bypass in `get_my_group_intent_signals()`/
its notify trigger, and a UTC-vs-local timezone bucketing bug in
`get_cross_user_intent_patterns()`) found by a **separate, prior "V2 acceptance audit"**
(references `PRODUCT_AUDIT/V2_ACCEPTANCE_REPORT_2026-08-15.md` — check if that file exists;
CLAUDE.md's own changelog never mentions this migration or that audit at all, a real
documentation gap independent of anything else in this report). Both defects are already fixed
in the DB; noted here as background, not re-litigated as a live finding.

8 research domains total. Each domain's findings go directly into its own file in this folder.
After each domain lands, this tracker is updated with a one-line status + headline findings,
before moving to the next. Once all 8 are done, everything gets synthesized into the final deliverable:
`PRODUCT_AUDIT/CONNECTIVITY_AUDIT_2026-08-15.md` (executive summary, top 10, dependency map,
state-machine problems, DB/RLS problems, realtime problems, UX consistency problems, missing
functionality, ranked fix order — matching the user's own requested final-deliverable sections
A-I).

Every fork was instructed: cite file:line for every claim; mark **UNVERIFIED** rather than
assume something works because it "looks connected"; do not modify any code; classify findings
P0-P3 per the user's own rubric (P0 = data corruption/security/broken core/contradictory state,
P1 = major journey broken, P2 = important inconsistency/edge case, P3 = polish/cleanup).

## Batch status

| Batch | Domains | Output files | Status |
|---|---|---|---|
| 1 | A. Architecture/Schema/RLS/Types/Time map · B. Individual Request + Gathering state machines | `connectivity_domain_A_schema.md`, `connectivity_domain_B_request_gathering_statemachine.md` | NOT STARTED — ground-truth check: `ListAgents` showed one fork "running"/one "completed" but **zero domain files existed on disk** when checked, so no real fork output landed; the earlier note in this file claiming both were confirmed running was premature/wrong, corrected here. Proceeding with direct sequential execution as originally re-planned. |
| 2 | C. Group/Merged Request (Phase D) deep audit · D. Home/Activity/Your Plans/Profile/Settings source-of-truth consistency | `connectivity_domain_C_group_merge.md`, `connectivity_domain_D_home_activity_plans.md` | NOT STARTED |
| 3 | E. Business connectivity end-to-end + Friends/Invites/social graph · F. Notifications/Realtime/push routing | `connectivity_domain_E_business_friends.md`, `connectivity_domain_F_notifications_realtime.md` | NOT STARTED |
| 4 | G. Navigation/screen connectivity + "fake connectivity"/dead-code audit · H. Auth/authorization + failure-states + duplicate/orphaned-data + performance/scale | `connectivity_domain_G_navigation_deadcode.md`, `connectivity_domain_H_auth_failure_perf.md` | NOT STARTED |
| Synthesis | Final deliverable, all 8 domains merged | `CONNECTIVITY_AUDIT_2026-08-15.md` | NOT STARTED |

## Domain scope (what each fork was actually asked to cover)

**A — Architecture/Schema/RLS/Types/Time.** Full inventory: frontend architecture (screens/
services/hooks/state mgmt), Supabase schema (tables/columns/FKs/constraints/indexes) for every
core-domain table (profiles, friendships, matches, gatherings, gathering_interest,
business_requests, business_request_offers, business_availability, group_plan_proposals/
participants/offer_confirmations, social_invites, communities/community_members, notifications/
push plumbing), RLS policy audit per table (who can SELECT/INSERT/UPDATE/DELETE, any conflict
with what the app assumes), type/contract consistency (service function shapes vs actual DB
columns vs what UI reads), time/date logic (UTC vs local, "today"/"upcoming"/expiration
definitions, drift between call sites). Answers audit sections 1, 7 (DB+RLS), 16, 17.

**B — Individual Request + Gathering state machines.** Full entity-connectivity trace (the
15-question checklist: created where/stored where/table/identifier/FKs/retrieved where/updated
where/deleted where/cross-user interaction/realtime/notification/downstream screens/staleness
risk/duplicate representations/single source of truth) for: Request (`business_requests` +
`business_request_offers`), Gathering (`gatherings` + `gathering_interest`), Participant. Full
state-machine diagrams (every status value, every legal transition, who can trigger it, DB-
enforced vs frontend-only) for both. Answers audit sections 2 (Request/Gathering/Participant),
4, 14 (for these two).

**C — Group/Merged Request (Phase D group plans) deep audit.** The user's own spec calls this
out as needing extra scrutiny ("audit this as a distributed-state problem"). All 3 new tables +
all 7 RPCs (`propose_group_plan`/`respond_to_group_plan`/`set_group_plan_budget`/
`confirm_group_plan`/`cancel_group_plan`/`leave_group_plan`/`confirm_group_plan_offer`) +
`accept_business_offer`'s new guard. Ownership, consent-per-participant, original-request
preservation (`merged` status vs deletion), re-consent on material change (budget reset),
leave-after-offer-exists invalidation, race conditions (concurrent confirm/leave/exclude),
duplicate-merge prevention, whether every participant sees identical canonical state. Answers
audit section 5 in full, cross-referenced against CLAUDE.md's own "Phase D" build notes (verify
those claims against current live code, don't trust the changelog at face value).

**D — Home / Activity / Your Plans / Profile / Settings source-of-truth consistency.** For each
of these 5 screens: what does it actually query today, from where, computed how. Cross-check
for the same fact (participant/attendee count, request/gathering/offer status, "upcoming"
definition, notification/badge count) being computed independently in 2+ places with room to
drift. CLAUDE.md claims several rounds of IA work already fixed exactly this class of problem
(round 2/3 restructure, "Your Plans" canonicalization, Activity's Needs-Attention/Today/Earlier
split) — **verify these claims against the actual current code**, don't accept the changelog's
own "DONE" status at face value; flag anything that's drifted since. Answers audit sections 6,
10.

**E — Business connectivity end-to-end + Friends/Invites/social graph.** Full trace: user →
request → business discovery/fanout → business receives → business responds (offer/decline) →
user receives response → status transitions → gathering/plan updates → Home/Activity/Plans
reflect it. Business auth/ownership checks on every business RPC (re-verify the Aug 7 ownership-
check fix still holds against current code). Multiple businesses responding to one request —
race conditions on accept. Separately: friend request lifecycle end-to-end (send → accept/
decline → appears in friends list everywhere), `social_invites` (gathering/community invite →
accept → real membership), group-intent signals. Answers audit sections 2 (Business/Invitation/
Friend/Friend group), 11.

**F — Notifications/Realtime/push routing.** Which tables have realtime enabled and which
screens actually subscribe (+ do they clean up on unmount — this file has documented real leaks
here before, e.g. `ChatScreen.js`'s messages/reactions channels). Every DB trigger that fires a
push (`net.http_post` → `send-push`) — enumerate every real `type` value ever sent — cross-
referenced against `routeNotificationTap()`'s actual switch statement to find any push type that
still has no route (this file has found and fixed several of these before; re-verify current
state, don't assume prior fixes are still complete after everything built since). Cold-start tap
handling. Does the DB write always correspond to a real notification, and does a UI mutation
always get realtime-reflected elsewhere. Answers audit section 7 (Realtime portion) plus the
notification thread running through nearly every other section.

**G — Navigation/screen connectivity + "fake connectivity"/dead-code audit.** Map every
registered route in `RootNavigator.js` against every real `navigate/replace/push` call site —
any orphaned route (registered, unreachable) or dangling call (navigates to a route that isn't
registered, or with params the target screen doesn't actually read). Dead-end screens. Duplicate
screens covering the same concept. Then the "fake connectivity" sweep: TODOs, placeholder
functions, mock/hardcoded data outside tests, setTimeout-simulated success, console-only
handlers, buttons with no real mutation behind them, DB columns written but never read (or read
but never written), service functions defined but never called from any screen. Answers audit
sections 9, 15.

**H — Auth/authorization + failure-states + duplicate/orphaned-data + performance/scale.**
Login → session → profile → permission → DB access trace; any client-only permission check with
no server-side backstop (this file has found several of exactly this shape before — e.g. the
Aug 8 premium-limit-bypass and admin-self-escalation bugs — re-verify nothing similar has crept
back in since). Failure-mode reasoning for the core mutations (network fail mid-write, duplicate
tap, concurrent conflicting actions, DB write succeeds but push fails, session expiry mid-flow)
— is each one actually transactional/idempotent, or does the app just hope it doesn't happen.
Real DB constraints preventing duplicates (unique indexes) vs ones relying purely on app-level
discipline. Scalability outlook at 100/1k/10k/100k users, building on top of (not repeating)
`SCALABILITY_AUDIT.md`'s already-fixed items — focus on what's NEW since that audit or still
open. Answers audit sections 8, 12, 13, 18.

## Final status: audit delivered, scope honestly narrower than the original 8-domain plan

`PRODUCT_AUDIT/CONNECTIVITY_AUDIT_2026-08-15.md` is the finished deliverable — read that file,
not this tracker, for the actual report. Summary of what happened:

- **Domain C (group/merged request deep audit) — DONE, high quality.** Produced by one of the
  background forks despite the general fork unreliability documented above.
  `connectivity_domain_C_group_merge.md` — 3 real findings (2×P1 race/state-cascade bugs, 1×P2
  cross-proposal race), fully cited, folded into the final report.
- **New finding by the primary session, not a pre-planned domain**: group plans are completely
  invisible from Home/Activity/PlansScreen/the pending-invites count — the single highest-value
  finding in the whole report (§G.1 of the final deliverable).
- **Verified clean by the primary session**: notification-type routing (42/42 real push types
  match `routeNotificationTap()`'s cases exactly, zero gap either direction), navigation graph
  (zero dangling `navigate()` calls to unregistered routes), fake-connectivity sweep (zero real
  TODO/mock/placeholder markers in `src/`), group-plan RLS policies (correctly scoped, no leak).
- **Domains A, B, D, E, F, G, H as originally scoped — NOT completed to their full originally-
  planned depth.** The primary session did targeted, high-value checks that happen to answer
  parts of several of these (notification routing = part of F; navigation = part of G; group-plan
  visibility = part of D; group-plan RLS = part of A) but did not do the full systematic sweep
  originally planned for any of them (e.g., no full type/contract audit across all ~40 service
  files, no gathering/gathering_interest state-machine re-verification, no realtime-leak resweep
  beyond `GroupPlanScreen`, no RLS resweep beyond group plans, no performance/scale pass beyond
  what `SCALABILITY_AUDIT.md` already covered). This is disclosed explicitly in the final
  report's own scope note and connectivity matrix — not silently claimed as done.
- **Recommended next step**: pick up any single one of the NOT REACHED domains (their full scope
  is still documented above, unchanged) as its own dedicated pass — each is substantial enough
  to deserve its own session, per this file's own established "cap agents, one focused pass at a
  time" convention, rather than re-attempting all 7 remaining domains in parallel via forks
  again given how unreliably that went this time.
