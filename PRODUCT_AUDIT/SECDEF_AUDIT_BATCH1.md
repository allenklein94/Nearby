# SECURITY DEFINER audit — batch 1 of 2 (68 functions, alphabetical A–get_partner_avg_response_time)

Part of Phase 1 item 1 of the "Scorecard to 10" initiative (see `CLAUDE.md`). Read-only audit
of every `authenticated`-callable SECURITY DEFINER function's live production definition
(pulled fresh via the Management API from project `enmosvippabmuqslzrox`), hunting specifically
for the ownership-check-gap bug shape this codebase has already found and fixed six times this
month. No fixes applied, no database touched — findings only.

## Finding 1 — `get_mutual_friends(other_user_id uuid)`: no relationship check at all, callable
## against any user in the app

**File**: `pg_get_functiondef` for `get_mutual_friends` (no local migration file found for this
specific function's most recent definition — likely predates the migrations-folder history, or
was applied directly via the Management API in an earlier session; not present in
`supabase/migrations/` or `supabase/migrations_archive/` under a grep for its name).

**The gap**: the function computes the intersection of `auth.uid()`'s accepted-friend list and
`other_user_id`'s accepted-friend list, and returns each mutual friend's `id`/`display_name`/
`photo_url` — but never checks that the caller has *any* legitimate relationship to
`other_user_id` (no friendship check, no match check, no shared-gathering/community check), and
never checks `is_blocked()` in either direction. Every sibling RPC that surfaces another
specific person's data checks something: `get_connected_open_business_requests` requires the
target be a real friend/match; `get_friend_discovery_candidates` requires
`not is_blocked(v_me, p.id)`; `get_gathering_meetup_point` requires host-or-approved-attendee.
This one requires nothing.

**Exploit scenario**: any authenticated user can call `get_mutual_friends(<any real user id>)`
for a person they've never matched with, never friended, never shared a gathering with — even
someone who has blocked them, or whom they've blocked — and get back a real list of that
stranger's mutual-friend names and photos. This is a genuine "no stranger discovery" boundary
violation (the exact locked product principle stated repeatedly across `CLAUDE.md`, e.g. Friend
Discovery's and Business Fulfillment's own "never a stranger" rules) — a determined caller can
extract a slice of an arbitrary target's social graph with nothing more than knowing their user
id (ids are UUIDs, not guessable in practice, but this is still a real, confirmed server-side
gap independent of how hard the id is to obtain — e.g. any id ever seen in a shared link,
profile URL, or push payload becomes probeable this way).

