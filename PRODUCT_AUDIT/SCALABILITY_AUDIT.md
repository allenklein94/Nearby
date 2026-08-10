# Scalability Audit — Client-Side Fetch/Filter Patterns

*Written 2026-08-10, prompted directly by the Aug 9 2026 `getNearbyGatherings()` fix (moved
gathering browse from "download everything, filter on device" to a real SQL-bounded RPC —
see `CLAUDE.md`'s "Aug 9 2026 — second AI's post-refresh review" section). That fix raised a
direct question: is this pattern unique to gatherings, or does it recur elsewhere? This audit
answers that — a full, read-only pass across all 273 Supabase queries in `src/services/*.js`
plus the four message-loading screens, checking each one for a real SQL-level bound (a
`.limit()`, `.range()`, an owner/self scope via `.eq('user_id', ...)`, or a SECURITY DEFINER
RPC that narrows server-side) versus an unbounded fetch that relies on client-side
`.filter()`/`.slice()`/grouping to shrink an unbounded result set after the fact. No
application code was changed to produce this — pure investigation, same posture as every other
audit in this folder.*

*Ranking basis, per the user's own framing: 🔴 must fix before beta · 🟠 fix before significant
scale · 🟡 fine for now (real but self-limiting) · 🟢 already properly bounded. "Beta" here
means real users with real, growing conversation/community/message history — not necessarily a
literal beta-tester cohort.*

## Headline

The `getNearbyGatherings()` fix closed one real instance of "download the whole table, filter
on device" — but it wasn't the only one, and it wasn't even the worst one. **The single biggest
finding of this pass isn't about table size at all: all four messaging surfaces (1:1 chat,
gathering chat, community chat, business messaging) re-fetch a conversation's *entire* message
history on a fixed timer — every 3-4 seconds, for as long as the screen stays open — not just
once on load.** That means the cost of this pattern isn't a future "once conversations get
long" problem; it's happening dozens of times per minute, today, on every open chat screen,
regardless of how small the current message counts happen to be. This is a materially bigger
and more urgent finding than the browse-download pattern the original fix addressed.

Beyond messaging, two more instances of the exact `getNearbyGatherings()`-shaped bug were found
still live: community browse (`getPublicCommunities()`) and the Discover map's business layer
(`getNearbyBusinesses()`) both download their entire respective tables unconditionally and
filter/limit nothing server-side. Both are currently invisible only because the underlying
tables are still small in production (0 communities, ~1 business partner) — they are not
currently broken, they are *not yet triggered*, which is exactly the state gatherings' browse
path was in before it was fixed.

## 🔴 Must fix before beta

### 1. All four messaging surfaces poll their *entire* history on a fixed timer, not just on open

This is worse than a single unbounded fetch — it's an unbounded fetch repeated continuously
while the screen is focused:

- **1:1 chat** — `src/screens/ChatScreen.js:143-148` (`loadMessages()`, `select('*').eq(
  'match_id', matchId).order('created_at', asc)`, no limit) is called once on mount **and**
  from a `setInterval(..., 3000)` poll at `ChatScreen.js:195-204` — *in addition to* a real
  Supabase Realtime channel subscription already wired at `ChatScreen.js:373-392`
  (`.channel('messages:${matchId}')...subscribe()`). Two independent delivery mechanisms are
  running for the same data at the same time; why the poll still exists alongside a working
  realtime channel isn't obvious from the client code alone (it may be covering a real gap —
  e.g. `markMessagesAsRead()` is called from the same poll tick, `ChatScreen.js:202` — or it
  may be redundant belt-and-suspenders left over from before the channel was added). Needs a
  real read of the git history/comments before assuming either way — see the plan below.
- **Gathering chat** — `src/screens/GatheringChatScreen.js:96-108` (`load()`, calls
  `getGatheringMessages()`, no limit, **plus** a signed-photo-URL re-fetch for every message's
  sender on every call) is driven *only* by `setInterval(load, 3000)` at
  `GatheringChatScreen.js:113` — no realtime subscription at all. Every 3 seconds, every open
  gathering chat screen re-downloads the gathering's complete message history from scratch and
  re-signs a storage URL per message.
