# V2 Acceptance Report — Nearby 2.0 (partial build), 2026-08-15

## POST-AUDIT UPDATE, same day: both confirmed defects fixed and re-verified live

Per direct instruction, both Defect A and Defect B (below) were fixed after this report was
first written. This update is appended rather than silently rewriting the findings above —
everything below this note is the original, unmodified audit; the fixes and their own live
verification are recorded here.

**`20260815_v2_audit_fixes.sql`** — three changes, one migration:
1. `get_my_group_intent_signals()` now filters `p.intent_visibility = 'friends_and_matches'` on
   the requester-profile join, matching its sibling `get_connected_open_business_requests()`
   exactly (Defect A).
2. `notify_group_intent_threshold()` now bails out immediately if the *new* row's own requester
   has opted out, and its own crossing-count subquery excludes opted-out requesters too (Defect
   A's write-side counterpart — the read RPC alone wasn't the whole gap).
3. `intent_submissions` gained a real `local_period` column (`weekend|morning|afternoon|evening`,
   check-constrained, nullable — old rows correctly stay `null`, not backfilled with a guess).
   `recordIntentSubmission()` (`services/intentOutcomes.js`) now writes it via the same
   `getTimePeriod()` every other period-aware surface in this app already uses, captured at the
   one moment the user's real local time is actually knowable (client-side, at submission).
   `get_cross_user_intent_patterns()` now groups by this stored value instead of `extract()`-ing
   the UTC-stored `created_at` (Defect B).

**Re-verified live against production with real disposable data, reproducing the exact same
scenarios that originally proved each defect**, not just re-reading the fix:
- Defect A: recreated the identical Claude/Google-voice/Allen scenario. After Claude opts out,
  `get_my_group_intent_signals()` as Allen now returns **empty** (Claude's name no longer
  exposed; Google voice alone is below the 2+ threshold) — where before the fix it returned
  Claude's real name unchanged. Re-tested the trigger with proper wait time for `pg_net`'s
  async delivery (the naive first pass showed a false positive from delivery lag, caught and
  corrected): stable push count before → unchanged after a 1st request → **+1** after the real
  2-requester crossing → **unchanged** after a 3rd request from the now-opted-out requester,
  confirming the trigger correctly bails before ever reaching the push logic.
- Defect B: reinserted the same `2026-08-20T00:15:00Z` timestamp (8:15 PM real US-Eastern time)
  with `local_period: 'evening'` set as the client now would — `get_cross_user_intent_patterns()`
  now returns `"period": "evening"`, not `"morning"`. Confirmed a legacy row with no
  `local_period` (simulating pre-fix data) is silently excluded from the aggregate, not
  miscounted into a bucket. Confirmed the new check constraint rejects an invalid value.
- **Verified via a real from-scratch migration replay**: all 35 `supabase/migrations/` files
  (the prior 34 plus this fix), `psql -v ON_ERROR_STOP=1` against a truly empty database — exit
  0 throughout, `local_period` and all three changed functions confirmed to exist in the
  freshly-rebuilt database.
- Client-side verified via a direct `@babel/core` parse (clean) and a full `npx expo export
  --platform ios` (clean, no bundling errors — one edited file, no new client files).

**Not fixed, not in scope for this update** (carried over from the original audit, still real,
still open): the group-intent dismiss-key re-showing if the count changes same day, no
impression/dismissal analytics for either nudge card, the spatial-index/performance risk noted
in §9, and the 5 pre-existing unrelated uncommitted files noted in §0/§12 (none of which were
part of this fix).

**Auditor stance**: independent verification, not a re-statement of what the building session
claimed. No code, schema, or migration files were modified to produce this report. Every
VERIFIED line below has direct evidence (a live query result, a migration replay, a test run)
recorded in this document or in `PRODUCT_AUDIT/scratch/` — nothing is marked verified because
CLAUDE.md said so.

## 0. Scope reconstruction — what "V2" actually is

CLAUDE.md's own history uses "Nearby 2.0" loosely across a much larger body of work (the whole
"10/10 roadmap," the Intent Layer, Business Fulfillment, etc. — all built and audited across
Aug 8–14). The thing the user is asking to accept as **"Version 2"** — the specific claim made
today, 2026-08-15, under the heading "Nearby 2.0 partial build" — is a materially smaller, more
recent diff: **3 commits, 11 files, +1128/-87 lines**:

