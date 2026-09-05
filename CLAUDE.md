# Nearby — Project Instructions

Nearby is a proximity-based dating/social discovery app (React Native/Expo, Supabase backend).
Supabase project ref: `enmosvippabmuqslzrox`. A Management API access token lives in
`.claude/mcp.json` (gitignored) — used via direct `curl` against
`https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/database/query` for schema
inspection/migration application, since the Supabase MCP server itself has not been reliably
available via ToolSearch in past sessions.

## Read this first — why this file looks different now (2026-09-17)

This file used to grow without bound: every session appended its full build log, verification
trail, and reasoning to the end, forever. By 2026-09-17 it had reached **29,860 lines / 2.46MB**
— reloaded in full at the start of every session as project instructions. Two sessions in a row
spent their entire budget on compaction of that giant file and made no forward progress on the
actual work (Phases 4-6 of the "Business Web as an Operating System" plan, since closed out —
see `CLAUDE_HISTORY.md`).

**The fix**: the complete, unedited historical record — every past session's full build log,
every audit, every locked design decision with its full original reasoning and verification
detail — was moved byte-for-byte to **`CLAUDE_HISTORY.md`**. Nothing was deleted or summarized
away; it's just not auto-loaded every session anymore. This file (`CLAUDE.md`) now holds only:
standing conventions that remain in force, and whatever's currently active/unfinished.

**When to open `CLAUDE_HISTORY.md`**: only when you genuinely need the detailed reasoning or
live-verification trail behind why some already-shipped feature works the way it does, or a full
account of a specific past session someone asks about by date. It's organized reverse-
chronologically (most recent work first) with clear dated section headers — grep for a date or
feature name rather than reading start to end. For everyday work, including picking up the
active items below, this file should be enough. Don't open the history file "just in case" —
that's exactly the habit that caused the problem this split exists to fix.

**Standing rule going forward, so this doesn't happen again**: keep this file short — a few
hundred lines, not tens of thousands. When a plan/phase finishes: (1) append the full verbose
build/verification account to the *top* of `CLAUDE_HISTORY.md` (most-recent-first), (2) replace
whatever was in this file's "Active / unfinished work" section for that plan with either nothing
(if fully done) or a short status line, (3) fold any newly-locked standing convention into the
"Standing Conventions" section below as a single bullet, not a narrative. Do not let this file
grow past a few hundred lines without doing this split again.

## Active / unfinished work

**Phase 8 (Discover visual hierarchy) — IN PROGRESS, see below for exact state.**
"Business Web as an Operating System" (Phases 1-7) is fully DONE. Phases 1-6 (decline reasons,
day-of-week availability, offer-performance funnel, media-on-offer
upload, weather digest card, Requests→Opportunities rename) were verified live in production —
see `CLAUDE_HISTORY.md`, search "Business Web as an Operating System" for the full plan/audit and
each phase's build/verification detail. **Phase 7** (Path A: Expo web export of the existing
business dashboard, reusing RN screens verbatim, deployed as a static site at
`/Nearby/business/` via GitHub Pages from the committed `docs/business/` folder) landed
2026-09-05 — `App.web.js` / `BusinessWebNavigator.js` / `BusinessWebHomeScreen.js` /
`PlatformDateTimeInput.js` are the new web-only surface; `BusinessDashboardScreen.js` and
`businessFulfillment.js` gained `Platform.OS === 'web'` branches for the handful of native-only
actions (camera Moments, Stripe Connect OAuth return, native DateTimePicker, native file upload,
Share.share, GatheringDetail/CommunityDetail navigation) with honest fallback messages/behavior
rather than silent failure. Verified: `expo export -p web` builds clean, output serves correctly
under the `/Nearby/business/` base path via a local static server, no secrets in the built
bundle. **Not verified in an actual browser** — no browser/simulator tooling was available in
that session; if something looks visually off on the deployed site, that's the first thing to
suspect. `docs/business/` must be regenerated (`npx expo export -p web`, then copy `dist/*` over
it) and recommitted any time a business-facing screen changes — it is not auto-built by CI (no
GitHub Actions workflow exists for this yet).

### Phase 8: Discover visual hierarchy + expand-in-place (approved, in progress)

