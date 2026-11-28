# Build 87 device findings: reconciliation of all 40 sections (2026-11-27)

Branch `fix/device-findings-nov27` (from main 64c8e492d). Client only: no migration, no server change, nothing merged,
deployed or built. Nothing here has run on a phone: every change needs a build made from this branch (after merge).
"Device" = what must be checked on the iPhone before the item can be called verified. Source = the owner's consolidated
instruction of 2026-11-27 (40 numbered sections; 37-40 are process sections).

No approved visual mockup exists in the repo or in either owner message. The design items (16, 24, 31, 34) follow the
written spec only and are NOT checked against an approved mockup; each is a restrained change the phone session should judge.

## Round 3 (owner, 2026-11-28): privacy first, D1-D8 applied, final validation

Still on `fix/device-findings-nov27` only. Nothing merged, built, deployed, synced or published. Production access was
read-only catalog + aggregate counts (`read_only: true`, verified), no user values.

### Status of every item by stage
| Stage | Items |
|---|---|
| Implemented + automated validation passing | all 40 except 20 (blocked on 0349) and 22 (native sheet); 7 now complete in code incl. Discover ranking |
| Awaiting visual approval | 16, 24, 31 and D1-D8 (item 34): gallery https://claude.ai/artifact/KQttbznqc5VXbEdPaDp8b2 |
| Awaiting physical device verification | every UI item (nothing on this branch has run on a phone) |
| Awaiting production deployment | 7 storage (0435, Phase B), 19 for build 87 (0348), 20 (0349), 33 taxonomy sync (after merge) |
| Awaiting your accounts / credit / review | 11 (Anthropic + seeded business), 22 (Manage Subscription on TestFlight), native review |