```
ff635793  Build Nearby 2.0 layers 1, 3, 6: predictive nudge, group intent, aggregated demand
457faf7f  Build Nearby 2.0 layers 4, 3-push, 1-push, 7: multi-option grouping, threshold pushes, marketplace rankings
cde86468  Build Nearby 2.0 layer 2: real cross-user demand pattern infrastructure
```

New: 4 migrations (`20260815_group_intent_and_aggregated_demand.sql`,
`20260815_group_intent_and_demand_notifications.sql`,
`20260815_marketplace_reliability_rankings.sql`, `20260815_cross_user_intent_patterns.sql`).
Edited: `HomeScreen.js`, `BusinessDashboardScreen.js`, `MarketValidationScreen.js`,
`businessFulfillment.js`, `marketValidation.js`, `notifications.js`, `CLAUDE.md`.

This report audits **that diff** — the six vision-doc layers (1, 2, 3, 4, 6, 7) it claims to
close. Layer 5 is claimed as "already real, not rebuilt" (pre-existing infrastructure from
earlier sessions, outside this diff) — treated separately below, not re-verified end-to-end in
this pass. Layers 8/9/10 are claimed as "not separable build items" — a scope-framing claim, not
a technical one; carried into the Scope Completeness section rather than silently accepted.

A pre-existing, unrelated condition worth flagging up front: `git status` at the start of this
audit showed **5 files with uncommitted local changes** (`BillingScreen.js`,
`CompleteProfileScreen.js`, `LoginScreen.js`, `OnboardingRecommendationsScreen.js`,
`PaywallScreen.js`) — error-handling hardening, unrelated to V2, not part of any of the 3 commits
above. This means the working tree does not exactly equal any single committed state. Noted
under §11 (Build/Deployment); not otherwise in scope for this audit.

---

## 1. Requirements matrix

