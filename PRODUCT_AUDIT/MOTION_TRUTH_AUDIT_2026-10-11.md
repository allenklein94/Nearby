# Motion truth audit (2026-10-11)

Owner rule: **motion amplifies correct data, never hides incorrect data.** For each moment: what triggers it, is that data
final/server-confirmed when it plays, does the animated set equal the static view, can a placeholder swap mid-play.

| # | Moment | Trigger | Verdict | Fix |
|---|---|---|---|---|
| 1 | FriendsPlanning (item 41) | stored-ids rule | FIXED earlier today | count = faces = chips; waits for photos |
| 2 | InterestedSaved (item 30) | tap, Home + detail | VIOLATION: "✓ Saved" flashes before the save returns | flash only after success; button state still flips at once |
| 3 | InterestedToAttending (item 31) | join result AND stored status both approved | PASS | - |
| 4 | Host join: CountRoll / AvatarArrive / JoinedLine (items 25, 28) | server count rose AND new approved row | PASS on data; VIOLATION on faces: the arriving face animates before its photo is signed (placeholder, then photo pops in) | sign the arrivals' photos before the moment starts |
| 5 | PlanCompleted (item 34) | approved attendee, really over, unrated; cancel deletes the gathering | PASS | - |
| 6 | OfferAcceptedMorph / You're booked (item 12) | stored accepted + reservation state after reload; "didn't go through" = warning tone, no haptic | PASS | - |
| 7 | Group plan BookedCelebration | server allConfirmed; same call writes a confirmed reservation | PASS (residual: a reused older reservation row is not re-checked) | - |
| 8 | VisitConfirmed (moment 6) | live re-read saw accepted -> completed | PASS | - |
| 9 | OfferToPlanMerge logo (item 32) | logos fetched with the offers, long before accept; failure -> 📍 | PASS | - |
| 10 | RequestPulse / SuccessAnimation (moment 1) | server notifiedCount > 0 | PASS | - |
| 11 | RespondingStatus (item 16) | server 'reviewing' rows, stale_at | PASS | - |
| 12 | Reply travel + assembly (items 21, 23, 25) | newly received offer rows | VIOLATION x2: logo fetched without waiting (popped in mid-assembly); first-ever "heard" wording decided after the card started (could switch mid-moment) | both resolved in one parallel read before the offers are set |
| 13 | FriendCollision (item 40) | collision rule at mount | VIOLATION: the friend was set before the photo was signed (placeholder converged, then swapped) | photo signed first, friend + photo in one update |
| 14 | StrongMatch (item 37) | the one rule over the top pick's real pieces | PASS | - |
| 15 | NearbyPickBadge / FoundLine | top of a real scored list / real results present | PASS | - |
| 16 | HappeningRipple (item 26), RightNowMark | a gathering not yet shown this session | PASS | - |
| 17 | WeatherShift (item 36) | the forecast's condition changed that day | PASS | - |
| 18 | AnticipationText | the real day count's tier | PASS | - |
| 19 | MatchAnimation (all 5 screens) | server mutual match / accepted request returned | PASS | - |
| 20 | ConnectionGlyphSwap | mounted only on a detected real transition | PASS | - |
| 21 | SurpriseRevealAnimation (2 screens) | after the reveal RPC succeeded | PASS | - |
| 22 | Occasion options loader (NLoader captions) | a 900 ms timer cycling 4 "stages" and looping | VIOLATION: staged progress no real stage drove | one steady caption for the one call; guard: no `captions={` anywhere |
| 23 | Success toasts | after the action returned (the following await is a reload) | PASS | - |

## Fixed (5 violations + item 41's 2)
Guards: `src/motion/motionTruth.test.js` (4), `motion/interestedSaved.test.js` (updated: flash after the save),
`services/firstReplyMoment.test.js` (updated: decided before the offers are set), `utils/friendsPlanningMoment.test.js`.

## Residual (left, for the device check)
- Host join: the gathering is set before join detection runs, so for a moment the new attendee sits in Who's going as a
  still face, then remounts and flows in. Fixing it means reordering the host's whole load; judge it on a device first.
- Group plan "You're booked": a reused older reservation row for the same offer (on conflict do nothing) is not re-checked
  for status. Practically unreachable (the offer was 'offered' a moment before).