- **Community chat** — `src/screens/CommunityChatScreen.js:23,39` — identical shape:
  `setInterval(load, 3000)` with no realtime subscription, `getCommunityMessages()` has no
  limit. This is the worst of the three in expected growth curve, since a community's group
  chat is open-ended and ongoing, not scoped to one finite event the way a gathering is.
- **Business messaging** — `src/screens/BusinessConversationScreen.js:23-26`
  (`useFocusEffect` + `setInterval(load, 4000)`) does the same for
  `getConversationWithBusiness()` (`services/brandOffers.js:394-399`, no limit). On the owner
  side, `BusinessDashboardScreen.js` additionally calls `getBusinessConversations()` (see next
  finding) both on load and inside a `useFocusEffect`.

*Why it matters*: this isn't a "will get slow once history is long" risk — it's continuous,
present-tense cost (bandwidth, Supabase read/egress cost, battery, and a visible
re-render/flicker risk on every tick) that scales with how many chat screens are open across
the whole user base at once, independent of message-history length. Fixing message-count
bounding alone (pagination) without also fixing the polling would still leave every open chat
screen re-fetching its now-smaller "latest page" 20 times a minute for no reason a real-time
subscription couldn't cover for free.

### 2. `getBusinessConversations()` downloads every message across every conversation, just to build a one-line-per-customer preview list