| # | Requirement (vision-doc layer) | Where implemented | DB objects | Client surfaces | Status |
|---|---|---|---|---|---|
| L6-1 | Predictive nudge: dismissible Home card, "find something for {category}?", based on caller's own 3+-occurrence pattern | `HomeScreen.js` (`predictivePattern` state, `handlePredictiveAct/Dismiss`) | none new (reuses existing `getMyIntentPatterns`) | Home | **VERIFIED** (code-level; reuses already-tested pattern logic; action path confirmed to route through the same `recordIntentSubmission`-instrumented flow) |
| L6-2 | Tapping the nudge never auto-submits; pre-fills and routes through the same resolver flow as any other ask | `handlePredictiveAct` → `handleHomeIntentSubmit(category)` | — | Home | **VERIFIED** — traced the call graph; `overrideText` param defaults to existing `intentText` path, single call site added, no bypass of the classifier |
| L6-3 | Dismissal is per-day, local only | `AsyncStorage` key `predictive_dismiss_{date}_{category}_{period}` | — | Home | **VERIFIED** (code-level) |
| L3-1 | `get_my_group_intent_signals()` — real 2+-connected-requester threshold per category | SQL RPC | `business_requests`, `friendships`, `matches`, `profiles` | — | **VERIFIED w/ CAVEAT** — live-tested: 1 requester → empty, 2 connected requesters → real row (`request_count:2`, correct names), non-connected caller → empty. **Caveat: does not respect `profiles.intent_visibility`** (see §3, FAILED) |
| L3-2 | Group-intent Home card, dismissible, action routes into resolver | `HomeScreen.js` (`groupIntentSignal` state) | — | Home | **VERIFIED** (code-level, same pattern as L6) |
| L3-3 | Push notification fires exactly once at the real 1→2 crossing, never again | `notify_group_intent_threshold()` trigger | `business_requests` AFTER INSERT | — | **VERIFIED live** — 1st request: 0 new pushes. 2nd (crossing) request: +2 pushes (this trigger + the aggregated-demand trigger below). 3rd request same category: +0 pushes. Confirmed via real `net._http_response` row counts, not inference |
| L3-4 | Push tap routes to Home | `notifications.js` `case 'group_intent_signal'` | — | — | **VERIFIED** (code-level; matches existing `routeNotificationTap` pattern) |
| L1-1 | `get_aggregated_demand_for_partner()` — real open-request counts within the business's own real fan-out radius | SQL RPC | `business_requests`, `brand_partners`, `profiles` | — | **VERIFIED live** — owner sees correct `request_count`/`total_party_size`; non-owner gets empty; moving the partner out of radius correctly empties the result |
| L1-2 | "📊 Demand Near You" dashboard section, honest empty state | `BusinessDashboardScreen.js` | — | Business Dashboard | **VERIFIED** (code-level; renders `getAggregatedDemandForPartner` result with a real "no demand yet" fallback, no padding) |
| L1-3 | Push to business owner(s) fires once at 1→2 crossing, per category, within radius | `notify_aggregated_demand_threshold()` trigger | `business_requests` AFTER INSERT | — | **VERIFIED live** — same crossing test as L3-3, confirmed the 2nd request's push count included this trigger's contribution and the 3rd did not re-fire |
| L1-4 | Push tap routes to Business Dashboard Requests tab | `notifications.js` `case 'aggregated_demand_growing'` | — | — | **VERIFIED** (code-level) |
| L4-1 | "I found N ways to make this happen" — groups `resolveIntent()`'s own results by type only when 2+ distinct types are present; single-type results render exactly as before | `HomeScreen.js` (`groupIntentResultsByType`, `renderIntentResultItem` extraction) | none (pure client regroup) | Home | **VERIFIED** (code-level) — confirmed no new data source, confirmed the friend_request two-action (View Profile/Message) treatment is preserved identically in both flat and grouped layouts via the shared extracted renderer |
| L7-1 | `get_marketplace_reliability_rankings()` — per-partner response/acceptance/completion rate + median response time, admin-only, silent below 5 real opportunities | SQL RPC | `brand_partners`, `business_request_offers` | Market Validation (admin) | **VERIFIED live, hand-checked** — non-admin correctly rejected; 0-offer state correctly empty; a real 5-row funnel (1 pending/1 declined/1 accepted/2 completed) returned `response_rate:80.0, acceptance_rate:75.0, completion_rate:66.7, median_response_minutes:10` — matches hand arithmetic exactly |
| L2-1 | `get_cross_user_intent_patterns()` — category × time-period bucket, admin-only, silent below 10 submissions AND 3 distinct users | SQL RPC | `intent_submissions` | Market Validation (admin) | **VERIFIED w/ DEFECT** — non-admin correctly rejected; double-threshold correctly gates (10 rows/4 users crossed and returned). **Period bucketing is computed in UTC, not the submitter's local time** — see §3, FAILED |
| L2-2 | "📈 Cross-User Demand Patterns" section, honest empty state | `MarketValidationScreen.js` | — | Market Validation (admin) | **VERIFIED** (code-level; renders the RPC's real fields, no padding) |
| L5 | "Dynamic offers / reliability already real" — claimed pre-existing, not rebuilt | outside this diff | `business_request_offers`, `get_partner_avg_response_time`, `get_partner_offer_reputation` (all pre-Aug-15) | — | **UNVERIFIED THIS PASS** — confirmed these objects exist and are referenced consistently by L7's new ranking RPC, but not independently re-exercised end-to-end in this audit (out of the diff under review; was verified in an earlier, separate session per CLAUDE.md) |
| L8/9/10 | "Not separable build items" | — | — | — | **SPECIFIED BUT NOT BUILT** — a scope-framing argument, not something this audit can verify as correct or incorrect; carried into §13 rather than accepted at face value |

---

## 2. Core functionality

Every RPC and trigger in the diff was exercised with real disposable data against production
(`enmosvippabmuqslzrox`), not just read. Full transcripts are in
`PRODUCT_AUDIT/scratch/v2_live_verify.js` / `v2_live_verify2.js` (kept for reference). Summary:
all 6 new functions and both new triggers behave exactly as their own code says, with **two
exceptions**, both real and reproduced (§3, §7). The consumer→business intent flow this diff
extends (predictive nudge → `handleHomeIntentSubmit` → classifier → resolver) was traced at the
code level and correctly reuses the existing, already-verified Aug 14/15 resolver path — no new
parallel code path was introduced that could drift from it.

**Not exercised**: the actual Anthropic classifier call each nudge action triggers (same
standing gap as every other AI-backed flow in this codebase — no live signed-in session
available in this sandbox to mint a real access token).

## 3. State machines / correctness — 2 CONFIRMED DEFECTS

**DEFECT A — CONFIRMED, HIGH SEVERITY, PRIVACY REGRESSION.**
`get_my_group_intent_signals()` does not filter on `profiles.intent_visibility`, the column
built specifically (10/10 roadmap Part 6, Aug 15) to let a user hide their own open
`business_requests` from friends/matches. The sibling function it's explicitly modeled on,
`get_connected_open_business_requests()` (Tier 2 of the resolver), *does* apply
`p.intent_visibility = 'friends_and_matches'`.

Reproduced live, side by side, same state: Claude (connected to Allen via an accepted
friendship) sets `intent_visibility = 'nobody'`. Calling `get_connected_open_business_requests`
as Allen correctly excludes Claude's request. Calling `get_my_group_intent_signals` as Allen in
the identical state **still returns Claude's real display name** inside `requester_names`.

```
"groupIntent_afterClaudeOptedOut": [{ "category": "Coffee", "request_count": 2,
  "requester_names": ["Claude", "Google voice"], "soonest_date": "2026-08-16" }]
"tier2_afterClaudeOptedOut_forComparison": [{ "requester_display_name": "Google voice", ... }]
```
(Claude present in one, absent in the other, same underlying data, same caller, same moment.)

This also means `notify_group_intent_threshold()` (the push trigger) computes its own
"did this cross 1→2" count using every connected user's open requests **regardless of their own
`intent_visibility` setting** — a user who opted out can still silently move someone else's push
notification from "not sent" to "sent."

**Impact**: a user who explicitly told the app "don't show my open requests to my friends" has
their name and request surfaced to their entire connected network anyway, through a feature
shipped the same day as the privacy control it bypasses. This is not a hypothetical — it was
reproduced with real production data and cleaned up afterward.

**DEFECT B — CONFIRMED, MEDIUM-HIGH SEVERITY, CORRECTNESS BUG.**
`get_cross_user_intent_patterns()`'s migration comment claims it "reuses `getTimePeriod()`'s
exact real bucketing rule... in SQL, not a new invented time bucketing scheme." It does not.
`getTimePeriod()` (client, `timeContext.js`) buckets by the **device's local wall-clock time**
(`date.getHours()`/`date.getDay()`). The SQL RPC buckets by `extract(dow/hour from
s.created_at)` directly on a `timestamptz` column — which Postgres evaluates in the **session's
timezone (UTC)**, not the submitter's local time. There is no per-user timezone stored anywhere
in this schema to correct for it.

Reproduced live: inserted 10 real rows at `2026-08-20T00:15:00Z` — exactly 8:15 PM EDT on a real
Wednesday for any actual U.S. Eastern user (a textbook "evening" submission by the client's own
rule). The RPC returned:
```
{ "category": "Wine", "period": "morning", "submission_count": 10, "distinct_users": 4, ... }
```
`"morning"`, not `"evening"` — because UTC hour was `0`. For any real user outside UTC (i.e.
essentially all of them), every cross-user pattern's day-of-week and time-of-day dimension is
silently wrong, and near UTC-midnight the *day itself* can flip (a Friday-evening U.S. ask can
bucket as Saturday "weekend" in UTC, or vice versa) — the exact "weekend boundary" class of bug
this same codebase has caught and fixed three separate times elsewhere (client-side date-window
math), just reintroduced here server-side.

**Everything else tested in this category was correct**: both triggers' fire-once-at-crossing
behavior (§7), the marketplace-rankings threshold and hand-checked arithmetic, the group-intent
2+ threshold, the aggregated-demand radius math (including the out-of-radius negative case),
duplicate-submission idempotency was not separately re-tested this pass (no new write path was
added that could double-submit — all 6 objects are read RPCs or AFTER INSERT triggers with no
retry/idempotency surface of their own).

## 4. Database / RLS / security

- Grants for all 6 new functions confirmed live to exactly match their source
  (`grant execute ... to authenticated`, `revoke ... from public, anon`; the two trigger
  functions are additionally revoked from `authenticated` — correct, they have no legitimate
  direct caller).
- `check_is_admin()` gating (L7, L2) confirmed live: a non-admin (`Claude`) calling either
  admin-only RPC is rejected with the function's own real error message, not a silent empty
  result.
- Ownership gating (L1) confirmed live: a non-owner calling `get_aggregated_demand_for_partner`
  for a business they don't manage gets an empty result, not another business's data.
- `business_requests` itself has no SELECT policy that would let a stranger read it directly —
  confirmed the only two live policies are "own rows" and "rows I've made a real offer on." The
  Defect-A leak is specifically a gap in the *new RPC's own filtering logic*, not a broader RLS
  hole — every other tested unauthorized-access vector (non-owner reading business demand,
  non-admin reading rankings/patterns, a non-connected user reading group signals) was correctly
  rejected.
- Attempted-and-failed unauthorized access, per the audit's own required list:
  - Read another user's private data → **partially failed to block** (Defect A — a specific data
    field, not a wholesale breach; every other tested field/table was correctly scoped)
  - Modify another user's records → not applicable (this diff adds zero new writable
    surfaces beyond the two AFTER INSERT triggers, which write only pushes, not data)
  - Impersonate a business → **blocked** (ownership check verified)
  - Accept another user's offer / manipulate capacity → not applicable, no new capacity/offer
    write path in this diff
  - Elevate privileges → not applicable, no admin-grant surface in this diff (uses the
    pre-existing `check_is_admin`)

