# Nearby 2.0 Vision — captured, not approved for build (2026-08-15)

**Status: read-only strategic document. Nothing in this file has been built. The Aug 15 2026
feature freeze (see `CLAUDE.md`) remains in full effect for every layer described here.**

## Why this file exists

The user shared a detailed strategic vision (originally written by another AI reviewing the
current architecture) arguing that Nearby's current build — intent box, 5-tier resolver,
business fulfillment marketplace, outcome tracking, market validation dashboard — is not the
finished product, it's the *foundation* a much bigger set of capabilities could eventually be
built on top of. The vision's own closing instruction, quoted directly because it's the whole
reason this is a document and not a sprint:

> I do not want you to tell Claude: "Build all of this." That would be a mistake. You've finally
> gotten the product to the point where the foundation is strong enough. Now you should have a
> Nearby 2.0 Vision while keeping the current product frozen. Then let real-world data determine
> which of these deserves to become reality.

That instruction is consistent with, not a departure from, the freeze CLAUDE.md already
declared the same day: *"no new product surfaces or architectural changes without evidence from
real-user data."* This document is the artifact that instruction asked for — a place to record
the ranked list of candidate directions so it isn't lost, without treating any of it as scoped,
approved, or scheduled work. Nothing here should be picked up and built by a future session on
its own initiative; the freeze's own rule applies here exactly as it applies everywhere else —
if the user explicitly asks for one of these later, that's their call to make, not an "obvious
next step" to infer from this file's existence.

## The core reframe

Today's shape:

```
user asks → Nearby finds something → user acts
```

The proposed next-level shape:

```
Nearby understands demand → understands supply → connects them
→ learns the outcome → predicts what will work next time
```

The claim is that this is a materially bigger product — not "local discovery app" but
"local intent marketplace," a demand-side data asset closer to what Google/Uber/Yelp each
built from a different signal (search queries, ride requests, reviews) than to a features list.

## What already exists that every layer below would build on

Worth stating plainly, since it's the reason this vision is plausible rather than speculative:
the raw ingredients for most of it are already real, already shipping, already collecting data
as of the 10/10 roadmap closing today —

- `intent_submissions` — one row per real ask, category/date-window/whether it resolved
- `intent_outcomes` — one row per result a user acted on, with a real 👍/😐/👎 outcome
- `business_requests` / `business_request_offers` / `business_availability` — the full
  request → offer → accept → reservation → completion lifecycle, both directions (consumer asks
  first, or business posts availability first)
- `get_intent_funnel_stats()` / `get_market_validation_stats()` — real funnel and repeat-rate
  math, already computed, already on the admin Market Validation dashboard
- `get_partner_avg_response_time()` / `get_partner_offer_reputation()` — real per-partner
  reliability numbers
- The 5-tier resolver itself (own commitments → social graph → standing perks → business
  request → business availability) — already a real, working "check demand against supply in
  priority order" engine, just not yet aggregating *across* users

None of the layers below need new instrumentation invented from nothing — they're all ways of
*reading* or *acting on* data this schema already accumulates, once there's enough of it to be
worth reading.

## The ten layers, ranked as originally proposed

Each entry: what it is, what existing tables/RPCs it would draw from, and — the piece the
original message didn't specify — a rough sense of what real-usage evidence would need to exist
before it's worth reconsidering at all. None of these thresholds are binding; they're a starting
frame for a future "is it time to look at this again" conversation, not a spec.

### 🥇 1. Aggregated demand → business opportunities
Multiple users' unfulfilled asks (e.g. 18 people separately asking for "something fun Saturday
night") get rolled up and presented to businesses as a real, quantified opportunity to respond
to — "23 people are currently looking for outdoor dinner, Sat 6–9pm, party 2–6" — rather than
each ask being fanned out and left to expire independently. Builds on `business_requests`
(already has category/date/party-size/radius) — would need a genuinely new aggregation query and
a new business-facing surface, not a schema change to the request shape itself.
**Evidence bar**: needs enough concurrent, similar, *unfulfilled* requests in the same
metro/time-window to aggregate — today's real request volume is at the very start of being
measurable at all (Market Validation's own dashboard is honest that most numbers read
near-zero). Revisit once that dashboard shows real, repeated volume, not before.

### 🥈 2. The intent graph / learning system
Every submission is structured signal (category, time, price sensitivity, party size, what got
accepted vs. rejected) — over enough volume this becomes a real model of *what a place's demand
actually looks like*, not just a log of individual asks. Builds on `intent_submissions` +
`intent_outcomes` directly; the "graph" part (cross-referencing patterns across users, not just
within one user's own history the way `intentPatterns.js` already does for personalized
placeholders) is new.
**Evidence bar**: this is explicitly the slowest-maturing layer — needs real volume over real
time before there's a pattern to learn from at all, not a build question yet.

### 🥉 3. Group intent
When several of a user's own connections (friends/matches) have independently expressed the
same underlying want, surface that as "3 people you know are also looking for this" and offer to
plan together. Meaningfully close to what Tier 2 of the resolver (`get_connected_open_business_
requests`) already does today — it already tells you when a connected friend/match has a
matching open request. This layer would extend it from "one friend has a matching ask" to "N
friends, cross-referenced against your existing social graph, want the same thing" and make it a
proactive surface (a Home card / notification) rather than only a resolver-time result.
**Evidence bar**: Tier 2's own real usage (does it ever actually fire today?) is the leading
indicator — per this file's own history, Tier 2 was flagged as likely to read empty for most
users for a long time in a young app. Revisit once Tier 2 itself is regularly surfacing real
matches.

