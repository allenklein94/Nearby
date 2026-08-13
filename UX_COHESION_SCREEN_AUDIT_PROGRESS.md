# UX-cohesion item 1 — 26-screen error-handling audit progress

Restart-safety scratch file for the plan written into `CLAUDE.md`'s top section. If a codespace
restart hits mid-build, check this file plus `git log` for what's actually landed.

Pattern being verified/applied, modeled on `PlansScreen.js`:
- `loading` state, `loadError` state (both start appropriate defaults)
- `load()` (or equivalent) wraps its data fetch in `try { ... setLoadError(false) } catch (e) {
  setLoadError(true) } finally { setLoading(false) }`
- Render: `loading ? <spinner+caption> : loadError ? <LoadErrorState onRetry={load} /> : <content>`

## Batch 1 (ChatScreen, ChemistryDiaryListScreen, PaywallScreen, BillingScreen, LoginScreen, AIConciergeScreen)
Status: DONE, committed.
- FIXED: ChatScreen.js — `init()` had zero try/catch and was called as `init().then(...)` with no
  `.catch()`; wrapped the whole body, added `loadError`, added a `LoadErrorState` early-return.
- FIXED: ChemistryDiaryListScreen.js — `load()` had no try/catch around `getMyChemistryEntries()`;
  added `loadError` + try/catch/finally + `LoadErrorState` branch.
- ALREADY CORRECT: PaywallScreen.js — `.catch()` + `.finally()` chain already covers both fetches.
- ALREADY CORRECT: BillingScreen.js — `getSubscriptionDetails()` itself can never reject (traced
  into `services/purchases.js`); always resolves, failure renders as an honest unavailable card.
- NO INITIAL LOAD TO GUARD: LoginScreen.js — pure form screen, no fetch-on-mount.
- NO INITIAL LOAD TO GUARD: AIConciergeScreen.js — no mount-time fetch; user-triggered `handleAsk`
  already has correct try/catch/finally.
- Unrelated, not fixed (out of scope, flagged only): ChatScreen.js's shared `fetchPage` (used by
  4 chat screens via `usePaginatedMessages`) swallows Supabase errors and returns `[]` with no
  visible indication; LoginScreen.js's `sendOtp`/`verifyOtp` button handlers (not initial load)
  have unguarded awaits that could strand their own `loading` flag on a thrown (not `{error}`)
  failure.

## Batch 2 (BusinessDashboardScreen, FriendsScreen, BrandOffersScreen, EmergencyContactsScreen, PlacesScreen, BusinessAIAssistantScreen, BlockedUsersScreen)
Status: DONE, committed.
- FIXED: BusinessDashboardScreen.js — both `loadMyPartner()` (mount) and `loadStats()` (focus,
  gates the same loading branch) had zero error handling; added `loadError` + try/catch/finally
  to both + `LoadErrorState` branch.
- FIXED: FriendsScreen.js — `load()` had no try/catch at all (friends/pending/suggested fetches +
  photo resolution); a failure left a blank screen with no spinner even shown. Added `loadError`,
  a real loading spinner, try/catch/finally, `LoadErrorState` branch.
- FIXED: BrandOffersScreen.js — primary `Promise.all([getActiveOffers, getMyRedemptions])` had no
  try/catch; wrapped it (secondary progressive-enhancement fetches after `setLoading(false)` left
  untouched), added `loadError` + `LoadErrorState` branch.
- FIXED: EmergencyContactsScreen.js — `load()` had no try/catch; added `loadError` +
  try/catch/finally + `LoadErrorState` branch.
- FIXED: PlacesScreen.js — mostly already correct; the one gap was the very first await,
  `Location.requestForegroundPermissionsAsync()`, sitting outside the existing try/catch. Wrapped
  it to match the file's own existing pattern.
- NO INITIAL LOAD TO GUARD: BusinessAIAssistantScreen.js — pure chat UI, no fetch-on-mount; the
  one async call already has its own correct try/catch/finally.
- FIXED: BlockedUsersScreen.js — `load()` had no try/catch around the fetch + photo resolution;
  added `loadError` + try/catch/finally + `LoadErrorState` branch.
- Unrelated, not fixed (out of scope, flagged only): FriendsScreen.js's `loadCircles()` is
  fire-and-forget inside `load()`'s try block (a rejection there isn't actually caught by the
  surrounding try/catch — separate pre-existing issue); PlacesScreen.js's error copy says "pull
  down to try again" but there's no `RefreshControl` wired (retry is really via re-tapping a
  category chip); BusinessDashboardScreen.js has ~9 secondary `useFocusEffect` loaders
  (offers/gatherings/insights/communities/growth/conversations/topMembers/visitFrequency/
  partnershipRequests) with no try/catch of their own — none gate the main loading flag, so no
  stuck-spinner risk, but a failure in any leaves that section silently stale with no visible
  error.
- Verified via a full `npx expo export --platform ios` — clean, 1859 modules (unchanged from
  baseline — every touched file was an edit, no new files).

