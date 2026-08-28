# Direct-synthesis working notes (Aug 28 2026 audit)

Scratch file for the parts of the plan explicitly done directly, not delegated: System 8
(Profile/Settings), cross-cutting findings discovered while checking system boundaries, and
prep for System 9's ranking table. Folded into the final deliverable once Pass A/B are both in
hand; not itself the deliverable.

---

## System 8 — Profile / Settings (done directly, verified against real code)

**Checked directly, not assumed from CLAUDE.md's own history** (`ProfileScreen.js`,
`SettingsScreen.js`, `CompleteProfileScreen.js`):

- Profile: leading "Your Plans" section (2 real quick-stat tiles) → "Your Connections"
  (Communities/Friends) → "Your Story" (Timeline/Memory Vault/Momentum/Rewards) → "Business"
  (own header) → a real visual break ("Edit Your Profile") → identity-editing fields. All
  confirmed present exactly as claimed (`ProfileScreen.js:644,656,672,768,795`). 🟢
- A real "🎛️ Preferences" row (`ProfileScreen.js:574`) deep-links into
  `Settings, { scrollToPreferences: true }` — confirmed the receiving half exists and works:
  `SettingsScreen.js` has a real `preferencesYRef`/`onLayout`/`scrollTo` wired to that param
  (`SettingsScreen.js:86-110,417-419`). 🟢
- A real profile-completeness card: shows the real %, an itemized list of exactly what's
  missing, and a "Complete Profile →" CTA that scrolls straight to the identity-editing section
  (`ProfileScreen.js:609-632`). This directly satisfies the plan's own named principle for this
  system — "if Nearby tells a user something is incomplete, it must say what is missing and let
  them fix it immediately." 🟢 **Positive control.**
- Settings: confirmed the real 7-group structure (Account / Preferences [4 sub-labels] /
  Notifications / Privacy & Safety [2 sub-labels] / Business (Admin) / Connect / Support) is
  live exactly as documented (`SettingsScreen.js:316,417,725,758,865,942,998`). 🟢