## 5. Real end-to-end testing

Done against production with real disposable data end-to-end for every new RPC/trigger (§2, §3,
§7). The consumer flow (predictive/group-intent card tap → `handleHomeIntentSubmit` →
classifier → resolver → result) was traced at the code level, not executed live — the classifier
call itself needs a real signed-in session this sandbox cannot mint (same standing limitation as
every AI-backed flow in this codebase's own history). The business flow (aggregated demand
appearing on the dashboard, a business acting on it) has no new *write* path in this diff at all
— "Demand Near You" is read-only situational awareness, not a new opportunity/offer mechanism —
so there's no additional business-side transaction to trace beyond what Aug 14's Business
Fulfillment work already covers (out of this diff's scope).

## 6. Existing product regression

- Full Jest suite: **42/42 passing**, unchanged (`intentResolverScoring`, `timeContext`,
  `intentPatterns`, `gatheringIndoorOutdoor`).
- `npx expo export --platform ios`: clean, 1868 modules, no bundling errors.
- Live-tested that the two new AFTER INSERT triggers on `business_requests` do not block or
  break request creation: every one of ~20 disposable `business_requests` rows inserted during
  this audit succeeded normally, including the pre-existing `create_business_request`/
  `_business_request_fanout` code path being exercised indirectly (any insert into this table
  fires the new triggers identically regardless of caller) — no new failure mode observed.
- No V1 table was altered by this diff (`ALTER TABLE` does not appear in any of the 4 new
  migrations) — the new triggers are additive AFTER INSERT hooks, not a change to
  `business_requests`' own write contract.
- Not separately re-run this pass: a full click-through of Home/Discover/Create/Inbox/Profile
  (would need a live device — see §7).

## 7. Real device

**UNVERIFIABLE IN THIS ENVIRONMENT.** This is a sandboxed CLI session with no iOS/Android
device or simulator attached — this is a standing, repeatedly-disclosed limitation across this
entire codebase's history (every prior session's own "not done yet" notes say the same thing).
No claim of device testing is made anywhere in this report. Everything client-side above was
verified by: (a) direct source reading of the diff, (b) a clean Metro/Expo export (proves the
code parses, bundles, and resolves — not that it renders correctly), (c) the existing Jest
suite. None of these substitute for a real device run. This category is marked **UNVERIFIED**
across all sub-items (build/version, login, navigation, loading, errors, notifications, deep
links, keyboard, permissions, network transitions, background/foreground, restart persistence)
— not FAILED, since nothing was found broken, but genuinely never checked.

