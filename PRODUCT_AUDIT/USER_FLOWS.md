# User Flows — Nearby

*Basis: `RootNavigator.js`'s route wiring, the per-screen "Reached from"/"Links to" data in
`SCREEN_INVENTORY.md` (itself built from a full repo grep of every navigation call), and
service-layer function names confirmed via the `.from()`/`.rpc()` grep. Each flow below lists
the real screen sequence; where a step's completeness is uncertain or was flagged as broken in
`SCREEN_INVENTORY.md`, that's called out inline rather than glossed over.*

## A. New user onboarding

`Onboarding` (welcome splash) → `OnboardingQuestions` (3-step questionnaire, staged to
AsyncStorage) → `OnboardingLocation` (near-me/city/traveling choice — **this choice is
discarded, never persisted or used downstream**, per `SCREEN_INVENTORY.md`) → `Login`
(phone-number OTP) → **hard gate**: `CompleteProfile` (name, 18+ birthdate check, required
photo, interests, ToS/Privacy consent — nothing else in the app is reachable until this is
done) → auth context flips `profileComplete`, `RootNavigator` swaps to the authenticated stack
→ once, via an imperative nav-ref call (not a normal route in the flow), `OnboardingRecommendations`
fires (gated on a `just_completed_signup` flag) showing a personalized recommendation list —
**but tapping an individual recommendation card does the same generic "Let's Go" action
regardless of which one was tapped** (confirmed bug, see `SCREEN_INVENTORY.md`) → lands on
`MainTabs` (`Home`).

**Where a user can fall out**: the profile-completion gate is a hard wall with no visible way
to preview the app before committing a photo — reasonable for safety/verification reasons, but
worth naming as a real drop-off point. The onboarding-location choice being silently discarded
means the personalization the flow implies ("we're tailoring this to your answer") doesn't
actually happen for that particular question.

## B. Discover something

`Discover` tab (`DiscoverHubScreen`) → unified text search or type filter chip
(All/Gatherings/Communities/Places/Perks) → list or map view → tap a result → lands on the
type-specific detail screen (`GatheringDetail`, `CommunityDetail`, `BusinessProfile` via a
perk, or an external Google Maps link for a Place). Alternatively: "✨ Ask AI Concierge" →
`AIConciergeScreen` → free-text query → tap a returned suggestion → same detail screens.
People-discovery is a deliberately separate flow (see below), not part of unified search.

## C. Join a gathering

`GatheringDetail` (reached from Discover, Home, Gatherings list, a shared deep link, or a push
notification) → tap "JOIN GATHERING" / "REQUEST TO JOIN" / "JOIN WAITLIST" (label depends on
`is_public` and current capacity) → `GatheringIntentModal` (private "what are you hoping for"
signal, never shown to the host) → confirm → for an auto-join (`is_public`) gathering,
`navigation.replace('GatheringHub', { justJoined: true })` shows a 2.2s "You're In! 🎉" banner
before revealing the full live hub; for a host-approval gathering, the user stays on
`GatheringDetail` in a "pending" state until the host acts. If the gathering is full, the same
CTA instead adds the user to a real waitlist queue that auto-promotes on a later cancellation
(per `CLAUDE.md`, independently confirmed via the `capacity`/`gathering_interest` schema notes
in `DATABASE_AND_DATA_MODEL.md`). From `GatheringHub`: ice breakers deep-link into
`GatheringChat` with a prefilled draft, "I'm On My Way"/"Check In" are self-reported taps (no
GPS verification), and a post-join "Want to bring someone?" growth prompt offers Invite/Share/Skip.

**Where a user can fall out**: a host-approval request has no visible "how long will this
take" expectation-setting, and (per `CLAUDE.md`) no in-app way to withdraw a pending request —
only an already-*approved* attendee can `leave_gathering()`.

## D. Create a gathering