- `CompleteProfileScreen.js`: confirmed the real 3-step wizard (`STEP_DEFS`, progress dots,
  draft persistence across app restarts, a Sign Out safety valve present on every step) is
  live and matches CLAUDE.md's claims exactly (`CompleteProfileScreen.js:42,74,95-96,142-146,
  255-258`). 🟢 **Positive control.**

### Finding S8-1 — 🟡 The "say what's missing, let them fix it" principle is honored on Profile but not consistently extended to business account state

`BusinessDashboardScreen.js` still only ever shows a one-time `Alert.alert('Submitted for
Review', ...)` at 6 separate call sites (lines 564, 907, 1197, 1367, 1749, 1816) for every
content-screening submission (profile edits, experiences, offers, availability, updates, offer
responses) — confirmed via direct grep, **zero** persistent "pending review" badge/indicator
exists anywhere on the dashboard once the owner navigates away from the one-time alert. This is
CLAUDE.md's own already-self-disclosed gap (Decision 6 Phase 1's own "Not done" note: "no
persistent state anywhere telling them a change is still pending once they navigate away"),
**re-confirmed still true** on this pass, not newly discovered. Restated here because it's a
direct instance of the plan's own named system-8 principle *not* being honored on the one other
account-management surface (business account state) that has an analogous "something's not
final yet, tell the owner" situation to Profile's own completeness card, which *does* handle it
correctly. Not a P0 — no data is lost, nothing is broken — but a real, concrete inconsistency
between how Profile handles "you have something to finish" and how Business Dashboard does.

### Positive controls, system 8

- Profile completeness card (itemized missing fields + working CTA).
- The Preferences deep-link + scroll-to-section mechanism (reused, not reinvented, from the
  Dating Preferences consolidation work).
- `CompleteProfileScreen`'s wizard: draft auto-saves per-account, survives app restart, caps at
  the Photo step if restored past it (never silently satisfies the required-photo gate with a
  stale/broken local URI) — a real, careful correctness detail, not just a UI nicety.

---

## Cross-cutting finding — gathering fullness is honestly surfaced in exactly ONE of at least
## four places a gathering gets recommended to a user

**Found while grounding System 9's Capacity row, not part of either fork's assigned scope —
recorded here directly.**

CLAUDE.md's own Aug 28 2026 "Universal Signal Remediation Pass," P0 item 1, fixed gathering
fullness honesty — but re-reading the actual fix (and re-verifying it against current code)
shows it was scoped to exactly one surface: `HomeScreen.js`'s Ask-Nearby intent-result panel
(`intentResults`), where `item.isFull` genuinely renders a real "🔒 Full — Join Waitlist" state
(`HomeScreen.js:695`, confirmed live).

**Confirmed via direct grep that `isFull` appears nowhere else in the entire `src/` tree.**
Three other real surfaces recommend/rank/list gatherings and never check fullness at all:

- **`src/services/homeRecommendations.js`** (Home's own "🎯 Nearby Right Now" section, a
  *different* code path from the Ask Nearby resolver) — `scoreGathering()` checks interest
  match, distance, happening-now, weather, and positive-experience-history, but never capacity/
  `isFull` (confirmed via grep — zero hits for either term in the file). A fully-waitlisted
  gathering can score #1 here with nothing telling the viewer it's full before they tap in.
- **`src/screens/GatheringsScreen.js`** — the single most-used browse surface in the app (three
  tabs: nearby/attending/hosting). Zero fullness/capacity/spots-left indication anywhere on a
  browse card (confirmed via grep: the only "waitlist" references in the whole file are the
  post-tap `Alert.alert` shown *after* attempting to join, e.g. lines 425-426, 444-445) — a user
  only learns a gathering is full once they've already tried to join it, never from the card
  itself.
- **`src/screens/DiscoverHubScreen.js`** — zero references anywhere to capacity, fullness, or
  waitlist (confirmed via grep, zero hits). Discover's own Recommended/Trending sections carry
  the identical risk.

**Why this matters**: the P0 fix's own locked design explicitly states the reasoning this gap
now violates on three of four surfaces: *"never silently rank a dead-end result #1... show
fullness on the result card itself, never hide the result."* That principle was applied
correctly to one card type and never generalized to the other three real places a gathering
recommendation/browse card renders. This is exactly the class of "does a discovered gathering
ever create a dead-end" question Systems 1, 2, and 5 of this whole audit ask directly — and the
honest answer, checked directly rather than assumed from the P0 fix's own success, is: partially.

**Severity**: 🟠 P1 — Inconsistent. Not broken (joining still correctly waitlists you, nothing
crashes or lies about your own status) — but the same honesty principle the app explicitly
already committed to, and already built once, is silently absent from the majority of places a
user actually encounters a gathering recommendation. A user is more likely to hit this on
`GatheringsScreen.js` (the primary browse surface) than on the Ask Nearby panel it was actually
fixed for.

---

## Recency signal — spot-checked, not exhaustive

`homeRecommendations.js`/`intentResolverScoring.js` both operate over an already-fetched,
already-ordered candidate list (chronological/soonest-upcoming base order) before applying their
own scoring — recency is present as an implicit tie-break/base order everywhere checked, never a
first-class scored signal on its own. Matches Pass B's own note for Gatherings/Business. Not
separately re-verified per-surface beyond this; treat as consistent-by-default rather than
exhaustively re-confirmed for Dating/Friends/People.

---

## "Right Now"/"Today"/"This Week" canonical window — re-verified, still consistently wired

Confirmed live: `utils/rightNowWindow.js`'s `isWithinRightNowWindow()` is genuinely imported and
used by both `GatheringsScreen.js:36,93` (the "Right Now" chip) and
`intentResolverScoring.js:15,156` (the ask-box's own `dateWindow === 'now'` branch) — P2 item 8's
claim holds. **Also re-confirmed still open, exactly as CLAUDE.md's own text already discloses**:
`homeDashboard.js`'s separate `happeningNow` signal (Home's "Happening Near You" row,
`homeDashboard.js:418`) does NOT import `rightNowWindow.js` — it's still the original,
independent, mirror-image 30min/2h window, never reconciled with the canonical definition. Not a
new finding — restating because it's directly relevant to System 1 (Home) and the ranking table.
