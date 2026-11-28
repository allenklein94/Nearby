# Design-system audit, consumer app + Business Mode (item 34, 2026-11-27)

Scope: every file in `src/screens` (102) and `src/components` (111), the shared tokens in `src/theme.js`, and the shared
pieces (`ToggleRow`, `LoadErrorState`, `EmptyCopy`, `FieldError`, `disabledButtonStyle`, `offerCardStyles`,
`constants/functionalIcons.js`). Measured with two read-only tools committed in this round:
`node scripts/design/style-audit.js` (style literals) and the AST tools below. No device screenshots and **no approved
visual mockups exist**, so nothing that changes how a surface LOOKS was changed without your approval; everything that
is a correctness/accessibility rule was fixed and is now guarded.

## 1. Done and guarded (no visual approval needed)

| Area | Before | Now | Guard |
|---|---|---|---|
| Screen-reader roles | 30 tappable controls in 18 files had no role (VoiceOver read them as plain text) | every TouchableOpacity / Pressable / TouchableHighlight / ScaleButton has one; ScaleButton defaults to "button" + disabled state; ToggleRow = "switch" (unchanged); 2 full-screen backdrops deliberately silent | `scripts/design/a11y-roles.js` (Babel AST) + `src/design/designSystemAudit.test.js` |
| Touch targets | 18 controls drawn under 44 pt with no hit area (36/34/32/40 pt: steppers, voice/cancel recording, decline, arrows, story share/report/delete, header message button, ...) | each gets an invisible `hitSlop` up to 44 x 44; nothing moves | `scripts/design/touch-targets.js` + same test |
| Contrast / tokens | perk badges, perk cards (gathering + community) and the Dating rewind button used amber `#f59e0b` text (about 2:1 on the light background, fails WCAG); "Leave" link used a raw red | amber text/border = `colors.warning` (light #9A6210 / dark #E0A84A, both pass); Leave + destructive action-sheet rows = `colors.danger` | style-audit |
| Icons (earlier this round) | emoji used as controls | one outline icon set (`constants/functionalIcons.js`) | `deviceFindingsNov27.test.js` |
| Empty / loading / error (earlier) | mixed emoji, three ellipsis styles, failed reads shown as "nothing nearby" | Nearby mark once; one ellipsis in 11 languages; loading / failed (Try Again) / location off / none distinct on Discover + map | `loadingWording.test.js`, `discoverStatus.test.js` |
| Back buttons | Edit Profile Back dead on iOS 26 | one leave guard, no screen overrides Back or the back swipe | `leaveGuard.test.js`, `nativeBackPatch.test.js` |
| Toggles, disabled buttons, interest pickers (2026-11-21) | 3 toggle styles, 114 ad-hoc disabled looks, 6 picker variants | `ToggleRow`, `disabledButtonStyle`, `TagGroupPicker` | existing guards |

Remaining hard-coded colours are deliberate: Google's required attribution grey, the map's native white callout, the
story viewer's always-dark chrome, the brand gradient on the share card, the config-error screen (drawn before the theme
loads), white text on coral/photo.

## 2. Measured inconsistencies that are VISUAL decisions (awaiting your approval)

Each has a concrete recommendation that can be applied in one pass once you approve it (or a mockup exists).