**Status as of 2026-09-05: steps 1-2 of the build order below are DONE and pushed (commits
`231cf20c` and `283a77bc`). Step 3 (matches helper G + expand-in-place state machine F) is NOT
started.** The user approved a mock (an Artifact showing hero image cards vs. today's uniform
white `card`), then approved a second round of refinements, **including building the "expand in
place" interaction** (not deferred) — that part is still outstanding. Sections A-E below are the
original spec and are now built (see "What actually shipped for A-E" beneath them for real
file/line pointers and a couple of judgment calls made during the build that weren't spelled out
in the original spec). Sections F-H are unbuilt spec, still current.

**Not verified in an actual browser/simulator** (same caveat as Phase 7 — no such tooling has
ever been available in a session on this project). If a hero card's gradient/scrim/text layering
looks off in practice, that's the first thing to check.

**A. Dynamic tiering by relevance score, not a hardcoded top-2.**
`getGatheringFitReasons()` (`src/services/gatherings.js:946-988`) returns `fit.score` in a real
0-22 range (attendance `min(count,10)` + interest match `+5` + distance-under-2mi `+3` +
happening-today `+2` + beginner-friendly `+1` + first-timer `+1`). Today's code uses one flat
`>= 5` cutoff. Add a second, higher cutoff (e.g. `>= 12`) to split hero (full-bleed image/
gradient) from standard (medium score) from compact (everything else) — no fixed count of hero
slots; a third genuinely high-scoring result becomes a third hero card.

**B. No arbitrary per-category colors outside the hero image fallback.** Hero cards use
`categoryStyleFor(interest_tag)`'s color (`src/constants/gatheringCategoryStyles.js` — confirmed
still just the 6 existing low-saturation `PALETTE` colors, meant for tints/badges) as a gradient
fallback only when no real `coverPhotoUrls[g.id]` photo exists. Standard/compact tiers stay
neutral — never a per-category tint on those.

**C. Reason copy — must name the actual interest, never edit the shared constant.**
`REASON_TEXT.MATCHES_INTERESTS.text` (`src/constants/recommendationReasonVocabulary.js:55`) is
the literal generic string `"Matches your interests"`, shared verbatim across
`gatherings.js`/`homeRecommendations.js`/`intentResolver.js` and covered by
`recommendationReasonVocabulary.test.js` — **do not edit this shared constant.** Instead, build
"Matches your Coffee interest"-style copy locally inside `DiscoverHubScreen.js`, using
`g.interest_tag` (already present on every row) — confirmed DiscoverHubScreen renders
`g.fit.reasons.join(' · ')` directly, not through the shared `ReasonList`/`categorizeReasonText`
component, so a screen-local override is safe.

**D. Time copy — reuse the app's one canonical time vocabulary, don't invent a new one.**
Every gathering row already carries a raw `scheduled_at` timestamp
(`SAFE_GATHERING_FIELDS`, `gatherings.js:30`). No shared "format a gathering's time into a
display string" utility exists yet (build one, e.g. `src/utils/gatheringTimeLabel.js`, so Home
can reuse it later) — real precedent for the `"Tonight · 7:30 PM"` shape is
`MakeAPlanScreen.js:260`'s `` `${date} · ${time}` `` pattern. For the *bucket label* words
themselves, reuse `GatheringsScreen.js`'s existing `DATE_OPTIONS` vocabulary (`Right Now`,
`Starting Soon`, `Today`, `Tomorrow`, `This Weekend`, `This Week`, `Anytime`), backed by
`utils/rightNowWindow.js`'s canonical "Right Now" window — **not** `HomeScreen.js`'s
`PERIOD_SECTION_LABELS` (`Good Morning`/`This Afternoon`/`Tonight`/`This Weekend`), which labels
the current viewing period, a different concept.

