# User Flows — Nearby

*Basis: `RootNavigator.js`'s route wiring, `SCREEN_INVENTORY.md`, and service-layer function
names. **Refreshed 2026-08-09.** Each flow below lists the real screen sequence; changes since
the 2026-08-08 original are called out inline rather than silently folded in.*

## A. New user onboarding

`Onboarding` → `OnboardingQuestions` → `OnboardingLocation` (**still discarded, unchanged**) →
`Login` → hard gate: `CompleteProfile` → `OnboardingRecommendations` — **the recommendation-card
bug is FIXED**: each card now navigates to its own specific `GatheringDetail`, not a generic
"Let's Go" fallback — → lands on `MainTabs` (`Home`).

**Where a user can fall out**: unchanged from the last audit — the profile-completion hard gate,
and the discarded location preference.

## B. Discover something

Unchanged from the last audit.

## C. Join a gathering

Unchanged in sequence. **`join_gathering()`'s `invite_only` check is now genuinely server-side
enforced**, live-verified this refresh (previously the only accepted risk was that this was
UI-gated only). An honest "almost full" nudge now appears on `GatheringDetail` when capacity is
genuinely close.

**Where a user can fall out**: unchanged — no visible "how long will this take" expectation-
setting for host-approval, no way to withdraw a pending request.

## D. Create a gathering

Unchanged.

## E. Invite an existing connection

Unchanged in structure (the two mechanisms — `social_invites` vs. app referral — are still
separate). **New this refresh**: `InviteFriendsModal.js` now also offers a "📤 Invite someone
not on Nearby yet" share-link action (gathering type only) using the same real
`nearby://gathering/{id}` deep link the confirmation screen already used — closing the last
audit's specific "no way to invite a non-app-user to a specific event" finding. Cold-start push
delivery for a `social_invites`-driven invite notification is also now reliable (previously
silently dropped if the app was fully closed when the push arrived).

## F. Join/create a community

Unchanged in structure. **New this refresh**: from `GatheringDetailScreen`, a host revisiting a
past gathering with no existing community link now sees a "🏘️ Start a Community from This
Gathering →" action — creates a new community and invites the gathering's real, friended
attendees (friends-only enforced both client-side as a pre-filter and server-side by
`send_social_invite` itself). `CommunityDetailScreen` also now surfaces a "🎁 Community Perks"
section for a business's community-scoped standing offer, previously invisible to members.

## G. Message someone

Unchanged in sequence. **The last audit's real, verified gap is now FIXED**: all four chat-style
screens (1:1, gathering, community, business) now restore the typed text and show a visible
error on a failed send, via a new shared `useChatComposer` hook, instead of silently dropping
the message.

## H. Participate in a gathering

Unchanged.

## I. Receive/use a business perk

Unchanged in discovery/redemption sequence. **The last audit's specific "UNCLEAR how a business
confirms a redemption happened in person" question is now resolved**: `redeemOffer()` returns a
real 6-digit confirmation code shown to the user; the business owner enters it on a new "Confirm
a Redemption" card in `BusinessDashboardScreen.js`; only `confirmed_at is not null` redemptions
count toward billing.

## J. Business onboarding

Unchanged in the *claiming* half (still admin-gated via `approve_business_partner_request`, no
self-serve claim flow). **The dashboard's own previously-admitted gap is now FIXED**: real
self-serve profile editing (name/description/address/logo) exists via a new, ownership-checked
`update_business_profile` RPC — closing the "contact support to make changes for now" message
that used to sit on the dashboard's own Business tab. A real, previously-silent bug was found and
fixed underneath the old address-edit path in the process: it had zero UPDATE RLS policy and had
never actually written anything for any real owner.

## K. Business creates a gathering

**The last audit's "UNCLEAR whether a business can unilaterally host its own gathering" question
is now resolved to a definite NO.** Direct code reading confirms `createGathering()` always sets
`host_id` from the caller's own session — a business can only ever be attached via
`hosting_partner_id`, itself now confirmed protected against self-edit by a dedicated trigger
(see `DATABASE_AND_DATA_MODEL.md`). The rest of this flow (a consumer host requests a business
sponsor via `RequestBusinessPartnerScreen`) is unchanged.

## L. Business manages its community

Unchanged, plus the new "🎁 Community Perks" surfacing described in flow F above.

## M. Business partnership flow

Unchanged — still the clearest, most fully-built business flow in the app.

## N. Switch between consumer and business mode

Unchanged — still no real mode switch, still two independent, duplicated gating checks.

## Genuinely new flow this refresh, not present at the last audit

## O. Start a community from a past gathering

`GatheringDetailScreen` (host, viewing a gathering that has already happened and isn't already
tied to a community) → "🏘️ Start a Community from This Gathering →" → `CreateCommunity`
(prefilled from the gathering's own title/interest tag) → on successful creation,
`seedCommunityFromGathering()` fetches the gathering's real approved attendees, filters to the
host's real accepted friends, and sends each a real `social_invites` community invite → an
honest result message (all/some/none of the real attendees were already friends — never a
blanket "invited!" for people who weren't actually reachable) → `CommunityDetail`. Live-verified
end-to-end against production with real test data at the time it was built; re-confirmed present
and internally consistent (code read, not re-run live) this refresh.
