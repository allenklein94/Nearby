# Phase 1 Intent Entry Point — Architecture Audit (2026-08-14)

Read-only audit, requested explicitly before any further UI changes. No code was modified to
produce this report — every claim below was verified directly against source (not against
CLAUDE.md's own prose, which is a lead to check, not ground truth).

## Scope of this audit

Verify the Home "What do you want to do?" intent entry point (Intent Layer Phase 1a/1b) against
nine specific architectural requirements before proceeding to test intent resolution or build
anything further on the business request/offer engine.

## Files/components involved

- `src/screens/HomeScreen.js` — intent box UI, submit handler, result rendering
- `src/services/intentResolver.js` — Tiers 1–3 resolver
- `src/services/createAssistant.js` + `supabase/functions/create-assistant/index.ts` — NL
  classification
- `supabase/migrations/20260814_business_fulfillment_tier2.sql` —
  `get_connected_open_business_requests()` RPC (Tier 2)
- `src/screens/AskBusinessScreen.js` — where "ask a business" lands (not part of Phase 1 itself,
  see the note at the end)

## Checklist results

**1. New entry point sits above Your Plans, as a new section — confirmed.**
Render order in `HomeScreen.js` is: greeting/subtitle (lines 294–295) → intent box (line 297) →
banner cluster (invites/perks/weather/since-away, 374+) → `Your Plans` (line 464) → Quick Picks
→ Happening Near You → Your Communities → Because You Like… Nothing was inserted between the
banners and Your Plans, and no existing section was repurposed.

**2. Your Plans and other sections retain existing semantics — confirmed.**
Your Plans (lines 462–524) is untouched: same `plansGoing`/`plansHosting` split, same
`GatheringDetail` navigation, same `GatheringStatusBadge`. Confirmed via `git show --stat` on
both Phase 1 commits (`7d534aee`, `307970d2`) that only `HomeScreen.js`, `createAssistant.js`,
`intentResolver.js` (new), and the `create-assistant` edge function were touched — no other
screen was edited by either commit.

**3. Submitting an intent does not create a business request — true, with one nuance worth
flagging.**
`handleHomeIntentSubmit` (lines 212–234) only calls `classifyCreateRequest` then
`resolveIntent` — both pure reads, no writes. The nuance: when the resolver returns nothing, the
empty state offers a button ("Ask Nearby Businesses") that navigates to `AskBusinessScreen` —
that screen only pre-fills form state from route params and does **not** submit anything until
the user explicitly taps its own submit button there. So the base intent-submit action never
writes to the business schema; a further, separate, explicit user action on a different screen
can.

**4. Routed through create-assistant — confirmed.**
`classifyCreateRequest()` calls the real `create-assistant` edge function (bearer-token auth,
same infrastructure Create Hub's "Something Else" box already uses). Not a separate or forked
classifier.

**5. Resolver only considers existing eligible supply — confirmed for all three tiers built:**
- **Tier 1** (gatherings): `getNearbyGatherings('wide')`, filtered by category/date, scored by
  the existing shared `getGatheringFitReasons()`.
- **Tier 2** (friends/matches with compatible intent): `get_connected_open_business_requests()`
  RPC — computes the caller's connected set as accepted `friendships` UNION `matches` (both
  directions), inner-joins `business_requests` on that set only. Read the SQL directly: there is
  no path to a non-connected user.
- **Tier 3** (perks): `getActiveOffers()`, filtered by category, gated on real location
  permission.

**6. Never surfaces unknown nearby individuals — confirmed.**
No proximity/stranger query anywhere in `intentResolver.js`. The only person-shaped result type
is `friend_request` (Tier 2), sourced exclusively from the connected-set RPC above.

**7. No new tab / marketplace section — confirmed.**
`RootNavigator.js`'s `Tab.Navigator` still has exactly 5 screens: Home, Discover, Create,
Matches (Inbox), Profile (You).

**8. No existing functionality removed/deprioritized — confirmed** for everything touched by
these two commits (nothing outside `HomeScreen.js`/`createAssistant.js`/`intentResolver.js`/the
edge function was edited by them).

## One fact worth flagging before deciding next steps

The framing going into this audit was "intent box → verify → then build the business
request/offer engine," implying the 1:1 business engine doesn't exist yet. **It already does.**
Per this repo's own history — and independently confirmed live against production in earlier
sessions — Phase 2 (business request/offer/accept/reservation), Phase 3 (gatherings as demand
generators), and Phase 4 (proactive business availability, two-way matching) were all built,
applied, and verified before this audit ran. `AskBusinessScreen`, `submitBusinessRequest`, the
full `business_requests`/`business_request_offers` schema, and the Tier 4 "ask nearby
businesses" flow are all live, not hypothetical.

This does not violate anything in the checklist above — the intent box itself still only reads
existing supply, per items 1–8 — but the actual current state is further along than "Phase 1
only." Worth deciding explicitly whether to treat the already-built business engine as done, or
hold off on using/testing it until Phase 1 resolution has been validated on its own.

## Outcome

**No violations found against any of the 9 stated requirements. No code was changed as part of
this audit.**