## Batch 3 (GatheringDetailScreen, GatheringHubScreen, ViewProfileScreen, GatheringConfirmationScreen, CommunitiesScreen, AdminVerificationScreen, GoodbyeArchiveListScreen)
Status: DONE, committed.
- FIXED: GatheringDetailScreen.js — `load()`'s primary `getGatheringById` call was unguarded
  (stuck-spinner risk); added `loadError` + wrapped the primary fetch, and separately wrapped the
  secondary enrichment fetches (cover photo, host stats, offer, attendees) so those fail quietly
  without reverting already-rendered content.
- FIXED: GatheringHubScreen.js — same shape of gap, `getGatheringById` in `load()` unguarded;
  added `loadError` + try/catch + `LoadErrorState` branch.
- FIXED: ViewProfileScreen.js — `load()` had zero try/catch around any of its several awaits
  (session, blocks checks, profile fetch, photos, compatibility report); wrapped the entire
  function body, added `loadError` + `LoadErrorState` branch.
- FIXED: GatheringConfirmationScreen.js — the mount-time `.then()` chain on `getGatheringById` had
  no `.catch()` (unhandled rejection + stuck spinner); refactored into a `useCallback` `load()`
  with try/catch/finally, added `loadError` + `LoadErrorState` branch.
- FIXED: CommunitiesScreen.js — `load()` had no try/catch, and the screen never rendered a loading
  spinner at all — a failure produced a permanently blank screen, not just a stuck spinner. Added
  `loadError`, a real loading-spinner branch (previously missing entirely), try/catch/finally,
  `LoadErrorState` branch.
- FIXED: AdminVerificationScreen.js — two gaps: the initial query's `error` was swallowed into a
  plain `setLoading(false)` (silently rendering a false "No pending submissions" empty state), and
  the second await (signed-URL fetching) was fully unguarded. Wrapped the whole `load()`, added
  `loadError` + `LoadErrorState` branch.
- FIXED: GoodbyeArchiveListScreen.js — `load()`'s `getMyGoodbyeEntries()` call was unguarded;
  added `loadError` + try/catch/finally + `LoadErrorState` branch.
- **Two real, unrelated, pre-existing crash bugs found and fixed in the same pass** (both trivial
  one-line import fixes, confirmed live before fixing, not left as flag-only): `ViewProfileScreen.js`
  called `Alert.alert(...)` in `handleAddFriend()` with `Alert` never imported from `react-native`
  — a `ReferenceError` on every tap of Add Friend, success or error path. `GoodbyeArchiveListScreen.js`
  used `<ScrollView>` in its main (non-loading, non-error) render with `ScrollView` never imported
  — this screen has been throwing on every real visit. Both fixed by adding the missing import.
- Verified via a full `npx expo export --platform ios` — clean, 1859 modules (unchanged from
  baseline — every touched file was an edit, no new files).

## Batch 4 (HomeScreen, ActivityScreen, CommunityDetailScreen, BusinessProfileScreen, MyBusinessApplicationScreen, InviteFriendsScreen)
Status: DONE, committed.
- FIXED: HomeScreen.js — the primary load path (session/profile fetch + `getHomeDashboard()`) had
  zero try/catch (stuck-spinner risk); wrapped the core fetch in try/catch/finally with `loadError`,
  kept the existing supplementary/location/weather fetches as their own nested non-blocking
  try/catches, added `LoadErrorState` branch.
- FIXED: ActivityScreen.js — the main chronological-feed loader (driving the skeleton-grid loading
  state) had no try/catch around any of its awaits; wrapped the whole body, added `loadError` +
  `LoadErrorState` branch. The three other group loaders (requests/invitations/reminders) already
  had correct, independently-swallowed try/catches — left untouched.
- FIXED: CommunityDetailScreen.js — `load()` had zero try/catch around any await (community fetch,
  session, membership, member count, gatherings, member list + photos, business-follow, offers);
  wrapped in try/catch/finally, added `loadError` + `LoadErrorState` branch (also fixes the
  pre-existing `!community`/not-found case, which previously also spun forever).
- FIXED: BusinessProfileScreen.js — `load()`'s core `Promise.all` had no try/catch; wrapped it,
  added `loadError` + `LoadErrorState` branch; left the existing fire-and-forget secondary
  `.then()` enrichments untouched since they don't gate `loading`.
- FIXED: MyBusinessApplicationScreen.js — never technically got stuck, but a genuine network
  failure was silently swallowed and misrepresented as "No application on file yet" with an Apply
  CTA — added a real `loadError` state/branch so a fetch failure now shows an honest retry state.
- FIXED: InviteFriendsScreen.js — `load()` had no try/catch, and also had an early `return` on
  `if (!id)` before `setLoading(false)` was ever reached (both a thrown error and the no-session
  edge case left the spinner stuck forever); wrapped in try/catch/finally (finally covers the
  early return too), added `loadError` + `LoadErrorState` branch.
- No unrelated bugs flagged.
- Verified via a full `npx expo export --platform ios` — clean, 1859 modules (unchanged from
  baseline — every touched file was an edit, no new files).

**All 4 batches (26 files) are now done.** Every touched file was also verified to parse cleanly
via a direct `@babel/core` parse pass (not just the bundler) before the final combined
`npx expo export --platform ios` — clean, 1859 modules, matching baseline exactly.
