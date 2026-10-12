# Item 28 - a friend joins your gathering: device checklist (2026-10-12)

**Built and LOCKED as approved; device verification PENDING.** This list exists to check the approved experience on real
phones, not to redesign it. Item 28 (with its 2026-10-11 follow-up) builds on item 25 #3. Tests and parse checks do not count:
a line passes only when it is seen on a physical phone. Keep iOS and Android results separate. A platform nobody has tested
stays PENDING. Record any failure as it was seen, and never change locked behavior to work around it. A fix goes through the
shared source (`motion/JoinArrival.js`, `utils/hostLiveJoins.js`, `utils/gatheringAttendeeDisplay.js`) and keeps the approved
tokens. No new strings. Native review of `ui.hostCenter.joined.*` (11 languages) is tracked separately.

What was approved (summary; full record in CLAUDE_HISTORY.md, "Item 28"): the host has their own open gathering on screen and a
person joins (realtime). The "N attending" figure rolls from old to new (`CountRoll`). The new face flows in from the side
(24 px, fade + slight grow; no arc) while the faces already shown ease aside. A line names who joined: "{name} joined" /
"Your friend {name} joined" / "{name} accepted your invite" (only for this host's own accepted invite to that person for this
gathering) / "{name} and {count} more joined". Several joins in one update arrive one after another (120 ms apart, at most 5
staggered; worst case 800 ms; a single join 320 ms). Who's going is an overlapping cluster (host + joined faces, max 6, "+N").
The figure includes the host (host + 3 joined = "4 attending"). Reduce Motion = the settled state at once. No haptic. Live only:
a reload or reopen replays nothing.

## Setup

- Two signed-in accounts on two phones: a **host** with an open gathering, and a **guest** (ideally an accepted friend of the host).
- A third account (not a friend) for check 4. Optional: a fourth and fifth for check 7 (several at once).
- The host's invitation to the guest for check 5 (send it from the gathering, the guest accepts, then joins).
- Run in light AND dark. Repeat checks 1, 7 and 10 with Reduce Motion on (iOS: Accessibility > Motion; Android: Remove animations).

## Record (one row per run)

| Date | Device | OS + version | Appearance | Reduce Motion | Build | Tester |
|------|--------|--------------|------------|---------------|-------|--------|
|      |        |              |            |               |       |        |

## Checks

| # | Check | iOS | Android | Notes |
|---|-------|-----|---------|-------|
| 1 | Host has the gathering open; guest joins. Within ~1 s the figure rolls (e.g. "2 attending" -> "3 attending"), never jumps or flickers. | PENDING | PENDING | |
| 2 | The new face flows in from the side into the cluster while the others ease aside (no arc, no bounce). It lands in place, not overlapping wrongly. | PENDING | PENDING | |
| 3 | An accepted friend of the host: the line reads "Your friend {name} joined". | PENDING | PENDING | |
| 4 | A non-friend: the line reads "{name} joined". A person with no display name: no line, the figure and face still update. | PENDING | PENDING | |
| 5 | The guest accepted the host's own invite for THIS gathering, then joined: "{name} accepted your invite". An invite for another gathering, or from someone else: never this line. | PENDING | PENDING | |
| 6 | The figure includes the host everywhere it shows (host + 3 joined = "4 attending"): host screen, detail summary, Home Your Plans. | PENDING | PENDING | |
| 7 | Several joins in one update: faces arrive one after another (not all at once), the line reads "{name} and {count} more joined", the whole thing is done in under ~0.8 s. | PENDING | PENDING | |
| 8 | Text is readable throughout (figure and line never hidden by the motion). Tapping anything during it works at once. | PENDING | PENDING | |
| 9 | Leave and reopen the gathering, and fully reload the app: nothing replays. A second identical event does not replay it. | PENDING | PENDING | |
| 10 | Reduce Motion on: the new figure, face and line appear at once, settled. No motion. | PENDING | PENDING | |
| 11 | No vibration at any point (the host tapped nothing). | PENDING | PENDING | |
| 12 | The cluster: at most 6 faces, "+N" for everyone else; only approved attendees + host (never invitees, Interested, requests or waitlist). | PENDING | PENDING | |
| 13 | Light and dark: faces, overlap edges and the line are clear in both. | PENDING | PENDING | |
| 14 | Overall: feels like the gathering coming together, calm, not a slot machine; no dropped frames on a mid-range Android. | PENDING | PENDING | |

Overlap: the last bullet of section 8 in `OFFER_EXPERIENCE_DEVICE_CHECKLIST_2026-10-10.md` (host sees a join, figure updates, glow
once, no vibration) is the same observation as checks 1, 9 and 11 here; record it against both.

Uncovered elsewhere: realtime join delivery to a real signed-in host has never run. No journey covers on-screen counts or motion;
the logic is guarded by `utils/hostLiveJoinsMoment.test.js`.

## Results

A documented check is not a passed check: only a recorded result closes it.

(Record failures here with a screenshot or recording, the device row, and the fix commit if any.)
