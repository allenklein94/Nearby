# PRODUCT_AUDIT fixes — progress tracker

Started 2026-08-09. Tracks the 10 items in CLAUDE.md's "Outstanding: PRODUCT_AUDIT fixes"
section. Updated incrementally as each item completes (restart-safe — codespace restarts
often in this project).

| # | Item | Status |
|---|------|--------|
| 1 | ChatScreen debug overlay always-on | DONE |
| 2 | 13-button Alert.alert → real menu component | DONE |
| 3 | Full schema pull, commit to git | DONE |
| 4 | Re-verify is_blocked() live | DONE |
| 5 | Re-verify business RPC ownership checks live | DONE |
| 6 | Shared send-and-recover-on-failure for 4 chat screens | DONE |
| 7 | Proof-of-redemption mechanism for business perks | not started |
| 8 | Payment processor decision (Stripe or explicit deprioritize) | not started |
| 9 | Outbound CTAs + streak/tier push notification | not started |
| 10 | Relationship-longevity tools → SettingsScreen entry points | DONE |

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

**Item 4** — re-verified live against production (`enmosvippabmuqslzrox`), no code changes
needed, fix still holds. Confirmed `is_blocked()` is still `SECURITY DEFINER` with
`search_path=public` pinned. Real test: inserted a real `blocks` row (Claude blocked Allen,
the same real pair with a real pre-existing match), then as Allen (the *blocked* party) —
`is_blocked(Claude, Allen)` correctly returns `true`, `select * from matches` correctly omits
the blocked pair's match (only the unrelated Google-voice↔Allen match returned), and a direct
`insert into messages` for the blocked match correctly raises a real RLS violation
(`42501`). Also re-checked `business_messages`' three policies still reference `is_blocked()`
inline — confirmed via `pg_policy`. Test block row deleted afterward; `matches` count back to
2, `blocks` back to 0.

**Item 5** — re-verified live, no code changes needed, fix still holds. Confirmed
`get_business_dashboard_stats`/`_growth`/`_top_members`/`_visit_frequency`/`_insights` all
still have the `exists (... managed_partner_id = partner_id_param)` ownership guard in their
`prosrc`, and confirmed all 7 business RPCs (including `get_business_follower_count` and
`get_business_member_gathering_history` from the CRM follow-up) have `anon` execute correctly
revoked, `authenticated` correctly granted. Since production has almost no real data, ran a
real differential test rather than just reading zeros both ways: inserted a real
`business_followers` row for Coastal Coffee, called `get_business_dashboard_stats` as the real
owner (Allen) — got `total_followers: 1` — and as a real non-owner (Claude) — got
`total_followers: 0` for the same partner id, proving the ownership check actually
discriminates, not just that the table happens to be empty. Test follower row deleted
afterward.

**Item 3** — new `supabase/full_schema_pull_2026-08-09.sql` (~5,900 lines), a complete,
machine-generated snapshot of the live production schema (`enmosvippabmuqslzrox`), pulled via
direct `pg_catalog`/`information_schema` introspection through the Management API (no
`pg_dump`/`psql` binary available in this sandbox, and no direct Postgres connection string —
only the Management API token). Covers everything `supabase/schema.sql` (the original
hand-authored file, left untouched) never did: all **52** real tables (columns, defaults,
nullability, PK/FK/UNIQUE/CHECK constraints, indexes, RLS enable flags), all **132** RLS
policies (119 table + 13 storage), all **101** functions with their real `SECURITY
DEFINER`/`INVOKER` status and full body, all real triggers, the 5 real storage buckets +
their `storage.objects` policies, and the 9 real `pg_cron` scheduled jobs. Also includes two
informational (non-executable) snapshots that don't fit as plain DDL but matter for security
review: per-function EXECUTE grants for `anon`/`authenticated`/`service_role`/`public` (every
security fix in this project's history has been about exactly this), and per-table grants for
the same three roles.
Verified counts directly against live `pg_proc`/`pg_policy`/`pg_class` queries rather than
just trusting the script's own tally. This is a one-time historical-baseline snapshot, not a
replacement for `supabase/migrations/` — the file's own header says so, and future schema
changes should still go through a real migration file per this repo's standing (and
previously not-held-to) convention.

**Item 6** — new `src/hooks/useChatComposer.js`, one shared hook used by all 4 chat-style
screens (`ChatScreen.js`, `CommunityChatScreen.js`, `GatheringChatScreen.js`,
`BusinessConversationScreen.js`). Previously each screen cleared its composer immediately and
swallowed a send failure with a "silently fail... would be nicer but simple for now" comment —
same bug, written 4 times. The hook's `send(sendFn)` clears the composer optimistically, but on
a thrown error from `sendFn` it restores the exact drafted text (so the same Send button is a
real retry, no separate retry UI needed) and sets a visible `sendError` string each screen
renders as a small banner above the input row. `ChatScreen.js`'s version is the one real
non-mechanical merge: it keeps its pre-send moderation check and haptic outside the hook
(unrelated to network failure) and, inside `sendFn`, now removes the optimistic message bubble
on failure before rethrowing — previously a failed insert left a "sent" bubble on screen
forever with just a `console.error`, no visible sign anything was wrong.
`GatheringChatScreen.js`'s existing `draftText` route-param prefill (for the Gathering Hub's
ice-breaker deep link) maps directly onto the hook's `initialText` param, unchanged. Verified
via a full `npx expo export --platform ios` (clean) and a `@babel/core` compile of all 5
touched files.

**Item 10** — new `src/screens/RelationshipToolsScreen.js` + `RelationshipTools` route, added
to `SettingsScreen.js`'s "Reflection Tools" section as a 6th row alongside the 5 already there
(Rehearsal Room, Chemistry Diary, Private Reflections, Relationship Wisdom, Emergency Kit).
The 6 missing tools (`RelationshipConstitution`, `StressTest`, `SharedDecisions`,
`SharedPlaylist`, `TripPlanning`, `TimelinePlanner`) all require a real `{matchId, matchName}`
— unlike their 5 siblings, which are personal/global — so this couldn't just be 6 more flat
rows; the new screen is a match picker (reusing the same matches-list pattern
`MemoryVaultIndexScreen.js` already established) that opens the new `ActionSheetModal` (from
item 2) scoped to whichever match is tapped, listing all 6 tools by name. Now that item 2 has
replaced the Android-risky `Alert.alert` this same menu used to render as, extending it into
Settings via the same component keeps both fixes consistent rather than reintroducing a native
Alert here. Verified via a full `npx expo export --platform ios` (clean) and a `@babel/core`
compile of all 3 touched/new files.
