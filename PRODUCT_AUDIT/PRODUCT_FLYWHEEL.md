# Product Flywheel — Nearby

*Tracing the loop the prompt asked for: Discover → Join → Meet → Connect → Create → Invite →
Gather → Community → Business → Perk → Return. Basis: `USER_FLOWS.md`, `SCREEN_INVENTORY.md`,
`FEATURE_MATRIX.md`. For each step: what's real today, what's missing, and the concrete point
where a user can fall out of the loop.*

## Discover

**Exists**: a genuinely unified hub (`DiscoverHubScreen`) across gatherings/communities/places/
perks, plus a separate People-discovery surface (`DiscoveryScreen`/`Nearby`), plus Home's own
daily-digest surfacing of the same underlying content. Real signal-based recommendations
("Recommended for you," Trending) — no fabricated scores.
**Missing**: search is a client-side filter over already-fetched lists, not a real index (see
`PRODUCT_RISKS.md`) — fine at today's data volume, a real ceiling later.
**Fall-out point**: none especially sharp here — this is the best-covered step in the loop.

## Join

**Exists**: a real, capacity-aware, waitlist-backed join flow (`join_gathering` RPC per
`CLAUDE.md`), honest CTA copy that differs by join type, a private pre-join intent signal never
shown to the host.
**Missing**: no visible way to withdraw a pending host-approval request (only an *approved*
attendee can leave).
**Fall-out point**: a host-approval gathering with a slow-to-respond host has no
expectation-setting UI ("hosts usually respond within X") and no easy way to reconsider — a
user could simply stop checking rather than actively leaving.

## Meet

**Exists**: `GatheringHub`'s "Who You'll Meet" section (real shared-interest overlap,
first-timer flags, host reputation stats stacked honestly), ice breakers that prefill group
chat, on-my-way/check-in self-reporting.
**Missing**: no GPS-verified arrival — entirely self-reported, a deliberate, documented
trade-off (per `CLAUDE.md`) rather than a gap, given this app's structural no-precise-location
privacy stance.
**Fall-out point**: a gathering with a lot of first-timers and no active host engagement in the
hub has nothing pulling people back in after the "You're In!" banner beyond the static ice
breakers — no live presence indicator of who else is actually en route.

## Connect

**Exists**: friend requests, `friend_circles` grouping, mutual-friends surfacing on profiles,
gathering-based matching (`matches.source_gathering_id` per `CLAUDE.md`) alongside the
classic Notice/Wave mutual-match path.
**Missing**: nothing structurally missing — this step is well-built.
**Fall-out point**: a match/friend made at a gathering has no obvious nudge back toward
`Create`/`Invite` immediately after — the loop's next step isn't proactively suggested at the
moment connection happens (it exists on Home as a general "best pick," not as a direct
"you just met X, plan something together" prompt).

## Create

**Exists**: the full "Create 2.0" guided wizard, AI-assisted free-text fallback, real deep-link
share on publish.
**Missing**: nothing structurally missing for gatherings; whether a *business* can unilaterally
create its own gathering (vs. only sponsor a consumer's) is UNCLEAR (`USER_FLOWS.md` flow K).
**Fall-out point**: none especially sharp — this is the second-best-covered step after Discover.

## Invite

**Exists**: friends-only `social_invites` for gatherings/communities with real shared-context
enrichment, a post-publish "Invite Connections" prompt, a post-join "Want to bring someone?"
growth prompt.
**Missing**: no way found to invite someone who isn't already a friend/app user to a *specific*
gathering (the referral system invites to the *app*, not to a specific event) — a real limiter
on the loop's viral surface, since "bring a friend who isn't on Nearby yet" to a specific
gathering isn't a built path.
**Fall-out point**: a user whose real-world social circle isn't yet on the app has a
meaningfully weaker version of this step — they can share the app itself, but not "here's the
specific thing, come to this."

## Gather

**Exists**: the full live-hub experience, feedback loop, host-reputation accumulation.
**Missing**: nothing structurally missing beyond what's noted under "Meet" above.
**Fall-out point**: same as "Meet."

## Community

**Exists**: real standing communities with roles/calendar, gathering-to-community linkage on
creation, business affiliation.
**Missing**: nothing structurally missing for the consumer side.
**Fall-out point**: a gathering attendee who isn't already in the relevant community has no
prompt, at the point of attending, to join the community behind that gathering (confirmed
absent in the screen inventory — `GatheringHub`/`GatheringDetail` don't surface a
"join this community" nudge tied to the specific gathering they're already engaged with).

## Business

**Exists**: perks, sponsorship requests, dashboard analytics/CRM.
**Missing**: self-serve business onboarding is incomplete (no confirmed self-claim flow, no
profile self-editing yet) — a real supply-side bottleneck.
**Fall-out point**: a business that wants to join sees a real, working application flow, but
getting from "approved" to "actually configured and live" depends on manual/support
intervention for anything beyond what was in the original application.

## Perk

**Exists**: scarcity, targeting, group-unlock, real redemption tracking, loyalty tiers.
**Missing**: no confirmed proof-of-redemption mechanism (see `PRODUCT_RISKS.md`); `Rewards`
itself has no CTA back into redeeming more.
**Fall-out point**: a user who redeems a perk has nothing in the flow actively routing them
back toward Discover/Gather afterward — the loop doesn't close itself here, it depends on the
user re-initiating.

## Return

**Exists**: `Insights`/`Momentum`/`Rewards` make the return loop *legible* (real streaks,
real deltas, real tier progress) — a genuinely strong, non-fabricated foundation for a "come
back" mechanic.
**Missing**: none of the three screens that exist specifically to encourage return have an
outbound CTA (see `UX_GAPS.md`) — the legibility is built, the actual next-action nudge isn't.
Push notifications exist for direct social events (match, message, invite) but there's no
observed "you have momentum, don't lose your streak" proactive nudge tying the Momentum screen's
own signal back into a notification.
**Fall-out point**: the single sharpest fall-out point in the entire flywheel. The app can tell
a user exactly how engaged they've been, in real numbers, and then does nothing with that
information to pull them back in — the "Return" step is instrumented but not activated.

## Overall assessment

The **content/supply side of the loop (Discover→Join→Meet→Connect→Create→Gather→Community) is
genuinely strong and internally consistent** — this is where most of the engineering effort
visible in `CLAUDE.md`'s own history and in the screen inventory has gone, and it shows. The
**two weakest links are Invite** (no path to a specific non-app-user for a specific event) **and
Return** (real signal, no activation) — both are the steps a flywheel depends on most for
actually compounding, as opposed to steps that just need to work once per session. The Business/
Perk half of the loop is real but has a genuine adoption bottleneck (self-serve onboarding) and
an unresolved trust question (proof of redemption) that would matter more the more the business
side scales.