## 8. Network / failure conditions

Not independently re-tested this pass. Two relevant facts, established by direct code reading,
not inference: (1) `net.http_post` (used by both new triggers) is Supabase's async HTTP queue —
it enqueues and returns without waiting for the network call to complete, so a slow/failed push
delivery cannot roll back the `business_requests` insert that triggered it (consistent with
every other push-sending trigger already in this schema). (2) Neither new client mutation path
(`getMyGroupIntentSignals`, `getAggregatedDemandForPartner`) is called from inside a try/finally
that could leave UI state stuck — `HomeScreen.js` wraps the group-intent fetch in its own
try/catch (console-logs and continues); `BusinessDashboardScreen.js`'s `loadAggregatedDemand`
does the same. Duplicate-tap protection on the two new "act" buttons was not verified (no
disabled-while-submitting state visible in the diff for `handlePredictiveAct`/
`handleGroupIntentAct` — a fast double-tap would call `handleHomeIntentSubmit` twice; whether
that's actually harmful depends on the already-existing classifier/resolver's own idempotency,
which is out of this diff's scope and was not re-tested here). Flagged as **UNVERIFIED**, not
assumed safe.

## 9. Performance

No missing-index defect found for the read paths actually added (`business_requests_open_expires_idx
(status, expires_at) WHERE status='open'` already supports both new RPCs' and both new triggers'
primary filter). **Real, flagged risk, not yet exercised**: neither `business_requests` nor
`brand_partners` has a spatial/composite index on `(category, latitude, longitude)` — the
haversine radius check in `get_aggregated_demand_for_partner` and in both new triggers is a
sequential-scan-and-compute over every open row in the category, run **on every single
`business_requests` insert** (the two new triggers), not just on read. At today's real
production volume (0 real `business_requests` rows) this is invisible and was not — could not
honestly be — load-tested; this is the same "no fabricated load-test numbers" position this
codebase has taken everywhere else, stated plainly here rather than either fabricating a number
or silently omitting the risk. Every insert into `business_requests` now does measurably more
work than before this diff (two additional trigger executions, each with a nested query loop) —
real, not hypothetical, just not yet a problem at real data volumes this low.

## 10. Analytics

Both "act" paths (predictive nudge, group-intent card) route through the existing
`handleHomeIntentSubmit`, confirmed to call `recordIntentSubmission` (line-verified) — so a
nudge that's acted on is captured by the existing intent-funnel analytics exactly like a
manually-typed ask. **Gap, not previously disclosed**: neither card's own *impression* nor its
*dismissal* is recorded anywhere (dismissal only writes an `AsyncStorage` key, no analytics
event) — there is no way to compute "how often is the nudge shown vs. dismissed vs. acted on,"
which is the one number that would actually validate whether either nudge is worth its own
screen real estate. Not a defect (nothing in the vision doc explicitly required it), but a real
instrumentation gap worth naming rather than silently absent.

## 11. Migrations

**VERIFIED via a real from-scratch replay**, not just read: pulled `supabase/postgres:15.1.0.147`,
dropped and recreated a truly empty `public` schema, patched the two known image-version gaps
(`auth.users.phone`, `storage.buckets.public`), ran all 34 files in `supabase/migrations/` in
filename order with `psql -v ON_ERROR_STOP=1` — **exit 0 on every file**. Confirmed all 6 new
functions and both new triggers exist in the freshly-rebuilt database. Container removed
afterward. This closes the "can a fresh empty project be rebuilt from committed files alone"
question for this diff specifically — it can.

One thing this replay incidentally re-confirms rather than newly finds: `20260815_cross_user_
intent_patterns.sql` sorts alphabetically *before* `20260815_intent_submissions_and_funnel_
stats.sql` (the migration that creates the `intent_submissions` table it queries) — this is safe
only because the function is `language plpgsql` (catalog-checked at call time, not creation
time), not `language sql` (which would have failed the replay the way an earlier, unrelated
migration in this same file's history already did once). Correct today, but a fragile ordering
dependency worth naming.

## 12. Build / deployment

`npx expo export --platform ios` clean (1868 modules). **Anomaly, flagged not fixed**: 5
uncommitted local file changes exist in the working tree, unrelated to this diff (see §0) — the
build verified above reflects the working tree *including* those stray edits, not the clean
state of the 3 V2 commits in isolation. No debug code, stale feature flag, or dead code path was
found in the 11 files this diff touches.

## 13. Documentation vs. implementation

CLAUDE.md's own description of this work is largely accurate to the diff — every function name,
threshold number, and behavior claim it makes matches what's actually in the migrations and
client code (this was cross-checked line by line while building the requirements matrix, not
assumed). **One material inaccuracy found**: the `get_cross_user_intent_patterns` migration's
own comment claims to reuse `getTimePeriod()`'s "exact real bucketing rule," which is false per
Defect B (§3) — the SQL and the client rule diverge on timezone. CLAUDE.md's own text repeats
this same unverified claim. No other documented claim was found to contradict the code.

## 14. Scope completeness

**A. BUILT + VERIFIED** (this audit's own live evidence, not the build session's word):
- L6 predictive nudge (card, dismiss, act-routes-to-resolver)
- L3 group-intent RPC + threshold-crossing push (both correct on the count/threshold mechanics;
  see Defect A for the one real gap)
- L1 aggregated-demand RPC + dashboard section + threshold-crossing push
- L4 multi-option result grouping (pure client regroup, no new data)
- L7 marketplace reliability rankings (admin-gated, threshold-gated, hand-checked arithmetic)
- L2 cross-user pattern infrastructure, admin/threshold gating (see Defect B for the one real gap)
- Migration replay from empty database
- No V1 regression in the automated test suite or a clean bundle export

**B. BUILT BUT NOT VERIFIED** (real code exists; this audit could not exercise it):
- The actual Anthropic classifier call each nudge action ultimately triggers (no live session
  available in this sandbox)
- Any real device rendering/interaction for either new Home card or the two new admin-dashboard
  sections
- Duplicate-tap / stale-client / backgrounded-during-action behavior for the two new "act" buttons
- Nudge impression/dismissal analytics (doesn't exist to verify — see §10, this is really a C item
  dressed as a B item; listed here because the underlying *cards* work, just not their funnel)
- L5's claimed pre-existing infrastructure (real, but outside this diff and not re-exercised here)

**C. SPECIFIED BUT NOT BUILT** (not hidden under "future enhancement"):
- **The `intent_visibility` privacy filter on the group-intent RPC and its push trigger** — this
  isn't a new feature that was never scoped; it's an existing, already-shipped privacy control
  that this diff's own sibling function (`get_connected_open_business_requests`) already honors.
  Its absence here is a real completeness gap against the diff's own stated design intent
  ("Reuses the identical connected-set definition... already established there"), not merely a
  missing nice-to-have.
- **Local-time-correct bucketing for cross-user patterns** — the vision doc and the migration's
  own comment both claim this exists; it does not, per Defect B.
- Layers 8, 9, 10 of the original vision doc — genuinely not built, and the claim that they're
  "not separable build items" is the *build session's own framing*, not something this audit
  independently confirmed or refuted. Recorded here as unbuilt, with that framing attached as
  context rather than adopted as fact.
- Nudge-level analytics (impression/dismiss rate) — never specified in the vision doc, so this is
  a gap against a reasonable bar, not against a stated requirement; kept in C for completeness
  rather than silently dropped.

---

## Final verdict

# 🟡 YELLOW — substantially complete, with specific, real, confirmed defects

Six of six targeted vision-doc layers have working, live-verified mechanics — the RPCs compute
what they claim to compute, the thresholds gate correctly, the pushes fire exactly once at the
real crossing point and never nag, the admin/ownership checks hold under a real unauthorized
attempt, and the migrations replay cleanly from nothing. That is a materially stronger evidence
bar than "the code exists and looks right," and most of it clears that bar.

It is not GREEN because of two confirmed, reproduced defects, not stylistic nitpicks: a real
privacy regression (a user's explicit opt-out is silently ignored by one specific new feature)
and a real correctness bug (an entire analytics dimension — time-of-day — is wrong for
non-UTC users). Both are narrow and specific, not systemic — everything else tested was correct.

It is not RED because nothing here is broken in a way that makes the feature unusable, unstable,
or wrong at the mechanism level — the defects are precise, already-diagnosed, and each has an
obvious, narrow fix (add the same `intent_visibility` predicate the sibling function already
uses; convert the bucketing to operate on a client-supplied local period instead of a UTC
`extract()`).

### Tallies

- Total V2 requirements audited: **16** (per the requirements matrix in §1)
- Verified: **12**
- Verified with a confirmed defect: **2** (L3-1 group signals, L2-1 cross-user patterns)
- Unverified (inherited/out-of-diff, not independently re-run this pass): **1** (L5)
- Specified but not built (framing claim, not a code gap): **1** (L8/9/10, as a category)
- Critical defects: **0**
- High-severity defects: **1** (Defect A — privacy control bypass, real name/data exposure)
- Medium-high defects: **1** (Defect B — timezone-naive analytics bucketing)
- Low-severity / process gaps: **3** (dismiss-key inconsistency for group-intent recount, no
  nudge impression/dismiss analytics, uncommitted unrelated working-tree changes)

**No code was changed to produce this report.** Fixing Defect A and Defect B, plus deciding
whether the low-severity items are worth closing, is a decision for the next explicit turn —
not something this audit took upon itself.
