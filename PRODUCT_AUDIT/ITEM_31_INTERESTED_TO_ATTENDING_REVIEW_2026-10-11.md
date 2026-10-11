# Item 31 — Interested → Attending: closure review (2026-10-11)

**Status: OPEN.** Built and tested. The owner's completion rule says it closes only when native-speaker localization review
(section 1) and device verification (section 3) are documented here. Both need people or hardware this environment
doesn't have.

Behaviour (approved, locked): on GatheringDetail, inside the existing "You're in!" panel, a row shows
`★ ~~Interested~~ → ✓ Attending`:
- "Interested" is struck through and fades.
- "Attending" slides in beside it in the success colour, grows slightly and glows once (settles at about 0.76 s).
- No bounce, confetti or extra vibration.
- The row stays for the rest of the visit. A reload never replays it.
- Reduce Motion shows the finished row at once.
- The row appears only when the person's own join from Interested comes back approved AND the reloaded stored
  attendance is approved (`utils/interestedMoment.js`).
- No new screen and no schema change. The server's `clear_interested_on_join` is unchanged.

## 1. Localization (machine-authored; self-reviewed, native review still required)

The label sits next to the existing `ui.actions.interestedOn` ("★ Interested"), so it should read as a parallel state.
The screen-reader line is announced once, as a polite live region, when the row appears.

| Lang | From (existing) | Attending label | Screen-reader line | Self-review notes |
|---|---|---|---|---|
| en | ★ Interested | ✓ Attending | No longer just interested: you're attending | — |
| es | ★ Me interesa | ✓ Asistiré | Ya no solo te interesa: vas a asistir | was "Asistes"; first person to match "Me interesa"; gender-neutral |
| de | ★ Interessiert | ✓ Dabei | Nicht mehr nur interessiert: du bist dabei | matches "Du bist dabei!" in the panel title; informal "du" as elsewhere |
| fr | ★ Intéressé | ✓ Je participe | Ce n'est plus un simple intérêt : vous participez | was the bare verb "Participe"; line was gendered ("intéressé"), now neutral. **The existing "★ Intéressé" label is masculine: pre-existing, not changed here, flag for the reviewer** |
| pt | ★ Tenho interesse | ✓ Vou participar | Não é mais só interesse: você vai participar | was "Participando" + gendered "interessado"; now neutral |
| ht | ★ Enterese | ✓ M ap patisipe | Ou pa sèlman enterese ankò: w ap patisipe | label was second person ("W ap…"); now first person like the other labels |
| zh | ★ 感兴趣 | ✓ 确定参加 | 不再只是感兴趣：你已确定参加 | **was "已参加" = "already attended" (past), wrong for an upcoming gathering** |
| vi | ★ Quan tâm | ✓ Sẽ tham gia | Không chỉ quan tâm nữa: bạn sẽ tham gia | future marker added ("will attend") |
| tl | ★ Interesado | ✓ Dadalo | Hindi na lang interesado: dadalo ka na | "Interesado" is the Spanish-derived form used app-wide |
| ru | ★ Интересно | ✓ Участвую | Уже не просто интересно: вы участвуете | first person, gender-neutral (present tense) |
| ko | ★ 관심 있음 | ✓ 참석 확정 | 관심에서 참석으로 바뀌었어요 | "confirmed attending", matching the panel title "참여 확정!" |

Reviewer checklist per language: natural as a short status label; parallel with the "from" label; the line reads well
when spoken by VoiceOver/TalkBack; no gender or formality mismatch with the rest of the app; fits on one line at 19 px
bold (it wraps under the arrow if not).

Native reviewer sign-off: _not yet_ (name, date, per language).

## 2. Automated coverage (done)

- `src/journeys/interestedToAttending.journey.js` (live database, rolled back) runs four stories as the same person.
  A: open gathering from Interested → approved, mark cleared, relation attending → moment.
  B: approval required from Interested → pending, mark cleared (server, unchanged), relation requested → no moment.
  B later: the host approves → approved, still no moment (not this visit's own join).
  C: full gathering from Interested → waitlisted → no moment.
  D: a plain join (never Interested) → approved → no moment (today's "You're in!").
  Reload: the stored state alone never shows it.
- `src/motion/interestedToAttending.test.js` covers:
  - budget, tier, native driver, and no bounce, loop, confetti or haptic
  - strikethrough, fade, flow-in and one glow
  - Reduce Motion and decided-once-at-mount (no replay)
  - the eligibility rule, and the screen wiring through it (memory-only state)
  - regression: approved = one Success vibration and `justJoined`; pending/waitlist = Medium impact and no `justJoined`;
    the panel's title and prompt are unchanged for every approved viewer
  - the contrast tokens and wrapping
- Not coverable here: the rendered pixels and real timing. No React Native render or device runner exists in this repo.

## 3. Contrast (computed from `theme.js`, WCAG 2.x)

| Element | Light | Dark | Requirement |
|---|---|---|---|
| "✓ Attending" (success on its 10% success tint) | 3.78:1 | 7.62:1 | large text 3:1 → met because the label is **19 px bold** (large text); at the original 14 px light failed 4.5:1 |
| success token on plain white (for reference) | 4.28:1 | — | the shared token is under 4.5:1 for small text app-wide: a theme-level finding, not changed here |
| struck "★ Interested" (textSecondary at 0.75) | 3.56:1 | 4.60:1 | the original textTertiary at 0.45 was 1.5:1 / 1.7:1. Now ≥ 3:1. Under 4.5:1 for 14 px in light: it is the superseded state (struck through, also in the spoken line). **Owner call:** accept, or fade less (0.85+) |

## 4. Device verification (NOT DONE: needs a phone)

Run on iOS and Android, light and dark:
1. Open gathering, mark Interested, tap I'm Going and confirm. The row plays once (about 0.75 s): Interested struck
   through and faded, Attending slides in, grows, glows once. Exactly one success vibration (the join's own). Timing feels calm.
2. Pull to refresh, background and foreground, and leave and reopen the gathering. The row never replays. After
   reopening, it is gone and only "You're in!" shows.
3. Reduce Motion on (iOS Settings → Accessibility → Motion; Android "Remove animations"). The finished row appears at
   once and still reads Interested → Attending.
4. VoiceOver / TalkBack: the line is announced once. The row is not focusable as a button.
5. Largest Dynamic Type / font scale, and each of the 11 languages: no clipping. A long label wraps centred under the arrow.
6. Contrast by eye in sunlight/dark mode. The struck label is still legible.
7. Regression: a gathering needing approval (Interested → join) shows the pending state, Medium tap, no row. A full
   gathering shows the waitlist state, no row. A plain join without Interested shows "You're in!" only, with the usual
   success vibration.

Device sign-off: _not yet_ (device, OS, date, findings).

## 5. Open questions for the owner

- **A pending or waitlisted join loses the Interested mark at once** (existing server behaviour, kept as required).
  When the host later approves, there is no moment: the person isn't on the screen, and the client keeps no record
  that they were Interested (`gathering_interested_joins` is internal-only by design). Showing a moment then would need
  a new readable fact. Not built.
- Struck-label contrast (section 3).
