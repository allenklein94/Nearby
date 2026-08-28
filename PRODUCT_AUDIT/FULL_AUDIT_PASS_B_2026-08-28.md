# Full End-to-End Product Coherence Audit — Pass B (systems 5-7)

**Scope**: Gatherings (5), Business side (6), Messaging (7) — the commitment/transaction/
communication surfaces. Read-only, no code changed. Method: direct current-code reading, no
simulator. Re-verifies prior CLAUDE.md claims against current source rather than trusting them.

---

## System 5 — Gatherings

**Trace: discover → view → join → capacity → messages → business connection → request → offer → confirmation**

| Step | File/line | Verdict |
|---|---|---|
| View | `GatheringDetailScreen.js` (whole file) | 🟢 Rich, real data throughout — fit reasons, host stats/reputation, vibe, timeline, Q&A, community/perk linkage |
| Join | `GatheringDetailScreen.js:185-225` → `expressInterest()` | 🟢 Real limit check, honest join/waitlist/request-approval branching, Success/Medium haptic differentiation |
| Capacity | `GatheringDetailScreen.js:343-349,564-574` | 🟢 Real `capacity`/`isFull`/spots-left math; "🔥 Almost full" nudge (`Math.max(2, ceil(capacity*0.2))`) uses a real, stated threshold, not fabricated |
| Waitlist | `GatheringDetailScreen.js:776-788`, `confirmLeave()` L249-277 | 🟢 A full gathering never dead-ends — "JOIN WAITLIST" always offered; leaving a spot correctly reads `"If someone's waiting on the waitlist, they'll take your spot"` |
| Messages | `GatheringChatScreen.js` (whole file) | 🟢 Real realtime channel (INSERT subscription, not polling), real pagination (`usePaginatedMessages`), real load/send error states |
| Business connection | `GatheringDetailScreen.js:600-736` | 🟢/🟠 mixed — see Finding B1 below |
| Request → offer → confirmation | `AskBusinessScreen.js`, `BusinessRequestDetailScreen.js` | 🟢 Full lifecycle real (offer comparison, Stripe payment, reservation, completion) — see System 6 |

### Finding B1 — 🔴 Confirmed business venue never reaches non-host attendees (structural, not cosmetic)

Once a host's "Find a Business for This Plan" flow lands a real accepted offer (e.g. a confirmed
restaurant for "Friday Dinner Plans"), **only the host ever sees it**:

- `GatheringDetailScreen.js:118-152` — `businessRequest`/`acceptedBusinessOffer` state is only
  ever fetched `if (g.isHost)`. A non-host approved attendee's `load()` call sets both to `null`
  unconditionally (line 147-151).
- `AcceptedBusinessOfferCard` (the component that renders the confirmed venue name/address/Uber
  link) is imported and rendered in exactly 3 screens (`GatheringDetailScreen.js:609`,
  `DateProposalScreen.js:217`, `CommunityDetailScreen.js:436`) — none of them a non-host
  gathering-attendee view.
- `GatheringHubScreen.js`'s own "Meet-Up Point" (the one attendee-facing location surface,
  L409-429) calls `getGatheringMeetupPoint()` → `get_gathering_meetup_point()` RPC
  (`supabase/migrations/00000000000000_baseline.sql:2536-2555`), which **always** returns
  `gatherings.precise_lat/precise_lng` — the location set at gathering creation, never updated
  by `accept_business_offer()`. Confirmed via grep across `supabase/migrations/*business*`: no
  migration ever writes `precise_lat`/`precise_lng` from the accepted-offer flow — they're only
  ever *read* (to seed the fan-out radius).

