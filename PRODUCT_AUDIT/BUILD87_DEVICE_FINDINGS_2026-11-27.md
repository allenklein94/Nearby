# Build 87 device findings: consolidated pass (2026-11-27)

Branch `fix/device-findings-nov27` (from main 64c8e492d). Client only: no migration, no server change, nothing merged,
deployed or built. Verified locally: Jest 624/624 suites (8525 passed, 11 todo), iOS bundle exports clean
(logs /workspaces/.nearby-verify/v470). Nothing here has run on a phone. Build 87 = 2a28c8e8; everything below needs a
build made from this branch (after merge) to be seen on the iPhone.

## Confirmed fixed on this branch (needs a physical check)
| # | Finding | Root cause | Change |
|---|---|---|---|
| 2 | Hiking + This afternoon stayed when "dinner tomorrow" was asked in Discover | Discover's typed ask never cleared the Gatherings tab's pick / category / time chips, Outdoor/Indoor or Open now (recorded 2026-10-27 as "type+Enter combining with a set chip kept, watched in session B": the phone has now shown it wrong) | ONE rule `filtersForNewAsk` (`utils/gatheringFilters.js`): a new ask replaces activity, category, word, For you and time; keeps Trending / price / plan kind / Local; clears Outdoor/Indoor, date view, category view; Open now only if the words ask for it. Refining the same ask and picking a suggested activity unchanged |
| 3 | Explore Nearby opened Discover with Coffee still selected | `navigate('Discover')` with no params keeps the previous params object (React Navigation 6), so nothing re-applied | `utils/discoverEntry.js`: general entries (Home Explore Nearby, Activity / Plans / Matches / Your Progress "Explore", Create's "Browse what's already out there") send a new `freshDiscovery` params object = a clean Discover; the saved typed-ask session from before it is ended (device + account), never restored. Contextual entries (Home tiles, weather card, perk link) also end an old typed ask. Back and the tab bar send nothing new = session kept |
| 8 | "Dinner tomorrow" became a noon gathering | `dateForPreset('tomorrow')` filled 12:00 (deferred 2026-10-27 "until tested") | `presetLeavesTime('tomorrow')` = true, `dayForPreset`: Tomorrow sets the day, Create's existing "Pick a time" asks; a stated time ("at 7") still wins |
| 15 | Messages header became "Friends"; "Matches" heading repeated under the Matches tab; "Downtown run..." cut off | screen title followed the tab; MatchesScreen (only ever embedded in Messages) drew its own heading; chip max 160 pt | title always Messages; heading removed; chip max 260 pt; unused `ui.nav.title.messagesFriends` removed |
| 17 | 🃏 / 📋 / 🗺️ / ⓘ / 👤 as controls | emoji per screen | `constants/functionalIcons.js` (Ionicons outline), one convention: a switch shows the view it switches TO (Dating, Friends, Discover List / Map); labels unchanged |
| 18 | Friends Browse and Crossed Paths had the same empty text | one shared `friend_discovery_empty` | Browse "No new people to discover yet"; Crossed Paths "No crossed paths yet" + "depends on your location settings" (never claims tracking is on); 11 languages, 10 machine-authored: NEED NATIVE REVIEW |
| 25 | "What are you looking for?" twice; a chip under the map button | heading duplicated the subtitle; the chip row had no `flex: 1` | second copy + its key removed; row takes only the room beside the button, last chip scrolls clear |
| 30 | Activity empty state: logo + large 🔔 | the opportunity empty state draws the Nearby mark itself; 8 places added an emoji under it | emoji removed in all 8 (Activity, Plans, Matches, Friends, Dating x2, Occasions, Communities) |

Guards: `utils/discoverEntry.test.js`, `screens/deviceFindingsNov27.test.js`, `utils/tonightLeavesTime.test.js` (Tomorrow), `utils/operatingStatus.test.js` (new-ask Open now rule).

## Already fixed on main after build 87 (not in build 87; needs a build >= 88 on the phone)
- 12 / 21 "MainTabs" back label + dead Back on Edit Profile / Settings: `navigation/mainTabsBackTitle.js` + `hooks/useLeaveGuard.js` + the react-native-screens 4.16.0 patch (`fix/native-back-prevent-remove`, merged). Not compiled until the next EAS build.
- 19 Dating Browse + Crossed Paths empty: production's Dating view (pre-0348) lacks the hide-switch columns, the read failed and showed nothing; build 88's `services/peopleRead.js` fallback (mutation-checked) or migration 0348 fixes it (`BUILD88_COMPATIBILITY_2026-11-26.md`).
- 32 onboarding Back / Sign In: on main (`post-tier1/onboarding-fixes`, merged).

## Root cause known, blocked on a migration (owner approval)
- 20 "Set as main photo" fails for build 87 AND 88: `swap_main_photo` arrives with 0349 (Batch 1). No safe client fallback (0349 forbids copying screening flags client-side).

## Already implemented as specified (kept)
4 / 6 / 11 one interpretation carried into Create + Ask Nearby Businesses (`createFromAsk`, `askBusinessParamsFromAsk`; journeys `outdoorMatch`, `statedTimeHandoff`); 5 activity separate from title (`gatherings.activity`, 20270346, live; older gatherings stay NULL = title reading, no backfill); 9 day change drops a clock time, People keeps it (idea "307"); 22 Your Progress inline; 36 locks (five tabs, motion, privacy).

## Investigated, kept, conflict with a locked decision: owner to decide
- 13 / 14 standalone Friends discovery: it is NOT a second implementation. `FriendDiscovery` is a presentation route (owner 2026-10-04) rendering the SAME `FriendDiscoveryScreen` Discover embeds, used only from inside other flows (Create's invite picker, Messages -> Friends, the gathering-published panel, typed-ask people rows) so jumping to the Discover tab doesn't close what the person was doing; tab entries already open Discover -> People -> Friends. Removing it would close Create mid-flow. Kept; if you still want one route, the trade-off is losing that in-progress context.
- 23 floating Start Something / Make a Plan / Create tab: not changed (distinct purposes not yet assessed on the phone).

## Not done in this pass (review / design work, no confirmed defect yet)
7 contextual cuisine refinement for Dinner; 10 final review layout; 16 Dating vs Friends control layout beyond icons; 24 Home tile colour accents; 26 Discover blank area vs loading / error / location-off states; 27 map empty-marker explanation; 28 / 29 Create landing + Quick Actions overlap; 31 Profile spacing; 33 onboarding interest mapping; 34 app-wide design system; 35 loading wording. Celebrate Something's own Tomorrow still shows 12:00 on its screen (it hands the day to Create, which now asks the time).

## Needs controlled accounts / production conditions
19 Dating + Friends Browse / Crossed Paths with eligible accounts; 22 Manage Subscription (native); 11 real business offers (Anthropic credit + seeded business).

## Incident during this pass
While fixing a failing taxonomy guard, `scripts/taxonomy/sync-code-dependencies.js` was run without reading it first; it writes PRODUCTION (`sync_category_code_dependencies`): `category_code_dependencies` replaced with 1,585 rows (main's 1,584 + one row: the tag "Hiking" named in a code comment) and `category_code_inventory_state.source_commit` set to `a3b91ef4…+uncommitted`; 0 follow-ups changed (0 open). Internal metadata only, no user data or push. The comment was reworded, so the branch's inventory equals main's again. Repair (owner approval needed) = run that sync once from main's committed inventory, which restores 1,584 rows and a real commit id.