`src/services/brandOffers.js:418-441` — fetches **all** `business_messages` rows for a
partner, across every customer conversation, with no limit, then groups them client-side in JS
(a plain `for` loop keeping the first — i.e. most recent, since the query is already
`order('created_at', desc) — message per `conversation_with_id`) to build a "last message per
customer" list. This is the worst shape of the pattern found in this whole audit: cost scales
with **both** follower/customer count **and** total conversation length simultaneously, to
produce a result that only ever needs one row per customer. Called from
`BusinessDashboardScreen.js:192,211` — once for the actual inbox list, once again inside
`loadNeedsAttention()` to compute an unread count (i.e. the full history is downloaded *twice*
per dashboard load).

## 🟠 Fix before significant scale — same shape as the just-fixed `getNearbyGatherings()` bug

### 3. `getPublicCommunities()` downloads every public community, unconditionally

`src/services/communities.js:97-102` — `select(...).eq('is_public', true).order('created_at',
desc)`, no `.limit()`. This is the exact pre-fix `getNearbyGatherings()` shape. It's not
currently visible because production has 0 communities, but nothing about this query changes
as that number grows — it will repeat the identical bug once communities exist at scale.
Unlike gatherings, communities have no location column (confirmed in `CLAUDE.md`'s Unified Map
section — "communities have no location field anywhere in the schema"), so the fix can't be a
radius bound the way `get_bounded_nearby_gathering_ids()` was; it needs a row cap plus a real
ordering/ranking signal. `searchPublicCommunities()` (the search-box path, `communities.js:118-
138`) is already correctly bounded by the ILIKE match itself — this finding is specific to the
*browse* path only.

### 4. `getNearbyBusinesses()` downloads every active business, filters by distance client-side

`src/services/brandOffers.js:155-176` — `select(...).eq('active', true).not('latitude',
'is', null).not('longitude', 'is', null)`, no `.limit()`, then a plain equirectangular
distance filter applied in JS afterward — this is *architecturally identical* to the pre-fix
`getNearbyGatherings()`: unbounded fetch, distance math done on the client instead of in SQL.
Lower urgency than the gatherings case was, and lower than finding #3 — `CLAUDE.md`'s own
Rewards/Billing sections already reason that the business-partner count is expected to stay
much smaller than gatherings or communities "by nature of the business model" — but the
pattern itself is the identical bug shape, sitting on the Discover map's business layer, and
should get the same fix treatment (a bounding-box-then-haversine RPC, matching
`get_bounded_nearby_gathering_ids()`'s own approach) once that assumption stops holding.

### 5. `getCommunityMembers()` — full roster, no cap

`src/services/communities.js:202-211` — no `.limit()`. Fine for a small community; becomes a
real per-screen payload for a large one (the "Leaders & Members" section on
`CommunityDetailScreen.js`). Lower risk than #3/#4 since a single community's member count
grows much slower than the platform-wide community or business count.

### 6. Notices feed — full history, refetched on every visit, no pagination

`src/screens/ActivityScreen.js:90-94` — `select(...).eq('to_user', myId).order('created_at',
desc)`, no `.limit()`. Scoped to one user's own notices (not a global-table problem), but
re-downloaded in full on every single visit to the Activity tab, with no page size — grows
with account age, not with anything that resets. Real risk for a long-lived account with years
of notice history, low risk for anyone newer.

## 🟡 Fine for now — real, but self-limiting or inherently personal-scale

These are genuinely unbounded queries, listed for completeness, but each is naturally capped by
something that keeps it small in practice (one person's own realistic activity level, one
host's own gathering popularity) rather than by anything that grows with the platform as a
whole:

- **`getAllPendingRequests()`** (`gatherings.js:604-614`) — every pending join request across
  one host's own gatherings, no cap. Only a real problem for a single, unusually viral host.
- **`getMyTimeline()`** (`homeDashboard.js:216-254`) — a user's entire lifetime activity
  history, unbounded — but this is a "show my whole story" feature by design, not an
  oversight, and is capped by one person's real activity level.
- **`getMyGatherings()` / `getMyAttendingGatherings()`** (`gatherings.js:291,357`) —
  personal-scale, bounded by how many gatherings one person can realistically host or attend.
- **`getMyRedemptions()`** (`brandOffers.js:233-247`) — one user's own redemption history,
  same reasoning.
- **Business RPCs** (`getBusinessTopMembers`, `getBusinessMemberGatheringHistory`,
  `getBusinessVisitFrequency`, `getBusinessInsights`) — client code can't see whether the
  underlying Postgres function has an internal `LIMIT`; each is scoped to one business's own
  customer base, so risk is bounded by that business's real size, but worth a direct check of
  the live function definitions before ruling this out entirely.

## 🟢 Already properly bounded

- **`getNearbyGatherings()`** — SQL-bounded via `get_bounded_nearby_gathering_ids()` (real
  row_limit, plus the deliberate public-bypasses-distance / private-is-radius-bound product
  rule preserved exactly). Fixed Aug 9 2026 — the fix this whole audit was prompted by.
- **`searchGatherings()` / `searchPublicCommunities()` / `searchOffers()`** — real indexed,
  server-side ILIKE search (trigram GIN indexes), naturally bounded by match count, not table
  size.
- **`getBrowseMatches()`** (Discovery's secondary browse mode, `proximity.js:312-381`) — real
  `.range()`-based pagination with a fixed `BROWSE_BATCH_SIZE`.
- **`getNearbyMatches()`** (Crossed Paths, `proximity.js:184-301`) — personal-scale, scoped
  entirely to the caller's own `sightings` rows.
- **`getActiveOffers()`** (`brandOffers.js:46-97`) — RPC-narrowed by radius + active flag
  (`get_nearby_offer_ids`) before the full-row fetch, same pattern as the gatherings fix.
- **`getActivePartnersByName()`** (`.limit(20)`), **`getFollowedBusinessUpdates()`**
  (`.limit(20)`), **`getMostRecentUnratedGathering()`** (`.limit(5)`) — all explicitly capped
  at the query level.
- **`updateBadgeCount()` / `getInboxUnreadCount()` / `getPendingInvitesCount()`** — all use
  `{ count: 'exact', head: true }` — no row payload fetched at all, the cheapest possible query
  shape regardless of table size.

## Not in scope for this pass

Personal/relationship-tool tables (`shared_playlist_items`, `relationship_constitution`,
`stress_test`, `timeline_planner`, `trip_planning`, etc.) were not individually audited —
each is inherently scoped to a single match or a single user's own small dataset by the nature
of the feature, matching the reasoning already established for the 🟡 items above. If any of
these turn out to have a genuinely unbounded per-match growth pattern (e.g. an ever-growing
shared playlist), that would be a smaller, separate finding, not part of this pass's scope.
