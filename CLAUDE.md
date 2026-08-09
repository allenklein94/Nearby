# Nearby — Project Context for Claude Code

Nearby is a proximity-based dating/social discovery app (React Native/Expo/Supabase).
This file captures known outstanding work as of early August 2026, so a fresh Claude Code
session has the same context as the chat session that built most of this.

## Aug 9 2026 — second AI's post-refresh review: shift from build→audit loop to hardening + device QA — plan steps 1-4 DONE

Written before implementation, same restart-safety convention as every other plan-first section
in this file. After the `PRODUCT_AUDIT` refresh (all 20 flywheel-trace legs re-verified, no new
BROKEN/MISSING transitions, every P0 from the original audit confirmed fixed), the user shared a
second AI's reaction. Its core call — the build→audit→build loop has run its course; the core
product loop is now substantially connected; the next phase is real-device QA, not more
features — is agreed with, no reservation. Also agreed without reservation: no Stripe work yet,
no new giant audit, no AI Concierge expansion, no Stories 2.0/new tabs, defer large-file
refactors (`GatheringsScreen`/`ChatScreen`/`BusinessDashboardScreen`) until actually touching
those areas rather than refactoring for its own sake, business partnership stays admin-gated for
now (a deliberate decision, not a code change).

**One correction to the second AI's framing, important for how this actually gets executed**:
"device QA" is not something a Claude Code session can perform — this sandbox has never had
simulator/device access, the single most-repeated standing limitation in this entire file. So
the roadmap isn't "Claude does device QA next" — it's "Claude closes out the remaining
code-level items below, then this file's job is done until a real device pass (the user's own,
or a future session with real device access) finds something concrete to fix." The 5-persona
test script is captured below so it survives to whenever that pass actually happens, not
something this session runs itself.

**Verified every concrete claim in the second AI's message directly against the repo before
committing to this plan** (same standing rule as every other section in this file — don't build
on a claim without checking it against the live code first):
- **Hardcoded backend URLs — confirmed accurate, matches the "12 more files" claim almost
  exactly.** Grepped for the literal `enmosvippabmuqslzrox.supabase.co` string across `src/`:
  12 files / 13 call sites remain beyond the 3 already fixed earlier today —
  `CompatibilityReportModal.js`, `ChatScreen.js` (3 sites: courage-message/translate-message/
  generate-icebreaker), `account.js`, `aiConcierge.js`, `createAssistant.js`, `dataExport.js`,
  `extraPhotos.js`, `photos.js`, `presenceStatus.js`, `proximity.js`, `textModeration.js`, and
  one more found while checking (next bullet). All of them hit Edge Functions, so all trivially
  reduce to the same `functionUrl()` helper already centralized in `services/supabase.js`
  earlier today for the first 3 — mechanical, no new pattern needed.
- **Found while checking, unrelated to the URL issue itself**: `src/services/src/
  services/textModeration.js` — a genuine accidental nested-directory duplicate (byte-identical
  to the real `src/services/textModeration.js`, save a trailing newline), confirmed zero
  importers anywhere in `src/`. Pure dead cruft from some past copy/paste mistake; delete
  alongside the URL cleanup pass since it's already been found.
- **Pending-join "withdraw request" gap — confirmed real, and cheaper to fix than it sounds.**
  `GatheringDetailScreen.js`'s `approved` and `waitlisted` post-join panels both already have a
  real, working "Leave Gathering"/"Leave Waitlist" button wired to `leaveGathering()` — and
  `leave_gathering()` (the underlying RPC, built in the Aug 8 Capacity/Waitlist pass) already
  deletes the caller's own `gathering_interest` row regardless of its status, not just
  `approved`. The `pending` panel (host-approval, awaiting review — around line 544-546) has no
  such button at all, only static text ("You're interested — the host will review and let you
  know."). Since the RPC already supports this status, this is a pure client-side wiring gap,
  not new schema/RPC work: add the same `confirmLeave`/`leaveGathering()` action to the pending
  panel, relabeled "Withdraw Request."
- **`FeaturesOverviewScreen` — the second AI's premise doesn't hold up, nothing to fix here.**
  Read the screen directly: it's a static expand/collapse reference glossary ("tap a category to
  see what's inside" — plain text descriptions per feature, zero `navigation.navigate` calls
  anywhere in the file). There are no dead tap-throughs to make work or remove. Dropped from the
  plan rather than silently acted on.
- **Chemistry Diary — real gap, but narrower than described.** A working entry point already
  exists: `ChatScreen.js`'s "Together" menu has "📔 Log a Chemistry Check-In" →
  `ChemistryDiaryEntry`. The actual gap: `ChemistryDiaryListScreen.js`'s own empty-state copy
  promises "Add an entry any time... from their profile or a chat," but only the chat half is
  real — `ViewProfileScreen.js` has zero references to Chemistry Diary anywhere. Genuinely P2
  per the second AI's own ranking; not touched in this pass, just corrected here for accuracy so
  a future session doesn't assume the whole feature is unreachable.
- **Migration discipline — agreed, worth codifying as a standing rule, not just this one-time
  fix.** See item 3 below.

**Plan, in order — steps 1-5 DONE this pass:**
1. **DONE.** Centralized the remaining 12 hardcoded URLs onto the existing `functionUrl()`
   helper: `CompatibilityReportModal.js`, `ChatScreen.js` (3 call sites), `account.js`,
   `aiConcierge.js`, `createAssistant.js`, `dataExport.js`, `extraPhotos.js`, `photos.js`,
   `presenceStatus.js`, `proximity.js`, `textModeration.js` — each gained `functionUrl` on its
   existing `supabase` import and swapped its literal URL for `functionUrl('function-name')`.
   Confirmed via a repo-wide grep afterward that `enmosvippabmuqslzrox.supabase.co` appears
   nowhere in `src/` except the one `SUPABASE_URL` constant in `services/supabase.js` itself.
   Deleted the stray duplicate `src/services/src/services/textModeration.js` (confirmed zero
   importers before deleting).
2. **DONE.** Added a "Withdraw Request" action to `GatheringDetailScreen.js`'s `pending` panel,
   reusing `confirmLeave`/`leaveGathering()` — no new RPC needed, `leave_gathering()` already
   deletes the caller's own row for any status. `confirmLeave()` itself gained a real `pending`
   branch (was previously binary approved-vs-waitlisted only) so the confirmation alert shows
   honest copy for this case too — "Withdraw your request?" / "The host won't see your request
   anymore." — instead of the waitlist-specific wording that would have been wrong here.
3. **DONE.** Added the migration-discipline rule to "Known conventions" (bottom of this file):
   one migration file per schema change, verified via a clean-database replay (the
   `supabase/postgres:15.1.0.147` Docker method) before being considered done, not just applied
   to production.
4. Business partnership approval stays admin-gated — no code change; decision recorded.
5. **DONE.** Full `npx expo export --platform ios` — clean, 1850 modules (unchanged from the
   pre-existing baseline: this pass only edited existing files and removed one file that was
   already outside the bundle graph, so no module-count change was expected). Committed and
   pushed.
6. **Standing going forward**: no further autonomous feature work after this. The next real
   input this app needs is the 5-persona device QA pass below, which only a session with real
   device/simulator access (or the user directly) can actually run.

**Explicit status of the second AI's own numbered P1 list, since it doesn't map 1:1 onto the
plan above** (asked directly after this pass landed — recorded here so it's never ambiguous on
a future resume):
- **#4 Hardcoded URLs — DONE**, see step 1 above.
- **#5 Pending-join withdraw request — DONE**, see step 2 above.
- **#6 Client-side non-indexed search — DONE, built when the user asked to do it now rather
  than wait.** `DiscoverHubScreen.js`'s unified search previously filtered the already-fetched
  full `gatherings`/`communities` arrays client-side with a plain lowercase `.includes()`
  substring check, unconditionally downloaded regardless of whether the user was searching at
  all. Scoped deliberately to gatherings + communities only (see the offers note below).
  - **Schema** (`20260809_indexed_text_search.sql`): enabled `pg_trgm`, added GIN trigram
    indexes on `gatherings.title`, `gatherings.description`, `communities.name`,
    `communities.description`. Applied to production and verified two ways: confirmed the
    extension and all 4 indexes exist live via `pg_extension`/`pg_indexes`, then inserted a
    real temporary gathering + community with a distinctive title/name/description
    (`ZzxSearchVerify...`), ran the actual `ILIKE '%zzxsearchverify%'` queries against both
    columns on each table and got real matches, confirmed a non-matching term correctly
    returned zero rows, and — with `set enable_seqscan = off` — confirmed via `EXPLAIN` that
    Postgres's planner genuinely chooses `Bitmap Index Scan on gatherings_title_trgm_idx` /
    `communities_name_trgm_idx` for this exact query shape, not just that the index exists
    unused. Both test rows deleted afterward; production confirmed back to its exact pre-test
    baseline (5 gatherings, 0 communities). Also replayed the full `supabase/migrations/`
    folder against a truly empty database (the Docker method from the new migration-discipline
    rule below) — exit 0, all 4 files applied cleanly in order, this migration included.
  - **`services/gatherings.js` refactored**, not just extended: `getNearbyGatherings()`'s
    blocks/women-only/friends-or-community-or-invite-only visibility pipeline was factored out
    into shared `fetchGatheringVisibilityContext()` / `applyGatheringVisibilityFilters()` /
    `enrichGatheringsWithDistanceAndSort()` helpers, so the new `searchGatherings(queryText,
    tier)` reuses the exact same privacy-relevant filtering on its server-side-narrowed row set
    — a search can never surface a gathering plain browse would have excluded (a blocked host,
    a friends/community-only gathering the caller doesn't qualify for, an invite-only
    gathering). Runs two separate `.ilike()` queries (title, description) and merges by id in
    JS, rather than building a `.or('title.ilike....,description.ilike....')` string out of raw
    user input — PostgREST's `.or()` syntax gives comma/parenthesis real meaning, and a plain
    per-column `.ilike()` call sidesteps that parsing surface entirely. ILIKE's own `%`/`_`
    wildcards are escaped so a literal percent sign or underscore typed by a user is matched
    literally.
  - **`services/communities.js`**: new `searchPublicCommunities(queryText)`, same two-query
    merge shape, scoped to `is_public = true` — identical base filter to the existing
    `getPublicCommunities()` (now also using the same shared `PUBLIC_COMMUNITY_SELECT`
    constant), so search can't surface a private community the caller isn't a member of.
  - **`DiscoverHubScreen.js`**: new debounced effect (350ms, 2-character minimum — matching the
    screen's own pre-existing Places search threshold exactly) calls both search functions and
    stores results separately from the always-fetched browse lists; `filteredGatherings`/
    `filteredCommunities` read from the search results while actively searching, the untouched
    full lists otherwise. Added a loading spinner + honest "No gatherings/communities match
    "..."" empty state for both sections while searching, mirroring the Places section's own
    existing loading/empty pattern exactly (previously, only Places had this — Gatherings/
    Communities just silently rendered nothing while search results were empty either way).
  - **Offers deliberately left on client-side filtering, not overlooked**: `getActiveOffers()`'s
    base query is already narrow (active, non-gathering offers only), the real number of
    business partners this app will have stays small for a long while by nature of the
    business model, and matching `brand_offers.title`/`description` *and*
    `brand_partners.name` server-side would need a genuine cross-table search — PostgREST's
    `.or()` can't OR a condition on a joined table against the base table in one request, so
    this would need a new Postgres function, not just an indexed column. Not worth building for
    a list this size; flagged in the code itself, not silently left unexplained.
  - Verified via a full `npx expo export --platform ios` — clean, 1850 modules (unchanged, this
    pass only edited existing files).
- **#7 FeaturesOverview tap-through — not applicable, the second AI's premise didn't hold up on
  inspection.** Confirmed by reading `FeaturesOverviewScreen.js` directly: it's a static
  expand/collapse reference glossary (tap a category header → see plain-text feature
  descriptions) with zero `navigation.navigate` calls anywhere in the file — there is no
  "buttons that don't do anything" to fix or remove, because there are no buttons that claim to
  go anywhere in the first place. Nothing built or changed for this item.

**Follow-up, same day: `GatheringsScreen.js` wired to the same indexed `searchGatherings()`
built for #6, plus a real architectural gap flagged (not fixed) while doing it.** After #6
landed, noticed `GatheringsScreen.js` has its own separate search box over the exact same
`gatherings` table `DiscoverHubScreen.js`'s search was just fixed on — it was still doing the
old unindexed client-side `.toLowerCase().includes()` filter over the already-fetched `nearby`
array. Asked the user whether to wire it now (cheap reuse of the function already built) or
leave it queued; user said do it now. This was mid-build when a codespace restart hit —
resumed cleanly, `git status` showed the in-progress edit to `GatheringsScreen.js` still
present and uncommitted, finished from there.
- `GatheringsScreen.js` now imports `searchGatherings` and runs the identical debounced
  (350ms, 2-character minimum) pattern `DiscoverHubScreen.js` already uses — a
  `gatheringSearchRequestId` ref guards against a slow earlier request overwriting a newer one's
  results (matters more here than on Discover since this screen's `radiusTier` toggle can also
  fire a re-search mid-flight). Passes the screen's own `radiusTier` (Local ~1mi / Wider Area
  ~15mi) straight through to `searchGatherings(term, tier)` — search now genuinely respects
  whichever radius the user has selected, not just browse. `filteredNearby` reads from the real
  search results while `searchQuery.trim().length >= 2`, the untouched full `nearby` list
  otherwise; the existing category/trending/date filters still apply on top of either source
  unchanged — search only ever replaced the old text-match `.filter()`, nothing else in the
  funnel. Added a loading spinner + honest `No gatherings match "..."` empty state, matching the
  pattern #6 already established on Discover.
