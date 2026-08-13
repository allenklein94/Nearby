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
Status: NOT STARTED

## Batch 4 (HomeScreen, ActivityScreen, CommunityDetailScreen, BusinessProfileScreen, MyBusinessApplicationScreen, InviteFriendsScreen)
Status: NOT STARTED
