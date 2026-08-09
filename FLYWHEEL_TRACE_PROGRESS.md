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
5. post-gathering → connection becomes a community — **WORKS for the linked-community case (real gap found + fixed); no path exists to spin up a brand-new community from a gathering's attendees — flagged, not built**
6. community creates its own gathering — **WORKS, no gap**
7. business/perk enters the loop — **WORKS (real gap found + fixed: community-scoped perks were invisible on CommunityDetailScreen)**
8. user returns afterward — **WORKS, no gap — also resolves a previously-flagged "not re-verified" item (gathering reminders)**

**All 8 legs of the trace are now complete.** (Verdicts and citations below.)

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

## Leg 5: post-gathering → connection becomes a community — real gap found + fixed (linked case); a bigger gap flagged, not built

Two separate sub-questions, since "a gathering's connection becomes a community" has two real
shapes in this schema: (a) a gathering already scoped to an existing community
(`gatherings.visibility = 'community'`, `community_id` set) — does the app actually surface
that link to someone experiencing the gathering? (b) a standalone gathering with no community —
is there any path to turn its attendee group into a brand-new community?

**(a) — real, confirmed gap, now fixed.** `getGatheringById()` (`services/gatherings.js:707`)
already selects `community_id` (`SAFE_GATHERING_FIELDS`, confirmed at line 22) but the query
never actually joined the community's own row, and `GatheringDetailScreen.js` had zero
references to `community`/`community_id` anywhere (confirmed via a full grep, zero hits) — a
gathering that's genuinely part of a community showed no sign of it anywhere on the one screen
built specifically to answer "can I see myself here?". This matches a lower-priority item
already flagged in CLAUDE.md's PRODUCT_AUDIT section ("no nudge to join the community behind a
gathering just attended") — confirmed here as a real, present-tense gap, not just a nice-to-have.
**Fixed**: added `community:communities(id, name, is_public)` to `getGatheringById`'s select
(`services/gatherings.js:707`) and a new tappable "🏘️ Part of a community" card on
`GatheringDetailScreen.js:368-378` linking to `CommunityDetail`. Deliberately reuses
`CommunityDetailScreen`'s own existing join/private-gating logic rather than duplicating it —
this card is just a wire, not a new join mechanism.
**Verified live against production, both branches**: created a real public test community + a
real community-scoped gathering, confirmed the embedded join resolves the community's real name
to a genuinely uninvited non-member (correct — public); created a second real *private* test
community + gathering, confirmed the identical embed query correctly comes back `null` for a
non-member (RLS silently drops it — the card correctly won't render, matching this schema's
established "communities are really RLS-enforced, not just client-gated" posture, unlike
gatherings) and confirmed it correctly resolves the real name for the community's own creator.
All test rows deleted afterward, confirmed `communities`/`gatherings.community_id` back to 0.

**(b) — confirmed genuinely unbuilt, deliberately not built this pass.** Grepped
`CreateCommunityScreen.js`/`services/communities.js`'s `createCommunity()` for any
seed-members/from-gathering param — none exists (`createCommunity({ name, description,
interestTag, isPublic })`, no member list). There is no code path anywhere that takes a
gathering's real attendee list and offers to found a new community from it — a host whose
one-off gathering went great has to build a community from scratch and re-invite everyone by
hand, no different from starting cold. This is a materially bigger feature than (a) — it needs
real UI (a "Start a community from this group?" prompt, most naturally on the post-gathering
feedback flow), a decision about who gets auto-added vs. invited, and product judgment about
when to even offer it (every gathering? only above some attendee count?) — not a wiring fix.
Flagged here, matching this session's own standing rule not to build a genuinely new feature
from outside-the-repo guessing; this is a real, trace-confirmed gap, but scoped out of this pass
same as the plan's "no new feature builds ... until the trace actually finds a real gap" already
anticipated — a real gap is now on record, a build decision is the user's to make, not
assumed here.

## Leg 6: community creates its own gathering — WORKS, no gap

