# PRODUCT_AUDIT fixes — progress tracker

Started 2026-08-09. Tracks the 10 items in CLAUDE.md's "Outstanding: PRODUCT_AUDIT fixes"
section. Updated incrementally as each item completes (restart-safe — codespace restarts
often in this project).

| # | Item | Status |
|---|------|--------|
| 1 | ChatScreen debug overlay always-on | DONE |
| 2 | 13-button Alert.alert → real menu component | DONE |
| 3 | Full schema pull, commit to git | not started |
| 4 | Re-verify is_blocked() live | not started |
| 5 | Re-verify business RPC ownership checks live | not started |
| 6 | Shared send-and-recover-on-failure for 4 chat screens | not started |
| 7 | Proof-of-redemption mechanism for business perks | not started |
| 8 | Payment processor decision (Stripe or explicit deprioritize) | not started |
| 9 | Outbound CTAs + streak/tier push notification | not started |
| 10 | Relationship-longevity tools → SettingsScreen entry points | not started |

## Notes as I go

**Item 1** — deleted the `__DEV__ === undefined` debug overlay block entirely and fixed the
"DEBUG: Image failed to actually render" string to plain "Couldn't load photo" copy, matching
the other real error states in the same file.

**Item 2** — new `src/components/ActionSheetModal.js`, a real scrollable bottom-sheet menu
(Modal + ScrollView, not `Alert.alert`). Replaced both `showTogetherMenu` (12 real options,
was the flagged 13-button Alert) and the nested `showCourageMenu` (was also an Alert, up to 4
buttons) in `ChatScreen.js` to use it via new `togetherMenuVisible`/`courageMenuVisible` state.
Device-testing on real Android hardware still isn't possible from this sandbox, but this
removes the actual risk (a native Alert with many buttons) regardless of what a device test
would have shown, so item 2 is closed rather than left blocked on a test this environment can't
run.