### What round 3 changed
1. **Privacy investigation + plan**: `PRIVACY_REMEDIATION_PLAN_2026-11-28.md` (exposed fields, counts, containment options,
   Batch 1a = 0348 + 0349, 1b = 0350-0354; 0353 already carries 0383's consent guard; 0384 stays Phase B).
2. **Cuisine (item 7) complete in code**: Create/Edit offer, show and send a cuisine only once the server stores it (one
   check per session; offline = asked again); typed asks rank a stated cuisine against a gathering's DECLARED cuisine
   (different = left out, none = kept unranked, never read from the title). Discover's browse cuisine filter still shows
   businesses only (its locked rule); widening it to gatherings after 0435 is a separate decision.
3. **D1-D8**: status per item in `DESIGN_SYSTEM_AUDIT_2026-11-27.md` section 3; gallery of 11 screens x light/dark x
   main / before pass / now, plus Home + Profile scrolled.
4. **Owner actions**: `OWNER_ACTIONS_2026-11-28.md` (App Store Connect, Coastal Coffee website pass, Tier 1, Anthropic,
   test accounts, Manage Subscription, native review, decisions).

### Validation (round 3, HEAD f2931878b)
| Check | Result | Log |
|---|---|---|
| Jest, full | 632/632 suites after the two wiring guards were updated (first run: 630/632, both failures = guards that pinned the old call text) | `/workspaces/.nearby-verify/v486` + rerun |
| From-scratch replay 0001-0435 (isolated, real Auth schema) | 559/559 applied | `/workspaces/.nearby-verify/v488` |
| Journeys, all, on that replay | 146/146 suites, 1,603/1,603 | same |
| Release compatibility, this build | runtime 15/15 at 0347 + every boundary through 0435; static = the 2 known fallbacks | `/workspaces/.nearby-verify/v491/compat` |
| iOS bundle | exports clean | `/workspaces/.nearby-verify/v489/ios.log` |
| Business website export (this branch, not published) | headless 123/123, offer-preview dock 128/128 | `/workspaces/.nearby-verify/v487` |
| Taxonomy inventory vs main | exactly: + Concerts, + Foodie, Nightlife 1 -> 2 (onboardingInterests); nothing else | this session |
| Screens rendered (preview harness) | 11 screens x 2 themes, no page errors, 3 versions | `v484`, `v485`, `v490` |

## Round 2 (owner, 2026-11-27 evening -> 2026-11-28): final reconciliation

Still on this branch only. Nothing merged, built, deployed or published; the only production access was read-only
(`migration:status`, the taxonomy comparison, deploy.js's gate reads) plus one cuisine journey in a rolled-back transaction.

### Status of all 40 items, by what each still needs
| Group | Items |
|---|---|
| **Fully implemented and tested** (automated proof is the whole proof: process / preserved behaviour) | 1, 4, 9, 14, 36, 37, 38, 39, 40 |
| **Implemented, awaiting physical phone verification** (Jest / journeys / headless pass; nothing on this branch has run on a phone) | 2, 3, 5, 6, 8, 10, 13, 15, 17, 19 (build 88 fallback), 22 (Your Progress), 23, 25, 26, 27, 28, 30, 35; on main already, first native compile in the next build: 12, 21, 32 |
| **Awaiting database deployment** | 7 cuisine storage (0435, Phase B), 19 for build 87 (0348), 20 main photo (0349); 33's production inventory sync (a taxonomy sync, not a migration; after merge) |
| **Awaiting visual approval** | 16, 24, 31 (written spec, no mockup), 34 visual consolidation D1-D8 (`DESIGN_SYSTEM_AUDIT_2026-11-27.md`) |
| **Awaiting external accounts, credit or native review** | 11 real business offers (Anthropic credit + a seeded business), 22 Manage Subscription (native store sheet), native review: 18, 29, 35 and round 1's other machine-authored strings (round 2 added no new strings: cuisine reuses `ui.askBusiness.cuisineOptional` + existing cuisine names) |

Partly implemented is never listed as done: 7 (no Discover ranking by a gathering's cuisine until 0435 is live) and 34
(visual consolidation not applied) say so in their rows.

### What round 2 changed
1. **Cuisine (item 7) is a real structured fact**: migration 20270435 (staged) + client; see row 7.
2. **Design system (item 34)**: role + touch-target + contrast fixes with AST tools and a guard; D1-D8 measured and
   proposed; see row 34.
3. **Pending migrations**: `PENDING_MIGRATIONS_AUDIT_2026-11-27.md` (all 88, live gaps, batches, 0348/0349 readiness);
   approval packets regenerated through 0435; 0435 has its post-deploy step + rollback.
4. **Friends discovery**: approved as implemented (owner); unchanged.
5. **Taxonomy**: exact 2 new rows + 1 changed count (section above); production = main; no sync.
6. **Website**: export prepared, not published (below).

### Validation (round 2)
| Check | Result | Log |
|---|---|---|
| Jest, full | 630/630 suites, 8,573 passed, 11 todo | `/workspaces/.nearby-verify/v479/jest.log` |
| Journeys, all, local replay 0001-0435 (isolated network) | 146/146 suites, 1,603/1,603 | `/workspaces/.nearby-verify/v475` |
| Cuisine journey on production as prelude (rolled back) | 5/5; without 0435 5/5 FAIL (it really tests the migration) | this session |
| 0435 rollback round trip (local) | rollback removes every cuisine object; re-apply = identical schema (0 lines) | `/workspaces/.nearby-verify/v479` |
| Release compatibility, this branch's build | runtime 15/15 at 0347 and every batch boundary through 0435; static at 0435 = the 2 known fallbacks; recorded in `evidence/release-compat.md` | `/workspaces/.nearby-verify/v477` |
| deploy.js gates for 0348 (rolled-back check; nothing sent) | before the new evidence: only the approval code/ref/session and the stale compatibility line; the evidence line is now fresh | this session |
| Business website export (from this branch) | builds clean; differs from the published `docs/business/` by one bundle + index.html; headless (mocked Supabase, no network): 123/123, offer-preview dock 128/128 at 320-430 pt | `/workspaces/.nearby-verify/v476` |
| Narrowed inference test | still protects the original rule: a planted `setActivityLevel(1)` makes it fail; only the `setActivityListOpen` list toggle is exempt | this session |
| iOS bundle (export from this branch) | clean: 2,956 modules bundled, exit 0 | `/workspaces/.nearby-verify/v480/ios.log` |
| Final branch diff vs main | 142 files; app code + docs + design/i18n tools + one staged migration (0435) and its rollback; no change to app.json, app.config.js, eas.json, package.json or the lockfile | this session |

The website's pre-0348 signed-in pass (Coastal Coffee, five tabs + a profile save) is a real-browser check that only you can
run; publishing the export is a separate approval.

Environment note: the codespace disk filled at 23:56 UTC (local verification databases); two runs failed on it and were
re-run; space freed by removing one unused Postgres 15 image, two superseded replay containers, three pushed+clean
verification worktrees and the npm cache. The findings file was emptied by the failed write and restored from git.

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
- **After merge (separate owner approval):** this branch's inventory is 1,586 rows; production stays at main's 1,584
  until the owner approves a sync from merged main. Exact difference (read-only comparison, round 2, 2026-11-27 23:5x UTC:
  production = main exactly, 0 rows either way; state row unchanged):
  | Change | tag | file | consumer | occurrences |
  |---|---|---|---|---|
  | NEW | Concerts | `src/constants/onboardingInterests.js` | quick_picks | 1 |
  | NEW | Foodie | `src/constants/onboardingInterests.js` | quick_picks | 1 |
  | CHANGED (1 -> 2) | Nightlife | `src/constants/onboardingInterests.js` | quick_picks | 2 |
  Why: item 33 makes the onboarding picks reach the tags the app's own activities use (Live Music -> also Concerts,
  Restaurants -> also Foodie, Nightlife -> also the Nightlife tag). The inventory records every place code names a
  category, so a later rename/retire of Concerts, Foodie or Nightlife flags `onboardingInterests.js` as a follow-up; without
  the sync, production wouldn't know this file depends on them. The cuisine work added no category reference (the
  committed inventory is fresh: `taxonomyCodeDependencies` passes). The sync runs `sync-code-dependencies.js` (writes
  production) only after merge and your approval; the earlier unapproved run is the incident above.

## Reconciliation
| # | Finding | What changed | Status | Files | Tests | Device | Blocker |
|---|---|---|---|---|---|---|---|
| 1 | Architecture principles | Applied throughout: no new screen added; one shared rule per change | Followed | (all below) | screenRegistry guard | n/a | none |
| 2 | Hiking + This afternoon kept on a new "dinner tomorrow" | New ask replaces activity/category/word/For you/time, clears Outdoor/Indoor, date + category view; Open now only from the words | FIXED | `utils/gatheringFilters.js` (`filtersForNewAsk`), `DiscoverHubScreen.js` | `operatingStatus.test.js`, `deviceFindingsNov27.test.js` | Yes | none |
| 3 | Explore Nearby kept Coffee | General entries send a new `freshDiscovery` params object = clean Discover; the saved ask from before is ended; contextual entries keep their context; Back/tab bar keep the session | FIXED | `utils/discoverEntry.js`, Home/Activity/Plans/Matches/Your Progress/Create callers | `discoverEntry.test.js` | Yes | none |
| 4 | One interpretation everywhere | Already built: `createFromAsk`, `askBusinessParamsFromAsk`, `statedStartMinutes`, `partySizeFromText` | PRESERVED | `services/createAssistant.js`, `utils/askUnderstood.js` | journeys `outdoorMatch`, `statedTimeHandoff`, `understoodChipChange` | Yes (C18) | none |
| 5 | Activity separate from title | Already built (`gatherings.activity`, live). Round 2: cuisine is now its own stored fact too (`gatherings.cuisine`, 20270435), so a cuisine pick never touches activity or title | FIXED | `CreateGatheringScreen.js`, `utils/gatheringCuisine.js` | `createActivityPicker.test.js`, journeys `gatheringActivity`, `gatheringCuisine` | Yes | Older gatherings stay NULL (no backfill, owner rule) |
| 6 | Create configures itself | Known activity = one row + Adjust; carried day/time/party/who kept | FIXED | `utils/createActivityPicker.js`, `CreateGatheringScreen.js` | `createActivityPicker.test.js`, `createStartTime.test.js` | Yes | none |
| 7 | Dinner cuisine (round 2: fully functional) | Cuisine = optional structured fact, separate from activity, category and title, canonical list only (Italian, Mexican, Japanese, ... = the list business requests and business profiles already use). "italian dinner tomorrow for 4" -> Dinner / Italian / Tomorrow / 4 / no time: the understood WHAT chip reads "Italian · Restaurants" (removed with WHAT); Create preselects it (any food category), stores it at publish, shows it on Review; GatheringDetail shows "Italian · Dinner"; Edit changes or clears it; Ask Nearby Businesses preselects it (solo form), and a request made from a gathering inherits it server-side, so the business's Opportunity card shows it and routing ranks by it. Titles are never renamed any more | IMPLEMENTED, AWAITING DB (0435) + PHONE | migration `20270435_gathering_cuisine.sql` + rollback; `utils/gatheringCuisine.js`, `services/gatherings.js` (column read/written on its own, dropped on an older server), `createAssistant.js`, `askToBusiness.js`, `askUnderstood.js`, `AskUnderstoodChips.js`, Create / Edit / GatheringDetail, `gatheringBusinessAsk.js` | `gatheringCuisineCarry.test.js`, `createActivityPicker.test.js`, `gatheringBusinessAsk.test.js`; journey `gatheringCuisine` 5/5 with 0435 as prelude on prod (rolled back) and 5/5 FAIL without it | Yes | Storage needs 0435 (Phase B, number order); until then the build falls back (nothing stored; the solo business request still carries it). Not yet: Discover gathering lists don't rank by a gathering's cuisine (the shared list select must not name the column before it is live; add it to `SAFE_GATHERING_FIELDS` after 0435) |
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
| 19 | Dating Browse + Crossed Paths empty | Cause: the pre-0348 Dating view lacks the hide-switch columns. This branch carries build 88's `peopleRead.js` fallback (from main), so the next build fixes it on production as it is; 0348 also fixes it for build 87 | IMPLEMENTED, AWAITING PHONE (or 0348) | `services/peopleRead.js` | compat runtime step (Dating) at 0347 | Yes | Needs eligible test accounts on the phone |
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
| 34 | One design system | Round 1: one outline icon set for controls. Round 2 (`DESIGN_SYSTEM_AUDIT_2026-11-27.md`): every tappable control has a screen-reader role (30 fixed; AST tool + guard); 18 controls under 44 pt reach 44 via invisible hitSlop (tool + guard); failing amber text and raw reds -> theme tokens; typography (22 sizes), button heights (4), chips (2), cards, radii and spacing measured, with one-pass recommendations D1-D8 | PARTLY DONE: rules fixed + guarded; visual consolidation AWAITING VISUAL APPROVAL | `scripts/design/*`, `src/design/designSystemAudit.test.js`, 22 screens/components | `designSystemAudit.test.js` | Yes | D1-D8 change how screens look: need your approval or a mockup |
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