`Create` tab (`CreateHubScreen`, an icon grid) → tap a category icon (skips straight into the
wizard with title/category prefilled, `fromQuickPick: true`) or "Something Else" (inline
free-text box → `create-assistant` Edge Function classifies intent) → `CreateGatheringScreen`
multi-step wizard: What (skipped if quick-picked) → Who (Everyone/Friends/Community/Invite
Only — a discovery-scope axis, separate from the public/host-approval axis) → When (deterministic
preset buttons or a picker — the AI never infers date/time) → Where (Near Me or a real
Google-Places-backed "Choose a Place" search — no true "decide later" skip-location state
exists, a deliberate scope decision per `CLAUDE.md`) → Details (optional description + a
collapsed "More options" for recurrence/map-visibility/women-only/capacity) → Publish (real
preview card, "Start Gathering" button) → `GatheringConfirmationScreen` (real
`nearby://gathering/:id` share deep link + friend-invite with shared-context hints, replacing
what used to be a dead-end `Alert.alert`).

## E. Invite an existing connection

Two structurally different mechanisms exist side by side:
1. **Gathering/community invites** (`social_invites` table): `GatheringDetailScreen`/
   `CommunityDetailScreen`'s "🤝 Invite friends" button, or `GatheringsScreen`'s
   nearby/attending-tab "Invite friends" button → `InviteFriendsModal` → friends-only picker
   (blocked/non-friend targets rejected server-side) → `send_social_invite` RPC → recipient
   sees it in `Inbox`'s Invites tab, or via `getPendingInvitesCount()`'s Home banner → Accept
   deep-links straight into `GatheringDetail`/`CommunityDetail`.
2. **App referral** (a completely separate concept, `InviteFriendsScreen.js` from Settings): a
   redeemable referral **code** + App Store link shared via the native Share sheet, for
   growing the user base itself, not inviting to a specific gathering/community. These two
   "invite" concepts share a name in casual language but are unrelated mechanisms with
   unrelated UI — worth being explicit about for anyone tracing this flow (see `UX_GAPS.md`).

## F. Join/create a community

**Join**: `Communities` (from Discover or Profile) → browse public communities or search →
`CommunityDetail` → "Join Community". **Create**: `Create` tab's secondary row → `CreateCommunity`
(name/description/category/public-private) → `.replace` into the new `CommunityDetail`.
Once joined: `CommunityDetail` surfaces a member/leader list (creator can promote/demote
leaders), a List/Calendar toggle for the community's gatherings, a "🎉 Host a Gathering for
This Community" button (pre-fills `CreateGathering`'s Who step), and "🤝 Invite Friends"/
"🤝 Request a Business Partner" for members/creators.

## G. Message someone

**1:1**: a `matches` row exists (from a mutual Notice, or per `CLAUDE.md`, from certain
gathering-based match paths) → `MatchesScreen` (embedded inside `InboxScreen`'s Messages tab,
not an independent route) → tap a match → `ChatScreen` (text/voice/photo/video/GIF/reactions/
translation/disappearing messages). **Group**: `GatheringChat`/`CommunityChat`, reached from
the respective detail screen, `GatheringHub`, or `Inbox`'s "Group Chats" chip row. **A real,
verified gap in all four chat-style screens** (1:1 + both group types + business DM): a failed
send silently loses the user's already-cleared composer text with no visible error (see
`SCREEN_INVENTORY.md`) — this is a real risk to trust in the core communication loop.

## H. Participate in a gathering

Covered mechanically in flow C's `GatheringHub` section. Beyond the join moment: real-time
weather via `getSocialForecast()`, a meetup-point map (exact coordinates, narrowly scoped to
host + approved attendees only), category-keyed ice breakers and prep tips (static content, not
AI-generated), self-reported On My Way/Check In, and post-gathering `GatheringFeedbackModal`
(rating + a "what's next" prompt offering Coffee/Dinner/Another walk chips that prefill a new
`CreateGathering`, or "Join next week" browsing `Gatherings`).

## I. Receive/use a business perk

Perk discovery: `BrandOffersScreen` (reached from Matches, Discover, Home, Gatherings,
Settings, AI Concierge) or a specific gathering's "Community Perk" card
(`GatheringOfferBadge`/`GatheringDetailScreen`) or a `BusinessProfileScreen`'s active-offers
section. Redemption: tap "Redeem" → `redeemOffer()` (checks redemption limit, and — for
group-unlock offers — a real server-side threshold enforced by an `enforce_offer_unlock_threshold()`
trigger, per `CLAUDE.md`; the UI shows live "6/10 members joined" progress and a disabled
"Locked" state pre-threshold). No in-app QR/proof-of-redemption flow was found in the screen
inventory — **how a business actually confirms in-person that a redemption is real (beyond the
app recording it) is UNCLEAR from the code alone** and worth a direct product question.