Re-confirmed rather than assumed (this was reportedly closed in the Aug 8 navigation-audit pass).
`CommunityDetailScreen.js:203-215`'s "🎉 Host a Gathering for This Community" button (gated on
`isMember || isCreator`, not creator-only — any real member can propose a gathering for their
own community) navigates to `CreateGathering` with `initialVisibility: 'community'`,
`initialCommunityId: communityId`. `CreateGatheringScreen.js:166-179` reads both params into
real state (`setVisibility`/`setCommunityId`) and calls `loadCommunities()` so the Who step's
community picker is pre-loaded — the wizard doesn't silently skip the step, it shows it
pre-filled for confirmation (consistent with how AI-assisted prefills are handled elsewhere in
this file — shown, not skipped). `goNext()`'s own validation (line 258) confirms `communityId`
is genuinely set before allowing progress. `createGathering()` persists `community_id` correctly
(`services/gatherings.js:60`, `community_id: visibility === 'community' ? communityId : null`).
No gap found.

## Leg 7: business/perk enters the loop — real gap found + fixed (community-scoped perks were invisible)

The gathering side of this was already solid and re-confirmed, not just assumed: an approved
`business_partnership_requests` row sets `hosting_partner_id` on the target gathering/community
(per the Aug 8 "Create Consolidation" section), and `BusinessDashboardScreen.js` correctly
surfaces both via `getMyBusinessGatherings(partnerId)` (`hosting_partner_id = partnerId` filter,
confirmed at `brandOffers.js:240`) and `getBusinessCommunities(partnerId)` (same filter,
`communities.js:3-8`) — so a business that gets approved as a gathering or community's partner
can actually find it in their own dashboard to attach a reward. `GatheringDetailScreen.js`
already shows an inline "🎁 Community Perk" card for a gathering-tied offer (pre-existing,
confirmed at line 351).

**Real, confirmed gap found on the community side**: `brand_offers.unlock_community_id` (the
Rewards feature's group-unlock column, Aug 7 2026) lets a business scope a standing perk to any
specific community's member count — independent of whether that community's own
`hosting_partner_id` even points at the same business. But `CommunityDetailScreen.js` had zero
references to `offer`/`brand_offers` anywhere (confirmed via grep, only the unrelated
`isFollowingBusiness`/`followBusiness` imports existed) and `services/brandOffers.js` had no
function to fetch a community's own scoped offers at all (`getGatheringOffer(gatheringId)`
existed as the gathering-side equivalent; nothing analogous for a community). **Net effect: a
community-scoped perk was completely invisible to the community's own members** — the only way
to ever discover it was to already know to browse to that specific business's
`BusinessProfileScreen` and happen to notice an offer that referenced their community, or find it
via the general `BrandOffersScreen` list. For a perk whose entire point is "unlock this once your
community hits N members," the community itself — where members would actually see the progress
and rally toward it — showed nothing.

**Fixed**: new `getCommunityOffers(communityId)` (`services/brandOffers.js`, filters
`unlock_community_id = communityId, active = true`, same shape as `getGatheringOffer`) plus a new
"🎁 Community Perks" section on `CommunityDetailScreen.js` (`offers.length > 0` block) reusing
the exact unlock-progress/redeem pattern already established on `BrandOffersScreen.js` — locked/
unlocked copy, a real redeem button that calls the existing `redeemOffer()` RPC path, and
`ALREADY_REDEEMED`/`REDEMPTION_LIMIT_REACHED`/`OFFER_LOCKED` handled with the same honest
messages `BrandOffersScreen` already shows. Unlock progress reuses `memberCount`, a value
`CommunityDetailScreen` already fetches for its header (`getCommunityMemberCount`) — no extra
query needed, since a community's own member count *is* the unlock progress for a
community-scoped offer.
**Verified live end-to-end against production**: created a real public test community with 2
real members, a real Coastal Coffee offer scoped to it with `unlock_min_members: 3` — confirmed
the exact `getCommunityOffers` query shape resolves the offer + real partner name to a real
member under RLS; confirmed a real redemption attempt while still under threshold (2/3 members)
is genuinely rejected server-side (`OFFER_LOCKED`, the same trigger `BrandOffersScreen` already
relies on); added a third real member, confirmed the identical redemption now succeeds and
returns a real confirmation code. All test rows (community, memberships, offer, the one
redemption) deleted afterward; also restored the one test-side-effect this run caused
(`profiles.communities_created_today`, bumped by the earlier leg-5 test communities and this
leg's own test community, hit the real daily-limit trigger — reset to 0 via `trusted_update`
before creating the test row, then restored to its real pre-test value of 3 afterward, not left
at 0). Confirmed `communities`/`unlock`-scoped `brand_offers` both back to 0 afterward.