**E. Contextual CTAs — real app vocabulary, not invented verbs.**
For gatherings, the real button label logic (`GatheringDetailScreen.js:908`) is:
`gathering.isFull ? 'Join Waitlist' : (gathering.is_public ? 'Join Gathering' : 'Request to Join')`.
`getNearbyGatherings`'s rows do *not* carry a precomputed `myStatus`/`isFull` today (those are
`getGatheringById`-only fields) — but each row *does* carry the raw `attendees` array
(`status, user_id, created_at, profiles`) plus `capacity`/`is_public`, so DiscoverHubScreen can
honestly derive "have I already RSVP'd" via
`gathering.attendees.find(a => a.user_id === session.user.id)` (userId from `useAuth().session.user.id`)
and compute `isFull` the same way `getGatheringById` does
(`data.capacity != null && approvedAttendees.length >= data.capacity`, `gatherings.js:844`).
"Interested"/"Waitlisted" are **state badges** for someone already RSVP'd
(`GatheringDetailScreen.js:626,638`), never fresh CTA button labels. Tapping the CTA still
navigates to `GatheringDetailScreen` to actually perform the join (don't duplicate that
mutation's edge cases onto a Discover card) — consistent with the Progressive Depth doctrine:
viewing info about a card stays in-place (see F below), but *committing* to Join/Request is a
real task change and a real destination is correct there.
For Perks/offers, the real CTA is **"Redeem"** (`t('brandOffers.redeem')`,
`i18n/translations.js:301`, wired at `BrandOffersScreen.js:266-272` calling `redeemOffer()` from
`services/brandOffers.js:1124`) — never "Accept Offer" (not a real string anywhere in this app).
`BrandOffersScreen` also calls `getMyRedemptions()` for an already-redeemed state; Discover's own
`getActiveOffers()` fetch carries no such flag today, so an honest "Redeemed ✓" badge on a
Discover Perks row needs that same `getMyRedemptions()` call added to DiscoverHubScreen's load —
not fabricated.

**What actually shipped for A-E** (`src/screens/DiscoverHubScreen.js`, commit `283a77bc`,
+ `src/utils/gatheringTimeLabel.js` from `231cf20c`; `src/components/PlaceCard.js` gained an
optional `actionLabel`/`actionIsState` prop pair for the Perks Redeem/Redeemed state, defaulted
off so every other `PlaceCard` call site is unchanged):
- Real thresholds: `HERO_SCORE = 12`, `STANDARD_SCORE = 5` (replaces the old flat `>= 5`),
  `NOTABLE_DISPLAY_CAP = 6` (a real display-sanity cap on the whole notable list, not a per-tier
  cap — a judgment call added during the build, not in the original spec, so a day with many
  qualifying gatherings doesn't turn the whole screen into cards).
- The old two independent passes (`recommended` filtered on `fit.score`, `trending` sorted on
  attendance, each blind to what the other had already picked — meaning the same gathering could
  legitimately render twice) were replaced with **one** sorted-by-`fit.score` list
  (`notableGatherings`); tier (hero vs. standard) is decided per-item in the render off that same
  score, not a fixed slot count. `TRENDING_ATTENDANCE_MIN = 5` (half of the fit-score formula's
  own attendance cap) is the real, disclosed cutoff for "trending enough to headline" in the
  hero eyebrow / reason line. This is a real design change beyond the literal spec text in A —
  flagged here in case a future session expected the old two-section layout to still exist.
- New dependency: `expo-linear-gradient` (`package.json`/`package-lock.json`), used for the hero
  image's gradient fallback and its legibility scrim.
- CTA logic lives in `gatheringActionInfo()`/`myAttendeeStatus()` inside `DiscoverHubScreen.js`,
  mirroring `GatheringDetailScreen.js`'s own `isFull`/`is_public` logic exactly, off each row's
  existing `attendees`/`capacity` fields (`useAuth().session.user.id` for the current user).
- Not done as part of A-E, deliberately out of scope: no Places-card changes (Places still uses
  `PlaceCard`'s plain chevron — B's "standard/compact tiers stay neutral" rule was read as
  covering gatherings only, since Places never had a fit-score to tier by).

**F. Expand-in-place (approved to build now, not deferred).** Tapping a hero/standard card
reconfigures the *existing* `DiscoverHubScreen` in place around that result's context (e.g.
Coffee + Tonight + Nearby) — no new screen, no `navigation.navigate`. Implementation shape:
local component state (e.g. `expandedContext: { interestTag, timeBucket }`, not a nav param) that
swaps the normal browse list for a filtered view; a header breadcrumb (`← Coffee · Tonight ·
Nearby`) whose back action just clears that state back to normal Discover — also wire Android's
hardware back button (`BackHandler`) to do the same while `expandedContext` is set, so physical
back doesn't leave the whole Discover tab. Inside the expanded state: **Gatherings / Places /
Offers as the primary content** (filtered to that interest tag + time bucket + nearby, reusing
data DiscoverHubScreen already fetches/can fetch — no new "people" peer tab). `GatheringDetail`
still exists and is still where the actual Join/Request/manage/edit/attendees flow lives — this
only removes the pointless trip there just to answer "what is this?"; committing to an action is
still a real navigation.

**G. "People You Know" — connections-only, secondary, never a peer tab.** Inside the expanded
context, below the primary Gatherings/Places/Offers content, an optional secondary section may
show people *already connected to the user* (accepted friends, real dating matches) who are
independently relevant to that context (e.g. actually attending/interested in a matching
gathering) — e.g. "2 friends are into Coffee tonight". **Hard rule, reaffirming the existing
standing privacy rule**: never rank or surface a person merely because they share the same
interest/location/time — only real connections, and only when they're independently relevant.
Never a bare "N people nearby" count. Real primitives to use, don't reinvent:
`filterToMyFriends(userIds)` (`src/services/friends.js:114`, doc'd exactly for this — "given a
list of user IDs (e.g., everyone interested in a gathering), returns just the ones who are also
the current person's accepted friends") already exists and does the friends half. The matches
half needs a small new helper mirroring `getMyFriends()`'s own pattern (`friends.js:65-79`) — the
`matches` table (`supabase/migrations/00000000000000_baseline.sql:762`, `user_a`/`user_b`, no
status column — a row existing means matched) has no existing "get my matches as profiles"
export anywhere to reuse; every other service inlines its own ad hoc `matches` query. Write one
real `getMyMatches()`-equivalent, don't inline yet another copy.

**H. Rest of the app, approved but explicitly sequenced — do not start until Discover itself is
done and confirmed working**: Home (1-2 hero moments only, not a wall of imagery; reuse the
Phase 8 time-bucket utility from D) → People (image-forward, real profile photos) → Profile
(moderate/editorial) → Activity (lighter, timeline rows, less card-like than today) → Create
(stays as-is, white surfaces already right) → Business dashboard (structured/data-forward, not
the consumer Discover look). The "expand in place" pattern (F/G) is meant to generalize to these
other surfaces too, once Discover's version is confirmed working — not before.

**Where a restart should pick up**: (1) and (2) of the original build order are done (see status
note above) — start at **(3): the `getMyMatches()` helper (G) + the expand-in-place state
machine (F/G)**, then commit. The grounding in F/G/H above is unchanged and still current, no
further research pass needed before writing that code. As always, check `git log` on
`DiscoverHubScreen.js` directly rather than trusting this note blindly, in case a session after
this one made further progress without updating it.

## Standing Conventions (Locked)

These are the load-bearing rules distilled from thousands of lines of prior build history. Full
original reasoning/citations for any of these: `CLAUDE_HISTORY.md`.

- **No invented numbers, no fabricated signals, ever.** Every metric/count/reason shown anywhere
  in the app must trace to a real query result. An absent signal renders as an honest empty
  state, never a guessed placeholder.
- **Coral (`colors.primary`) = action, not decoration.** Tappable-and-advances-the-user → coral.
  Informational → must not visually impersonate a button. Destructive → `colors.danger`, never
  coral. Progress/data-visualization (a fill bar, an achievement indicator) → coral is fine when
  clearly non-interactive. Secondary actions (Cancel, dismiss) → neutral/outlined; coral is
  reserved for a surface's *primary* action. This visual system is frozen — no further
  consistency sweeps expected unless new work introduces a genuinely new pattern.
- **No stranger discovery via intent, ever — hard privacy rule.** Any "find things for you"
  resolver-shaped feature (Home's intent box, Business Fulfillment matching, group-intent
  signals, etc.) may only ever surface real supply (gatherings/communities/businesses) or people
  the caller is already connected to (accepted friend or match) — never proximity/interest-based
  surfacing of an unconnected stranger. Businesses are deliberately exempt (they're discoverable
  supply by design, not a privacy concern the way a person is).
- **AI never infers or assigns a specific date/time from free text.** A user always picks
  date/time through deterministic UI (preset buttons + a picker). AI may suggest title/category/
  location/description for confirmation, never silently commit a date/time guess.
- **AI suggests, never silently commits.** Every AI-derived value anywhere in the app is shown
  back for the user's own explicit confirmation before it's saved — this holds for every
  AI-classification feature in this codebase, no exceptions.
- **Each actor only ever reports its own side's state.** A business says "I accept this Request"
  (→ becomes an Offer); a consumer says "I accept the Offer" (→ becomes a Commitment); Nearby's
  own SECURITY DEFINER RPCs compute the combined/derived state. No client ever directly flips
  another party's state.
- **Decline reasons feed a real, owner-visible insight surface — never automated re-weighting of
  the matching engine.** A business owner sees their own decline pattern and can manually tighten
  their own settings in response; nothing auto-adjusts matching behavior from decline history
  without its own separate, explicit authorization.
- **"Don't navigate for information, navigate for tasks"** (the Progressive Depth doctrine,
  locked Sep 15 2026 as a standing rule for all future UI work): a screen change should only ever
  happen when the user's actual task changes, or real information depth genuinely requires it —
  never merely because a filter, category, or already-visible data changed.
- **Feature-freeze convention**: don't start a new product surface or architectural change
  without a direct, explicit user request. This does not block bug fixes, security fixes, or
  stabilization work — those are always in scope. A direct request is always sufficient to
  proceed on something bigger; this has been explicitly invoked and overridden dozens of times
  since it was first declared (2026-08-15) and is really just describing normal operating mode.
- **Real external accounts / real money (Stripe, a real reservation/transportation provider,
  etc.) always need the user present for that decision** — never set up or connected
  autonomously, even if the schema/UI scaffolding around the seam is otherwise safe to build
  ahead of time.
- **Migration/verification discipline**: one migration file per schema change (never a
  duplicate hand-patch baked into a squashed baseline file in the same change — that exact
  mistake once broke this repo's own "rebuildable from an empty database" guarantee). Verify a
  schema change live against production with real disposable test data before considering it
  done; a full from-scratch Docker replay (`supabase/postgres:15.1.0.147`, drop/recreate an empty
  `public` schema, patch the two known image-version gaps — `auth.users.phone`,
  `storage.buckets.public` — onto the test container only, run the full `supabase/migrations/`
  folder in filename order via `psql -v ON_ERROR_STOP=1`) is the gold-standard extra proof this
  repo has historically done, but isn't mandatory for every small change — disclose plainly
  whether it was done, don't silently skip and claim parity.
- **A new Postgres function defaults to PUBLIC execute access** — always explicitly
  `revoke ... from public, anon` unless it's genuinely meant to be public. Rate-limit/counter
  triggers use `SELECT ... FOR UPDATE` to avoid race conditions. Privileged `profiles` columns
  (`is_premium`, `managed_partner_id`, daily-counter columns, etc.) are guarded by a
  `prevent_self_premium_edit()`-style trigger; a legitimate server-side write to one of these
  must `perform set_config('app.trusted_update', 'true', true)` first.
- **Git workflow for this repo**: commit and push after each individual phase/increment as it
  lands, not batched at the end — this is this project's own long-standing, explicitly
  pre-authorized convention (not something to re-confirm each time), specifically so a
  mid-session restart never loses more than one increment's worth of work.
- **Migration filename ordering matters.** Migrations replay in filename lexical order,
  independent of when they were actually written — a new migration that depends on an earlier
  one must sort *after* it by filename, or a from-scratch replay will fail even though production
  (already migrated in real chronological order) looks fine. This has bitten this repo more than
  once; double-check filename ordering against real dependencies before naming a new migration.

## Reference

- `CLAUDE_HISTORY.md` — the complete historical build log (pre-2026-09-17), unedited, reverse-
  chronological. Grep by date or feature name.
- `PRODUCT_AUDIT/` — standalone audit documents from past sessions, mostly historical snapshots.
  `PRODUCTION_ARCHITECTURE_2026-08-15.md` (system-wide architecture reference) and
  `SIGNAL_CONTRACT.md` (per-signal collection/matching/ranking contract) are the two most likely
  to still be useful as a reference rather than pure history.
- No automated test framework beyond Jest unit tests on pure functions
  (`jest.config.js`/`jest.babel.config.js`) — no simulator/device testing has ever been available
  in any session on this project.