- Verified via a full `npx expo export --platform ios` — clean, 1850 modules (unchanged, this
  was an edit to an existing file only, same as #6).

**Real, deliberately-unfixed architectural gap flagged while doing this pass — read before
assuming search is the only cost problem here.** Both #6's fix and this follow-up only indexed
the *search box* query path. The *browse* path both screens use whenever the user isn't
actively searching — `getNearbyGatherings()` — has no radius or row-count bound at the SQL
level at all: it downloads literally every future row in the entire `gatherings` table,
unconditionally, then does all distance and visibility filtering in JavaScript on the client.
This was invisible today because production has 5 real gatherings total, but at real scale this
is the actual "download 50,000 rows" problem, and it was a bigger issue than the search box was —
search was a missing index (mechanical, safe to fix in isolation); this was the browse funnel's
own fundamental shape. **Fixed later the same day, see below** — the user asked directly to
close this out rather than leave it queued.

**`getNearbyGatherings()` SQL-level bound — DONE, same day, follow-up to the section above.**
A plain `WHERE within max_miles` radius bound couldn't be the fix on its own — checked git
history first before writing anything, and found this app has an explicit, deliberate product
decision on the books already: commit `dd576983` ("Public gatherings are now visible regardless
of distance, private gatherings stay tiered by radius"), still enforced today in
`enrichGatheringsWithDistanceAndSort()`'s own `gathering.is_public || gathering.distanceMiles <=
maxMiles` filter. A naive radius-bounded query would have silently broken that and hidden public
gatherings the app is supposed to keep showing network-wide — the kind of silent behavior change
this file's own conventions warn against. The real fix had to replicate that exact rule
server-side, not just add a distance clause.
- **Migration** (`20260809_bounded_nearby_gatherings.sql`): new `get_bounded_nearby_gathering_ids
  (my_lat, my_lng, max_miles, row_limit default 500)` SECURITY DEFINER function — `is_public`
  rows pass through regardless of distance (matching `dd576983` exactly), non-public
  (host-approval) rows are geographically bounded by `max_miles` via a real bounding-box
  pre-filter on `precise_lat`/`precise_lng` (1 degree latitude ≈ 69 miles, same style of
  approximation this file already uses elsewhere, e.g. Create 2.0's walk-time estimate) followed
  by the same exact haversine formula `get_gathering_distances()` already uses for the final
  precise check — and every path is capped by a hard `row_limit`, ordered by soonest-upcoming,
  so the query can never return more than `row_limit` ids regardless of table size. Two new
  indexes, `gatherings_scheduled_at_idx` and `gatherings_precise_lat_lng_idx` — with the former,
  Postgres can satisfy `scheduled_at > now() order by scheduled_at asc limit row_limit` with an
  index scan that stops once `row_limit` matches are found, instead of a full sequential scan +
  in-memory sort of the whole table; the latter backs the bounding-box pre-filter. Only ever
  returns `id` (never `precise_lat`/`precise_lng` themselves) — same privacy posture
  `get_gathering_distances()` already established. `auth.uid()` is read internally rather than
  taken as a parameter, matching this file's own established RPC-ownership convention (e.g. the
  `check_and_increment_ai_use`/business-RPC fixes) rather than trusting a client-supplied caller
  id. Granted to `authenticated` only, revoked from `public`/`anon`.
- **`getNearbyGatherings()` rewritten** to call this RPC first to get a bounded candidate-id
  list, then does a second `.in('id', candidateIds)` select for the real row data (title, host,
  attendee joins, etc.) — same two-step "narrow via RPC, then fetch full rows for just those
  ids" shape `searchGatherings()` already uses for its own ILIKE-matched results. Everything
  downstream — `applyGatheringVisibilityFilters()` (blocks/women-only/friends/community/
  invite_only), `enrichGatheringsWithDistanceAndSort()` (real distances, fuzzed map coordinates,
  the final `is_public || distanceMiles <= maxMiles` filter, sort) — is completely unchanged, so
  this is purely a bound on what gets fetched, not a rewrite of what gets shown.
  `searchGatherings()` itself was left as-is, not touched — its own row count is already
  naturally bounded by the ILIKE text match, and the flagged issue was specifically about the
  unconditional browse path, not search.
- **Verified live against production** (`enmosvippabmuqslzrox`), not just applied: confirmed
  grants (`authenticated` can execute, `anon` correctly cannot) and both new indexes exist, then
  ran a real four-gathering test as a real profile (`Allen` as caller, `Claude` as host, an
  arbitrary reference point far from any real user) — a public gathering 1000 miles away was
  correctly **included** (public bypasses distance), a private gathering 0.5 miles away was
  correctly **included** (private, within radius), a private gathering 50 miles away was
  correctly **excluded** (private, outside radius), a public gathering 0.1 miles away was
  correctly included. Separately confirmed the host-exclusion clause (calling as the host of all
  4 test rows returns none of them), the `row_limit` bound (capping at `row_limit=1` returned
  exactly 1 of 3 real matches), that the local-tier (`max_miles=1`) still correctly includes the
  far-away public gathering (matching the "public bypasses distance at every tier" rule, not a
  bug), and that an `anon`-role call is rejected with a real permission-denied error. All 4 test
  gatherings deleted afterward; confirmed production back to its exact pre-test baseline (5
  gatherings).
- **Verified via a real from-scratch migration replay, not just live application** — per this
  file's own migration-discipline rule (see "Known conventions" at the bottom): pulled the real
  `supabase/postgres:15.1.0.147` Docker image (already cached from an earlier session), dropped
  and recreated an empty `public` schema, patched the two known image-version gaps onto the test
  container only (`auth.users.phone`, `storage.buckets.public`), then ran the entire
  `supabase/migrations/` folder in order with `psql -v ON_ERROR_STOP=1` — exit code 0, all 5
  files applied cleanly including this one, and the new function/indexes were confirmed to exist
  in the freshly-rebuilt database afterward. Container removed after verification.
- Verified via a full `npx expo export --platform ios` — clean, 1850 modules (unchanged, this
  was an edit to an existing file plus one new migration, no new client files).
- **Not done, same standing gap as everywhere else in this file**: no manual device/simulator
  run-through of the Gatherings/Discover screens after this change — next session should confirm
  the nearby/attending lists still populate correctly and the Local/Wider Area toggle still
  behaves as expected on a real device.

**Device QA script — for whenever a real device pass happens, not something this sandboxed
session can run itself. Kept here so it survives to that point regardless of how many sessions
or restarts happen between now and then.**

- **Person 1, brand-new user**: sign up → onboarding → Home → Discover → find a gathering → join
  → invite someone → receive the notification → chat → attend → community → return later. Note
  every point of hesitation.
- **Person 2, gathering organizer**: create a gathering (category → date/time → location →
  publish) → invite → watch participants come in → chat → modify/cancel → post-gathering flow.
- **Person 3, community user**: discover a community → join → view it → chat → create a
  gathering from inside it → participate.
- **Person 4, business**: business onboarding → business profile → partnership request/approval
  → offer a perk → a user redeems it → confirmation code → dashboard shows the redemption.
- **Person 5, stranger/safety test — the most important one**: block, unblock, a private
  gathering, an invite-only gathering, a private community, messaging permissions, location
  visibility, removing someone, reporting, leaving a gathering/community. Actively try to break
  the privacy model, not just click through it.
- **Kill-the-app test, both iOS and Android**: start an important flow, force-close the app,
  reopen, tap the notification/deep link that was pending, confirm it lands exactly where it
  should. This directly exercises the Aug 9 cold-start push-tap fix documented below — proving
  it on a real device is the one thing that fix has never actually had.

## Aug 9 2026 — schema-reproducibility regression found during audit refresh (fixed)

While re-verifying the flywheel trace as part of the `PRODUCT_AUDIT` refresh (see the section
immediately below), found that the Aug 9 schema-baseline fix's own central claim — "a fresh
empty Supabase project can be rebuilt from committed files alone" — had silently regressed
since it was proven true. `supabase/migrations/20260809_social_invite_community_join.sql`
(the flywheel trace's own leg-4 fix, private-community invite-accept → real membership) was
committed alongside a patch to `supabase/migrations/00000000000000_baseline.sql` that baked the
identical fix directly into the baseline's own `community_members` INSERT policy (same commit,
`428ae572`) — but the live migration file was never moved to `supabase/migrations_archive/`
the way this exact class of problem is supposed to be handled (this is the identical conflict
shape the original baseline-fix session found and fixed once already for the `visibility`/
`capacity` columns). Net effect: a fresh replay of `supabase/migrations/` in order would create
the policy via the baseline, then fail on the incremental migration's own `create policy` for
the same policy name — Postgres's `CREATE POLICY` has no `IF NOT EXISTS` clause. Production
itself was never affected (the policy is already correctly live there); this only broke
rebuilding a *new* empty project from committed files.

**Confirmed with a real replay, not just by reading the SQL** (same Docker method as the
original baseline verification — `supabase/postgres:15.1.0.147`, a truly empty `public` schema,
the two known image-version column patches — `auth.users.phone`, `storage.buckets.public` —
applied to the test container only): applying the live `supabase/migrations/` folder in order
(baseline → `20260809_business_customer_notes.sql` → `20260809_business_profile_self_edit.sql`)
now succeeds with exit code 0 end-to-end. **Negative control**: re-applied the archived file on
top of that same already-migrated state and confirmed it fails exactly as predicted —
`ERROR: policy "Users can join public communities, invited communities, or thei" for table
"community_members" already exists` — proving the fix (not something else) is what resolves it.
The other two live post-baseline migrations (`20260809_business_customer_notes.sql`,
`20260809_business_profile_self_edit.sql`) were checked too and are genuinely fine — neither
table/function exists in the baseline, so they're correctly incremental, no duplication.

**Fixed**: moved `supabase/migrations/20260809_social_invite_community_join.sql` to
`supabase/migrations_archive/` (`git mv`) — the fix it contains is already fully present in the
baseline, so nothing is lost, only the duplicate live copy is removed from the replay path.
Container removed afterward, nothing persisted beyond the verification itself.

## Outstanding: PRODUCT_AUDIT full refresh (Aug 9 2026) — DONE

The user asked for a complete refresh of `/workspaces/Nearby/PRODUCT_AUDIT/` against the
**current** repo — 21 commits / 69 files / +14443/-461 lines had landed since that audit was
written (commit `d96f10cf`), so it was genuinely stale, not a rubber-stamp re-run. Explicit
rules followed: current repo as sole source of truth (old audit used only as a diffing
baseline); every previously-identified issue given a real FIXED/STILL PRESENT/PARTIALLY FIXED/
NO LONGER APPLICABLE/COULD NOT VERIFY classification verified against current implementation;
read-only, no application code changes; the 13 existing `PRODUCT_AUDIT/*.md`+`.json` files
overwritten in place (no second folder); one new file added, `AUDIT_CHANGELOG.md` (kept going
forward across future refreshes, unlike the other 13 which get fully overwritten each time);
max 2 concurrent agents throughout.

**Survived a codespace restart mid-pass** — Agent B's live-production security recheck and the
from-scratch 20-transition flywheel trace both completed and were saved to disk before the
restart hit; only Agent A's codebase re-scan was lost and had to be relaunched fresh on resume
(cost: ~7 minutes, nothing else). `PRODUCT_AUDIT/REFRESH_PROGRESS.md` (the restart-safety
scratch file used to track this) has since been deleted along with the other 3 intermediate
research files, per the plan's own step 7 — all four were scratch, not deliverables.

**Headline result**: every one of the last audit's 6 P0 items is now FIXED, 4 of them
independently live-re-verified against production (not just re-read) — `is_blocked()`'s
historical safety bug, the business-RPC ownership checks, and the schema-reproducibility claim
all moved from "reported fixed, never independently confirmed" to "confirmed live, with real
disposable test data, cleaned up afterward." **One genuine regression was found and fixed within
this very refresh pass**: a duplicate-effect migration (`20260809_social_invite_community_join.sql`)
left un-archived, which would have broken a from-scratch `supabase/migrations/` replay — see the
section immediately above for the full account; this is the same finding, cross-validated
independently by both the direct investigation and Agent B's live catalog analysis. The flywheel
trace found no new BROKEN or MISSING transition across all 20 steps. Full item-by-item
classification, new findings (a 12-file-wider hardcoded-URL scope, two small dead-code items,
`hosting_partner_id` self-edit now confirmed protected), and package housekeeping notes are all
in `PRODUCT_AUDIT/AUDIT_CHANGELOG.md` — read that file, not this section, for the complete
record; this section is intentionally kept short since the changelog is now the durable home for
this detail.

## Aug 9 2026 — push-notification cold-start tap silently dropped (fixed)

Asked directly to verify whether a `gathering_invite` push tap actually reaches an invite-only
gathering correctly. The invite-only access check itself (`getGatheringById()`,
`services/gatherings.js:742-756`) turned out to be sound and reachability-independent — it
re-queries a real accepted `social_invites` row fresh on every load, regardless of how the
screen was opened. **The real bug was upstream, and broader than the invite-only case**: any
push tap (`gathering_invite`, but also `match`/`message`/`wave`/`friend_request`/etc.) that
launched the app from a **fully closed state** was silently dropped. `routeNotificationTap()`
(`services/notifications.js`) bailed out with `if (!navigationRef.isReady()) return;`, but
`App.js`'s `setupNotificationTapHandling()` calls `getLastNotificationResponseAsync()`
immediately on mount — well before the authenticated stack (which needs `session &&
profileComplete`) is mounted. This is the identical class of bug already found and fixed for the
`nearby://gathering/:id` deep link in the Aug 8 2026 audit (see that section below) — that fix
was never extended to push taps.

**Fixed**, mirroring the existing `PENDING_GATHERING_LINK_KEY` pattern exactly:
`routeNotificationTap()` (now exported) stashes the tap payload to AsyncStorage instead of
dropping it when `navigationRef` isn't ready; a new `consumePendingNotificationTap()` replays it
from `RootNavigator.js`'s existing `session && profileComplete` effect (same 300ms `setTimeout`
delay already used for the pending-gathering-link consume). Warm/backgrounded taps are
unaffected — that path already worked, since `navigationRef` is already ready by the time a
running app's listener fires.

Verified via a full `npx expo export --platform ios` (1850 modules, unchanged — edits to
`services/notifications.js` and `RootNavigator.js` only, no new files). **Not done yet, same
standing gap as everywhere else in this file**: no on-device verification of an actual cold-start
push tap — this sandbox has no way to kill the app and deliver a real push to trigger it.

## Outstanding: Remaining PRODUCT_AUDIT polish bugs + almost-full nudge + CRM notes + Business AI Assistant (Aug 9 2026) — DONE, all six items closed

**Status, updated as each piece lands (see plan below for full detail on each item)**:
- Item 1 (small polish bugs: dead `NoticesScreen.js`, dangling `MatchesScreen` import,
  malformed `PlacesScreen.js` empty state, hardcoded backend URLs) — **DONE**, all four fixed.
  `NoticesScreen.js` deleted outright (309 lines, confirmed zero live references — the
  `'Notices'` route has always rendered `ActivityScreen`, not this file); the same import line
  in `RootNavigator.js` removed. `RootNavigator.js`'s dangling `MatchesScreen` import line
  removed (the screen itself is untouched — still used correctly by `InboxScreen.js`).
  `PlacesScreen.js`'s split `ListEmpty`/`Component` props joined into one real
  `ListEmptyComponent`. New `functionUrl(name)` helper added to `services/supabase.js`
  (wraps the same `SUPABASE_URL` constant already used for the Supabase client itself);
  `LoginScreen.js`/`RehearsalRoomScreen.js`/`ProfileScreen.js` now call
  `functionUrl('review-login'|'rehearsal-chat'|'generate-strengths')` instead of each hardcoding
  the full `https://enmosvippabmuqslzrox.supabase.co/functions/v1/...` URL a second time.
- Item 3 (invite a non-app-user to a specific gathering) — **DONE**. `InviteFriendsModal.js`
  gained a "📤 Invite someone not on Nearby yet" link (gathering type only), doing the identical
  `Share.share({ message, url: 'nearby://gathering/{id}' })` call
  `GatheringConfirmationScreen.js`'s `handleShare()` already uses — same one deep link, no new
  schema, reused from both places the modal already opens (`GatheringDetailScreen`'s host
  banner and post-join panel).
- Item 4 ("you're almost full" nudge) — **DONE**. `GatheringDetailScreen.js`'s host banner now
  shows a real "🔥 Almost full — only N spots left" line, computed from the same
  `gathering.capacity`/`gathering.approvedAttendees.length`/`gathering.isFull` already in scope
  a few lines up for the existing spots-filled line — no new query. Threshold:
  `spotsLeft <= max(2, ceil(capacity * 0.2))` and not already full — a real, small-integer
  threshold in the same spirit as this file's other non-fabricated thresholds (e.g. Rewards'
  fixed tier counts), not an invented percentage dressed up as a signal.
- Item 2 (business self-serve profile editing) — **DONE**, and a real, previously-unknown bug
  fixed underneath it. Confirmed live via `pg_policies` before writing anything: `brand_partners`
  had zero UPDATE policy of any kind (RLS enabled, one SELECT-only policy) — meaning the
  pre-existing `updateBusinessAddress()` raw client `.update()` call (wired to the dashboard's
  address banner/modal) has never actually written anything for any real owner, silently no-op'd
  by RLS's default deny this whole time. New `update_business_profile(partner_id, name,
  description, address, latitude, longitude, logo_url)` SECURITY DEFINER RPC
  (`20260809_business_profile_self_edit.sql`, checks `profiles.managed_partner_id =
  partner_id_param`) fixes that silently-broken path (`updateBusinessAddress()` now routes
  through it) and backs a new `updateBusinessProfile()` for name/description/logo — the address
  field itself stays on the existing, now-actually-working address banner/modal rather than
  duplicating that flow into the new one. New "✏️ Edit Profile" button + modal on
  `BusinessDashboardScreen.js`'s Business Profile card (name/description/logo URL — `logo_url`
  is stored and rendered everywhere as a plain public URL string, confirmed via grep, so no
  storage bucket needed) replaces the old static "isn't available yet" message. **Verified live
  against production**, not just applied: as the real business owner (`Allen`, managing
  `Coastal Coffee`), the RPC genuinely updated `brand_partners`; the identical call as a
  non-owner (`Claude`) was correctly rejected (`You do not manage this business`); test edits
  reverted to the exact pre-test row afterward. Verified via a full `npx expo export --platform
  ios` (clean build).
- Item 5 (CRM notes/tags) — **DONE**. New `business_customer_notes` table
  (`20260809_business_customer_notes.sql`, `partner_id`/`customer_user_id`/`note`/`tags text[]`,
  `unique(partner_id, customer_user_id)`) with a SELECT-only RLS policy scoped via
  `profiles.managed_partner_id` (identical shape to `business_invoices`/`partner_contracts`'s
  existing owner-scoped SELECT policies, confirmed live before writing this migration) and two
  SECURITY DEFINER RPCs (`upsert_business_customer_note`/`delete_business_customer_note`, same
  ownership check, revoked from `public`/`anon`) — no direct client INSERT/UPDATE, matching this
  schema's established convention for owner-scoped tables. `BusinessDashboardScreen.js`'s
  existing "Most Engaged" member drill-in (the same expanded panel that already shows visit
  history from `get_business_member_gathering_history`) gained an editable "Notes (only you can
  see this)" text field and a comma-separated tags field with a Save action, loaded/saved via
  new `getBusinessCustomerNote`/`saveBusinessCustomerNote` in `brandOffers.js`. **Verified live
  against production**: as the real owner (`Allen`), upserted a real note for a real customer
  (`Claude`) — succeeded; the identical call as a non-owner (`Claude` themself) was correctly
  rejected (`You do not manage this business`), and the non-owner's own `SELECT` on the table
  correctly returned zero rows (RLS isolation, not just the RPC-level check); deleted the test
  row afterward via `delete_business_customer_note` and confirmed the table is back to 0 rows.
  Verified via a full `npx expo export --platform ios` (clean build).
- Item 6 (Business AI Assistant) — **DONE**. New `supabase/functions/business-ai-assistant/
  index.ts`, deployed to production and confirmed `verify_jwt: true` via the Management API
  (correct on first deploy this time, not left `false` like `ai-concierge`'s first deploy was).
  Gated on business ownership (`profiles.managed_partner_id === partnerId`, read via the
  service-role client, same pattern `ai-concierge` already uses for its own `is_premium` read)
  instead of premium — this is an owner-tiered feature, not a premium one. Rate-limited via the
  same shared `check_and_increment_ai_use`, `daily_limit: 150` (the per-message-feature
  convention, matching `translate-message`/`rehearsal-chat` — a business owner asking several
  follow-ups in one session is the expected shape here, not a single one-off generation like
  `create-assistant`'s 150-used-as-"feels-unlimited" reasoning, still the same number for a
  different reason). **A real, non-obvious wiring problem found and solved while building
  this**: the four business-stats RPCs (`get_business_dashboard_stats`/`_growth`/`_insights`/
  `_visit_frequency`) all internally gate on `auth.uid() = ` the caller's own
  `managed_partner_id` (the Aug 7 ownership fix) — calling them from the Edge Function via the
  service-role client would resolve `auth.uid()` to null and silently return empty data, not an
  error, which would have shipped a assistant that always says "no data" without ever surfacing
  why. Fixed by calling those four RPCs through a second client scoped to the caller's own
  bearer token (`SUPABASE_ANON_KEY` + the original `Authorization` header passed through) —
  the exact same shape `BusinessDashboardScreen.js` itself already uses to call these RPCs, so
  `auth.uid()` resolves correctly via PostgREST's own JWT handling; the service-role client is
  still used for the auth/ownership/rate-limit steps, which don't need a user-scoped `auth.uid()`.
  Only real, already-aggregated numbers (no raw PII, no other users' free text) cross into the
  prompt, wrapped in an explicit `<business_stats>`/`<owner_question>` data boundary — smaller
  injection surface than `ai-concierge`'s candidate-title problem, since there's no
  user-generated content from other users anywhere in this prompt. New
  `src/services/businessAI.js` (`askBusinessAssistant(partnerId, question)`) +
  `src/screens/BusinessAIAssistantScreen.js` (a real chat-thread UI, local-state only — no
  conversation persisted server-side, matching `create-assistant`/`ai-concierge`'s stateless
  single-question shape, just rendered as a running local thread instead of a one-shot result)
  + `BusinessAIAssistant` route (`RootNavigator.js`), reachable from a new "✨ Ask the AI
  Assistant" button on `BusinessDashboardScreen.js`'s Insights tab (shown regardless of whether
  there's enough activity for the static insights card above it to render, since the assistant
  itself honestly says so when there isn't rather than needing to be hidden). **Verified**:
  confirmed the deployed function's `verify_jwt: true` directly via the Management API: and that
  the gateway correctly 401s an unauthenticated request (`curl`). **Not done, same standing gap
  as `ai-concierge`/`create-assistant`**: the actual Anthropic call path (ownership check →
  rate limit → the four-RPC fetch → the real model response) was not exercised end-to-end —
  this sandbox has no way to mint a real signed-in session's access token. Confidence rests on
  matching the already-proven-in-production `create-assistant`/`ai-concierge` pattern
  line-for-line plus the ownership/auth.uid() fix reasoned through above, not a direct test of
  this specific function's success path. Verified via a full `npx expo export --platform ios`
  (clean build).

**Standing limitation, same as everywhere else in this file**: no manual simulator/device
run-through for any of the client-side pieces in this whole section (Edit Profile modal, CRM
notes field, almost-full nudge, non-app-user share action, AI Assistant chat screen) — flagged
for next session same as always. Everything schema/RPC-level was verified live against
production with real test data and cleaned up afterward, per this file's established
convention.



Written before implementation, same restart-safety convention as every other plan-first
section in this file — if a codespace restart hits mid-build, check `git status`/`git log` for
what actually landed vs. what's still just this plan. The user asked directly (by email) to
close out the remaining items from `PRODUCT_AUDIT/CRITICAL_MISSING_FEATURES.md` (items 11-20,
listed but never fixed) plus three items already flagged as deliberately-deferred elsewhere in
this file: the capacity "you're almost full" nudge (Capacity/Waitlist section, top of file),
persistent per-customer CRM notes (Business RPC ownership + CRM section), and a Business AI
Assistant (flagged as a distinct future feature in both the Create Consolidation and Rewards
sections).

**Scope, confirmed by reading each file directly before planning, not assumed from the audit
text**:
1. **`NoticesScreen.js` is genuinely fully dead code** — confirmed: `RootNavigator.js`'s
   `'Notices'` route (`RootNavigator.js:368`) actually renders `ActivityScreen`, not
   `NoticesScreen`; the only references to `NoticesScreen` itself are its own file and an
   unused import in `RootNavigator.js:42`. Every `navigation.navigate('Notices')` call site
   (`notifications.js`, `ActivityBell.js`) has always landed on `ActivityScreen`. Deleting the
   file and its dangling import removes 309 lines of code nothing can ever reach.
2. **`RootNavigator.js`'s `MatchesScreen` import (`line 43`) is a genuine dangling import** —
   confirmed via grep: never used as a `<Stack.Screen component={MatchesScreen}>` anywhere in
   that file. `MatchesScreen` is real and used, just only ever imported directly by
   `InboxScreen.js`, which embeds it inline as a tab — `RootNavigator.js` never needed its own
   copy. Delete the one unused import line only; the screen itself is untouched.
3. **`PlacesScreen.js`'s `ListEmptyComponent` prop is genuinely malformed** — confirmed at
   `PlacesScreen.js:107-108`: the prop name is split across a line break as `ListEmpty` then
   `Component={...}` on the next line, which JSX parses as two separate props
   (`ListEmpty={true}` + a stray `Component` prop `FlatList` doesn't read) instead of one
   `ListEmptyComponent` — so the empty state has never actually rendered. Fix: join back into
   one `ListEmptyComponent={...}` prop.
4. **Hardcoded backend URLs** (`LoginScreen.js:55`, `RehearsalRoomScreen.js:51`,
   `ProfileScreen.js:158`, all `https://enmosvippabmuqslzrox.supabase.co/functions/v1/...`) —
   the project ref is already centralized once in `services/supabase.js`'s `SUPABASE_URL`
   constant; these three call sites just never imported it. Fix: export a
   `functionUrl(name)` helper from `services/supabase.js` and point all three at it instead of
   a second hardcoded copy of the same domain.
5. **Business self-serve profile editing is unbuilt, and worse than the audit line implies —
   found a second, real, live bug underneath it while investigating.** `BusinessDashboardScreen.js`'s
   own "Business Profile" card (line 723) says plainly "Editing business profile details isn't
   available yet." But the address-edit path that *does* exist (`updateBusinessAddress()` in
   `brandOffers.js`, wired to `addressModalVisible`) does a raw client `.update()` on
   `brand_partners` directly — and **`brand_partners` has zero UPDATE policy in its RLS**
   (confirmed live: `pg_policies` shows exactly one policy, `SELECT`-only for `active = true`
   rows; RLS is enabled with `relrowsecurity = true`). Default-deny means that update call has
   never actually written anything for any real owner — the existing address-edit UI has been
   silently broken this whole time, not just missing the rest of the fields. Fix: one real
   `update_business_profile(partner_id, name, description, address, latitude, longitude,
   logo_url)` SECURITY DEFINER RPC (checks `profiles.managed_partner_id = partner_id_param`
   for the caller, same ownership-check shape as the Aug 7 business-RPC security fix), replacing
   both the broken raw address update and the "not available yet" message with one real edit
   form (name/description/address/logo URL — `logo_url` is already stored and rendered as a
   plain public URL string everywhere it's used, confirmed via grep, so no new storage bucket
   is needed for this pass).
6. **No way to invite a non-app-user to a specific gathering** — confirmed: `InviteFriendsModal.js`
   only ever invites existing in-app friends via RPC. The real deep link this needs already
   exists (`nearby://gathering/{id}`, the same one `GatheringConfirmationScreen.js`'s
   `handleShare()` already uses via `Share.share()`), just not exposed from the invite modal
   itself. Fix: add a "📤 Invite someone not on Nearby yet" action to `InviteFriendsModal.js`
   (gathering type only) doing the identical `Share.share()` call — one shared entry point,
   reused everywhere the modal already opens (`GatheringDetailScreen`'s host banner and
   post-join panel), no new schema.
7. **"You're almost full" capacity nudge** — the waitlist/capacity system itself
   (`join_gathering`/`leave_gathering`, live since the Aug 8 Capacity/Waitlist build) never got
   this specific suggestion. `GatheringDetailScreen.js`'s host banner already has real
   `gathering.capacity`/`gathering.approvedAttendees.length`/`gathering.isFull` in scope (used
   a few lines up for the existing "X/Y spots filled" line) — add a real, non-full,
   spots-remaining nudge computed from those same numbers, no new query, no fabricated
   threshold percentage invented from nothing (using the same kind of real small-integer
   threshold this file already uses elsewhere, e.g. Rewards' fixed tier counts).
8. **Persistent per-customer CRM notes/tags** — `get_business_member_gathering_history` (visit
   history drill-in, closed in the Business RPC ownership section) already exists; free-text
   notes/tags per customer don't. New `business_customer_notes` table (`partner_id`,
   `customer_user_id`, `note` text, `tags` text[], `unique(partner_id, customer_user_id)`),
   RLS `SELECT`-only via `profiles.managed_partner_id = partner_id` (identical shape to
   `business_invoices`/`partner_contracts`'s existing owner-scoped SELECT policies, confirmed by
   reading both live), writes only through two new SECURITY DEFINER RPCs
   (`upsert_business_customer_note`/`delete_business_customer_note`, same ownership check,
   revoked from `public`/`anon`) — matching this schema's established "no direct client
   INSERT/UPDATE on an owner-scoped table" convention. Wired into
   `BusinessDashboardScreen.js`'s existing "Most Engaged" member drill-in (the same expanded
   panel that already shows visit history) as an editable notes/tags field, not a new screen.
9. **Business AI Assistant** — genuinely new, matches the distinct future feature already
   flagged (not folded into Concierge) in both the Create Consolidation and Rewards sections
   above. New `supabase/functions/business-ai-assistant/index.ts`, modeled directly on
   `create-assistant/index.ts`'s real, already-deployed pattern (bearer-token auth via a
   service-role `auth.getUser()` call, `check_and_increment_ai_use` rate limiting,
   `claude-haiku-4-5-20251001`) but gated on **business ownership** instead of premium/no-gate —
   checks the caller's own `profiles.managed_partner_id` matches the `partnerId` the request
   claims before doing anything, the same ownership check this session's other business-RPC
   fixes already established, not a new pattern invented for this. Feeds the model only
   real, already-computed aggregate numbers (via the existing `get_business_dashboard_stats`/
   `get_business_growth`/`get_business_insights`/`get_business_visit_frequency` RPCs, called
   server-side inside the function with the service-role client, not client-supplied) — no raw
   customer PII, no free-text user content crosses into the prompt, so this has a materially
   smaller injection surface than `ai-concierge`'s candidate-title problem. New
   `src/services/businessAI.js` (`askBusinessAssistant(partnerId, question)`) +
   `src/screens/BusinessAIAssistantScreen.js` (single chat-style thread, no history persisted
   server-side — same "stateless single question in, single answer out" shape as
   `create-assistant`/`ai-concierge`, not a new multi-turn conversation table), reachable from a
   new "✨ Ask the AI Assistant" row on `BusinessDashboardScreen.js`'s Insights tab.

**Verification plan, matching this file's own established convention**: apply all new
migrations to production (`enmosvippabmuqslzrox`) via the Management API and verify live with
real test data (business-profile-edit ownership check both directions, CRM note upsert/delete
scoped correctly, non-owner rejected) — clean up test rows afterward; deploy
`business-ai-assistant` and confirm `verify_jwt: true` explicitly (checking the actual deployed
setting, not assuming the CLI default matches, per this file's own repeatedly-learned lesson);
full `npx expo export --platform ios` after each meaningful increment; commit and push after
each logical increment, not batched at the end, in case of a mid-session restart. **Standing
limitation, same as everywhere else in this file**: no manual simulator/device run-through —
flagged for next session same as always.

## Outstanding: schema baseline fix + flywheel trace audit (Aug 9 2026) — part 1 DONE, part 2 DONE

Written before implementation, same restart-safety convention as every other plan-first
section in this file. Context: the user directly challenged whether `full_schema_pull_
2026-08-09.sql` (committed as audit item 3's fix, see below) actually makes this repo able to
recreate production from an empty Supabase project using only committed files. Investigated
directly rather than assuming — the answer is **no**, confirmed with a concrete, provable
conflict, not a guess:

- `full_schema_pull_2026-08-09.sql`'s own `create table gatherings` statement already has
  `visibility` and `capacity` merged directly into the column list (it's a flattened,
  fully-merged point-in-time snapshot). But `supabase/migrations/20260808_gathering_
  visibility.sql` and `20260808_gathering_capacity_waitlist.sql` both `alter table gatherings
  add column ...` for those same two columns. Replaying those migrations on top of the pull on
  a fresh project would hit `ERROR: column "visibility" of relation "gatherings" already
  exists`. The pull and the migrations folder are two disconnected artifacts, not a base +
  incremental history.
- The pull is also already stale within the same day it was generated: it was committed
  *before* `20260809_offer_redemption_proof.sql` (the proof-of-redemption confirmation-code
  system) and `20260809_momentum_reward_nudges.sql`, and before this session's own
  `20260809_join_gathering_invite_only_check.sql`. Confirmed directly — zero hits for
  `confirmation_code` anywhere in the pull.
- `supabase/migrations/` only goes back to Aug 6 2026 — everything before that (the original
  ~45 of ~53 real tables) has no migration at all, only the flattened pull. So the migrations
  folder alone can't rebuild from empty either; it assumes a base state nothing in the repo
  creates.

**Plan, part 1 — schema baseline fix:**
1. Patch `full_schema_pull_2026-08-09.sql` with the objects that drifted since it was
   generated (`offer_redemptions` table + `confirm_offer_redemption` + updated
   `generate_monthly_invoices`/`get_partner_billing_estimate`, `send_momentum_nudges` + its
   cron job, and `join_gathering`'s new invite_only check) — queried fresh from live production
   via the Management API, not copied from migration files (a migration file only shows one
   incremental change; the live function/table definition is the actual current truth after
   however many migrations touched it).
2. Re-timestamp the patched file as the real earliest migration
   (`supabase/migrations/00000000000000_baseline.sql`) so a real migration replay starts from
   it, matching standard Supabase CLI "squashed baseline" convention.
3. Move the 31 dated migrations from Aug 6–9 (now fully baked into the baseline) out of the
   live `supabase/migrations/` replay path into `supabase/migrations_archive/` — kept for
   historical/changelog reading, not left where a real replay would double-apply them and
   conflict, same conflict class as the `visibility`/`capacity` example above.
4. Going forward, every new schema change is a real migration timestamped after the baseline —
   the existing "Known conventions" section's rule already says this; the missing piece was
   always a trustworthy zero point to measure "after" from.

**Plan, part 2 — flywheel trace audit**: once the schema fix lands, trace the actual golden
path as a real code-reading audit (navigation params, RPC calls, screen wiring — the same
method behind every "connectivity audit" already in this file), not a simulator run (explicitly
still out of scope per direct instruction). Every transition below gets a real verdict — WORKS /
PARTIAL / MISSING / BROKEN — with a file/line citation, not a guess:
new user opens the app → discovers a gathering → gathering detail → join → invite an existing
connection → where the invite lands → invitee responds → resulting conversation surfaces →
post-gathering → connection becomes a community → community creates its own gathering →
business/perk enters the loop → user returns afterward.

**Not doing yet, per direct instruction / the second AI's own "stop expanding" framing already
agreed with**: no new feature builds (Invite People / Inbox / Create are already substantially
built per this file's own history — see the "second AI's review" reply in-session for the
citations) until the trace audit above actually finds a real gap to point at, rather than
guessing one from outside the repo a third time.

**Part 1 build status: DONE, and verified more rigorously than this file's usual "verified live
against production" convention — this pass verified against a real, throwaway, truly empty
database, which is the actual claim being made ("this file alone rebuilds production from
nothing"), something no production-verification technique can prove by itself.**

Picked back up after a codespace restart interrupted the build mid-way — a session update
forwarded by email (visible above the task list) showed the prior session had already found
part of this the hard way: tables in the original pull were ordered alphabetically, not by FK
dependency (`blocks` referenced `profiles` from ~1500 lines before `profiles` was even
created), confirmed a topological sort was possible (no dependency cycles), and was mid-way
through a second, deeper problem ("also fail on an empty database... let me restructure
properly") when the restart hit. On restart, `git status` showed the migration-archive renames
already staged and two candidate schema files sitting locally: `supabase/migrations/
00000000000000_baseline.sql` (untracked, an earlier attempt) and a modified, newer
`supabase/full_schema_pull_2026-08-09.sql` (edited 82 seconds after the baseline copy — the
"let me restructure properly" pass). Rather than guess which one was further along, checked
both directly: a script-driven table-by-table FK-dependency audit of `full_schema_pull`
confirmed its table order was **already correctly topologically sorted, zero FK-ordering
errors** — so the prior session's alphabetical-order fix had actually landed successfully in
that file before the restart hit.

**But table order wasn't the only "fail on an empty database" problem, which is almost
certainly the deeper issue the prior session's last message ("also fail... let me restructure
properly") was about finding.** Every table's `CREATE POLICY` and `CREATE TRIGGER` statements
stayed physically inline right after their own table, inside the TABLES section of the file —
while the SECURITY DEFINER helper functions many of those policies call (`is_blocked()`,
`is_community_visible_to()`, `check_is_admin()`, `has_mutual_notice()`) and the functions every
trigger's `EXECUTE FUNCTION` clause names both live in a separate FUNCTIONS section much further
down the same file. Confirmed this is a real, table-ordering-independent second bug, not a guess:
`CREATE POLICY`/`CREATE TRIGGER` both validate that every object their expression references
already exists at creation time (unlike a plpgsql function body, which is only syntax-checked,
not validated against the catalog, until first execution) — so on a truly fresh project, the
very first policy referencing a not-yet-defined helper function (e.g. `business_messages`' own
policy calling `is_blocked()`) would fail immediately, regardless of how correctly the tables
themselves were ordered. Wrote a script-driven, content-preserving reorder: every table's
`CREATE TABLE`/`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`/`CREATE INDEX` statements stayed in
the TABLES section (none of those depend on a function existing); every `CREATE POLICY` and
`CREATE TRIGGER` statement was deferred (same per-table grouping/comments, same relative table
order) into two new sections placed after FUNCTIONS: "ROW LEVEL SECURITY POLICIES" and
"TRIGGERS". Verified this was a pure reorder, not a rewrite, two ways before trusting it: every
`create table`/`create policy`/`CREATE TRIGGER`/`create index` statement-start count matched
exactly between the before/after files (52/132/36/9), and a full multiset diff of every
non-blank, non-marker-comment line in both files came back with **zero** lines lost or altered
— the only lines present in the new file and not the old are the six new explanatory comment
lines documenting the fix itself.

**Verified by actually applying the file to a truly empty database, not just static analysis of
the SQL text — the single most direct way to prove the file's own central claim.** Docker was
available in this sandbox; pulled the real `supabase/postgres:15.1.0.147` image (the actual
Supabase Postgres distribution — ships `pg_cron`/`pg_net`/`supabase_vault`/a real `auth` schema
with `auth.uid()`/a real `storage` schema, not a bare vanilla `postgres` image that would fail
for unrelated reasons and prove nothing), dropped and recreated an empty `public` schema to
simulate a genuinely fresh project, and ran `psql -v ON_ERROR_STOP=1 -f full_schema_pull_
2026-08-09.sql` directly. **First real run surfaced the policy/trigger ordering bug itself**
(the fix above was written and verified through exactly this loop, not proven correct by
inspection alone). After the fix, hit two further failures, both confirmed to be the test
image's own outdated schema version, not a bug in this file: `auth.users` was missing a `phone`
column (referenced by one function) and `storage.buckets` was missing a `public` column
(referenced by the bucket-seeding inserts) — both real, long-standing columns in current
production Supabase, just absent from this older pinned GoTrue/Storage version. Patched both
onto the *test container only* with two plain `ALTER TABLE ADD COLUMN IF NOT EXISTS`
statements (not a change to the committed file), then re-ran the entire file from a freshly
recreated empty schema one more time for a clean, single, unbroken pass. **Result: exit code 0,
zero errors, every object landed** — 52 tables, 103 functions, 119 distinct policies, 36
triggers, 10 cron jobs, 5 storage buckets, matching the source file's own real counts exactly.
Container removed afterward, nothing persisted beyond the verification itself.

Both `supabase/full_schema_pull_2026-08-09.sql` and `supabase/migrations/
00000000000000_baseline.sql` were updated with this same final, verified content (kept
byte-for-byte in sync, confirmed via `diff`) plus a new header block documenting this exact
fix and verification method, so a future session re-reading the file's own comments gets the
same story this section tells. The 31 archived migrations under `supabase/migrations_archive/`
and their staged renames (already in progress before the restart) are unaffected — this pass
only touched the two baseline-copy files.

**Part 1 is now genuinely complete**, in the strong sense the original challenge asked for: a
fresh empty Supabase project really can be rebuilt from committed files alone, proven by actually
doing it, not asserted.

**Part 2 (flywheel trace audit): DONE — all 8 legs traced, real code reading only, no
simulator, per standing instruction.** Full leg-by-leg detail with file/line citations lives in
`FLYWHEEL_TRACE_PROGRESS.md` (kept as the incrementally-updated scratch record, per this file's
own restart-safety convention — survived one restart mid-trace already, picked back up cleanly
from that file plus `git log`). Summary here, distilled:

- **Leg 1** (discover a gathering): real bug found + fixed —
  `OnboardingRecommendationsScreen.js`'s recommendation cards all navigated to the generic
  `MainTabs` regardless of which gathering was tapped; now deep-links to the real
  `GatheringDetail`.
- **Legs 2-3** (join; invite a connection): re-verified, no gap — `join_gathering()`'s full
  check stack (capacity/invite_only/women_only/blocks) and the invite RPCs'
  friendship/blocks/push/persisted-row behavior all confirmed correct by reading the live
  function bodies directly.
- **Leg 4** (invitee responds → conversation surfaces): real, live-confirmed BROKEN case found
  + fixed — accepting a private-community invite flipped the invite's own status but
  `community_members`'s INSERT policy had no path for an invited-and-accepted friend, so the
  actual join failed with a raw RLS error. Added a third INSERT path for a real accepted
  `social_invites` row; verified live both directions, including that the newly-real member
  could actually post in `community_messages`.
- **Leg 5** (post-gathering → connection becomes a community): real gap found + fixed for the
  *linked*-community case — a gathering already scoped to a real community
  (`visibility='community'`) showed no sign of that community anywhere on
  `GatheringDetailScreen`, even though `community_id` was already being fetched. Added a real
  "🏘️ Part of a community" card linking to `CommunityDetail`, verified live (correctly shows for
  a public community, correctly shows nothing for a private one the viewer isn't a member of —
  matches RLS, not a bug). **A second, bigger sub-gap was found and deliberately left unbuilt**:
  there's no path anywhere to found a *new* community seeded from a one-off gathering's own
  attendee list — `createCommunity()` takes no seed-members param, nothing on the post-gathering
  feedback flow offers it. Real, trace-confirmed gap, but a genuinely new feature (UI, product
  judgment on who gets auto-added vs. invited, when to even offer it) rather than a wiring fix —
  flagged for an explicit future decision, not built from this trace's own guess.
- **Leg 6** (community creates its own gathering): re-verified, no gap —
  `CommunityDetailScreen`'s "Host a Gathering for This Community" button correctly carries
  `initialVisibility`/`initialCommunityId` into the existing Create wizard, already closed in
  an earlier pass.
- **Leg 7** (business/perk enters the loop): real gap found + fixed — a business's
  community-scoped standing perk (`brand_offers.unlock_community_id`, the Rewards group-unlock
  feature) was completely invisible to that community's own members; the only two ways to ever
  see it were already knowing to check that specific business's profile or stumbling on it in
  the general offers list. Added `getCommunityOffers()` + a real "🎁 Community Perks" section on
  `CommunityDetailScreen` (locked/unlocked copy, live member-count progress, working redeem
  button, same `OFFER_LOCKED`/`ALREADY_REDEEMED` handling `BrandOffersScreen` already has).
  Verified live end-to-end: a real offer locked at 3 members correctly rejected redemption at 2,
  correctly succeeded (with a real confirmation code) once a 3rd real member joined.
- **Leg 8** (user returns afterward): re-verified, no gap. Home's pull-back signals
  (`sinceAway`/`friendsActivity`/`weeklyRecap`/pending-invites banner/continue-your-communities)
  are all genuinely wired to real rendering, none orphaned. Confirmed **live against
  production** (not just read from a migration file) that `send-momentum-reward-nudges` and
  `send-gathering-reminders` are real, active, scheduled `cron.job` rows with real signal-based
  logic (not placeholders) and real, client-routable push payloads — this also closes a
  standing "not yet re-verified" item from the Aug 8 navigation-connectivity audit
  (`gathering_reminder` pushes' actual live delivery).

**Every schema-touching fix in this pass (legs 4, 7's redemption trigger check) was verified
live against production with real test data, cleaned up afterward** — same convention as every
other RLS/RPC change in this file. Client-only fixes (legs 1, 5's community card, 7's perks
section) were verified via a full `npx expo export --platform ios` after each (1849 modules by
the end of this pass) plus, where the change touched a query shape, a direct live check of that
exact query under real RLS via `set_config('request.jwt.claims', ...)`.

**Per the plan's own stated boundary** ("no new feature builds until the trace actually finds a
real gap to point at"): the trace found four real gaps and this pass closed three of them
(small, contained, wiring-shaped fixes — surfacing already-fetched data, adding a missing query
+ section reusing an already-established pattern). The fourth (leg 5's "found a brand-new
community from a gathering") is a genuinely new feature, not a wiring fix, and was deliberately
left for an explicit future decision rather than built from this trace's own momentum.

## Outstanding: "Start a Community from This Gathering" (Aug 9 2026) — DONE

The user explicitly asked to build the one gap the flywheel trace found and deliberately left
unbuilt (leg 5b above): no path exists to found a brand-new community seeded from a one-off
gathering's own real attendees. Written before implementation, same restart-safety convention as
every other plan-first section in this file — if a codespace restart hits mid-build, check
`git status`/`git log` for what actually landed vs. what's still just this plan.

**Real constraint that shapes the whole design**: `community_members`'s INSERT policy only ever
allows `user_id = auth.uid()` (self-insert) — confirmed by re-reading the policy pulled during
the flywheel trace (leg 4's writeup above) — so there is no way, even as the new community's own
creator, to directly add another real person as a member without their own consent. Auto-seeding
membership from the attendee list is therefore not just an ethical choice, it's not technically
possible without going around RLS — so this has to be invite-based, reusing the existing real
`social_invites` system (`sendInvite('community', ...)` → `send_social_invite` RPC), not a new
membership-insert path. `send_social_invite` also already enforces its own real friendship +
blocks checks (documented in the "Outstanding: Invite People" section further below) — inviting
a gathering attendee who isn't a real friend of the host isn't just undesirable, it will
genuinely be rejected by the RPC, so the host-side logic pre-filters to real friends only rather
than attempting (and silently swallowing) invites that would fail.

**Locked design, resolved directly rather than re-asked (matches this session's own "resolve
directly when the shape of the answer is clear" practice elsewhere in this file)**:
1. **Entry point**: a new "🏘️ Start a Community from This Gathering →" link in
   `GatheringDetailScreen.js`'s existing host banner (same link style already used for "🤝
   Invite friends →" and "🤝 Request a Business Partner →"), host-only, shown only when the
   gathering has no `community_id` already (no point spinning up a second community for a
   gathering already tied to one) and the gathering's `scheduled_at` is genuinely in the past
   (this is a "the connection was made, now formalize it" action — matches the trace leg's own
   name, "post-gathering"). **Not** placed on `GatheringHubScreen` — that screen's own
   post-gathering feedback flow is explicitly attendee-only (`!g.isHost` guard,
   `GatheringHubScreen.js:95`), so the host never actually sees `GatheringFeedbackModal` at all;
   `GatheringDetailScreen`'s host banner is the one surface a host reliably revisits regardless
   of before/after the event.
2. **Prefill, not a new form**: tapping it navigates to the existing `CreateCommunity` route
   with new params — `seedFromGatheringId: gatheringId`, plus the same `quickStartTitle`/
   `quickStartCategory` shape `CreateCommunityScreen.js` already reads from the Create
   Assistant, prefilled from the gathering's own title/`interest_tag`. No new screen.
3. **Seeding, after real creation succeeds**: new `seedCommunityFromGathering(communityId,
   gatheringId)` in `services/communities.js` — fetches the gathering's real approved
   `gathering_interest` rows (same "approved rows are publicly readable" RLS this schema already
   relies on elsewhere, e.g. `getFirstTimerAttendeeIds`), cross-references against the host's
   own real friends via the already-existing `filterToMyFriends()` helper
   (`services/friends.js:114`) — no new friendship-check logic invented — then calls the
   existing `sendInvite('community', communityId, friendId)` for each real friend
   (`Promise.allSettled`, so one failure — e.g. a race where a friendship was revoked between
   fetch and send — doesn't block the rest; the RPC's own `on conflict do nothing` already makes
   a duplicate send harmless). Returns `{ invitedCount, totalAttendeeCount }` — both real counts,
   nothing invented.
4. **Honest result copy, not a blanket "invited!" message**: `CreateCommunityScreen.js` shows a
   real summary before navigating to `CommunityDetail` — if some attendees weren't real friends
   yet, says so plainly ("N of M attendees invited — the rest aren't your friends yet; add them
   to invite them here too") rather than silently dropping them with no explanation. Matches this
   file's own standing "no invented numbers, no silent gaps" convention.
5. **Deliberately not done**: the just-finished gathering itself is **not** retroactively
   modified (no `community_id` backfill onto the past gathering, no visibility change) — this is
   a spinoff action, not a backfill, and retroactively changing a past gathering's own visibility
   scoping is out of scope and not something this feature needs to do its one real job. A
   non-friend attendee is never auto-added or invited around the friendship gate — no exception
   carved into `send_social_invite` for this flow specifically; it uses the exact same
   friends-only enforcement every other community invite already goes through.

**Built exactly as planned above, no design changes during implementation.** New
`seedCommunityFromGathering(communityId, gatheringId)` in `services/communities.js` — fetches
real approved `gathering_interest` rows for the gathering, cross-references against
`filterToMyFriends()` (`services/friends.js:114`, already existed, reused as-is), then
`Promise.allSettled`s `sendInvite('community', ...)` for each real friend. `CreateCommunityScreen.js`
reads a new `route.params.seedFromGatheringId` and calls it right after a successful
`createCommunity()`, showing one of three honest result messages (all invited / some invited,
add the rest as friends / none were friends yet) before navigating to `CommunityDetail` — no
message at all if the gathering had zero real attendees, matching this file's "no invented
numbers" convention. `GatheringDetailScreen.js`'s host banner gained the "🏘️ Start a Community
from This Gathering →" link (same style as the existing "🤝 Invite friends"/"🤝 Request a
Business Partner" links directly above it), gated on `!gathering.community_id && new
Date(gathering.scheduled_at) < new Date()` — host-only, and only for a gathering not already
tied to a community, only once it's actually happened.

**Verified live end-to-end against production (`enmosvippabmuqslzrox`), not just applied.**
Created a real past test gathering hosted by `Allen` with two real approved attendees: `Claude`
(a genuine pre-existing accepted friend of `Allen`) and `Allen Klein` (genuinely not a friend of
`Allen` — confirmed directly against the real `friendships` table before picking these two, only
one accepted friendship exists in production right now, `Claude`↔`Allen`). Created a real test
community as `Allen`, then ran the exact same friend-check query
`filterToMyFriends`/`seedCommunityFromGathering` performs (`gathering_interest` approved rows
joined against a live `friendships` accepted-status check, both scoped to `auth.uid()` via
`set_config('request.jwt.claims', ...)` as `Allen`'s real session) — correctly identified
`Claude` as a friend and `Allen Klein` as not. Called the real `send_social_invite` RPC for
`Claude` as `Allen` — succeeded, produced a real pending `social_invites` row. **Separately
confirmed the safety net behind the pre-filter actually holds**, not just the pre-filter itself:
attempted the identical `send_social_invite` call for the non-friend `Allen Klein` as `Allen` —
correctly rejected with the RPC's own real `'You can only invite friends'` error, confirming
that even if the client-side pre-filter had a bug, the invite could never actually reach a
non-friend. This exact outcome (`invitedCount: 1, totalAttendeeCount: 2`) matches the "Invited 1
of 2 attendees... add the rest as friends" branch of the result copy. Didn't re-verify the
invite-accept → real membership path itself here — that's the exact mechanism leg 4 of the
flywheel trace already proved live end-to-end (including that the resulting member can actually
post in `community_messages`), and this feature reuses it completely unchanged, nothing new to
re-prove there. All test rows (gathering, both `gathering_interest` rows, the community, its
membership row, the one `social_invites` row) deleted afterward; confirmed production back to
its exact pre-test state (0 test communities, 0 test gatherings, 0 invites).

Verified via a full `npx expo export --platform ios` — built clean, no resolution errors.

**Not done, same standing gap as everywhere else in this file**: no manual simulator/device
run-through. Next session should click through: tap "Start a Community from This Gathering" on a
real past hosted gathering, confirm the prefilled title/category, confirm the result alert's
three message branches render correctly for a gathering with all-friend / mixed / no-friend
attendees, and confirm the link is genuinely absent for an upcoming (not-yet-past) gathering and
for a gathering already tied to a community.

## Outstanding: Relationship hub consolidation + invite-only join hardening (Aug 9 2026) — DONE

Written before implementation, same restart-safety convention as every other plan-first
section in this file — a codespace restart mid-build should lose nothing, since this section
records the plan and the two builds below record real status once they land.

Context: after all 10 `PRODUCT_AUDIT` items closed (previous section), the user shared a
second AI's independent review of the same audit package and asked for a reaction + plan. That
review's alarm was mostly stale (everything in its P0 list was already fixed and verified live
against production the same day — see the section below for the receipts), but two of its
points survived scrutiny as real, currently-open gaps, confirmed by reading the actual code
rather than taking the review at its word:

1. **Invite-only gathering join has no server-side enforcement.** `join_gathering()`
   (`20260808_gathering_capacity_waitlist.sql`) never reads `gatherings.visibility` at all —
   for an `invite_only` gathering it silently falls through to the same branch as any other
   host-approval gathering (`is_public` is `false`, so it inserts a `pending` row). This was
   already known and explicitly flagged as accepted risk in the Create 2.0 section further
   below ("Not attempted: a server-side/RPC-level block on a determined caller directly hitting
   the join RPC... same risk posture this app already accepts elsewhere"), but re-reviewing it
   now: a stranger who was never invited can still land a real `pending` row in an invite-only
   host's approval queue by calling the RPC directly (UI gates the button, not the RPC) — if
   that host approves without checking, an uninvited stranger gets in. Worth actually closing,
   not just re-flagging a third time. **Checked the adjacent worry too and it's a non-issue**:
   `joinCommunity()` in `services/communities.js` is a raw client insert with zero gating in the
   JS itself, but `community_members`'s real INSERT policy (pulled from
   `full_schema_pull_2026-08-09.sql`) already requires `c.is_public = true OR c.creator_id =
   auth.uid()` server-side — private-community join is already correctly RLS-enforced, nothing
   to fix there.
   **Plan**: add an `invite_only` check to `join_gathering()` — if `gatherings.visibility =
   'invite_only'` and the caller isn't the host, require a real accepted `social_invites` row
   (`invite_type = 'gathering'`, `target_id = gathering_id_param`, `invitee_id = auth.uid()`,
   `status = 'accepted'`), else raise the same honest rejection message
   `GatheringDetailScreen.js`'s client-side gate already shows. Apply to production, verify live
   both ways (accepted invitee succeeds, uninvited stranger rejected), matching this file's
   established verify-live convention.
2. **The 11 relationship-longevity tools are reachable but not coherent.** Audit item 10
   already gave 6 of them (`RelationshipConstitution`/`StressTest`/`SharedDecisions`/
   `SharedPlaylist`/`TripPlanning`/`TimelinePlanner`) a real entry point —
   `RelationshipToolsScreen.js` (pick a match, then pick a tool), linked from Settings. But
   checked its `MATCH_TOOLS` list directly against `ChatScreen.js`'s own `showTogetherMenu()`
   (the original, still-working entry point) and found it's missing 2 of that menu's 8 items —
   `RelationshipLegacy` ("Leave Relationship Wisdom") and `MemoryVault` — so this new Settings
   path isn't yet at parity with the one that already existed. More broadly, the 5 personal
   tools (Rehearsal Room, Chemistry Diary, Goodbye Archive, Legacy Library, Emergency Kit) and
   the match-scoped `RelationshipToolsScreen` sit as 6+ separate flat rows under Settings'
   "Reflection Tools" heading, plus Memory Vault's own index is a separate row under Profile —
   functionally complete, but reads as a pile of destinations, not a suite. This matches the
   second AI's specific critique and it holds up on inspection.
   **Plan**: (a) fix the parity gap first — add `RelationshipLegacy` and `MemoryVault` to
   `RelationshipToolsScreen`'s `MATCH_TOOLS`, small and low-risk. (b) Build one consolidated
   hub screen grouping personal tools and the match-tools picker into real sections (not 6+
   flat Settings rows), and point Settings' "Reflection Tools" section at that one entry point
   instead. Keep every existing route/screen unchanged underneath — this is a navigation/
   organization layer on top of already-working screens, not a rebuild of any of them.

**Build status: both pieces done, applied, and verified live.**

- **Invite-only join hardening** (`20260809_join_gathering_invite_only_check.sql`): added the
  planned `invite_only` check to `join_gathering()` — a caller who isn't the host now needs a
  real accepted `social_invites` row (`invite_type='gathering'`, matching `target_id`/
  `invitee_id`, `status='accepted'`) or the call raises `'This gathering is invite-only. Ask
  the host for an invite.'` before it ever reaches the capacity/women-only/blocks checks below
  it. Applied to production (`enmosvippabmuqslzrox`) and verified live end-to-end, not just
  applied: confirmed the function still grants `authenticated` only (not `anon`); created a
  real test `invite_only` gathering hosted by a real profile (`Allen`); called `join_gathering`
  directly as a different real, genuinely-uninvited profile (`Claude`) via
  `set_config('request.jwt.claims', ...)` — correctly rejected; inserted a real accepted
  `social_invites` row for that same pair, retried the identical call — correctly succeeded
  (`{status: 'pending'}`, matching host-approval behavior for every other host-approval
  gathering). All test rows (`gathering_interest`, `social_invites`, the test gathering itself)
  deleted afterward, confirmed zero leftover. Checked the adjacent community-join concern in
  the same pass and confirmed it needs no fix — see the plan bullet above.
- **Relationship hub**: new `src/screens/RelationshipHubScreen.js` + `RelationshipHub` route
  (`RootNavigator.js`), two real sections — "With Someone" (the existing match-scoped
  `RelationshipToolsScreen` picker, Memory Vault index) and "On Your Own" (Rehearsal Room,
  Chemistry Diary, Private Reflections/Goodbye Archive, Relationship Wisdom/Legacy Library,
  Emergency Kit) — replacing the 6 flat rows previously spread across `SettingsScreen.js`'s
  "Reflection Tools" section and the separate "Emergency Kit" row above it. `SettingsScreen.js`
  now has one "❤️ Relationship" row in their place; every underlying screen/route is completely
  unchanged, this is a navigation/organization layer only. `RelationshipEmergencyKit` moved
  into the hub (it's relationship-specific content); `EmergencyContacts` stayed under Settings'
  "Safety" section where it already was (personal safety, not relationship-specific — used for
  date check-ins with anyone, not tied to a match). `ProfileScreen.js`'s own separate "💫 Memory
  Vault" row was left as-is — two entry points to the same index screen, same established
  multi-entry-point pattern used elsewhere in this file (e.g. gathering invites reachable from
  both Detail and the list tabs).
- **Parity fix**: `RelationshipToolsScreen.js`'s `MATCH_TOOLS` gained the 2 items it was
  missing relative to `ChatScreen.js`'s own `showTogetherMenu()` — `RelationshipLegacy` ("Leave
  Relationship Wisdom") and `MemoryVault` — both take the same `matchId`/`matchName` params
  every other entry already does, confirmed by reading both screens' `route.params`
  destructuring before adding them.
- Verified via a full `npx expo export --platform ios` — built clean, no resolution errors.
- **Deliberately not done, per direct instruction this pass**: no simulator/device run-through
  (explicitly skipped, not silently dropped — standing gap, same as everywhere else in this
  file). No new relationship-tool screens, no AI Concierge work, no Stripe/payment processor —
  matching the second AI's own "stop expanding" instinct, which this pass agreed with. Next
  session should click through: the invite-only join flow end-to-end in the real app (not just
  via direct RPC), and the new Relationship hub's two sections from Settings.

## Outstanding: PRODUCT_AUDIT fixes (Aug 9 2026) — DONE, all 10 items closed

**Status update, same day**: all 10 items below are now closed — 8 built/fixed, 2 (items 2 and
8) closed as deliberate, documented decisions rather than code changes (see their own bullets
and `AUDIT_FIXES_PROGRESS.md` for the full blow-by-blow, kept incrementally updated across this
session's several codespace restarts so nothing here depended on this conversation's memory).
The numbered list below is left as originally written (the audit's own framing) — read
`AUDIT_FIXES_PROGRESS.md` for what actually shipped for each, since several items (particularly
7) turned out to already be mostly built from before a restart and only needed finishing/
verifying, not built from scratch. **Item 7** (proof-of-redemption for business perks): a real
6-digit confirmation-code flow — claiming an offer returns a code shown to the user, the
business owner enters it on a new "Confirm a Redemption" card in `BusinessDashboardScreen.js`
to confirm the visit really happened, and only `confirmed_at is not null` redemptions count
toward billing now (both `generate_monthly_invoices`/`get_partner_billing_estimate`). Migration
and most client wiring were already live from before this session's restart; verified
end-to-end against production including the closed self-confirm exploit path (a direct insert
setting `confirmed_at`/`confirmed_by` is rejected by RLS). **Item 8** (payment processor):
deliberately deprioritized, not built — same standing rule as the "Outstanding: Billing /
Monetization" section further below (real money, real external account, needs the user
present for that decision, not something to set up autonomously).

A full read-only product/UX/architecture audit was built at `/workspaces/Nearby/PRODUCT_AUDIT/`
(13 files + `AUDIT_SUMMARY.json`, zipped copy at `PRODUCT_AUDIT.zip` in both the repo root and
inside that folder) for the user to hand to a *different* AI for independent critique. No
application code was touched to produce it. Full detail, citations, and file/line references for
every item below live in `PRODUCT_AUDIT/CRITICAL_MISSING_FEATURES.md` (ranked P0/P1/P2) and
`PRODUCT_AUDIT/AI_HANDOFF.md` — this section is the fix-it to-do list distilled from that audit,
written here specifically so a fresh session (post-restart) picks it up automatically the same
way every other section in this file works, rather than depending on this conversation's memory.

Before starting any of these: re-read the relevant `PRODUCT_AUDIT/` file first (the audit itself
may be stale by the time this is picked up if the app has changed in the meantime), and follow
this file's own standing rule of verifying a claim against the live code/production before
building on top of it rather than trusting the audit at face value.

**P0 — fix these first (actively broken or high-severity today):**

1. **`ChatScreen.js` ships a debug overlay to real users in production.** A condition meant to
   gate dev-only UI (`__DEV__ === undefined ? null : <debug overlay>`, roughly line 1078) is
   structurally always false — `__DEV__` is always a defined boolean, never `undefined` — so a
   red/yellow debug overlay printing internal message state renders on every message bubble for
   every real user, and a failed image load shows the literal string `"DEBUG: Image failed to
   actually render (onError fired)"` instead of a normal error (around line 1099). Fix: correct
   the condition to a real `__DEV__` check (or just delete the debug branch). Trivial, highest
   user-visible impact of anything found.
2. **Device-test the 13-button `Alert.alert()` in `ChatScreen.js`'s "Do Something Together"
   menu on real Android hardware before doing anything else with the relationship-longevity
   feature set.** React Native's `Alert.alert` is documented as unreliable beyond 3 buttons on
   Android. If it's genuinely broken there, 6 of 11 relationship-tool screens
   (`RelationshipConstitution`, `StressTest`, `SharedDecisions`, `SharedPlaylist`,
   `TripPlanning`, `TimelinePlanner`) plus the write-side of `RelationshipLegacy` and direct
   `MemoryVault` access may be functionally unreachable for a real chunk of users, not just
   hard to find. If confirmed broken, replace with a real menu component (action sheet /
   bottom sheet), not another native `Alert`.
3. **Stand up a real, version-controlled schema before building anything else on top of the
   current one.** Per `PRODUCT_AUDIT/DATABASE_AND_DATA_MODEL.md`, ~45 of ~53 real production
   tables have no `CREATE TABLE` anywhere in this git repo — only in the live database. At
   minimum, do a one-time full schema pull (Management API or `pg_dump`) and commit it, then
   hold the line going forward that every future schema change gets a real local migration file
   (this file's own past sessions have repeatedly applied schema changes live via the
   Management API without always leaving a local migration — that practice is what created this
   gap and should stop).
4. **Re-verify live, today, that the `is_blocked()` fix actually holds in production.** Per this
   file's own Aug 8 2026 "is_blocked" section, a blocked user could previously still see/message
   the person who blocked them; described there as fixed, but never independently re-tested by
   any session since. Re-run that same live test (real block row, real blocked-party session,
   confirm `matches`/`messages` correctly exclude the blocked pair) before trusting it further.
5. **Re-verify live, today, that the business-RPC ownership-check fixes actually hold.** Per
   this file's "Business RPC ownership check" section, `get_business_dashboard_stats` and
   siblings previously leaked another business's follower/redemption/named-attendee data to any
   authenticated caller who guessed a `partner_id`; described there as fixed, never
   independently re-tested since by a real non-owner account.
6. **Fix the silent-send-failure pattern, once, in a shared place, across all 4 chat-style
   screens** (`ChatScreen.js`, `CommunityChatScreen.js`, `GatheringChatScreen.js`,
   `BusinessConversationScreen.js`) — each currently clears the composer before the network call
   resolves and swallows a failure with no visible error, retry, or restored draft text. Don't
   fix this 4 separate times; factor the send-and-recover-on-failure logic into one place all
   four can share.

**P1 — important, do next:**

7. **Decide and build a real proof-of-redemption mechanism for business perks** before scaling
   the business-billing side any further — no such mechanism was found anywhere in the code, and
   the billing math (item 3 below, sort of — see `business_invoices`) depends on redemption
   counts being trustworthy.
8. **Either integrate a real payment processor for business billing, or explicitly deprioritize
   the feature.** `business_invoices` rows accumulate in `draft` status forever today — the
   contract-based billing math genuinely runs on a monthly cron job (per the "Billing /
   Monetization" section below), but nothing has ever actually charged a business. Don't build
   more billing sophistication on top of this until collection exists.
9. **Add outbound CTAs to `InsightsScreen.js`, `MomentumScreen.js`, and `RewardsScreen.js`, and
   build one real proactive "you're on a streak" / "you're close to a tier" push notification.**
   All three screens already compute real, honest signal (no fabricated numbers) with nothing
   downstream acting on it — this is the cheapest, highest-leverage fix in the whole list, since
   the hard part (the data) already exists.
10. **Give the relationship-longevity tools that survive item 2's device test a real entry point
    from `SettingsScreen.js`**, matching the pattern already used for their 5 siblings that are
    already listed there (Rehearsal Room, Chemistry Diary, Goodbye Archive, Legacy Library,
    Emergency Kit). The pattern exists in the same file; it just wasn't extended to all 11 tools.

**Lower priority, same list, not detailed here again**: business self-serve onboarding
(profile self-editing is admittedly unbuilt per `BusinessDashboardScreen.js`'s own UI copy), no
path to invite a non-app-user to a specific gathering (only a generic app referral exists),
`NoticesScreen.js` fully dead code, `MatchesScreen`'s dangling `RootNavigator.js` import,
hardcoded backend URLs/keys inline in `LoginScreen.js`/`ProfileScreen.js`/
`RehearsalRoomScreen.js`, `PlacesScreen.js`'s broken empty state (malformed `ListEmptyComponent`
prop). Full detail on every one of these is in `PRODUCT_AUDIT/CRITICAL_MISSING_FEATURES.md`
(items 11-20 there). **Two items originally on this list are now closed, both via the Aug 9 2026
flywheel trace audit above — not re-detailed here**: `OnboardingRecommendationsScreen.js`'s
recommendation cards not deep-linking (trace leg 1) and no nudge to join the community behind a
gathering just attended (trace leg 5's `GatheringDetailScreen` community card).

## Aug 8 2026 — Capacity / Waitlist (closes the one Create 2.0 item deliberately deferred)

The user asked to "continue" this after a codespace restart, believing it was mid-build.
**It wasn't** — `git status` was clean and `git log` showed no capacity/waitlist commits
anywhere; a grep across `src/` and `supabase/` turned up nothing but the one comment in
`CreateGatheringScreen.js` flagging it as deferred. Create 2.0's own plan (see that section
below) had explicitly excluded this from the core loop per the user's own words ("everything
else can come later") — so before writing anything, the four real design questions that plan
had left open were put back to the user rather than assumed: real waitlist queue vs. display-
only cap, auto-promote vs. host-approval on a spot opening, whether capacity applies to public-
only or both public and host-approval gatherings, and the bucket set for the picker. User chose:
real waitlist queue, auto-promote, both gathering types, and the original mockup's 2-4/5-10/10+/
No Limit buckets.

**A real prerequisite gap, found before writing schema**: there was no way for anyone to leave
a gathering anywhere in this app — confirmed by reading `services/gatherings.js` in full and
grepping for `decline`/`leave`/`cancel`/`remove_attendee`, all empty (this matches the existing
"Gathering Hub" section's own note: "No leave/cancel-request action was added — out of scope").
Without a leave path, "auto-promote when a spot opens" would have shipped as dead code — a spot
could never open. Building `leave_gathering()` was therefore not scope creep, it was the
mechanic's own precondition.

**The "10+" bucket doesn't have a single hard number**, but a real enforced cap needs one — this
wasn't resolved by re-asking (already a 4-question round), it was resolved directly: picking
"10+" reveals a plain +/− stepper (default 15, editable) rather than leaving the cap ambiguous.
"2-4"/"5-10" map to their bucket's upper bound (4/10). "No Limit" stores `null`, preserving every
pre-existing gathering's real behavior exactly (default for the field).

**Schema** (`20260808_gathering_capacity_waitlist.sql`, applied to production and verified
live end-to-end before committing): `gatherings.capacity` integer, nullable, `check (capacity
is null or capacity > 0)`. Three rewritten/new SECURITY DEFINER RPCs, all locking the
`gatherings` row `for update` first since capacity is a genuine scarcity resource — unlike this
app's privacy gates, which are deliberately "RLS wide open, client is the real gate" throughout
this schema, two people racing for the literal last spot is a real concurrency bug if unlocked:
- **`join_gathering(gathering_id)`** — replaces the old client-side branching
  (`express_interest_public` RPC for public gatherings + a direct client insert for
  host-approval ones) with one unified, capacity-aware function. Counts current `approved` rows
  under the lock; at/over capacity always waitlists regardless of public/host-approval ("no
  spot available" is the same fact either way); under capacity keeps today's exact behavior
  (public auto-approves, host-approval stays pending). Idempotent — a repeat call for an
  existing active request returns that request's real status instead of erroring.
- **`approve_gathering_interest(interest_id)`** — return type changed from a bare `uuid` to
  `jsonb` (`{status, match_id}`), since approving a pending request can now honestly result in
  `'waitlisted'` (the gathering filled up between the request and the host's review) as well as
  `'approved'` — the old bare-uuid return had no way to signal that, which would have shown the
  host a false "Approved!" for someone who was actually just waitlisted. Every call site
  (`GatheringsScreen.js`, `InboxScreen.js`) now checks `status` and shows the honest message.
- **`leave_gathering(gathering_id)`** — new. Deletes the caller's own row; if it was `'approved'`
  and `capacity` is set, promotes the earliest `'waitlisted'` row (`order by created_at asc`,
  locked) to `'approved'` and creates the match, same `least`/`greatest`/`on conflict` pattern
  every other match-creating RPC in this schema already uses. Deliberately rejects leaving a
  gathering whose `scheduled_at` is already in the past — you can't "un-attend" something that
  already happened, and this keeps Momentum/Insights/achievements' real attendance history
  honest rather than retroactively erasable.
- **`notify_gathering_approved()`** trigger extended (not a new manual push call in any of the
  three RPCs above) to cover the two new transitions this feature introduces: `waitlisted →
  approved` ("A spot opened up!") and `pending → waitlisted` ("Added to the waitlist" — the
  host tried to approve but the gathering had filled up first). It already fired on every
  `approved`-from-`pending` UPDATE and already respects `notify_matches`, so extending its
  `if` condition was simpler and more consistent than duplicating push-sending logic inside
  three different RPCs.
- **A real, closed security gap, found while designing `join_gathering`**: the existing
  `gathering_interest` INSERT RLS policy's `with_check` allowed a client to insert **any**
  status value, not just `'pending'`, whenever the target gathering was `is_public` — `(status
  = 'pending') OR (gathering.is_public)`. That was a harmless quirk before (the RPC was the only
  real path to `'approved'` anyway), but it becomes a genuine capacity-bypass exploit once
  `'approved'` is a scarce, capacity-gated status — a client could `insert ... status='approved'`
  directly and skip the waitlist entirely. Tightened the policy to require `status = 'pending'`
  unconditionally; the old `express_interest_public()` RPC (fully superseded by
  `join_gathering()`, confirmed nothing else in the schema called it via a live `prosrc` search
  before dropping) was dropped rather than left around as a second capacity-bypass vector.
  Verified live, both directions: a direct `insert ... status='approved'` for a public gathering
  now correctly gets rejected with a real RLS violation; a direct `insert ... status='pending'`
  for the caller's own id still succeeds unchanged (the one legitimate use RLS still needs to
  allow, even though the app itself now only ever calls `join_gathering()`).

**Verified live end-to-end against production** (`enmosvippabmuqslzrox`), not just applied —
same `set_config('request.jwt.claims', ...)`-as-real-profiles convention as every other RLS/RPC
change in this file, using the 4 real profiles (`Allen` as host, `Claude` and `Google voice` as
joiners): a public gathering with `capacity: 1` — first joiner auto-approved, second correctly
waitlisted; first joiner calling `leave_gathering` correctly auto-promoted the waitlisted second
joiner and created their match; a host-approval gathering with `capacity: 1` — both joiners
correctly landed `pending` (capacity doesn't block a request, only approval), host approving the
first succeeded, host approving the second correctly returned `{status: 'waitlisted'}` instead
of approving over capacity; `leave_gathering` on an already-past test gathering correctly
raised `'This gathering has already happened'`. All test gatherings deleted afterward
(`gathering_interest` rows cascade-deleted with them); final table counts (5 gatherings / 3
`gathering_interest` / 2 `matches`) matched the pre-test baseline exactly.

**A real mistake made and fixed during that verification, disclosed plainly rather than
glossed over**: the cleanup query for test `matches` rows was scoped by `source_gathering_id
in (my 3 test ids)`, which was correct in isolation — but `join_gathering`'s own `on conflict
(user_a, user_b) do update set source_gathering_id = ... where matches.source_gathering_id is
null` clause had, as a side effect of testing, retargeted two **pre-existing** production match
rows (`Claude`↔`Allen` and `Google voice`↔`Allen`, both real matches surviving from earlier
sessions' `is_blocked` testing, both with a null `source_gathering_id` before my test touched
them) to point at my test gathering's id — which then made them match my own "only delete test
rows" filter and get deleted along with the real test data. Caught immediately by re-checking
`matches` count (2 → 0, not the expected "2 fewer than after my test additions"). Both pairs
were recreated (`insert into matches (user_a, user_b, source_gathering_id) values (..., null)`)
to restore their most-likely pre-test state; `messages` was already empty for both pairs (these
match rows were themselves artifacts of earlier RPC-level test sessions, not real
conversations) so no chat history was destroyed, but **the two recreated rows have new UUIDs,
not their originals** — a real, disclosed limitation of the recovery, not a silent "fixed."
Final table counts matched baseline exactly after the fix. Lesson for next time: when a test
touches a table via an `on conflict do update` path, re-verify counts *before* running a
"delete anything matching my test ids" cleanup, since the update may have pulled pre-existing
rows into that filter's scope.

**Client changes**: `services/gatherings.js` — `capacity` added to `SAFE_GATHERING_FIELDS` and
`createGathering()`'s params; `expressInterest()`/`approveInterest()` rewritten for the new RPC
shapes (both now return `{status, matchId/match_id}` instead of the old ad hoc shapes); new
`leaveGathering()`. `getGatheringById()` now also returns `isFull` and `waitlistCount` (the
latter only accurate for the host or the caller's own row, since `gathering_interest`'s RLS only
surfaces other people's non-approved rows to the host — not shown to non-host viewers for that
reason). `CreateGatheringScreen.js` gained the capacity picker in its existing collapsed "More
options" section (optional, defaults to No Limit — doesn't disrupt the just-shipped 5-step
flow), plus a capacity line in the Publish preview. `GatheringDetailScreen.js` gained: a
"X/Y spots filled" / "🔒 Full" line, a `JOIN WAITLIST` button + label when full (was always
`JOIN GATHERING`/`REQUEST TO JOIN`), a waitlisted post-join panel with its own honest copy and a
"Leave Waitlist" action, a "Leave Gathering" action on the existing approved "You're in!" panel
(the first leave entry point anywhere in the app), and a host-only "Waitlisted" stat added to
the existing Going/Interested/Messages countdown row. `GatheringsScreen.js` and
`InboxScreen.js`'s approve/join handlers updated for the new return shapes, showing an honest
"gathering is full — added to the waitlist" message instead of a false "Approved!"/"You're In!".

**Also deleted `src/services/distance.js`**, found while auditing every `expressInterest`/
`approveInterest` call site: a fully dead, superseded module (its own `createGathering`/
`getNearbyGatherings`/`getMyGatherings`/`expressInterest`/`approveInterest`, none matching the
current schema — e.g. querying a flat `area` string equality instead of the real distance RPCs)
with a broken self-import (`import { distanceRangeLabel } from './distance'` inside
`distance.js` itself) and confirmed zero importers anywhere in the repo. Not otherwise related
to this pass; deleted as a safe, clearly-dead-code cleanup while already in this file.

**Deliberately not built, scope boundaries stated plainly**:
- Capacity/waitlist counts were **not** added to `GatheringsScreen.js`'s card-list layouts
  (nearby/attending/hosting tabs) — that screen's own `SAFE_GATHERING_FIELDS`-adjacent selects
  are separate, hand-written field lists (not the shared const), and wiring capacity display
  into all three card layouts is a distinct, separable UI pass. `GatheringDetailScreen.js` (the
  screen this whole redesign already treats as the real "can I get in" surface) has the full
  experience; the list cards do not.
- No "Leave Gathering" entry point was added to `GatheringHubScreen.js` — `GatheringDetailScreen`
  already covers it for every real path into a gathering (Hub is reached either through Detail
  or by re-navigating to Detail already being the natural place for this destructive action to
  live), so a second identical action inside Hub would be pure duplication, not a gap.
- `leave_gathering`'s promotion path only fires when the leaver's own status was `'approved'` —
  a waitlisted person leaving just removes them from the queue (correct; there's no spot to
  free), and a pending person leaving a host-approval gathering likewise doesn't trigger
  promotion (correct; they never held a spot).
- **Not done yet, same standing gap as everywhere else in this file**: no manual simulator/
  device run-through. Next session should click through: creating a gathering with each
  capacity bucket (including the 10+ stepper), joining a full public gathering as a second
  account (waitlist copy + button label), leaving an approved gathering as a third account and
  confirming a real push notification lands for whoever gets promoted, and a host approving a
  pending request into a full host-approval gathering (waitlisted-instead-of-approved copy).

## Aug 8 2026 — deep-link + route-param + mode-gating follow-up audit

Direct follow-up to the connectivity audit below, asked explicitly: "is everything deep linked
properly... does every feature connect the way it's supposed to between modes tabs features."
Two more passes, both found real issues:

**Deep linking — found and fixed a real gap in the just-shipped `nearby://gathering/:id` link
itself.** `GatheringDetail` (like every screen but `Onboarding`/`Login`/`CompleteProfile`) only
exists in `RootNavigator.js`'s `Stack.Navigator` once `session && profileComplete` are both
true (the conditional three-way screen-set swap at the top of the render). `NavigationContainer`'s
own `linking` config has nothing to resolve a tapped link to until that authenticated screen set
is actually mounted — so a shared gathering link tapped by someone **not yet signed in** (exactly
who `GatheringConfirmationScreen.js`'s "Share Gathering" and `GatheringHubScreen.js`'s "Share
Link" are aimed at — a friend being invited, not someone already using the app) silently did
nothing. Same class of dead-link bug this file already caught and fixed once for this exact
feature (adding the `linking` config in the first place), just one auth-state layer deeper, and
missed the first time because that pass's own verification (`getStateFromPath()` called directly
against the `linking.config` object) checked the URL-to-route-name mapping in isolation, never
whether that route is actually reachable in the live, auth-gated navigator tree.
Fixed in `RootNavigator.js`: captures the target `gatheringId` independently of
`NavigationContainer` (`Linking.getInitialURL()` + a foreground `'url'` event listener) into
`AsyncStorage`, then consumes and clears it once the authenticated stack actually mounts —
mirrors the existing `just_completed_signup` pending-navigation pattern already in the same
file. Confirmed via a full audit of every `Linking.openURL`/`Share.share` call site in `src/`
that this is the *only* internal `nearby://` deep link constructed anywhere (the referral-code
share in `InviteFriendsScreen.js` shares a plain redeemable code + App Store link, not an
internal route, so it doesn't need this treatment; every other `Linking.openURL` call is an
external URL — Google Maps, Spotify, YouTube, `sms:`, legal pages — none of which route through
this app's own navigator).

**Connectivity audit, round 2 — route-param contracts + mode gating.** Checked the highest-
traffic screens' `route.params` destructuring against every real call site (param name/shape
mismatches that wouldn't crash, just silently pass wrong or missing data) — **found none**; every
caller across `GatheringDetail`/`GatheringHub`/`CommunityDetail`/`Chat`/`ViewProfile`/
`BusinessProfile`/`MemoryVault`/`GatheringChat`/`CommunityChat`/`BusinessConversation`/
`RequestBusinessPartner`/`CreateGathering`/`CreateCommunity` passes exactly the keys each screen
reads. Then checked mode-gating consistency (premium/business/admin) across every entry point to
each:
- **Premium — a real, systemic client-trust gap, now closed.** `checkNoticeLimit`/
  `checkWaveLimit` (`noticeLimits.js`), `checkAndCountBrowseView` (`browseLimits.js`),
  `checkGatheringInterestLimit` (`gatheringLimits.js`), and `checkVoiceNoteLimit`
  (`voiceNoteLimits.js`) — all five of this app's free-tier daily-limit checks — bypassed their
  cap entirely on a client-supplied `isPremium`/`isUserPremium` boolean, sourced from local
  RevenueCat SDK/cache state (`isPremium()` in `purchases.js`) and never re-verified
  server-side. Pulled the live definition of `increment_browse_views` (the one of the five
  backed by an RPC rather than a plain client query) via the Management API to confirm it has no
  premium check of its own either — it blindly trusts the `daily_limit` param it's given. Net
  effect: a stale or spoofed local premium flag silently defeated all five caps with zero
  backstop, unlike this app's AI-generation Edge Functions (`ai-concierge`, `generate-icebreaker`,
  etc.), which already gate on a real server-side `profiles.is_premium` read. Fixed by adding
  `isPremiumOnServer(userId)` to `purchases.js` — one real query against `profiles.is_premium`
  (kept reliably in sync by the `revenuecat-webhook` function, see the "Consumer Billing" section
  below) — and pointing all five checks at it instead of their caller. Dropped the
  now-unnecessary `isPremium`/`isUserPremium` argument from each function and its call sites in
  `DiscoveryScreen.js`/`ChatScreen.js`/`GatheringsScreen.js`/`GatheringDetailScreen.js`; the two
  screens that also use a local `isPremium()` result for cosmetic UI (showing/hiding
  premium-only buttons) kept that unrelated client-side state untouched.
- **Business mode — confirmed genuinely gated, both visually and functionally, no action
  needed.** `CreateHubScreen.js`, `ProfileScreen.js`, and `SettingsScreen.js` all independently
  read the same `profiles.managed_partner_id` to decide whether to show a "Manage Your Business"
  entry point. Critically, `BusinessDashboardScreen.js` itself also resolves the caller's own
  managed partner via `getMyManagedPartner()` (scoped to the caller's own session) on every
  mount regardless of how it was reached — so even a direct `navigation.navigate(
  'BusinessDashboard')` bypassing every hidden button still correctly renders "No business found
  for this account" instead of leaking another business's data.
- **Admin — confirmed genuinely gated, no action needed.** `SettingsScreen.js` gates all three
  admin nav rows on a real, trigger-protected `profiles.is_admin` read. None of the three admin
  screens has an internal admin check of its own — they rely entirely on RLS — so the real
  question was whether that RLS is actually safe for a non-admin who navigates there directly.
  `AdminReportsScreen.js`'s case was already known-safe (`schema.sql` has a real "own reports
  only" policy alongside the admin one). `AdminBusinessRequestsScreen.js`
  (`business_partner_requests`) and `AdminVerificationScreen.js` (`id_verification_submissions`)
  don't have their policies captured in any local migration — pulled both live via the
  Management API rather than leaving it an open question: both have the identical safe shape,
  `requester_id = auth.uid()` / `user_id = auth.uid()` **OR** `is_admin`, so a non-admin
  navigating directly gets their own rows only (or none), never another user's data or the real
  admin queue.

Verified via a full `npx expo export --platform ios` after each fix (1845 modules throughout —
the deep-link and premium fixes were edits to existing files only).

## Aug 8 2026 — full navigation-connectivity audit + outstanding-item review

Asked directly: "what other outstanding items are there... does every feature connect the way
it's supposed to? from all tabs should connect to each other where needed." Given how much of
this file already reads "DONE, build-wise" with only "no manual simulator run" as the
remaining gap (a limitation this sandbox genuinely can't close), the actual useful work here
was twofold: (1) a systematic connectivity audit — not another per-feature spot check, an
actual diff of every registered route against every real `navigate()`/`replace()`/`push()`
call in the app — and (2) a pass through every "Outstanding"/"deferred"/"not attempted" item
elsewhere in this file to separate what's genuinely still buildable from what was a deliberate
product-scope decision not to be silently re-opened.

**Connectivity audit findings, all fixed this pass:**
- **`MusicModeScreen.js` was fully built (Spotify OAuth, top-tracks, favorite-track picker)
  and already had a real "🎵 Music Mode" button pointing at it from `SettingsScreen.js:717`
  (`navigation.navigate('MusicMode')`) — but the screen was never imported or registered in
  `RootNavigator.js`. Tapping that button threw a real "not handled by any navigator" crash.**
  Wired in (import + `Stack.Screen`), matching the existing registration pattern exactly. This
  is the same class of miss this file has caught repeatedly elsewhere (a real feature sitting
  finished but silently disconnected) — just never grepped for systematically until now.
- **`routeNotificationTap()` in `services/notifications.js` couldn't actually route
  `wave`/`gathering_interest`/`gathering_invite`/`gathering_reminder` push taps anywhere
  correct.** It called `navigationRef.navigate('MainTabs', { screen: 'Notices' | 'Gatherings'
  })` — nested-route syntax that only works if `Notices`/`Gatherings` are children of the
  `MainTabs` tab navigator. They're not — `MainTabs`' `Tab.Navigator` only holds
  `Home`/`Discover`/`Create`/`Matches`/`Profile` (`RootNavigator.js:219-223`); `Notices` and
  `Gatherings` are sibling top-level `Stack.Screen`s. The two correctly-written calls two lines
  away in the same function (`navigationRef.navigate('Chat', ...)`, `navigationRef.navigate(
  'Friends')`) target top-level screens directly, which is what gave this away. Fixed to
  navigate to the top-level screen name directly; gathering pushes now also deep-link straight
  to the specific `GatheringDetail` when the push payload has a `gathering_id` (matching how
  the match/message case already deep-links to a specific `Chat` instead of a generic list) —
  confirmed `gathering_invite`'s payload does carry `gathering_id`
  (`20260808_gathering_invite_persists.sql`) so this isn't a fabricated field. Whether
  `gathering_interest`/`gathering_reminder` pushes are actually sent from anywhere live
  (production Edge Functions/cron, not visible in local migrations) wasn't re-verified — same
  "local stub, real deployed code" gap this file has flagged before — but the routing logic is
  correct either way now, falling back to the plain `Gatherings` list when no id is present.
- **`BusinessDashboardScreen.js` took zero navigation props and had zero `navigate()` calls
  anywhere in its ~990 lines** — a business owner managing their own dashboard had no way back
  to their own public `BusinessProfileScreen` (built earlier this session) or anywhere else.
  Added the `navigation` prop and a "👀 View Public Profile →" link under the Community Health
  stats.
- **`ProfileScreen.js`'s quick-links column** (Timeline / Memory Vault / Insights / Momentum /
  Rewards, all the identical `timelineLink` row style) **omitted Billing and Emergency
  Contacts**, both of which follow the exact same pattern but were only reachable two taps deep
  via Settings. Added both rows for consistency — nothing about Settings' own rows changed.
- Confirmed clean elsewhere: all 5 bottom tabs wired correctly; no genuinely orphaned content
  screens (registered but unreachable from anywhere real); `GatheringDetailScreen` ↔
  `ViewProfile`/`BusinessProfile`, `CommunityDetailScreen` ↔ `BusinessProfile`/
  `RequestBusinessPartner`, and `InboxScreen`'s invite-accept deep-links into
  `GatheringDetail`/`CommunityDetail` all check out; every optional-`navigation`-prop component
  (`BusinessHostBadge`, `DateCheckInModal`, `GatheringFeedbackModal`) has its prop actually
  passed at every real call site, so none of those features are silently disabled in practice.

**Resolved the one item flagged since the Aug 8 vision-doc pass as never re-verified**
("Create should become one screen across all communities" — the OCR-garbled email claim that
was never checkable against a concrete assertion): investigated what a real gap in this shape
would look like, and found one — `CreateGatheringScreen.js` had no way to receive an initial
`visibility`/`communityId` from a caller, and `CommunityDetailScreen.js` had no "create a
gathering for this community" entry point at all, so starting a gathering from inside a
specific community meant re-picking that same community from scratch on the wizard's own Who
step instead of carrying the context you were already in. Fixed: `CreateGatheringScreen.js`
now reads `initialVisibility`/`initialCommunityId` route params (pre-selecting the community
and pre-loading `myCommunities` so the Publish-step summary renders its real name immediately,
not just its id), and `CommunityDetailScreen.js` gained a "🎉 Host a Gathering for This
Community" button (members/creator) that passes them. This is the same one Create flow every
other entry point already uses — no new screen, no forked logic.

**Reviewed every other "Outstanding"/deferred item in this file to check what's genuinely still
open vs. a deliberate scope decision** (so this pass doesn't silently reopen something the user
already explicitly chose to defer, per this file's own standing "flag, don't silently build
partial" rule):
- **Stripe integration** (billing section) — still not started, and deliberately not attempted
  this pass. This needs a real external account, real API credentials, and real money moving —
  not something to set up autonomously without the user present for that decision.
- **Capacity/waitlist mechanics** (Create 2.0) — still deliberately deferred; needs new schema
  and a real state machine beyond pending/approved/declined, explicitly excluded from the
  "core loop" scope when Create 2.0 was designed.
- **AI-generated personalized cover photos** — still explicitly deferred to a future premium
  feature per the user's own words ("later, once the product has traction").
- **Business AI Assistant** (chat-style analytics for business owners) — still a distinct,
  not-yet-started future feature per the 3-tier discussion, not folded into this pass.
- **True "I'll Decide Later" skip-location state** (Create 2.0's Where step) — still not
  built; making location genuinely optional touches `createGathering()`'s own distance
  computation, `get_gathering_distances`, the map layer, and `get_gathering_meetup_point` — a
  real structural change, not a per-screen tweak, left flagged rather than half-built.
  "Near Me" already covers the same underlying want.
- **Server-side/RPC-level enforcement that a non-invited stranger can't join an `invite_only`
  gathering by calling the join RPC directly** — checked this again directly this pass
  (`expressInterest()` in `services/gatherings.js`): for `invite_only` gatherings `is_public`
  is `false`, so a direct call still only ever inserts a `pending` `gathering_interest` row
  requiring the host's own manual approval — the same outcome as any other host-approval
  gathering, not an actual auto-join bypass. This matches the app's already-stated, already-
  accepted risk posture elsewhere ("RLS wide open, UI is the actual gate") rather than being a
  fresh hole, so it was left as-is rather than hardened uninvited.
- **Payment Methods / Billing History as a real data list** — still deliberately not built;
  this app bills through native in-app-purchase, so Apple/Google hold the actual charge
  history, not this app.
- No other section in this file described a concrete, still-open, code-completable gap that
  didn't fall into one of the above categories or the standing "no manual simulator run-through
  is possible in this sandboxed environment" limitation repeated throughout.

**Not done, same standing gap as literally everywhere else in this file**: no manual
simulator/device run-through. What was verified this pass: a full `npx expo export --platform
ios` after each increment (1844 → 1845 modules — the one new module is `MusicModeScreen.js`,
now actually reachable from the bundle graph for the first time since it was written; every
other file touched was an edit, not an addition). The navigation-graph findings above were
found by a direct, exhaustive diff of registered routes vs. real `navigate()` call sites, not
by spot-checking — next session should still click through the four fixed paths in a running
app (Settings → Music Mode, tapping a real gathering-invite push notification, Business
Dashboard → View Public Profile, and Profile's new Billing/Emergency Contacts rows) to confirm
they render correctly, not just that they resolve to a valid route.

## Outstanding: Frictionless Gathering Creation Redesign ("Create 2.0") — DONE, build-wise

Started Aug 8 2026, immediately after the Create Consolidation pass (3-card `CreateHubScreen`
+ `create-assistant` NL box, commit `6bd736a2`) shipped. The user pasted a detailed, fully
worked-out redesign vision for the whole gathering-creation flow — this supersedes and
partially replaces that just-shipped pass, not layers on top of it. **Read this whole section
before assuming anything is built** — written before implementation, same restart-safety
convention as every other plan-first section in this file.

**Locked decisions, given directly by the user, not to be re-litigated:**
1. AI never infers/assigns a specific date or time from free text. AI may suggest
   title/category/location/description; the user always explicitly picks date/time through
   deterministic UI (preset buttons + a picker), never a parsed guess.
2. Cover photos: curated/static imagery per category, **not** AI-generated. No new image-gen
   API, no per-gathering cost. Keep the existing icon/color fallback wherever a category has no
   curated image. AI-generated personalized covers explicitly deferred to a future premium
   feature, not attempted now.
3. No proximity/interest-based stranger surfacing, anywhere. This preserves the existing
   standing rule (Discover's unified search already excludes People for this exact reason —
   see the Discover mini-app section below). The post-create growth prompt is **"Invite
   Connections"**, limited to people the organizer already has an established connection with
   (accepted friends), optionally enriched with real shared-context ("you both belong to
   Downtown Runners," "you attended Coffee Club together") — never nearby strangers, even ones
   the recommendation engine would score as a good match.
4. Full scope, one pass — not just the core loop. But scope itself must not creep: capacity/
   waitlist/"reserve more tables" mechanics are explicitly deferred (see below), and several
   literal mockup details were deliberately adjusted for schema-honesty reasons (also below) —
   flagged rather than silently faked.

**What "Create" becomes, architecturally:**

- **`CreateHubScreen.js` rebuilt again** — this time to the real primary surface: "What would
  you like to do today?" plus a large-button icon grid (Coffee / Dinner / Walk / Sports /
  Movie / Game Night / Music / Volunteer / Something Else), inline on the screen, not behind a
  modal tap. The just-shipped persistent "Tell us what you're thinking" NL row is **removed** —
  free text now lives specifically behind the "Something Else" tile (matches the vision's own
  reasoning: a grid of things people actually say, plus one honest catch-all, not a grid *and*
  a redundant always-visible text box). Create a Community / Partner with a Business / Manage
  Your Business move to a small, de-emphasized secondary row below the grid — still real,
  still needed features, just not what this screen is *about* anymore.
- **`StartSomethingModal.js`'s `CREATE_HUB_OPTIONS`/`SUB_OPTIONS` constants are reused as the
  data source** for this grid (single source of truth for the option list), but rendered
  inline on `CreateHubScreen` with its own JSX — not by opening the modal. `StartSomethingModal`
  itself is untouched and keeps its existing modal behavior for `HomeScreen.js`'s time-adaptive
  quick actions, which this redesign doesn't touch.
- **"Something Else" behavior**: tapping it reveals an inline "What do you have in mind?" text
  box on `CreateHubScreen` (no navigation away) and calls the existing `create-assistant`
  function (`classifyCreateRequest`, built last pass). Routes by returned `intent` exactly like
  the just-removed NL box did — `gathering` → into the new flow below with title/category
  prefilled but shown for confirmation (not skipped, since an AI guess deserves a look before
  publish, unlike a literal icon tap); `community` → `CreateCommunity` prefilled; `business_partner`
  → `RequestBusinessPartner` prefilled; `unclear` → still proceeds into the gathering flow with
  the typed text as a literal title and no category, rather than a dead-end error, since the
  user already told us it's *something* by tapping this tile.
- **`CreateGatheringScreen.js` rebuilt in place** (same route, same `createGathering()` call,
  every existing caller — `StartSomethingModal`, the old NL flow, now `CreateHubScreen`'s grid
  — keeps working unmodified) into the conversational one-decision-per-screen flow:
  1. **What** — skipped entirely when reached via a literal icon-grid tap (`fromQuickPick: true`
     route param; title/category already known). Shown, prefilled-but-editable, when reached via
     "Something Else"/AI or with no preset at all (e.g. deep-linked in some other way).
  2. **Who should discover this?** — 🌍 Everyone / 👥 Friends / 🏘 Community / 🔒 Invite Only.
     This is genuinely new (see schema below), not a reword of the existing Public/Private
     toggle — audience/discovery-scope and auto-join/approval are two different axes that were
     previously conflated into one `is_public` boolean.
  3. **When** — Now / Tonight / Tomorrow / Pick a Date, each either sets a sensible default time
     immediately or opens the existing native date/time picker. Fully deterministic per decision
     #1 above — no AI involvement at all in this step.
  4. **Where** — 📍 Near Me (current location, today's default behavior) / 🔍 Choose a Place
     (new — "Popular Nearby" real venue suggestions, see below). **The mockup's third option,
     "I'll Decide Later," is deliberately not built as a true skip-location state** — `gatherings.
     precise_lat/lng` being nullable in the schema doesn't mean the rest of the app tolerates a
     null-coordinate gathering (`createGathering()`'s own `localArea()`/`wideArea()` computation,
     `get_gathering_distances`, the map layer, `get_gathering_meetup_point` all assume real
     coordinates) — making location genuinely optional is a real structural change touching many
     call sites, not a per-screen tweak, so it's flagged here rather than faked with a state nothing
     downstream actually handles. "Near Me" already ​covers the same underlying want (don't make me
     think about location right now).
  5. **Anything people should know?** (optional, existing `description` field — zero new schema,
     kept as one skippable step since "ask only what's necessary" doesn't mean "delete a field
     that already existed and costs nothing to leave optional").
     A collapsed **"More options"** section on this same step holds the fields the new flow
     doesn't surface by default — recurrence, map visibility (private-only), women-only — so
     nothing the old wizard could do is actually lost, it's just no longer a forced decision.
  6. **Publish** — real preview card (unchanged concept from the just-replaced wizard's step 4,
     kept), button reads **"Start Gathering"** instead of the old `t('gatherings.postButton')`
     copy (check what that translation key currently says and update it, not just override
     English inline — this app has a language-switching layer, `LanguageContext`).
- **`visibility` — new column, new filtering funnel (the one genuinely new piece of schema
  this whole redesign needs)**: `gatherings.visibility` text, `check (visibility in ('everyone',
  'friends', 'community', 'invite_only'))`, `default 'everyone'` (every existing row backfills
  to `'everyone'`, matching today's actual behavior exactly — zero behavior change for anything
  already posted). `is_public` is untouched and keeps its existing meaning (auto-join vs.
  host-approval) — the new flow always sets `is_public: true` for `everyone`/`friends`/
  `community` (frictionless, matches the whole point of this redesign) and `is_public: false`
  for `invite_only` (host-approval as a belt-and-suspenders fallback — see enforcement below).
  `community_id` is set when `visibility = 'community'`, from a picker scoped to communities the
  caller is a member of (via already-existing `getMyCommunities()` — empty state if they belong
  to none, same graceful-empty convention as `RequestBusinessPartnerScreen`).
  **Enforcement, matching this app's established privacy convention exactly** (confirmed live:
  `gatherings`' RLS is `"Anyone can view gatherings" using (true)` — this app has *never*
  enforced gathering privacy via RLS, only via which query results a screen actually surfaces,
  e.g. today's "private" gatherings are still fully SELECTable by anyone, they just don't
  auto-join). Consistent with that: `getNearbyGatherings()` (the single funnel behind
  `GatheringsScreen`, `DiscoverHubScreen`'s search, and the map — confirmed all three already
  route through this one function) gets a new filter pass — `friends` visibility included only
  if the viewer is an accepted friend of `host_id` (`getMyFriends()`, already fetched
  elsewhere), `community` included only if the viewer is a member of `community_id`
  (`getMyCommunities()`), `invite_only` always excluded from this list entirely. Direct fetch by
  known id (`getGatheringById`, what `GatheringDetailScreen` actually uses) is **not**
  visibility-filtered — a shared link or an accepted invite always works for the person holding
  it, matching how "private" gatherings already work today. For `invite_only` specifically,
  `GatheringDetailScreen`'s Join CTA is additionally gated client-side on the viewer having a
  real accepted `social_invites` row for that gathering (or being the host) — real UI
  enforcement reusing data that already exists, no new RPC. **Not attempted**: a
  server-side/RPC-level block on a determined caller directly hitting the join RPC with a raw
  gathering id they weren't invited to — same risk posture this app already accepts elsewhere
  (RLS wide open, UI is the actual gate), flagged rather than silently assumed airtight.
- **"Popular Nearby" venue suggestions** (Where step, "Choose a Place"): reuses
  `services/places.js`'s existing `searchNearbyPlaces(lat, lng, category, keyword)` — real
  Google Places data, not invented. Walk-time ("7 minutes") is a plain client-side approximation
  from straight-line distance at an assumed walking pace — same "equirectangular, not full
  haversine, plenty accurate at this scale" convention the Unified Map section already
  established, **not** a new call to Google's paid Distance Matrix API. Tapping a suggestion
  sets the gathering's location to that real place; the place name is shown in the Where
  confirmation line, title is left as whatever the user typed (not silently rewritten).
- **Curated cover photos**: category → image mapping, used as the hero on `GatheringDetailScreen`
  and gathering cards whenever a host hasn't uploaded a real `cover_photo_path`. **Real, verified
  image URLs only** — this pass will use `WebFetch` to confirm each candidate URL actually
  resolves to an image before it's hardcoded into the app, the same "verify, don't assume"
  posture used everywhere else in this file (e.g. checking `verify_jwt` live instead of trusting
  the CLI default). Falls back to the existing icon/color block for any category without a
  verified image — never a broken image URL. If verified real images can't be sourced this pass,
  this piece is explicitly deferred (flagged, not fabricated) rather than shipping a guessed
  Unsplash photo ID that might 404.
- **Confirmation screen**: replaces the current plain `Alert.alert('Posted!', ...)` on submit.
  "🎉 Your gathering is live! Now let's help people discover it." with two real actions —
  **Share Gathering** (native share sheet with a real deep link, `nearby://gathering/{id}` —
  this needs an actual `linking` config added to `NavigationContainer` in `RootNavigator.js`,
  which doesn't exist at all today; without it a "shareable link" would silently do nothing when
  tapped, which is exactly the class of dead-feature bug this file has caught and fixed
  repeatedly elsewhere, e.g. the dead `gathering_invite` push case. Scoped to just the
  `GatheringDetail` path this pass, not a general deep-linking overhaul) and **Invite
  Connections** (friends-only picker per locked decision #3, reusing `getMyFriends()` +
  `sendInvite('gathering', ...)` from the existing `services/invites.js` social-invite system —
  no new invite mechanism. Enriched where honestly possible with real shared-context lines via
  a new small query: shared `community_members` rows or a shared *past* `gathering_interest`
  history between the organizer and each friend — real signals, not fabricated).
- **Organizer countdown card**: a compact "People Going / Interested / Messages" card, real
  counts from data `GatheringDetailScreen` already fetches (`approvedAttendees.length`, pending
  count, and a new simple `gathering_messages` count-only query) — added to the host banner on
  `GatheringDetailScreen`, not a separate new screen (this app doesn't have a per-gathering
  analytics surface anywhere else either, and one gathering's countdown card doesn't need one).
- **Post-join growth prompt**: "Want to bring someone?" shown once, right after a *public*
  (auto-join) gathering join succeeds, before landing on the normal post-join panel — Invite a
  Friend (opens the existing `InviteFriendsModal`, already gathering-aware) / Share Link (native
  share, same deep link as above) / Skip. Not shown for host-approval joins (nothing to
  celebrate yet, still pending) or invite-only (already came in via a direct invite).

**Deliberately deferred, flagged rather than silently built partial:**
- ~~Capacity ("How many people?" 2–4/5–10/10+/No Limit) and a real waitlist~~ — **built later,
  see the "Aug 8 2026 — Capacity / Waitlist" section at the top of this file** for the full
  design discussion (real waitlist queue, auto-promote, applies to both public and
  host-approval gatherings) and what shipped. Attendance-approaching-capacity suggestions
  ("reserve more tables") specifically were **not** part of that build and remain deferred —
  no "you're almost full" nudge exists.
- AI-generated personalized cover photos — explicit "later, once the product has traction"
  per the user's own words.
- True proximity/interest-based stranger invite suggestions — explicitly rejected (locked
  decision #3), not a "maybe later," a standing rule reaffirmed.
- Server-side/RPC-level enforcement that a non-invited stranger truly cannot join an
  invite-only gathering by calling the join RPC directly with a known id — client-side gated
  only this pass, matching this app's existing privacy-enforcement posture elsewhere but worth
  hardening later.

**Build status (this pass, after a codespace restart interrupted the session right after the
schema migration landed — picked back up from `git log`/`git status`, working tree was clean,
nothing lost)**:

- **Done**: `gatherings.visibility` migration (applied to production, confirmed via direct
  query in a prior pass). `CreateHubScreen.js` rebuilt to the real icon-grid primary surface —
  `CREATE_HUB_OPTIONS` rendered inline with this screen's own JSX (not via
  `StartSomethingModal`), including inline sub-option handling for `SUB_OPTIONS` entries (e.g.
  Dinner → Pizza/Mexican/etc.) so nothing from the old modal-driven grid was silently dropped;
  "Something Else" reveals an inline text box calling `classifyCreateRequest` with the
  `gathering`/`community`/`business_partner`/`unclear` routing exactly as spec'd (unclear →
  proceeds into the gathering flow with the typed text as a literal title); Community/Business
  moved to a de-emphasized secondary text-link row below the grid. `CreateGatheringScreen.js`
  rebuilt in place to the real one-decision-per-screen flow (What[skippable via
  `fromQuickPick`] → Who → When → Where → Details[+collapsed More options] → Publish), same
  route/`createGathering()` call every existing caller already uses. `createGathering()` and
  `SAFE_GATHERING_FIELDS` in `services/gatherings.js` now carry `visibility`/`community_id`.
  `getNearbyGatherings()` now filters by `visibility` (friends via `getMyFriends()`, community
  via `getMyCommunities()`, `invite_only` always excluded) — **live-verified against production
  with real friend/community pairs, see below (two unrelated critical bugs found and fixed in
  the process).** New
  `GatheringConfirmationScreen.js` + route replaces the old `Alert.alert('Posted!', ...)` —
  Share Gathering (real `Share.share` with the `nearby://gathering/{id}` deep link) and Invite
  Connections (friends-only, enriched with real shared-context via new
  `getFriendsWithSharedContext()` in `gatherings.js` — shared community or shared past
  gathering, sent via the existing `sendInvite('gathering', ...)` from `services/invites.js`,
  distinct from `InviteFriendsModal`'s older `invite_friend_to_gathering` push-based path used
  elsewhere). Real `linking` config added to `NavigationContainer` in `RootNavigator.js`
  (`nearby://` prefix, already the configured `app.json` scheme; `GatheringDetail:
  'gathering/:gatheringId'` — scoped to just this one path, not a general deep-linking
  overhaul). `postButton` translation key updated to "Start Gathering" (and its equivalent) in
  all 11 languages, not just English inline. Verified via a full `npx expo export --platform
  ios` (1843 modules, one more than the 1842 baseline — the one new
  `GatheringConfirmationScreen.js`).
- **Second increment, same day (picked back up after another codespace restart interrupted the
  session mid-verification — see the two-bugs writeup above for what that verification pass
  found first).** Closed all four remaining pieces. Still true from the prior increment and not
  re-tested this pass: the community picker (Who step) and Popular Nearby places (Where step)
  are built and wired but not yet exercised against a real account with real communities/a real
  location — same standing "no manual simulator run-through" gap as everything else in this
  file, see the very bottom of this section.
  - **`GatheringDetailScreen.js` Join CTA gating for `invite_only`**: `getGatheringById()` in
    `services/gatherings.js` now also computes `hasInviteOnlyAccess` — `true` for the host,
    otherwise a direct check for a real accepted `social_invites` row (`invite_type='gathering'`,
    matching `target_id`/`invitee_id`, `status='accepted'`) — RLS already lets the invitee
    SELECT their own invite rows directly, no new RPC needed. The detail screen's join-CTA area
    now shows an honest "🔒 This gathering is invite-only. Ask {host} for an invite." panel
    instead of a Join/Request button when this is `false`, matching the plan's "client-side
    gated only this pass" enforcement posture exactly.
  - **Organizer countdown card**: a compact "Going / Interested / Messages" row added to
    `GatheringDetailScreen.js`'s host banner, using the three count-only functions
    (`getApprovedAttendeeCount`, `getPendingInterestCount`, `getGatheringMessageCount`) that were
    already written in `services/gatherings.js` from the prior increment but never actually
    called from a screen — fetched alongside the rest of `load()`, host-only.
  - **Post-join "Want to bring someone?" growth prompt**: added to `GatheringHubScreen.js`
    (not `GatheringDetailScreen` — `justJoined` is only ever passed to Hub, and only after a
    real `is_public` auto-join succeeds, so it's already naturally excluded for host-approval
    and `invite_only` joins with no extra gating needed). Shown once, right after the existing
    2.2s "You're In! 🎉" banner closes: Invite a Friend (reuses `InviteFriendsModal`, already
    gathering-aware) / Share Link (same `nearby://gathering/{id}` deep link as the confirmation
    screen) / Skip.
  - **Curated cover photos**: new `src/constants/gatheringCoverPhotos.js`, a `category → real
    image URL` map. Every URL was checked with a real HTTP request (200 status + `image/*`
    content-type via `curl -I`, a more direct verification than routing through WebFetch's
    HTML-to-markdown pipeline for what's actually binary image content) **and** downloaded and
    visually inspected before being hardcoded — this caught several real mismatches that would
    otherwise have shipped silently wrong: two "Dancing" candidates turned out to be a
    mountain-silhouette yoga pose and a neon sign reading "you are what you listen to" (dropped
    for a third, confirmed real dance photo); an initial "Cats" candidate (a cat in sunglasses)
    was swapped for a more neutral shot. Initially sourced 15 of the 25 `interest_tag`
    categories (the 7 reachable from the primary Create 2.0 icon grid — Coffee/Foodie/Outdoors/
    Sports/Gaming/Music/Volunteering — plus 8 more common ones: Movies/Hiking/Yoga/Wine/Dancing/
    Fitness/Travel/Reading); a follow-up pass the same day sourced 9 more (Art, Photography,
    Cooking, Dogs, Cats, Concerts, Museums, Meditation, Running) — **24 of 25 categories now
    covered.** The one still deliberately unsourced is **Faith & Spirituality**: tried 9
    candidates (a church interior, an open Bible, a "JESUS" worship-concert sign, a mislabeled
    yoga-pose silhouette photo, a forest road, others) and every one either didn't match or was
    specific to one religion — forcing a single-denomination photo onto a category meant to span
    all faiths would be a worse outcome than no photo at all, so this one category is left to
    fall back to the existing icon/color block on purpose, not from running out of effort.
    Wired as a fallback (real uploaded `cover_photo_path` still wins when present) into both
    `GatheringDetailScreen.js`'s hero and all three of `GatheringsScreen.js`'s card layouts
    (nearby/attending/hosting tabs).
  - Also verified the `nearby://gathering/:gatheringId` `linking` config
    (`RootNavigator.js`) more rigorously than a simulator run-through could have this pass:
    called React Navigation's own `getStateFromPath()` directly (`@react-navigation/core`,
    the actual library code the app runs, not a guess) against the real `linking.config` object
    with both a plain id and a real UUID-shaped id — both correctly resolved to
    `{ name: 'GatheringDetail', params: { gatheringId: '<id>' } }`, confirming the path-parsing
    logic itself is correct independent of not having a simulator to tap the link in.
  - Verified via a full `npx expo export --platform ios` (1844 modules, one more than the 1843
    baseline — the one new `gatheringCoverPhotos.js`, everything else this increment was edits
    to existing files).

**Verification plan**: apply the `visibility` migration to production
(`enmosvippabmuqslzrox`) and confirm the backfill via a direct query (every existing row reads
`'everyone'`) — **done, confirmed in a prior pass**; verify the new `getNearbyGatherings()`
filter live with real friend/community pairs the same way this session has verified every
other RLS-adjacent change (`set_config('request.jwt.claims', ...)` as real profiles —
friend-visible gathering shows for a friend and not for a stranger, same for community) — **done
this pass, see the two-bugs writeup immediately below**; confirm the new `linking` config actually routes a
`nearby://gathering/<id>` URL to `GatheringDetail` — **done this pass**, via React Navigation's
own `getStateFromPath()` called directly against the real `linking.config` (see the second-
increment bullets above) rather than the originally-planned `Linking.openURL`/`npx uri-scheme`
dev-shell proxy, since there's still no simulator in this sandbox but this is a strictly more
direct verification of the same thing (the actual URL-to-route parsing logic, not just a
"something happened" signal); full `npx expo export --platform ios` after each meaningful
increment, checking the module count against the 1842 baseline from the last pass — **done for
both increments (1843, then 1844)**. **Standing limitation, same as every other entry in this
file**: no manual simulator/device run-through is possible here — flagged for next session same
as always, but this pass's plan is written specifically so each piece is independently
verifiable via direct SQL/API checks even without one.

**Two critical, previously-undetected production bugs found and fixed while doing this
verification — both unrelated to Create 2.0 itself, but found because this was the first time
`getNearbyGatherings()`'s new visibility filter was actually exercised end-to-end as a real
`authenticated`-role caller rather than via a SECURITY DEFINER RPC or a superuser session, which
is exactly the gap the "no manual simulator run-through" limitation has been flagging as a risk
throughout this whole file:**
1. **`gatherings` had no `SELECT` grant for the `authenticated` role at all**
   (`20260808_fix_gatherings_select_grant.sql`). Confirmed directly:
   `has_table_privilege('authenticated','gatherings','SELECT')` was `false`, and the table's raw
   ACL (`authenticated=awdDxtm`) was missing the `r` bit that every sibling table
   (`communities`, `matches`, `gathering_interest` — all `ardDxtm`) has. This is independent of
   and prior to RLS — every direct `.from('gatherings').select(...)` call in
   `services/gatherings.js` (`getNearbyGatherings`, `getGatheringById`, `getMyGatherings`,
   `getMyAttendingGatherings`, etc. — none of these are RPCs) would fail with "permission denied
   for table gatherings" for **every real signed-in user**, unconditionally. Not present in
   `schema.sql` or any migration as an explicit grant/revoke, so there's no way to tell from git
   history how long this has been broken — this table's very first migration never explicitly
   granted it, and evidently no other migration ever did either. Fixed with a plain
   `grant select on public.gatherings to authenticated;`, applied to production and reverified
   (`has_table_privilege` now `true`, ACL now matches siblings).
2. **`community_members`'s SELECT RLS policy was genuinely, unconditionally circular with
   `communities`'s SELECT policy** (`20260808_fix_community_members_rls_recursion.sql`).
   `community_members`' policy did `EXISTS (select 1 from communities c where ... and (c.is_public
   or c.creator_id = auth.uid()))`; `communities`' policy did `... or EXISTS (select 1 from
   community_members cm where cm.community_id = communities.id and cm.user_id = auth.uid())` —
   each table's RLS check depends on evaluating the other's RLS-protected read, forever. Because
   the `community_members` policy's clauses are ORed with the EXISTS branch listed *first*,
   Postgres's left-to-right evaluation means this recursion isn't avoided even for the simplest
   possible query, `select * from community_members where user_id = auth.uid()` — i.e. exactly
   what `getMyCommunities()` runs, and the Who step of the new gathering wizard's community
   picker depends on that. **Confirmed live, in complete isolation** (a single statement, a
   fresh session, nothing else mixed in): `set role authenticated; select 1 from
   community_members where user_id = '<a real id>' limit 1;` → `ERROR: 42P17: infinite recursion
   detected in policy for relation "community_members"`, every single time. This means the
   entire Communities feature — `getMyCommunities()`, `CommunitiesScreen.js`,
   `CommunityDetailScreen.js`'s member list, the Community Leaders feature, and now also this
   pass's community-visibility picker — has been completely broken for every real user this
   whole time, with nothing to catch it since it needs a real `authenticated`-role query to
   surface (every prior "verified live" pass in this file either used SECURITY DEFINER RPCs,
   which bypass this entirely, or ran as `postgres` without `SET ROLE authenticated`, which
   bypasses RLS altogether as the table owner). Fixed the same way this session already fixed
   the identical shape of bug for `is_blocked()`: added a new `is_community_visible_to(
   community_id, user_id)` `SECURITY DEFINER` function (internal `auth.uid() = user_id_param`
   guard, same defensive pattern as `is_blocked()`, revoked from `public`/`anon`, granted to
   `authenticated` only) that reads `communities` directly, bypassing RLS instead of
   re-triggering it, and pointed `community_members`'s SELECT policy at that function instead of
   the raw subquery. Only one side of the cycle needed breaking. **Verified live, exhaustively**:
   the original failing query now succeeds for a real member; a stranger querying a public test
   community's membership sees the full roster (correct — public); the same stranger querying
   the same community after flipping it private sees nothing (correct — matches the pre-existing,
   deliberate "a regular member of a private community only sees their own row" constraint the
   Community Leaders section already documented, unchanged by this fix); the community's own
   creator still sees the full private roster; a direct RPC probe of `is_community_visible_to`
   for a pair not involving the caller returns `false`, not a leak; `anon`/`public` confirmed
   without execute on the new function. All test rows (a temporary community, two memberships,
   three temporary gatherings covering `friends`/`community`/`invite_only`) deleted afterward —
   confirmed production back to its exact pre-test state (5 gatherings, all `everyone`, 0
   communities, 0 members).
   Along the way, also positively confirmed the actual thing this verification pass set out to
   check: the `gatherings_visibility_check` constraint genuinely rejects an invalid value
   (tried `'bogus'`, got a real `23514` violation), `community_id`'s FK to `communities` is real
   (`on delete set null`), and — with both bugs above fixed — a friend-visibility gathering and
   a community-visibility gathering are both visible via direct table access to the friend/
   member they're scoped to, exactly as `getNearbyGatherings()`'s client-side filter assumes;
   `invite_only` and non-friend/non-member visibility were not separately re-tested here since
   RLS is deliberately wide-open either way (`"Anyone can view gatherings" using (true)`,
   confirmed unchanged) — the actual exclusion has always been the client-side filter logic
   itself, already read and confirmed correct in `getNearbyGatherings()`.

## Outstanding: Create Consolidation + Create Assistant + Business Partnership Requests — DONE, build-wise (plan written before code, in case of restart)

Started Aug 8 2026, after the `bonus_notices` exploit fix (see below) was finished and
pushed. The user re-raised the Aug 7 vision-doc email's Create-tab feedback ("Create should
become one screen... 'Make a plan' and 'Start a gathering' are basically the same") and,
through a live design discussion, landed on a bigger and more specific scope than the email
implied. **Read this section fully before assuming any part of it is done** — it was
written as a plan *before* implementation started, specifically so nothing is lost if the
codespace restarts mid-build (this session has restarted several times already). Check
git log / the actual files for what's actually landed vs. still just planned here.

**Decisions locked in during the discussion, not to be re-litigated without asking again:**
1. Collapse the Create tab's overlapping "Start Something" / "Host a Gathering" cards into
   one "Start a Gathering" entry point.
2. Add a free, unbranded natural-language "Tell us what you're thinking" box that routes to
   the right creation flow with fields prefilled. **Explicitly not premium-gated and
   explicitly never labeled "AI" anywhere in the UI** — user's own reasoning: "the user
   doesn't care that AI is powering it... Premium should sell convenience and intelligence,
   not permission to participate in your core ecosystem." This is a new, separate, smaller
   feature ("Create Assistant") from the existing premium-gated AI Concierge — not an
   expansion of Concierge, and Concierge's own gating/behavior is unchanged.
3. Build the actual feature behind "Partner with a Business" that the user's own example
   needs: "I want to get 20 people together at this restaurant... business can approve
   afterward." **Confirmed by direct code investigation this does not exist today** — the
   existing `BusinessPartnerApplyScreen` → `business_partner_requests` → admin-review flow
   (used by the "Partner With Us" row gated to organizers in an earlier pass this session)
   is a generic, app-wide "onboard a new business as a partner" application with zero
   connection to any specific gathering/community. User explicitly chose to build the real
   gathering/community-specific proposal+approval flow, not just relabel/un-gate that
   existing generic form.

**Part 1 — new schema** (`supabase/migrations/20260808_business_partnership_requests.sql`,
not yet written as of this section being committed): `business_partnership_requests` table
(`requester_id`, `target_type`: `'gathering'|'community'`, `target_id`, `partner_id` FK
`brand_partners`, `message`, `status`: `'pending'|'approved'|'declined'`, `reviewed_at`) —
polymorphic target shape matching the existing `social_invites` convention. RLS: SELECT
scoped to the requester or the target business's own owner
(`profiles.managed_partner_id = partner_id`), no direct client INSERT/UPDATE — both go
through two new SECURITY DEFINER RPCs: `request_business_partnership(target_type,
target_id, partner_id, message)` (verifies caller actually owns/hosts the target, verifies
`partner_id` is real/active, rejects a duplicate pending request for the same pair) and
`respond_to_business_partnership_request(request_id, approve)` (verifies caller owns
`partner_id`, guards against double-review, sets `hosting_partner_id` on the target row
atomically on approve). **Before writing these**: check live whether `gatherings`/
`communities`' existing owner-scoped UPDATE RLS already lets a host self-set their own
`hosting_partner_id` to an arbitrary partner id with no consent check — if so, that's a
pre-existing exploit of the same shape as this session's other guarded-column fixes, worth
closing in the same pass. **Deliberately out of scope**: a business not yet in the app
can't be targeted this way (no account to approve with) — directed to the existing generic
apply flow instead, not a second parallel admin-mediated path.

**Part 2 — business search + request UI**: `getActivePartnersByName()` (name search over
active `brand_partners`) and `getMyPartnershipTargets()` (caller's own hosted upcoming
gatherings + created/led communities) in relevant services. New
`RequestBusinessPartnerScreen.js` + route, reachable two ways: from the top-level Create
tab (target picker first, since no specific gathering/community is implied) and from a new
"🤝 Request a Business Partner" link on `GatheringDetailScreen.js` (host view) and
`CommunityDetailScreen.js` (creator/leader view) — same multi-entry-point pattern already
established for "Invite friends" earlier this session, skipping the target-picker step
since the target is already known there. `BusinessDashboardScreen.js` gains a "Partnership
Requests" section (pending requests for the caller's own `managed_partner_id`,
Approve/Decline). Notify the requester on both outcomes via the existing `send-push`
mechanism (same one `invite_friend_to_gathering` already uses).

**Part 2 status: DONE except the top-level Create-tab entry point** (that one's wired
together with the Part 3 `CreateHubScreen` rebuild below, since both land in the same file
at once). `services/businessPartnerships.js` and `RequestBusinessPartnerScreen.js` were
already fully written before a codespace restart, just never wired in — confirmed this pass
that the `business_partnership_requests` migration (Part 1) was already live in production
(`request_business_partnership`/`respond_to_business_partnership_request` both exist per
`pg_proc`), so no re-application was needed. This pass added: the `RequestBusinessPartner`
route in `RootNavigator.js`; the "🤝 Request a Business Partner" link in
`GatheringDetailScreen.js`'s host banner (`targetType: 'gathering'`); the same link in
`CommunityDetailScreen.js`, gated on `isCreator || isLeader` (added a `myId` state var and
derived `isLeader` from the already-fetched `members` list, matching the RPC's own
`role in ('creator','leader')` check); and the Partnership Requests section in
`BusinessDashboardScreen.js`'s Community tab (`getPendingPartnershipRequestsForPartner` +
Approve/Decline via `respondToBusinessPartnershipRequest`, removing the row from local state
on success rather than a full reload). **Found and fixed a real bug while wiring the
dashboard section**: `RequestBusinessPartnerScreen.js` referenced `colors.surfaceAlt`, which
doesn't exist anywhere in `theme.js` (only `background`/`surface`/`surfaceElevated`/etc.) —
would have rendered `undefined` as a background color. Fixed there and avoided copying the
same mistake into the new dashboard styles (`surfaceElevated` used instead). Verified via a
full `npx expo export --platform ios` (1841 modules, two more than the prior 1839 baseline —
the two new files from before the restart, no new files this pass). Committed and pushed
(`05fcb48b`). **Not done yet**: no manual run-through in a simulator/device — next session
should click through sending a request from both entry points and approving/declining from
the dashboard as a real business owner account.

**Part 3 — Create Assistant**: new `supabase/functions/create-assistant/index.ts` — same
bearer-token auth pattern as every existing `generate-*`/`ai-concierge` function, but **no
premium check** (the one deliberate exception to that convention in this codebase). Still
calls `check_and_increment_ai_use` with `daily_limit: 150` (matching the existing
per-message-feature ceiling, not the single-shot 50 — meant to feel unlimited to a normal
user; the shared counter is a pure cost/abuse safety net, never surfaced or marketed as a
limit). `claude-haiku-4-5-20251001`, `max_tokens: 300`. Classifies the user's own free text
(low injection surface — this is the caller's own input, not content written by other
users, unlike Concierge) into `intent: 'gathering'|'community'|'business_partner'|
'unclear'` plus best-effort `title`/`category` (re-validated server-side against a
hardcoded copy of `CreateGatheringScreen.js`'s real `INTEREST_OPTIONS` list) and
`businessName` when relevant. **No date/time extraction** — deliberately not attempted,
parsing relative dates like "Friday night" reliably is fragile; the user still picks
date/time normally on the gathering wizard's own step. `CreateHubScreen.js` rebuilt to
three cards (🎉 Start a Gathering / 👥 Create a Community / 🤝 Partner with a Business) plus
a "💡 Tell us what you're thinking" input row underneath, subtext "We'll help you turn it
into a plan," routing by returned `intent` to the right prefilled screen. "Start a
Gathering" opens the existing `StartSomethingModal` with a new optional `topLevelOptions`
prop overriding its default time-of-day-adaptive list with a fixed Coffee/Dinner/Walk/
Sports/Games/Music/Volunteer/Something Else set (mapped to real existing `INTEREST_OPTIONS`
category tags — Coffee/Foodie/Outdoors/Sports/Gaming/Music/Volunteering) — no other caller
passes this prop, so `HomeScreen.js`'s own time-adaptive use of the same modal is
unaffected. This removes the separate "Host a Gathering" direct-to-blank-wizard card — the
modal's existing "Something Else" chip already covers that exact case.

**Part 3 status: DONE.** `create-assistant` deployed to production and confirmed
`verify_jwt: true` via the Management API (not assumed — this is the exact footgun this
section already flagged, and it didn't recur this time). `CreateHubScreen.js` rebuilt to the
three cards plus the NL box; `CREATE_HUB_OPTIONS` added to `StartSomethingModal.js` as
described. `CreateCommunityScreen.js` gained `quickStartTitle`/`quickStartCategory` route-param
prefill (didn't exist before — only `CreateGatheringScreen.js` had it), so the Assistant's
`community` intent has somewhere real to land. The business-partner card routes to
`RequestBusinessPartnerScreen` with `initialBusinessQuery` prefilled from the Assistant's
`businessName` — that param was already built into the screen before this pass, just unused
until now. Verified via a full `npx expo export --platform ios` (1842 modules, one more than
the 1841 baseline from the Part 2 commit — the one new `createAssistant.js` service file).
Committed and pushed (`d6225286`). **Not done yet, same standing gap as `ai-concierge`**: the
actual Anthropic call path was never exercised end-to-end — confirmed the function is live and
the gateway correctly 401s an unauthenticated request, but reaching the real classification
logic needs a signed-in session this sandbox can't mint. Also not done: no manual
simulator/device run-through of the new `CreateHubScreen` (all three cards, the NL box's
`gathering`/`community`/`business_partner`/`unclear` branches, and the `StartSomethingModal`
opening with the new fixed option set instead of the time-adaptive one).

**Overall status of this whole plan (Parts 1–3): DONE, build-wise.** Part 1 (schema) was
verified end-to-end against production in the commit that introduced it (`73f27539`). Parts 2
and 3 are described with their own status notes above. What's left across all three, gathered
in one place so it isn't scattered: a real simulator/device click-through (sending a
partnership request from all three entry points — Create tab, `GatheringDetailScreen`,
`CommunityDetailScreen` — approving/declining from `BusinessDashboardScreen`, and exercising
the Create Assistant's four intent branches with a real premium-less session), and confirming
the `create-assistant` Anthropic call itself succeeds end-to-end with real output shape once a
real session is available.

**Deliberately out of scope, flag rather than silently build**: a "Business AI Assistant"
(a chat-style analytics tool for business owners — "why did attendance drop," "create a
promotion") is a real, distinct future feature per the user's own 3-tier free/premium/
business breakdown discussed live, not attempted in this pass.

**Verification plan for this pass**: live-check the `hosting_partner_id` RLS question above
before writing the RPCs; apply the new migration to production
(`enmosvippabmuqslzrox`) via the Management API and verify end-to-end via
`set_config('request.jwt.claims', ...)` as real profiles (owner can request, duplicate
rejected, non-owner rejected, target business can approve/decline, non-owner of that
partner cannot, approve sets `hosting_partner_id`, decline doesn't) — clean up all test
state afterward, matching this session's established convention; deploy
`create-assistant` and confirm `verify_jwt: true` explicitly rather than assuming (the CLI
left `ai-concierge` on `false` by default on first deploy last time); full
`npx expo export --platform ios` after each meaningful increment, checking the module count
against the 1839 baseline. No manual simulator run-through is possible in this sandboxed
environment (standing limitation everywhere in this file) — flagged for next session same
as every other entry here.

## Aug 8 2026 — codespace restarts mid-session, work continued from a forwarded email

The user forwarded an email (sent from the prior Claude Code session, cut off mid-task by
hitting its session usage limit — visible in the email body as "You've hit your session
limit") containing feedback on a 5-tab IA (Home / Discover / Create / Inbox / Profile) checked
against a user-articulated "flywheel" vision. The email text was OCR-garbled from a
screenshot/email-client copy-paste, so **treat the email as a lead to re-verify against the
actual repo, not as ground truth** — same posture this file has always taken toward external
docs. Working tree was clean on restart (`git status` showed nothing uncommitted, nothing
lost) — the crashed session had only gotten as far as writing a task list, no files existed
yet. The 8-item task list visible in the email (from a `TaskList`-style dump) was: correct
CLAUDE.md about the invite system, build an invites schema + RPCs, add `services/invites.js`,
generalize `InviteFriendsModal` for gathering+community, plus 4 more truncated by the OCR.

Re-verified each claim in the email directly against the repo before building anything (per
this file's own long-standing rule):
- **"Invite people doesn't exist as a feature at all... this is the biggest real gap"** — 
  **partially wrong, and it's the same class of miss this file has now caught six separate
  times (Safety, AI Concierge, Business RPC ownership, Settings Business Mode, Consumer
  Billing, now this).** A real, working, already-deployed `invite_friend_to_gathering()`
  SECURITY DEFINER RPC exists in production — checks the invitee is an accepted friend, blocks
  a women-only gathering from inviting a non-woman, checks neither party has blocked the
  host, then sends a real push notification via `send-push` with
  `data: {type: 'gathering_invite', gathering_id}` (the exact push type
  `notifications.js`'s `case 'gathering_invite':` deep-link handler already exists for — that
  handler was flagged as dead code in the "Outstanding: Create Flow" section below; **that
  flag was wrong too**, corrected here). It's wired to a real 🤝 "Invite friends" button on
  two of `GatheringsScreen.js`'s three tabs (nearby, attending — not hosting) via
  `src/components/InviteFriendsModal.js`, which was sitting there the whole time under a name
  distinct from `InviteFriendsScreen.js`/`InviteFriends` route (that one's the app-referral-code
  screen — a third, unrelated "invite" name in this codebase, worth being careful about).
  **What's actually true and still missing**: this gathering-invite path (a) doesn't exist at
  all for **communities** — confirmed zero `Invite` references anywhere in
  `CommunityDetailScreen.js`/`CommunitiesScreen.js`, no RPC — a real, confirmed gap; (b) isn't
  reachable from the newer `GatheringDetailScreen.js` (only the older list-card `GatheringsScreen`
  tabs have it) or from the hosting tab; (c) is push-only/fire-and-forget with no persisted
  row anywhere, so there's no way to show "pending gathering invites" in Inbox even if you
  wanted to (only a tapped push can surface it, and if the push is missed/denied, the invite
  is simply gone).
- **"No 'Trending nearby' on Discover"** — confirmed true. `Trending` exists on `HomeScreen.js`
  and `GatheringsScreen.js`, not on `DiscoverHubScreen.js`.
- **"'Partner with a business' shown to everyone, not gated to organizers"** — confirmed true,
  read directly: `CreateHubScreen.js`'s "Partner With Us" row has no gating at all.
- **"Inbox 'Invitations' is mislabeled — shows friend requests"** — confirmed true, but with a
  nuance: `InboxScreen.js`'s "🤝 Invites" tab renders real `getPendingFriendRequests()` rows
  with honest per-row copy ("wants to be friends") — not fabricated or silently mislabeled at
  the row level, just a tab name broader than what it actually shows, and (per the point
  above) it has no way to show real gathering/community invites even though at least one of
  those (gatherings) already exists elsewhere in the app.
- **"No group/event chats surfaced in Inbox"** — confirmed true. `MatchesScreen.js` (Inbox's
  Messages tab) has zero references to gathering chat or community chat; both exist but are
  only reachable from deep inside `GatheringDetailScreen`/`GatheringHubScreen`/
  `CommunityDetailScreen`.
- **"Home community-updates section only shows one community"** — confirmed true:
  `HomeScreen.js`'s "🏘️ Continue Your Community" section (line ~175) surfaces a single
  community, not one per joined community.
- Not yet re-verified against the repo: "no invitations shown on Home" and "Create should
  become one screen across all communities" (the OCR text around these was too garbled to
  extract a concrete, checkable claim) — flagged here rather than silently acted on or
  silently dropped.

Given real gaps confirmed above, all six re-verified-true items were closed this pass — see
"Outstanding: Invite People" and the four bullets after it below. Committed and pushed after
each individual increment (not batched at the end), since this codespace was restarting
roughly every 15 minutes throughout — check git log for the granular sequence if picking this
up mid-way ever happens again.

- **Trending on Discover, gated "Partner With Us", Home's community-updates limit, and
  group-chat surfacing in Inbox — all closed this pass, each its own commit**:
  `DiscoverHubScreen.js` gained a "🔥 Trending Near You" section using the exact same signal
  Home's own trending already uses (top 3 gatherings by approved-attendee count, from the
  gathering list Discover already fetches for search — no new query).
  `CreateHubScreen.js`'s "Partner With Us" row is now gated on a real organizer signal (hosted
  a gathering, or leads/created a community via `community_members.role`) — hidden for a user
  with neither, and swapped to "🏪 Manage Your Business" → `BusinessDashboard` for an existing
  partner (same swap `SettingsScreen.js`'s Business Mode row already does), instead of showing
  the apply flow to literally everyone. `getContinueYourCommunity()` (Home's "🏘️ Continue Your
  Community") was hardcoded `.limit(1)` to the single most-recently-joined community regardless
  of how many the user belonged to — now `getContinueYourCommunities()`, fetching every joined
  community and ranking by real recent activity (unread message count in the last 24h), showing
  up to 3. `InboxScreen.js`'s Messages tab (`MatchesScreen`) had zero awareness of gathering or
  community group chats — both exist and work, just weren't reachable from Inbox at all — added
  a horizontal "Group Chats" chip row above the existing matches list (new lightweight
  `getMyGatheringChats()` in `gatherings.js` + the existing `getMyCommunities()`;
  `MatchesScreen.js` itself untouched, same "thin wrapper, don't risk the working internals"
  approach `InboxScreen.js` already uses for Messages/Activity).
- **Follow-up pass, same day**: "no invitations shown on Home" is now closed too — see the
  "Follow-up pass" bullet under "Outstanding: Invite People" below (Home gained a real pending-
  invites banner, and the Inbox tab badge itself was undercounting for the same reason).
  "Create should become one screen across all communities" is **still not re-verified** — the
  OCR text around it stayed too garbled to extract a concrete, checkable claim even on a second
  look. Flagged, not silently acted on or dropped.

## Aug 8 2026 — second restart, found and fixed a real block-check gap

Codespace restarted again (roughly the 15-minute cadence noted throughout this session).
`git status` was clean and `git log` matched `origin/main` exactly — nothing from the prior
pass was lost, everything through "Document the follow-up pass" (`6f4515f3`) was already
committed and pushed. Re-verified the two riskiest just-shipped pieces directly against
production (`enmosvippabmuqslzrox`) before doing anything new: `social_invites`/
`friend_circles`/`emergency_contacts`/`partner_contracts`/`business_invoices` tables all exist
live, and `invite_friend_to_gathering`'s deployed source matches the repo's migration exactly,
including the `social_invites` insert added in the prior follow-up pass.

While re-reading that function to confirm it, found a real, previously-uncaught bug of the
same shape as the "missing blocks check" bug already documented above:
`invite_friend_to_gathering` checks blocks between the gathering's **host** and the invitee,
but never between the **inviter** (`auth.uid()`) and the invitee — the exact check
`send_social_invite` already has correctly (`(blocker_id = auth.uid() and blocked_id =
invitee_id_param) or (blocker_id = invitee_id_param and blocked_id = auth.uid())`). Since
blocking someone doesn't remove an existing accepted friendship (confirmed live — no trigger
on `blocks` touches `friendships`), a user could still gathering-invite someone they've
blocked, or who has blocked them, as long as neither party had blocked the gathering's host —
the host-check alone doesn't cover the inviter/invitee relationship at all.

- Fixed in `20260808_gathering_invite_inviter_block_check.sql`: added the same
  auth.uid()-vs-invitee blocks check `send_social_invite` uses, ahead of the existing
  host-vs-invitee check (both now run; neither replaces the other — a host-blocked case and an
  inviter-blocked case are both real, independent reasons to reject). Applied directly to
  production via the Management API.
- **Verified live, not just applied**: confirmed `authenticated` retained execute (`anon` still
  correctly cannot) after the `CREATE OR REPLACE`. Using the two real non-test profiles that
  already had an accepted friendship in production (`Claude` / `Allen`), inserted a real block
  row (`Claude` blocked `Allen`), then called the function as `Claude` via
  `set_config('request.jwt.claims', ...)` inviting `Allen` to a real gathering **that `Allen`
  themselves hosts** — chosen specifically so the pre-existing host-check (host vs. invitee,
  same person here) couldn't mask whether the *new* check was doing anything. Got back
  `ERROR: This person cannot be invited`, confirming the new check fired. Deleted the test
  block row afterward and confirmed both `blocks` and `social_invites` were left exactly as
  before the test (the exception rolled back before the `social_invites` insert ever ran, so
  there was nothing to clean up there beyond the block row itself).
- **Not done yet**: same standing gap as the rest of this file — no manual run-through in a
  simulator/device. This was a pure backend/RPC-level fix (no client file touched), so there's
  no new UI surface to click through; next session should just confirm a real blocked pair
  still can't gathering-invite each other end-to-end through the actual `InviteFriendsModal` UI,
  not only via direct RPC calls.

## Aug 8 2026 — same session, found and fixed a systemic block-enforcement bug (`is_blocked`)

Asked to keep auditing after the fix above. Read `BusinessDashboardScreen.js` (open in the
user's editor) end to end looking for bugs in the newest, most-churned file, which led to
checking the CRM messaging path's RLS. Found that `business_messages` had **no blocks check at
all** on either INSERT policy ("Business owners can reply..." / "Followers can message a
business they follow") — unlike the plain `messages` table, whose own INSERT policy already
checks `not is_blocked(m.user_a, m.user_b)`. Wrote `20260808_business_messages_block_check.sql`
to add the same check to both policies, using the existing shared `is_blocked()` helper.

**While verifying that fix live, found something much bigger**: the test (a real block row,
then attempting the now-guarded INSERT as the blocked business owner) still went through —
the new check didn't fire. Root cause: `is_blocked(user_1, user_2)` is a plain SQL function,
not `SECURITY DEFINER`, so when it queries the `blocks` table it runs under the **calling
role's own RLS**, not a privileged bypass. `blocks`' own SELECT policy is `auth.uid() =
blocker_id` only (intentional elsewhere — the blocked party isn't supposed to be able to tell
they were blocked, e.g. `getMyBlockedUsers()` only ever lists blocks *the caller created*). Net
effect: whenever the **blocked party** (not the blocker) is the one performing the RLS-checked
action, `is_blocked()` silently returns `false`, because from their own session's point of
view the block row doesn't exist to select. This isn't specific to the new `business_messages`
policies — `is_blocked()` is referenced by **~10 policies total**: `matches` SELECT, `messages`
SELECT + INSERT, `notices` SELECT (×2), `sightings` SELECT, `shared_playlist_items` SELECT +
INSERT. Confirmed the real-world impact directly against production, not just theorized it:
using the same two real profiles as the fix above (`Claude` blocked `Allen`, a real pre-existing
match already existed between them from Jul 28), as `Allen` (the blocked party) `is_blocked(
Claude, Allen)` returned `false`, the blocked match was still fully visible in `Allen`'s own
`select * from matches`, and `Allen` could still successfully `INSERT` into `messages` for that
match — **a blocked user could still see and message the person who blocked them**, the exact
scenario the whole `blocks` feature exists to prevent.
- Fixed in `20260808_is_blocked_security_definer.sql`: made `is_blocked` `SECURITY DEFINER`
  (pinned `search_path`) so it sees the real `blocks` table regardless of which side of the
  block the caller is on. To avoid this becoming a *new* leak — an authenticated user directly
  RPC-calling `is_blocked(x, y)` to probe arbitrary pairs, including using it to detect "does
  this stranger have me blocked," which the app has never exposed anywhere — added an internal
  guard: it only ever returns a real answer when `auth.uid()` is one of the two supplied ids,
  `false` otherwise. Checked every one of the ~10 existing policy expressions first to confirm
  this is safe: every single one already independently requires `auth.uid()` = one of the same
  two ids via its own `AND` clause, so the guard changes nothing that was already working.
  Revoked `anon`/`public` execute (both had it before this fix, almost certainly just the
  default-privileges grant this file's own "Known conventions" section already warns about,
  not intentional), left `authenticated` only.
- **Verified live, exhaustively, not just theorized**: re-ran the exact prior failing
  `business_messages` insert as the blocked party — now correctly rejected. Directly compared
  `is_blocked()`'s answer for the same real pair from both sides (blocker: `true`, correctly
  unchanged; blocked party: `true`, was `false` before the fix) and confirmed the new guard
  returns `false` for a pair not involving the caller at all (tested `Allen` probing an
  unrelated third profile). Re-confirmed against the real `matches`/`messages` tables
  specifically (not just the new `business_messages` policies this session actually touched):
  while the test block was live, `Allen`'s own match list correctly dropped the blocked match
  (an unrelated second real match stayed visible, proving this wasn't a blanket empty-result
  bug), and `Allen`'s attempted `INSERT` into `messages` for that match was correctly rejected;
  removing the block made the match reappear. All test rows (`blocks`, `business_followers`,
  the one `business_messages` row that leaked through *before* the fix landed) deleted
  afterward — confirmed all three tables empty again, production back to its pre-test state.
- **Not done yet**: no manual run-through in a simulator/device (same standing gap as
  everywhere else in this file) — this was entirely a backend RLS/function fix, no client file
  touched. Next session should confirm in the running app: block someone you have a real
  match/conversation with, confirm their messages/match genuinely disappear from your own UI
  (not just via direct SQL), and confirm they can no longer send you a message or a business
  reply. Also worth a broader look at `notices`/`sightings`/`shared_playlist_items` in the
  running app, even though their `is_blocked()` usage was verified correct via the same shared
  fix — none of them were individually re-tested end-to-end the way `matches`/`messages` were.

## Aug 8 2026 — same session, found and fixed a critical admin self-escalation bug

Kept auditing after the two fixes above, per direct instruction. Went looking for the same
"missing column guard" class of bug systematically: `prevent_self_premium_edit()` (this file's
own "Known conventions" section: privileged `profiles` columns are protected by this trigger,
real writes must set `app.trusted_update`) has an explicit, hardcoded column whitelist —
checked every column on `profiles` against that whitelist rather than assuming it was complete.

**`is_admin` was not in the guarded list.** `profiles`' only UPDATE policy is `auth.uid() =
id` with no column-level restriction, so nothing besides this trigger stood between a normal
user and their own `is_admin` flag. **Verified live, carefully, on a real (genuinely
non-admin) profile**: called `update profiles set is_admin = true where id = <that profile>`
as that profile's own session — it succeeded, really setting `is_admin = true`. Reverted within
the same breath (a service-role `trusted_update` call back to `false`) before doing anything
else. This is the most severe finding of the whole session: full admin access (`AdminReportsScreen`,
`AdminBusinessRequests`, `AdminVerificationScreen`, every `is_admin`-gated RPC) was one client-side
`.update()` call away for any authenticated user. Grepped all of `src/` first to confirm zero
legitimate code path ever sets `is_admin` — it's meant to be granted by hand via the service
role only — so adding it to the guarded list has no risk of breaking a real flow.
- Fixed in `20260808_protect_is_admin_column.sql`: added `is_admin` to
  `prevent_self_premium_edit()`'s guarded-column list, identical shape to every other entry
  (`is_premium`, `managed_partner_id`, etc.) — silently reverts the client's attempted value
  back to `old.is_admin` unless `app.trusted_update` is set.
- **Verified live, both directions**: re-ran the exact same self-escalation attempt — the
  `UPDATE ... RETURNING` now comes back with `is_admin: false` even though the client asked for
  `true` (silently reverted, matching the established `is_premium` behavior, not an error).
  Separately confirmed the legitimate `trusted_update` path (how a real admin grant is meant to
  happen) still works unchanged.
- **While proving the live exploit, also found a second, separate, real bug** (not a security
  hole, a silently-broken feature): `AdminVerificationScreen.js`'s approve action tries to set
  `photo_verified = true` on the *submitter's* profile (`.eq('id', submission.user_id)`) — a
  different row than the reviewing admin's own. `profiles` has exactly one UPDATE policy
  (`auth.uid() = id`) and **no admin bypass for UPDATE at all** (only a SELECT bypass,
  `check_is_admin(auth.uid())`, exists). Verified live: granted a real profile `is_admin = true`
  via `trusted_update` (simulating a genuine admin session), then attempted that same cross-user
  update as that admin — it silently affected 0 rows (Supabase's `.update()` doesn't error on a
  no-op RLS-blocked write). **Net effect: approving an ID verification submission today marks
  the submission `approved` but never actually grants the user their verified badge** — a
  currently-broken safety/trust feature, not yet fixed. No real submissions exist in production
  yet (`id_verification_submissions` is empty) so this hasn't visibly bitten anyone, but it will
  the first time someone actually submits. Flagged here rather than fixed in the same pass —
  the correct fix is a new SECURITY DEFINER RPC (e.g. `admin_approve_id_verification`, checking
  `auth.uid()`'s own `is_admin` internally) doing both the submission-status update and the
  target's `photo_verified` update atomically, matching this codebase's established
  admin-action-via-RPC pattern, rather than opening a broad admin bypass UPDATE policy on all of
  `profiles`. **Fixed later this same pass, see below.**
- **Also found, not yet fixed, lower severity**: `bonus_notices` (a real, spendable resource —
  see `noticeLimits.js`/`referrals.js`) is written directly from client-side JS in both the
  spend path (`noticeLimits.js`) and the earn path (`referrals.js`'s +3 on a valid referral),
  neither wrapped in `trusted_update`. Since it's also absent from the same guarded-column list,
  a user could set their own `bonus_notices` to an arbitrary number directly, bypassing the real
  `referral_redemptions`-gated earn flow entirely — a currency exploit, not a privilege
  escalation. Not fixed this pass because, unlike `is_admin`, this one **does** have legitimate
  client-side writers — naively adding it to the trigger's guard list would silently break the
  real spend/earn flows too; the correct fix needs those two call sites converted to SECURITY
  DEFINER RPCs (or wrapped in `trusted_update` some other safe way) at the same time as the
  column gets protected, not attempted in this same pass to avoid shipping a half-done fix.
- **Broken admin verification approval — fixed later this same pass**: new
  `admin_approve_id_verification(submission_id, approved)` SECURITY DEFINER RPC
  (`20260808_admin_approve_id_verification.sql`) does both writes atomically — checks
  `auth.uid()`'s own `is_admin` first (raises if not), updates
  `id_verification_submissions.status`/`reviewed_at`/`reviewed_by` (guarded by `status =
  'pending'` so a submission can't be double-reviewed), then on approval sets
  `app.trusted_update` and writes the submitter's `profiles.photo_verified = true`.
  `AdminVerificationScreen.js`'s `handleDecision()` now calls this RPC instead of the two raw
  table writes. **Verified live and end-to-end for real** (not just the RLS-block proof from
  the finding above): created a real pending submission for one real profile, called the RPC as
  the other real profile (Allen — genuinely `is_admin = true` in production, not a test flag) —
  the submission correctly flipped to `approved` with real `reviewed_by`/`reviewed_at`, and the
  submitter's `photo_verified` correctly flipped to `true` in the same call. Separately
  confirmed a true non-admin calling the RPC is rejected (`Only admins can review verification
  submissions`), and that re-approving an already-reviewed submission is rejected (`Submission
  not found or already reviewed`). All test submissions deleted and the test profile's
  `photo_verified` reset to `false` afterward. Verified via a full `npx expo export --platform
  ios` (1839 modules, unchanged — an edit to an existing screen, no new client files).
- **`bonus_notices` self-edit exploit — fixed in a follow-up pass after a codespace restart.**
  The codespace restarted mid-fix; on restart, `git status` showed a clean working tree except
  one untracked, already-fully-written file — `20260808_protect_bonus_notices.sql` — matching
  exactly the fix this file had flagged as deliberately deferred. The migration itself was
  complete (both RPCs, both trigger-guard additions) but had never been applied to production,
  and `noticeLimits.js`/`referrals.js` still had their original direct-write client code, so the
  guard alone would have silently broken the real spend/earn flows had it been applied without
  the client change — exactly the risk the original deferral was written to avoid. Finished the
  other half and applied: `checkNoticeLimit()` in `noticeLimits.js` now calls
  `supabase.rpc('spend_bonus_notice')` instead of a client read-then-write; `redeemReferralCode()`
  in `referrals.js` is now a thin wrapper around `supabase.rpc('grant_referral_bonus', {
  code_param })`, collapsing five separate client round-trips (lookup, insert, two profile
  updates split across two read-then-write pairs) into one atomic server-side call — also
  closes a real read-then-write race the old code had (two concurrent redemptions could both
  read the same `bonus_notices` count before either wrote it back). `redeemReferralCode`'s now-
  unused `newUserId` param was dropped and its one caller (`InviteFriendsScreen.js`) updated to
  match, since the RPC reads `auth.uid()` server-side instead.
  Applied `20260808_protect_bonus_notices.sql` to production (`enmosvippabmuqslzrox`) via the
  Management API. **Verified live end-to-end, not just applied**: confirmed both new functions
  are `SECURITY DEFINER` with `authenticated`-only execute (`anon` correctly excluded); as the
  real profile `Claude` (3 real bonus notices at the time), called `spend_bonus_notice()` and
  confirmed a genuine decrement to 2; immediately after, attempted the exact old exploit — a
  direct `update profiles set bonus_notices = 9999` as that same session — and confirmed it was
  silently reverted to 2, matching the established `is_premium`/`is_admin` guarded-column
  behavior; confirmed `spend_bonus_notice()` correctly returns `false` (no-op) for a real
  profile already at 0. For `grant_referral_bonus`, confirmed a self-referral attempt is
  rejected (`You can't use your own referral code`), confirmed a second redemption attempt by
  an already-referred real profile correctly hits the pre-existing `23505` unique-violation
  anti-fraud gate, and ran one genuine new redemption end-to-end (a real never-referred profile
  redeeming a real referrer's code) — confirmed both sides' `bonus_notices` incremented by 3 and
  `referred_by` was set correctly on the referred profile. All test state (the one new
  redemption, both profiles' `bonus_notices`, `Claude`'s spent notice) reverted afterward via
  `trusted_update` back to exactly its pre-test values — confirmed via a final read that
  production matches its pre-test snapshot. Verified via a full `npx expo export --platform
  ios` (1839 modules, unchanged — edits to existing files only, no new client files).
- **Not done yet**: no manual run-through in a simulator/device for either this fix or the
  admin-verification RPC wiring above — next session should click through `AdminVerificationScreen`
  as a real admin account with a real pending submission and confirm approve/reject behave
  correctly in the UI, and separately confirm in the real app that spending a Notice via a
  bonus (not the daily free allotment) still decrements correctly and that redeeming a referral
  code in `InviteFriendsScreen` still shows its existing "You've both received 3 bonus Notices"
  success alert — not just via direct RPC calls.

## Outstanding: Invite People (gathering + community)

Scope, per the correction above: gatherings already had a real invite mechanism
(`invite_friend_to_gathering` + `InviteFriendsModal`, on `GatheringsScreen.js`'s nearby/
attending tabs) — left that mechanism in place rather than replacing it, since it already has
women-only and blocks safety checks a naive rebuild would have to duplicate exactly to stay as
safe. New work targeted what was actually missing: community invites, a persisted (not
push-only) invite record so Inbox can list something real, and reaching
`GatheringDetailScreen`/`CommunityDetailScreen` where no invite entry point existed at all.

- **New `social_invites` table** (`20260808_social_invites.sql`, applied to production and
  verified live via `set_config('request.jwt.claims', ...)` as real profile rows — friend
  invite succeeds, non-friend invite rejected, only the real invitee can respond, double-respond
  rejected, all test rows cleaned up after): one polymorphic table (`invite_type`:
  `'gathering' | 'community'`, `target_id`) rather than two separate tables, since both shapes
  are identical and a single Inbox list needs to read both without a union query. Two SECURITY
  DEFINER RPCs, `send_social_invite`/`respond_to_social_invite`, matching this codebase's
  established "no direct client INSERT/UPDATE, real checks inside the function" pattern (e.g.
  `set_community_member_role`). `send_social_invite` initially shipped **without** a blocks
  check — caught by comparing against `invite_friend_to_gathering`'s own blocks check right
  after finding that function existed, fixed same-session in
  `20260808_social_invites_block_check.sql`, verified live (a blocked pair's invite is now
  rejected) — every other invite-adjacent write in this codebase (`sendFriendRequest`,
  `invite_friend_to_gathering`) already checked blocks; this one initially didn't.
  Friends-only enforcement (same "no stalking vector" reasoning as Discover's unified search
  deliberately excluding People) applies to both invite types, even though communities have no
  women-only concept to also check.
- **`src/services/invites.js`**: `sendInvite`/`respondToInvite` (thin RPC wrappers),
  `getMyReceivedInvites()` — fetches pending `social_invites` for the caller, then two batched
  follow-up queries (gatherings/communities by id) to resolve real target titles, since
  `social_invites` deliberately doesn't denormalize a copy of the title onto the row.
- **`InviteFriendsModal.js` generalized**: now accepts `inviteType`/`targetId`/`targetTitle`
  alongside its original `gatheringId`/`gatheringTitle` props (kept working byte-for-byte
  unchanged for `GatheringsScreen.js`'s existing usage — `gatheringId` truthy still means
  gathering, still calls `invite_friend_to_gathering`). Community invites go through the new
  `sendInvite('community', ...)`.
- **Entry points added**: `GatheringDetailScreen.js` gained a "🤝 Invite friends" link in both
  the host banner and the post-join "You're in!" panel (previously had none at all — only the
  older `GatheringsScreen` list-card tabs did). `CommunityDetailScreen.js` gained an "🤝 Invite
  Friends" button for members/creator, next to the existing Community Chat button (communities
  had zero invite mechanism before this).
- **`InboxScreen.js`'s Invites tab wired up**: now shows a combined list — real friend
  requests (unchanged) plus real pending `social_invites` rows from `getMyReceivedInvites()`,
  each tagged by `kind` and rendered accordingly. Social invites get Accept/Decline (friend
  requests stay Accept-only, matching the original); accepting deep-links straight into
  `GatheringDetail`/`CommunityDetail` via `respond_to_social_invite` + navigation. The tab's
  badge count and empty-state copy were updated to reflect both sources honestly.
- Verified via a full `npx expo export --platform ios` after every single increment in this
  pass (1839 modules throughout, one more than the prior 1838 Billing-pass baseline — only
  `invites.js` is a new module; every other file touched in this pass was an edit, not an
  addition, so the count held steady across all of them).
- **Follow-up pass, same day**: the "deliberately not attempted" gap above (gathering invites
  not persisting into `social_invites`, only ever a fire-and-forget push) was closed —
  `invite_friend_to_gathering` now also inserts a real `social_invites` row (`ON CONFLICT DO
  NOTHING` against the same partial unique index `send_social_invite` uses), same function,
  same friends/women-only/blocks checks, unchanged. Verified live: grants survived the
  `CREATE OR REPLACE`, and a real invite call now produces a real pending row. Both invite
  paths now show up in Inbox's Invites tab identically.
- **Also found and fixed while following up**: `getInboxUnreadCount()` (the function behind the
  Inbox tab's badge number) only ever summed unread messages + new notices — it never counted
  pending gathering-join requests, pending friend requests, or pending invites, so the badge
  undercounted what Inbox actually had waiting. Factored the three pending counts into a new
  `getPendingInvitesCount()`, used by both the badge and a new "🤝 N pending invites & requests"
  banner on `HomeScreen.js` (same visual pattern as the existing perks banner) — this also
  closes the vision-doc email's "no invitations shown on Home" claim, which the first pass
  through this file had flagged as unverifiable due to OCR garbling. `InboxScreen.js` gained an
  `initialSection` route param so the banner can deep-link straight to the Invites tab (needed
  because the tab navigator keeps `InboxScreen` mounted, so a plain `useState` initial value
  wouldn't see a fresh navigation's param on an already-visited tab).
- **Not done yet**: no manual run-through in a simulator/device for any of the invite work, the
  Trending/Partner-gating/Home-communities/Inbox-group-chats fixes above, or the follow-up pass,
  beyond the direct SQL verification already run against production. Next session should click
  through: sending a gathering invite from `GatheringDetailScreen` and a community invite from
  `CommunityDetailScreen` as two real friended accounts, confirming both now show up correctly
  in the recipient's Inbox Invites tab and in the Home banner/tab badge count, accepting a
  community invite and confirming it deep-links into the right `CommunityDetail`, the new
  Trending section on Discover, "Partner With Us" visibility for an organizer vs. a non-
  organizer account, Home showing multiple communities for a multi-community account, and the
  Group Chats row in Inbox for an account with real upcoming gatherings and communities.

## Known gaps against the Aug 7 2026 external roadmap doc

The user pasted an external 16-item roadmap doc (plus a "Phase 5 (Magic)" wishlist) on
Aug 7 2026 prioritizing remaining screen work. Checked against actual repo state that same day.
Discover (item 1) was closed that session — see the section below. The rest, so nothing here
gets silently forgotten:

**Confirmed NOT built** (checked directly — grepped for it, found nothing, or the screen
exists but doesn't do the thing):
- **Unified Map Experience** (#10) — **closed this session as far as it honestly can be, see
  "Outstanding: Unified Map" below** — real businesses and a live-activity layer were added;
  people and communities were deliberately not, for reasons documented there.
- **Insights** (#13) — **closed this session, see "Outstanding: Insights screen" below.**
- **Safety — emergency contact + check-in** (#15) — **closed this session, see "Outstanding:
  Emergency Contacts" below — and the original audit line here was partly wrong, worth
  flagging.** It grepped for `emergency_contact`/`EmergencyContact`/`safetyCheckIn` and found
  nothing, concluding the whole check-in flow didn't exist. In fact a full "Date Safety
  Check-In" flow already existed under different names — `date_checkins` table,
  `services/dateSafety.js` (`createCheckIn`/`buildShareMessage`/local scheduled reminder via
  `expo-notifications`), `DateCheckInModal.js` (also live-location-sharing and one-tap
  location-snapshot sharing via `expo-location`), wired from `ChatScreen.js` and surfaced back
  in `MatchesScreen.js` as a post-date "are you safe?" prompt. Same class of mistake this file's
  own Discover section already warned about — a literal-string grep for the wrong name can miss
  a real, already-built feature. The one genuinely missing piece was a persistent, reusable
  emergency contact (name/phone/relationship) instead of picking a share recipient fresh every
  time — that's what got built.
- **AI Concierge** (Phase 5) — **closed this session, see "Outstanding: AI Concierge" below —
  and the premise in this line was wrong, worth flagging.** This line previously claimed no
  natural-language flow existed anywhere and that Concierge "would be this codebase's first
  real LLM call." **That was false.** Checking local `src/` for LLM usage was accurate (Home's
  `getHomeInsight()`, Discover's "Recommended for you" genuinely are real-signal heuristics,
  no LLM), but the check never looked at what's actually *deployed* on Supabase — the local
  `supabase/functions/*/index.ts` files are all empty stubs (a pre-existing gap in this repo's
  own practices, not something introduced this session), so a from-source grep found nothing
  while production silently had 17 real deployed Edge Functions, at least 6 of them genuine
  Claude API calls already wired to real screens: `generate-icebreaker` (`ChatScreen.js`),
  `generate-strengths` (`ProfileScreen.js`), `generate-courage-message`/`translate-message`
  (`ChatScreen.js`), `generate-introduction` (`CompatibilityReportModal.js`), `rehearsal-chat`
  (`RehearsalRoomScreen.js`) — plus a live `ANTHROPIC_API_KEY` secret already configured. Same
  class of miss this file has now caught three separate times (Safety/emergency-contacts,
  Business Profile network calls, and now this) — always verify against what's actually live,
  not just what's checked into git, before concluding a capability doesn't exist.
- **Friend Circles** (Phase 5) — **closed this session, see "Outstanding: Friend Circles"
  below.** `FriendsScreen.js` was a flat friends list with no grouping concept (Work/Fitness/
  Family/Travel) anywhere in the schema or UI.
- **Momentum** (Phase 5) — **closed this session, see "Outstanding: Momentum" below.** No
  "social momentum" signal/screen existed anywhere.
- **Empty-state audit** — **done this session, see "Outstanding: Empty-state audit" below.**

**Verified in a follow-up audit pass (Aug 7 2026, same day, after the initial doc check) — all
seven previously-unconfirmed items now checked, none left unverified**:
- **Community Screen** (#7) — **real gap, closed later this same session — see the section
  below.** `CommunityDetailScreen.js` only tracks a boolean `isCreator` to hide the Join button
  (lines 17, 29) — no members list, no leader/admin badge UI anywhere, even though
  `community_members.role` (`services/communities.js:37`) already stores `'creator'` per member
  (the data exists, the screen just never queries/renders it as a list). "Upcoming Gatherings"
  (lines 144-153) is a flat filtered/sorted list, not a calendar/month-grid view. Both Leaders
  and Calendar are genuinely absent, not just unaudited.
- **Business Profile** (#9) — **real gap, closed later this same session — see the "Outstanding:
  Business Profile" section below.** Traced every tap target that names a business:
  `BrandOffersScreen.js:142` partner name is plain non-tappable `Text`; the only nearby button
  goes to `BusinessConversation` (private chat), not a profile.
  `GatheringDetailScreen.js:295-299`'s Community Perk card shows the partner name as plain
  text too. `BusinessHostBadge.js:26-29` ("🏪 Hosted by {partnerName}") is a static `View` with
  no `onPress` at all. `RootNavigator.js` has no `BusinessProfile`/`PartnerProfile` route —
  only `BusinessDashboard` (owner-only), `BusinessPartnerApply`, `AdminBusinessRequests`,
  `BusinessConversation`. Zero path from any business name to a public profile of that
  business currently exists anywhere in the app.
- **Business Community CRM** (#12) — **partial gap.** Richer than "unconfirmed" suggested:
  `BusinessDashboardScreen.js` has real aggregate analytics — `get_business_dashboard_stats`
  (followers/redemptions + month-over-month via `get_business_growth`, lines 332-370),
  `get_gathering_attendee_breakdown` (new vs. returning attendees per gathering, 117-123/
  430-434), a "Most Engaged" top-members leaderboard via `getBusinessTopMembers` (455-465),
  and `getBusinessVisitFrequency`/top-interests insights (469-494) — all real RPCs, not
  placeholders. What's missing for true CRM depth: the "Most Engaged" rows are static, no
  drill-in to an individual customer's visit history or contact info, and outreach is limited
  to one broadcast "Post Update to Followers" — no per-customer CRM record or targeted
  outreach tool.
- **Rewards** (#11) — **closed this session, see "Outstanding: Rewards" below.** The original
  audit here (grepping for `loyalt|reward.?point|tier|streak|unlock|threshold`, all unrelated
  hits) was accurate — confirmed again via a dedicated research pass before building — zero
  loyalty/points/tier/group-unlock mechanics existed anywhere.
- **Settings** (#16) — **Payments: still a partial gap. Business Mode: the original audit line
  was wrong — closed this session, see "Outstanding: Settings Business Mode link" below.** Real
  sections confirmed in `SettingsScreen.js`: Looking For, Appearance, Language, Notifications,
  Privacy, Discovery Preferences, Account, Connect, Safety, Reflection Tools, Account & Billing,
  Help & Legal. "Account & Billing" (line 814) has exactly one row — "Manage Subscription" →
  `Paywall` — no payment-methods list or billing-history/receipts UI, still a real gap. The
  "no personal/business toggle exists at all" claim was **false** — `ProfileScreen.js:510-520`
  already had a real, fully-wired "🏪 Switch to Business" button (gated on
  `profiles.managed_partner_id`, added `git log`-confirmed **Jul 31 2026, a week before this
  Aug 7 audit**), navigating to `BusinessDashboard`, which itself loads via the caller's own
  `getMyManagedPartner()` — not gated on admin status internally. The audit only ever checked
  `SettingsScreen.js` and never grepped `ProfileScreen.js`, same class of miss this file has now
  caught four separate times (Safety, AI Concierge, Business RPC ownership, now this).
- **Profile** (#5) — **closed this session, see "Outstanding: Memory Vault → Profile link"
  below.** `ProfileScreen.js:432-437` has a real, prominent "📖 View Your Timeline" button
  (`navigation.navigate('Timeline')`) — Timeline is one tap from Profile, satisfies the doc.
  Memory Vault was not linked from Profile at all before this pass — it was only reachable from
  `ChatScreen.js:427` as a per-match "💫 Memory Vault" option, i.e. a per-conversation feature,
  not a profile sub-section. Everything else about Profile already matched the doc — quick-stats
  row, earned stats, achievements grid, photo gallery, prompts, connection-goal chips, full
  identity fields — all real, DB-backed, no placeholders.
- **People Profile** (#8) — **matches doc intent.** `ViewProfileScreen.js` is genuinely
  compatibility/vibe-oriented: a real compatibility %/report (`generateCompatibilityReport()`
  in `services/compatibility.js`, explicitly disabled for friends — "a dating-style
  compatibility score doesn't make sense for a friend's profile"), host stats/reputation via
  the same `get_host_stats`/`get_host_reputation` RPCs used elsewhere, mutual friends, shared
  music/interests. No follower/following counts, no feed layout — nothing resembling a
  generic social-network profile. No fabricated numbers found.

## Outstanding: Consumer Billing screen (closes remainder of roadmap #16 Payments)

Closed the last real piece of roadmap #16: `SettingsScreen.js`'s "Account & Billing" section
had exactly one row ("Manage Subscription" → `Paywall`), with "no payment-methods list or
billing-history/receipts UI" — flagged as a real gap in the Settings audit above and again in
the "Outstanding: Billing / Monetization" section further below (that section is the
**business/partner** side — contracts, invoices, Stripe-not-started — this is the unrelated
**consumer subscription** side, i.e. what a regular user sees about their own Premium plan).

- **Before building anything, checked whether `profiles.is_premium` was even reliable, since a
  local grep found `purchases.js`'s `purchasePackage`/`isPremium`/`restorePurchases` only ever
  read/write RevenueCat's own client-side entitlement state and never touch Supabase at all —
  which would mean a real paying customer's `profiles.is_premium` (the column every actual
  server-side gate reads, e.g. `ai-concierge`'s premium check, the two RLS policies in
  `schema.sql`) could stay permanently `false` even after a successful purchase. **This turned
  out to already be solved**, just not visible locally — same class of miss this file has now
  flagged five separate times (Safety, AI Concierge, Business RPC ownership, Settings Business
  Mode, now this): production already has a `set_premium_status(user_id, new_status)` SECURITY
  DEFINER RPC (granted only to `service_role`/`postgres`, confirmed via the Management API) and
  an already-deployed, active `revenuecat-webhook` Edge Function (`verify_jwt: false`, since
  RevenueCat calls it directly rather than as a user — authenticated instead via a
  `REVENUECAT_WEBHOOK_SECRET` Supabase secret checked against the request's `Authorization`
  header) that correctly maps real RevenueCat webhook events to `is_premium`: grants on
  `INITIAL_PURCHASE`/`RENEWAL`/`UNCANCELLATION`/`NON_RENEWING_PURCHASE`/`PRODUCT_CHANGE`,
  revokes only on `EXPIRATION` (correctly *not* on bare `CANCELLATION`, since a cancelled
  subscriber keeps access until the paid period actually runs out). Neither this RPC nor this
  function exist in local `supabase/schema.sql` or `supabase/functions/` — pulled the real
  source via the Management API's function-body endpoint, same technique used to recover the
  other "empty local stub, real deployed code" functions noted elsewhere in this file. No
  backend work was needed here; this was purely a verification pass that de-risked building UI
  on top of `is_premium` at all.
- New `getSubscriptionDetails()` / `openSubscriptionManagement()` in `src/services/purchases.js`
  — real fields straight off RevenueCat's own `CustomerInfo`/active-entitlement object (active
  status, `store`, `willRenew`, `latestPurchaseDate`, `expirationDate`, `isSandbox`,
  top-level `managementURL`), nothing invented. `openSubscriptionManagement()` prefers
  RevenueCat's own `managementURL` (correct even for non-App-Store/Play-Store cases) and only
  falls back to the plain per-platform subscriptions-page URL `PaywallScreen.js` already used
  when RevenueCat doesn't have one. `PaywallScreen.js`'s own local, now-duplicate
  `openNativeSubscriptionManagement` helper was pointed at this shared function instead of
  keeping a second copy of the same fallback URLs.
- New `src/screens/BillingScreen.js` + `Billing` route (`RootNavigator.js`, same
  `headerShown`/title/style convention as `Rewards`/`Momentum`/`EmergencyContacts`).
  `SettingsScreen.js`'s "Manage Subscription" row now opens this instead of jumping straight to
  `Paywall` — free users still land on a real "Upgrade to Premium" CTA → `Paywall` from here (no
  behavior lost), Premium users instead see real plan detail (since-date, renews/ends date with
  honest "auto-renew is off" wording when `willRenew` is false, which store it's billed through,
  a sandbox/test-purchase flag when applicable) plus working "Manage Subscription" and "Restore
  Purchases" actions.
- **Payment Methods / Billing History — deliberately not built as a data list**, same
  "don't fabricate" convention as the Emergency Contacts and business-billing sections
  elsewhere in this file: this app bills through native in-app-purchase (RevenueCat wrapping
  StoreKit/Play Billing), so Apple/Google hold the actual card and the actual itemized charge
  history — this app never receives either. `BillingScreen` says so plainly in both sections
  and points at the real store subscription page instead of inventing local receipt rows.
- Verified via a full `npx expo export --platform ios` (1838 modules, one more than the prior
  1837 baseline — the new `BillingScreen.js`, everything else is edits to existing files).
- **Not done yet**: no manual run-through in a simulator/device, and specifically — same
  limitation already noted under AI Concierge — this sandbox has no real signed-in premium
  account to exercise the "already Premium" branch against, so the active-subscription
  rendering (dates, store label, manage/restore buttons) is verified by reading the code against
  RevenueCat's real SDK shape, not by an actual live purchase. Next session should check: a free
  account sees "Free plan" + "Upgrade to Premium" → `Paywall`, a real Premium account sees
  correct real dates/store/renewal wording, "Manage Subscription" actually opens the right store
  page, and "Restore Purchases" round-trips correctly on both iOS and Android.

## Outstanding: AI Concierge (closes Phase 5 "AI Concierge" gap)

Closed against the confirmed real gap (a natural-language "find me something tonight" flow),
but built on a corrected premise — see the audit correction above. Discussed the design with
the user first rather than silently bolting this on, since it's the first *new* LLM feature
added this session (even though it turned out not to be the codebase's first ever). Deployed
to production (`enmosvippabmuqslzrox`) and applied there, not just written locally.

- **Found and fixed a live security bug while researching the existing AI pattern**, before
  building anything new on top of it: `check_and_increment_ai_use(user_id_param, daily_limit)`
  — the shared SECURITY DEFINER rate-limit RPC every `generate-*` Edge Function already calls —
  was granted `EXECUTE` to the broad `authenticated` role with no check that the caller owned
  `user_id_param`. Any logged-in user could call it directly with another user's id and burn
  through that account's shared daily AI-use counter (`profiles.ai_uses_today`) — a denial-of-
  service against another user's AI features, not a data leak. Same class of bug as the
  business RPC ownership section above. Fixed in `20260807_ai_use_ownership_check.sql`: added
  an internal `auth.uid() = user_id_param` check (returns `false` rather than raising, matching
  this codebase's "just don't allow it" convention) and revoked `authenticated`/`anon`/`public`
  execute, granting only `service_role` — the only real caller, since every existing
  `generate-*` function invokes it via a service-role admin client, never the user's own
  session. Verified live: re-ran the exact call as a different real profile via
  `set_config('request.jwt.claims', ...)` and confirmed it's now rejected at the grant level
  (`permission denied for function`) before even reaching the new internal check, and confirmed
  a service-role-style call (no JWT claims) still succeeds — the legitimate path is unaffected.
- **New `supabase/functions/ai-concierge/index.ts`**, matching the exact pattern every existing
  `generate-*` function already uses in production (extracted by pulling their real deployed
  source via the Management API's function-body endpoint, since the local stub files are
  empty): verify the bearer token via a service-role `auth.getUser()` call, gate on
  `profiles.is_premium` (matching `generate-icebreaker`/`generate-strengths`/
  `generate-courage-message` — 3 of 4 comparable single-shot "generate something for me"
  features are Premium-gated; only `generate-introduction`, feeding a core compatibility
  report, is not — Concierge fits the majority pattern), call `check_and_increment_ai_use`
  with `daily_limit: 50` (matching the single-shot-feature convention, not the higher 150 used
  by per-message features like `translate-message`/`rehearsal-chat` — this is one shared
  counter across every AI feature, not a per-feature budget, so the number had to match
  existing precedent rather than being invented), then call `claude-haiku-4-5-20251001` (same
  model every other function already uses) with `max_tokens: 600`. Deployed via
  `supabase functions deploy` and confirmed live with `verify_jwt: true` (matching every other
  function — the CLI's default deploy left it `false` on first push; caught by checking the
  live function's settings afterward instead of assuming the deploy command's defaults matched
  convention, corrected via a follow-up Management API `PATCH`).
- **Prompt-injection handling — a real design discussion with the user, not a unilateral
  choice**: gathering/community/perk titles are user-generated text, and this feature (unlike
  the existing `generate-*` functions, which only ever process the *caller's own* profile data)
  processes content written by *other* users, which the requesting user doesn't control. Talked
  through two options: (a) constrain the model to picking ids only, with reason text assembled
  from real signals server/client-side (zero new attack surface, since the model would never
  author displayed text), vs (b) freeform model-written reason sentences (more natural, but the
  model's raw output becomes on-screen text). **User chose (b)** after the tradeoff was
  clarified. Mitigations actually built: only structured, low-risk fields (id/type/title/
  category/time/distance) are ever sent to the model — full descriptions (the richest
  injection vector) are deliberately excluded from the prompt entirely, never sent by the
  client in the first place; all untrusted data is wrapped in explicit `<candidate_data>`/
  `<user_request>` tags with the system prompt stating plainly that content inside is data to
  describe, never instructions to follow; every returned id is re-validated against the real
  candidate set server-side before it's ever returned to the client (an id the model invents or
  hallucinates is silently dropped); every reason string is hard length-capped
  (`MAX_REASON_LENGTH = 220`) regardless of what the model actually returned. **Residual risk,
  stated honestly rather than claimed solved**: this delimiting reduces but doesn't eliminate
  injection risk from candidate titles — a sufficiently crafted gathering title could still
  influence a displayed reason sentence. What meaningfully caps the real-world severity: this
  is React Native, not a webview — `<Text>` renders plain strings with no HTML/script
  execution, so the actual worst case of a successful injection is a misleading sentence
  attributed to the Concierge, never code execution or an unauthorized action (the model has no
  write access or action-triggering capability in this design regardless of prompt content).
- **New `src/services/aiConcierge.js`** (`askConcierge(queryText, location)`) — reuses the same
  already-fetched Discover data sources (`getNearbyGatherings('wide')`, `getPublicCommunities()`,
  `getActiveOffers()`, the same three functions `DiscoverHubScreen.js` already calls) rather
  than new queries, builds the trimmed candidate list client-side, and maps returned picks back
  to the full local objects (so rendering still has real descriptions/photos/etc. — only the
  *prompt* excludes them, not the client's own data). **New `src/screens/AIConciergeScreen.js`**
  + `AIConcierge` route (`RootNavigator.js`) — a single text box, four example-query suggestion
  chips, and a results list (type icon, title, the model's real reason sentence, tap-through to
  `GatheringDetail`/`CommunityDetail`/`BrandOffers`). Reachable from a new "✨ Ask AI Concierge
  what to do" row on `DiscoverHubScreen.js`, directly under its existing search bar. A genuine
  "nothing fit" empty state is shown when the model legitimately returns zero picks, rather
  than hidden or defaulted to something.
- **Not done yet / known verification gap, stated plainly**: unlike every other feature closed
  this session, **the actual Anthropic call path was not exercised end-to-end** — confirmed the
  Edge Function is deployed and its gateway-level `verify_jwt` correctly rejects missing/invalid
  auth (tested directly via `curl`), and confirmed the underlying `check_and_increment_ai_use`
  RPC logic works correctly against real profile rows, but reaching the actual premium-gated
  Anthropic-calling code path requires a real premium user's live session access token, which
  this sandboxed environment has no way to mint (no stored password/credentials for any real
  account; the project's own `review-login` mechanism needs a PIN secret whose plaintext isn't
  retrievable via the Management API). Confidence here rests on matching the already-proven-
  in-production `generate-icebreaker` pattern line-for-line, not on a direct test of this
  specific function's success path. Next session should: run the app as a real Premium account,
  ask the Concierge something with real gatherings/communities/perks nearby, confirm real picks
  with sensible reasons come back and tap-through navigation lands correctly; ask as a
  non-Premium account and confirm the "This is a Premium feature." message surfaces cleanly;
  and confirm hitting the shared daily AI-use cap surfaces the 429 message correctly instead of
  a raw error.

## Outstanding: Settings Business Mode link (closes roadmap #16 Business Mode half)

The real "personal ↔ business" switch already existed before this session (`ProfileScreen.js`'s
"🏪 Switch to Business" button, `managesBusiness` gated on `profiles.managed_partner_id`) — the
roadmap audit's claim that no toggle existed at all was wrong, corrected above. What was
actually missing, confirmed by reading `SettingsScreen.js` directly: its own Business Dashboard
row was gated on `isAdmin` only, with zero awareness of `managed_partner_id` — a non-admin
business owner had no path into their dashboard from Settings at all (Profile was their only
way in), and the "Partner With Us" row always showed the application flow even to someone
who's already an approved partner.

- `SettingsScreen.js` now loads `managed_partner_id` from the same already-fetched `profiles`
  row (`select('*')` at line 80 already returned it — just wasn't read into state) into a new
  `managesBusiness` boolean, mirroring `ProfileScreen.js`'s own naming/pattern exactly.
- The "Partner With Us" row now conditionally renders as "🏪 Manage Your Business" →
  `BusinessDashboard` when `managesBusiness` is true, falling back to the original "Partner With
  Us" → `BusinessPartnerApply` application flow otherwise — so an existing partner is never
  shown an "apply to become a partner" prompt for a business they already run.
  The existing `isAdmin`-gated "Business Dashboard (Admin)" row was left untouched (an admin who
  also happens to manage a business will now see both rows — a minor, acceptable overlap, not a
  new bug — the admin row's own purpose was never about the caller's own business specifically).
- Verified via a babel compile of the touched file and a full `npx expo export --platform ios`
  (1837 modules, unchanged — an edit to an existing file, no new files this pass).
- **Not done yet**: no manual run-through in a simulator/device. Next session should check: a
  regular user sees "Partner With Us" as before, an approved business owner sees "🏪 Manage Your
  Business" and it correctly opens their own dashboard, and an admin who is also a business
  owner sees both rows without confusion.

## Outstanding: Rewards (closes roadmap #11)

Closed against the confirmed real gap: zero loyalty/points/tier or group-unlock mechanics
existed anywhere (re-confirmed via a dedicated research pass before building, not just reused
from the original audit). Design was discussed with the user first — three real decisions
(what earns points, what a tier unlocks, which entities can gate group-unlock) were resolved
before writing any schema, same practice as AI Concierge's prompt-injection discussion above.
Applied to production (`enmosvippabmuqslzrox`) and verified live end-to-end before committing —
not just a schema-shape check.

- **Points/tiers — deliberately the smaller half, no new schema at all.** Points are a live
  count of the caller's own `offer_redemptions` rows (`getMyRewardStatus()` in new
  `src/services/rewards.js`) — RLS already scopes that table's SELECT to `auth.uid() = user_id`
  (the same access `getMyRedemptions()` in `brandOffers.js` already relies on), so no ledger
  table, no `trusted_update`-guarded counter column, no race condition to guard against. Three
  fixed thresholds (Bronze 5 / Silver 15 / Gold 30 redemptions) map to a cosmetic badge only —
  explicitly **not** wired to unlock anything else, per the user's own choice when asked. New
  `src/screens/RewardsScreen.js` + `Rewards` route (`RootNavigator.js`), reachable from a new
  "🎁 Your Rewards" row on `ProfileScreen.js`, same `timelineLink` style as the Momentum/
  Insights/Memory Vault rows above it — a tier card with a progress bar to the next tier, and a
  full tier list with reached/unreached state. **Deliberately not folded into Momentum**
  (attendance streaks/deltas) even though both are "derived signal, no fabrication" features —
  keeping Rewards scoped to perks specifically avoids two screens reading the same underlying
  rows into two different-shaped numbers; this was an explicit tradeoff surfaced to the user
  before building, who chose to keep the scope narrow.
- **Group-unlock** (`20260807_rewards_group_unlock.sql`): `brand_offers` gained
  `unlock_scope` (`'community' | 'gathering' | null`), `unlock_community_id` (new FK to
  `communities`), and `unlock_min_members` — null/null/null on every pre-existing row, fully
  backward compatible. A `'gathering'`-scoped offer reuses the *existing* `gathering_id` column
  already on `brand_offers` (the one that powers gathering-tied "Community Perk" offers) rather
  than adding a second FK — a gathering-linked offer just optionally also gets a real minimum-
  approved-attendee gate. A `brand_offers_unlock_shape_check` constraint keeps the three columns
  internally consistent (scope requires its threshold and its matching linked id) so a malformed
  row can't be inserted even outside the app. **Enforced server-side, not just in the UI**: a new
  `enforce_offer_unlock_threshold()` BEFORE INSERT trigger on `offer_redemptions` counts real
  `community_members` rows (community scope) or real `gathering_interest.status='approved'` rows
  (gathering scope) and raises `'OFFER_LOCKED'` if the count is under threshold — the same
  recognizable-error-message pattern `redeemOffer()`'s callers already handle for
  `ALREADY_REDEEMED`/`REDEMPTION_LIMIT_REACHED`, so both `BrandOffersScreen.js` and
  `BusinessProfileScreen.js` now catch it with a clear "needs more people to join first" message
  instead of a raw error. Both screens also show live unlock progress ("6/10 members joined")
  and swap the redeem button for a disabled "Locked" state while the threshold isn't met, reusing
  `getCommunityMemberCount()` (already existed, `communities.js`) and a new
  `getApprovedAttendeeCount()` (`gatherings.js`, same one-line `count`-only pattern). Businesses
  set the threshold when creating an offer (`BusinessDashboardScreen.js`'s create-offer modal
  gained a group-unlock toggle — a community picker with real member counts for standing offers,
  or a plain attendee-count input for offers attached via the existing "+ Attach Reward" flow on
  a specific gathering).
- **While building this, found the "+ Attach Reward" gathering-offer flow had never actually
  been wired to a picker** — `offerGatheringId` state existed and was passed through to
  `createBusinessOffer()`, but the only way it was ever set was the per-gathering "+ Attach
  Reward" button already in the Gatherings tab (`BusinessDashboardScreen.js:441-450`, pre-
  existing, unmodified) — there was never a bare "pick any gathering" dropdown in the general
  "+ Create Offer" modal. Not a bug — the attach-from-the-gathering-row flow is a complete, real
  path — but worth noting so a future session doesn't assume a picker is missing and add a
  redundant one.
- **Verified live end-to-end before committing, not just schema application**: created real
  test offers/communities/redemptions against production
  (`brand_partners` row `Coastal Coffee`, `67dd3d6d-f36b-4b20-8a80-ac980baecc30`, the same test
  partner used by the billing section below) and confirmed via direct SQL — a gathering-scoped
  offer's redemption is genuinely rejected (`OFFER_LOCKED`) when the real approved-attendee count
  is under threshold and genuinely succeeds once it's met; same for a community-scoped offer
  after adding a second real `community_members` row; the `brand_offers_unlock_shape_check`
  constraint genuinely rejects an inconsistent insert (scope set without its matching id); and
  `getMyRewardStatus()`'s RLS-scoped count genuinely returns 5 (crossing into Bronze) for a
  profile with 5 real redemptions and genuinely returns 0 for a different profile querying at the
  same time — confirmed the isolation, not just the happy path. All test data (offers,
  redemptions, one test community) deleted afterward; production is back to its pre-test state
  (this project has almost no real data yet — 0 communities, 0 offers, 1 partner, 4 profiles at
  the time of this pass, so every scenario above had to be constructed, not found).
- **Not done yet**: no manual run-through in a simulator/device. Next session should check:
  creating a standing offer with a community-unlock threshold and a gathering-attached offer with
  an attendee-count threshold from the dashboard, that both correctly show live progress and a
  disabled "Locked" state on `BrandOffersScreen`/`BusinessProfileScreen` before their threshold is
  met and unlock in real time after it's crossed, and that the Rewards screen renders correctly
  for a brand-new account (no tier yet, 5-to-go progress bar) versus one with real redemption
  history.

## Outstanding: Friend Circles (closes Phase 5 "Friend Circles" gap)

Closed against the confirmed real gap: `FriendsScreen.js` was a flat list with no grouping
concept (Work/Fitness/Family/Travel) anywhere in the schema or UI. This is real, useful,
no-invented-signal work — unlike AI Concierge/Momentum below, nothing here needed an LLM call
or a fabricated metric, so it was built directly instead of flagged for a separate review.
**This was the change in progress when the codespace restarted mid-session** — found
`src/services/friendCircles.js` (new) and a modified `src/screens/FriendsScreen.js` already
finished but uncommitted, plus an unapplied `20260807_friend_circles.sql`. Verified and
committed this session, not written from scratch.

- New `friend_circles`/`friend_circle_members` tables (`20260807_friend_circles.sql`) — a join
  table, not a column on friendships, since one friend can belong to several circles (e.g.
  "Work" and "Fitness" at once) and a circle only ever makes sense relative to its owner's own
  friend list. `friend_user_id` is intentionally not constrained to an existing friendship row —
  a lightweight personal label, not a second relationship table to keep in sync. RLS on
  `friend_circles` is the standard `auth.uid() = user_id` owner-only shape; `friend_circle_members`
  is owned indirectly through its parent circle's `user_id`, the same indirect-ownership pattern
  already used elsewhere in this schema for join/detail tables. **Found already applied to
  production** (`enmosvippabmuqslzrox`) from before the restart — confirmed live via the
  Supabase Management API rather than re-applying blind (a second `create table` would have
  errored, which is how this was caught). Re-verified the live column list and both RLS
  policies match the migration file exactly, then independently re-proved the isolation
  end-to-end via `set_config('request.jwt.claims', ...)` as two different real profile rows: user
  A can create a circle and add a member, user B genuinely gets zero rows back querying that
  circle by id directly.
- `src/services/friendCircles.js` — plain CRUD (`getMyCircles`/`createCircle`/`deleteCircle`/
  `addFriendToCircle`/`removeFriendFromCircle`), no RPCs needed since ownership is fully covered
  by RLS. `getMyCircles()` embeds `friend_circle_members(friend_user_id)` in one query rather
  than a second round trip, mapped down to a flat `memberIds` array per circle.
  `addFriendToCircle` swallows Postgres `23505` (unique-violation) so re-adding an already-
  present member is a harmless no-op instead of a thrown error.
  **Deliberately not a member-limit-enforcing feature** — no cap on circle count or members per
  circle, matching this schema's general lack of arbitrary limits elsewhere.
- `FriendsScreen.js` gained a horizontal "Circles" chip row (tap to filter the friends list to
  that circle, long-press to delete with a confirm alert), a "+ New Circle" chip opening a
  create-name modal, and a 🏷️ tag icon per friend row opening a manage-membership modal
  (checkbox-style toggle per circle). No new route/screen — everything is inline on the
  existing `Friends` route, since circles are a lens over the same friends list, not a
  separate surface. The chip row and tag icon are both conditionally rendered (only when
  circles/friends exist) so a user with none sees the screen exactly as before.
- Verified via a full `npx expo export --platform ios` (1831 modules, one more than the prior
  1830 baseline — the new `friendCircles.js`), not yet a simulator/device run.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check:
  creating a circle, adding/removing friends via the tag icon, filtering by a circle chip,
  long-press delete, and that a brand-new user with zero circles sees an unchanged screen.

## Outstanding: Momentum (closes Phase 5 "Momentum" gap)

Closed against the confirmed real gap: no "social momentum" signal or screen existed anywhere.
Built as a purely real, derived signal — no fabricated score, same "no invented numbers"
convention as `homeDashboard.js`'s `bestPick`/`weeklyRecap` and `insights.js`'s whole premise.
Deliberately not a single composite "momentum score" (0-100, etc.) — this codebase has never
invented a blended metric like that anywhere else, so Momentum instead surfaces two honest,
separately-real signals: a weekly activity streak and month-over-month deltas.

- New `src/services/momentum.js` — `getMomentumStats()`. No new tables/RPCs; reads the same
  tables/columns already trusted elsewhere (`gathering_interest.status='approved'` joined to
  `gatherings.scheduled_at`, `gatherings.host_id`, `friendships.status='accepted'` via the same
  `user_a`/`user_b` `.or()` pattern `friends.js` already uses, `community_members.joined_at`),
  fetched once each from the earlier of an 8-week or two-month lookback, then bucketed
  client-side two ways:
  - **Weekly streak**: 8 weekly buckets (attended-or-hosted count per week), `currentStreak` =
    consecutive weeks counting back from the current week with at least one real gathering.
    A quiet week breaks the streak back to 0 — no grace period, no fabricated "streak freeze"
    mechanic.
  - **Month-over-month deltas**: real counts of gatherings attended, new (accepted) friends,
    and communities joined, this calendar month vs. last calendar month, computed from the same
    fetched rows (no extra queries) — an honest "▲/▼/—" per line, no percentage-change math
    invented on top.
- New `src/screens/MomentumScreen.js` + `Momentum` route (`RootNavigator.js`), reachable from a
  new "🔥 Your Momentum" row on `ProfileScreen.js`, same `timelineLink` style as the
  Timeline/Memory Vault/Insights rows above it. A streak card (🔥 with the week count, or 🌱
  "no active streak yet" at zero — an honest zero-state, not hidden), an 8-bar weekly mini
  chart (own lightweight bars, not a charting library — matches this codebase's existing
  hand-rolled bar style from `InsightsScreen.js`'s vibe breakdown), and a delta card for the
  three this-month-vs-last-month lines.
- Verified end-to-end against the live production schema (`enmosvippabmuqslzrox`) before
  committing: ran each of the four underlying query shapes directly via
  `set_config('request.jwt.claims', ...)` as a real profile — confirmed a user with genuine
  past attended/hosted gatherings and an accepted friendship gets real rows back, and a user
  with zero community memberships gets a real empty array (exercising the chart's zero-state
  path honestly rather than assuming it). Verified via a full `npx expo export --platform ios`
  (1833 modules, two more than the prior 1831 baseline — the two new files), not yet a
  simulator/device run.
- **Deliberately not built**: a "longest streak ever" record, streak-loss notifications/nudges,
  or any cross-user comparison ("you're more active than 80% of users") — the last one in
  particular would need either a fabricated percentile or a new aggregate query across every
  user, out of scope for a first pass and not asked for.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check: an
  established account (real streak, real bar chart, real deltas), a brand-new account (zero
  everywhere — streak card should read "no active streak yet", chart should show its empty
  state, delta card should show real 0s with `—` symbols, not blank/hidden sections), and that
  the streak correctly breaks to 0 after a genuinely quiet week rather than persisting.

## Outstanding: Memory Vault → Profile link (closes roadmap #5 partial gap)

This is the change that was in progress when the codespace restarted mid-session (found
`src/services/memoryVault.js` modified but uncommitted, with a finished but unwired
`getMyMatchesWithMemoryCounts()` already written). Finished and committed this session.

- Memory Vault is per-match (`memory_vault_items.match_id`), so there's no single "your"
  vault to deep-link Profile straight into — `getMyMatchesWithMemoryCounts()` in
  `services/memoryVault.js` instead returns every match the caller has, each with a real
  per-match memory count, mirroring how Timeline is reached from Profile as an aggregate
  view rather than a single record. Query intentionally has no explicit `user_a`/`user_b`
  filter — same pattern already used by `MatchesScreen.js`, safe because `matches` RLS
  (`supabase/schema.sql`) already scopes SELECT to rows where the caller is `user_a` or
  `user_b`; confirmed by reading the policy directly rather than assuming.
- New `src/screens/MemoryVaultIndexScreen.js` + `MemoryVaultIndex` route
  (`RootNavigator.js`) — a simple list of matches (avatar via the existing
  `getSignedPhotoUrl`, same pattern as `MatchesScreen.js`) each showing its real memory
  count, tapping through to the existing per-match `MemoryVaultScreen` (unchanged) with
  `matchId`/`matchName`, the same params `ChatScreen.js`'s entry point already passes.
  Real empty state included ("No matches yet...") rather than left blank.
- `ProfileScreen.js` gained a "💫 Memory Vault" row directly under the existing "📖 View
  Your Timeline" link, same `timelineLink` style reused rather than a new one invented,
  navigating to `MemoryVaultIndex`.
- Verified via a full `npx expo export --platform ios` (1826 modules, one more than the
  prior 1825 baseline — the new screen file), not yet a simulator/device run.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check
  the list renders real matches/counts, tapping through opens the right per-match vault,
  and the zero-matches empty state.

## Outstanding: Insights screen (closes roadmap #13)

Closed against the confirmed real gap: no dedicated Insights screen existed, real stats
were scattered inside `ProfileScreen.js` (`getProfileQuickStats`/`getEarnedProfileStats`).
Verified via a full `npx expo export --platform ios` (1828 modules, two more than the prior
1826 baseline — the new `InsightsScreen.js` + `insights.js`), not yet a simulator/device run.

- New `src/services/insights.js` — `getInsightsStats()` is purely an aggregator, no new
  queries beyond one extra: reuses `getProfileQuickStats()`/`getEarnedProfileStats()`/
  `getAchievements()` as-is, adds `hostedCount`/`communitiesCreated`/`memberSince` (each a
  single real count/column already used elsewhere in this file, e.g. `getAchievements`'s own
  internal `hostedCount` query, just now also returned instead of staying internal), and a
  `vibeBreakdown` — real per-`interest_tag` counts across the caller's own past approved
  `gathering_interest` rows, same source table `getEarnedProfileStats`'s `favoriteVibe` already
  reads, just kept as a full breakdown instead of collapsed to the single top tag.
- New `src/screens/InsightsScreen.js` + `Insights` route (`RootNavigator.js`), reachable from
  a new "📊 Your Insights" row on `ProfileScreen.js`, same `timelineLink` style as the Timeline
  and Memory Vault rows added directly above it. Shows: a stat grid (gatherings attended/
  hosted, communities joined, friends made), favorite vibe/usually-active (same earned-stats
  cards already on Profile), a "what you've been up to" bar breakdown per category using the
  existing `categoryStyleFor()` icons/colors, and the full achievements grid — unlike
  Profile's grid (earned-only), this one also renders locked achievements at reduced opacity
  so there's an honest "N/total" count, since every achievement's earn condition is already a
  real, non-fabricated threshold (`getAchievements()`'s own existing convention).
- **Not done yet**: no manual run-through in a simulator/device. Next session should check a
  new-user account (all-zero/empty state, no vibe breakdown, no achievements) and an
  established account with real history render correctly.

## Outstanding: Emergency Contacts (closes remainder of roadmap #15)

As covered in the audit correction above, the date safety check-in flow itself already
existed (`date_checkins`, `services/dateSafety.js`, `DateCheckInModal.js`) — this pass only
needed to add a persistent emergency contact and wire it in. Applied to production
(`enmosvippabmuqslzrox`) and verified live via the Supabase Management API (table + RLS
policy confirmed to exist, matching `date_checkins`' own owner-scoped policy shape exactly).
Verified via a full `npx expo export --platform ios` (1830 modules, two more than the prior
1828 baseline), not yet a simulator/device run.

- New `emergency_contacts` table (`20260807_emergency_contacts.sql`): `id`, `user_id`, `name`,
  `phone`, `relationship` (nullable), `created_at`. One RLS policy, `for all using (auth.uid()
  = user_id)` — same shape as `date_checkins`' existing "Users manage their own check-ins"
  policy, this codebase's established pattern for a personal-safety table with no need for a
  separate WITH CHECK clause.
- New `src/services/emergencyContacts.js` (`getMyEmergencyContacts`/`addEmergencyContact`/
  `deleteEmergencyContact`) + `src/screens/EmergencyContactsScreen.js` (add/list/remove),
  reachable from a new "🛡️ Emergency Contacts" row in `SettingsScreen.js`'s existing Safety
  section, alongside Blocked Users/Verify Identity.
- **The check-in flow itself now uses the saved contact**: `DateCheckInModal.js` gained a
  `shareWithContact()` helper — when a contact is saved, "Set Up Check-In & Share Plans",
  "📍 Share My Location Now", and the live-tracking share link now all open the device's own
  SMS composer pre-addressed to that contact (`Linking.openURL('sms:...')`, checked with
  `Linking.canOpenURL` first) instead of the generic OS share sheet requiring the user to pick
  a recipient fresh each time. Falls back to the original `Share.share()` behavior if no
  contact is saved or `sms:` can't be opened (e.g. a device with no SMS capability), so nothing
  regresses for a user who hasn't set one up. When no contact exists, the modal shows an inline
  "add one →" link straight to the new Settings screen. `DateCheckInModal` gained an optional
  `navigation` prop for this (wired from its one real caller, `ChatScreen.js`); the link simply
  doesn't render if it's omitted, so nothing breaks for a hypothetical caller that doesn't pass
  one.
- **Deliberately not built**: any automatic/backend-triggered alert to the emergency contact
  (e.g. auto-texting them if the user doesn't check in by the scheduled time). This app has no
  SMS/email-sending infrastructure at all — grepped for `twilio`/`resend`/`sendgrid`/`smtp` in
  both `src/` and `supabase/`, zero hits; the only outbound-delivery mechanism that exists is
  Expo push notifications to devices already running this app, which an emergency contact who
  isn't a Nearby user can't receive. Building real automatic delivery needs a new third-party
  integration (its own API key, account, cost) and is a materially different, more sensitive
  feature — same treatment as the Stripe billing gap elsewhere in this file, not something to
  fake by silently only-notifying-if-the-contact-happens-to-have-the-app.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check:
  adding/removing a contact, that the SMS composer actually opens pre-addressed and pre-filled
  on a real device (the `sms:` deep link can't be verified from this sandboxed environment),
  and that the share-sheet fallback still works with zero contacts saved.

## Outstanding: Unified Map (closes roadmap #10, partially — see below)

Closed as far as this codebase's own privacy/data conventions honestly allow. Verified via a
full `npx expo export --platform ios` (1830 modules — unchanged from the prior baseline, since
this pass only edited existing files, no new ones). Not yet a simulator/device run.

- **Businesses layer**: new `getNearbyBusinesses()` in `services/brandOffers.js` — every
  active `brand_partners` row with real coordinates, not just ones currently running an offer
  (previously the map only ever showed a business indirectly, via a deal pin). No new RPC:
  `brand_partners`' existing RLS (`Anyone can view active partners`, `using (active = true)`)
  already makes every active business's row, including its real lat/lng, fully public — same
  "legitimate public business location" justification `GatheringsMapView.js`'s own existing
  comment already gives for deal pins. Distance filtering is a plain client-side approximation
  (equirectangular, not full haversine — plenty accurate at the 50-mile radius this uses) since,
  unlike gatherings/offers, there's no private coordinate here that needs to stay server-side.
  `GatheringsMapView.js` gained a `businesses`/`onSelectBusiness` prop pair (both optional,
  default empty/no-op, so `GatheringsScreen.js`'s existing use of the same component is
  unaffected), rendering a 🏪 pin that opens the `BusinessProfileScreen` built earlier this
  session. Wired into `DiscoverHubScreen.js`'s map view, shown alongside deals under the same
  Perks/All filter scope.
- **Live activity layer**: gatherings whose `scheduled_at` falls in the same "happening now"
  window Home's own `getHomeDashboard()` already uses ([-30min, +2h] of now) now render with a
  red pin and a "🔴 LIVE NOW" callout badge instead of their normal category color. Reuses the
  same signal, not a new one — inherits that function's one known limitation (the underlying
  `getNearbyGatherings()` query itself excludes anything with `scheduled_at` already in the
  past, so in practice this can only ever flag a gathering about to start within 30 minutes,
  never one that's been running for up to 2 hours — a pre-existing gap in Home's own
  `happeningNow`, not something newly introduced here; left as-is rather than changing a
  query several other features already depend on, out of scope for this pass).
- **People were deliberately not added, and this is a hard privacy constraint, not just an
  unbuilt feature.** Checked `services/proximity.js` directly: this app never gives the client
  another person's coordinates, not even fuzzed — "crossed paths" is computed entirely
  server-side by comparing coarse rounded-location buckets via the `report-presence` Edge
  Function, and `profiles` itself has no lat/lng column at all (already confirmed in the
  Gathering Hub section above, re-confirmed here). There is no real coordinate anywhere in this
  codebase to honestly plot for an individual person. Same reasoning the Gathering Hub section
  already used to reject a GPS-based "Live Mode."
- **Communities were deliberately not added either — no fabrication, just no real data.**
  Checked `services/communities.js`: communities have no location field anywhere in the schema.
  They're topic-based, not place-based, so there's no real coordinate to plot — inventing one
  (e.g. centroid of members' fuzzed areas) would mean fabricating a signal this app has
  otherwise been careful never to invent.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check the
  businesses layer renders alongside deals without visual overlap/clutter in a dense area, the
  live-now badge (may need to manually create a test gathering scheduled a few minutes out to
  actually observe it, given the window-timing limitation above), and that tapping a business
  pin correctly opens its `BusinessProfileScreen`.

## Outstanding: Empty-state audit (closes the roadmap doc's closing suggestion)

Grepped every one of the 67 files in `src/screens/` for existing empty-state handling
(`empty`/`.length === 0`/"nothing found"/"no ... yet"/"none yet" patterns) to separate real
gaps from screens that already had something. Verified via a full `npx expo export --platform
ios` (1830 modules, unchanged — one file edited, no new files). Not yet a simulator/device run.

- **Result: most major user-facing screens already had a real empty state** — Home ("Quiet
  night nearby"), Discover, Gatherings, Matches, Inbox, Notices, Communities, Friends,
  Activity, Timeline, Places (already flagged in this file as the one known example), Brand
  Offers/Perks, Discovery — all genuine, pre-existing, not fabricated for this pass. The
  original audit line above assumed "most are unaudited" without actually checking; that
  assumption was wrong, same class of miss as the Safety section's correction above.
- **Two real, silent gaps found and fixed**, both in `CommunityDetailScreen.js` (built earlier
  this session, in the Community Leaders + Calendar pass): the "Leaders & Members" and
  "Upcoming Gatherings" sections were each guarded by `.length > 0` with no `else` — a brand
  new or quiet community would show neither section at all, with nothing telling the viewer
  why. Both now render their header plus a real, honest one-line message ("No members to show
  yet." / "Nothing on the calendar yet — be the first to plan something.") when empty, instead
  of silently vanishing.
- **Deliberately left alone**: many other screens (`GatheringDetailScreen.js`'s "Who's Going",
  `BusinessProfileScreen.js`'s perks/photos/reviews sections, etc.) also render nothing when
  their underlying data is empty — but this is this codebase's own established, repeated
  convention (e.g. `getHostLovedTags()`'s doc comment: "correctly renders as nothing for a new
  host with no feedback yet"), not an oversight. Adding a generic "nothing here yet" banner to
  every one of those would go against a pattern the codebase has consistently and intentionally
  chosen elsewhere. Only touched the two cases above, where the missing section had a
  persistent, expected header a user would otherwise wonder had disappeared.
- **Not exhaustively covered**: admin-only screens (`AdminReportsScreen.js`, etc.), one-off
  relationship tools (`RehearsalRoomScreen.js`, `StressTestScreen.js`, etc.), and pure forms
  (`CreateGatheringScreen.js`, `EditGatheringScreen.js`, onboarding) were intentionally not
  audited — they're either low-traffic, admin-facing, or have no empty-list concept to begin
  with, not "major screens" in the roadmap doc's sense.

## Outstanding: Business Profile (public-facing screen, closes roadmap #9)

Closed against the confirmed real gap from the audit above: no public-facing business profile
existed anywhere — every tap target naming a business (offer cards, gathering "Community Perk"
badges, `BusinessHostBadge`) was either static text or routed straight to a private chat. Core
build is done and committed; **not yet manually tested in a running app** — verified via
`@babel/core` compile of every touched file and a full `npx expo export --platform ios` (1824
modules, one more than the prior clean 1823-module baseline), not a simulator/device run.

- New `src/screens/BusinessProfileScreen.js` + `BusinessProfile` route (`RootNavigator.js`,
  `headerTransparent` matching `GatheringDetail`/`CommunityDetail`'s convention), reachable from
  five places that previously dead-ended or had no path at all: `BrandOffersScreen.js`'s
  logo/partner-name block (was plain text), `GatheringDetailScreen.js`'s Community Perk card's
  "at {partner}" line (was plain text), `BusinessHostBadge.js` (gained an optional `navigation`
  prop — wraps itself in a `TouchableOpacity` only when passed one, so any caller that omits it
  keeps the old static badge; wired from both its actual callers, `GatheringsScreen.js` and
  `CommunitiesScreen.js`), `CommunityDetailScreen.js` (added a "View Business Profile →" link
  next to the existing follow-business button, for communities backed by a business), and
  `ActivityScreen.js`'s business-update notice rows (were a plain, non-tappable `View`;
  `getFollowedBusinessUpdates()`'s select gained `partner_id` since it wasn't being fetched
  before, so there was nothing to navigate with).
- Real data only, no fabricated fields:
  - **Header**: `brand_partners.name`/`logo_url`/`description`/`address` (all pre-existing
    columns), plus a real follower count pulled from `get_business_dashboard_stats` — only
    `total_followers` is used from that RPC's response; its redemption-count/repeat-redeemer
    fields are the owner's own business-performance metrics and were deliberately left off a
    page any regular user can browse to, even though the RPC itself has no ownership check
    (grants execute to `authenticated`, not scoped to the caller — confirmed live via the
    Supabase Management API, `pg_get_functiondef`).
  - **Follow/Message**: reuses `isFollowingBusiness`/`followBusiness`/`unfollowBusiness` and
    routes Message to the existing `BusinessConversation` screen — no new mechanism.
  - **"What People Say"**: new `getBusinessLovedTags()`/`getBusinessReputation()` in
    `services/gatherings.js`, the exact same honest-aggregate pattern `getHostLovedTags()`/
    `get_host_reputation` already established for individual hosts (welcoming %, would-attend-
    again %, categorical "what people loved" tags from `gathering_feedback.great_because`) —
    just keyed on `gatherings.hosting_partner_id` instead of `host_id`, since a business isn't a
    `profiles` row and the existing per-host RPCs can't take a partner id. Computed client-side
    rather than as a new RPC (`gathering_feedback` is already publicly SELECTable, same
    justification the original per-host comment gives). Renders nothing until a business has at
    least one review — same "no feedback yet" convention as the individual-host version.
  - **Perks**: new `getBusinessActiveOffers()` in `services/brandOffers.js` — standing
    (non-gathering-tied) active offers for that partner, with real scarcity counts
    (`getRedemptionCounts`) and a working redeem button (`redeemOffer()`, same function
    `BrandOffersScreen` uses) — not a read-only preview.
  - **Upcoming Gatherings**: new `getBusinessPublicGatherings()`, deliberately filtered to
    `is_public: true` — a business's private/women-only gatherings (if any exist) don't leak
    onto a page anyone can browse to, unlike the owner-only `getMyBusinessGatherings()` (left
    untouched) which correctly shows everything to the owner.
  - **Photos**: no photo-gallery field exists on `brand_partners` (only `logo_url` — confirmed
    live via `information_schema.columns`), so rather than fabricate one, this pulls real
    `cover_photo_path` images from the business's own upcoming gatherings (via the existing
    `getSignedGatheringPhotoUrl()`, same signed-URL pattern already used everywhere else cover
    photos are shown) — genuine sourced content, not an invented upload feature.
- **Deliberately not built**: `get_business_top_members` (a real, pre-existing RPC already used
  by the owner's dashboard) returns named individuals' `display_name` + attendance counts —
  fine for an owner's own dashboard, not something to surface to arbitrary browsing users, so it
  was excluded from this public screen even though the RPC itself has no ownership gate. A true
  per-customer CRM view, and actually locking down the owner-facing business RPCs to check
  `managed_partner_id` server-side (several — `get_business_dashboard_stats`, `_growth`,
  `_top_members`, `_visit_frequency`, `_insights` — currently trust the caller-supplied
  `partner_id_param` with no ownership check, grants execute to any `authenticated` user), are
  both separate, more sensitive changes — not attempted here, flagged for a future security pass
  since it's a real gap between "no client currently calls this except the owner's own screen"
  and "actually enforced." **Both closed later this same session — see the section immediately
  below.**
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through all five entry points, confirm follow/unfollow and redeem actually round-trip, and
  check both a business with no reviews yet (section should render nothing) and one with real
  `gathering_feedback` data.

## Outstanding: Business RPC ownership check (security fix) + CRM member drill-in (closes #12 partial gap)

Closed the security gap flagged in the section above, then built on top of the now-locked-down
functions to close the rest of roadmap #12 (Business Community CRM). Applied to production
(`enmosvippabmuqslzrox`) and verified live via the Supabase Management API — both the
`profiles.managed_partner_id = auth.uid()`'s row ownership predicate and `auth.uid()` itself
resolving correctly from `set_config('request.jwt.claims', ...)` were confirmed directly (the
underlying tables have zero real follower/redemption/attendee rows yet in production, so the
functions' actual outputs read as zero for both an owner and non-owner right now — the ownership
*predicate* itself was verified independently since the data can't yet distinguish the two).
Frontend changes verified via `@babel/core` compile and a full `npx expo export --platform ios`
(1824 modules, same count as the Business Profile pass — no new files this time, edits only).

- **Security fix** (`20260807_business_rpc_ownership_check.sql`): `get_business_dashboard_stats`,
  `get_business_growth`, `get_business_top_members`, `get_business_visit_frequency`, and
  `get_business_insights` were all SECURITY DEFINER functions granted to any `authenticated`
  user with no check that the caller actually owned `partner_id_param` — `BusinessDashboardScreen.js`
  only ever calling them with the caller's own `managed_partner_id` was a UI convention, not real
  access control. `get_business_top_members` in particular returns named individuals'
  `display_name` + attendance count, so this was a real PII leak: any logged-in user who knew or
  guessed a `partner_id` could pull another business's follower/redemption counts and top-
  attendee list. Each function now checks `exists (select 1 from profiles where id = auth.uid()
  and managed_partner_id = partner_id_param)` up front and returns empty/zero/null instead of
  raising, matching this codebase's existing RLS convention of "just don't show it" rather than
  leaking existence via an error message.
- Since `get_business_dashboard_stats`'s `total_followers` was the one piece of that data
  legitimately shown on the public `BusinessProfileScreen` (added earlier this session), a new,
  deliberately narrow `get_business_follower_count(partner_id)` was added alongside — public-safe,
  no ownership check, returns only a count, no revenue/attendee data. `getBusinessFollowerCount()`
  in `services/brandOffers.js` now calls that instead.
- **CRM member drill-in** (closes the rest of #12): new `get_business_member_gathering_history()`
  RPC (same ownership check, owner-only) plus `getBusinessMemberGatheringHistory()` in
  `services/brandOffers.js`. `BusinessDashboardScreen.js`'s "Most Engaged" list rows are now
  tappable — expanding a member shows their real per-gathering visit history at this business
  (title + date, sourced from the same `gathering_interest`/`gatherings` join the leaderboard
  itself already uses) and a "💬 Message" link that opens the existing inbox conversation UI
  (`openConversation()`, reused as-is) pre-targeted at that member, including members with no
  prior conversation — real targeted outreach, not just the existing mass-broadcast "Post Update
  to Followers." This was the specific gap the earlier audit called out: "no per-customer CRM
  record, no drill-down... outreach is limited to one broadcast."
- **Deliberately not built**: a persistent CRM record (notes/tags/contact history stored against
  a member beyond what's derivable from real attendance data), and per-customer analytics beyond
  visit history (e.g. lifetime redemption value) — both would need new schema, and nothing here
  needed one; this stays within "real data, better surfaced," the same bar as everything else in
  this file.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through: expand a top-member row (visit history renders, or an empty state if the RPC legitimately
  returns nothing), tap Message on a member with no prior conversation and confirm it opens a
  blank thread correctly, and confirm a non-owner account calling these RPCs directly (e.g. via
  a manually crafted request) genuinely gets zero/empty back now.

## Outstanding: Community Leaders + Calendar (closes roadmap #7)

Closed the confirmed real gap from the audit: no members list, no leader/admin concept
surfaced anywhere, and "Upcoming Gatherings" was a flat list with no calendar view. Applied to
production and verified via `@babel/core` compile + a full `npx expo export --platform ios`
(1825 modules, one more than the prior 1824 — the new `CommunityCalendar.js` component).

- **Leaders**: `community_members.role` already distinguished `'creator'` from `'member'`, but
  nothing let a creator designate a leader, and there was no UPDATE policy or RPC on
  `community_members` at all. New `set_community_member_role()` SECURITY DEFINER RPC
  (`20260807_community_leaders.sql`) — checks the caller is the community's own creator, that
  the target member exists and isn't the creator, then updates their role to `'leader'` or back
  to `'member'`. `CommunityDetailScreen.js` gained a real "Leaders & Members" section
  (`getCommunityMembers()`, new in `services/communities.js`) with avatars, role badges, and — 
  creator view only — a "Make Leader"/"Remove Leader" toggle per member. RLS on
  `community_members` only shows the full roster for public communities or to the creator (a
  regular member of a private community only sees their own row) — that's an existing, real
  privacy constraint from the schema, left as-is; the new members list just renders whatever RLS
  actually returns rather than working around it.
- **Calendar**: new `src/components/CommunityCalendar.js` — a real month grid (prev/next month
  nav, dots on days with an actual `scheduled_at` gathering, tap a day to filter), not a
  relabeled list. `CommunityDetailScreen.js` gained a List/Calendar toggle above "Upcoming
  Gatherings"; List mode is unchanged from before, Calendar mode shows the grid and filters the
  list below to the tapped date.
- **Caught and fixed my own mistake while applying this**: the new `set_community_member_role`
  RPC (and, on review, the two new RPCs from the section above —
  `get_business_follower_count`/`get_business_member_gathering_history`) were only revoked
  `from public`, not `from public, anon` — this file's own "Known conventions" section has
  always said to revoke from both. Postgres/Supabase's default-privileges setup grants new
  functions execute directly to the `anon` role (not just via the `PUBLIC` pseudo-role), so
  `revoke ... from public` alone left all three callable by a fully unauthenticated caller.
  Caught by re-checking `has_function_privilege('anon', ...)` after applying instead of assuming
  the revoke worked; fixed live via a follow-up `revoke ... from anon` and corrected in both
  migration files so a fresh apply gets it right the first time. None of the three leaked data to
  an anon caller in practice (each still checks `auth.uid()`-based ownership internally, and an
  anon session has no matching row), but it violated defense-in-depth and this file's own stated
  rule, so worth being explicit about here rather than quietly folding the fix in.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through: promote/demote a member as the creator (and confirm a non-creator genuinely can't,
  even by calling the RPC directly), toggle List↔Calendar, tap a day with a dot and confirm the
  list below filters correctly, and check a private community as a non-creator member (should
  only see your own row in the members list — confirm that reads as reasonable, not broken).

## Outstanding: Discover mini-app (unified search/filter/map/list + recommendations)

Closed against a user-pasted external roadmap doc (Aug 7 2026) that prioritized "Discover" as
the single biggest remaining screen — a search/filter/People/Gatherings/Communities/Places/
Perks/map-list-card/AI-recommendations mini-app. Before building, checked that doc against the
actual repo state and found most of its other "build next"/"phase 2/3/5" items (Gathering
Detail, Gathering Hub, Inbox, Profile/"You", Community screens, Rewards/billing, even Timeline/
Memory Vault) already built and committed — the doc was stale. Discover was correctly identified
as the one real gap: `DiscoverHubScreen.js` was a thin 2-card router (Meet People → `Nearby`,
Gatherings → `Gatherings`) plus a stories carousel, not a browsable/searchable surface. **Core
build is done and committed; not yet manually tested in a running app** — same caveat as every
other entry in this file: verified via `@babel/core` compile of both touched files and a full
`npx expo export --platform ios` (1823 modules, same count as prior clean passes), not a
simulator/device run.

- `DiscoverHubScreen.js` rebuilt in place (same route, no navigation changes needed) into a real
  unified surface over the four already-listable/searchable content types — **not** including
  People. People were deliberately kept as their own entry card, not folded into unified text
  search: this is a proximity dating app, and searching nearby people by name is a stalking
  vector nothing else in this codebase has ever built; Browse/Crossed Paths on the dedicated
  `Nearby` screen stays the only way to find people.
- **Search**: one text box filters `getNearbyGatherings('wide')` (title/description),
  `getPublicCommunities()` (name/description), and `getActiveOffers()` (title/business name/
  description) client-side against already-fetched data — no new queries for those three. Places
  is the exception: Google Places is a metered external API, so it's only queried (debounced
  350ms) when the Places filter is active, or when a search of 2+ characters is typed with
  location granted. `searchNearbyPlaces()` in `services/places.js` gained an optional `keyword`
  param passed straight through to Google's Nearby Search `keyword=` parameter — a real,
  pre-existing Google API capability, not a new fabricated signal.
- **Filters**: a type chip row (All / Gatherings / Communities / Places / Perks) scopes which
  sections render; Places additionally gets its own category chips (coffee/restaurants/parks/
  hubs, same `PLACE_CATEGORIES` as `PlacesScreen.js`) since Google's Nearby Search requires a
  `type`. Communities already-joined by the caller are excluded (checked via `getMyCommunities()`
  against `getPublicCommunities()`), matching `CommunitiesScreen.js`'s own existing convention.
- **Map/List views**: list is default; map (shown only when the type filter is All/Gatherings/
  Perks, since Communities/Places have no map story) reuses `GatheringsMapView.js` completely
  unmodified — gatherings via their existing fuzzed coordinates, perks via `brand_offers`' own
  real lat/lng (same `mapDeals` pattern already used by `GatheringsScreen.js`). **Card view was
  not built** — `DiscoveryScreen.js` already owns a dedicated swipe-card interaction for people,
  and a generic "everything" card view has no single natural gesture across four differently-
  shaped content types; scoped out rather than built shallow.
- **"Recommended for you"**: reuses `getGatheringFitReasons()` (the existing shared scorer
  already powering Home's `bestPick` and `GatheringDetailScreen`) against the same
  already-fetched gathering list — real interest/distance/attendance/beginner-friendly signals,
  score ≥ 5 threshold, top 3, exact same convention as Home. This **is** the "AI recommendations"
  line item from the roadmap doc — a real signal-based scorer, not a new LLM call. No genuine
  natural-language "AI Concierge" was built or attempted; that would be this codebase's first
  actual LLM integration and needs its own explicit review (cost, latency, prompt-injection
  surface via user-generated gathering titles/descriptions), not a silent addition here.
- Existing working functionality preserved during the rebuild: the "Tonight" / "This Weekend"
  quick-shortcut cards (→ `Gatherings` with `initialDateFilter`) and the Gathering Memories /
  Public Stories Near You sections are all still present, unchanged in behavior.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through: unified search across all four types, the type filter chips, list↔map toggle, Places
  category chips with real location, and confirm the Recommended section's reasons render
  correctly, on both iOS and Android.

## Outstanding: Create Flow (guided multi-step wizard)

Closed against the same Aug 7 2026 external roadmap doc as Discover — its vision for Create was
What do you want to do? → Choose activity → Date & time → Location → Public/private → Invite
friends → Preview → Publish (8-10 screens). What existed before this pass: `CreateHubScreen.js`
(a simple link hub, already covers "what do you want to do") → single-screen
`CreateGatheringScreen.js` with every field crammed onto one form, no preview, no invite step.
**Core build is done and committed; not yet manually tested in a running app** — same standing
caveat as every other entry here: verified via `@babel/core` compile and a full
`npx expo export --platform ios` (1823 modules, clean), not a simulator/device run.

- Found a real, pre-existing, unrelated bug while reading this screen for this exact gap:
  `CreateGatheringScreen.js` line 35 had `uuseEffect(() => {...})` — a typo'd `useEffect` call.
  `uuseEffect` is not a defined identifier, so this threw a `ReferenceError` on every render —
  **the entire "Host a Gathering" flow was crashing in production** before this fix, unrelated
  to the wizard work itself. Fixed as a one-character-prefix deletion.
- `CreateGatheringScreen.js` rebuilt into a real 4-step paginated wizard (single screen, local
  `step` state + a dot/label progress row, not 8 separate nav routes — a guided flow needs a
  guided *sequence*, not necessarily 8 distinct screens/routes, and this avoids adding 7 new
  routes for what's fundamentally one form's worth of state):
  1. **What** — title, description, category chips (unchanged fields, moved here)
  2. **When** — date/time picker, repeat cadence (unchanged fields, moved here)
  3. **Where & Who** — location picker, public/private, map visibility (private-only), women-only
     (unchanged fields, moved here)
  4. **Preview** — new: a real read-only summary card (category icon/color, formatted date +
     repeat cadence, location status, public/private + map-visibility copy, women-only flag)
     rendered from the same state that's about to be submitted — nothing invented, no
     placeholder numbers. Publish button here calls the same `createGathering()` as before.
  Per-step validation gates `Next` (title required on step 1, future date required on step 2),
  matching the original form's validation, just moved to the step where each field lives.
- **"Invite friends" was deliberately not built as a step.** While scoping this, found that
  `notifications.js`'s `case 'gathering_invite':` (push-tap routing) is dead code — nothing
  anywhere in the codebase, client or migrations, ever sends a notification of that type. There
  is no `notifications` table, no gathering-invite table, and no trigger/edge-function wiring
  for it; `supabase/functions/send-push` exists but nothing calls it for this. Building a real
  "invite a specific friend to this gathering" feature needs new schema + RLS + a real delivery
  path (push and/or in-app), which is a distinct, fully-scoped feature in its own right — not
  something to fake with a friend-picker UI that doesn't actually notify anyone. Treat as its
  own future gap, same category as the AI Concierge and unified Map Experience noted above.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through all 4 steps including Back navigation, the location picker round-trip (step 3 →
  `SelectGatheringLocation` → back, confirming step state survives), and Publish, on both iOS
  and Android.

## Outstanding: Gathering Hub ("What happens after you tap Join?" redesign)

Closed against a third user-supplied vision doc (forwarded email, Jul 30 2026) describing a
live, day-of "Gathering Hub" experience that replaces the old `Alert.alert("You're In!")`
dead end. Core build is done and committed; **not yet manually tested in a running app** —
same caveat as the Gathering Detail Screen entry below. Verified: every touched file compiles
via `@babel/core`, a full `npx expo export --platform ios` (1823 modules) built clean, and the
new schema/RPCs were applied to production (`enmosvippabmuqslzrox`) and exercised directly
against the live database via `set_config('request.jwt.claims', ...)`.

- New `src/screens/GatheringHubScreen.js` + `GatheringHub` route (`RootNavigator.js`), distinct
  from `GatheringDetailScreen` for the same reason Detail was split from the list last pass:
  Detail's job is persuading you to join; Hub is the live experience for people already in.
  Joining a public (auto-approve) gathering from Detail now does
  `navigation.replace('GatheringHub', { gatheringId, justJoined: true })` instead of just
  reloading in place — Hub shows a 2.2-second "You're In! 🎉" banner (`setTimeout`, no new
  screen/route needed for it) before revealing the full hub. Host-approval gatherings still land
  on Detail's pending panel, since there's nothing live to enter until approved. Already-approved
  visitors to Detail now get an "Open Gathering Hub →" button (promoted to primary CTA; "Say
  Hello" demoted to a secondary link under it). Also wired from `GatheringsScreen`'s attending
  tab (replaces the old per-card "Group Chat" button, since Hub's own Group Chat entry covers
  that) and hosting tab (added alongside the existing Group Chat button, so hosts can check
  who's on their way/checked in without losing direct chat access).
- **Who You'll Meet**: up to 5 fellow approved attendees, each showing *every* true honest fact
  that applies (stacked, not just the first match — matches the vision doc's own example, where
  Sarah gets both a shared-interest line and "First time here" at once): real shared-interest
  overlap (`profiles.interests` intersection, same pattern as `compatibility.js`/
  `ChatScreen.js`'s existing shared-interest suggestions), the existing
  `getFirstTimerAttendeeIds()` flag, and for the host specifically "Organizer" plus a real
  `getHostStats()` "Hosted N gatherings" line (same RPC already shown on Detail). Falls back to
  "Going to {title}" only when nothing else applies. The vision doc's "Lives nearby" line for
  non-host attendees was **not** built — checked live, `profiles` has no lat/lng/location column
  at all, so there is no real per-attendee proximity signal to draw from.
- **Ice Breakers**: static, category-keyed conversation starters
  (`src/constants/gatheringHubContent.js`) — deliberately not a real AI/LLM call, same
  no-new-API-cost tradeoff already made for Home's `getHomeInsight()`. Tapping one deep-links to
  `GatheringChat` with a new `draftText` route param that prefills the message input (small
  addition to `GatheringChatScreen.js`) rather than sending on the user's behalf.
- **Checklist ("Before You Go")**: real weather via the existing `getSocialForecast()` RPC
  (reusing `getGatheringById`'s already-fetched `get_gathering_distances` fuzzed coordinates —
  no extra query) plus static, category-keyed prep tips (same constants file). The vision doc's
  "parking available" line was **not** built — no real parking-availability signal exists
  anywhere in this codebase, and a generic tip can't honestly claim it without becoming a
  fabricated per-venue fact.
- **Meet-Up Point**: a real single-pin map using the gathering's actual `precise_lat/lng` —
  previously never exposed to the client at all (`SAFE_GATHERING_FIELDS` deliberately excludes
  it; the app has only ever shown fuzzed coordinates, per `GatheringsMapView.js`'s own comment).
  New SECURITY DEFINER RPC `get_gathering_meetup_point()` (in
  `20260807_gathering_hub.sql`) returns the exact coordinates only to the host or an approved
  attendee of that specific gathering — a narrow, honest-need exception to the fuzzing rule,
  not a change to it. Verified live: an approved attendee gets real coordinates back, an
  unrelated user gets an empty result set.
- **"I'm On My Way" / "Who's Here"**: two new nullable timestamp columns on
  `gathering_interest` (`on_my_way_at`, `checked_in_at`), set via two new SECURITY DEFINER RPCs
  (`set_gathering_on_my_way`, `check_in_to_gathering` — no self-UPDATE RLS policy was opened,
  matching this codebase's existing avoidance of broad client UPDATE access on a table that also
  holds `status`/`match_id`). **These are self-reported taps, not GPS verification** — tapping
  "I'm On My Way" just records a timestamp and shows fellow attendees a count. Checking in
  switches the checked-in user's own view into a minimal "during the gathering" mode (Have fun 🎉
  / Who's Here count / Say Hi / Questions / Photos), matching the vision doc's "put the phone
  away" framing.
  **Deliberately not built**: the vision doc's Uber-style "Live Mode" (continuous location
  sharing, an actual ETA countdown, GPS-verified arrivals). This codebase has no directions/ETA
  API integrated anywhere, and continuous location sharing between attendees who haven't met
  yet is a materially different privacy posture than the fuzzed-coordinates-only approach used
  everywhere else in the app. Treat real GPS-based ETA/arrival tracking as a distinct future
  feature requiring its own explicit review, same category as the "verified visits" billing
  metric noted below — not something to bolt on here.
- **Post-gathering "what's next"**: `GatheringFeedbackModal` now has a second step after
  submitting feedback — "Anything you'd like to do next?" with Coffee / Dinner / Another walk
  chips (reusing the exact category tags `getQuickPrompts()` already maps those same labels to
  in `timeContext.js`, so they prefill `CreateGathering` the same way Home's quick-action chips
  do) plus "Join next week" (browses `Gatherings`). Requires a new `navigation` prop, now passed
  from both its call sites (`HomeScreen.js`, `GatheringHubScreen.js`); skips straight to closing
  if no `navigation` prop is given, so nothing breaks for any caller that doesn't pass one. The
  vision doc's exact rating copy ("Did tonight make your day better?" / Absolutely / Yes) was
  **not** substituted in — the modal's existing "How was it?" four-option scale (loved it/good/
  okay/not for me, from an earlier pass) is a different, already-human-framed question, and
  changing its wording wasn't attempted since the wording doesn't feed `get_host_reputation`
  (that RPC reads `felt_welcoming`/`would_attend_again` from the separate inline
  `GatheringFeedbackPrompt` widget, not `satisfaction_rating`) — no functional coupling, just an
  intentionally unmodified pre-existing question left as the user finds it. Revisit only if the
  literal copy actually matters to whoever's reading this.
- Two real, pre-existing bugs found and fixed while building this (unrelated to the feature,
  same pattern as the duplicate-import fix from the Gathering Detail pass):
  - `SelectGatheringLocationScreen.js` had a leftover `Alert.alert('DEBUG', ...)` firing on
    every render — was popping a debug alert every single time a host tried to set a custom
    gathering location.
  - `GatheringFeedbackPrompt.js` (the inline 👍/👎 prompt on past attending gathering cards) was
    calling `submitGatheringFeedback(gatheringId, feltWelcoming, wouldAttendAgain)` with two
    positional booleans, but the function's actual signature takes a single options object
    (`{ feltWelcoming, wouldAttendAgain, ... }`). Destructuring a bare `true` off that silently
    produced `{feltWelcoming: null, wouldAttendAgain: null}` — every submission through this
    specific prompt (not the richer `GatheringFeedbackModal`) was recording empty feedback.
- **Not done yet**: same as Gathering Detail — no manual run-through in a simulator/device.
  Next session should click through: join a public gathering from Detail (banner → full hub),
  tap an ice breaker (chat prefill), tap "I'm On My Way" then "check in" (minimal mode), and
  the post-feedback "what's next" chips, on both iOS and Android.

## Outstanding: Gathering Detail Screen ("Can I see myself here?" redesign)

Closed against a second user-supplied vision doc — this one about what happens after tapping
into a single gathering. Core build is done and committed; **not yet manually tested in a
running app** (no simulator/device session run this pass), so treat as "should work, verify
before considering this fully closed."

- The vision doc assumed an immersive full-screen "you tapped in" experience. That screen
  **did not exist at all** before this pass — gatherings only ever expanded in place inside
  the `GatheringsScreen.js` FlatList rows (still true, left alone). Confirmed with the user
  that the right move was a real dedicated screen, not a bigger expand-card, since several
  vision-doc pieces (a true full-bleed hero, a distinct post-join state) can't work as an
  in-list expansion.
- New `src/screens/GatheringDetailScreen.js` + `GatheringDetail` route (`RootNavigator.js`),
  reusing the same `headerTransparent` full-bleed pattern already established by
  `Gatherings`/`CommunityDetail`. Wired from every existing entry point that names a specific
  gathering: the title/host row on all three `GatheringsScreen` tabs (nearby/attending/hosting),
  all three map-view marker taps (previously just `Alert.alert` summaries — replaced with real
  navigation, net simplification), and Home's `bestPick` card (previously navigated to the
  generic `Gatherings` list with **no gathering id at all** — now deep-links to the specific
  gathering).
- Sections, each backed by real data, no invented numbers (same convention as the Home
  redesign's `bestPick`/`weeklyRecap`):
  - **Hero**: true full-bleed `cover_photo_path` image; a category-colored/icon fallback block
    (not a stock photo) when a gathering has none.
  - **"Why this fits you"**: `getGatheringFitReasons()`, a new shared pure function in
    `services/gatherings.js`. This *replaces* the reason-scoring logic that used to live only
    inline inside `homeDashboard.js`'s `bestPick` block — Home's best pick now calls the same
    function, so the two surfaces can't drift. Net behavior change on Home: `bestPick` reasons
    can now also include "Beginner friendly" (real flag, wasn't scored before); first-timer
    count is intentionally *not* computed for Home's pick (would mean an extra query per
    candidate gathering just to rank one) — only the detail screen, for its single gathering,
    computes that.
  - **Who's Going**: real avatars/names, plus an honest first-timer count via new
    `getFirstTimerAttendeeIds()` — someone who has zero other *past* approved gatherings
    anywhere, derived from `gathering_interest` (which is already publicly readable for
    approved rows), not a new RPC. Vision doc's "N people coming alone" was **not** built —
    no real signal exists for it (no "attending together" concept in the schema) and this
    codebase's convention is to skip rather than fabricate.
  - **The Vibe**: `energy_level`/`conversation_level`/`group_size_feel` now render as an actual
    read-only 5-dot fill (matching `EditGatheringScreen`'s edit-mode picker's low/high labels —
    "Chill ↔ High energy" etc.) instead of the plain "Energy 3/5" text badge that's still used
    in the in-place list-card expansion.
  - **Timeline**: `timeline_steps` now render with a connector-dot visual instead of plain text
    lines (again, only on the new screen — the list-card version is untouched).
  - **Community Perk**: expanded `GatheringOfferBadge`'s single-line badge into a full card
    (title, business name, description) using the same `getGatheringOffer()` /
    `gathering_id`-scoped `brand_offers` row that already existed.
  - **Meet the Organizer**: `getHostStats()`/`getHostReputation()` (existing RPCs, previously
    only ever rendered on `ViewProfileScreen`) now also shown inline on the detail screen. Added
    **"What people loved"**: a new `getHostLovedTags()` in `services/gatherings.js`, aggregating
    the real `great_because` tag array across a host's past `gathering_feedback` rows (that
    table is publicly SELECTable per its RLS, so no new RPC needed) into e.g. "The people · Great
    conversations · The host". This is the honest equivalent of the vision doc's "what people
    loved" quotes — there is **no free-text field anywhere** in `gathering_feedback` (confirmed
    against the live schema), so literal testimonial quotes were not built; this is real
    aggregate categorical data standing in for them, most useful for a host with an established
    track record and correctly renders as nothing for a new host with no feedback yet.
  - **Questions**: reused `GatheringQnA` as-is.
  - **Join CTA**: big button, honest copy — "JOIN GATHERING" for `is_public` gatherings (real
    auto-approve), "REQUEST TO JOIN" for host-approval gatherings (was "I'm Interested" for
    both cases in the list-card flow, which is still true there — untouched, still valid).
    `GatheringIntentModal` gained a `confirmLabel` prop (default unchanged) so the two screens
    can each show honest, context-correct copy without duplicating the modal.
  - **Post-join state**: no more `Alert.alert("You're In!")` — the detail screen re-fetches
    after joining and renders a real in-screen "You're in! 🎉" panel with a "Say Hello" button
    that deep-links straight into `GatheringChat` for that specific gathering (the old Alert's
    "Send a Message" button went to the generic `Matches` screen, not the gathering's own
    chat — that gap is now closed, only on this new screen). Host viewers see a "you're hosting
    this" banner instead of a join button; pending (awaiting host approval) viewers see a
    plain status panel. No leave/cancel-request action was added — out of scope, doesn't exist
    in the list-card flow either.
  - Skipped per the "don't fabricate" decision: star-rating widgets (reputation is real
    percentage text, not a 0–5 star signal the schema doesn't have) and the vision doc's
    specific "you'll probably enjoy coffee afterwards, 6 attendees usually continue here" —
    no continuation/attendance-linking data exists to back a claim that specific.
- While verifying files before this build, found and fixed a real, already-committed bug
  unrelated to this feature: `RootNavigator.js` had a duplicate `import OnboardingQuestionsScreen`
  (two lines, same specifier) — invalid ES module syntax that would have failed to bundle at
  all. Introduced by commit `58478501`, whose own message claimed to *remove* a duplicate route
  but the diff shows it *added* this one — looks like a mismerge from an interrupted session.
  Fixed as a one-line deletion since it blocked the whole app, not just this feature.
- **Not done yet**: no manual run-through in a simulator/device this pass. What *was* verified:
  every touched file compiles via `@babel/core`, a full production Metro export
  (`npx expo export --platform ios`, 1821 modules) built clean with no resolution errors, and
  every new/changed Supabase query shape (the `getGatheringById` joins, `getFirstTimerAttendeeIds`,
  `getHostLovedTags`) was run directly against the live production schema to confirm the
  columns/foreign keys/RLS assumptions are real, not just plausible-looking. What's still
  unverified is purely visual/UX: next session should launch the app and click through —
  tap-in from all three `GatheringsScreen` tabs, the Home best-pick card, and both a public
  and a host-approval gathering's join flow — to confirm the layout and the post-join panel
  actually look right, not just that the code runs.

## Outstanding: Billing / Monetization (contract + invoice generation + scheduling now live, Stripe still not started)

The brand-matching business model (businesses offer targeted, quantity-limited discounts;
redemptions are tracked; a "spread"/commission is the intended revenue model) now has real
per-partner billing math running end-to-end on a schedule, but no money actually moves yet:

- The WHEN design decision is resolved: billing is monthly/batched, not per-redemption
  real-time. `supabase/migrations/20260806_partner_contracts_billing.sql` adds
  `partner_contracts` (per-partner `billing_model`: per_redemption/flat_monthly/hybrid/custom,
  with rates, contract dates, `max_monthly_spend` cap, `auto_renew`) and
  `generate_monthly_invoices()`, a SECURITY DEFINER function. It locks that partner's unbilled
  `offer_redemptions` rows (`FOR UPDATE`, following the codebase's race-condition convention),
  sums them per the contract's billing model, writes a row to `business_invoices` (status
  `draft`), and stamps each redemption with `invoice_id` so it's never double-billed. `custom`
  contracts insert with `amount_due = 0` (not `null` — the column is `NOT NULL`) for finance
  to correct by hand while still in `draft`.
  **Applied to production** (`enmosvippabmuqslzrox`) and verified against the live schema —
  `business_invoices` already had matching `period_start`/`period_end`/`redemption_count`/
  `amount_due` columns from an earlier session.
- `20260806_schedule_monthly_invoices.sql` schedules it via `pg_cron` (already installed and
  in use for 8 other jobs, e.g. `send-match-reminders`) as job `generate-monthly-invoices`,
  `0 6 1 * *` (06:00 UTC on the 1st, billing the just-closed prior month, the function's
  default period). Runs as `postgres`, which owns the function, so the function's own
  `revoke all` (correctly there to stop client-side calls) doesn't block the cron invocation.
  **Also applied and verified live** (`cron.job` id 9).
- `getEstimatedAmountOwed()` in `src/services/brandOffers.js` now calls
  `get_partner_billing_estimate()` (same math as the invoice generator, run against the
  current open month) instead of the old flat $3/redemption placeholder. Returns
  `{ redemptionCount, estimatedAmount, billingModel, includedUnits, billableCount }`;
  `billingModel` is `null` when the partner has no active contract yet.
  `BusinessDashboardScreen.js` shows this in the insights tab, gated on `billingModel` being
  present and not `'custom'`, and calls out how many of the included allotment have been used.
- `partner_contracts.included_units` (added in `20260807_billing_included_units.sql`, default
  0) lets `per_redemption`/`hybrid` contracts include N free redemptions before the per-unit
  rate applies — e.g. "100 included, $0.75 each after" — instead of billing from redemption
  #1. Both billing functions compute `billable_count = greatest(count - included_units, 0)`
  and multiply that by `redemption_fee`, not the raw count. `flat_monthly`/`custom` ignore it.
- Fixed a real bug in both billing functions (`20260807_billing_contract_window_bound.sql`,
  applied and verified live): the redemption lookup was bounded only by the invoicing
  period, not by the contract's own `contract_start`/`contract_end`. A contract starting
  mid-month would have swept in — and permanently stamped `invoice_id` on — redemptions
  from before it existed; one ending mid-month would do the same for redemptions after it
  lapsed. Now both clip the window with `greatest(period_start, contract_start)` /
  `least(period_end, coalesce(contract_end, period_end))` before aggregating. Didn't show
  up in the Coastal Coffee verification below since that contract is open-ended and
  predates all its redemptions — re-verified $20.00/0-redemptions unaffected after the fix.
- One test contract exists: partner **Coastal Coffee** (`67dd3d6d-f36b-4b20-8a80-ac980baecc30`),
  contract `787d5b41-...`, `hybrid` billing, `$20/month` + `$1/redemption`, `included_units: 0`,
  open-ended, `auto_renew: true`. Verified end-to-end (simulating the real caller via
  `set_config('request.jwt.claims', ...)` since the Management API has no user session) —
  returns `$20.00` with 0 redemptions so far this month, as expected.
- No other `partner_contracts` rows exist, and there's deliberately no self-serve UI to
  create one (finance/ops decision, written via the SQL editor/service role or a future admin
  tool). Nothing will actually get invoiced for other partners until a contract is created by
  hand.
- Pricing philosophy note (from a strategy discussion, not yet decided as final policy):
  billing by raw redemption count is what's actually instrumented today; a "verified visits"
  metric (join gathering + GPS/check-in + dwell time or QR scan) was floated as a better
  long-term metric but requires building attendance/check-in verification that doesn't exist
  yet — treat that as a distinct future feature, not a pricing tweak.
- Still missing before this is real billing: no Stripe integration at all (no account
  connection, no webhook handler, no actual charging, no dispute/refund handling). Invoices
  will sit in `draft` with nothing downstream until that's built.
- A Supabase Management API access token lives in `.claude/mcp.json` (gitignored) — that's
  what made direct schema inspection and migration application against the live project
  possible from inside a Claude Code session; project ref is `enmosvippabmuqslzrox`
  (see `src/services/supabase.js`).

## Recently completed, for context (do not re-build)

- Home screen "dream redesign" gaps, closed against a user-supplied vision doc (checked
  feature-by-feature against actual code first — several items in the doc were already partly
  built under different names, e.g. "Continue Your Story" ≈ existing "Continue Your Community"):
  - **Happening Now**: `getHomeDashboard()` in `homeDashboard.js` now also returns
    `happeningNow` — gatherings from the same already-fetched `nearbyGatherings` list whose
    `scheduled_at` falls in [-30min, +2h] around now (no end-time field exists on gatherings,
    so "in progress" is approximated). Rendered as a horizontal chip row using
    `categoryStyleFor()` for icons, no extra query.
  - **Time-of-day quick actions**: `getQuickPrompts()` (already existed in `timeContext.js`,
    previously only surfaced one layer deep inside `StartSomethingModal`) is now also rendered
    directly on Home as a visible chip row under a period-aware header (`Good Morning` /
    `This Afternoon` / `Tonight` / `This Weekend`). Tapping a chip either deep-links straight to
    `CreateGathering` with a prefilled title/category, or — for the one prompt with sub-options
    (`Dinner` → Pizza/Mexican/etc.) — opens `StartSomethingModal` pre-set to that category via
    a new `initialCategory` prop, reusing the modal's existing decision tree instead of
    duplicating it. `StartSomethingModal`'s `SUB_OPTIONS` map is now exported so Home can check
    membership without hardcoding which labels have sub-menus.
  - **One AI sentence**: deliberately **not** a real LLM call — `getHomeInsight()` in
    `homeDashboard.js` is a pure, no-I/O function that picks one honest sentence from signals
    the dashboard already computed (friends making plans → best pick exists → good weather
    forecast → things happening now), in that priority order, returning `null` if none apply.
    This was an explicit tradeoff discussed with the user: no new Edge Function, no API key,
    no per-request cost, and it matches this file's existing "no invented numbers" convention
    (see `getHomeDashboard()`'s own comments on `bestPick`/`weeklyRecap`/`sinceAway`) rather than
    introducing a genuinely novel-but-untethered-from-reality text generator.
  - **"You have N opportunities" greeting line**: reuses the already-computed
    `gatheringsTodayCount`, not a new number — only shown when > 0, period-aware wording
    ("today" / "tonight" / "this weekend").
  - **Floating action button**: the "+ Start Something" button moved from an inline
    scroll-flow button to a real `position: 'absolute'` FAB pinned bottom-right over the
    ScrollView (matching the existing bottom-anchored-bar pattern already used in
    `DiscoveryScreen.js`), with extra `paddingBottom` added to the scroll content so the last
    card isn't hidden behind it.
  - Deliberately left alone: the "92% Match" hero-card framing and "unlocked because 8 members
    joined" perk copy from the original vision doc were **not** built — both would require
    fabricating numbers the codebase has no real signal for, which conflicts with the
    established convention throughout `homeDashboard.js` of never inventing a metric.
- Gathering detail redesign: three schema pieces (`20260807_gathering_detail_vibe_and_photo.sql`,
  `20260807_gathering_questions.sql`, `20260807_gathering_intents.sql`, all applied and
  verified live) plus full frontend wiring, built in one pass after a codespace restart
  interrupted the session partway through (schema files existed but were unapplied and
  completely unwired — this closed that gap):
  - `gatherings` gained `energy_level`/`conversation_level`/`group_size_feel` (1-5, nullable),
    `beginner_friendly` (default `true`), `timeline_steps` (jsonb array, max 8, `{time, label}`),
    and `cover_photo_path` (private `gathering-photos` storage bucket, host-only upload,
    `${gatheringId}/cover-*.jpg` path convention matching the `profile-photos`/`stories`
    RLS-by-folder pattern). Editable via `EditGatheringScreen.js` (1-5 tap-to-select scale
    pickers, a beginner-friendly `Switch`, an add/remove timeline step list, a cover photo
    picker reusing the `photos.js` base64-upload pattern — `fetch().blob()` silently produces
    0-byte files on iOS for local file URIs, so this stays on `FileSystem.readAsStringAsync`
    + a hand-rolled base64 decoder like the other upload paths). Displayed on gathering cards
    in `GatheringsScreen.js` (cover photo always shown when present; vibe/timeline behind a
    new "Details & questions" expand toggle on nearby cards, folded into the existing expand
    section on attending cards, always-visible on hosting cards).
  - `gathering_questions`: public Q&A, anyone can ask, only the host can answer (`GatheringQnA.js`,
    a shared component mounted with `isHost` toggled per tab — `nearby`/`attending` pass `false`,
    `hosting` passes `true` unconditionally since that list is already scoped to the caller's
    own gatherings). Both ask and answer run through `checkTextModeration` first, matching the
    rest of the codebase's text-input conventions.
  - `gathering_intents`: the private pre-join "what are you hoping for tonight?" signal —
    deliberately **never surfaced to the host**, not even in aggregate (no such RPC exists;
    don't add one without a separate explicit review, per the migration's own comment).
    `GatheringIntentModal.js` intercepts both "I'm Interested" entry points (the nearby-tab
    button and the map-view marker alert) before the existing `handleExpressInterest` fires,
    and pre-fills a user's previous answer via `getMyGatheringIntent` so re-opening it isn't
    a blank slate. Saving the intent never blocks joining — failures are swallowed with a
    console log, same as the existing post-gathering feedback modal's philosophy.
- Full security audit: RLS on every table, all Edge Functions, all storage buckets, 38+
  functions found with unintended PUBLIC/anon execute access (fixed), several race conditions
  in rate-limiting triggers fixed with `SELECT ... FOR UPDATE`.
- Navigation restructure: Profile → "You", Places (Google Places-powered), real Trending,
  Inbox split into Requests/Invitations/Reminders, two-step quick-create flow.
- Stories redesign: gathering-linked stories, differentiated expiry, host + fellow-attendee
  visibility on both the table and storage bucket RLS.
- Full onboarding redesign: landing screen, preference questions, immediate recommendations,
  post-gathering feedback loop, "first mission" + real scheduled follow-up reminder, earned
  profile stats.
- Brand-matching vision: quantity-limited offers (`redemption_limit`), interest targeting
  (`target_interest_tag`), location scoping (`brand_partners.latitude/longitude`, 50-mile
  radius via `get_nearby_offer_ids`), real shared-interest suggestions for both 1-on-1
  matches (`ChatScreen.js`) and group gatherings (`GatheringChatScreen.js`), scarcity count
  display, business-side redemption visibility.

## Known conventions in this codebase

- `trusted_update` pattern: privileged profile columns (is_premium, managed_partner_id,
  *_created_today/date counters, etc.) are protected by `prevent_self_premium_edit()` trigger;
  legitimate server-side writes must call
  `perform set_config('app.trusted_update', 'true', true)` first.
- Rate-limit triggers use `SELECT ... FOR UPDATE` on the profiles row to avoid race conditions.
- New Postgres functions default to PUBLIC execute access — always explicitly
  `revoke ... from public, anon` unless intentionally public.
- Direct SELECT on `offer_redemptions` is scoped to each user's own rows only (RLS) — always
  go through a SECURITY DEFINER RPC (e.g., `get_offer_redemption_counts`,
  `count_redemptions_since`) to get true aggregate counts.
- **Migration discipline** (added Aug 9 2026, after the schema-reproducibility regression found
  and fixed during the `PRODUCT_AUDIT` refresh — see that section above for the full incident):
  every schema change ships as **exactly one** migration file in `supabase/migrations/` — never
  both a live migration *and* a duplicate hand-patch baked into `00000000000000_baseline.sql`/
  `full_schema_pull_2026-08-09.sql` in the same change, which is the exact shape of the
  regression that slipped through once already. Before considering a schema change done, replay
  it against a truly empty database — not just apply it to production — using the same method
  already proven in this file: pull the real `supabase/postgres:15.1.0.147` Docker image, drop
  and recreate an empty `public` schema, run the full `supabase/migrations/` folder in order
  with `psql -v ON_ERROR_STOP=1`, confirm exit code 0. This is the only way to actually prove
  "a fresh empty Supabase project can be rebuilt from committed files alone" rather than assert
  it — verifying against live production alone cannot catch a baseline/migration conflict, since
  production was never rebuilt from these files in the first place.
