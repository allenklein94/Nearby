# Plan lifecycle + "You're here": scope (owner ideas "147" and "148", 2026-10-17)

The owner numbered these 147 and 148, which are already items 147 (non-public gathering rows) and 148 (story/sighting location).
They are called "plan lifecycle" and "You're here" here. Nothing is built; this maps the ideas onto what exists and asks for decisions.

## 1. Plan lifecycle: mostly met as built

| Proposed stage | What exists (one source each) |
|---|---|
| Planning ("Let's make it happen") | Create's five steps, "Your gathering is live!" (item 43); offer side: request -> replies -> "I'll take this one" (items 12/32) |
| Confirmed ("You're going") | "You're in" banner + viewer relation (`objectState.js`); booked plan "You're booked", solid join rail (item 32) |
| Starting soon ("Time to go") | "Starts in 45 min" from the one time engine (`timeContext` / `timeWindow`, live via item 108's minute clock); starts-soon push; item 145's Get directions |
| Happening now ("You're here") | "Happening now" / "Ends in N min" (`timeWindowState`); "I'm on my way" + "I'm here — check in" (manual) |
| Completed ("How was it?") | "~~Confirmed~~ → ✓ Completed" once + inline "How was it?" (item 34, `isGatheringOver`) |

So the "heartbeat" already exists as states. Locks that apply: no motion added to any stage, no urgency styling or reordering in
the last hour (item 145 / item 108), cards stay static (item 58), no new stage screens (item 45). New stage headlines ("Time to go",
"You're here") would be new copy on top of the existing labels; I don't recommend them unless a phone shows the stages unclear.

## 2. Gaps found while auditing (real, fixable in the shared source)

**G1. Two clocks on one screen.** The attending hub (`components/GatheringAttendingSection.js`) uses its own rule,
`getCountdownLabel` in `utils/gatheringAttending.js`: "Happening now" for 3 h after start, ignoring `duration_minutes`. Everything
else uses `timeWindowParts` (over at start + duration; with no duration, live 30 min). Example: a 1-hour gathering at 6 PM, at 7:30 PM:
Home's Your Plans says "✓ Completed · How was it?" while its detail screen says "Happening now" with "I'm on my way" and "I'm here".
Fix: the hub reads `timeWindowState` / `isGatheringOver` (master principle 2); `getCountdownLabel` goes. No new strings (the hub's
"Starts in" wording would follow the shared engine's).

**G2. "I'm here — check in" is offered any time before the end, days ahead included, and the server accepts it.**
`check_in_to_gathering` sets `checked_in_at` for any approved attendee at any time, and it cannot be undone. One early tap flips
that person's hub to "Have fun! We'll see you afterwards" a week ahead, adds them to the "Who's here · N checked in" count every
attendee sees, and later counts toward item 53's "plans this month" (with the gathering over) even if they never went. Fix: one window rule (e.g. from 30 min before start until the gathering is over), the same in the
client and in the RPC (refuses outside it). Journey to extend: `planComplete` / a new `gatheringCheckIn`.

## 3. "You're here": options (owner to pick)

Constraints already locked: location only through `services/userLocation.js`, foreground only (item 39); the precise meet-up point
reaches only the host + approved attendees (item 146); a check-in is shown to other attendees, so it must stay the person's own act;
a redemption is only ever the business's confirmation (perk rule, item 52), so arrival can never redeem anything.

**A. Keep it manual (recommended first).** Fix G2. During the window, the hub already offers check in, Message group (the gathering
chat), Get directions; an offer-booked plan keeps its own visit flow. Nothing location-based. No new strings.

**B. On-device suggestion, never automatic.** Only if A is built and the person has ALREADY granted foreground location: while the
detail screen is open during the check-in window, compare the current fix (via `userLocation.js`) with the meet-up point the
attendee already holds, on the phone only (nothing sent, stored or logged). Within ~150 m with good accuracy, the check-in button
reads "Looks like you're here · Check in"; the person still taps. Never a background check, geofence, push or auto check-in;
never asks for location permission for this; poor accuracy = the plain button. Cost: 1-2 new strings + native review, a guard that
no location leaves the device, device checks (indoor GPS accuracy is often 50-100 m, so false "you're here" is possible).

**C. Automatic arrival (background/geofence).** Not recommended: it needs background location (against item 39's foreground-only
rule) and would publish a person's arrival to others without a tap.

## Decisions needed
1. Fix G1 (one clock) and G2 (check-in window, server-enforced) now? Recommended: yes, both (journey-level fixes, no new strings).
2. "You're here": A, B or C? Recommended: A now; B only after A passes on a phone.
3. New stage headlines ("Time to go", "You're here"): recommended no (existing labels already say it).

## Owner decisions (2026-10-17) and outcome
Fix G1 + G2 now; "You're here" = A; no new headlines. BUILT, LIVE (migration 20270326), NOT DEVICE-VERIFIED:
`GATHERING_CHECK_IN_WINDOW_DEVICE_CHECKLIST_2026-10-17.md`. Record in CLAUDE_HISTORY.md (2026-10-17, "Gathering clock (G1) + check-in window (G2)").

## Owner lock (2026-10-17, confirmed)
LOCKED: manual check-in only (during the window an eligible attendee sees Check in, Message group, Directions); no location-based
behaviour (neither C nor B); no new stage headlines ("Time to go", "You're here" or others); check-in never creates or triggers a
redemption (only a business-confirmed visit counts; offer-booked plans keep their visit flow). Option B DEFERRED: reconsider only after
`GATHERING_CHECK_IN_WINDOW_DEVICE_CHECKLIST_2026-10-17.md` passes on a physical phone; any later build must require foreground location
permission already granted, compare on the device only, keep the attendee's own tap to check in, and never transmit or store location
for the suggestion. Nothing built by this decision.
