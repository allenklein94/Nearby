# Delta Report — Home/Profile/Settings/Inbox IA Restructure, Phases 6–8

**Date:** 2026-08-10
**Scope:** Closes out the final three phases of the round-2 IA restructure plan in
`CLAUDE.md` (Phases 1–5 landed in earlier sessions). All 8 phases are now DONE.
**Commits:** `386de77b` (Phase 7), `65ed5c0f` (Phase 6), `6523f030` (Phase 8)

This is a delta report, not a re-audit — it only describes what changed in this session,
per the plan's own "report a delta, not another full audit" instruction.

---

## Phase 7 — Consolidate Business entry points

**Problem:** Business Mode had 4 scattered "manage/become a business" entry points
(Profile, Settings, Create, plus admin-only rows). A prior session had started collapsing
these but was interrupted by a codespace restart mid-edit, leaving `CreateHubScreen.js` in
a half-finished, self-contradictory state.

**What changed:**
- **`CreateHubScreen.js`** — removed its business link entirely. The prior interrupted edit
  had collapsed a two-state conditional (Manage Your Business / Partner with a Business)
  down to an *unconditional* single link instead of actually removing it — fixed by deleting
  it outright. Create's secondary row now shows only "Create a Community."
- **`SettingsScreen.js`** — confirmed already correctly stripped of its business row (this
  part of the prior session's edit had completed before the restart hit). No further change
  needed.
- **`ProfileScreen.js`** — collapsed the old 3-state business button ("Switch to Business" /
  "My Application (Pending)" / "My Application" / hidden) down to the plan's 2-state design:
  **"🏪 Business"** (if managing one) → `BusinessDashboard`, else **"🤝 Become a Business
  Partner"** → routes to `MyBusinessApplication` if a pending/denied application already
  exists, otherwise `BusinessPartnerApply`. The underlying status-aware routing was kept;
  only the visible label collapsed to the plan's two named states.

**What didn't change:** The 3 admin-only Settings rows (Business Dashboard/Requests/
Verifications) — different persona, explicitly out of scope. The gathering/community-scoped
"Request a Business Partner" flow (a different feature — asking an already-approved business
to sponsor a specific event) — still reachable from `GatheringDetailScreen`/
`CommunityDetailScreen`'s own host banners, unaffected.

**Files touched:** `CreateHubScreen.js`, `ProfileScreen.js`, `SettingsScreen.js` (verified only)

---

## Phase 6 — Clean Inbox (Activity's "Upcoming" vs. Home's "Your Plans")

**Problem:** Once Phase 1–4 landed Home's "Your Plans" section, it started showing the same
commitment data as Activity's "⏰ Upcoming" group (any approved/hosted gathering in the next
24h) — a real, flagged-but-not-yet-resolved overlap.

**Decision (given directly by the user, not silently resolved):** Don't remove or leave
unchanged — give the two surfaces different jobs. Home's "Your Plans" = the one canonical
place for *every* upcoming commitment ("what's on my calendar?"). Activity's "Upcoming" =
a same-day nudge only ("what needs my attention right now?"), not a second calendar.

**What changed:**
- **`services/gatherings.js`** — `getUpcomingReminders()`'s window narrowed from 24h to
  ~12h (both the attending and hosting queries).
- **`ActivityScreen.js`** — "⏰ Upcoming" rows are now real, tappable `TouchableOpacity`s
  navigating to `GatheringDetail` (previously a plain, non-interactive `View` — tapping did
  nothing), with a new "View gathering →" link line making the tap-through obvious. Row
  content stays lightweight (title, role, "in 2 hours"-style time line) — deliberately **not**
  expanded into a duplicate of the full gathering card, per explicit instruction.
- Group already correctly disappeared entirely when empty (`reminders.length > 0` gate,
  pre-existing) — the narrower window feeds that same gate, no new suppression logic needed.

**What didn't change:** No location/venue line was added to each row, even though the
illustrative mockup showed one — the `gatherings` schema has no plain address/venue-name
field (only fuzzed `area`/`wide_area` text, unused elsewhere, and private `precise_lat/lng`
with no reverse-geocoded label anywhere in the codebase). Flagged rather than fabricated.

**Files touched:** `services/gatherings.js`, `ActivityScreen.js`

---

## Phase 8 — Weekly Recap ↔ Momentum merge

**What changed:**
- **`HomeScreen.js`** — the "This Week" card (previously its own bulleted-list card: a
  title plus up to two "✓ Attended N gatherings" / "✓ Made N new friends" lines) is now a
  single tappable row: a one-line summary (new `formatWeeklyRecap()` helper, joining only
  the real non-zero parts — e.g. "2 gatherings · 3 new connections", or just "2 gatherings"
  if no new friends that week) plus a **"View Momentum →"** link, navigating to the existing
  `Momentum` route (already reachable from Profile's "My Activity" group via Phase 5).

**What didn't change:** No new query — same `dashboard.weeklyRecap` shape
(`gatheringsAttended`/`newFriends`) already computed by `getHomeDashboard()`; only the
rendering changed. The card's visibility condition is unchanged (still renders only when at
least one real count is > 0 — no card, and no fabricated zero-state, for a quiet week).

**Files touched:** `HomeScreen.js`

---

## Verification (all three phases)

- Each phase built clean via `npx expo export --platform ios` — **1854 modules throughout,
  unchanged from baseline** (every change was an edit to an existing file, no new files
  added or removed).
- Each phase committed and pushed individually, not batched.
- `CLAUDE.md` updated with a full status note per phase, matching this project's established
  restart-safety documentation convention.

## Standing gap, same as every other phase in this file

**No manual device/simulator run-through** for any of Phases 6–8 — this sandboxed
environment has never had simulator/device access. Next session (or a real device pass)
should specifically confirm:
- Profile's collapsed business row renders/routes correctly in all three underlying states
  (managing a business, a pending/denied application on file, no application at all).
- Activity's "Upcoming" group genuinely disappears when nothing is within ~12h, still fires
  for both hosted and attended gatherings, and tapping a row lands cleanly on the right
  `GatheringDetail`.
- Home's Weekly Recap one-liner reads correctly with only gatherings, only new connections,
  and both present, and taps through cleanly to Momentum.

## Overall status

**All 8 phases of the Home/Profile/Settings/Inbox IA restructure (round 2) are now DONE.**
Nothing further scheduled against this plan unless a future device/simulator pass surfaces
something concrete to fix.
