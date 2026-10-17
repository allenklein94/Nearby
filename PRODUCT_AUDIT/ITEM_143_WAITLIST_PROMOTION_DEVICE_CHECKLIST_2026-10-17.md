# Item 143: moved off the waitlist -> "~~On waitlist~~ → ✓ Attending", device checklist (2026-10-17)

Owner ask (approved 2026-10-16): being moved from the waitlist into Attending is a confirmed change of attendance, so it gets
item 31's moment, once per gathering, the first time the person opens that gathering afterwards. Never for Requested on an
approval-needed gathering, never for a normal join. Reduce Motion = finished state at once; taps work at once; without the
animation the screen still reads "You're in".

Built:
- Migration `20270319_waitlist_promotion_moment.sql` (LIVE; live definitions + grants checked equal to the file 2026-10-17):
  table `gathering_waitlist_promotions` (one row per attendance row that went waitlisted -> approved, by ANY path: automatic
  `_promote_from_waitlist`, a capacity change, the host approving a waitlisted person), written only by trigger
  `on_gathering_interest_waitlist_promotion`; any other status change of that row removes it, leaving deletes it (cascade).
  Its own table, not a column on `gathering_interest` (other viewers can read attendee rows; who was waitlisted is private).
  No client grants; read via `get_my_waitlist_promotion(gathering)` (own row, only while still approved) and stamped via
  `mark_my_waitlist_promotion_seen(gathering)` (idempotent, first stamp kept). Both closed to anon.
- ONE client rule `waitlistPromotionMoment` in `src/utils/waitlistPromotion.js`: stored status approved AND a server record
  AND not seen. GatheringDetail reads it after loading a non-host approved attendance, shows the moment, marks it seen; the
  decision is held for the rest of the visit (a reload never replays or removes it).
- Rendering: item 31's `motion/InterestedToAttending.js` with existing labels `ui.actions.onWaitlist` / `ui.actions.attendingNow`
  (spoken line built from the same two labels), inside the You're in panel above its unchanged title. Never shown together
  with item 31's own moment. No new strings, no new motion primitive (`MOTION_PRIMITIVES.interestedToAttending` now names 31/143).
- Tests: `src/utils/waitlistPromotion.test.js`; journey `waitlistPromotion` 8/8 on prod (rolled back): A full open gathering ->
  waitlisted -> a guest leaves -> promoted + recorded -> moment; marked seen -> repeat visit no moment; B approval-needed ->
  waitlisted -> pending ("Requested") -> no record, host approval later -> still no record; C normal join -> no record;
  D another person can't read or mark it, no table grants; E leaving removes the record.

Known limits: if marking seen fails (offline), the moment may show once more on a later visit (never invented). A promotion
that happened before migration 20270319 has no record, so it never plays.

Record for each run: device, OS, appearance (light/dark), Reduce Motion on/off, accounts used (host, waitlisted person, a guest), result, notes.

| # | Check | Result |
|---|-------|--------|
| 1 | Full open gathering: the person taps Join Waitlist -> "On waitlist"; no moment. | |
| 2 | A guest leaves; the waitlisted person opens the gathering (from the "A spot opened up" push or Plans): "~~On waitlist~~ → ✓ Attending" plays once with one glow, above "You're in". | |
| 3 | Close and reopen the same gathering, pull to refresh, relaunch the app: never plays again; "You're in" stays. | |
| 4 | Second phone / same account on another device after it was seen: no moment. | |
| 5 | Host raises capacity so a waitlisted person gets in: same as check 2 (once). | |
| 6 | Approval-needed full gathering: waitlisted -> a spot opens -> "Requested": no moment; host approves later: no moment (plain You're in). | |
| 7 | Normal join with room, and a join from Interested: no waitlist moment (the Interested join keeps item 31's own row only, never both). | |
| 8 | Reduce Motion on: the finished row ("~~On waitlist~~ → ✓ Attending") shows at once, no glow. | |
| 9 | While it plays, every button (Chat, Leave, Invite, share) responds at once; no vibration. | |
| 10 | Text readable throughout; no layout jump of the You're in panel; light and dark. | |
| 11 | Screen reader: the row reads "On waitlist, Attending"; then "You're in". | |
| 12 | Host's own view and other attendees: nothing changes for them. | |
| 13 | Leave after being promoted, rejoin with room: no waitlist moment. | |
| 14 | Offline when opening after promotion: no moment until the read succeeds; never a wrong one. | |
