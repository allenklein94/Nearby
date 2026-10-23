# Understood chips: People count + remove only (owner, 2026-10-15) device checklist

Status: BUILT, LIVE (migration 20270306), NOT DEVICE-VERIFIED. Record device, OS, light/dark, Reduce Motion and pass/fail per check.
Scope (owner): decisions 1 and 2 approved, decision 3 (change/picker) DEFERRED. Remove only; no new strings; motion unchanged.

1. Home ask "live music for 4 people tonight": the understood chips include "4 people" (existing `ui.common.count.people`).
2. Home ask "coffee date tonight": NO people chip (a date's assumed 2 never shows). "dinner for two" shows "2 people".
3. Each understood chip on the results carries "✕" (like the Discover category rail's selected chip). The chips under the
   "Finding…" loader do NOT (nothing to re-run yet).
4. Tap ✕ on "Tonight" (Home): results replace in place under the same words (box text unchanged, no keyboard, no new screen, no
   navigation animation); the Tonight chip is gone; later-dated results appear; the other chips and the refinement row are as before.
5. Tap ✕ on "Outdoor" for "something outside right now": indoor places come back; the "Outdoor" chip is gone and does not
   reappear on that results list (the words still say "outside").
6. Tap ✕ on the activity chip, the party chip (e.g. Family) and "4 people" in turn: each disappears and stays gone; nothing else changes.
7. After removals, tap With friends / Under $25: the removed chips stay removed.
8. Discover search: same as checks 4-6 in place. A Browse category picked on the rail shows as the activity chip; its ✕ clears
   the rail selection too (one state).
9. While a removal is running, the chips' ✕ and the refinement chips are disabled (no double run); the inline loader shows.
10. "Create it yourself" and "Ask Nearby Businesses" after a removal: the removed piece is NOT carried ("From what you said" card,
    the request's prefilled fields).
11. People mode opened by a people ask ("meet someone tonight"): the chips above People have NO ✕ and do nothing on tap.
12. Motion: the chips' first settle is unchanged and does not replay after a removal; Reduce Motion = chips there at once.
13. VoiceOver/TalkBack: each removable chip reads "{label}, selected. Tap to clear" as a button; the loader/People chips read as
    one static label.
14. Layout: with 4 chips + ✕ on a small phone, the row wraps cleanly (no clipping); at most 4 chips show (the existing cap).
15. Item 87 (added 2026-10-15): Home asks "coffee outside tonight for 4 people", "grab coffee outside tonight, 4 of us" and
    "coffee outdoors tonight with 4 friends" each show Coffee · Tonight · Outdoor · People; the count is 4, 4 and 5 (LOCKED rule:
    total including you; "4 friends" = four companions + you). "coffee outdoors" never shows an "Outdoors" activity chip.

16. Changing a chip (owner idea "307", added 2026-10-20). Home AND Discover, ask "live music tonight at 7 for 4 people":
    a. The Tonight and 4 people chips each show their label + a separate ✕; Live Music has only the ✕ (WHAT/WHERE/WHO stay remove-only).
    b. Tap "Tonight": one row of choices appears under the chips (Right Now, Today, Tonight ✓, Tomorrow, This Weekend), instantly,
       no animation, no coral. Tap "Tonight" again: the row closes. Opening People closes the When row (one row at a time).
    c. Pick Tomorrow: the row closes, the chip reads Tomorrow, results re-run in place (no navigation, no retyping, no loader screen),
       showing tomorrow's things. Pick 6 on People: the chip reads 6 people.
    d. Tap ✕ on the changed chip: it goes, the results update, it does not come back.
    e. After Tomorrow + 6: "Ask Nearby Businesses" shows Tomorrow and 6 people (never Tonight / 4) and the Time field is "Any time"
       (the words' 7 PM belonged to Tonight); People alone changed keeps 7 PM. "Create it" opens with Tomorrow + 6 people;
       This Weekend leaves When for Create to ask.
    f. Changing while results are updating is disabled (no double re-run). VoiceOver/TalkBack: the label reads "{label}. Tap to change"
       (expanded/collapsed announced), the ✕ "{label}, selected. Tap to clear", each choice its label + selected state.
    g. Layout: a small phone in light and dark mode: the choices row wraps cleanly under the chips, nothing is clipped.

17. Clock chip (owner idea "306", 2026-10-22; migration 20270335):
    a. Type "live music tonight after 7": a chip "After 7 PM" shows with the others; the old grey "Keeping it after 7 PM" line is
       gone. "music after 7" (no day) and "live music tonight at 7" show NO clock chip (the search doesn't use those times);
       "live music tonight after 9" shows none either (9 is never guessed).
    b. Tap "After 7 PM": one row "After 7 AM" / "✓ After 7 PM" (same look as the When row, no motion, no coral). Pick 7 AM: the
       results reorder in place (afternoon plans rise), the chip reads "After 7 AM", the typed words stay.
    c. ✕ on the clock chip: it goes, results update, the evening order no longer applies; noon/midnight chips offer no row.
    d. "I need a car wash today at 7": chip "At 7 PM"; switch to 7 AM; "Ask Nearby Businesses" shows Time 7:00 AM; after ✕ the
       Time is "Any time". "Create it" (owner 2026-10-23): see check 18.
    e. Restart the app on Discover: the corrected chip and results come back the same (session restore).
    f. VoiceOver/TalkBack: "After 7 PM. Tap to change". Cap fix (owner 2026-10-22): an ask with more than 4 understood pieces
       (e.g. "live music tonight after 7 near me for 4 people") shows 4 chips + a quiet "+N" (screen reader "Show more"); tapping it
       shows the rest in place, settled (no motion), each with its own ✕ / change row, so People stays changeable and the clock
       chip still flips AM/PM.
       Non-English: chip words come from 4 new `ui.discover.understoodClock*` strings (10 languages machine-authored, need review).

18. Clock time into Create (owner 2026-10-23; no migration, no new strings; guard `utils/createStartTime.test.js`). "Create it"
    from Home AND Discover results, then look at Create's When step (Tonight/Tomorrow chip + the date-time row under it):
    a. "Pickleball tomorrow at 7 PM": Tomorrow selected, row shows tomorrow 7:00 PM. "dinner tonight at 8 pm": Tonight, 8:00 PM.
    b. "pickleball tomorrow at 9" (ambiguous): Tomorrow selected at its usual default (noon), never 9 AM or 9 PM.
    c. "coffee tonight after 7 PM" and "drinks tonight before 9 PM": Tonight at its usual default time; never presented as a
       stated start. Note whether the default (7 PM) looks like a carried start to you: report only.
    d. "I need a car wash tomorrow at 7": switch the clock chip to 7 AM, then Create: tomorrow 7:00 AM. Ask Nearby Businesses
       from the same results: Time 7:00 AM (the same reading).
    e. Same ask, ✕ on the clock chip, then Create: Tomorrow at its default; change When to Tonight instead: Tonight at its
       default (the old 7 is dropped).
    f. "pickleball at 7 PM" (no day): Create's When step asks (nothing selected).
    g. Typed straight into Create's own box ("tennis tomorrow at 6 pm"): Tomorrow 6:00 PM.
    h. Tap Adjust: the picker opens on the carried time; Back to What and forward again keeps it.
    i. Named day (owner 2026-10-23, report only): "pickleball saturday at 2 pm" and "coffee friday at 9 am". Expected as built:
       Create's When step asks for day AND time (nothing selected); the stated 2 PM / 9 AM is NOT carried, because the ask
       carries no Create day ("saturday" reads as the weekend window, which Create has no preset for; "friday" reads as no day).
       Record whether re-entering the day and time feels like being re-asked something Nearby knew: report only, no code change
       unless the owner decides one.

Known limits (disclosed): pieces past the 4-chip cap sit behind "+N" until tapped (never dropped, since the 2026-10-22 cap fix); removing WHO/WHAT does not mute softer ranking reads of the same words (social context, title mentions,
the learned-affinity "constrained" check), which only order results and never add a chip, filter or caption back.