### 4. "Make it happen" multi-option planning
The intent box stops returning one ranked list and instead constructs 2-3 complete, ready-to-act
plans spanning different sources at once (an existing gathering, a restaurant + live music
combo, a business's private-group offer) — "I found three ways to make this happen" rather than
a flat results list. This is the resolver's existing 5-tier output, restructured and possibly
combined across tiers into composed options rather than presented as independent rows.
**Evidence bar**: needs the underlying tiers (especially business availability and Tier 2) to
already be reliably returning *something* worth composing — composing three empty tiers into
"three ways to make it happen" would be worse than today's honest single ranked list.

### 5. Dynamic / competitive business offers
Instead of one static offer type per business, a single consumer request could draw multiple
competing real-time responses (different times, different terms) that Nearby ranks and presents
side by side. This already exists in miniature — `business_request_offers` already supports
multiple partners responding to the same request with different `offer_type`/`offer_price`/
`proposed_time`, and `accept_business_offer()` already picks a winner among them. The "dynamic"
part would be encouraging/prompting more than one business to respond to the same request rather
than the fan-out simply notifying whoever's eligible.
**Evidence bar**: needs real evidence that more than one eligible business is regularly getting
notified for the same request today, and that a meaningful fraction respond — again, something
to check against real `business_request_offers` volume, not a build decision yet.

### 6. Predictive Nearby
Once a user's own pattern is well-established, proactively surface a suggestion ("want me to
find something for tonight?") rather than waiting for the user to open the intent box. This is a
proactive extension of the pattern-detection `intentPatterns.js` already does passively (Home's
smarter placeholder text) — the vision's own explicit rule, worth preserving verbatim, is that
this must **never auto-act**, only ever suggest, matching this app's own existing "no opaque
AI reasoning as the sole basis for an irreversible action" convention from the AI Concierge
scoping.
**Evidence bar**: `intentPatterns.js`'s own 3-occurrence-minimum threshold is already the
leading indicator here — once real accounts are regularly hitting that bar (not just
hypothetically able to), a proactive nudge becomes worth considering.

### 7. Business reliability score as a real differentiator
A "Nearby Reliability Score" per business — response time, response rate, acceptance rate,
completion rate, repeat customers — presented as a genuine marketplace-performance signal, not a
review score. This is **already substantially real** today: `get_partner_avg_response_time()`
and `get_partner_offer_reputation()` compute exactly this, already surfaced on
`BusinessRequestDetailScreen`/`BusinessProfileScreen`. What this layer adds beyond what's already
built is making it a genuinely comparative, marketplace-wide signal (ranking businesses against
each other on it, weighting it into resolver ranking) rather than a per-business informational
line.
**Evidence bar**: needs enough businesses with enough real transaction history for the numbers
to be meaningfully different from each other — today's real partner count and transaction volume
are both far below that bar.

### 8. True multi-directional business marketplace ("consumer demand → businesses compete")
The deepest version of #1 and #5 combined — a marketplace where expressed demand routinely draws
multiple competing real responses, not just occasional overlap. Not a separable build item on
its own; it's what #1 + #5 look like once both are mature and heavily used.

### 9. Nearby 2.0 positioning: "the local intent marketplace"
Not a build item at all — a possible future framing/positioning decision (how the product
describes itself, not what it does) that would only make sense once several of the above are
real and load-bearing, not before. Recorded here for completeness since the original message
treated it as the "ultimate version," not because it implies any near-term action.

### 10. Group-size / cost-composition awareness in the intent box itself
("dinner tonight with my girlfriend, somewhere nice, under $150" → a single composed answer
with an estimated total and a direct reserve action) — a richer version of what `create-assistant`
already partially does (party size, budget max, date window extraction) folded together with #4's
multi-option composition. Not separable from #4 as its own item; included here only because the
original message gave it its own numbered example.

## What this document is not

- Not a roadmap. Nothing here has a build order, a phase number, or a "next up" designation.
- Not an instruction to revisit this list on any cadence — it's a static record of a strategic
  conversation, to be picked back up only if/when the user explicitly asks, or if a future
  session is explicitly told to check whether any evidence bar above has been crossed.
- Not a claim that all ten layers are equally likely to ever get built — several (the intent
  graph, true aggregated demand, the "intent marketplace" positioning) are explicitly the
  slowest-maturing and most speculative; a few (dynamic offers, group intent, reliability
  scoring) are closer to natural extensions of mechanisms that already exist and collect data
  today.

## Standing instruction this document reaffirms, not introduces

Per `CLAUDE.md`'s Aug 15 2026 feature-freeze declaration: pilot readiness and closing the
no-manual-device-pass gap are the priority from here, not further speculative building. This
document exists so that when real usage data eventually does justify picking one of these back
up, the reasoning and the mapping to existing infrastructure doesn't have to be re-derived from
scratch — not so that it reads as a queue of approved work.
