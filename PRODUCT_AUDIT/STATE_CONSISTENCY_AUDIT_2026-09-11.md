# State Consistency Audit (external UX critique item 50)

Built 2026-09-11 per direct user request: search the codebase for every state that can exist,
then verify DB state → backend → API → UI all agree. Scope is everything item 32
(`RELATIONSHIP_STATE_MATRIX_2026-09-11.md`) did NOT already cover — that report is the canonical
one for person-to-person friendship/match/block state and is not repeated here except where new
findings connect directly to it (they do, twice — see Friendship/Match below).

Method: every real status/state column was enumerated live from `information_schema.columns`
against production (project `enmosvippabmuqslzrox`), not guessed from migration files (which can
contain superseded versions). For each one: live CHECK constraint values, every RPC that
transitions it (via `pg_get_functiondef`), whether any client code writes to it directly
(bypassing RPC validation), whether every valid value is handled in client rendering, and whether
two screens could ever show contradictory derived state for the same row.

Live column inventory (`status`/`state`/`%_status`, `public` schema): `business_attribute_
suggestions`, `business_availability`, `business_invoices`, `business_partner_requests`,
`business_partnership_requests`, `business_payments`, `business_request_offers`, `business_
requests`, `business_reservations`, `communities`, `date_checkins`, `date_proposals`,
`friendships`, `gathering_interest`, `group_plan_participants`, `group_plan_proposals`, `id_
verification_submissions`, `partner_contracts`, `plans`, `social_invites`, `social_offers`.
`gatherings` and `matches` have **no** status column at all — both are genuinely delete-based/
row-presence-based state machines (confirmed live, matches CLAUDE.md's own note for gatherings).

## Friendship / Match (extends item 32 — two new, real, live gaps found)

Item 32 built `getRelationshipStatus()` and fixed `block_and_unmatch()` + `getCommunityMembers()`.
This pass looked specifically for the thing item 32's own method didn't check: whether any client
code writes to `friendships.status` or removes a `matches` row *directly*, bypassing the
validation a controlling RPC would apply — the exact question item 50 asks.

**Finding 1 (real, live, HIGH severity): `respondToFriendRequest()` writes `friendships.status`
directly, with no "already resolved" guard, unlike every comparable state machine in this
schema.**
`src/services/friends.js:122-128`:
```js
export async function respondToFriendRequest(friendshipId, accept) {
  const { error } = await supabase
    .from('friendships')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', friendshipId);
```
This is a raw table write, not an RPC. The live RLS policy (`"Only the non-requester can respond
to a friend request"`, confirmed via `pg_policies`) only checks `auth.uid() <> requested_by` — it
does **not** check that the row is currently `'pending'`. Compare to `approve_gathering_interest()`,
which explicitly does `if v_current_status <> 'pending' then raise exception 'This request has
already been reviewed';` before writing. Friendships has no equivalent guard anywhere (DB or
client).

Consequence, confirmed by reading the two live triggers on `friendships`
(`create_match_on_friendship_accepted`, `notify_friend_request_accepted` — both `pg_get_
functiondef`'d live): both only fire when `old.status = 'pending' and new.status = 'accepted'`.
So:
- Accept, then **re-decline** the same row (double-tap, retried failed request, stale UI still
  holding the old `friendshipId`): `friendships.status` → `'declined'`. No trigger cleans up the
  `matches` row created on the original accept — it's still there. Result: `FriendsScreen`/
  `getMyFriends()` (filters `status='accepted'`) correctly stops listing them as a friend, but
  `MatchesScreen`/chat still shows them as a live match with a working chat thread. **The exact
  contradiction class item 32's `block_and_unmatch` fix exists to prevent, via a different code
  path.**
- **Re-accept** an already-`'declined'` row: `friendships.status` → `'accepted'` (RLS allows it —
  same non-requester, no transition guard), but since `old.status` was `'declined'` not
  `'pending'`, `create_match_on_friendship_accepted` does **not** fire. Result: `ViewProfileScreen`/
  `FriendsScreen` show "✓ Friends," but no `matches` row exists — `getRelationshipStatus()`'s
  `matchId` is null, so the Message button has nothing to open.

Not verified against a live authenticated session (the Management API token used for this audit
runs as `postgres`, which bypasses RLS — so this is confirmed by reading the policy/trigger
definitions directly, not by reproducing it end-to-end as two real users). The gap itself is real
regardless: the guard that would prevent it simply does not exist in either the RLS policy or the
client function.

**Finding 2 (real, live, HIGH severity): `unmatch()` deletes `matches` but never touches
`friendships` — the exact `block_and_unmatch` bug, unfixed for its sibling action.**
`unmatch(target_match_id)` (live `pg_get_functiondef`):
```sql
delete from matches where id = target_match_id and (user_a = v_user_id or user_b = v_user_id);
delete from notices where ...;
```
No `friendships` cleanup at all. `ChatScreen.js` exposes a plain "Unmatch" destructive action
(`confirmUnmatch()`, line ~697) on **any** open chat — including one whose `matches` row has
`source_friendship_id` set, i.e. an accepted Friend's chat. Tapping Unmatch there removes the
match/chat but leaves `friendships.status = 'accepted'` untouched: `FriendsScreen`/
`ViewProfileScreen`'s "✓ Friends" state persists with no way to message them anymore. This is
structurally identical to the bug item 32 found and fixed for `block_and_unmatch()` — the fix was
never generalized to plain `unmatch()`.

## Communities (real, live, end-to-end gap — DB state ignored by both backend and UI)

`communities.status` (`active`/`paused`/`cancelled`, CHECK-enforced) is correctly written by
`pause_community`/`resume_community`/`cancel_community` (all real RPCs, `cancel_community` also
correctly cascades to open `business_requests`/`business_request_offers` and pushes every member —
confirmed via `pg_get_functiondef`). The problem is entirely downstream of that correct write.

**Finding 3 (real, live, HIGH severity — full DB→backend→UI chain failure): a cancelled or paused
community stays fully browsable, searchable, and joinable.**
- `getPublicCommunities()` (`src/services/communities.js:102-115`) and `searchPublicCommunities()`
  (line 124) both filter **only** on `is_public = true`. Neither references `status` at all. A
  cancelled community (every member already pushed "has been cancelled by its creator") still
  appears in Discover's Communities browse and in search results, indistinguishable from a live
  one.
- `joinCommunity()` (line 175) is a raw `.insert()` into `community_members`, not an RPC. The live
  `community_members` INSERT policy (`pg_policies`, `with_check`) validates `is_public = true` (or
  an accepted invite, or the creator) — it has **no reference to `communities.status` at all**. A
  user who finds a cancelled community (via the browse/search leak above, or a stale deep link)
  can genuinely join it — the insert succeeds.
- This is confirmed by reading the live RLS `with_check` clause directly (not simulated as an
  authenticated user, same caveat as Finding 1) — the policy text itself has no `status` predicate,
  so there is nothing that would block it.

Net effect: DB state (`cancelled`) is completely invisible to both the backend authorization layer
and the UI browse/search layer — the one entity in this audit where all three layers the user
asked about (DB → backend → UI) independently fail to agree, not just two of them.

## Business request chain (`business_requests` → `business_request_offers` → `business_reservations`)

This is the schema's real answer to the user's "Business request: created/offered/accepted/
declined/expired/reserved/cancelled" example — spread across three tables by design, not one:
- `business_requests.status`: `open`/`fulfilled`/`expired`/`cancelled`/`merged` — "created" is
  represented as `open` (no literal `created` value; the row's existence at status=`open` is the
  same fact). Client coverage (`BusinessRequestDetailScreen.js`'s `STATUS_COPY`): all 5 values
  handled. Every transition (`cancel_business_request`, `accept_business_offer`,
  `expire_stale_business_requests`, plus screening-approval merge paths) is a SECURITY DEFINER RPC
  — no direct client writes found (`grep -rn "from('business_requests')" src/` shows selects only).
- `business_request_offers.status`: `pending`/`offered`/`accepted`/`declined`/`expired`/
  `cancelled`/`completed`/`withdrawn` — 8 values, all RPC-transitioned
  (`submit_business_offer`/`decline_business_offer`/`withdraw_business_offer`/
  `accept_business_offer`/`complete_business_reservation`/`expire_stale_business_requests`/the
  three `cancel_*` cascades), no direct client writes.
- `business_reservations.status`: `requested`/`confirmed`/`failed`/`cancelled`. Only two writers
  exist live (`pg_proc` search): `accept_business_offer` (inserts directly as `'confirmed'`,
  skipping `'requested'` entirely) and... that's it — `complete_business_reservation` never
  touches this table, only `business_request_offers.status`. This is **not** a bug: `'requested'`/
  `'failed'` are deliberately dead, forward-looking placeholders for a future real third-party
  reservation provider — explicitly documented in `GroupPlanScreen.js`'s own comment ("the real
  business_reservations row starts at 'requested,' it just happens to auto-confirm immediately
  today since Nearby itself is the only reservation provider so far"). `business_reservations.
  status` is also never rendered anywhere in the client (`grep` confirms only its nested
  `business_payments` child is read, never `.status` itself) — so the missing "completed" mirror
  update is invisible today, not a live bug, just worth knowing if a future screen ever starts
  reading it directly.

**Finding 4 (real, LOW severity): both consumer-facing offer-status copy maps are missing
`'withdrawn'`.** `BusinessRequestDetailScreen.js`'s `OFFER_STATUS_COPY` (lines 25-33) and
`GroupPlanScreen.js`'s identical business-offer `OFFER_STATUS_COPY` (lines 28-44) both cover
pending/offered/accepted/declined/expired/cancelled/completed — 7 of the 8 live CHECK values —
but neither has an entry for `'withdrawn'`, the value `withdraw_business_offer()` actually sets.
Both fall back to `OFFER_STATUS_COPY[o.status] ?? o.status`, so a requester whose offer was
withdrawn sees the raw literal `"withdrawn"` instead of friendly copy, inconsistent with every
other value's styled label. (`GroupPlanScreen.js`'s separate `SOCIAL_OFFER_STATUS_COPY`, a
different table's vocabulary, already has `withdrawn: 'Withdrawn'` — only the *business*-offer
copy map in both files is missing it.)

**Finding 5 (real, MEDIUM severity, feature gap not a live bug): no code path anywhere cancels an
already-accepted business offer / confirmed reservation.** All four `cancel_*` RPCs
(`cancel_business_request`, `cancel_business_availability`, `cancel_gathering`, `cancel_community`)
only ever move `business_request_offers` rows out of `('pending','offered')` — never `'accepted'`.
Once an offer is accepted (`business_reservations.status = 'confirmed'`), the only further
transition anywhere in the schema is `complete_business_reservation()` (→ `'completed'`). There is
no "Cancel Reservation" action anywhere in the client (`grep` for cancel+reservation in
`src/screens|services` found nothing beyond the four cancel-upstream RPCs above) and no RPC that
would let either party back out of a confirmed reservation. Not a state-consistency bug — DB,
backend, and UI all agree there's no such state — but a real, concrete gap in what the state
machine can represent, worth flagging since a real-world "I need to cancel tonight's reservation"
has no path today.

`business_availability.status` (`active`/`expired`/`cancelled`/`filled`): all 4 values handled in
`BusinessDashboardScreen.js`'s `AVAILABILITY_STATUS_COPY`. Transitions
(`post_business_availability`/`cancel_business_availability`/`accept_business_offer`'s
capacity-driven auto-fill/`expire_stale_business_requests`) are all RPCs. Clean.

## Business partner / partnership applications

`business_partner_requests.status` (`pending`/`approved`/`denied`/`needs_info` — the business's own
application to become a Nearby partner): all 4 values handled in
`MyBusinessApplicationScreen.js`. Clean, no direct client writes found.

`business_partnership_requests.status` (`pending`/`approved`/`declined` — the separate "Request a
Specific Business" affiliate flow for a gathering/community, distinct from the above; do not
confuse the two similarly-named tables) — client (`GatheringDetailScreen.js`/
`CommunityDetailScreen.js`) handles `pending`/`approved` with dedicated copy; `declined` silently
falls through to the same "not started yet" chooser UI, letting the host simply try again. This is
deliberate, not a gap — a declined specific-business request has no further state to represent.

## Gathering / gathering_interest

`gatherings` itself has no status column — confirmed live (full column list pulled), matches
CLAUDE.md's "Host cancellation lifecycle" note: cancellation is a real row `DELETE` via
`cancel_gathering()`, which correctly cascades any open `business_requests`/offers tied to that
gathering to `'cancelled'` first (its own FKs are `ON DELETE SET NULL`, confirmed live, so the
explicit pre-delete UPDATE is required and present). There's genuinely no way to represent
"completed" vs. "cancelled" vs. "just old" for a past gathering — the client infers this purely
from `scheduled_at` vs. now() plus row-existence. Not flagged as a bug (no UI anywhere claims to
show gathering completion state), just noting the schema has no vocabulary for it if that's ever
needed.

`gathering_interest.status` (`pending`/`approved`/`waitlisted` — `'denied'` is a fully dead legacy
value, confirmed: it appears only in the baseline schema and one already-shipped 2026-08-16
migration's own comment describing removing the raw-write policy that used to set it; no live RPC
sets it, no client code checks for it). **No CHECK constraint exists on this column at all** — it's
freeform `text`, enforced only by RPC discipline (`join_gathering`/`approve_gathering_interest`/
`leave_gathering`, all confirmed the only writers). This is low-severity because the table's own
RLS is otherwise exemplary: the INSERT policy's `with_check` hardcodes `status = 'pending'`, and
there is **zero** UPDATE policy on this table (confirmed live via `pg_policies` — the Aug 16 2026
migration's own fix), so a client can never write `'approved'`/`'waitlisted'` directly no matter
what. The missing CHECK constraint is a pure defense-in-depth gap (a bug in a future RPC could
insert/update an unconstrained value), not a currently-exploitable one.

## Group Plans / Social Offers / Date Proposals / Plans ("Together" planning stack)

Spot-checked, not exhaustively re-audited (this stack was heavily built and cross-checked across
several prior sessions — Offer System phases, item 33's action-verb audit). `group_plan_proposals`
(`pending`/`confirmed`/`cancelled`/`expired`), `group_plan_participants`
(`invited`/`accepted`/`declined`/`left`), `social_offers`
(`offered`/`accepted`/`declined`/`withdrawn`/`expired`/`cancelled`), `date_proposals`
(`proposed`/`accepted`/`declined`/`withdrawn`), `plans`
(`draft`/`confirmed`/`completed`/`cancelled`) all have full client copy-map coverage in
`GroupPlanScreen.js`/`DateProposalScreen.js` (confirmed by direct read) and all transitions found
via `pg_proc` search go through named RPCs (`confirm_group_plan`, `respond_to_social_offer`,
`submit_social_offer`, `respond_to_group_plan`, etc.) — `expire_stale_business_requests()` also
correctly sweeps `group_plan_participants`/`group_plan_proposals` expiry in the same pass as the
business-side expiry (own migration comment, "Finding C3's other real half"). No direct-write
bypass found for any of these five. Not a focus area for deeper findings this pass since nothing
in a spot-check suggested one — flagged here as *lower confidence* than the sections above rather
than as "fully audited."

## Fix list (ranked by severity)

1. **[HIGH] `respondToFriendRequest()` (`src/services/friends.js:122-128`) needs an
   "already-resolved" guard**, either by converting it to a SECURITY DEFINER RPC (matching
   `approve_gathering_interest()`'s own pattern: lock the row, raise if `status <> 'pending'`) or
   by adding a `status = 'pending'` predicate to the existing RLS `with_check`/`.eq('status',
   'pending')` on the client update. An RPC is the more robust fix since it also lets you validate
   `blocks` at accept-time (currently only enforced at request-creation time in
   `sendFriendRequest`, not at response time) in the same change.
2. **[HIGH] `unmatch()` (DB function) should also clear `friendships` when the match's
   `source_friendship_id` (or a live `friendships` row between the same pair) exists** — same fix
   shape as `block_and_unmatch()`'s own 2026-09-11 fix: delete the `friendships` row (or, if
   "unmatching a friend" should instead be disallowed/require a separate confirmation, that's a
   product decision — but the current silent contradiction is not an acceptable third option).
3. **[HIGH] `getPublicCommunities()`/`searchPublicCommunities()` (`src/services/communities.js`)
   must add `.neq('status', 'cancelled')` (and almost certainly also exclude `'paused'` —
   product call on whether a paused community should still be visible-but-not-joinable, or fully
   hidden) — and the `community_members` INSERT RLS policy's `with_check` needs a
   `communities.status = 'active'` condition added alongside its existing `is_public`/invite/
   creator check**, so joining is blocked server-side too, not just hidden client-side (defense
   in depth — the two fixes are both needed, the UI leak alone isn't sufficient given the RLS gap).
4. **[LOW] Add `withdrawn: 'Withdrawn'` to the business-offer `OFFER_STATUS_COPY` in both
   `BusinessRequestDetailScreen.js` (line ~25) and `GroupPlanScreen.js` (line ~28)** — a one-line
   fix in each, mechanical, matches the sibling `SOCIAL_OFFER_STATUS_COPY`'s existing entry.
5. **[MEDIUM, feature gap not a bug — product decision needed]** Consider whether a genuine
   "cancel a confirmed reservation" path should exist at all (RPC + UI on both the consumer and
   business side) — currently structurally impossible once `accepted`/`confirmed`. Not fixing this
   silently is fine (it's disclosed, not contradictory), but it's worth a deliberate yes/no rather
   than leaving it as an accidental gap.
6. **[LOW, defense-in-depth only]** Add a CHECK constraint to `gathering_interest.status` (`in
   ('pending','approved','waitlisted')`) for parity with every other status column in this schema
   — not currently exploitable (RLS already blocks all direct writes), but cheap insurance against
   a future RPC bug.
