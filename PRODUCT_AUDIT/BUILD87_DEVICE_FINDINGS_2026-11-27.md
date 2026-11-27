# Build 87 device findings: reconciliation of all 40 sections (2026-11-27)

Branch `fix/device-findings-nov27` (from main 64c8e492d). Client only: no migration, no server change, nothing merged,
deployed or built. Nothing here has run on a phone: every change needs a build made from this branch (after merge).
"Device" = what must be checked on the iPhone before the item can be called verified. Source = the owner's consolidated
instruction of 2026-11-27 (40 numbered sections; 37-40 are process sections).

No approved visual mockup exists in the repo or in either owner message. The design items (16, 24, 31, 34) follow the
written spec only and are NOT checked against an approved mockup; each is a restrained change the phone session should judge.

## Production incident (taxonomy inventory) and repair
- **What happened:** `scripts/taxonomy/sync-code-dependencies.js` was run (session 31aba860, ~22:05 UTC) without being read.
  It calls `sync_category_code_dependencies` on PRODUCTION, which (function read from prod) deletes and re-inserts
  `category_code_dependencies`, upserts the one `category_code_inventory_state` row, and may flip open
  `category_code_followups` to resolved. Effect: 1,585 rows (main's 1,584 + "Hiking" named in a code comment), source
  `a3b91ef4…+uncommitted`.
- **Repair:** made by the same session at 22:18:35 UTC, 30 s after the owner's repair authorization arrived, as one guarded
  transaction (aborts unless exactly 1,584 rows and 0 resolved follow-ups) with main's committed inventory and main's commit.
  It ran BEFORE the full read-only comparison the authorization asked for (only triggers + push queue were checked first);
  the session then restarted and the report it had written still said the repair awaited approval.
- **Verified after the fact (read-only, this session):** production = 1,584 rows, set-identical to main's committed
  `scripts/taxonomy/code-dependencies.json` (0 rows only in production, 0 only in main); state row source_commit
  `64c8e492db2cf31654611803b553e175fb8a9d67` (= main), row_count 1,584, synced 2026-11-27 22:18:40 UTC; follow-ups: 66, all
  resolved, newest resolution 2026-10-11 (0 touched by either sync); the only trigger on the three tables is
  `followup_guard` on follow-ups (not fired: no follow-up changed); push_outbox: last row today 21:08 UTC, before both syncs.
  No user data, no other table, no notification, no other production system touched. No further production write made.
- **After merge (separate owner approval):** this branch's inventory is 1,586 rows (item 33 adds Concerts / Nightlife
  references in `onboardingInterests.js`); production stays at main's 1,584 until the owner approves a sync from merged main.

