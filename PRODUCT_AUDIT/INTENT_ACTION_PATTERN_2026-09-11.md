# Item 36 — "One intent → action pattern everywhere"

Status: IN PROGRESS, started 2026-09-11.

## User's framing (verbatim)

> I want something → Nearby understands → Nearby shows me options → I choose → Nearby helps me
> make it happen.

This is the whole Thursday plan's underlying goal restated as one architecture principle: when a
new user touches Nearby for the first time, nothing should make them stop and wonder "why did it
do that?" Everything else in the app should support this one loop.

## The four example chains, as given

1. "I want dinner." → restaurants → friends/match → availability → plan → reservation
2. "I want something to do tonight." → events/activities → options → invite people → plan
3. "I want to meet people." → Dating/Friends → relevant people → connect → plan something
4. "I want to build something." → Community/Gathering → create → attract people → connect
   businesses where appropriate

## What already exists (from prior sessions, per CLAUDE.md / memory `project_intent_engine_vision`)

- `resolveIntent()` / `intentResolver.js` — Home's ask-box free-text → categorized results
  (gatherings, business_availability, communities, perks, etc.), taxonomy-driven
  (`gatheringCategories.js`'s 19-group/75-tag vocabulary), scored (`intentResolverScoring.js`).
- `experienceAssembly.js` — regroups already-resolved candidates into an assembled multi-step
  experience (e.g. dinner → activity → dessert) for occasion-shaped asks, including business
  self-declared bundles.
- `dateProposals.js` / `DateProposalScreen.js` — "Plan" flow with a real "Find something nearby"
  business-availability search bound into the invite (2026-09-10, item 4).
- "Surprise Me" (item 28) — mood-based one-shot suggestion with a "you could go with {friend}"
  enrichment when real interest-overlap exists.
- Dating/Friends discovery, relationship-state standardization (items 32/33), Plan-Together entry
  points from match celebration/profile/gathering/business screens (item 21).
- CreateHubScreen mirroring Discover's own taxonomy (item 20), with a "With businesses" ask path.

## What this audit is actually checking

Not whether intent resolution exists (it does) — whether each of the 4 chains above completes
end-to-end without the user being dropped onto a disconnected screen or having to manually
re-discover the next step. Specifically per chain:

1. Dinner: does resolving "dinner" actually offer a path to (a) inviting a friend/match and
   (b) something that behaves like a reservation/commitment, or does it stop at "here are some
   restaurants"?
2. Tonight: does "something to do tonight" flow into a real invite-people step, or just show a
   list?
3. Meet people: does connecting (friend accept / match) actually surface "plan something" as a
   next step inline, or does the user have to go hunting?
4. Build something: after creating a community/gathering, is there any real guided next step
   toward attracting people / connecting a business, or does it just drop the user on the new
   empty community page?

## Rules for this pass

- Audit first. Fix contained routing/copy/missing-next-step gaps directly (same standard as items
  25/26/34).
- Do NOT redesign the intent engine or restructure navigation architecture unilaterally. If a gap
  requires real structural work, write it up as a proposal here and stop — don't execute it.
- Standing conventions apply: no fabricated signals, no stranger discovery via intent, AI never
  assigns date/time, migration/verification discipline, incremental commits.

## Findings / fixes so far

Traced all 4 chains through the actual current code (not re-derived from memory). **Chains 2, 3,
and 4 already complete end-to-end** — built across prior sessions, verified by reading the real
code paths below. **Chain 1 has one real, structural gap**, documented as a proposal rather than
built (see rules above — this needs new DB/RPC work, not a small connecting fix).

### Chain 2 — "something to do tonight" — already complete, no fix needed

`detectFriendDiscoveryIntent`/`resolveIntent` → gathering results (`HomeScreen.js`) → tap →
`GatheringDetail` → real "🤝 Invite friends" action (`InviteFriendsModal`, already wired in 3
places on that screen depending on host/attendee/invite-only state) → RSVP. Full loop, no gap.

### Chain 3 — "meet people" — already complete, no fix needed

Home's ask box already classifies a genuine "I want to meet people" ask via
`detectFriendDiscoveryIntent()` → a real synthetic `friend_discovery` result item
(`buildFriendDiscoveryResultItem()`) → tap → `FriendDiscoveryScreen` (the real, explicitly
opt-in friend-discovery surface, never a stranger's profile directly). Connect (friend accept /
dating match) → both `FriendsScreen` and `ViewProfileScreen` already surface a real "Plan
Something" action once the relationship is `accepted` (items 21/31/32/33). One asymmetry noted,
not fixed (optional polish, not a dead end): a new dating match gets a proactive
`MatchCelebrationModal` with an inline "Plan Together" button; accepting a friend request has no
equivalent proactive moment — the Plan Something action exists and is reachable immediately, just
not surfaced in-the-moment. Not a "stops short" bug per this audit's own scope (Q3/Q4 both answer
cleanly — a real action exists and leads somewhere coherent), so left as a disclosed opportunity
rather than built speculatively.

