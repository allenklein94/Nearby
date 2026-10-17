# "Not interested" (owner idea "153") — device checklist, 2026-10-17

Status: **NOT RUN.** Nothing below has been checked on a phone. Record device, OS, appearance mode, app build and the
actual result (pass / fail + what was seen) for every check. A failure is recorded here, never worked around by changing
locked behavior.

Build under test: migration `20270327_gathering_not_interested.sql` (LIVE 2026-10-17), `utils/notInterested.js`,
`hooks/useNotInterested.js`, `components/NotInterested.js`, Home / Discover / Settings wiring. Journey `notInterested`
(20/20) and unit tests (`utils/notInterested.test.js`) pass; they are not visual or device sign-off.

Setup: two accounts (A = the person, B = a host). B hosts at least: two upcoming public Coffee gatherings, one Hiking, one
Faith & Spirituality, all near A. A has none of them in Plans.

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | Home → Picked For You compact card | A quiet ⋯ beside the card's one action; the action itself unchanged (still one Join / Request / I'm Interested / status) | |
| 2 | Home → Best Pick (the big card) | No ⋯ | |
| 3 | Home → Nearby Right Now card | ⋯ present (when the gathering is in the Right Now window) | |
| 4 | Discover browse: hero, standard and compact tiles | ⋯ on each; white on the hero image and readable in light + dark | |
| 5 | Discover with text typed in search; Home / Discover typed-ask results | No ⋯ anywhere | |
| 6 | A card you host / joined / requested / waitlisted / marked Interested | No ⋯ | |
| 7 | Tap ⋯ | ONE inline row "Not interested" under the card; tapping ⋯ again closes it; nothing navigates | |
| 8 | Tap "Not interested" on a Coffee card | Card replaced AT ONCE in the same place by "We'll show you less like this." + Undo. No animation, no other row moves | |
| 9 | Same on the Faith & Spirituality card | "You won't see this one again." (no "less like this" claim) | |
| 10 | Tap Undo | The card is back in place at once, same action | |
| 11 | Dismiss again, pull to refresh / leave and return to Home | The line is gone, the gathering is not shown in any Home placement (incl. Best Pick, weather card) | |
| 12 | Open Discover after dismissing on Home (same session) | That gathering not in browse lists or the map | |
| 13 | After reload: the other Coffee gathering vs the Hiking one | Coffee ranks lower than before (compare with a fresh account or before dismissing) | |
| 14 | Type a Coffee search ("coffee tonight") | Coffee results not pushed down by the Not interested; the dismissed gathering can still be found by searching | |
| 15 | Settings → What Nearby has noticed | "You said Not interested" lists Coffee with Forget; Forget → toast; Coffee gatherings show again on Home after reload | |
| 16 | Settings → Clear my activity history | The Not interested list empties; dismissed gatherings show again after reload | |
| 17 | Account B (host) views the gathering A dismissed | No count, name, change or notification of any kind; no push on B's phone | |
| 18 | Airplane mode, then tap "Not interested" | Card comes back with the "couldn't complete that" error + Try Again; nothing is half-saved | |
| 19 | Screen reader (VoiceOver / TalkBack) | ⋯ reads "More options for {title}", the row "Not interested in {title}", the line is announced, Undo reads "Undo Not interested for {title}" | |
| 20 | Reduce Motion on | Same as off (there is no motion) | |
| 21 | Each of the 11 languages (native reviewer) | The 11 `ui.notInterested.*` strings read naturally; Settings line fits | |

Native-speaker review: the 10 non-English versions of the 11 `ui.notInterested.*` strings are machine-authored and
NOT reviewed.