## Reconciliation
| # | Finding | What changed | Status | Files | Tests | Device | Blocker |
|---|---|---|---|---|---|---|---|
| 1 | Architecture principles | Applied throughout: no new screen added; one shared rule per change | Followed | (all below) | screenRegistry guard | n/a | none |
| 2 | Hiking + This afternoon kept on a new "dinner tomorrow" | New ask replaces activity/category/word/For you/time, clears Outdoor/Indoor, date + category view; Open now only from the words | FIXED | `utils/gatheringFilters.js` (`filtersForNewAsk`), `DiscoverHubScreen.js` | `operatingStatus.test.js`, `deviceFindingsNov27.test.js` | Yes | none |
| 3 | Explore Nearby kept Coffee | General entries send a new `freshDiscovery` params object = clean Discover; the saved ask from before is ended; contextual entries keep their context; Back/tab bar keep the session | FIXED | `utils/discoverEntry.js`, Home/Activity/Plans/Matches/Your Progress/Create callers | `discoverEntry.test.js` | Yes | none |
| 4 | One interpretation everywhere | Already built: `createFromAsk`, `askBusinessParamsFromAsk`, `statedStartMinutes`, `partySizeFromText` | PRESERVED | `services/createAssistant.js`, `utils/askUnderstood.js` | journeys `outdoorMatch`, `statedTimeHandoff`, `understoodChipChange` | Yes (C18) | none |
| 5 | Activity separate from title | Already built (`gatherings.activity`, live); Start Something's cuisine keeps Dinner as the activity; a Create cuisine pick pins Dinner before renaming | FIXED (gap) | `StartSomethingModal.js`, `CreateGatheringScreen.js` | `createActivityPicker.test.js`, journey `gatheringActivity` | Yes | Older gatherings stay NULL (no backfill, owner rule) |
| 6 | Create configures itself | Known activity = one row + Adjust; carried day/time/party/who kept | FIXED | `utils/createActivityPicker.js`, `CreateGatheringScreen.js` | `createActivityPicker.test.js`, `createStartTime.test.js` | Yes | none |
| 7 | Dinner cuisine in Create | Optional "What kind of dinner?" row (Pizza, Mexican, Sushi, Burgers, Healthy, Italian, Doesn't matter) in Create's What step on every path where the activity is Dinner (quick pick, Start Something, typed ask); renames only a title Nearby prefilled, hidden once the person wrote their own, dropped if the category changes; Start Something's separate Dinner step removed (asked in one place) | FIXED | `constants/activityRefinements.js`, `utils/createActivityPicker.js`, `CreateGatheringScreen.js`, `StartSomethingModal.js` | `createActivityPicker.test.js` (item 7 block) | Yes | The cuisine is NOT stored on the gathering and does NOT reach businesses (no column: backlog "cuisine on gatherings", needs a migration + owner decision). Only Dinner has refinements; other activities have no refinement data (the taxonomy is flat; new data = a taxonomy decision) |
| 8 | Noon defaults | Create's Tomorrow = day only, asks the time; Celebrate's Tonight/Tomorrow show the day only; Celebrate's Tonight after 7 PM no longer becomes tomorrow (`dayOnlyMoment`); Ask Nearby Businesses' time stays optional and only from the words; Discover has no clock default | FIXED | `utils/whenPresets.js`, `CelebrateSomethingScreen.js`, `CreateGatheringScreen.js` | `tonightLeavesTime.test.js`, `localDateKey.test.js` | Yes | none |
| 9 | Date + people chip rules | Already built (idea "307"); unchanged | PRESERVED | `services/askUnderstood*`, `utils/createStartTime.js` | journey `understoodChipChange`, `understoodChipChange.test.js` | Yes (check 16) | none |
| 10 | Final review | No unpicked clock time shown; activity word (Dinner) not the category; Adjust on each row opens its step (no new screen) | FIXED | `CreateGatheringScreen.js` | `createActivityPicker.test.js` (review block) | Yes | none |
| 11 | Ask Nearby Businesses inherits context | Already built (item 84, idea "305"); unchanged | PRESERVED | `utils/askBusinessParams*`, `AskBusinessScreen.js` | journeys `outdoorMatch`, `statedTimeHandoff`, `requestSentCount` | Yes | Real offers need Anthropic credit + a seeded business |
| 12 | "MainTabs" back labels | Fixed on main after build 87 (`navigation/mainTabsBackTitle.js`) | FIXED ON MAIN | `navigation/mainTabsBackTitle.js` | `leaveGuard.test.js` | Yes | needs build >= 88 |
| 13 | Two Friends discovery screens | Same component; audited every caller (below); ordinary entries open Discover → People → Friends; the Friends list empty state now does too | FIXED (consistency) | `FriendsScreen.js`, callers below | `friendsPresentation.test.js` | Yes | none |
| 14 | Finding vs managing friends | Discover → People → Friends = find; Friends screen (Profile, Messages) = manage; no third copy | PRESERVED | — | `friendsPresentation.test.js` | Yes (wording watch) | none |
| 15 | Messages header + chips | Title stays Messages; duplicate Matches heading removed; chat chips 260 pt | FIXED | `MessagesScreen.js`, `MatchesScreen.js` | `deviceFindingsNov27.test.js` | Yes | none |
| 16 | Dating vs Friends controls | Friends discovery header uses Dating's layout (one right-hand icon group, same spacing); filter summary translated; one icon set | FIXED (spec only) | `FriendDiscoveryScreen.js`, `constants/functionalIcons.js` | `deviceFindingsNov27.test.js` | Yes | No approved mockup |
| 17 | 🃏 / 📋 icons | Ionicons outline; a switch shows the view it switches to; labels kept | FIXED | `constants/functionalIcons.js` | `deviceFindingsNov27.test.js` | Yes | none |
| 18 | Same Browse / Crossed Paths empty text | Separate states; Crossed Paths never claims tracking is on | FIXED | `constants/emptyStates.js`, `i18n/ui/empty.js` | `emptyStateLanguage.test.js` | Yes | Native review (10 languages) |
| 19 | Dating Browse + Crossed Paths empty | Cause known: pre-0348 Dating view lacks the hide-switch columns; build 88's `peopleRead.js` fallback or 0348 fixes it | ROOT CAUSE KNOWN | `services/peopleRead.js` (main) | `BUILD88_COMPATIBILITY` run | Yes | Needs controlled eligible accounts; 0348 approval or build 88 |
| 20 | Main photo | `swap_main_photo` arrives with 0349; no safe client fallback | BLOCKED | — | compat run | Yes | 0349 (owner approval) |
| 21 | Edit Profile Back | Fixed on main (`useLeaveGuard` + react-native-screens patch) | FIXED ON MAIN | `hooks/useLeaveGuard.js`, `patches/` | `leaveGuard.test.js`, `nativeBackPatch.test.js` | Yes | needs build >= 88 (first native compile) |
| 22 | Your Progress inline; Manage Subscription | Your Progress unchanged (inline); Manage Subscription not changed | PRESERVED / UNTESTED | — | `yourProgressInProfile.test.js` | Yes | Manage Subscription needs the native store sheet on a phone |
| 23 | Start Something / Make a Plan / Create overlap | Home's floating + Start Something removed; its activity sheet now opens from Create's Gathering card (one place), keeping Home's interest personalization; Home's "Make a plan" link on a perk stays (opens Create with that offer: a contextual shortcut, not a duplicate) | FIXED | `HomeScreen.js`, `CreateHubScreen.js` | `deviceFindingsNov27.test.js` | Yes | none |
| 24 | Plain Home tiles | Each icon in its category colour on a soft tinted circle (Create's category palette); same destinations | FIXED (spec only) | `HomeScreen.js` | — (visual) | Yes | No approved mockup |
| 25 | Duplicate "What are you looking for?"; chip under map button | Second copy removed; chip row takes only the room beside the button | FIXED | `DiscoverHubScreen.js` | `deviceFindingsNov27.test.js` | Yes | none |
| 26 | Blank Discover | Loading / failed read (Try Again) / location off / nothing nearby (+ Start a gathering) are distinct; a failed read is never "nothing nearby" | FIXED | `utils/discoverStatus.js`, `DiscoverHubScreen.js`, `services/gatherings.js` | `discoverStatus.test.js` | Yes | none |
| 27 | Map without pins | Map says why: read failed (Try Again), location off (turn on), filtered (show list), none nearby | FIXED | `components/GatheringsMapView.js`, `utils/discoverStatus.js` | `discoverStatus.test.js` | Yes | none |
| 28 | Create landing overlap | Plan for Someone keeps the recipient Create already asked and skips re-asking it (Back reaches it) | FIXED | `utils/createHubWhoFor.js`, `CelebrateSomethingScreen.js` | `createHubWhoFor.test.js` | Yes | none |
| 29 | Quick Actions | Let Nearby Plan It vs Something Else described + own icons; Meet New People = Discover → People → Friends; Plan a Date now opens Messages on Matches (was the last-used tab); Weekly Meetup = Create with repeat | FIXED | `CreateHubScreen.js`, `MessagesScreen.js`, `i18n/ui/createHub.js` | `deviceFindingsNov27.test.js` | Yes | Native review of 2 strings |
| 30 | Activity empty state | Nearby mark once (emoji removed in 8 empty states); Premium upsell only when there is a locked notice to unlock | FIXED | `ActivityScreen.js` + 7 screens | `deviceFindingsNov27.test.js` | Yes | none |
| 31 | Profile hierarchy | Section headings readable (secondary text, bold); lighter completion card; stat links checked (Friends → Friends, Upcoming/Interested → Plans upcoming, Past → Plans past, Communities expands in place, locked) | FIXED (spec only) | `ProfileScreen.js` | — (visual) | Yes | No approved mockup; photo proportions unchanged |
| 32 | Onboarding Back / Sign In | Fixed on main | FIXED ON MAIN | onboarding screens | onboarding tests | Yes | needs build >= 88 |
| 33 | Onboarding interest mapping | Restaurants also reaches Foodie (Dinner/Breakfast/Lunch), Live Music also Concerts, Nightlife its own tag | FIXED | `constants/onboardingInterests.js` | `onboardingInterests.test.js`, `taxonomyCodeDependencies` | Yes | Production inventory sync after merge (owner approval) |
| 34 | One design system | Every emoji still used as a control moved to the one outline icon set (People switches, map/info/profile, settings gear, search, camera, Business Mode messages); ✕ / ⋯ text glyphs kept (consistent everywhere); emoji kept where they add personality | PARTLY DONE | `constants/functionalIcons.js` + screens | `deviceFindingsNov27.test.js` | Yes | Typography, radii, shadows, buttons, chips NOT re-audited app-wide: no mockup; a full visual pass needs device screenshots of each surface |
| 35 | Loading wording | One ellipsis character in every loading caption (11 languages); Discover distinguishes loading / empty / error (item 26) | FIXED | `i18n/ui/*`, `scripts/i18n/strings/*` | `i18n/loadingWording.test.js` | Yes | none |
| 36 | Preserve what works | Five tabs, Discover architecture, shared interpretation, Create Details/More Options, inline Your Progress, separate Dating/Friends preferences, messaging, privacy, Business Mode, offer/payment, motion, onboarding: unchanged | PRESERVED | — | full Jest | Yes | none |
| 37 | Priorities | Functional fixes (2, 3, 8, 13, 26-27) before design (16, 24, 31, 34) | Followed | — | — | — | — |
| 38 | Testing | Jest + iOS export + diff review (below); no device | Done (automated) | — | — | Yes | Phone session |
| 39 | Final report | This document | Done | — | — | — | — |
| 40 | Execution | One branch, no build, no merge, no migration until owner review | Followed | — | — | — | — |

### Friends discovery entry points (item 13 audit, every caller)
Discover → People → Friends: Activity's "Discover People", the Friends list empty state, Create's Meet New People, Home and
Discover typed-ask "meet people" rows, Home's people route (`navigateIntentRoute` without `onTop`).
Separate presentation (same component, kept so an in-progress workflow isn't closed): Create Gathering's invite picker
(`FriendInviteSelector`), the invite list on a just-published gathering (`GatheringPublishedPanel` on GatheringDetail), and
Celebrate Something's typed ask (`onTop` + its result row). Surprise Me cannot produce the meet-people row.

## Migrations 0348 + 0349 (review only, nothing applied)
Production ledger (read-only, `migration:status --target=prod`, 2026-11-27): applied through 20270347; 87 pending (0348-0434).
Both files unchanged on this branch; sha256 = the Batch 1 packet's approval codes (0348 `12372a27…a515`, 0349 `e14971c0…11cf`).
- **0348 profile column privacy (N6, HIGH):** other accounts read only public profile columns; own row via `get_my_profile()`.
  Fixes build 87's empty Dating Browse/Crossed Paths. Breaks build 86 (stuck in onboarding): gate = no public build <= 86.
  Rollback re-opens N6 (never with external users).
- **0349 verification self-grant guard:** no self-granted verified/admin, screening bound to the exact photo file, hidden/
  suspended/blocked photos closed, 15-min links. Adds `swap_main_photo` (finding 20). `moderate-photo` must deploy right
  after. Rollback restores the old behaviour; links already issued stay valid to expiry.
- **Readiness** (`BATCH1_APPROVAL_PACKET_2026-11-25.md`): build 87 + 88 pass at 0354 on a replay and a restored production
  copy; rollbacks 0354 → 0348 proven in isolation. Open, all owner: R2 (App Store: no public build <= 86), R3 Tier 1, R7 a
  same-day verified backup (today's expires 2026-11-28 20:04 UTC), R8 website five-tab pass before 0348, then per-migration
  `--check` + approval. This branch adds no migration dependency (its service change only reports read failures).

## Validation (this session)
- Jest (final branch state, 2a6a2d686): 628/628 suites, 8567 passed, 11 todo (log /workspaces/.nearby-verify/v473/jest-final.log).
  The branch was RED at 748ebb24d (the earlier session's last commit): `createAssistantInference`'s `/setActivit/` guard matched
  `setActivityListOpen`; guard narrowed to allow that list toggle only.
- iOS bundle export: clean (/workspaces/.nearby-verify/v473/ios).
- Diff vs main reviewed: 41+ app files; no migration, edge function or config change; the only service change
  (`getNearbyGatheringsResult`) runs the same queries and reports failures, so compatibility with production at 0347 and
  every batch boundary is unchanged from main's build 88 record. Surfaces touched: Home, Discover, Create, Activity, Profile,
  Messages, Dating (empty states), Friends, Business Mode (Messages icon only).
- Not run: journeys (no server change), a phone, the business website (Business Mode's icon change needs a re-export of
  `docs/business/` with its own publish approval).
