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

Known limits (disclosed): the cap of 4 understood chips is unchanged, so an ask with activity + time + place + party + count
drops the count chip; removing WHO/WHAT does not mute softer ranking reads of the same words (social context, title mentions,
the learned-affinity "constrained" check), which only order results and never add a chip, filter or caption back.
