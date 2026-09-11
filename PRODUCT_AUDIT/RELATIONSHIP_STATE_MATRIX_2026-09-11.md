# Relationship-State Matrix (external UX critique item 32)

Built 2026-09-11 per direct request: "I'd actually have Claude create a relationship-state
matrix and audit every surface against it." This is the durable reference; the canonical *code*
implementation is `getRelationshipStatus(otherUserId)` in `src/services/friends.js`.

Scope: **person-to-person** relationship state only. Person-to-community (`community_members.role`)
and person-to-business ("Following," see below) are separate state spaces, noted briefly at the
bottom but not the main subject.

## The matrix

| State | Real DB derivation | Canonical function | Bidirectional check needed? |
|---|---|---|---|
| Stranger | absence of every row below | `getRelationshipStatus()` returns all-null/false | — |
| Request Sent | `friendships` row, `status='pending'`, `requested_by = me` | `getRelationshipStatus()` → `friendshipStatus: 'pending_sent'` | no |
| Request Received | `friendships` row, `status='pending'`, `requested_by = them` | `getRelationshipStatus()` → `friendshipStatus: 'pending_received'` | no |
| Friend | `friendships` row, `status='accepted'` | `getRelationshipStatus()` → `friendshipStatus: 'accepted'` | yes (`user_a`/`user_b` either order) |
| Match (dating/messaging) | `matches` row exists — note: accepting a friend request also creates a real `matches` row via the `on_friendship_accepted_create_match` trigger, so every accepted Friend is also a Match | `getRelationshipStatus()` → `matchId` | yes |
| Blocked | `blocks` row, either direction | `getRelationshipStatus()` → `blocked: true` (short-circuits everything else) | yes |
| Following (business only — no person-to-person equivalent) | `business_followers` row | `isFollowingBusiness`/`followBusiness`/`unfollowBusiness` (`src/services/brandOffers.js`) | n/a |

Not a relationship state, but easy to conflate with one: **Crossed Paths** (`sightings` row) is a
proximity *signal*, not a relationship. No screen currently conflates the two — confirmed by
audit.

## Canonical function

`getRelationshipStatus(otherUserId)` in `src/services/friends.js` is the one place this state is
computed. It returns `{ blocked, friendshipStatus, friendshipId, matchId }`. `ViewProfileScreen.js`
is the only current consumer; the function was extracted specifically so the *next* screen that
needs this state has something real to call instead of reinventing its own copy — the failure
mode item 32 exists to prevent, even though no second copy had actually been written yet at audit
time.

## Surfaces audited

| Surface | What it shows | Verdict |
|---|---|---|
| `ViewProfileScreen.js` | Full relationship UI (Add Friend / Accept-Decline / ✓ Friends / Message / Plan Something), gated on `getRelationshipStatus()` | Canonical, correct |
| `DiscoveryScreen.js` / `SwipeableDiscoveryCards.js` (dating swipe) | Candidate pool | Correct — `getNearbyMatches`/`getBrowseMatches` (`src/services/proximity.js`) exclude self, blocked (both directions), accepted friends, existing matches |
| `FriendDiscoveryScreen.js` / `FriendDiscoverySwipeCards.js` (friend swipe) | Candidate pool | Correct — `get_friend_discovery_candidates` RPC excludes self, blocked, ANY friendship row (pending or accepted, so a pending request can't resurface), existing matches, already-swiped |
| `MatchesScreen.js`, `FriendsScreen.js` | Implicit-state lists (row presence = the state) | Correct at audit time |
| `ChatScreen.js` | No relationship-state action offered | Fine — nothing to contradict |
| `ActivityScreen.js`, `StoryViewerModal.js` | Friend-request accept/decline | Correct — both call the same canonical `respondToFriendRequest()` |
| `getCommunityMembers()` (`src/services/communities.js`) | Community roster | **Was a real gap — fixed 2026-09-11**, see below |
| `block_and_unmatch()` (DB function) | What gets cleared on block | **Was a real bug — fixed 2026-09-11**, see below |
| Business "Following" | `BusinessProfileScreen.js` "✓ Following"/"+ Follow" | Correct, single render site, real reference pattern for what item 32 wants everywhere |

## Findings fixed this session

1. **[Real bug] `block_and_unmatch()` never touched `friendships`.** Blocking an accepted friend
   left `friendships.status = 'accepted'` forever — `FriendsScreen.js` kept listing them, the
   Profile "Friends" count kept counting them, while `ViewProfileScreen.js` correctly blanked
   their profile on block. The exact "Friend in one place, contradicted in another" failure the
   user described, with Blocked as the true state instead of Stranger. Fixed:
   `supabase/migrations/20261006_block_clears_friendship.sql` — `block_and_unmatch()` now also
   deletes the `friendships` row (no trigger fires on a `friendships` DELETE, confirmed live, so
   this is safe). Verified live via a disposable rolled-back transaction (friendship + match rows
   both confirmed gone after block) before applying for real.
2. **[Real gap] `getCommunityMembers()` didn't filter blocked users**, unlike every sibling roster
   function (`getFellowAttendees()`, both discovery candidate pools). A blocked person's name/
   photo still rendered in a shared community's member list (tapping through failed safely, since
   `ViewProfileScreen` blanks on block — a visibility leak, not an access leak). Fixed: same
   blocked-both-directions filter pattern `getFellowAttendees()` already used.
3. **[Structural, no live bug found] No canonical relationship-status function existed.** Fixed by
   extracting `getRelationshipStatus()` into `src/services/friends.js` and refactoring
   `ViewProfileScreen.js` to consume it (both the blocked-early-return path and the friendship/
   match state used for the action buttons), rather than its own three separate inline queries.

No other inconsistencies found in the surfaces checked.

## How to keep this matrix true going forward

Any new screen or component that needs to show or act on a specific person's relationship to the
viewer should call `getRelationshipStatus(otherUserId)` from `src/services/friends.js` rather than
querying `friendships`/`matches`/`blocks` directly. If a genuinely new relationship state is ever
added (e.g. a real person-to-person "Following" were ever built), extend that function and this
table together, in the same change.