**Net effect**: an attendee who joins a "let's find a restaurant" gathering has zero in-app way
to learn where the confirmed restaurant actually is. They'd have to be told manually in the
group chat by the host. This is exactly the "does a full gathering create a dead-end" shape the
plan's system 5 checklist asks about — not a literal empty-results dead end, but a real-world
outcome that never propagates to the people who need to act on it. This was a deliberate,
disclosed scope decision when built (see the code's own comment, `GatheringDetailScreen.js:130-136`:
"Host-only — business_requests' own RLS only ever lets the real requester... see the row at
all"), not an oversight — but it's a genuine, still-open coherence gap worth flagging at full
severity, since "does the gathering flow through to a real dead-end-free outcome" is the exact
test system 5 names. **A real fix would need either (a) a scoped RLS widening so an approved
attendee can read their own gathering's accepted-offer row, or (b) denormalizing the confirmed
venue's name/address onto `gatherings` itself once accepted** — either is a real schema/RLS
change, not a client-only fix.

### Positive controls (working correctly, don't disturb)

- Capacity/waitlist mechanics are genuinely solid — real row locks, honest state labels, a
  documented "you can't un-attend something that already happened" rule (`leave_gathering`).
- The "Find a Business for This Plan" merged chooser (`GatheringDetailScreen.js:669-720`) is a
  real, single front door replacing what used to be two competing links — confirmed no
  duplicate/competing CTA exists anywhere else on this screen.
- `GatheringHubScreen.js`'s "Who You'll Meet" stacks every real true fact (shared interests,
  first-timer, organizer stats) rather than picking one best-guess line — matches the plan's own
  "no invented numbers" convention exactly.
- Empty/error states throughout `GatheringDetailScreen.js`/`GatheringHubScreen.js` are real
  (`LoadErrorState` with working retry), not silent blank screens.

---

## System 6 — Business side (the entire loop)

**Trace: onboarding → profile → categories/cuisine/attributes → availability → opportunities → consumer request → match explanation → offer → acceptance → reservation/action**