**Proposed fix**, matching this codebase's own established remediation pattern for exactly this
shape of gap: add a real relationship guard before computing anything, e.g.
`not is_blocked(auth.uid(), other_user_id)` at minimum, and ideally also require the caller
actually has a legitimate reason to view this person (an accepted friendship, a match, or shared
gathering/community membership) — the same "already-connected" gate every comparable RPC in this
schema uses. **This second, broader question (exactly which relationship should be required to
view someone's mutual friends) is a real product-policy call, not something to silently pick —
flag for the parent session to decide before writing the fix**, though the `is_blocked()` check
alone is unambiguous and should be added regardless of how that broader question is answered.

## Finding 2 — `get_my_group_intent_signals()`: missing the blocks check its own sibling RPC has

**The gap**: `get_connected_open_business_requests` (built the same day, sourcing from the
identical "connected = accepted friendships union matches" CTE) includes
`and not is_blocked(auth.uid(), br.requester_id)` in its `WHERE` clause.
`get_my_group_intent_signals()` — same connected-set definition, same underlying
`business_requests` table, same `p.intent_visibility = 'friends_and_matches'` gate — has no
`is_blocked()` check anywhere in its body.

**Exploit scenario**: a real accepted friend or match who has since been blocked (or who has
blocked the caller) can still surface in the "N people you know are looking for {category}"
Home nudge, with their real name shown via the `requester_names` array — the exact kind of
post-block leak this file's own Aug 16 RLS resweep found and fixed for `matches`/`friendships`
identity columns, just in a sibling function that resweep didn't reach.

**Proposed fix**: add `and not is_blocked(auth.uid(), br.requester_id)` to the `open_reqs` CTE's
`WHERE` clause, matching `get_connected_open_business_requests` exactly — this is a one-line,
unambiguous fix with a direct precedent already in the same migration family.

## Finding 3 — `check_is_admin(uid uuid)`: callable with an arbitrary uid, low-severity info
## disclosure

**The gap**: every real caller of this function in the codebase invokes it as
`check_is_admin(auth.uid())` — the correct, already-established pattern. But the function itself
takes an unrestricted `uid` parameter and is directly callable via RPC with anyone's id, letting
any authenticated user learn whether an arbitrary account is an admin.

**Severity**: low. This doesn't expose PII or grant any capability — knowing *that* someone is
an admin (without any other leverage) isn't independently actionable. But it is a real,
unnecessary information disclosure (helps an attacker identify which accounts are worth
targeting for social engineering/phishing), and it's inconsistent with this schema's own
"only ever answers for a pair where `auth.uid()` is one of the two ids" defensive convention
already established for `is_blocked()`/`is_community_visible_to()`.

**Proposed fix**: not urgent, but for consistency, this function should either (a) be revoked
from direct `authenticated` RPC access entirely (it's meant to be called *from inside* other
SECURITY DEFINER functions, which can do so regardless of the grant, per this codebase's own
established "internal-helper, locked-down-from-direct-call" pattern e.g.
`_business_request_fanout`), or (b) gain the same `auth.uid() = uid` internal guard
`is_blocked()` uses. Flagging as a real but low-priority finding, not blocking.

## Not flagged, checked and confirmed correct/non-exploitable

- All ~15 `RETURNS trigger` functions in this batch (`enforce_*_daily_limit`,
  `check_mutual_notice`, `create_match_on_friendship_accepted`,
  `deactivate_offer_on_gathering_delete`) carry an `authenticated`-execute grant at the Postgres
  level, but Postgres itself rejects any direct call to a trigger-type function outside real
  trigger context (`new`/`old` aren't bound) — the grant is over-broad hygiene, not an
  exploitable gap. Not worth a dedicated fix given zero real exploitability, but could be
  revoked for cleanliness in a future pass.
- `count_redemptions_since`/`get_offer_redemption_counts` have no ownership check by design —
  both return only aggregate counts (no PII), used for public scarcity display ("3 of 10
  claimed") on any offer any user can already see. Matches this schema's own established
  intentional-public-aggregate convention.
- `get_business_dashboard_stats`, `_growth`, `_insights`, `_top_members`, `_visit_frequency`,
  `_member_gathering_history`, `_follower_count`, `_conversations_summary`,
  `_aggregated_demand_for_partner`, `_my_business_availability` — all correctly check
  `profiles.managed_partner_id = partner_id_param` before returning anything (the exact fix
  already applied to this whole family in an earlier session).
- `get_gathering_meetup_point` — correctly host-or-approved-attendee gated.
- `get_connected_open_business_requests` — correctly gated (friendship/match, `is_blocked`,
  `intent_visibility`).
- `get_friend_discovery_candidates` — correctly gated (opt-in both sides, `is_blocked`, existing
  friendship/match/swipe exclusion).
- `accept_business_offer`, `approve_gathering_interest`, `cancel_business_request`,
  `cancel_group_plan`, `confirm_group_plan`, `confirm_group_plan_offer`,
  `confirm_offer_redemption`, `decline_business_offer`, `delete_business_customer_note`,
  `complete_business_reservation`, `create_business_request_for_gathering` — all correctly
  verify the caller owns/is a legitimate party to every id they're given, and none of the
  UPDATEs in this batch let a caller repoint an identity/ownership column at an uninvolved
  third party (the specific `matches`/`friendships` hijack shape from the Aug 16 resweep does
  not recur anywhere in this batch).
- `admin_approve_id_verification`, `approve_business_partner_request`,
  `deny_business_partner_request` — correctly admin-gated, correctly pending-status-guarded
  against double-review.
- All `get_*_stats`/`get_*_funnel`/`get_market_validation_stats`/
  `get_marketplace_reliability_rankings`/`get_cross_user_intent_patterns`/
  `get_home_nudge_stats` — correctly `check_is_admin(auth.uid())`-gated.
- `get_intention_change_count(target_user_id uuid)` — takes an arbitrary target id with no
  ownership check, but only returns a bare integer count of intention changes, no names/content;
  checked its one real caller (`ProfileScreen.js`'s own-account use) and confirmed nothing in the
  client ever passes another user's id — low enough sensitivity (a count, no PII) that this
  wasn't included as a real finding, but noted here in case a future caller changes that
  assumption.

**3 of 68 functions in this batch had a real finding** (2 confirmed exploitable gaps — Finding 1
and Finding 2 — plus 1 low-severity information-disclosure note, Finding 3).
