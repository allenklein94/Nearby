# Implementation Notes — Nearby

*Basis: direct code reading across this audit's other files. **Refreshed 2026-08-09** — organized
by the same categories as the 2026-08-08 original, with each item's current status noted.*

## Duplicated

- **Two independent, duplicated `managed_partner_id` checks** (`ProfileScreen.js`/
  `SettingsScreen.js`) — unchanged.
- **Two near-duplicate business-partnership request flows** — unchanged.
- ~~The silent-send-failure pattern is copy-pasted across 4 chat screens~~ — **FIXED and
  actually centralized this time**: a new shared `src/hooks/useChatComposer.js` (34 lines) is
  now the one place this logic lives, imported by all 4 screens — the exact fix this note
  originally called for.

## Hardcoded

- **`App.js`**: Sentry/PostHog keys — unchanged, still normal practice for these SDKs.
- ~~`LoginScreen.js`, `ProfileScreen.js`, `RehearsalRoomScreen.js` call hardcoded Edge Function
  URLs~~ — **FIXED for these 3 specific files**, via a new `functionUrl(name)` helper in
  `services/supabase.js`. **But the same pattern is confirmed to still exist in 12 more files**,
  a genuinely new finding this refresh, not previously documented:
  `src/services/aiConcierge.js:55`, `textModeration.js:11`, `photos.js:122`, `proximity.js:60`,
  `presenceStatus.js:10`, `dataExport.js:10`, `account.js:15`, `extraPhotos.js:144`,
  `createAssistant.js:16`, `src/screens/ChatScreen.js:515,670,800`,
  `src/components/CompatibilityReportModal.js:39`. The fix that shipped was scoped to the
  literal 3 named examples, not to the underlying pattern.
- **`InviteFriendsScreen.js`**: hardcoded App Store URL — unchanged.
- **`LegalScreen.js`**: personal GitHub Pages domain — unchanged.
- **Project ref `enmosvippabmuqslzrox`** hardcoded across multiple files — unchanged.

## Fragile

- ~~`ChatScreen.js`'s `__DEV__ === undefined` check~~ — **FIXED, removed entirely** rather than
  corrected to a real condition (the whole debug branch is gone, not just patched).
- ~~`PlacesScreen.js`'s malformed `ListEmptyComponent` prop~~ — **FIXED.**
- ~~The 13-button `Alert.alert()` in `ChatScreen.js`~~ — **FIXED**, and turns out to have
  already been fixed before the last audit's own snapshot — see `PRODUCT_RISKS.md`.
- ~~Silent `catch` blocks around message sends~~ — **FIXED**, same shared-hook fix as above.

## Inconsistent

- **RLS posture varies by table with no naming/comment convention** — unchanged.
- **Admin action patterns are inconsistent** (`AdminVerificationScreen` RPC vs.
  `AdminBusinessRequestsScreen`'s Approve-RPC/Deny-raw-update split) — unchanged, confirmed still
  present this refresh.
- **Some AI/backend calls go through `services/`, others call `fetch()` directly** — unchanged in
  kind, though the specific 3 files originally named are fixed; see "Hardcoded" above for the
  now-known real scope (15 files total, not 3).
- **i18n key reuse** (`StressTestScreen.js` borrowing `timeline.noThoughtsYet`) — not
  independently re-checked this refresh; not re-flagged as new, assumed unchanged.

## Unused

- ~~`NoticesScreen.js`~~ — **no longer just unused, actually deleted.** The file is confirmed
  gone from the repo entirely (`ls` fails), along with its dangling `RootNavigator.js` import.
- ~~`MatchesScreen`'s import in `RootNavigator.js` is technically unused~~ — **FIXED, the
  dangling import itself is removed.** The screen file remains alive and composed inside
  `InboxScreen.js`, by design, unchanged.
- **Genuinely new findings this refresh, not previously documented**:
  - **`src/components/ActivityBell.js`** — confirmed zero importers anywhere in `src/` or
    `App.js`. Worth noting: the app's own internal history (`CLAUDE.md`) describes this
    component as a real `navigation.navigate('Notices')` call site as recently as Aug 8 — if
    that was ever true, it no longer is; the component currently has no live callers.
  - **`src/services/src/services/textModeration.js`** — a stray nested duplicate directory,
    content functionally identical to the real `src/services/textModeration.js` (one
    whitespace-only diff). Zero importers. Attributed via `git log` to a commit predating the
    last audit — not something newly introduced, just newly noticed.

## Potentially buggy

Everything previously listed here (`ChatScreen` debug overlay, `PlacesScreen` empty state,
`OnboardingRecommendationsScreen` identical handlers, 4-screen silent-send-failure) is now
**FIXED** — see `UX_GAPS.md`. No new item in this category was found this refresh.

## Difficult to scale

- ~~The missing local schema~~ — **FIXED, and replay-verified.** No longer the biggest
  scale-blocking issue — see `DATABASE_AND_DATA_MODEL.md`.
- **Client-side search/filtering** — unchanged, still a real ceiling once data volume grows.
- **`GatheringsScreen.js`/`ChatScreen.js`** — unchanged. `BusinessDashboardScreen.js` (1202
  lines) now also crosses the same threshold, a new observation from this session's own churn
  (three separate feature stacks landed in the same file), not a new class of risk.

## Likely to cause future technical debt

- ~~The relationship-longevity tools' Chat-menu-only entry pattern~~ — **RESOLVED**, a real
  consolidated hub now exists; this specific compounding risk no longer applies.
- **The duplicated `managed_partner_id` gating logic** — unchanged.
- **Hardcoded Edge Function URLs scattered across components** — the risk this note originally
  warned about is confirmed to have already partially materialized: the fix that landed only
  covered 3 of what turns out to be 15 real call sites.
- **The local-schema coverage gap compounding with each new feature** — **substantially
  mitigated.** The baseline is now a real, replay-verified source of truth, and the two newest
  migrations since it was cut are both confirmed genuine, clean incrementals — the "gap only
  grows" dynamic this note warned about was caught and corrected within the very refresh that
  would have let it compound (see `DATABASE_AND_DATA_MODEL.md`'s account of the one regression
  found and fixed this pass). The underlying discipline risk (a future session applying a schema
  change live without a matching local migration) is unchanged as a *practice* risk, even though
  the current state is now clean.
