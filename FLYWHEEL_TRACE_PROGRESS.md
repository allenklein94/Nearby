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
3. invite an existing connection → where the invite lands — **WORKS, no gap**
4. invitee responds → resulting conversation surfaces — **WORKS for gatherings; was BROKEN for private communities, now fixed**
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

## Leg 3: invite an existing connection → where the invite lands — WORKS, no gap

`InviteFriendsModal.js` (opened from `GatheringDetailScreen.js`'s host banner and "You're in!"
panel, and `GatheringHubScreen.js`) calls `invite_friend_to_gathering` RPC for gathering invites
and `sendInvite('community', ...)` (→ `send_social_invite` RPC) for community invites. Read
both RPC bodies directly out of the reordered baseline
(`supabase/full_schema_pull_2026-08-09.sql:3066-3137` and `:4749-4794`) and confirmed both do
real friendship/blocks checks before inserting a real `social_invites` row
(`on conflict ... do nothing`, so re-inviting is idempotent, not an error). The gathering path
additionally sends a real push (`type: 'gathering_invite', gathering_id`) via `net.http_post` to
`send-push`. Confirmed the push tap correctly routes to a specific gathering:
`services/notifications.js:100-108`'s `routeNotificationTap()` case for
`gathering_interest`/`gathering_invite`/`gathering_reminder` navigates to
`GatheringDetail, { gatheringId: data.gathering_id }` when present. Confirmed the
non-push/persisted landing spot too: `getMyReceivedInvites()`
(`services/invites.js:27-68`) reads real pending `social_invites` rows the invitee can see
under their own RLS, resolves real gathering/community titles via two batched follow-up
queries, and is wired into `InboxScreen.js`'s Invites tab. No gap found.

## Leg 4: invitee responds → resulting conversation surfaces — WORKS for gatherings; found and fixed a real BROKEN case for private communities

`InboxScreen.js:152-166`'s `handleRespondSocialInvite()` calls `respondToInvite()` →
`respond_to_social_invite` RPC, then on accept deep-links straight to `GatheringDetail`/
`CommunityDetail` with the real target id. Read `respond_to_social_invite`'s body directly
(`supabase/full_schema_pull_2026-08-09.sql:4374-4392`) and confirmed it does exactly one thing:
flips the `social_invites` row's own `status` to `'accepted'`/`'declined'`. **It does not itself
grant membership or attendance of any kind** — for gatherings that's fine (accepting just
unlocks the ability to pass `join_gathering()`'s own `invite_only` check; the invitee still taps
Join on the Detail screen they were just deep-linked to, which is the same real flow leg 2
already verified — a real conversation, the gathering's Group Chat, becomes reachable once
they're approved, via `GatheringHubScreen.js:286/302/358` after landing in Hub).

**For communities, this was a real, confirmed BROKEN transition, not a hypothetical.**
`CommunityDetailScreen.js` shows an unconditional "Join Community" button for any non-creator
(`!isCreator`, lines 141-150) which calls `joinCommunity()` — a plain client
`.insert()` into `community_members` (`services/communities.js:83-95`), whose only real INSERT
RLS policy (confirmed by reading the live policy definition directly) allowed exactly two paths:
the community is public, or the caller is its creator. **An invited-and-accepted friend of a
*private* community — the one real case this whole invite feature exists for, since a public
community needs no invite at all — had no third path in.** Verified this was a real, live bug
against production, not just a code-reading inference: created a real private test community
owned by profile `Allen`, confirmed a genuinely uninvited profile (`Google voice`) correctly got
rejected by RLS; then had `Allen` call the real `send_social_invite('community', ...)` RPC to
invite friend `Claude`, had `Claude` call the real `respond_to_social_invite(..., true)` RPC to
accept, and then attempted the exact `joinCommunity()` insert shape as `Claude` — **it failed
with a real `42501: new row violates row-level security policy` error**, which
`CommunityDetailScreen.js:104-115`'s handler would have surfaced verbatim via
`Alert.alert('Error', e.message)` to a real user who did everything right. The invite could be
sent and accepted, but never actually redeemed — no membership, no community chat, "resulting
conversation surfaces" simply never happened.

**Fixed** (`supabase/migrations/20260809_social_invite_community_join.sql`, applied to
production and patched into both baseline copies, keeping them in sync): added a third path to
`community_members`'s INSERT policy — a real accepted `social_invites` row for that exact
`(community, invitee)` pair — alongside the existing "public" and "creator" paths. Matches this
schema's own established privacy convention for communities (real RLS enforcement, not just a
client-side gate — unlike gatherings, which deliberately use "RLS wide open, the RPC/client is
the real gate"), and mirrors the shape of the fix already applied to `join_gathering()`'s
`invite_only` check earlier the same day, just expressed as an RLS clause since community
membership has no RPC of its own to add a check to.
**Verified live, end-to-end, both directions**: re-ran the exact prior-failing scenario after
the fix — `Claude`'s join succeeded; confirmed a genuinely uninvited third profile
(`Google voice`) still correctly gets rejected (the fix didn't loosen anything beyond the
specific accepted-invite case); confirmed the now-real member can actually post in
`community_messages` (the literal "conversation surfaces" claim, not just a membership row —
`community_messages`' own INSERT policy already requires real `community_members` membership,
unaffected by this change). All test rows (community, both memberships, the invite, the one
test message) deleted afterward; production confirmed back to 0 communities/0 members/0
invites/0 messages, its exact pre-test state.
**Re-verified the full baseline file still applies cleanly to a truly empty database after this
edit** (same real docker-container method as the part-1 schema fix) — exit code 0, 119 policies
created including the new one, confirming this patch didn't reintroduce any ordering problem.
