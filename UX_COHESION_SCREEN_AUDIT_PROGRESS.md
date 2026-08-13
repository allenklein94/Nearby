# UX-cohesion item 1 — 26-screen error-handling audit progress

Restart-safety scratch file for the plan written into `CLAUDE.md`'s top section. If a codespace
restart hits mid-build, check this file plus `git log` for what's actually landed.

Pattern being verified/applied, modeled on `PlansScreen.js`:
- `loading` state, `loadError` state (both start appropriate defaults)
- `load()` (or equivalent) wraps its data fetch in `try { ... setLoadError(false) } catch (e) {
  setLoadError(true) } finally { setLoading(false) }`
- Render: `loading ? <spinner+caption> : loadError ? <LoadErrorState onRetry={load} /> : <content>`

## Batch 1 (ChatScreen, ChemistryDiaryListScreen, PaywallScreen, BillingScreen, LoginScreen, AIConciergeScreen)
Status: NOT STARTED

## Batch 2 (BusinessDashboardScreen, FriendsScreen, BrandOffersScreen, EmergencyContactsScreen, PlacesScreen, BusinessAIAssistantScreen, BlockedUsersScreen)
Status: NOT STARTED

## Batch 3 (GatheringDetailScreen, GatheringHubScreen, ViewProfileScreen, GatheringConfirmationScreen, CommunitiesScreen, AdminVerificationScreen, GoodbyeArchiveListScreen)
Status: NOT STARTED

## Batch 4 (HomeScreen, ActivityScreen, CommunityDetailScreen, BusinessProfileScreen, MyBusinessApplicationScreen, InviteFriendsScreen)
Status: NOT STARTED
