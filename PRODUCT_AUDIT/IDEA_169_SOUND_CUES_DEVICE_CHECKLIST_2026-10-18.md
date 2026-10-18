# Idea "169" sound cues: device checklist (2026-10-18)

Owner idea "169" (not item 169, the Food & Drink coverage spec). Three optional customer-side cues: a business replies while the
app is open, your own accept/confirm is booked, your visit is confirmed. Built and unit-tested; nothing below has been run.
Record each result as: device, iOS version, appearance, PASS/FAIL, notes.

Needs: a real iPhone (iOS only; Android shows no switch, see check 14), a second account or a business to send replies, a test
business that can confirm a visit (offer experience checklist set-up; needs Anthropic credit for screened offer content).

## Switch
1. Fresh install: Settings > Appearance shows "Sound cues", OFF. With it off, run checks 4-6: no sound at all.
2. Turn it on, force-quit, reopen: still on. Turn it off: still off after a restart.
3. VoiceOver reads the switch as "Sound cues" with its state; the helper text is readable at the largest text size.

## The three cues (switch ON, ringer ON, Reduce Motion OFF)
4. Offer arrives while you are on another screen: the arrival pill appears and ONE soft chime plays with it (not before it).
   Two replies within a few seconds: still one chime.
5. Offer arrives while that request is on screen: the card builds in (item 23) and one chime plays.
6. Tap "I'll take this one": after the booking returns, the accepted card's ✓ settles with the success vibration and one short
   rising cue. A failed or refused accept: no cue. Group plan: the final confirm that books shows "You're booked" with the cue;
   an interim "N of M confirmed": no cue.
7. Business confirms the visit while the request is open: "✓ Visit confirmed" settles with one warm tone. Leaving and reopening
   the request: no tone again.
8. Every visual reads the same with the switch off: nothing depends on the sound.

## Device settings and accessibility
9. Ring/Silent switch on silent: checks 4-7 make NO sound (the visuals still play).
10. Reduce Motion on (Settings > Accessibility > Motion): no cue in checks 4-7, even with the switch on.
11. Music or a podcast playing: the cue mixes in briefly; the music does not pause, stop or duck.
12. Do Not Disturb / a Focus on: record what happens. Known limit: iOS gives apps no way to see a Focus without an
    entitlement, so the cue still plays with the ringer on. Owner to decide whether that is acceptable.
13. App closed or in the background when a reply arrives: only the phone's own push sound, never an in-app cue on return.
    App open when the reply push arrives: the push sound only, no chime on top within 10 s.
14. Android: Settings shows no "Sound cues" switch and no cue ever plays (Android gives the app no silent/Do Not Disturb signal
    without a new native module).
15. Recording a voice note in chat when a reply arrives: the recording continues uninterrupted and no cue plays.
16. Business side (business account, dashboard and website): no sound anywhere.

## Feel (report only)
17. Do the three sounds feel subtle, distinct and not like notification spam? Is the volume right next to system sounds?
