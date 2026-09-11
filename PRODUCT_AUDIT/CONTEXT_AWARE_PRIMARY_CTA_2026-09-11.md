# Item 37 — "Make the primary CTA context-aware"

Status: DONE, 2026-09-11. Audited all 6 contexts named; fixed the 2 real visual-hierarchy gaps
found, renamed 1 CTA's wording to match, confirmed 2 already correct, and flagged 1 context
("event") as not a distinct concept in this schema rather than fabricating one.

## User's framing (verbatim)

> The primary action should depend on what the user is looking at.
> - Looking at a person → Plan Together
> - Looking at an event → Plan / Join
> - Looking at a business → Plan Here
> - Looking at a community → Join Community
> - Looking at a gathering → Join Gathering
> - Looking at search results → Create What You're Looking For

## Method

For each context, found the real screen, read its actual button JSX + `StyleSheet.create` block,
and determined which button is *visually* primary (filled coral, matching this repo's own
Standing Convention: "Coral = action, not decoration... reserved for a surface's primary
action") versus outlined/secondary — not just which button exists or what it's labeled.

## Findings

### Person (`ViewProfileScreen.js`) — real gap, FIXED

When connected as both an accepted friend and a match, the coral primary button was **"💬
Message"** (`messageButton` style, filled) and **"🤝 Plan Something"** was the outlined secondary
(`addFriendButton` style) — backwards from what the user wants as the primary action once two
people are actually connected. Swapped: "🤝 Plan Together" (renamed from "Plan Something" to match
the user's own wording) is now the coral primary; Message is now the outlined secondary. Only
applies when `friendshipStatus === 'accepted'` — for a pure dating match not yet friended, Message
correctly remains the sole/primary action (there's no "Plan Together" destination available yet
without being friends first, so nothing to prioritize over it).

### Business (`BusinessProfileScreen.js`) — real gap, FIXED

The coral primary was **"+ Follow"** (`followButton`, filled coral) — a passive subscribe action —
while **"📅 Make a Plan Here"** (`planHereButton`) used a neutral gray outline with
`colors.textPrimary` text, the *weakest* of the three buttons on the screen. Swapped: Plan Here
(renamed "📅 Plan Here" to match the user's wording) is now filled coral with `shadow.button`;
Follow is now always outlined (both following/not-following states), never filled. Message stays
outlined/secondary, unchanged.

### Community (`CommunityDetailScreen.js`) — already correct, no fix needed

"Join Community" already uses `joinButton` (filled coral, `backgroundColor: colors.primary`);
"Leave Community" already renders as the neutral outlined `leaveButton` state. Matches exactly.

### Gathering (`GatheringDetailScreen.js`) — already correct, no fix needed

The Join Gathering / Request to Join / Join Waitlist button already uses a filled,
category-colored `joinButton` style with `shadow.button` — already the clear visual primary on
the screen. Matches exactly, including the same 3-way contextual label `GatheringsScreen.js`'s
list rows and `DiscoverHubScreen.js`'s gathering tiles already compute identically (item 33's own
prior standardization).

### Event — not a distinct concept in this schema, flagged rather than fabricated

Checked whether "event" maps to some real, separate UI state from "gathering." It doesn't:
item 27's own prior audit (2026-09-11, same day) already established "Events isn't a distinct
concept anywhere in the schema — folded into Gatherings' `interest_tag`." There is no
`EventDetail` screen, no `event` result type in the intent resolver, and no card/tile anywhere
that renders a gathering differently depending on whether it "feels like" an event versus a
gathering — list rows (`GatheringsScreen.js`, `DiscoverHubScreen.js` tiles) and the detail screen
(`GatheringDetailScreen.js`) all already compute and display the identical "Join Gathering" /
"Request to Join" / "Join Waitlist" CTA. Rather than invent a parallel "event" UI state that
doesn't correspond to any real data distinction (which would violate this repo's own "no
fabricated signals" convention in spirit — a fabricated *category*, not just a fabricated number),
this is disclosed as already-satisfied by the Gathering fix above. If the user actually wants
"event" to become a real, separate concept in the schema (e.g. a business-hosted, ticketed,
larger-scale thing distinct from a peer-hosted social gathering), that's a genuinely separate,
bigger product decision — not something to infer and build silently from one bullet in a CTA
wording list.

### Search results (`DiscoverHubScreen.js`) — wording-only fix

The "nothing matched anywhere" escape hatch (item 26/Decision 5, 2026-08-27) was already the
correct primary CTA — already filled coral (`createItButton`, `backgroundColor: colors.primary`)
— just labeled generically ("Create it →"). Renamed to "Create What You're Looking For →" to match
the user's own exact wording. Scope check: this fires only when every searchable section has
genuinely come back empty for the typed term (never alongside real results, which would pressure
users to "create" instead of just using what's actually there) — that gating is correct as-is and
was left untouched. `GatheringsScreen.js`'s own separate, more specific "+ Start a {term} Gathering"
empty-state CTA (item 25 batch 2) was deliberately left as-is — it already names the real thing
it creates, which is more informative than the generic phrase for that single-type context, and
wasn't the literal "search results" context the user named (Discover's unified, multi-type search
is).

## Verification

Full Jest suite 280/280 passing (no test files touched — pure JSX/style changes). All three
touched files (`ViewProfileScreen.js`, `BusinessProfileScreen.js`, `DiscoverHubScreen.js`)
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app —
no simulator/device tooling available this session, standing note; if the new coral/outline
weighting looks visually off on a real device, these three files are where to look first.