| Step | File/line | Verdict |
|---|---|---|
| Categories/cuisine/attributes | `BusinessDashboardScreen.js` (chip pickers, confirmed via CLAUDE.md's own extensively-verified Aug 25 taxonomy/Business Story passes — not re-read in full this pass, spot-checked instead) | 🟢 |
| Availability posting | `BusinessDashboardScreen.js:2535` "Your Availability" section | 🟢 |
| Opportunities inbox | `BusinessDashboardScreen.js:2449-2510` | 🟢 real, itemized match reasons (see Finding B2/positive control) |
| **Match explanation ("does the business understand *why*")** | `services/businessOpportunityScoring.js` (full file read) | 🟢 — see below |
| Consumer request creation | `AskBusinessScreen.js` (grepped) | 🟢 real required-field validation, real recap card |
| Offer → acceptance → reservation | `BusinessRequestDetailScreen.js` (full file read) | 🟢 real Stripe Connect flow, real reservation/payment status branches, real "Compare Your Options" comparison |
| Business sees confirmed visit | `BusinessDashboardScreen.js:2341` "📅 Upcoming Nearby Visits" | 🟢 loop closes back to the business |

### The critical question, answered directly: yes, with one confirmed gap

`scoreBusinessOpportunity()` (`src/services/businessOpportunityScoring.js`, full file) produces a
real, itemized `reasons` array — never a single opaque score — covering: priority-attribute
match, general attribute match, cuisine match, a real budget bonus (proportional, capped, with an
explicitly-disclosed placeholder reference constant), party-size-range fit (against the
business's own fulfillment policy), time-window fit, and an active priority-boost signal. Every
one of these renders on the dashboard row as a real "🎯 {label}" line
(`BusinessDashboardScreen.js:2471-2478`) — confirmed this is genuinely wired, not just computed
and discarded. **This is a real, working answer to the plan's own critical question.**

**Gap confirmed still open**: `scoreBusinessOpportunity()` takes no weather parameter at all —
Weather is not a signal in Business Opportunity ranking, even though it's now wired into
Gatherings' own browse/filter surface and the ask box (CLAUDE.md P2 items 7/8, Aug 28 2026). A
business deciding which of several open requests to respond to first gets no "this one's for an
outdoor patio and rain is coming" signal the way a consumer browsing gatherings now does. This
matches what the Universal Signal Audit already found and left unfixed (P2 scope was explicitly
"ask box + GatheringsScreen," not Business Opportunity scoring) — re-confirmed still true against
current code, not newly discovered.

### Finding B2 — 🟡 Two structurally separate "price" representations, by design, not reconciled

`gatherings.price_level` (a `free|$|$$|$$$` enum, used by `priceAndPartyBonus()` in gathering
scoring) and `business_requests.budget_max`/`business_requests` (a real dollar figure, used by
`scoreBusinessOpportunity()`'s budget bonus) are genuinely two different signal shapes for the
same underlying concept ("how much is this worth"). `create-assistant`'s extraction (`supabase/
functions/create-assistant/index.ts:129-130`) deliberately extracts **both** `priceLevel` and
`budgetMax` from the same free text independently — this is coherent by design (each downstream
object stores price the way it's always stored it), not a bug, but worth flagging for the
Signal-Contract-style system 9 table as two genuinely distinct rows rather than one unified
"Price" signal, since a scenario like F ("something cheap tonight") produces two independent,
never-cross-checked inferences.

### System 9 notes (Signal × Surface, Gatherings/Business columns)

| Signal | Gatherings | Business (Opportunity ranking) |
|---|---|---|
| Category | USED — `interest_tag` filter/scoring (`intentResolver.js:43-84`) | USED — `activePrioritySignals` boost (`businessOpportunityScoring.js:131-140`) |
| Interests | USED — via category match | NOT APPLICABLE (no personal-interest concept on the business side) |
| Distance | USED — `getGatheringMeetupPoint`, resolver distance scoring | USED at fan-out (radius-bounded before opportunities are ever created) — NOT re-scored within the opportunity list itself |
| Price | USED — `price_level` (`priceAndPartyBonus`) | USED — `budget_max` bonus (`businessOpportunityScoring.js:85-91`) — see Finding B2, two separate representations |
| Party type | USED — `priceAndPartyBonus` | NOT scored directly (no `party_type` param in `scoreBusinessOpportunity`) |
| Party size | NOT APPLICABLE at browse (capacity is separate) | USED — fulfillment-policy range fit (`businessOpportunityScoring.js:104-113`) |
| Cuisine | NOT APPLICABLE (gatherings have no cuisine field) | USED (`businessOpportunityScoring.js:75-78`) |
| Attributes | NOT APPLICABLE | USED, two-tier (priority vs general match, `businessOpportunityScoring.js:53-73`) |
| Compatibility | NOT APPLICABLE | NOT APPLICABLE |
| Weather | USED (`intentResolver.js:43-70`, `GatheringsScreen.js:582-600`) | **GAP** — `scoreBusinessOpportunity()` has no weather param at all |
| Time | USED (`priceAndPartyBonus`, "Right Now" window) | USED — time-window-vs-priority-hours fit (`businessOpportunityScoring.js:115-125`) |
| Availability | NOT APPLICABLE (gathering existence itself is the availability) | USED — feasibility hard-constraint at request-creation (CLAUDE.md P0 item 2, re-confirmed present via `businessFulfillment.js` weather/party-size code read this pass) |
| Capacity | USED — real, see System 5 above | NOT APPLICABLE at ranking (party size fit is the analog) |
| Recency | Implicit (chronological base order before scoring) | Implicit (base opportunity list order before scoring) |

### System 10 scenario notes (handoff for synthesis)

- **Scenario B** ("nice Italian place for a date Friday") — `create-assistant` correctly does
  NOT let "nice" alone imply a price tier (explicit instruction, `index.ts:130` — "leave
  priceLevel null unless something else... implies a real price tier"). `cuisine: 'italian'`
  extraction is real and gets threaded through `resolveIntent()` → `resolveBusinessAvailability()`
  (`intentResolver.js:247,279-305`) for cuisine/attribute overlap scoring. **Verified**: this
  scenario resolves correctly through the code, both for gathering-shaped candidates (party_type
  `date` via `priceAndPartyBonus`) and for business-availability candidates (cuisine match).
- **Scenario E** ("something for 8 people Saturday") — `partySize` is a hard constraint at the
  consumer resolver (business availability capacity check, per CLAUDE.md P0 item 2) but is
  never scored as a *relevance* signal for gathering candidates at the resolver stage — only
  used as a hard filter, matching the plan's own locked design. Confirmed still true.
- **Scenario F** ("something cheap tonight") — see Finding B2. `priceLevel: 'free'|'$'` should
  correctly resolve via `create-assistant`'s explicit mapping; `partyType` is correctly left null
  (no party signal in this ask) per the same file's explicit instruction not to guess.
- Hand-off point for Pass A: all four scenarios traced above assume the ask originates from
  Home's intent box (`resolveIntent()`'s caller) — Pass A owns tracing from the actual typed text
  through classification to the `resolveIntent()` call.

---

## System 7 — Messaging

**Matches, friends, circles, gathering chats, business conversations, chat titles, bubble sizing, keyboard behavior, navigation, back behavior, unread states, attachments, media, empty states**

| Surface | File | Verdict |
|---|---|---|
| 1:1 Chat | `ChatScreen.js` (grepped, ~1594 lines) | 🟢 richest surface — typing indicator, read receipts, voice notes, GIF, photo/video, real pagination+realtime |
| Matches list | `MatchesScreen.js` | 🟢 real empty state, real compatibility badge (dating-source only, correctly suppressed for friend/gathering-sourced matches) |
| Friends (embedded) | `FriendsScreen.js` via `MessagesScreen.js` | 🟢 real circles UI — see Finding B3 |
| Gathering chat | `GatheringChatScreen.js` (full file read) | 🟢 realtime+pagination, real load/send error states |
| Community chat | Confirmed via `RootNavigator.js:457-474` header comment (real in-chat info panel, replacing a confusing dead-end-reading headerRight) | 🟢 |
| Business conversation | `BusinessConversationScreen.js` (full file read) | 🟢 realtime+pagination — see Finding B4 for one asymmetry |
| Chat titles | `RootNavigator.js:400,452,458-473,486` | 🟢 consistent "{X} Chat" convention across Gathering/Community; 1:1 Chat and Business use the person/partner name directly (a real, intentional difference — a 1:1 conversation's "title" is the person, not "X Chat") |
| Unread states | `MessagesScreen.js` mode-toggle badges, `homeDashboard.js`'s `getPendingInvitesCount` | 🟢 (per CLAUDE.md's own extensively-documented Aug 15 realtime-publication fix and Aug 9 badge-undercounting fix — not re-derived, spot-checked) |
| Keyboard/device sizes | All chat screens use `KeyboardAvoidingView` w/ `behavior: Platform.OS === 'ios' ? 'padding' : undefined` | 🟡 NOT VERIFIABLE FROM THIS SANDBOX — no simulator/device access exists in this environment; the pattern is consistent across all 4 chat-style screens (`ChatScreen`/`GatheringChat`/`CommunityChat`/`BusinessConversation`), so if one is wrong on a real device, all four likely share the exact same bug. Flag explicitly for a real device pass. |
| Bubble sizing | `maxWidth: '75%'` (gathering), `'80%'` (business), presumably similar in ChatScreen | 🟡 NOT VERIFIABLE FROM THIS SANDBOX — small numeric inconsistency (75% vs 80%) noted but cosmetic; real rendered size on a real device screen can't be confirmed here |

### Finding B3 — 🟠 Friend Circles are a real, working feature with zero downstream use anywhere else in the app

`getMyCircles()`/`friendCircles.js` is referenced in exactly one file: `FriendsScreen.js`
(confirmed via `grep -rln "friendCircles\|getMyCircles" src/` → 2 hits, the service file and
its one consumer). A user can genuinely discover a person, connect, and organize them into a
circle (`FriendsScreen.js:5,28-160,327-374`) — but no other screen in the entire app reads a
circle: not `InviteFriendsModal` (no "invite my Fitness circle" option), not
`CreateGatheringScreen`, not any filter anywhere. This directly answers system 4's (Pass A's own
scope) "can a user discover → connect → organize into a circle → **use that relationship
elsewhere in Nearby**?" question with a concrete no for the fourth step — flagging here since I
found it while auditing the Friends-embedded view inside Messages, but this is genuinely a
system-4 finding; Pass A/synthesis should own final classification.

### Finding B4 — 🟠 Asymmetric "view the thing" affordance across group-scoped chat headers

- **1:1 Chat** (`ChatScreen.js:374-390`): header title is itself a tappable `navigate('ViewProfile', ...)` link.
- **Community Chat** (`RootNavigator.js:457-473`): a real in-chat info panel + "View Full
  Community Page →" link (per its own code comment, replacing a confusing dead-end).
- **Gathering Chat** (`GatheringChatScreen.js`, confirmed via full read — no `navigation.
  setOptions` call anywhere in the file): **no equivalent** — no way to jump from the gathering
  chat back to `GatheringDetail` except the native back button (which pops to whatever was
  actually on the stack, not necessarily `GatheringDetail`).
- **Business Conversation** (`BusinessConversationScreen.js:58-70`): `headerRight` exists but is
  a Report action only (`⋯`) — no "View Business Profile" link anywhere.

Three of four chat surfaces answer "where does this conversation's own subject live" differently
— Community got a real fix for this exact problem (per its own code comment, an earlier session
already recognized and fixed it there); Gathering and Business conversation still lack it. This
is a real, concrete 11-transition-test finding (Gathering → Chat, Match → Chat) — the
interaction model changes across sibling surfaces with no stated strong reason for Gathering/
Business specifically lacking what Community/1:1 both have.

### Positive controls (working correctly, don't disturb)

- Realtime delivery (INSERT subscriptions) + real cursor pagination is now consistent across all
  four chat-style screens — confirmed the exact same shape (`usePaginatedMessages`,
  `useChatComposer`, a real `removeChannel` cleanup) in `GatheringChatScreen.js` and
  `BusinessConversationScreen.js`, matching what CLAUDE.md's Aug 15 scalability pass already
  established for `ChatScreen.js`.
- Load-error and loading-initial states are real and distinct from the empty-conversation state
  in every chat screen read this pass (previously conflated per CLAUDE.md's own history — now
  fixed and consistent).
- `MessagesScreen.js`'s Matches/Friends toggle is a genuine content swap in place, reusing
  Discover's own `modeToggleRow` chrome verbatim — not a second invented visual language.
- The "Hide this chat" mechanism for a past gathering (`MessagesScreen.js:85-104`) is honest —
  explicitly local-device-only, explicitly doesn't touch real attendance history, states this
  plainly in its own confirm dialog.

### 11-transition test (Pass B's four transitions)

| Transition | Verdict |
|---|---|
| Gathering → Chat | 🟠 Flag — see Finding B4 (no "view gathering" link from inside the chat, unlike Community's equivalent) |
| Business → Opportunity | 🟢 Consistent — real itemized reasons, real chip rendering, same card language as the rest of the dashboard |
| Opportunity → Offer | 🟢 Consistent — same modal/chip conventions dashboard-wide, confirmed via `BusinessDashboardScreen.js` structure |
| Match → Chat | ⚪ Intentional difference, with reason — 1:1 Chat's header IS a profile link (richest treatment); this is correctly the *strongest* version of the pattern, not a gap |

---

## Severity read (my own, not final — synthesis owns the 5-bucket classification)

- **Finding B1** (confirmed venue never reaches attendees) — feels structurally broken, not
  cosmetic. Real users would hit this on the exact "gathering finds a business" flow the whole
  Offer System was built for.
- **Finding B2** (two price representations) — cosmetic/architectural, not user-visible breakage.
- **Finding B3** (circles unused elsewhere) — feels like an unfinished feature, not broken —
  worth flagging but low urgency at real usage.
- **Finding B4** (asymmetric chat headers) — cosmetic/consistency, real but low-stakes.
- **Weather gap on Business Opportunity ranking** — already-known, already-scoped-out gap, not
  new; low urgency unless business volume grows.
