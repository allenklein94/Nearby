# Item 59 — "Thursday acceptance test": 5 end-to-end journey traces

Started 2026-09-12. No simulator/device tooling available this session (standing note across
this whole project) — these are full code traces of the real navigation/state flow for each
journey, screen by screen, params in hand, not an on-device run. Disclosed plainly, not silently
substituted for the real thing.

Progress tracker (updated as each journey fork reports back):

- [x] Journey A — Dating: People → Dating → person → match → message → Plan → business/place → plan
- [ ] Journey B — Friends: People → Friends → friend → message → Plan → activity/business → plan
- [ ] Journey C — Discover: Discover → Things To Do → Today → category → activity → Plan
- [ ] Journey D — Create: Discover → can't find it → Create → Gathering/Community → publish
- [ ] Journey E — Business: Intent → options → business → offer/availability → reservation/plan

Findings and fixes land below each journey's checkbox as it completes.

## Journey A — Dating

Traced `DiscoverHubScreen.js` → `DiscoveryScreen.js` → `SwipeableDiscoveryCards.js` →
`MatchesScreen.js`/push routing → `ChatScreen.js` → `DateProposalScreen.js`.

- **Hop 1** (People → Dating → tap person → profile): **Clean.** Swipe (`SwipeableDiscoveryCards.js:43-60`,
  fires `onNotice`) and tap-to-view-profile (`:158-161` → `DiscoveryScreen.js:606` →
  `navigate('ViewProfile', { userId, viewContext: 'dating' })`) are cleanly separated.
- **Hop 2** (swipe → match): **Weak, but intentional, not a bug.** A swipe only ever sends a
  "Notice" (`SwipeableDiscoveryCards.js:63-67`) — real match creation is async/server-side. The
  client only learns about a new match via a push (skips celebration UI entirely) or by opening
  Matches (a separate tab under Messages, not under People/Discover), where `MatchesScreen.js:115-158`
  diffs against remembered seen-ids and shows `MatchCelebrationModal` (`:475-479`). Worth knowing:
  the journey's "person → match" reads as same-flow, but real behavior is an out-of-band reveal.
- **Hop 3** (message): **Clean.** Both real entry points (push routing, `MatchesScreen.js:241-246`)
  correctly pass `matchId`; `ChatScreen.js:107` reads it correctly.
- **Hop 4** (Plan Together): **Weak — the one real friction found.** "Plan Together"
  (`MatchesScreen.js:253-259` and the match row's own button) navigates to `Chat` with
  `openTogetherMenu: true`, which opens a generic 12-option "Together" `ActionSheetModal`
  (`ChatScreen.js:520-538`) — "Plan Something Together" is option **#12 of 12**, buried under 11
  unrelated options (Shared Playlist, Trip Planning, etc.) instead of a direct hop to
  `DateProposalScreen`.
- **Hop 5** (find a place): **Clean.** `DateProposalScreen.js`'s find/choose/propose chain
  (`:175-215`) carries every param correctly in one call, no drops.
- **Hop 6** (final state): **Clean.** Re-renders in place with real "View Request"/"Find Somewhere
  to Go" actions; reachable again later via Plans (Item 52's `datePlans`).

**Punch list**: (1) "Plan Together" should skip the generic Together menu and land directly on
`DateProposalScreen` — real, fixable, not yet fixed (design call: skip menu entirely vs.
pre-highlight the row). (2) Match reveal being async/out-of-band is disclosed as intentional, not
treated as a bug.

## Journey B — Friends (in progress, resumed after codespace restart)

**Bug found and fixed this session**: `create_plan_from_date_proposal()` (the trigger behind every
date-proposal-sourced `plans` row) unconditionally inserted `plan_type = 'dating_date'` even when
the underlying `matches` row was friend-sourced (`source_friendship_id` set) or gathering-sourced
(`source_gathering_id` set) — the same real/fake distinction `ChatScreen.js`'s own
`isRomanticMatch` already makes for the same match row. Consequence: every "Plan Something
Together" made from a Friends-tab connection landed on the Plans tab permanently mislabeled with a
heart icon and "Date." Fixed in `supabase/migrations/20261015_friend_sourced_plan_type_fix.sql`
(trigger now branches on the match's own source columns; a real backfill UPDATE included, though
production currently has zero existing date-proposal-sourced plans rows so it was a no-op) +
`src/services/plans.js`'s `getMyDateProposalPlans()` (now selects `plan_type`, fetches both
`dating_date` and `friend_hangout`) + `src/screens/PlansScreen.js`'s `datePlanRow` render (now
branches icon/label on `plan.plan_type`). **Verified live** via a disposable rolled-back
transaction against production covering all 3 cases (friendship-sourced match → `friend_hangout`;
gathering-sourced match → `friend_hangout`; plain dating match → `dating_date`) — all 3 assertions
passed. Migration was already applied live to production before the restart (confirmed via
`pg_get_functiondef`); this session's work closed the two client-side pieces the migration's own
header comment had promised ("fixed in the same client change") but that hadn't actually landed
yet.

Remainder of Journey B (Together-menu copy, DateProposalScreen copy, post-accept business search
framing) — trace in progress via background research fork, not yet reported.