### Chain 4 — "build something" — already complete, no fix needed

Gatherings: `CreateGatheringScreen` → `GatheringConfirmationScreen` (a dedicated post-create
screen, not a bare drop-off) with real Share/Invite-a-friend/Invite-a-circle actions
(`sendInvite`), plus `businessesAsked` already surfaced from the create flow itself (connecting a
business at creation time, not a separate afterthought step). Communities:
`CreateCommunityScreen` → `CommunityDetailScreen` directly, which already has its own "🤝 Invite
Friends" action (same `InviteFriendsModal`) and, per item 33's own fix this session, a working
"Ask..."/"Request a specific business" chooser. Both halves of "attract people / connect
businesses where appropriate" are real and already wired.

### Chain 1 — "I want dinner" — real structural gap, PROPOSAL (not built)

The order in the user's own chain is restaurants → **friends/match** → availability → plan →
reservation — i.e., discover the restaurant first, then loop in a specific person. Traced this
exact path: Home's ask box resolving "dinner" → a `business_availability` result → tap → lands on
`AskBusinessScreen` with **no matchId/gatheringId/communityId** (`HomeScreen.js`'s
`handleIntentResultTap`, business_availability branch) → `submitBusinessRequest()` (the fully solo
path) → `BusinessRequestDetailScreen`.

**The only way a second person ever enters this specific flow today is
`getGroupPlanCandidates()`/`proposeGroupPlan()`** — and it only surfaces people who **already,
coincidentally, have their own separate open business request in the same category** (confirmed
by reading `propose_group_plan`'s own client wrapper in `groupPlans.js`: its own header comment
states plainly "every candidate participant still has to come from a real, already-open
business_requests row belonging to someone the caller is genuinely connected to" — this is a
deliberate existing design decision, not an oversight). There is no way to deliberately pick one
specific already-connected friend or match and invite them into your own open (or already-
accepted) personal request.

The *other* real mechanism that would seem to cover this, `createBusinessRequestForMatch()` /
`create_business_request_for_match` (used by `DateProposalScreen`'s "Find something nearby"), only
runs in the **reverse** direction — you have to start from an existing dating match and propose a
plan first, then the business search binds to that match. It's also match-only (`matches.id`),
not usable for a friend at all — friends have no equivalent binding RPC. So today, "restaurant
first, then invite someone" and "invite a friend (not just a dating match) to a business plan at
all" are both genuinely unbuilt for the forward direction the user described.

**Why this isn't being built in this pass**: closing it for real needs either (a) a new RPC
letting a request owner invite a specific connected friend/match directly (bypassing the
"they must already have their own open request" requirement `propose_group_plan` currently
enforces by design), or (b) extending `create_business_request_for_match`-style binding to accept
a friendship as well as a match, plus new UI (a friend/match picker on `AskBusinessScreen` and/or
`BusinessRequestDetailScreen`). Either is real schema/RPC work and a real product decision (does
inviting someone into an already-submitted solo request retroactively convert it into a group
request? does it require the same mutual-consent shape `group_plan_participants` already
enforces?) — exactly the kind of call this pass's own rules say to surface, not execute
unilaterally.

**Proposal for the user's review**: add a "Bring someone?" step — either a pre-submission
friend/match picker on `AskBusinessScreen` (skip the coincidental-matching group-plan path
entirely for a deliberate invite, submit directly as a 2-person request) or a post-submission
"Invite a friend to this request" action on `BusinessRequestDetailScreen` reusing
`InviteFriendsModal`'s existing friend-list UI, wired to a new RPC that adds the invitee straight
into `group_plan_participants` without requiring them to already have their own request. Either
shape is a genuinely separate build, not folded into this pass.

## Verification

No code was changed this pass — audit-only, findings above are read-direct-from-code, not
inferred. Full Jest suite untouched (still 280/280 from the prior pass); nothing to
transform-check since no files were edited.
