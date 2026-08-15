# Nearby — Production Architecture Reference (as of 2026-08-15)

Written at the start of a feature-freeze/stabilization period (see `CLAUDE.md`'s "Feature
Freeze" banner). This is the single reference doc for "how does the current system actually
work" — architecture, state machines, migration sequence, resolver behavior, business
marketplace behavior, RLS/privacy rules, the analytics funnel, and known limitations. It is a
snapshot, not a changelog — for the blow-by-blow history of how each piece was built and
verified, `CLAUDE.md` remains the authoritative log.

Every claim below was checked against the actual current code/schema/migration files on
2026-08-15, not reconstructed from memory of past sessions.

---

## 1. System overview

Nearby is a React Native/Expo app on a Supabase backend (Postgres + RLS + SECURITY DEFINER
RPCs + Edge Functions + Realtime + Storage + `pg_cron`). Project ref: `enmosvippabmuqslzrox`.

**Product surfaces (5 bottom tabs)**: Home ("what's happening in my Nearby life, and what do I
want to do right now") · Discover ("what's out there") · Create ("what do I want to make
happen") · Inbox ("what needs my attention") · Profile/You ("who am I, what have I done").
Settings is reached from Profile, not a tab.

**Core existing product** (pre-dates the intent layer, unchanged by it): 1:1 dating/matching,
gatherings (join/host), communities, a perks/offers marketplace, relationship-longevity tools,
safety/blocking, business partner dashboards.

**The intent layer** (Aug 14–15 2026 build, see §4/§5): a single free-text box on Home
("What do you want to do?") that resolves a request against five real sources — the caller's
own gatherings, their social graph, standing perks, live business availability, and (as a last
resort) a live business marketplace request — before ever offering to create something new.
Locked product principle, unchanged since it was written: **no stranger discovery, ever, via
intent** — every non-business result is scoped to an existing relationship (friend, match,
community membership, own history). Businesses are the one deliberately discoverable category.

**Reproducibility**: the entire schema is rebuildable from committed files alone — one baseline
migration (`00000000000000_baseline.sql`, a flattened, dependency-ordered snapshot) plus 28
incremental migrations in `supabase/migrations/`, replayed clean against a truly empty
Postgres 15.1.0.147 database as of this doc (see §2). 58 tables, 162 functions, 11 cron jobs.

---

## 2. Migration sequence & reproducibility

`supabase/migrations/` currently holds **29 files**, applied in filename lexical order:

- `00000000000000_baseline.sql` — a squashed, topologically-sorted (tables before their FK
  dependents; policies/triggers deferred until after every function they reference exists)
  snapshot of everything that existed before Aug 9 2026's schema-baseline fix. This is the one
  file a fresh project replay actually depends on for the bulk of the schema.
- 28 dated incremental migrations, `20260809_*` through `20260815_*`, one per schema change
  since the baseline was cut — covering (in rough chronological/thematic clusters): bounded
  nearby-gathering queries and indexed search (Aug 9), business onboarding enrichment and
  billing notifications (Aug 10), business partner categories (Aug 11), profile voice intro
  (Aug 12), the full Business Fulfillment build — request/offer/accept/reservation, proactive
  availability, gathering-sourced demand, Tier 2 friend-request matching, weekend date-range
  fixes, spam guard (Aug 14) — and the 10/10 roadmap's own schema (architecture-hardening race
  fixes, intent outcomes, intent submissions + funnel stats, intent visibility, market
  validation stats, partner response/reputation — Aug 15).
- Older migrations (pre-Aug-9, and anything else fully subsumed by the baseline) live in
  `supabase/migrations_archive/` — kept for historical reading, deliberately excluded from the
  replay path so they can't double-apply against objects the baseline already creates.

**Verified today (2026-08-15), from a truly empty database**, closing a gap that had been
disclosed-but-not-individually-closed for Parts 1–5 of the 10/10 roadmap (each of those parts'
own status notes flagged "no from-scratch Docker replay run for this specific migration" at the
time it landed — a prior combined replay covered only the Aug 14 Tier-2/match-id migration and
the Parts 6–9 migrations, not Parts 1–5's):

1. Pulled the pinned `supabase/postgres:15.1.0.147` image (already cached).
2. Started a fresh container with `pg_cron`/`pg_net`/`pg_stat_statements` in
   `shared_preload_libraries` and `cron.database_name=postgres` set at process start (a
   postmaster-level setting; must be set on container launch, not patched in after).
3. Dropped and recreated an empty `public` schema.
4. Created `pg_cron`/`pg_trgm`/`pg_net` as `supabase_admin` (the actual superuser in this pinned
   image — `postgres` itself is not a real superuser here, a known quirk of this image
   documented in several past sessions) — extensions live outside `public`, so this survives
   the schema drop/recreate in step 3.
5. Patched the two known image-version gaps onto the test container only (not the committed
   files): `auth.users.phone`, `storage.buckets.public` — both real, current-production columns
   absent from this older pinned GoTrue/Storage build.
6. Ran all 29 files in filename order via `psql -v ON_ERROR_STOP=1`, one `psql` invocation per
   file so a failure names the exact file it happened in.

**Result: exit 0 on every one of the 29 files, first pass, no errors.** Post-replay counts in
the freshly-rebuilt database: 58 tables, 162 functions, 11 `cron.job` rows. Spot-confirmed the
newest objects from every one of the 9 roadmap parts exist: `intent_outcomes`,
`intent_submissions`, `business_availability`, `get_market_validation_stats`,
`get_intent_funnel_stats`, `profiles.intent_visibility`. Container removed afterward.

**Standing rule going forward (already codified in CLAUDE.md's "Known conventions" section,
restated here since it's load-bearing for reproducibility)**: one migration file per schema
change, never a duplicate hand-patch baked into the baseline in the same change — the exact
shape of bug that caused this gap to exist in the first place (see CLAUDE.md's Aug 9 2026
"schema-reproducibility regression" entry). Every future schema change should get this same
from-scratch replay before being considered done, not just a live-production check.

---

## 3. Critical state machines

Every state machine below uses this schema's established shape: one row per lifecycle, a
`status` enum, per-phase timestamps, not a table per transition. Every write goes through a
SECURITY DEFINER RPC — no table in this list has a client-writable INSERT/UPDATE for its status
column.

### 3.1 `business_requests` / `business_request_offers` (the Business Fulfillment lifecycle)

The core of the intent layer's Tier 4 (and Phase 3/4's gathering-demand and proactive-
availability extensions). One `business_requests` row per consumer ask
(`status: open|fulfilled|expired|cancelled`); one `business_request_offers` row per
`(request_id, partner_id)` pair, collapsing opportunity-sent → offer-submitted → accepted →
completed into one row (`status: pending|offered|accepted|declined|expired|cancelled|completed`).

- **Reservation integrity**: a partial unique index —
  `unique (request_id) where status in ('accepted','completed')` — guarantees only one offer
  per request can ever win, enforced at the database level, not client-side.
- **`accept_business_offer()`** — locks the offer row `FOR UPDATE` at first read (fixed Aug 15,
  see §3.5 — previously read-then-blind-update with no lock, a real concurrent-overwrite race),
  re-checks status under the lock, flips the winner to `accepted` and every sibling
  `pending`/`offered` row on the same request to `expired`, flips the parent request to
  `fulfilled` — all one transaction.
- **`submit_business_offer()`** — checks the caller manages the offer's `partner_id`, checks the
  row is still `pending`, flips to `offered`.
- **`complete_business_reservation()`** — business- or consumer-triggered, closes the loop.
- **Two independent scarcity axes**, both re-verified live end-to-end on 2026-08-15 (Part 5):
  (a) per-request winner (the unique index above), (b) shared capacity across *different*
  requests matched to the same `business_availability` posting — `remaining_capacity` is
  decremented under a `FOR UPDATE` lock only at accept time, not at offer time; hitting zero
  flips the posting to `filled` and rejects a second accept even though that second offer was
  independently valid.
- **Fan-out** (`_business_request_fanout()`, internal-only, locked down but callable from
  sibling SECURITY DEFINER functions) notifies eligible nearby businesses, capped, matching
  category/radius — shared by the solo path (`create_business_request`), the gathering-sourced
  path (`create_business_request_for_gathering`), and reused for anti-duplication (a spam guard
  added Aug 14 returns the same request id for a literal repeat ask instead of creating a
  second row).
- **Two-way matching** (`business_availability`, Phase 4): a business posts time-boxed
  availability; posting immediately scans open requests and upserts real `offered` rows
  (`on conflict (request_id, partner_id) do update ... where status = 'pending'` — never
  clobbers an already-`offered` row from a different posting). A new request immediately scans
  active availability via `_match_request_to_availability()`. Both directions share the same
  upsert shape.
- **Gathering-sourced demand** (Phase 3, gatherings only — communities deliberately excluded,
  no scheduled date/precise location to source from): `party_size`/`date`/`latitude`/`longitude`
  are read server-side from the gathering's own real data, never client-supplied; host-only.

### 3.2 `gathering_interest` (join/capacity/waitlist)

`status: pending|approved|waitlisted`. `join_gathering()` locks the gathering row `FOR UPDATE`,
counts `approved` rows under the lock; at/over capacity always waitlists (public or
host-approval alike), under capacity preserves today's exact behavior (public auto-approves,
host-approval stays pending). Idempotent on retry. `leave_gathering()` deletes the caller's own
row and, if it was `approved` and `capacity` is set, auto-promotes the earliest `waitlisted` row
under the same lock. `approve_gathering_interest()` — fixed Aug 15 (see §3.5) — now locks the
target row and requires it still be `pending` before approving, closing a double-approval/
capacity-overcounting race. `invite_only` visibility additionally requires a real accepted
`social_invites` row before `join_gathering()` will even queue a `pending` request (Aug 9 fix).

### 3.3 `community_members`

`role: creator|leader|member`. INSERT policy allows self-insert for a public community, the
creator, or (added Aug 8, fixing a real bug found in the Aug 9 flywheel trace) a friend who
holds a real accepted `social_invites` row for a private community. `set_community_member_role()`
(creator-only) toggles `leader`↔`member`. SELECT visibility for a private community's full
roster is creator-only; a regular member of a private community only ever sees their own row —
a deliberate, longstanding constraint, not a bug.

### 3.4 `friendships` / `matches` / `social_invites`

`friendships.status: pending|accepted`, self-insert + `send`/`respond` RPCs, blocks-checked.
`matches` are created via `least`/`greatest`-ordered `(user_a, user_b)` pairs with
`on conflict do update ... where source_gathering_id is null` (never overwrites a real source).
`social_invites` (`invite_type: gathering|community`) is the one polymorphic table backing every
non-push-only invite path — `send_social_invite()`/`respond_to_social_invite()`, both
blocks-checked (a real gap found and fixed Aug 8 — `send_social_invite` initially shipped
without a blocks check like its sibling functions had).

### 3.5 Race-condition fixes (Architecture Hardening Audit, Part 3, 2026-08-15)

The two fixes referenced in the roadmap's own closing summary, confirmed real and confirmed
fixed by directly reading the *live* RPC bodies (via `pg_get_functiondef`) rather than the
migration files in isolation, since a later `CREATE OR REPLACE` can drift from what a migration
file alone shows:

1. **`accept_business_offer()`** — read the offer row with no lock, checked status against that
   stale read, then did a blind update with no re-check. A concurrent `decline_business_offer()`
   or the hourly expiry cron landing in that window could silently overwrite an `accepted`
   offer back over. **Fixed**: lock the row `FOR UPDATE` at the first read, matching every
   sibling function on the same table.
2. **`approve_gathering_interest()`** — no status guard and no lock at all. A retried/
   double-tapped approve on an already-`approved` row would re-count capacity *including
   itself*, and at exactly-at-capacity could silently demote an already-approved attendee back
   to `waitlisted`. **Fixed**: lock-and-require-`pending` guard, matching the same
   double-review pattern already used by `business_partner_requests`/
   `id_verification_submissions`.

Both were reproduced against real disposable test data before and after the fix (not just
reasoned about) — see `PRODUCT_AUDIT/ARCHITECTURE_HARDENING_AUDIT_2026-08-15.md` for the full
before/after transcripts. **Not independently deep-audited this pass** (flagged, not silently
skipped, in that audit's own "Not reached this pass" section): `set_community_member_role` and
the plain-client `respondToFriendRequest()` path were read but not adversarially tested.

---

## 4. Intent resolver behavior

`src/services/intentResolver.js`, `resolveIntent({ category, dateWindow, rawText })` — the
function behind Home's "What do you want to do?" box. Five branches run in parallel
(`Promise.allSettled`, one shared location fetch for the two location-dependent branches), each
scored on one shared axis, merged, sorted descending, capped at 4 results:

| Branch | Source | Score basis |
|---|---|---|
| Gatherings | `getNearbyGatherings('wide')` + shared `getGatheringFitReasons()` for display reasons only | `SCORE_INTEREST_MATCH` (interest match) + `SCORE_CLOSE_DISTANCE` (<2mi) + `SCORE_HAPPENING_NOW` (today) + a title-mention tie-breaker (raw text word appears in the gathering's own title) |
| Communities (`resolveCommunityIntent`, gated on a real category) | Own + public-not-yet-joined communities | `SCORE_OWN_NETWORK` (already a member) or `SCORE_INTEREST_MATCH` (public match), plus the same title-mention bonus |
| Connected friend/match requests (`resolveConnectedRequests`, Tier 2) | `get_connected_open_business_requests` RPC — friends ∪ matches only, gated by each requester's own `profiles.intent_visibility` | Flat `SCORE_OWN_NETWORK` |
| Standing perks (`resolvePerks`) | `getActiveOffers()`, gated on location permission | `SCORE_INTEREST_MATCH` if `target_interest_tag` matches |
| Business availability (`resolveBusinessAvailability`) | `search_active_business_availability` RPC, real haversine distance | `SCORE_INTEREST_MATCH` + `SCORE_CLOSE_DISTANCE` + a flat "eligible now" bonus |

`community`/`business_partner`-classified intents skip the gathering/perk/availability branches
entirely and only ever check `resolveCommunityIntent`. Business-partner intents (proposing a
specific business as sponsor) skip resolution entirely — no existing-supply concept applies.
An `unclear`-classified ask gets an explicit, honest explanatory line ("Nearby doesn't search
for individual people directly...") rather than silently becoming a generic gatherings browse.

If all five sources come back empty, the flow falls through to Tier 4 — "Ask Nearby Businesses"
(`AskBusinessScreen` → `create_business_request`), the one deliberately discoverable-to-
strangers category, per the locked no-stranger-discovery principle (§6).

**Every result type has an explicit selection/outcome tracking call site** (§7) —
`recordIntentSelection()` fires at every real exit point (all 5 resolver result types, the
"create it yourself" escape hatch, and the empty-fallback "ask businesses fresh" path).

---

## 5. Business marketplace behavior

Beyond the core lifecycle in §3.1:

- **Reliability signals, real-data-gated**: `get_partner_avg_response_time()` (median
  minutes-to-respond, `percentile_cont`) and `get_partner_offer_reputation()` (response rate,
  acceptance rate, completion rate — three distinct funnel stages, each `nullif(...,0)`-guarded
  against divide-by-zero) — both silent until a partner has 5+ real past opportunities, so a
  brand-new business never shows a damning "0% accepted" born from having no history. Surfaced
  on `BusinessRequestDetailScreen`/`BusinessProfileScreen` via a shared
  `formatPartnerReliabilityLine()` so both screens can never render two different summaries of
  the same numbers.
- **Marketplace-wide rollup**: `get_market_validation_stats()` aggregates the same response/
  acceptance/completion math across *every* partner's offers at once, admin-only, feeding the
  Market Validation dashboard (§7).
- **Category taxonomy**: a fixed 25-tag `interest_tag` list (canonical source:
  `QuickPicksEditModal.js`'s `INTEREST_OPTIONS`) is the resolver's real precision ceiling —
  documented, not hidden — e.g. "pickleball" collapses to "Sports" with no sub-category
  matching anywhere; the title-mention tie-breaker (§4) is a partial, honest mitigation, not a
  fix.
- **Privacy boundary within the marketplace**: `profiles.intent_visibility`
  (`friends_and_matches|nobody`, default `friends_and_matches`) narrows — never widens — Tier
  2's connected-request surfacing. It has no effect on Tier 4 (a business ask is inherently
  visible to businesses; that's the point of that tier).

---

## 6. RLS / privacy rules

**Locked, hard product principle, unchanged since it was written**: Nearby never exposes
unconnected strangers through the intent layer. Every person-shaped result requires an existing
friendship, match, or gathering/community relationship. Businesses are exempt by design — they
are intentionally participating as discoverable supply.

- **`is_blocked(a, b)`** — SECURITY DEFINER (fixed Aug 8 2026 after a real, confirmed
  production bug: as a plain SQL function it ran under the *caller's own* RLS, so a blocked
  party querying from their own session couldn't see the block row that would have excluded
  them — a blocked user could still see/message the person who blocked them). Now bypasses RLS
  internally but only ever answers for a pair where `auth.uid()` is one of the two ids —
  prevents the fix itself from becoming a new "can I check if X has blocked me" probe. Backs
  ~10 policies: `matches`, `messages` (SELECT+INSERT), `notices`, `sightings`,
  `shared_playlist_items`, `business_messages` (both INSERT policies, added same pass).
- **`profiles` privileged-column protection**: `prevent_self_premium_edit()` trigger guards
  `is_premium`/`managed_partner_id`/`is_admin`/etc. — a legitimate server-side write must set
  `app.trusted_update` first, or the client's attempted value is silently reverted. (`is_admin`
  was added to this guard Aug 8 2026 after a live-confirmed full self-escalation exploit — any
  authenticated user could set their own `is_admin = true`. `bonus_notices` similarly moved
  behind two RPCs, `spend_bonus_notice`/`grant_referral_bonus`, plus the same trigger guard,
  closing a currency-exploit gap the same day.)
- **`gatherings` visibility funnel**: `visibility` (`everyone|friends|community|invite_only`)
  is enforced by which query results a screen surfaces (`getNearbyGatherings()`'s server-side
  `get_bounded_nearby_gathering_ids()` RPC does the friends/community/invite_only filtering),
  not by RLS itself — `gatherings`' own SELECT policy is `using (true)`, a longstanding,
  deliberate posture in this schema (a shared link or accepted invite always works for the
  person holding it, same as a "private" gathering has always behaved). `invite_only` join is
  additionally hard-gated server-side in `join_gathering()` (Aug 9 fix) — a caller without a
  real accepted invite is rejected before reaching the capacity/blocks checks.
- **`community_members` RLS recursion** (fixed Aug 8 2026, live-confirmed to have been
  completely broken beforehand): the SELECT policy and `communities`' own SELECT policy each
  depended on evaluating the other's RLS-protected read — genuinely infinite recursion on the
  simplest possible `select ... where user_id = auth.uid()`. Fixed via a new SECURITY DEFINER
  `is_community_visible_to()` that bypasses RLS on one side of the cycle.
- **`gatherings` table grant**: `authenticated` had no `SELECT` grant on the table at all (found
  and fixed Aug 8 2026, live-confirmed) — independent of and prior to RLS, every direct
  `.from('gatherings')` client call would have failed for every real user.
- **Default-privileges footgun** (recurring, called out explicitly in "Known conventions"):
  new Postgres functions default to PUBLIC execute, and this project's default-privileges setup
  additionally grants new functions directly to `anon` — always `revoke ... from public, anon`
  explicitly for a function not meant to be public; several functions were found already leaking
  in exactly this way across different passes (Aug 7's business RPCs, Aug 15's `is_blocked`
  originally, others).

---

## 7. Analytics funnel

Built across Parts 1, 2, and 9 of the 10/10 roadmap — a real, three-layer instrumentation stack,
with **no fabricated numbers anywhere**: every percentage in every RPC is `nullif(...,0)`-
guarded against a zero denominator rather than defaulted to a placeholder, and every UI screen
renders a plain "—" for `null` rather than a fake 0%.

1. **`intent_submissions`** — one row per `resolveIntent()`/`resolveCommunityIntent()` call,
   successful or not (category, date window, raw text, which tier(s) returned a candidate,
   whether the business fallback was reached).
2. **`intent_outcomes`** — one row per selection the user actually acted on (tapped through to a
   real result, or explicitly chose "create it yourself"), linked back to its `submission_id`.
   A lightweight "How did it go?" prompt (👍/😐/👎 + "would you do this again?") is shown once
   per row, gated on being asked at least 4 real hours after selection — `outcome` stays `null`
   (never defaulted to negative) until actually answered.
3. **`get_intent_funnel_stats()`** (admin-only SECURITY DEFINER RPC) — real counts/percentages
   computed from the two tables above: % of submissions with any resolver result, % reaching
   business fallback, % of results tapped through, % of answered outcomes that were positive,
   and a **30-day repeat-submission rate** (`pct_repeat_submitters` — same user submitting a
   similar-category ask again within 30 days).
4. **`get_market_validation_stats()`** — adds real 7-day/30-day cross-session return rate (does
   a distinct submitter's *second* submission land at least 7/30 real days after their first)
   plus the marketplace-wide partner reliability rollup from §5.
5. **`MarketValidationScreen.js`** (admin-only, reachable from Settings) renders all of the
   above across three sections — Intent Funnel, Return Rate, Marketplace Reliability. Its own
   subtitle states plainly that this is a young app and the numbers will read near-zero for a
   long while — that is the correct, honest state, not a bug to hide.

**Candidate north-star metric, worth naming explicitly rather than leaving buried as one line
among many**: the **repeat intent rate** — the fraction of people who come back and ask Nearby
for something a *second* time, especially across a materially different context (not just "the
same Friday-night coffee ask again," but "dinner tonight" one week, "something fun Saturday" the
next). This is already computed today, twice, at two different granularities:
`get_intent_funnel_stats()`'s 30-day same-category repeat-submission rate, and
`get_market_validation_stats()`'s 7-day/30-day cross-session return rate (any category). Neither
number is fabricated — both are real queries against real rows — but neither is currently framed
in the UI as *the* signal to watch. The behavior this metric is a proxy for is the actual product
thesis: a user who starts thinking "whenever I want to do something, I'll just ask Nearby"
instead of browsing. Recommendation for whoever next reviews real pilot data: treat this number,
tracked over time as real usage accrues, as the single clearest read on whether the intent layer
is actually changing user behavior — not funnel completion rate, not business acceptance rate,
both of which measure the marketplace working correctly rather than the *habit* forming. No UI
change was made to elevate this during this pass — this is a feature-freeze period and the
metric already exists and is already rendered; visually re-prioritizing the dashboard is exactly
the kind of change to defer until real pilot data says it's worth a design decision.

---

## 8. Known limitations

Stated plainly, not softened — these are the things a pilot needs to go in aware of:

1. **No manual simulator/device run-through has ever been performed on this entire codebase,
   for any feature, across the whole build history.** This is the single most-repeated line in
   `CLAUDE.md` — every feature listed as "DONE, build-wise" has been verified via clean bundle
   exports, direct SQL/RLS checks against live production with disposable test data, and (for
   schema changes) from-scratch migration replays — never an actual tap-through on a running
   app. This is the largest real risk entering a pilot: rendering/layout/gesture bugs, timing
   issues, and anything that only shows up under real device conditions are entirely unverified.
2. **Weather is a current-conditions snapshot, not a real forecast.** The Home weather card
   pulls a single point-in-time OpenWeatherMap read, not an hourly forecast API — copy was
   softened (Aug 10) to stop implying a specific future time ("tonight"), but it still can't
   make a genuinely time-specific claim ("rain after 7 PM"). A real forecast integration was
   explicitly scoped out (new API, new cost/latency) pending a real decision.
3. **The 24-tag category system is the resolver's real precision ceiling** (§5) — a title-
   mention tie-breaker partially mitigates it; the taxonomy itself has not been expanded.
4. **No payment processing anywhere in the app.** Business billing (`business_invoices`,
   contract-based monthly generation) computes real amounts owed on a schedule but nothing has
   ever actually charged a business — deliberately deferred pending a real Stripe/processor
   decision with the user present (real external account, real money).
5. **Business-partner-request → live availability communities are gathering-only**, not
   community-only — communities have no scheduled date or precise location to source demand
   generation from, a real, named, deliberately-unclosed gap (Phases 3 and 4 both flagged it
   independently and left it open).
6. **Load testing and a real production-monitoring dashboard were never attempted** — both need
   live deployed infrastructure and real traffic this sandbox has never had access to. This is a
   standing limitation of every session that has worked on this codebase, not something specific
   to any one feature.
7. **Parts 1–5 of the 10/10 roadmap's own individual migrations were not each independently
   replayed at the time they landed** (each disclosed this honestly in its own status note) —
   **closed today** (§2): a full from-scratch replay of all 29 current migration files now
   passes clean, which retroactively proves the schema as it exists today, including every one
   of those parts' own objects.
8. **AI features (Create Assistant, business AI assistant, translate/icebreaker/etc.) share one
   Anthropic API key and one rate-limit counter** (`check_and_increment_ai_use`) — a shared,
   not per-feature, budget. All of them went dark at least once already this build history when
   the underlying Anthropic account ran out of credit (Aug 11 2026) — an account-billing
   dependency external to the codebase, not a code defect, but worth monitoring during a pilot
   since it silently breaks every AI-backed feature at once.
9. **No admin self-serve tooling for business contracts** — `partner_contracts` rows (the
   billing-model config each business is charged under) are created by hand via the SQL editor
   or service role, not through any UI. Fine at current scale, a real gap before onboarding
   partners at any volume.

---

## 9. Where to look for more detail

This doc is a synthesis; the following existing files carry the full, granular history behind
each claim above and should be treated as more authoritative for any specific incident:

- `CLAUDE.md` — the complete build log, session by session, with every live-verification
  transcript.
- `PRODUCT_AUDIT/ARCHITECTURE_HARDENING_AUDIT_2026-08-15.md` — the full race-condition audit
  behind §3.5.
- `PRODUCT_AUDIT/INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md` /
  `INTENT_LAYER_INTEGRATION_AUDIT_2026-08-14.md` / `INTENT_LAYER_PHASE1_AUDIT_2026-08-14.md` —
  the resolver's own build/audit history.
- `PRODUCT_AUDIT/DATABASE_AND_DATA_MODEL.md` — schema detail predating this pass.
- `PRODUCT_AUDIT/AUDIT_CHANGELOG.md` — the running FIXED/STILL-PRESENT classification log from
  every full product-audit refresh.
