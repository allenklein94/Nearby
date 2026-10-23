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
gathering) / "{name} and {count} more joined". Owner item 73 (2026-10-12, LOCKED) refines the arrival: first one full, the rest
small. The full moment (fly-in, roll, glow, line; 320 ms) plays for a join after 10 s with no join. A join within 10 s of the
previous one only fades in in place (~180 ms, no slide/grow/glow), the figure still rolls, and the line counts everyone since the
full moment. In one update the lead is full and the rest small, all together (no stagger). The 10 s window runs on when each
join arrived on screen, never on animations. Who's going is an overlapping cluster (host + joined faces, max 6, "+N").
The figure includes the host (host + 3 joined = "4 attending"). Reduce Motion = the settled state at once. No haptic. Live only:
a reload or reopen replays nothing.

## Setup

- Two signed-in accounts on two phones: a **host** with an open gathering, and a **guest** (ideally an accepted friend of the host).
- A third account (not a friend) for check 4. Checks 7, 15 and 16 need five guest accounts (they can be on fewer phones,
  signing in and joining in turn) and a stopwatch or a screen recording with timestamps.
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
| 7 | Several joins in one update (item 73): the lead face flies in; the others fade in in place at the same time (no slide, no grow, no one-after-another); the line reads "{name} and {count} more joined"; done in under ~0.4 s. | PENDING | PENDING | |
| 8 | Text is readable throughout (figure and line never hidden by the motion). Tapping anything during it works at once. | PENDING | PENDING | |
| 9 | Leave and reopen the gathering, and fully reload the app: nothing replays. A second identical event does not replay it. | PENDING | PENDING | |
| 10 | Reduce Motion on: the new figure, face and line appear at once, settled. No motion. | PENDING | PENDING | |
| 11 | No vibration at any point (the host tapped nothing). | PENDING | PENDING | |
| 12 | The cluster: at most 6 faces, "+N" for everyone else; only approved attendees + host (never invitees, Interested, requests or waitlist). | PENDING | PENDING | |
| 13 | Light and dark: faces, overlap edges and the line are clear in both. | PENDING | PENDING | |
| 14 | Overall: feels like the gathering coming together, calm, not a slot machine; no dropped frames on a mid-range Android. | PENDING | PENDING | |
| 15 | Item 73: four guests join within 10 s, each in its own update (> 1 s apart). ONE full moment (first face flies in, figure rolls, glow, "{name} joined"), then THREE small arrivals (each face only fades in where it lands, ~180 ms; the figure still rolls; no glow; the line stays and becomes "{name} and 1/2/3 more joined", keeping the first name). Never four identical fly-ins. | PENDING | PENDING | |
| 16 | Item 73: after check 15, wait more than 10 s with no join, then a fifth guest joins: the FULL moment again (fly-in, roll, glow, the line settles in fresh naming that guest). Also: with Reduce Motion on, run 15 + 16; everything appears settled at once and the line's words still count the same way. | PENDING | PENDING | |
| 17 | Idea "361" (owner, 2026-10-23): ask the host, without prompting, what just happened. PASS = they say someone was added / joined the plan (not "a button was pressed" or "something refreshed"); the moment does not feel excessive or distracting. Also: inviting a friend from the Invite sheet moves NO face into Who's going (only "✓ Sent"); the face arrives only when that friend really accepts/joins. Report only; a problem = wording/timing fix at the shared source, never more motion. | PENDING | PENDING | |

Overlap: the last bullet of section 8 in `OFFER_EXPERIENCE_DEVICE_CHECKLIST_2026-10-10.md` (host sees a join, figure updates, glow
once, no vibration) is the same observation as checks 1, 9 and 11 here; record it against both.

Uncovered elsewhere: realtime join delivery to a real signed-in host has never run. No journey covers on-screen counts or motion;
the logic is guarded by `utils/hostLiveJoinsMoment.test.js`.

## Results

A documented check is not a passed check: only a recorded result closes it.

(Record failures here with a screenshot or recording, the device row, and the fix commit if any.)
