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
actual work (Phases 4-6 of the plan below).

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

### "Business Web as an Operating System" — Phases 4-6

Full original plan, audit, and Phases 1-3's build/verification detail: see `CLAUDE_HISTORY.md`,
search for "Business Web as an Operating System". Phases 1 (decline reasons), 2 (day-of-week
availability), and 3 (offer-performance funnel) are DONE and verified live in production —
nothing further needed there. This session's job is Phases 4-6, in the order below. **Phase 7
(a real business web dashboard) stays explicitly NOT authorized** — do not start it without a
fresh, explicit go-ahead naming Path A (Expo web output, reusing existing RN screens) vs. Path B
(a separate codebase); Path A is the standing recommendation if/when this is ever picked up.

**Phase 4 — real media attach on an offer.** A prior session already fully drafted the migration
for this (found untracked on disk at session start:
`supabase/migrations/20260917_offer_media_upload.sql`) — read it before rebuilding anything.
Locked design: nullable `media_path`/`media_type` pair on `business_request_offers` (a business's
own response to one specific customer request) and separately on `business_experiences` (a
standing Signature Experience's own default creative). Reuses the app's already-established
private-bucket-plus-signed-URL upload convention (matching `gathering-photos`/`profile-photos`),
not a new storage pattern — one shared bucket, `business-offer-media`, `public: false`, folder-
keyed by the real `partner_id` the caller's own `profiles.managed_partner_id` matches; an offer's
own upload and a Signature Experience's own upload are distinguished by filename prefix
(`offer-*`/`experience-*`), never two separate buckets. `media_type` CHECK: `image|video`,
nullable. The Make-an-Offer modal gains an optional "Add a photo or video" step; the resulting
offer card (both business-side and consumer-side) renders the real media **inside** the existing
standardized offer-card wrapper — Nearby's own presentation frame is never bypassed by a
business's own uploaded creative, the media sits inside it, never replaces it. Upload client code
should mirror `uploadGatheringCoverPhoto()`/`getSignedGatheringPhotoUrl()` in
`src/services/gatherings.js` (around lines 705-733 as of the last check) exactly —
`FileSystem.readAsStringAsync` + a base64→Uint8Array decode, never `fetch().blob()` (silently
produces 0-byte files on iOS for local file URIs — this app's own already-learned lesson).

**Phase 5 — a real weather/event digest card, small and copy-only.** The underlying signal
(business-opportunity weather-favorability) is already real and already live (Business
Intelligence Phase 7, see `CLAUDE_HISTORY.md`) — this phase is a pure presentational
consolidation, not a new signal. A small "🌦️ Today's Conditions" card on the Business Dashboard's
Insights tab, showing the real, already-computed weather-favorability signal plus a real count of
how many currently-open opportunities that signal is already boosting for this business (derived
client-side from data the Opportunities list already has — zero new query). Never a new signal,
never a fabricated forecast claim beyond what the existing weather RPC already honestly returns.

**Phase 6 — rename "Requests" → "Opportunities."** Purely cosmetic, smallest and safest, sequence
last. `SECTIONS` const's `requests` tab label in `BusinessDashboardScreen.js` (around lines 39-46
as of the last check) changes from `Requests` to `Opportunities` — one line, zero logic touched.
The section rendered *inside* that tab is already labeled "Business Opportunities," so this is
just aligning the outer tab label with content that's already correct.

**Verification convention for all three** (matching this repo's established practice): apply any
schema change to production via the Management API, verify live with real disposable test data
(create → verify the real behavior → delete → confirm back to baseline), then a client-side
`@babel/core` parse + a full `npx expo export --platform ios` after each phase. A full from-
scratch Docker migration replay (the `supabase/postgres:15.1.0.147` method, documented in
`CLAUDE_HISTORY.md`) is the gold-standard extra step this repo has historically done for every
schema change, but is not mandatory for a small additive change if time doesn't allow — say so
plainly in the commit/status note either way, don't silently skip it and claim full parity.
**No manual simulator/device run-through has ever been possible in any session on this
project** (standing environment limitation, true for literally every feature ever shipped here)
— don't re-state this after every phase, it's covered once, here.

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
