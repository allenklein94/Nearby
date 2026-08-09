# Flywheel Trace Audit — progress tracker (Aug 9 2026)

Incrementally-updated scratch file for the "Plan, part 2" trace audit described in CLAUDE.md's
"Outstanding: schema baseline fix + flywheel trace audit" section. Purpose: survive a codespace
restart mid-audit without losing findings — same restart-safety convention as everything else in
this session. Final verdicts get folded into CLAUDE.md once all 9 legs are done; this file is
scratch/working notes, not itself meant to be the permanent record.

Method: real code reading (navigation params, RPC calls, screen wiring) — no simulator, per
standing instruction. Every verdict below cites file/line.

## Legs and status

1. new user opens the app → discovers a gathering — **WORKS (after a real, now-fixed bug)**
2. gathering detail → join — **WORKS, no gap**
3. invite an existing connection → where the invite lands — PENDING
4. invitee responds → resulting conversation surfaces — PENDING
5. post-gathering → connection becomes a community — PENDING
6. community creates its own gathering — PENDING
7. business/perk enters the loop — PENDING
8. user returns afterward — PENDING

(Verdicts and citations added below as each leg completes.)

## Leg 1: new user opens the app → discovers a gathering — WORKS (bug found + fixed)

**Real bug found and fixed**: `OnboardingRecommendationsScreen.js` (the very first "discover a
gathering" surface a brand-new user sees, shown once right after `CompleteProfile` via the
`just_completed_signup` flag in `RootNavigator.js:294-303`) fetched real, specific
`gatherings` rows (`getOnboardingRecommendations()`, `services/homeDashboard.js:257-277` — real
`wide_area`-matched, `is_public`, future-dated gatherings, honestly interest-scored) and
rendered one tappable card per gathering — but every card's `onPress` was
`navigation.navigate('MainTabs')` (line 51, and the "Let's Go" button at line 80, correctly
also `MainTabs`), completely ignoring which specific gathering `r.id` was tapped. This matches
a bug already flagged as a known lower-priority item in CLAUDE.md's PRODUCT_AUDIT section
("`OnboardingRecommendationsScreen.js`'s recommendation cards all navigating identically
regardless of which was tapped") — re-confirmed here as the very first hop of the flywheel,
not just a minor polish item: a brand-new user's literal first "discover a gathering" tap did
nothing but land them on the generic Home tab.
**Fixed**: confirmed `OnboardingRecommendations` is registered in the same `session &&
profileComplete` branch of `RootNavigator.js`'s `Stack.Navigator` as `GatheringDetail` and
`MainTabs` (lines 318-323) — so, unlike the pre-auth deep-link case elsewhere in this file, no
AsyncStorage-pending-nav workaround is needed; `GatheringDetail` is already mounted and
reachable directly. Changed the per-card `onPress` (line 51) to
`navigation.navigate('GatheringDetail', { gatheringId: r.id })`, matching the exact param shape
`GatheringDetailScreen` already reads everywhere else (Home's `bestPick`, Discover's cards, all
three `GatheringsScreen` tabs — all independently re-checked here and confirmed still correctly
wired to `GatheringDetail` with a real `gatheringId`, `HomeScreen.js:305`,
`DiscoverHubScreen.js:313/373/400/427`, `GatheringsScreen.js` ×6). The "Let's Go" footer button
staying on `MainTabs` is correct and unchanged — that's an intentional "skip recommendations,
just enter the app" action, not a per-gathering tap.
**Not touched**: the empty-state copy, the "first mission" card, and the overall onboarding
flow before this screen (Onboarding → OnboardingQuestions → OnboardingLocation →
Login/CompleteProfile) — out of scope for this leg, no gap found there.

## Leg 2: gathering detail → join — WORKS, no gap found

Re-verified rather than assumed, since so much of this has already been built/fixed across
several earlier sessions this same day (Gathering Detail redesign, Capacity/Waitlist,
invite-only hardening). `GatheringDetailScreen.js`'s join CTA area (lines ~490-540) correctly
branches on `gathering.myStatus === 'waitlisted'` / `gathering.visibility === 'invite_only' &&
!gathering.hasInviteOnlyAccess` / default, with honest button copy (`JOIN WAITLIST` /
`JOIN GATHERING` / `REQUEST TO JOIN` depending on `isFull`/`is_public`). `handleConfirmIntent()`
(line 126) calls `expressInterest(gatheringId)` → `services/gatherings.js:368-372` →
`supabase.rpc('join_gathering', ...)`. Read the live `join_gathering()` definition directly out
of the (now-reordered) baseline file (`supabase/full_schema_pull_2026-08-09.sql:3175-3244`) and
confirmed all the checks documented elsewhere in this file are really there in this exact
function body: row-locked capacity read, `Cannot express interest in your own gathering` guard,
the `invite_only` → real accepted `social_invites` check, `women_only` guard, mutual-blocks
guard, and capacity-aware approve/waitlist branching. On `status === 'approved'` the screen
`navigation.replace('GatheringHub', { gatheringId, justJoined: true })` (line 152) — confirmed
`GatheringHubScreen.js` registers and reads both params correctly (see leg 5 below for what
happens inside Hub). No gap found in this leg.