## J. Business onboarding

Two independent paths: (1) a business not yet in the app at all uses
`BusinessPartnerApplyScreen` ("Partner With Us," from Settings) → generic application →
`business_partner_requests` → `AdminBusinessRequestsScreen` (admin approve/deny). (2) once
approved and `profiles.managed_partner_id` is set (a manual/admin-side linkage, per `CLAUDE.md`
— no self-serve account-claiming flow was found), the owner reaches `BusinessDashboardScreen`
from either `ProfileScreen`'s or `SettingsScreen`'s "Switch to Business"/"Manage Your Business"
row (two independent, duplicated gating checks — see `NAVIGATION_AND_IA.md`). **A real,
admitted gap**: the dashboard's own "Business" tab states editing name/description/logo isn't
built yet ("contact support to make changes for now") — so full self-serve onboarding
(claim → configure → go live) is not actually complete end-to-end.

## K. Business creates a gathering

Not a distinct business-specific flow — a business owner uses the exact same `Create` tab /
`CreateGatheringScreen` wizard as any consumer. The business connection happens differently:
either a business sets `hosting_partner_id` on their own gathering (mechanism not confirmed in
this pass — `SCREEN_INVENTORY.md`/`DATABASE_AND_DATA_MODEL.md` don't show a dedicated "create as
my business" toggle in `CreateGatheringScreen`), or — the far more built-out path — a
consumer host uses `RequestBusinessPartnerScreen` to *ask* a business to sponsor their
already-created gathering, which the business approves/declines from
`BusinessDashboardScreen`'s Partnership Requests section. **Whether a business can unilaterally
host its own gathering (vs. only ever being invited to sponsor someone else's) is UNCLEAR from
the code reviewed in this pass** and worth a direct question.

## L. Business manages its community

Businesses don't create/own communities directly in anything found in this audit —
`communities.hosting_partner_id` exists (per `CommunityDetailScreen`'s field list in
`SCREEN_INVENTORY.md`) implying a business *can* be affiliated with a community, shown via a
"View Business Profile" link on `CommunityDetailScreen`, and `BusinessDashboardScreen` has a
dedicated "Community" tab (per the screen inventory) — but the actual mechanism for how a
business becomes attached to a specific community (self-serve vs. via
`RequestBusinessPartnerScreen`'s `target_type: 'community'` path, the same partnership-request
flow used for gatherings) is the more clearly-confirmed route. From the dashboard's Community
tab, a business owner can see community-linked analytics and (per `CLAUDE.md`) a "Most
Engaged" member leaderboard with per-member visit-history drill-in and direct-message outreach.

## M. Business partnership flow

The clearest, most fully-built business flow in the app. Initiator (a gathering host or
community creator/leader) → "🤝 Request a Business Partner" (from `GatheringDetailScreen`,
`CommunityDetailScreen`, or the top-level `Create` tab with a target picker) →
`RequestBusinessPartnerScreen` → search real active businesses by name → send request
(`request_business_partnership` RPC, verified server-side to actually own/host the target) →
business owner sees it in `BusinessDashboardScreen`'s Partnership Requests section →
Approve/Decline (`respond_to_business_partnership_request` RPC, sets `hosting_partner_id`
atomically on approve) → requester notified via push either way.

## N. Switch between consumer and business mode

There is no real "mode switch" — see `NAVIGATION_AND_IA.md`'s "Business Mode — not a tab"
section. A business-managing user sees the identical 5-tab shell as everyone else; the only
difference is a conditionally-shown dashboard entry point in two places (Profile, Settings)
that both push into `BusinessDashboardScreen`, which independently re-resolves the caller's own
managed business on every mount (so direct navigation without the hidden buttons still shows a
safe "no business found" state rather than leaking data). There is no persistent visual
indicator anywhere in the shell that a business-managing user is "in" business context — they
would need to actively navigate back to `BusinessDashboard` to return to it after leaving.