## Leg 8: user returns afterward — WORKS, no gap (also resolves a previously-flagged "not re-verified" item)

Traced both directions: what pulls a real, honest-signal-based user back, and does a tapped
reactivation push actually land somewhere real.

**Pull-back signals on Home, all wired and rendering, none orphaned** (checked
`getHomeDashboard()` in `services/homeDashboard.js` against `HomeScreen.js`'s actual render, not
just that both files exist): `sinceAway` (new people/gatherings since last visit) →
`HomeScreen.js:217-227`; `friendsActivity` (real friends' new gatherings, last 3 days) →
`HomeScreen.js:229-246`; `upcomingPlans` → `HomeScreen.js:247-...`; `weeklyRecap` (real
attended/new-friends counts) → `HomeScreen.js:320-328`; `getContinueYourCommunities()` and
`getPendingInvitesCount()` both imported and called (`HomeScreen.js:4,45,51`, already built and
verified in the Aug 8 "Invite People" follow-up pass). No dead/computed-but-unrendered field
found this time.

**Real, scheduled, deployed reactivation pushes — confirmed live via the Management API, not
just assumed from a migration file.** `cron.job` (queried directly against production) has 10
active jobs; two are genuine "bring a quiet user back" nudges: `send-momentum-reward-nudges`
(`0 15 * * 3`, weekly) and `send-gathering-reminders` (`*/15 * * * *`). Pulled
`send_momentum_nudges`'s real source via `pg_proc.prosrc` and confirmed it's a real signal
computation, not a placeholder — mirrors `getMomentumStats()`'s own weekly-bucket streak logic
exactly (8-week lookback, `date_trunc('week', ...)` boundaries) and only fires a streak nudge for
a real ≥2-week streak with no activity yet this week, falling through to a reward-tier-proximity
nudge otherwise (real `offer_redemptions` count against the same Bronze/Silver/Gold thresholds
`getMyRewardStatus()` uses). Both push types (`momentum_streak_nudge`, `reward_tier_nudge`)
correctly route to `Momentum`/`Rewards` on tap (`services/notifications.js:113-118`, confirmed
already wired).

**Also resolves a standing "not yet re-verified" item from earlier in this file**: the Aug 8
navigation-connectivity audit's `routeNotificationTap()` fix left one open question — "Whether
`gathering_interest`/`gathering_reminder` pushes are actually sent from anywhere live... wasn't
re-verified." Confirmed here: `send-gathering-reminders` is real, active, runs every 15 minutes.
Pulled `send_gathering_reminders`'s source and confirmed its push payload uses
`'type', 'gathering_reminder'` and includes a real `gathering_id` — exactly the shape
`routeNotificationTap()` already expects to deep-link into the specific `GatheringDetail`. No
gap; this was already correctly wired end-to-end, just never confirmed the server side was
actually live until this leg.

**No gap found in this leg.** No client file was touched — this leg was pure verification.

## Trace complete — summary

All 8 legs traced with file/line citations, no simulator used (per standing instruction). Real
bugs found and fixed along the way: leg 1 (onboarding cards not deep-linking), leg 4 (private-
community invites that could never be redeemed), leg 5 (community link invisible on
GatheringDetailScreen), leg 7 (community-scoped perks invisible on CommunityDetailScreen). One
real, larger gap found and deliberately not built (leg 5b — no path to found a new community from
a gathering's attendees), flagged for a future explicit product decision rather than built from
this session's own guess. One previously-flagged "not re-verified" item resolved as a side effect
of leg 8 (gathering reminders are genuinely live).
