# Product Flywheel — Nearby

*Tracing the loop: Discover → Join → Meet → Connect → Create → Invite → Gather → Community →
Business → Perk → Return. Basis: `USER_FLOWS.md`, `SCREEN_INVENTORY.md`, `FEATURE_MATRIX.md`,
and a from-scratch, 20-transition trace done directly (not delegated) for this refresh, extending
the app's own internal `FLYWHEEL_TRACE_PROGRESS.md`. **Refreshed 2026-08-09.** For each step:
what's real today, what's missing, and the concrete point where a user can fall out of the loop.*

## Discover

**Exists**: unchanged — a genuinely unified hub, real signal-based recommendations.
**Missing**: search is still a client-side filter, unchanged, a real ceiling later not today.
**Fall-out point**: none especially sharp — still the best-covered step in the loop.

## Join

**Exists**: unchanged, plus **`invite_only` gathering join is now genuinely server-side
enforced**, not just UI-gated — live-verified this refresh (an uninvited direct RPC call is
rejected, an invited-and-accepted one succeeds). An honest "almost full" nudge was also added.
**Missing**: still no visible way to withdraw a pending host-approval request — unchanged.
**Fall-out point**: unchanged from the last audit — a slow-to-respond host still leaves the
requester with no expectation-setting UI and no easy way to reconsider.

## Meet

**Exists**: unchanged.
**Missing**: unchanged — no GPS-verified arrival, a deliberate trade-off.
**Fall-out point**: unchanged.

## Connect

**Exists**: unchanged — friend requests, circles, mutual-friends, gathering-based matching.
**Missing**: nothing structurally missing — unchanged assessment.
**Fall-out point**: unchanged — a match/friend made at a gathering still has no direct "you just
met X, plan something together" prompt, only a general Home "best pick."

## Create

**Exists**: unchanged.
**Missing**: **the "whether a business can unilaterally create a gathering" question is now
resolved to a definite NO** (was UNCLEAR at the last audit) — this doesn't change the loop
itself, just removes the ambiguity around it.
**Fall-out point**: none especially sharp — unchanged, still the second-best-covered step.

## Invite

**Exists**: unchanged, plus **a real path to invite a non-app-user to a specific gathering now
exists** (a share-link action from `InviteFriendsModal.js`) — this was the last audit's specific
named gap for this step and is now closed. Cold-start push-tap delivery for an invite
notification is also now reliable (was silently dropped if the app launched from fully-closed —
fixed this session).
**Missing**: the underlying limiter (bringing someone who isn't yet an app user/friend to a
*specific* gathering) is now real via the share-link path — narrower gap than before, though a
non-app-user still can't be given a real in-app invite record the way a friend can, only a shared
link.
**Fall-out point**: meaningfully narrower than the last audit found — the sharpest remaining
edge is a user whose social circle isn't on the app at all still gets a generic share, not a
tracked/attributed invite.

## Gather

**Exists**: unchanged.
**Missing**: unchanged, same as "Meet."
**Fall-out point**: unchanged.

## Community

**Exists**: unchanged, plus **the single biggest change in the entire flywheel since the last
audit**: a gathering can now directly seed a brand-new community from its own real, friended
attendees ("Start a Community from This Gathering") — this closes a gap the flywheel-trace audit
identified and deliberately left unbuilt at the time it was first found. Also, a gathering
already scoped to a community now correctly surfaces a link to it (was previously fetched but
never shown).
**Missing**: nothing structurally missing for the consumer side — unchanged.
**Fall-out point**: **resolved.** The last audit's fall-out point here ("no prompt to join the
community behind a gathering just attended") no longer applies — both directions of this
connection (existing gathering → existing community, and one-off gathering → brand-new
community) are now real.

## Business

**Exists**: unchanged, plus real self-serve profile editing (closing a previously-silent
double bug — no UPDATE RLS policy existed at all underneath the old "isn't available yet" UI),
persistent per-customer CRM notes, and a natural-language AI assistant over the owner's own
stats.
**Missing**: self-serve *claiming* (becoming a partner) is still admin-gated — unchanged half of
the last audit's finding.
**Fall-out point**: narrower than before — "approved but not yet configured" now only applies to
the initial claim step, not to ongoing profile maintenance.

## Perk

**Exists**: unchanged, plus **a real proof-of-redemption mechanism now exists** (a 6-digit
confirmation code, business-confirmed) — this was the last audit's specific named gap for this
step and is now closed. `Rewards` also now has a real CTA back into redeeming.
**Missing**: nothing structurally missing that the last audit named — both gaps for this step
are closed.
**Fall-out point**: narrower than before — a redeeming user now has a real CTA nudging them back
toward Discover/Gather via `RewardsScreen`, though it still requires them to navigate there
rather than being pushed to.

## Return

**Exists**: unchanged legibility (real streaks/deltas/tier progress), plus **all three screens
now have a real outbound CTA** — the "instrumented but the screen itself is a dead end" half of
the last audit's finding is closed.
**Missing**: **the proactive push notification tying the same signal back into a notification
still does not exist** — no grep hit for a streak/tier-proximity push trigger anywhere in
`supabase/functions/` or the migrations. This is the one piece of the last audit's Return-step
finding that is genuinely unchanged.
**Fall-out point**: **still the sharpest fall-out point in the entire flywheel, but narrower
than before.** The app now tells a user exactly how engaged they've been *and* gives them a
button to act on it from within the screen — what's still missing is the proactive nudge that
would pull them back into the app to see that screen in the first place. A real, if smaller,
gap than the last audit found.

## Overall assessment

**The content/supply side of the loop remains genuinely strong.** What changed most since the
last audit is that **two of the loop's three weakest links from the last audit are now
substantially closed**: Invite (a real specific-gathering, non-app-user path now exists) and
Community (the gathering→community bridge, the last audit's own single biggest deliberately-
unbuilt gap, is now built). **Return remains the loop's genuine weak point**, though it too is
now half-closed (legibility + CTA both real; only the proactive-nudge half is still missing).
The Business/Perk half of the loop is materially more trustworthy than at the last audit —
proof-of-redemption closes the trust question, self-edit closes the onboarding-friction
question — but the adoption bottleneck (self-serve *claiming*, still admin-gated) and the
monetization gap (no payment processor, unchanged) are both still real. Compared to the last
audit, this is a flywheel that has closed real gaps rather than accumulated new ones — the
refresh found no new fall-out point anywhere in the 20-transition trace performed for this pass.