| # | What | Measured | Recommendation |
|---|---|---|---|
| D1 | Font sizes | 1,173 literals over 22 sizes; 557 off the 6-step scale (34/26/20/16/13/12). Heaviest off-scale: 14 (208), 15 (129), 11 (73), 18 (38), 22 (27), 17 (14), 10 (13), 9 (2) | Extend the scale with the two sizes the app really uses as a step: **14 = label, 15 = secondary body**, and 18 = subhead; snap **9/10/11 -> 12** (below 12 is hard to read, also an accessibility gain), 17 -> 16, 19 -> 20, 22/24 -> 20 for text (emoji/number glyph sizes 28-84 stay). Visible change: small text grows slightly on about 90 lines; most screens unchanged |
| D2 | Primary buttons | all pill-shaped (radius full) but four heights: vertical padding 12 (6 screens: Ask, Join, Date proposal), 14 (2), 16 (Create Next, Celebrate, Complete Profile), 18 (Onboarding) | **one primary button: padding 14 + minHeight 48**, as a shared `primaryButtonStyle` beside `disabledButtonStyle`; secondary = same shape, outline |
| D3 | Chips | 20 chip styles at padding 12 x 6, 9 at 12 x 4, 5 others | one chip: radius full, 12 x 6 (the majority); compact 12 x 4 only in dense rows (Discover filters) |
| D4 | Cards | 43 card styles: radius lg (20) in 37, md (14) in 5; padding 12 in 30, 18 in 4; shadow on 13 | radius lg + padding 12 everywhere; `shadow.card` only on cards that float over the background (Home, Discover tiles), none on cards inside sheets |
| D5 | Radius outliers | 53 literal radii off the 4 tokens (4, 6, 18, 22, 2, 5, 12, 16, 24, ...) | thumbnails/avatars keep their own (half the size = circle); everything else to sm/md/lg |
| D6 | Spacing literals | 347 margins/paddings off the 6 tokens | snap only when touching a screen for D1-D5 (a blind pass would shift layouts unseen) |
| D7 | Home tiles (item 24) + Profile hierarchy (item 31) | implemented from the written spec | needs your look on the phone or a mockup |
| D8 | Women-only badge | pink #ec4899 text at 11 pt (about 3.5:1 on light, below 4.5:1) | keep pink as the badge identity but darken the text to pass (needs your eye) |

Business Mode shares the same tokens and the same findings (its dashboards use the same chip/card/button styles; Make
an Offer uses `offerCardStyles`, already shared with the customer card).

## 3. Applied (owner approved all eight, 2026-11-28): status per item

Implemented by the idempotent codemod `scripts/design/consolidate-styles.py` (dry run prints every change; a second run
changes nothing) and kept true by `src/design/designSystemScale.test.js` (mutation-checked). Visual review page with
before/after renders (main, this branch before the pass, this branch now; light + dark; Home and Profile scrolled):
https://claude.ai/artifact/KQttbznqc5VXbEdPaDp8b2 (private; browser renders of real screens from invented data, network
refused; capture: `scripts/design/preview/`, logs `/workspaces/.nearby-verify/v484`, `v485`, `v490`).

| # | Implemented | Remaining after the pass (counted 2026-11-28) | Visual approval | Phone |
|---|---|---|---|---|
| D1 type scale | 34/26/20/18/16/15/14/13/12; nothing below 12 (guard) | 1 inline 17 (Chat header title = the iOS system title size, kept); 22+ only on glyph/number styles | pending (gallery) | not run |
| D2 primary button | `PRIMARY_BUTTON` (padding 14, minHeight 48, pill) on every block CTA + its outline secondary | compact row actions keep their size by rule (Join on GatheringDetail uses its own coral style) | pending | not run |
| D3 chips | one size 12 x 6; dense Discover filter rows 12 x 4 | none | pending | not run |
| D4 cards | radius lg, padding md; no shadow on cards inside sheets | none | pending | not run |
| D5 radii | literals to sm/md/lg/full | circles/thumbnails keep half-size radii by rule; hairlines <= 3 | pending | not run |
| D6 spacing | StyleSheet margins/paddings on the token scale | 3 inline literals left on purpose: CommunityChat header button 8 (native header spacing), web date input (CSS), one business pill 10 x 14 | pending | not run |
| D7 items 16 / 24 / 31 | Friends header in Dating's layout; Home tiles = category-coloured outline icon on a tinted circle; Profile headings bolder, lighter completion card, outline gear | none | pending (gallery shows each) | not run |
| D8 women-only badge | darker pink text token, >= 4.5:1 in both themes (guard) | none | pending (only on a women-only gathering; not in the gallery fixtures) | not run |

Business Mode is covered by the same codemod (it scans every file in `src/screens` + `src/components`); the gallery shows
the business dashboard. What the gallery can't show: real fonts on iOS, native headers, sheets, keyboard, Dynamic Type.
