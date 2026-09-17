# Nearby — Project Instructions

Nearby is a proximity-based dating/social discovery app (React Native/Expo, Supabase backend).
Supabase project ref: `enmosvippabmuqslzrox`. A Management API access token lives in
`.claude/mcp.json` (gitignored) — used via direct `curl` against
`https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/database/query` for schema
inspection/migration application, since the Supabase MCP server itself has not been reliably
available via ToolSearch in past sessions.

## Read this first — why this file looks different now (2026-09-17)

This file used to grow without bound: every session appended its full build log, verification
trail, and reasoning to the end, forever. By 2026-09-17 it had reached **29,860 lines / 2.46MB**
— reloaded in full at the start of every session as project instructions. Two sessions in a row
spent their entire budget on compaction of that giant file and made no forward progress on the
actual work (Phases 4-6 of the "Business Web as an Operating System" plan, since closed out —
see `CLAUDE_HISTORY.md`).

**The fix**: the complete, unedited historical record — every past session's full build log,
every audit, every locked design decision with its full original reasoning and verification
detail — was moved byte-for-byte to **`CLAUDE_HISTORY.md`**. Nothing was deleted or summarized
away; it's just not auto-loaded every session anymore. This file (`CLAUDE.md`) now holds only:
standing conventions that remain in force, and whatever's currently active/unfinished.

**When to open `CLAUDE_HISTORY.md`**: only when you genuinely need the detailed reasoning or
live-verification trail behind why some already-shipped feature works the way it does, or a full
account of a specific past session someone asks about by date. It's organized reverse-
chronologically (most recent work first) with clear dated section headers — grep for a date or
feature name rather than reading start to end. For everyday work, including picking up the
active items below, this file should be enough. Don't open the history file "just in case" —
that's exactly the habit that caused the problem this split exists to fix.

**Standing rule going forward, so this doesn't happen again**: keep this file short — a few
hundred lines, not tens of thousands. When a plan/phase finishes: (1) append the full verbose
build/verification account to the *top* of `CLAUDE_HISTORY.md` (most-recent-first), (2) replace
whatever was in this file's "Active / unfinished work" section for that plan with either nothing
(if fully done) or a short status line, (3) fold any newly-locked standing convention into the
"Standing Conventions" section below as a single bullet, not a narrative. Do not let this file
grow past a few hundred lines without doing this split again.

## Active / unfinished work

**Item 112 ("This reinforces the original Nearby promise... the most important conclusion") — a
guiding thesis, not a build item, logged 2026-09-17.** User's own crystallized tagline: Nearby
should NOT be "Here's what's near you" ("that's easy to replicate") — it should be "Tell Nearby
what you want to make happen, and we'll help make it happen with the people, places, businesses
and experiences around you." "A birthday is just one of the clearest demonstrations of that." No
code change — folded into the standing memory `project_intent_engine_vision` as the north-star
tiebreaker for future feature calls (prefer whichever shape makes Nearby DO something on the
user's behalf over whichever shape merely shows more of what's nearby). The whole Occasion/
"We'll plan it for you" arc (Items 61, 80-81, 90-92, 99-111 below) is the concrete proof of this
thesis already shipped, not a side feature.

**Same-day follow-up ("We should have animations for that too... purposeful and contextual, not
generic animations everywhere") — fully DONE (2026-09-17).** User's own 5-occasion spec, each with
a distinct brief glyph sequence and (except Celebration) a transition line: 🎂 Birthday
(🎂→✨→🎈, "Let's make it special."), 💍 Anniversary (💍→✨, "Plan something they'll remember."),
🎓 Graduation (🎓→✨, "Celebrate the milestone."), 🎉 Celebration (a quick tasteful particle burst,
no line named), 🎁 Surprise (a 🔓→🔒 "snap," landing on "🔒 Surprise Mode" — a lock micro-
animation, not a full theme change, which would be a much bigger, separate redesign this item
doesn't ask for).

Shipped as a new, small, reusable `OccasionSelectAnimation.js` (plain RN `Animated` API — the same
`spring`/`timing`, `useNativeDriver: true` shape `MatchCelebrationModal.js`'s own entrance already
uses, no new dependency) with a deliberately tiny lookup table, `OCCASION_SELECT_ANIMATIONS`,
covering exactly these 5 keys and nothing else — every other occasion (anything else reachable via
"More Occasions") plays no animation at all, on purpose, matching "not generic animations
everywhere." Wired into `CelebrateSomethingScreen.js`'s occasion step at both places an occasion
can actually be picked: the 5 quick-pick tiles (keyed on the TILE tapped, e.g. `'surprise'`, not
the resulting `occasion` state — `'surprise'` and plain `'celebration'` both set
`occasion:'celebration'` under the hood but need two different animations) and the full grouped
"More Occasions" list (the only place Graduation is reachable at all, since it isn't one of the 5
quick tiles). Renders as a small, self-dismissing card (~1.1-1.3s total) right below whichever
picker was used, `pointerEvents="none"` throughout so it's never a barrier to continuing — "just
enough to communicate," never a blocking modal or a forced auto-advance; the user still taps the
existing "Next" button when ready, unchanged.

No DB migration, no new pure functions (this is UI/animation timing, the same untested-by-design
precedent `MatchCelebrationModal.js` already set — no `.test.js` exists for any component in
`src/components/`). Full Jest suite 571/571 passing (unchanged); both new/touched files transform-
checked clean via `@babel/core` + `babel-preset-expo`. **Not exercised in a running app** (no
simulator/device tooling this session, standing note) — this is the one item this session where
that matters most, since animation timing/feel can only really be judged on a real device; next
session with device access should confirm all 5 animations play at a genuinely "subtle" pace (not
too fast to register, not slow enough to feel like a delay), that rapid re-tapping between
different occasions cleanly aborts/restarts rather than glitching, and that the particle burst
(Celebration) and lock snap (Surprise) read as intended rather than janky.

**Second same-day follow-up ("take it beyond the occasion-selection screen... when the plan is
successfully created") — fully DONE (2026-09-17).** User's own example: instead of a flat "Plan
created." line, animate the Nearby N itself into the celebration -- N → ✨ → ✓, settling into
"It's happening. 🎉" -- "a memorable Nearby interaction."

No literal "Plan created." text existed anywhere (confirmed via a repo-wide grep) -- the real
"plan just got created" moment this maps onto is `BusinessRequestDetailScreen.js`'s existing
`justSubmitted` banner, reached from all 3 real places that create a business request and land
here right after (`AskBusinessScreen.js`, the Occasion wizard's business-destined submit path
including the new `auto_plan`, and `GroupOccasionPlanScreen.js`'s "Book It" winning-business
booking) -- previously a bare informational text line, no celebration at all.

Shipped a new, small, reusable `PlanCreatedCelebration.js` -- the brand mark itself becomes the
celebration rather than sitting beside one (a step further than Item 57's `GatheringConfirmation
Screen.js` treatment, which keeps the mark and the 🎉 emoji as two separate elements): the
`NearbyMark` component cross-fades through N → ✨ → ✓ (same plain RN `Animated` cross-fade
shape `OccasionSelectAnimation.js`'s own 'morph' kind already uses), settles on a brand-coral
`✓`, then "It's happening. 🎉" fades in below and STAYS -- this is a settled header state, not a
self-dismissing toast, since it becomes the visual lead-in for the real informational text
underneath it (e.g. "We asked 4 nearby businesses…"). Gated to the genuine success case only
(`!isDuplicate && notifiedCount > 0`) -- the duplicate case ("here it is again," nothing new
happened) and the zero-notified case (nothing has actually happened yet, still needs a
wider-radius retry) keep their plain original text only, matching "purposeful and contextual, not
generic everywhere." Deliberately did NOT touch `GatheringConfirmationScreen.js`'s own already-
shipped, already-working Item 57 celebration -- a real, disclosed scope boundary, not an
oversight: it already has a distinct, working treatment, and this item's example maps onto the
one real "success" moment that had NO celebration at all, not a request to replace an existing one.

No DB migration, no new pure functions (animation timing, same untested-by-design precedent as
every other Animated-based component in `src/components/`). Full Jest suite 571/571 passing
(unchanged); both new/touched files transform-checked clean via `@babel/core` + `babel-preset-
expo`. Not exercised in a running app (standing note, same caveat as the tile-selection animations
above) -- next session should confirm the N→✨→✓ sequence reads clearly at a glance and that it
correctly plays for all 3 real justSubmitted call sites, not just the Occasion wizard's.

**Item 111 ("We'll plan it for you" — a single "Don't know what to do? Let Nearby plan it" front
door that collects Who/Occasion/When/People/Budget/Vibe and returns "Here's what we'd do: 🍽️
Dinner / 🎵 Live music / 🌹 Flowers / Estimated total: $X / Find available options →") — fully DONE
(2026-09-17), reversing this same day's own earlier "logged as backlog, explicitly NOT built"
call.** Found at session start: a complete, uncommitted implementation of exactly this already on
disk (`CelebrateSomethingScreen.js`/`celebrateSomething.js`/`celebrateSomething.test.js`) — a real
build had evidently happened after the backlog-log commit was made, in a session this repo's own
"restart-prone codespace" pattern (see memory) then lost track of. Read in full, checked field-by-
field against the mock and against every function/shape it calls (`experienceTemplateForOccasion`,
`assembleExperience`'s component/item shape, `relevantAddonTypesForOccasion`,
`createPlanAddonRequest`'s real signature), confirmed correct and complete, then verified and
shipped rather than left stranded a second time.

Shipped as a new pseudo-activity-type, `AUTO_PLAN_OPTION` (`🤖 Let Nearby Plan It`) — same shape as
the existing `GROUP_VOTE_OPTION` ("Let the Group Vote"): a real, distinct choice on the wizard's
'activity' step, not an 8th equivalent activity, only rendered when the current occasion has a
real Experience Template (`experienceTemplateForOccasion`) to auto-select from — an occasion with
no template (e.g. a plain Farewell) has nothing multi-part to propose, so offering this would set
up a false promise. Routes to the same `'business'` destination as Dinner/Night Out/Activity
(`resolveCelebrationDestination`), reusing the exact same `who_involved` → `options` step sequence,
`fetchOptions()` call, and `resolveIntent()`/`assembleExperience()` pipeline those three already
use unmodified — `activityType` was never actually read by any of that machinery to begin with.

The only genuinely new piece is how the 'options' step *presents itself* when reached this way: a
new `buildAutoPlanSuggestion()` (`celebrateSomething.js`) purely re-aggregates what
`assembleExperience()`'s own components already found — never a second fetch, never a fabricated
price — into "✨ Here's what we'd do": one line per real Experience Template component that found a
genuine top-scored match (e.g. "🍽️ Dinner · Bistro A · $65"), plus up to 2 real, deterministic
add-on-type suggestions (`planAddons.js`'s `relevantAddonTypesForOccasion`, e.g. "🌹 Flowers") —
filtered to drop any add-on type whose own category is already covered by a matched template
component, so the same real idea (live music, dessert) is never shown twice, once priced and once
not. `estimatedTotal` sums only the priced, matched items; `hasUnknownPrice` renders it as a floor
("$105+") rather than a false-precision exact figure whenever a matched item's own price isn't
listed. Tapping "Find available options →" pre-selects exactly what was just proposed and reveals
the existing full browse-and-check UI below it — every candidate stays freely addable/removable
from there, nothing is ever silently locked in. The add-on-type suggestions have no specific
business/price of their own (unlike the priced components, which are real, already-bound
candidates) — accepted ones become real Item 80 `create_plan_addon_request()` calls against
whichever primary request the submission produces, fired best-effort right after that primary
already succeeded, never blocking or undoing it on their own failure. The pre-existing "Skip — I'll
post a general request myself →" escape hatch (`proceedToDestination`, already fully generic over
every business-destined activity type) renders unconditionally under this view too, so an occasion
with zero live nearby matches is never a dead end.

No DB migration — pure client-side reuse of already-existing, already-tested infrastructure
(`experienceTemplates.js`, `experienceAssembly.js`, `planAddons.js`, `businessFulfillment.js`'s
`createPlanAddonRequest`). Full Jest suite 571/571 passing (6 new: 5 for `buildAutoPlanSuggestion`
covering the priced-total/unknown-price-floor/empty/capped-suggestions/missing-input cases, 1 for
`resolveCelebrationDestination('auto_plan')`); both touched files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that the "🤖 Let
Nearby Plan It" chip only appears for a template-backed occasion, that the summary view's total/
add-on toggles render correctly, and that "Find available options →" correctly pre-selects the
right candidates in the revealed full options view.

**Same-day follow-up ("build the auto plan entry point") — fully DONE (2026-09-17).** The
`AUTO_PLAN_OPTION` chip above was only reachable after three prior steps (Create → Plan for
Someone → pick an occasion → answer who it's for) — a real front door was still missing for
someone who genuinely doesn't know where to start. Added a new `CreateHubScreen.js` Quick Action,
"🤖 Let Nearby Plan It," alongside the existing Invite Friends/Plan a Date/Ask Nearby Businesses
row — same destination (`CelebrateSomething`), just navigated with `initialActivityType:
'auto_plan'` and the same real who-for prefill (`buildOccasionWhoForParams`) the primary "Plan for
Someone" card already threads through. No new screen, no duplicated occasion picker: the wizard
still asks Occasion and Who (neither is skippable — the auto-plan summary needs a real occasion to
pick a template from), but now arrives at its own 'activity' step with "Let Nearby Plan It"
already selected rather than requiring the user to notice and tap it themselves. Disclosed, minor,
pre-existing edge case (not introduced by this change): if the user picks an occasion with no
Experience Template after entering this way, `activityType` stays `'auto_plan'` internally with no
visible chip selected on the 'activity' step (the chip itself is gated on
`experienceTemplateForOccasion`) — the wizard still functions correctly (routes to `'business'`,
the options step degrades honestly to add-on suggestions only, never blocks), just with no visual
confirmation of the invisible pre-selection in that one specific case. No DB migration, no new
pure functions (pure routing/UI wiring reusing already-tested `buildOccasionWhoForParams`); full
Jest suite 571/571 passing; both touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm the new Quick Action renders and correctly lands on
the wizard with "Let Nearby Plan It" pre-selected once an occasion/who-for are answered.

**Second same-day follow-up — real gap closed, "Budget" was never actually collected on the solo
path (2026-09-17).** Re-checked the shipped feature line-by-line against the mock's own 6 inputs
(Who/Occasion/When/People/Budget/Vibe) rather than trusting the first pass — found that
`BUDGET_LEVEL_OPTIONS` (Item 94) only ever rendered on the group-vote flow's own `group_invite`
step; every solo business-destined path (Dinner/Night Out/Activity, and now `auto_plan`) never
showed a budget chip at all, silently submitting with `budgetRangeKey` stuck at its unset default
forever. Fixed by duplicating the same chip row + optional per-person override field into the
'when' step's `destination === 'business'` block, right before the Vibe/experience-level row that
was already duplicated there — matches this step's own existing precedent (Vibe is already shown
in both `'when'` and `group_invite`), not a new pattern. Confirmed budget is stored-only (feeds
`resolveBudgetMax()` → the submitted request's own `budget_max` column, for the business to see),
never a `resolveIntent()` search parameter — so this doesn't change what "Here's what we'd do"
proposes, only what gets recorded on the resulting request, matching how budget already worked on
every other path. No DB migration, no new pure functions; full Jest suite 571/571 passing;
`CelebrateSomethingScreen.js` transform-checked clean. Not exercised in a running app (standing
note) — next session should confirm the new budget chip row renders correctly on the 'when' step
for Dinner/Night Out/Activity/Let Nearby Plan It, distinct from its own copy on `group_invite`.

**Item 110 ("This could tie directly into your notification recommendation engine... distinguish
Important (relationship/contextual, e.g. 'Sarah's birthday is in 7 days') from Recommendation
(discovery, e.g. 'New live music nearby')... much less spammy") — fully DONE (2026-09-17), same-day
direct follow-up to Item 109.** Real tier classification for every push type this app sends,
delivered at genuinely different OS-level urgency rather than just a labeling exercise.

New `notificationTier()` (`src/constants/notificationTier.js`) classifies every real push type
`notifications.js`'s own `routeNotificationTap()` switch already enumerates (~78 types) into
`'important'` (a specific person/commitment/something the recipient already actively did — every
occasion/plan/social/business-relationship push) or `'recommendation'` (algorithmic discovery —
`recommended_gathering`/`recommended_business_availability` from Item 17, aggregated demand
signals, gamification nudges). Defaults an unrecognized/future type to `'important'` — fails
toward delivering normally rather than silently muting something nobody's classified yet. A real
drift guard, not just a hand-asserted list: `notificationTier.test.js` reads `notifications.js`'s
actual switch cases straight from source via regex and asserts every one is classified, plus the
reverse (no stale classified type that no longer has a real switch case) — the same "second copy
drifts" bug class this codebase has hit before (CLAUDE.md's own migration-discipline notes), now
guarded automatically for this vocabulary specifically.

The tier now genuinely changes delivery, not just a settings label: every push already carries its
own `type` inside `data` (confirmed live — every `notify_*` function already does, needed for tap
routing), so `send-push` (the one Edge Function all ~60 Postgres `notify_*` functions already route
through) derives the tier from `data.type` with **zero changes needed to any of those 60
functions** — it now sets `channelId`/`priority`/`sound` on the outbound Expo push request:
important-tier keeps today's exact existing behavior (`sound: 'default'`, `priority: 'high'`,
`channelId: 'important-alerts'`); recommendation-tier is quiet (`sound: null`, `priority:
'default'`, `channelId: 'recommendations'`). Client: `registerForPushNotifications()`
(`notifications.js`) now registers two real Android notification channels alongside the existing
`'default'` one (kept as a harmless fallback) — `important-alerts` at `AndroidImportance.HIGH`
(heads-up + sound), `recommendations` at `AndroidImportance.LOW` (tray-only, no heads-up, no
sound) — so a recommendation-tier push genuinely interrupts less on Android, not just carries a
quieter label.

**Deliberately duplicated, not shared**: the Deno edge function can't import from `src/` (this
codebase's established constraint for every edge function), so `send-push/index.ts` carries its
own inline copy of the same type→tier set, with an explicit comment that the two must be kept in
sync by hand — the client copy has an automated drift guard; this one doesn't, a real, disclosed
limitation rather than a silently assumed one. Deliberately did NOT touch `SettingsScreen.js`'s
existing 6-category toggles (Item 29) — category (WHAT domain: Social/Discovery/Proximity/
Planning/Business/Community) and tier (HOW urgently to deliver) are two different axes that don't
map 1:1 (e.g. Business spans both — `business_offer_received` is important,
`business_opportunity_received` is a recommendation) — conflating them into one UI would misstate
the model rather than clarify it.

Redeployed and confirmed live via the Management API's function-body endpoint (the new
`notificationTier`/`RECOMMENDATION_TYPES`/`channelId` logic present in the deployed bundle) — `npx
supabase functions deploy` itself succeeding is this repo's own established TypeScript-syntax-
validity signal for a Deno edge function (no local `deno` binary available to check independently).
No DB migration — every `notify_*` function already sends `type` inside `data`, confirmed via a
live grep of the migrations rather than assumed. Full Jest suite 565/565 passing (5 new); both
touched client files transform-checked clean via `@babel/core` + `babel-preset-expo`. **Not
exercised on a real device** (no simulator/device tooling this session, standing note — this is
the one item in this session where that matters most: the actual Android heads-up-vs-quiet
behavioral difference, and whether `channelId`/`priority`/`sound: null` are honored exactly as
expected by Expo's push API today, have never been observed firsthand) — next session with device
access should confirm a recommendation-tier push (e.g. trigger `recommended_gathering`) lands
quietly with no heads-up/sound on Android while an important-tier push behaves exactly as before.

**Item 109 ("Security/privacy should be designed in from day one... make the visibility model
explicit: Private / Invite-only / Friends / Public, default to the most private reasonable
setting") — audited, fully DONE (2026-09-17), same-day direct follow-up to Item 108.** Audited the
real current model (RLS policies, RPC access checks, function bodies pulled live) against the
user's own 4-tier vocabulary before writing anything, rather than assumed. Verdict: the underlying
access-control architecture already implements exactly this, and already defaults to the most
private reasonable tier at every step:
- **Private** = an `occasions` row itself (a personal reminder) — RLS is `auth.uid() = user_id`
  only; the one broadening mechanism, `connected_user_id`, is a single explicitly-picked person,
  opt-in, default off (Item 62/63) — confirmed live via `get_upcoming_occasions()`'s own access
  check: owner, or that one real connected friend/match, never anyone else.
- **Invite-only** = an `occasion_group_plans` row — RLS enabled with **zero** client policies
  (confirmed live), every access routed through a SECURITY DEFINER RPC that checks host/organizer/
  joined-participant membership; structurally can't leak beyond that roster. A resulting Gathering
  from the Occasion wizard defaults here too — `resolveCelebrationVisibility()` (already built)
  returns `invite_only` for every activity type except an explicit "existing group" pick, never
  defaults to public.
- **Friends** / **Public** = `gatherings.visibility` = `'friends'` / `'everyone'`, both already
  real, already gated identically everywhere a gathering can be browsed
  (`applyGatheringVisibilityFilters()`, the same predicate Item 108 just extended to Home's
  friend-activity feed) — never the *default* for anything occasion-sourced, only ever reached by
  the user's own explicit, later widening.

What was genuinely missing, and the one real thing this item shipped: the model was correct but
**invisible** — a user had no way to actually see/confirm "this is private" short of trusting an
RLS rule they can't read. Added real, always-visible, no-new-data-needed privacy indicators, pure
UI reusing already-fetched fields: a shared `VISIBILITY_OPTIONS` vocabulary (`src/constants/
gatheringVisibility.js`, extracted out of `CreateGatheringScreen.js`'s own local copy, reordered
narrowest-to-widest) now also renders as a persistent badge on `GatheringDetailScreen.js` (icon +
label + the specific community name when applicable) — previously shown only inside the create
picker, never on the resulting detail screen. New `describeOccasionPrivacy()`
(`src/utils/occasionVisibility.js`, 5 new Jest tests) renders "🔒 Private" or "👤 Shared with
{name}" on every `OccasionsScreen.js` row, and a plain "🔒 Invite-only" line on that screen's Group
Plans rows and on `GroupOccasionPlanScreen.js`'s own header (additive to, not replacing, Item 65's
existing surprise-specific banner).

No DB migration — pure client-side surfacing of already-real, already-correctly-scoped data. Full
Jest suite 560/560 passing (5 new); all six touched/new files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that the visibility
badge renders correctly on `GatheringDetailScreen` for each of the 4 tiers (including the
community name for a community-scoped gathering), and that the new privacy lines render correctly
on `OccasionsScreen`'s occasion rows, its Group Plans rows, and `GroupOccasionPlanScreen`'s header.

**Item 108 ("don't make the app socially noisy" — a real privacy leak in Home's friend-activity
feed) — fully DONE (2026-09-17), picked up and finished after an interrupted prior session left
the fix uncommitted on disk.** Found at session start: a complete, uncommitted fix to
`homeDashboard.js`/`gatherings.js` (no trace of the original request text anywhere — inferred
purely from the fix's own inline comments — so treat this description as reconstructed, not
quoted verbatim). Session-start audit confirmed the fix was correct and complete before shipping
it; nothing needed to be redone.

The real bug: `getHomeDashboard()`'s "friends are already making plans" activity feed
(`friendsActivity`, feeding the "🎉 N of your friends are already making plans" Home card) queried
`gatherings` for anything a friend hosted in the last 3 days with **zero visibility check** —
no filter on `visibility`/`community_id`/`women_only`, and confirmed live-equivalent (via the
table's own already-known RLS shape) that nothing at the DB layer caught this either, since
`gatherings`' SELECT policy is unconditionally `true`. A friend creating a genuinely
`invite_only` plan — including a surprise occasion, Item 96's whole reason to exist — would
render "{host} is hosting" / the plan's own real title (e.g. "Sarah's Birthday 🎂") to every
*other* mutual friend of that host, regardless of whether they were actually invited. This is
exactly the kind of private planning object this app's own architecture (surprise mode, invite-
only gatherings) already goes out of its way to keep private everywhere else — this was the one
surface that silently didn't.

Fixed by reuse, not a new rule: `fetchGatheringVisibilityContext()`/
`applyGatheringVisibilityFilters()` — the exact predicate `getNearbyGatherings()`/
`searchGatherings()` already share so plain browse and search can never drift on who's allowed to
see what (blocks, women-only, and the friends/community/invite_only discovery-scope funnel) — are
now exported from `gatherings.js` and reused by `homeDashboard.js`'s friend-activity query
instead of a second, ungated query that could (and did) drift from that established rule. The
query now also selects `visibility`/`community_id`/`women_only` (needed by the shared filter,
never rendered — the client already had full access to its own dashboard data either way) and
runs the result through the same filter before deduping to one row per host and capping at 3.

No DB migration — pure client-side reuse of an already-live, already-proven query-field set (the
three added columns are already selected by the untouched `getNearbyGatherings()`/
`searchGatherings()` in the same file). Full Jest suite 555/555 passing (no new pure functions —
this is a query-gating fix, not new logic); both touched files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on two real accounts that a friend's
`invite_only`/surprise gathering no longer appears in the other's Home "friends are already making
plans" card, while a normal `everyone`/`friends`/`community`-visible one still does.

**Item 107 ("Build the occasion around a beautiful shareable card") — fully DONE (2026-09-17),
same-day direct follow-up to Items 105 & 106.** User's own mock: once a plan is finalized, a real
branded card ("🎂 Sarah's 30th Birthday / Saturday · 7:30 PM / 📍 Restaurant / 👥 10 going / View
Plan") shareable through Messages/text — "a recognizable visual artifact."

Built on Item 90's own already-real `buildPlanSummary()` (title/dateLabel/timeLabel/location/
partySize) rather than a second "what does a finalized plan look like" model — this is the exact
data the mock's fields map onto field-for-field. New `OccasionPlanShareCard.js` renders a fixed,
theme-independent (deliberately not `useTheme()` — a shared image should look the same regardless
of the sharer's own light/dark setting, same reasoning `docs/invite.html` hardcodes its own
palette) branded gradient card via `expo-linear-gradient` + the app's own approved `NearbyMark`
brand component (Item 57's "the N mark should become part of the product language" — this is a new,
concrete instance of exactly that). Rendered off-screen (always mounted once a plan is
`statusKind === 'confirmed'`, positioned via absolute+opacity so it never appears in the visible
layout) and captured to a real PNG via the new `react-native-view-shot` dependency
(`npx expo install`, no config plugin/permissions needed — confirmed via its own README) the
instant the user taps "🎉 Share This Plan," then handed to `expo-sharing`'s existing `shareAsync`
(the same pattern `dataExport.js` already established for sharing a generated file) — that's what
actually opens Messages/text/etc. Gated strictly to `statusKind === 'confirmed'` (Item 91's own
real status resolver) — matching "when the plan is finalized" precisely, not shown for a
still-pending or cancelled request. New pure `buildOccasionPlanShareCaption()`
(`occasionPlanShareCard.js`, 6 new Jest tests) composes the same real fields into a plain-text
description, used as the Share button's `accessibilityLabel` — a screen-reader user gets the actual
plan content described, not just a generic "share" label, since the artifact itself is an image
with no alt text of its own.

Deliberately scoped to the one real "Plan" object Item 90 already made canonical
(`BusinessRequestDetailScreen`'s primary-request screen) rather than also duplicating a second
card-generation path on `GroupOccasionPlanScreen`'s own decided/fulfilled state — that screen's
"decided" card has no `partySize`/location shape as clean as `buildPlanSummary()`'s, and once a
group plan is finalized into a real business request, it already lands on this exact screen where
the share action now lives, per Item 90's own "the Plan itself becomes the source of truth"
architecture (one canonical summary, not two).

Full Jest suite 555/555 passing (6 new); all three touched/new files transform-checked clean via
`@babel/core` + `babel-preset-expo`. No DB migration — pure client-side, reusing an already-real
data shape. Not exercised in a running app or on a real device (no simulator/device tooling this
session, standing note) — this is the one item in this session where that matters most: neither
`react-native-view-shot`'s actual on-device capture behavior nor the native share sheet hand-off
has ever been exercised. Next session with device access should confirm: "🎉 Share This Plan"
renders only once a plan is genuinely Confirmed, tapping it produces a real, correctly-styled PNG
(not a blank/black capture — a known `react-native-view-shot` failure mode when a captured view
render order or timing goes wrong), and the native share sheet correctly offers Messages/text/etc.
with that image attached.

**Items 105 & 106 ("This could also improve user acquisition" — non-Nearby guests on an Occasion
plan) — fully DONE (2026-09-17), same-day direct follow-up to Item 104, built after a locked
`AskUserQuestion` scope pick ("build it now").** User's own example: inviting 8 people to Sarah's
30th Birthday, 3 of whom aren't Nearby users, should send them a real "You're invited — View Plan"
link that works with zero install, RSVP included, with "Join Nearby" as the natural upgrade path
afterward.

Item 72 (2026-09-10, "Make invitations frictionless") already built exactly this for Gatherings
(`get_public_gathering_invite_preview` / `docs/invite.html`) but explicitly scoped Occasion group
plans OUT, calling genuine anonymous-guest access "a materially bigger, separate feature (guest
identity, spam/abuse risk)." This is that feature, deliberately bounded: a guest is invited BY
NAME (never a single shared/generic link), each getting their own unique, unguessable bearer
token (`occasion_group_plan_participants.guest_token`) — so an RSVP is always traceable to a
specific person the host actually typed in, never spoofable by someone holding a different
guest's link. A guest can VIEW the plan and RSVP (accept/decline) — the item's own "view/RSVP/see
details" list — but deliberately can NOT propose ideas or vote: that's real collaborative
decision-making among people Nearby can hold accountable via a real account, and this repo's own
backlog guardrail already warns against building "a giant event-management platform." A guest who
wants to do more taps "Join Nearby."

Shipped via `20261126_occasion_group_plan_guest_invites.sql`: `occasion_group_plan_participants
.user_id` is now nullable (a guest row has `guest_name` instead, CHECK-constrained so a row always
has one or the other); `invite_guest_to_occasion_group_plan` (host/organizer-only, same
authorization check `invite_more_to_occasion_group_plan` already uses, capped at 20 guest invites
per plan) creates the row and returns its token immediately. Two new anon-callable RPCs mirror
Item 72's own privacy discipline exactly (fixed, minimal return column list — no participant list,
no budget, no exact business/location detail): `get_public_occasion_group_plan_guest_view(token)`
resolves ONLY that one guest's own row (title/occasion/host name/when/decided-activity-once-
decided/their own RSVP status), and `respond_to_occasion_group_plan_guest_invite(token, accept)`
records their RSVP and pushes the host a real notification either way — something a host would
otherwise never learn about a non-Nearby guest. `get_occasion_group_plan_detail` (unchanged
signature, safe `CREATE OR REPLACE`) now returns a guest's real name/status to every participant,
but the actual shareable `guestToken` only to the host or an organizer — never to a plain fellow
guest.

New `docs/occasion-invite.html`, same "plain static HTML + direct REST call with the public anon
key" shape as `docs/invite.html`/`docs/track.html`, reading a `?t=<guest token>` param and
rendering a live preview with "I'm in"/"Can't make it" buttons that call the RSVP RPC directly,
plus the same "Join Nearby" store-link upgrade path. Client:
`GroupOccasionPlanScreen.js`'s existing "+ Invite More Guests" panel (host/organizer-only) gained a
"Or invite someone who isn't on Nearby yet" name field + "🔗 Get Invite Link" button
(`inviteGuestToOccasionGroupPlan()`, new in `occasionGroupPlans.js`) that creates the guest row and
immediately hands the resulting link (`occasionGroupPlanGuestInviteShareUrl()`) to the native OS
share sheet — Nearby never sends it on the host's behalf, matching Item 72's own "the host picks
the channel" precedent. Each guest chip in the roster is now tappable by the host/an organizer to
re-share their link (🔗 prefix, since a guest has no account to promote to organizer — a real,
disclosed gap this surfaced and fixed in the same pass: the pre-existing promote-to-organizer tap
handler had no `isGuest` guard at all, and every participant chip was silently keyed by `p.userId`,
which is `null` for every guest — a real React key-collision bug with 2+ guests, fixed by exposing
each participant row's own non-sensitive `id` for keying instead). A new push type,
`occasion_group_plan_guest_rsvp`, routes to the same real `GroupOccasionPlanScreen` every sibling
push in this family already uses.

Verified live against production (`enmosvippabmuqslzrox`) via a comprehensive disposable rolled-
back transaction with real fixtures before applying for real: guest invite/trim, the public guest
view (correct payload, a bogus token honestly returns null), RSVP accept (and a second RSVP on the
same token correctly rejected, a bogus token on respond correctly rejected), the host seeing a
real `guestToken` in `get_occasion_group_plan_detail` while a plain non-organizer participant
cannot, and the 20-guest cap correctly enforced. Rolled back with zero leaked rows confirmed. A
second live (non-rolled-back) round-trip then hit the REAL production REST endpoint with the anon
key exactly as the static page does — `get_public_occasion_group_plan_guest_view` and
`respond_to_occasion_group_plan_guest_invite` both confirmed working end to end over HTTP, not just
at the SQL level — before the disposable fixture was deleted and re-confirmed at zero leaked rows.
Re-confirmed live afterward: all four touched/new functions have exactly one overload each, and
grants are exactly as intended (the two guest-facing RPCs on `anon`+`authenticated`, the host-only
invite RPC on `authenticated` only, no leak). Full Jest suite 549/549 passing (no new pure
functions — this is DB/RLS-plus-UI wiring); all four touched/new client files transform-checked
clean via `@babel/core` + `babel-preset-expo`; the new page's inline script syntax-checked clean
via `node --check`. Not exercised in a running app or a real browser (no simulator/device/browser
tooling this session, standing note) — next session should confirm on a real account that "🔗 Get
Invite Link" creates a link and opens the native share sheet, that the link renders and RSVPs
correctly in an actual browser, and that a tapped `occasion_group_plan_guest_rsvp` push lands on
the right plan for the host.

**Item 104 ("There could eventually be an 'Occasions' recommendation engine") — first real
increment shipped (2026-09-17), same-day direct follow-up to Item 103.** User's own mock:
"Upcoming in your world / 🎂 Sarah's birthday — 10 days / 💍 Anniversary — 22 days / 🎓 John's
graduation — 31 days / Plan Something" — "that becomes a personalized planning dashboard. But
again, I'd keep it inside Home/Profile, not make it another top-level tab."

Built as a genuine new, standing preview widget on Home — pure regrouping of two already-real,
already-fetched lists (`getUpcomingOccasions()`/`getUpcomingConnectedBirthdays()`), no new query,
no new table. Deliberately does NOT duplicate the existing single-item birthdayNudge/occasionNudge
cards those same two lists already feed — the new widget shows whatever's coming up BEYOND the one
item those cards already feature (`buildUpcomingWorldItems()`, `src/utils/upcomingWorld.js`, new
pure function with its own Jest tests, `skip: 1` default), so a user never sees "Sarah's birthday
— 10 days" rendered twice on the same screen. This reads as the fuller "world" picture
complementing the existing "here's the one most urgent thing" nudge, rather than a second,
competing copy of it.

**A real, previously-latent bug was found and fixed while building this, not hypothetical**:
neither `get_upcoming_occasions()` nor `get_upcoming_connected_birthdays()` has an `ORDER BY` — a
plain PL/pgSQL loop with no explicit ordering over its underlying query — yet every existing
caller (`HomeScreen.js`'s own `occasions[0]`/`birthdays[0]`) had been silently trusting incidental
row order as "the soonest" since these were first built. Confirmed by reading both function bodies
directly, not assumed. Fixed at the single shared client-layer choke point instead of touching
either RPC: `getUpcomingOccasions()`/`getUpcomingConnectedBirthdays()` (`occasions.js`/
`friends.js`) now sort by `days_until` ascending before returning, so every existing consumer
(the two single-item nudge cards, `ViewProfileScreen`'s own "Upcoming" section) gets correctly
sorted data for free, not just this new widget.

Each row in the new "📅 Upcoming in Your World" card is directly tappable — richer than the mock's
single generic "Plan Something" button below a static list, but consistent with how every other
summary row in this app already works (`OccasionsScreen`, `ViewProfileScreen`'s own Upcoming
section) — and lands on the Occasion wizard pre-filled for that specific item
(`handlePlanFromUpcomingWorldItem()`), using the exact same real who-for resolution shape
`notifications.js`'s own `occasion_upcoming` push-tap routing already established (a real
connected friend id wins, else a hand-typed name, else occasion-only). Purely informational
otherwise — no per-day dismiss/suppression, since this is a standing preview, not a one-shot
nudge; it simply doesn't render at all when there's nothing real beyond the featured item.
`formatUpcomingWorldItemLine()` produces the mock's exact compact shape ("🎂 Sarah's birthday — 10
days") with one real, disclosed subtlety caught before this was considered done: a wizard-composed
occasion title already bakes its own trailing icon onto the string (Item 84's
`composeCelebrationTitle()`, e.g. "Sarah's Birthday 🎂") — prepending the row's own icon
unconditionally would have doubled it ("🎂 Sarah's Birthday 🎂"); the formatter only prepends when
the label doesn't already end with that exact icon.

**Deliberately scoped to Home only, not also duplicated onto Profile** — the user's own phrasing
("Home/Profile") reads as "somewhere in the existing app surfaces, not a new tab," and Profile's
own `OccasionsScreen` (reached via "Your Plans") already serves the exhaustive, standing-dashboard
role there; adding a second, smaller teaser widget in Profile would be redundant with what's
already one tap away, not a genuinely new capability. Disclosed rather than silently assumed
covered.

New Jest coverage: `upcomingWorld.test.js` (11 tests — merge/sort/skip/limit behavior, the empty
and missing-input cases, and both icon-dedup branches). Full suite 549/549 passing; all four
touched/new files transform-checked clean via `@babel/core` + `babel-preset-expo`. No DB migration
— pure client-side (the sort fix and the new widget both work entirely off data these two RPCs
already return). Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm on a real account that the widget renders correctly
below the existing nudge cards, that it correctly shows nothing when there's only one real
upcoming item total, and that tapping a row lands on the Occasion wizard correctly pre-filled for
that specific item.

**Item 103 ("Don't forget non-celebratory life events") — audited, fully DONE (2026-09-17),
same-day direct follow-up to Item 102.** User's own list: "Mom is visiting" / "My friend is
moving away" / "We're back in town" / "College reunion" / "Team celebration" / "First date" /
"New job" / "Retirement" — "these are reasons to get people together... this is why I like
Occasions more than 'Celebrations.'"

Audited against the real current vocabulary and code before writing anything, rather than
assumed. Verdict: WHAT can be expressed already has no real gap. Item 73's life-events expansion
(2026-09-12) already added `retirement`/`new_job`/`reunion`/`welcome`/`farewell`/`moving` to every
occasion-vocabulary CHECK constraint; anything not on the named list at all ("Mom is visiting")
already has a first-class, dedicated path via Item 74's Custom Occasion free-text flow, which
skips the usual who/what/when interrogation entirely. **"First date" was deliberately left
unbuilt as a named occasion type** — adding it would duplicate the already-real, dedicated match/
date-planning flow `DateProposalScreen` already owns (a genuinely different "who is this with"
model — a match, not a friend/family/someone_else), and it remains fully expressible today via
Custom Occasion for anyone who wants to log/plan one as a personal record outside that dedicated
flow. Disclosed rather than silently skipped.

What the audit found instead were real, concrete instances of the exact failure mode this item
warns about — server-side and client-side copy that silently assumed every occasion is a
celebration, confirmed live against the actually-deployed function bodies and actual screen code,
not guessed from memory:

1. **`_occasion_emoji()`/`_occasion_noun()`** — the two shared helpers feeding emoji/label text
   into 12 real push-sending functions (confirmed via a live `prosrc` search: `invite_to_business_
   request`, `submit_business_offer`, `accept_business_offer`/`decline_business_offer`, `add_plan_
   organizer`, `confirm_group_plan_offer`, `post_business_availability`, `send_occasion_planning_
   nudges`, `send_occasion_group_plan_stall_nudges`, `notify_occasion_demand_threshold`, `send_
   business_recall_outreach`, `admin_review_business_content_screening`) — were missing 8 of Item
   73's own 8 new life-event values entirely (`wedding`/`new_job`/`retirement`/`achievement`/
   `moving`/`reunion`/`welcome`/`holiday_gathering` all silently fell through to a generic 📅/
   "Occasion"), meaning a real "Retirement" or "New Job" occasion got a bland, generic push
   everywhere a "Birthday" already got a rich, specific one — precisely the asymmetry this item
   warns about. Also fixed a real, separate drift caught in the same pass: the DB helper mapped
   `milestone` to 🏆, but the client's own authoritative `OCCASION_OPTIONS`
   (`businessAttributes.js`) maps `milestone` to 🥂 and `achievement` to 🏆 — the two had silently
   diverged. Both fixed to match the client exactly.
2. **`create_plan_addon_request()`'s** auto-generated, privacy-safe business-facing `raw_text`
   (Item 80) hardcoded every add-on's description as "{Label} for a {occasion, underscores
   replaced} celebration" regardless of actual occasion — a real florist or photographer add-on
   tied to a farewell/moving/new-job occasion literally read "Flowers for a farewell celebration"
   / "Photographer for a moving celebration" / "Transportation for a new job celebration" in front
   of the business deciding whether to respond. Fixed to use the corrected `_occasion_noun()`
   helper instead ("Flowers for a Farewell" / "Transportation for a New Job"), with a minimal a/an
   article fix for the three nouns that need it (Anniversary/Engagement/Achievement) — a real,
   small, pre-existing grammar bug in the original hardcoded text too ("for a anniversary
   celebration"), fixed in the same pass since this line was already being rewritten.
3. **`CelebrateSomethingScreen.js`**'s two validation prompts ("What's the occasion for this
   celebration?" / "Who is this celebration for?") were the only two remaining non-neutral labels
   in the whole wizard — every other on-screen label ("What are you planning?" / "Who is this
   for?") was already neutral. Reworded to match.
4. **`ViewProfileScreen.js`**'s Item 86 entry-point button, "🎉 Celebrate {name}" — a genuinely
   wrong verb for the real non-celebratory occasions reachable from that exact button (a Farewell,
   "Mom is visiting" via Custom Occasion). Relabeled "✨ Plan for {name}", matching Create's own
   already-renamed "Plan for Someone" card (Item 83).
5. **`BusinessDashboardScreen.js`**'s Item 79 dashboard section, "🎉 What They're Celebrating" —
   groups by ANY real `business_requests.occasion` value, including genuinely non-celebratory ones
   (a farewell, a move, a new job); the header read wrong the moment one of those appeared.
   Relabeled "🎉 What They're Planning" (the row copy beneath it, "N groups are planning a
   {noun}," was already neutral).

Migration `20261124_non_celebratory_occasion_copy_fixes.sql` (the three server-side fixes) applied
and verified live against production (`enmosvippabmuqslzrox`): direct spot-checks of
`_occasion_emoji`/`_occasion_noun` confirmed the correct icon/label for every previously-missing
value, including the corrected `milestone`/`achievement` mapping; a disposable rolled-back
transaction with real fixtures confirmed `create_plan_addon_request` now produces "Flowers for a
Moving" (was "Flowers for a moving celebration") and "Photographer for an Anniversary" (correct
article) — zero leaked rows afterward. Re-confirmed live: all three functions single-overload,
`create_plan_addon_request` and both helpers keep their pre-existing `authenticated` grant with no
`anon` leak (unchanged from before, since a plain `CREATE OR REPLACE` doesn't reset grants —
confirmed rather than assumed). Full Jest suite 538/538 passing (no new pure functions — this is a
copy/text-correctness pass); all three touched client files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that the reworded
Alert prompts, the "✨ Plan for {name}" button, and the "🎉 What They're Planning" dashboard header
all render correctly.

**Item 102 ("Businesses can participate in recurring occasions") — fully DONE (2026-09-17),
same-day direct follow-up to Item 101.** User's own example: a business could eventually see
"This customer celebrated here last year" and potentially offer "Welcome back — anniversary
package available" — "subject to privacy and appropriate consent."

Direct continuation of Item 101's `get_occasion_recall()` (the same real history read from the
OTHER side), gated behind a brand-new, separate, explicit consent — never inferred from the
reservation itself, and deliberately distinct from Item 69's existing post-acceptance
`requester_display_name` reveal (which is about ONE already-confirmed booking, not a durable,
recurring "recognize me next year" relationship). Shipped via
`20261123_business_recurring_occasion_recall.sql`:

(1) A new `occasions.recall_shareable_with_business` column (default false — same "share this
too, opt-in, default OFF" posture Item 62's own `connected_user_id` checkbox and Item 101's own
recall card already established) — the consumer's own explicit, per-occasion consent that the
SPECIFIC business they were last fulfilled through may recognize them as a returning customer
next time. Consent is scoped to whichever business the real history already points to — there is
no "which business" picker, since the whole point is recognizing a real relationship that already
exists, not broadcasting to arbitrary nearby businesses.

(2) `get_business_returning_occasion_customers(partner_id)` — a business-owner-only read (same
`profiles.managed_partner_id` ownership check every other business RPC in this schema uses) that
surfaces exactly the real customers who (a) explicitly consented, (b) have a real recurring
occasion, and (c) were genuinely fulfilled through THIS business via a real accepted/completed
`business_request_offers` row — never a prospective/declined one, never a different business's
customer. Bounded to a real, disclosed judgment call (next occurrence within 60 days) so the
dashboard reads as timely "reach out now" candidates, not a year-round list.
`send_business_recall_outreach()` is the real, rate-limited (once per occurrence, mirroring
`send_occasion_planning_nudges()`'s own once-per-year dedup shape) action a business can take on
one of these rows — a real push to the real returning customer, optionally naming one of the
business's own already-built Occasion Packages (Item 68) rather than inventing a second offer-
content mechanism. `get_occasion_recall()` (Item 101, unchanged signature) now also returns the
consumer's own real consent state for the business it already resolved, so the client can render
a toggle without a second round trip.

What is deliberately NOT exposed to the business, even with consent: `who_for_name` — the
occasion may be FOR a third party the requester organized for (e.g. a spouse's own anniversary
dinner the requester themselves booked); the business needs to recognize the returning BOOKER,
never learn who the occasion's who-for is, per the same privacy-minimalism discipline Item 69's
original "the business gets only what it needs" rule already established.

Client: `HomeScreen.js`'s existing Item 101 business-recall card gained a real, unchecked-by-
default checkbox ("Let {partner} recognize you as a returning customer next time") right below
the Return/Try Something New actions, wired to the new `setOccasionRecallShareable()`
(`occasions.js`, plain owner-scoped update, same posture as `setOccasionReminderEnabled`).
`OccasionsScreen.js` gained the same consent as a durable 🏪/🚫 per-row toggle (shown only when an
occasion is genuinely recurring with real resulting-plan history — harmless, not a leak, if that
history turns out to be gathering-destined, since the business-side RPC only ever surfaces a real
business match regardless). `BusinessDashboardScreen.js` gained a new "🎉 Returning Customers"
section (via `getBusinessReturningOccasionCustomers()`/`sendBusinessRecallOutreach()`, both new in
`occasionPackages.js`) — each real consented customer shows occasion/name/last-visit price/next
occurrence, with a "👋 Welcome Them Back" expand-in-place action (Progressive Depth doctrine) that
optionally lets the owner pick one of their own matching, active Occasion Packages before sending
— honestly labeled "✓ Already reached out" once the rate limit has fired this year, never allowed
to re-fire silently. A new push type, `business_recall_outreach`, routes
(`notifications.js`) to the same real `MakeAPlanScreen(partnerId)` orchestration Item 101's own
"Return to {partner}" action already uses — no new screen needed.

Verified live against production (`enmosvippabmuqslzrox`) via a comprehensive disposable rolled-
back transaction with real fixtures (a consumer, a real business owner, a stranger business
owner, a real accepted offer, an active Occasion Package) and real `SET ROLE authenticated` +
`request.jwt.claims` impersonation: the real owner correctly sees the consented, recurring,
genuinely-fulfilled-through-their-business customer with the correct next-occurrence date and
last price; a stranger business sees nothing; toggling consent off correctly hides the row and
back on correctly restores it; `send_business_recall_outreach` correctly succeeds (queued push
body confirmed via `net.http_request_queue`: "Welcome back -- ask about our Anniversary Package."
with `type=business_recall_outreach`) and sets the rate-limit marker; a same-year re-send is
correctly rejected; a different (stranger) business is correctly rejected for lacking real
fulfillment history with that occasion; `get_occasion_recall` correctly returns the new consent
field. Rolled back with zero leaked rows confirmed. Re-confirmed live after the real apply: both
new functions have exactly one overload each with the correct `authenticated`-only grant (no
`anon` leak), and `get_occasion_recall` stayed single-overload after its `CREATE OR REPLACE`. Full
Jest suite 538/538 passing (no new pure functions — this is DB/RLS-plus-UI wiring, same shape as
Item 90); all six touched/new files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm on a real account that the consent checkbox renders
and persists correctly on both Home's recall card and `OccasionsScreen`'s per-row toggle, that the
"🎉 Returning Customers" section and its package-picker expand-in-place panel render and send
correctly on the business dashboard, and that a tapped `business_recall_outreach` push lands on
`MakeAPlanScreen` prefilled with the right business and title.

**Item 101 ("Occasions can become recurring") — fully DONE (2026-09-17), resumed cleanly after a
codespace restart mid-build (a complete migration plus matching client edits were found already
written and uncommitted at session start — read in full, checked against the user's own example,
confirmed correct, then verified live and shipped).** User's own example: after the first year, an
anniversary nudge shouldn't just repeat "your anniversary is coming up" — Nearby should remember
what was chosen, where, what was liked, approximate budget, and preferred time, then offer a real
"Want to return to last year's restaurant or try something new?" choice — "that's excellent
retention."

The recurrence and "already planned this occurrence" tracking already existed
(`occasions.recurs_annually`/`resulting_plan_id`/`last_planned_at`, "Occasion architecture should
not be a silo," 2026-09-12) — what was missing was using that real history for anything beyond a
skip check. Two real pieces, both reading data this schema already honestly captures, never
fabricating a memory the app doesn't actually have, shipped via
`20261121_occasion_recurring_recall.sql`:

(1) A new owner-only `get_occasion_recall(occasion_id)` resolves an occasion's own
`resulting_plan_id` → `plans` → the real accepted/completed `business_request_offers` row → its
`brand_partners` row (where you went, what you paid, what time) → its `business_offer_outcomes`
row if one was ever submitted (what you liked — `satisfaction_rating`/`would_repeat`, already a
real, existing consumer feedback mechanism from "The Plan Engine" Phase 4, never a new rating
system). Returns null, honestly, whenever any link in that chain isn't real (no resulting plan
yet, the plan produced a gathering with no business attached, the business request never reached
a real accepted offer) — a recall card can never be fabricated from a partial chain. A
gathering-destined plan gets its own honest fallback shape (title/category only — there's no
single "business to return to").

(2) `send_occasion_planning_nudges()` (unchanged signature) now names the real business in the
push body itself ("...is in 14 days. Want to return to {partner} or try something new?") whenever
a real accepted-offer recall resolves for that occasion, falling back to the exact original
generic text for a first-year occasion or one that only ever produced a gathering. The push
payload carries a new `has_recall` boolean so the client can route a recall-aware tap differently
without an extra round trip.

**A real, live bug was caught and fixed during verification, not hypothetical**:
`get_occasion_recall()`'s first draft used plain `record IS NOT NULL`/`IS NULL` checks to test
"was a row found" — but a Postgres `record`'s `IS [NOT] NULL` uses SQL row-comparison semantics
(true only when EVERY field is null, or EVERY field is non-null), not "was a row found" semantics.
A real, fully-resolved accepted offer with an ordinary null nullable column (`expires_at`,
`offer_type` — the common case, not the exception) silently made `v_offer IS NOT NULL` evaluate
false, so the function always returned null even for a genuinely complete recall chain — caught
live via a disposable rolled-back transaction with real fixtures before this was ever treated as
working. Fixed by testing each record's own always-populated `id` column instead.

Client: `getOccasionRecall()` (`occasions.js`) wraps the RPC, best-effort (null on any failure,
never blocks). `HomeScreen.js`'s existing occasion-nudge card now fetches a recall only when the
occasion has genuine prior-year history (`resulting_plan_id` + `last_planned_at` both real — a
first-time occasion never triggers the extra round trip), and when a real business recall
resolves, renders a distinct card: "Nearby remembers: {business} · {price} · {time}" plus an
honest "You loved it last time!"/"You liked it last time." line (new pure
`formatOccasionRecallSummary()`/`occasionRecallLikedText()` in `occasionRecall.js`, 7 new Jest
tests — every part honestly omitted, never guessed, when the underlying field is null; a
neutral/negative/missing rating renders no liked-it line at all) with two real actions: "🔄 Return
to {partner}" (navigates to the existing `MakeAPlanScreen` in its `partnerId` mode — already
exactly "a real plan at that exact business," no new creation primitive needed — carrying the
occasion's own real title through as the one deliberate exception to that screen's normal
"never prefill the title" rule, since it's genuine user-authored history, not an invention) and
"✨ Try Something New" (lands on the existing Occasion wizard pre-seeded with the real occasion/
who-for, so `resolveIntent()`'s own live options step runs a fresh search rather than reusing last
year's business unconditionally — Item 100's `whoForPreferenceBonus()` still gently favors what's
already known to fit, never excludes anything else). A first-year or gathering-destined occasion
keeps the exact original nudge card unchanged. `notifications.js`'s `occasion_upcoming` tap
routing now checks the new `has_recall` push field first and lands on Home (the real "Plan Again"
surface with both real choices) instead of straight into the wizard, since the wizard itself has
neither the recall detail nor the return-vs-new choice.

Verified live against production (`enmosvippabmuqslzrox`): `get_occasion_recall` present with the
correct single-arg signature and correctly scoped to `authenticated` only (no `anon` leak);
`send_occasion_planning_nudges` confirmed to contain the new recall-lookup logic. Full Jest suite
538/538 passing (7 new); all five touched/new files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm on a real account that a recurring occasion with real
fulfillment history renders the recall card correctly, that "Return to {partner}" lands on
`MakeAPlanScreen` prefilled with the right partner and title, and that a tapped recall-aware
`occasion_upcoming` push lands on Home rather than the wizard.

**Item 100 ("Let the recipient contribute preferences without spoiling the surprise") — fully
DONE (2026-09-17), same-day direct override of the "logged as future, not now" call made earlier
in this session, resumed cleanly after a codespace restart (a complete, uncommitted migration was
found on disk at session start — read in full, checked against the user's own two-example spec,
confirmed correct, verified live before being applied for real, then followed by all the client
wiring, which had not been started).** User's own example: planning a wife's anniversary, Nearby
could already know her saved preferences (Italian / outdoor seating / live music) without telling
her anything is being planned, or — "if appropriate" — the organizer could ask her directly ("What
kind of dinner are you in the mood for?") without exposing why.

Two real, separate halves, matching the item's own two examples, both shipped via
`20261120_who_for_preference_signals.sql`:

**(A) Passive** — two new real, optional, self-declared columns, `profiles.cuisine_preferences`/
`venue_preferences` (same posture as the already-existing `profiles.interests`, CHECK-constrained
to the exact same `CUISINE_OPTIONS`/`BUSINESS_ATTRIBUTE_OPTIONS` vocabulary
`business_requests.cuisine`/`attributes` already use — no new taxonomy invented). No new RPC
needed to read or write them — profiles' own existing "Users can update own profile" RLS policy
already covers a plain direct update, the identical mechanism `interests` already uses. Reading a
connected friend's own already-visible profile data for scoring purposes is not a new access
grant — it's the same row `ViewProfileScreen` already reads for a friend.

**(B) Active, "if appropriate"** — a real, disguised quick-question poll, `preference_polls`
(RLS-enabled, zero client policies, every access through a SECURITY DEFINER RPC). The organizer
sends ONE of exactly two fixed, neutral questions (never free text, which could itself leak what's
being planned) to a real connected friend/match via `send_preference_poll` — the same "real
connections only" eligibility check this schema's other friend-facing RPCs already use, one
pending question per (asker, target) pair at a time (a plain, honest rate limit against
accidentally spamming someone with several "quick questions" that would themselves become a
tell), and a deliberately plain, unremarkable push ("💬 Quick question — {asker} wants to know:
{question}") with zero occasion reference of any kind. The recipient answers via
`answer_preference_poll`. **The privacy boundary is structural, not a client choice**:
`get_my_pending_preference_polls` (the only read a target-facing client ever calls) never selects
`occasion_context` at all — it isn't in that function's own column list, so there's no field to
accidentally leak. `occasion_context` (a free-text note, e.g. "Sarah's anniversary dinner," for
the ASKER's own private reference) and the real `answer_keys` are only ever both returned together
by `get_my_asked_preference_polls`, callable only by the asker about their own sent polls.

Both halves feed one real scoring signal, never two competing ones: `getWhoForPreferenceSignals()`
(`preferencePolls.js`) merges a person's own standing declared preferences with any real,
already-answered poll for them (fresher/more specific, so merged in rather than treated as a
competing source) into one `{cuisineKeys, venueKeys}` shape, best-effort (degrades to an empty
signal on any failure — this personalizes ranking, it never gates it). A new
`whoForPreferenceBonus()` (`intentResolverScoring.js`) scores it in `resolveBusinessAvailability()`
— same "real signal, flat bonus, never a filter" shape every other bonus in that file already
uses, distinct from every existing bonus there (all of which score the CALLER's own preferences,
never a third party's). `resolveIntent()` gained new optional `whoForFriendId`/`whoForName`
params, threaded through from the two real places an occasion's own who-for person is already
known: `CelebrateSomethingScreen.js`'s solo "options" step and `GroupOccasionPlanScreen.js`'s
group-vote business-options proposal (safe unconditionally, including under surprise mode, since
this only ever reads the who-for person's own already-visible data and never notifies or reveals
anything to them). `getBusinessAvailabilityReasons()` gained matching real "why" text ("Sarah
tends to like Italian" / "Matches Sarah's taste"), never naming which of the two sources it came
from — a saved preference and an answered disguised question look identical from there on, and
neither ever says WHY it's asking.

Client: `ProfileScreen.js` gained a real, optional "Dining & Venue Preferences" editable chip
section (same toggleable-chip shape as the existing Interests editor), writing straight to the two
new profile columns. `CelebrateSomethingScreen.js`'s who_for step gained a "💬 Ask {name} a quick
question" expand-in-place panel (Progressive Depth doctrine — no new screen) shown once a real
connected friend is picked as who-for; each of the 2 fixed questions is a tappable chip that sends
`send_preference_poll`, with an already-asked question honestly shown as "⏳ waiting for a reply"
rather than allowed to hit the server's own duplicate-pending rejection. A new `PreferencePollScreen.js`
(registered as a modal route, `PreferencePolls`) is the real target-facing surface — lists every
real pending question with a plain chip-picker answer flow, reachable both via a new
`preference_poll_received` push-tap route (`notifications.js`) and via a real, un-dismissible
"💬 Someone you know has a quick question for you" card on `HomeScreen.js` (per this file's own
"no dead ends" convention — a missed/dismissed push must never be the only way to find a pending
question).

Verified live against production (`enmosvippabmuqslzrox`) via a disposable rolled-back transaction
with real fixtures (two real accepted friends, a stranger) before applying the migration for real:
valid cuisine/venue preference writes persist correctly and an invalid value is correctly rejected
by the CHECK constraint; `send_preference_poll` succeeds for a real connection and correctly
rejects both a stranger ("You can only ask a real connection") and a duplicate pending question;
`get_my_pending_preference_polls` returns exactly the real pending poll with `occasion_context`
structurally absent from the payload; `answer_preference_poll` correctly records a real answer;
`get_my_asked_preference_polls` correctly returns the full detail (occasion_context + answers) to
the asker only, and correctly returns zero rows for someone who never asked anyone. Rolled back
with zero leaked rows confirmed. Re-confirmed live after the real apply: both new profile columns
present, `preference_polls` present with RLS enabled, and all four new functions
(`send_preference_poll`/`answer_preference_poll`/`get_my_pending_preference_polls`/
`get_my_asked_preference_polls`) have exactly one overload each with the correct `authenticated`-
only grant (no `anon` leak). Full Jest suite 531/531 passing (10 new: `whoForPreferenceBonus`, the
new who-for reason-text case, and `preferencePollQuestions.js`'s own vocabulary tests); all eleven
touched/new files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised
in a running app (no simulator/device tooling this session, standing note) — next session should
confirm on a real account that the Dining & Venue Preferences chips render and save correctly on
Profile, that "💬 Ask {name} a quick question" sends correctly and shows the waiting state on a
re-ask, that a tapped `preference_poll_received` push (or the Home card) lands on
`PreferencePollScreen` with the real pending question, and that a real answered/declared
preference genuinely nudges the "Nearby found these options" results in `CelebrateSomethingScreen`.

**Item 99 ("Let Nearby recommend when to celebrate") — fully DONE (2026-09-17), same-day direct
override of the "logged as future, not now" call made earlier in this session.** User's own
example: "If the birthday is Wednesday but most invited people are unavailable: Saturday has the
most availability among your guests. Then: Plan for Saturday?" — calendar availability, social
planning, and recommendation intelligence starting to come together. First logged to the Backlog
as an explicit future idea (the user's own words, "Again, future — not necessarily Thursday"),
then the user directly said "no build it now," overriding that call.

The honest scope boundary that shaped the design: "calendar availability" can't literally mean
reading each INVITEE's own device calendar — Item 75's calendar read access is permission-scoped
to the caller's own device and is never uploaded to Nearby's servers at all (Item 76's own locked
"Calendar = when, Nearby = what+who+where+how" boundary), and no mechanism anywhere in this schema
lets a host read a guest's calendar. Built instead as a real, honest AVAILABILITY POLL among the
plan's own already-real, already-connected guest roster (`occasion_group_plan_participants`) —
non-fabricated data (a person explicitly marks which candidate day(s) work for them), with the
"recommendation" being the plainest possible honest computation: whichever candidate date has the
most real "I'm free" marks, computed server-side, never AI-guessed.

Shipped via `20261118_occasion_group_plan_date_recommendation.sql`: two new tables,
`occasion_group_plan_date_options` (real candidate dates) and
`occasion_group_plan_date_availability` (a plain insert/delete toggle, the exact same shape
`occasion_group_plan_votes` already uses for vote/un-vote) — deliberately NOT reusing the existing
`occasion_group_plan_options`/`_votes` WHAT-to-do voting mechanism, since those feed
`decide_occasion_group_plan`'s activity-type branching directly and a "vote" there means "I
prefer this," not "I am free this day"; a separate pair of tables makes the wrong states
structurally unrepresentable instead of needing extra guardrails bolted onto the existing one.
`create_occasion_group_plan` (unchanged 11-arg signature, safe `CREATE OR REPLACE`) now
auto-seeds the occasion's own already-known `scheduled_date` as candidate #1 — the literal "if the
birthday is Wednesday" starting point, never fabricated since it's exactly what the host already
typed into the same call. New RPCs: `propose_occasion_group_plan_dates` (host-only, caps at 6
total candidates, mirrors `propose_occasion_business_options`' own host-only capped-slot shape),
`mark_occasion_date_availability` (any joined participant, toggle), `set_occasion_group_plan_date`
(host-only — the real "Plan for Saturday?" action: updates the plan's own `scheduled_date`,
notifies every other joined participant with a real push, never silently decides on the group's
behalf). `get_occasion_group_plan_detail` (unchanged signature, safe `CREATE OR REPLACE`) now also
returns `dateOptions` (each with a real `availableCount`/`myAvailable`) and flags whichever one
currently has the most real marks as `isTopRecommendation` — but only once at least one real mark
exists anywhere, so an unanswered poll can never fabricate a recommendation out of a 0-0 tie.

Client: `GroupOccasionPlanScreen.js` gained a "📅 When Works Best?" section (visible whenever the
plan isn't cancelled/fulfilled) — each candidate date shows its real free-count, a joined
participant's own "I'm free" toggle, and a host-only "Use →" link; the top real recommendation
(when one exists and differs from the plan's current `scheduledDate`) gets its own highlighted
banner with the item's own literal "{date} has the most availability among your guests... Plan
for {date}?" copy and button; a host-only "+ Propose Dates" expand-in-place panel (same
Progressive Depth doctrine as the screen's existing "Invite More Guests" panel) uses a real native
date picker, never AI-inferred. A new push type, `occasion_group_plan_date_set`, routes to the
same real `GroupOccasionPlanScreen` every sibling push in this family already uses.

Verified live against production (`enmosvippabmuqslzrox`) via a comprehensive disposable
rolled-back transaction with real fixtures (a host, two real accepted friends, a stranger) and
real `SET ROLE authenticated` + `request.jwt.claims` impersonation: the occasion's known date is
correctly auto-seeded as a candidate; the host successfully proposes an additional candidate date
while a non-host is correctly rejected; both friends join and mark a specific date available; a
stranger is correctly rejected both from marking availability and from reading the plan detail at
all; `get_occasion_group_plan_detail` correctly computes the top recommendation (2 marks vs. 0)
and correctly flags NO recommendation at all on a freshly created plan with zero marks anywhere
(the fabrication guard); a null date is correctly rejected by `set_occasion_group_plan_date`; a
real apply correctly updates `scheduled_date` and queues exactly 2 pushes (to the two other joined
participants, explicitly excluding the acting host) inspected directly in `net.http_request_queue`.
Rolled back with zero leaked rows confirmed. Re-confirmed live after the real apply: both new
tables present, and all five touched/new functions (`create_occasion_group_plan`,
`get_occasion_group_plan_detail`, `propose_occasion_group_plan_dates`,
`mark_occasion_date_availability`, `set_occasion_group_plan_date`) have exactly one overload each
— no signature drift. Full Jest suite 521/521 passing (no new pure functions — this is DB/RLS-plus-
UI wiring); all four touched/new client files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm on a real account that the "📅 When Works Best?"
section renders correctly, that the recommendation banner appears and correctly applies the date
end to end, and that a tapped `occasion_group_plan_date_set` push correctly lands on the plan.

**Item 98 ("Don't require exact dates") — fully DONE (2026-09-17), resumed cleanly after a
codespace restart mid-build.** User's own framing: "Her birthday is sometime next month" is a
completely normal thing to know — the system should accommodate Exact date / Weekend / Around
this date / Flexible, especially useful when planning ahead.

Found at session start: `src/utils/occasionDatePrecision.js` (the pure precision helpers) and
`supabase/migrations/20261116_occasion_flexible_dates.sql` already written, uncommitted, and
already applied live in production (`enmosvippabmuqslzrox`, confirmed via a live column check) —
read in full, checked against the user's own 4-option spec, and found correct and complete;
nothing needed to be redone. No client code referenced any of it yet (confirmed via a repo-wide
grep for `date_precision`/`datePrecision`), so this session's work was entirely the client wiring.

Design (already locked by the pre-restart migration): `occasions.occasion_date` stays a real,
non-null anchor date (needed for sorting/next-occurrence math), and a new `date_precision` column
(`exact`/`weekend`/`around`/`flexible`, CHECK-constrained) controls how that anchor is
INTERPRETED and DISPLAYED — never claims false precision. `normalizeOccasionDateForPrecision()`
rounds a `weekend` pick forward to that week's Saturday and a `flexible` pick to the 1st of the
month before saving; `formatOccasionDateForPrecision()` renders honest text ("Weekend of Sept
20" / "Around Sept 20" / "Sometime in September"). `get_upcoming_occasions()` returns the new
column; `send_occasion_planning_nudges()` fires precision-aware push copy (a `flexible` occasion
fires once, 5 days before its target month starts, with no fake day-count). That same migration
also fixed a real, pre-existing regression while it was already rewriting this function:
`reminder_enabled` (Item 62's per-occasion mute) had been silently dropped from this function's
`WHERE` clause by `20261102_occasion_aware_notifications.sql`'s own `CREATE OR REPLACE` — restored.

Client wiring shipped this session: `OccasionsScreen.js`'s manual "Add an occasion" form gained a
new "How well do you know the date?" 4-chip row (defaults to `exact`) right above the existing
native date picker, plus a live preview line ("Will show as \"...\"") so the user sees exactly how
their pick will be interpreted before saving; `handleAdd` now normalizes the picked date through
`normalizeOccasionDateForPrecision()` before it ever reaches `addOccasion()` (which gained a new
`datePrecision` param, defaulting to `'exact'` so every other existing caller — including the
device-calendar-import path, which always has a real exact date — is unaffected). The occasion
list itself now renders each row's real date through `formatOccasionDateForPrecision()` instead
of a plain month/day. `HomeScreen.js`'s occasion nudge card (previously always "is in N days," a
fabricated-precision bug for any fuzzy occasion) now uses a new `occasionDueLabel()` helper that
reads "is coming up weekend of Oct 17" / "is coming up around Oct 15" / "is coming up sometime in
Oct" for the three fuzzy cases, falling back to the original exact day-count phrasing otherwise
(the separate, always-exact `birthdayNudge` card — sourced from `profiles.birthdate` — was left
untouched, correctly). `ViewProfileScreen.js`'s "Upcoming" section (Item 87) now uses the same
precision-aware formatter instead of its own local `formatOccasionShortDate()`, which was removed
as now-redundant. Deliberately NOT touched: `CelebrateSomethingScreen.js`'s wizard "When?" step —
its own `WHEN_PRESETS` (Now/Tonight/Tomorrow/Pick a Date) are all real, near-term, always-exact
picks for planning an activity happening imminently, a genuinely different question from
"remembering a date I don't know exactly yet" (the migration's own header comment draws this same
line); a calendar-imported event also always has a real exact date. Both are correctly left at the
`addOccasion()` default of `'exact'`.

New Jest coverage: `occasionDatePrecision.test.js` (20 new tests covering every precision's
normalize/format/due-label behavior, including the pre-migration-row fallback when `date_precision`
is missing). Full suite 521/521 passing; all five touched/new files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Verified live against production via two disposable
rolled-back transactions: a real `'flexible'` insert round-trips correctly (`occasion_date`
rounded to the 1st, `date_precision` stored as given), and an invalid precision value is correctly
rejected by the CHECK constraint — zero leaked rows confirmed afterward in both cases. Not
exercised in a running app (no simulator/device tooling this session, standing note) — next
session should confirm on a real account that the 4-chip row and live preview render correctly,
that a `weekend`/`flexible` pick actually rounds as expected once saved, and that the Home nudge
card and profile "Upcoming" section both show the honest fuzzy-precision text rather than a fake
day count.

**Item 97 ("Add 'Invite without revealing the surprise'") — fully DONE (2026-09-16), same-day
direct follow-up to Item 96.** User's own example: for a surprise birthday, inviting John should
tell HIM "You're helping plan Sarah's birthday" while Sarah never learns anything at all.

Item 96 already made the second half structurally true (the celebrated person can never be
invited/organizer-promoted onto their own surprise plan). Auditing the actual invite-time push
text for the two real ways someone joins a business-request-destined plan
(`invite_to_business_request`, `add_plan_organizer`) found the first half was missing —
**regardless of surprise mode** — because both sourced their text from
`business_requests.raw_text`/`plans.title`, which is always the privacy-scrubbed, name-free text
Item 69 composes for the BUSINESS's own eyes. John got a generic "invited you to their Foodie
plan," never told it was for Sarah's birthday at all. `get_plan_chat_info`'s own returned `title`
(feeding Item 90's Plan summary card and Item 89's Plan Chat header) had the identical problem.

Fixed via `20261115_invite_reveals_occasion_context.sql`: widened
`_occasion_context_for_business_request` (Item 78) to also return the real linked occasion's
`title`, and wired it into all three surfaces — the two invite pushes now read "{host} invited you
to help plan {name}'s {occasion}" (falling back to the exact original generic text when no
occasion is linked), and `get_plan_chat_info` now returns that real title plus
`occasionType`/`whoForName` instead of the generic one. Safe unconditionally: the celebrated person
can never be a real participant of a surprise plan (Item 96), and none of these three functions is
ever reachable by the business side.

**A real, pre-existing vulnerability was caught and fixed in the same migration, not
hypothetical**: `_occasion_context_for_business_request` had been callable directly by
`authenticated` since Item 78 first created it — its own `revoke ... from public, anon` never
actually closed it off, because this Supabase project's `ALTER DEFAULT PRIVILEGES` auto-grants
EXECUTE to `authenticated` on every new function regardless (confirmed live via `pg_default_acl`),
unlike this codebase's sibling internal helpers (`_surprise_excluded_friend_id_for_business_request`,
`_notify_other_plan_participants`) which already explicitly revoke from `authenticated` too. Any
signed-in user could have called it with an arbitrary request id and learned a linked occasion's
real who-for name/title — including a surprise one — directly defeating Item 96's own privacy
design; now made worse-if-unfixed by this migration since the function also returns the full title.
Closed by adding the missing `authenticated` revoke, then reconfirmed live with a real
`SET ROLE authenticated` session: a direct call is now correctly rejected
(`insufficient_privilege`) while `get_plan_chat_info`/`invite_to_business_request`/
`add_plan_organizer` all still work correctly through their own SECURITY DEFINER call chains.

Client: `BusinessRequestDetailScreen.js` gained a persistent "🎂 You're helping plan Sarah's
Birthday" banner (sourced from `planChatInfo.occasionType`/`whoForName`, using the existing
`occasionIcon()`/`occasionLabel()` lookups) shown to any real non-requester plan participant — not
just a one-time push they could dismiss and forget.

Verified live against production (`enmosvippabmuqslzrox`) via disposable rolled-back transactions
with real fixtures (a host, a real friend "John," and a real friend "Sarah" who is the surprise's
who-for) and real `SET ROLE authenticated` + `request.jwt.claims` impersonation, inspecting the
actual queued push bodies in `net.http_request_queue`: the occasion-linked case produces exactly
"Allen invited you to help plan Sarah's birthday" / "Allen added you as a co-organizer to help plan
Sarah's birthday," Sarah is silently excluded from the invite the whole time (confirmed she never
appears as a participant and never receives a queued push); a separate non-occasion-linked fixture
confirms the fallback text is byte-identical to the original ("Allen invited you to their Coffee
plan"); the direct-call vulnerability was reproduced and then reconfirmed fixed as a genuine
`authenticated` session. Both transactions rolled back with zero leaked rows confirmed. Re-confirmed
live afterward: all four touched/new functions have exactly one overload each — no signature drift.
Full Jest suite 501/501 passing (no new pure functions — DB/RLS-plus-UI wiring); the touched client
file transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running
app (no simulator/device tooling this session, standing note) — next session should confirm on a
real account that the new banner renders correctly for an invited participant/co-organizer and
that the invite push reads the real occasion text on a real device.

**Item 96 ("Add surprise mode") — fully DONE (2026-09-16), same-day direct follow-up to Item 95.**
User's own list: 🎁 Surprise Mode / "Keep this plan hidden from Sarah" — then Sarah isn't
notified, organizers can coordinate, invitations can be discreet, business knows it's a surprise
if relevant, and "Eventually: Reveal plan becomes an action."

Audited the real current state first rather than assumed: Item 65 (2026-09-12) already built the
structural core of this — `occasions.surprise_mode`/`occasion_group_plans.surprise_mode`, a
function-level early-skip plus a BEFORE INSERT trigger backstop that make it genuinely impossible
to invite the celebrated person to vote, and a real 🔒 banner on `GroupOccasionPlanScreen` for
collaborators. Two concrete pieces from this item's own list were genuinely missing, found by
tracing every real invite/organizer code path rather than trusted from memory:

1. **"business knows it's a surprise if relevant"** — `business_requests` had no surprise concept
   at all. Added a plain `surprise_mode boolean` column — deliberately never `who_for_friend_id`,
   preserving Item 69's locked "businesses shouldn't need to know the person's identity" boundary
   intact: the business learns THAT it's a surprise, never WHO for.
2. **"invitations can be discreet" / "organizers can coordinate"** stopped being true the moment a
   decided group plan became a REAL `business_requests`-backed plan: Item 36's
   `invite_to_business_request` and Item 88's `add_plan_organizer` (both operate on the real
   resulting plan, not `occasion_group_plan_participants`) had zero surprise awareness — a host
   could accidentally re-invite, or even directly co-organizer-promote, the exact person the whole
   plan is hidden from, with no guardrail at all. Closed via a new internal helper,
   `_surprise_excluded_friend_id_for_business_request()`, which walks the real
   `plans.resulting_business_request_id` / `occasion_group_plans.resulting_plan_id` /
   `occasions.resulting_plan_id` linkage ("Occasion architecture should not be a silo") to find who
   (if anyone) must stay excluded — no new identity field duplicated onto `business_requests`
   itself. Since `plan_messages` access (`is_plan_participant`) is entirely derived from
   `group_plan_participants` + `plan_organizers`, protecting these two real INSERT paths
   transitively protects the group chat too — no separate fix needed there.

"Eventually: Reveal plan becomes an action" was genuinely unbuilt — no code anywhere referenced
"reveal." Two new RPCs, one per real surprise-mode source table: `reveal_occasion_group_plan()`
(host-only, mirroring decide/cancel's own single-decider authority) and `reveal_occasion()`
(owner-only). Both flip `surprise_mode` off, propagate that onto any resulting real
`business_requests` row(s) — primary and add-ons, via a shared
`_clear_surprise_on_resulting_business_requests()` helper — so the business-facing signal stays
honest, and, the part that makes this a real action rather than an inert flag flip, actually let
the previously-excluded person in: `reveal_occasion_group_plan()` inserts them as a real
`'invited'` participant (the same shape any other invite already produces) and sends them a real
push; `reveal_occasion()` sets `connected_user_id = who_for_friend_id` (now legal — the CHECK
constraint blocking that combination only fires while `surprise_mode` is still true), turning ON
the exact sharing mechanism Items 62/63 already built for "share this too" rather than inventing a
second one, plus the same kind of real reveal push.

Client: `create_business_request`'s new `surprise_mode_param` threaded through
`submitBusinessRequest()` and its two real occasion-sourced callers
(`submitSelectedBusinessRequests()` in `CelebrateSomethingScreen.js`, `handleBookWinningBusiness()`
in `GroupOccasionPlanScreen.js`); `AskBusinessScreen.js` gained a purely inherited (never a new
decision made on that screen) `surpriseMode` carried through the wizard's own "Skip — post
manually" escape hatch, shown as a plain recap line ("🎁 kept as a surprise"). Also closed a small,
real gap left by Item 95 the same day: that same escape hatch never carried `experienceLevel`
through at all — fixed alongside this. `BusinessDashboardScreen.js`'s "What they're looking for"
tag row gained a "🎁 Surprise!" chip (shown first, alongside the add-on tag, since it reframes how
the whole request should be read) sourced from the new `get_business_opportunities` field.
`GroupOccasionPlanScreen.js`'s existing 🔒 surprise banner gained a host-only "🎉 Reveal the
Surprise" link with a confirm `Alert`. `OccasionsScreen.js`'s personal occasion rows gained a 🔒
prefix and their own matching "🎉 Reveal the Surprise" link when `surprise_mode` is true. A new
push type, `occasion_surprise_revealed` (the solo case only — the group case reuses
`occasion_group_plan_invite`'s already-correct routing), routes to the revealing host's own
`ViewProfile` — Item 87's own "Upcoming" section is exactly where a newly-shared occasion becomes
visible to its recipient.

**Deliberately not built, disclosed rather than assumed covered**: `BusinessRequestDetailScreen.js`'s
own "Invite Someone"/"+ Add Co-Organizer" friend pickers don't pre-filter the excluded person
client-side — tapping them fails gracefully with a real server-side error (add_plan_organizer's
own clear message; invite_to_business_request's existing generic "none could be invited" message
for a single-person batch), but there's no purely-cosmetic client-side pre-filter the way
`GroupOccasionPlanScreen`'s own `inviteMoreCandidates` already has for the voting phase. The
server-side guarantee is authoritative either way — this is a UX-polish gap, not a privacy gap.

Verified live against production (`enmosvippabmuqslzrox`) via a comprehensive disposable
rolled-back transaction with real fixtures (a host, the celebrated friend, a real accepted friend,
a second real accepted friend) and real `SET ROLE authenticated` + `request.jwt.claims`
impersonation: `_surprise_excluded_friend_id_for_business_request` correctly resolves the
celebrated friend for both a primary request and its own add-on; `invite_to_business_request`
correctly silently skips the celebrated friend while still inviting a different real friend;
`add_plan_organizer` correctly rejects the celebrated friend with a clear surprise-specific error
while succeeding for a different real friend; `reveal_occasion_group_plan` correctly rejects a
non-host, succeeds for the real host, inserts the celebrated friend as a real `'invited'`
participant, and clears `surprise_mode` on both the primary and its add-on; a second reveal
attempt is correctly rejected ("isn't a surprise"); the exclusion helper correctly returns null
once revealed; `reveal_occasion` (the solo case) correctly sets `connected_user_id` and clears
`surprise_mode`. Rolled back with zero leaked rows confirmed. Re-confirmed live after the real
apply: `business_requests.surprise_mode` present; all eight touched/new functions
(`create_business_request`/`get_business_opportunities`/`invite_to_business_request`/
`add_plan_organizer`/`_surprise_excluded_friend_id_for_business_request`/
`_clear_surprise_on_resulting_business_requests`/`reveal_occasion_group_plan`/`reveal_occasion`)
have exactly one overload each — no signature drift; the two new internal helpers are correctly
revoked from `authenticated` (not just `public`/`anon`), matching Item 90's own "a mutating helper
left grantable to authenticated is a real vulnerability" lesson applied defensively here. Full
Jest suite 501/501 passing (no new pure functions — this is DB/RLS-plus-UI wiring); all nine
touched/new files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised
in a running app (no simulator/device tooling this session, standing note) — next session should
confirm on a real account that the "🎁 Surprise!" chip renders on the business dashboard, that
"🎉 Reveal the Surprise" works correctly from both `GroupOccasionPlanScreen` and `OccasionsScreen`,
and that a tapped `occasion_surprise_revealed` push correctly lands on the host's profile with the
newly-shared occasion visible under "Upcoming."

**Item 95 ("Ask 'How important is the occasion?'") — fully DONE (2026-09-16), resumed cleanly
after a codespace restart mid-build.** User's own spec: "What kind of experience are you looking
for? Keep it simple / Make it special / Go all out" — "a surprisingly useful recommendation
signal... a birthday dinner doesn't need the same recommendations as a 50th anniversary."

Found at session start: the pure client-side groundwork (`EXPERIENCE_LEVEL_OPTIONS`/
`experienceLevelLabel`/`experienceLevelToPriceLevel` in `celebrateSomething.js`, plus
`resolveDecidedGroupPlanParams` already carrying `initialExperienceLevel` forward, both with
their own new Jest tests) was already written and uncommitted before the restart — read in full,
confirmed correct, and kept as the foundation rather than redone. What was missing was everything
that makes it a real signal rather than an inert stub: the wizard question itself, DB persistence,
and the actual resolver lever.

Shipped via `20261113_occasion_experience_level.sql` (applied and verified live against
production `enmosvippabmuqslzrox` via disposable rolled-back transactions before applying for
real): two new nullable `experience_level text` columns (`business_requests`,
`occasion_group_plans`), both CHECK-constrained to `'simple'/'special'/'go_all_out'`.
`create_business_request` gained a new trailing `experience_level_param` (old 17-arg signature
explicitly dropped first, confirmed single overload live); `create_occasion_group_plan` likewise
(old 10-arg signature dropped). `get_occasion_group_plan_detail`/`decide_occasion_group_plan`
(unchanged signatures, safe `CREATE OR REPLACE`) now also return `experienceLevel`, and
`get_business_opportunities` now also returns it nested under `business_requests` — real context
for a business deciding how to respond (e.g. whether to reach for a Special/Go-All-Out structured
offer, Item 92), the same "surface it in the tag row" precedent Item 70's date chip and Item 81's
plan_time chip already established.

The literal "adjust recommendations" ask is a real, concrete lever, not just a stored field:
`experienceLevelToPriceLevel()` (already built pre-restart) feeds `resolveIntent()`'s own
already-existing `priceLevel` scoring bonus — `'go_all_out'` nudges toward pricier/more-curated
real candidates, `'special'` toward mid-tier, `'simple'` stays unbiased (a low-key ask isn't
necessarily a cheap one). Wired into both real places `resolveIntent()` gets called from an
occasion context: `CelebrateSomethingScreen.js`'s own 'options' step (the solo business path) and
`GroupOccasionPlanScreen.js`'s "Vote on Where" business-options proposal (the group-vote path) —
one lever, not two competing ones.

Client: a new "What kind of experience are you looking for?" 3-chip row (🙂/✨/🎆, defaulting to
`'special'`, the same "sensible middle ground, never forced" posture Item 94's budget default
already established) appears on `CelebrateSomethingScreen.js`'s 'when' step (shown only for a
business-destined activity type, since that's the one place the answer is actually used) and
again on the 'group_invite' step right next to the existing budget chips (mirroring that step's
own shape exactly, since a group vote doesn't yet know its eventual destination). Threaded through
`submitSelectedBusinessRequests()`, `createGroupVote()`, and `GroupOccasionPlanScreen.js`'s own
`handleBookWinningBusiness()` — every real path that creates a `business_requests` or
`occasion_group_plans` row from this wizard now carries the real answer. The 'options' step's own
staleness guard (which already force-refetches on occasion/activity/when/party-size changes) now
also covers `experienceLevel`, so going back and changing the answer correctly invalidates a
stale fetch. `AskBusinessScreen.js` (the standalone solo ask, not just the wizard) got the
identical chip row, solo-mode-gated the same way attributes/cuisine already are — feeds both
`submitBusinessRequest()`'s new `experienceLevel` param and the existing recap line (shown only
when it differs from the `'special'` default, so the common case stays quiet) — plus a new
`prefillExperienceLevel` route param so the "Try a Wider Radius" retry path preserves it, same
precedent every other prefilled field on that screen already follows.
`BusinessDashboardScreen.js`'s "What they're looking for" tag row gained a matching icon+label
chip, sourced from the same new `get_business_opportunities` field, no new query.

Deliberately NOT wired into `create_business_request_for_gathering`/`_for_match`/`_for_community`
(same disclosed "first increment" scope boundary Item 68's package-matching and Item 81's
plan_time additions already drew) or into `AskBusinessScreen.js`'s own "Find options nearby"
browse search (`search_active_business_availability` is a plain unscored list, not
`resolveIntent()`'s scored candidate pool — no lever to hook into there without a bigger,
separate RPC change).

Verified live against production via disposable rolled-back transactions covering every new
surface: valid values persist on both tables and both invalid-value rejections fire the expected
`'Invalid experience level'` error; `get_occasion_group_plan_detail` and
`decide_occasion_group_plan` both correctly return the real stored value; `get_business_opportunities`
correctly surfaces it to the business side of a real request/offer pair. Re-confirmed live
afterward: both columns present, and all five touched/new functions
(`create_business_request`/`create_occasion_group_plan`/`get_occasion_group_plan_detail`/
`decide_occasion_group_plan`/`get_business_opportunities`) have exactly one overload each — no
signature drift. Full Jest suite 501/501 passing (existing pre-restart tests for the pure helpers,
no new pure functions needed for this session's own DB/UI wiring); all seven touched/new client
files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running
app (no simulator/device tooling this session, standing note) — next session should confirm on a
real account that the 3-chip row renders correctly on both `CelebrateSomethingScreen`'s 'when'
step and `AskBusinessScreen`, that a `'go_all_out'` pick genuinely shifts the "Nearby found these
options" results toward pricier candidates, and that the business dashboard's tag row shows the
correct icon+label.

**Item 94 ("Add budget without making it feel transactional") — fully DONE (2026-09-16), same-day
direct follow-up to Item 93's per-person price field.** User's own literal spec: instead of forcing
a "$50–$100" range, ask "What's your budget? $ / $$ / $$$ / No preference," then optionally "Set a
maximum per person" — "keeps the initial interaction easy."

Audited the real current state first: two genuine surfaces already ask a consumer to state a
budget, and both were exactly the pattern this item complains about. (1) `BUDGET_RANGE_OPTIONS`
(Item 66, `CelebrateSomethingScreen.js`'s group-plan budget step) — a literal "$0–25 / $25–50 /
$50–100 / $100+" dollar-range chip row. (2) `AskBusinessScreen.js`'s solo "Budget max" field — worse
than (1): a bare required numeric `TextInput` with no qualitative option at all, gated by a locked
Aug 24 2026 "every rendered field is required" rule, meaning a user could not submit an ask to a
business without first typing an exact dollar figure.

Replaced both with one shared design in `celebrateSomething.js` — no DB migration needed anywhere
(`business_requests.budget_min`/`budget_max` are already plain nullable integers with no CHECK
requiring a non-null value; the qualitative tier key itself was never persisted, purely client
UI state, confirmed by reading every real call site before touching anything). New
`BUDGET_LEVEL_OPTIONS` (`any` "No preference" / `$` / `$$` / `$$$`) reuses the exact same `$`/`$$`/
`$$$` symbols this app's own `PRICE_LEVEL_LABELS` (gatherings.price_level, business_experiences.
price_level) already use for price tier elsewhere — one shared vocabulary, not a fourth copy that
could drift. Each tier is a real, honest representative per-person **ceiling only** ($25/$60/$150)
— deliberately no floor, since the item's own design is "set a maximum," never a range; every call
site now always sends `budgetMin: null`. New `resolveBudgetMax(rangeKey, override)` lets an
explicit numeric override always win over the tier's own ceiling — the "optionally: Set a maximum
per person" half of the spec, rendered as a collapsed "+ Set a maximum per person" link that
expands into a plain number field only on tap (progressive disclosure, never forced up front). New
`initialBudgetSelectionFromMax(max)` re-selects the matching tier when re-entering with an
already-saved value (e.g. a decided group plan's own agreed budget), or honestly treats a
non-matching number — including one saved under Item 66's old 4-bucket design — as a real custom
override rather than silently rounding it into the nearest tier.

**A real, disclosed, deliberate reversal of a previously locked design**: the Aug 24 2026 rule that
"every field genuinely rendered as an editable input [on AskBusinessScreen] is required" is no
longer true for budget specifically — the chip row always has a real, deterministic value selected
(defaults to "No preference," same reasoning the existing "When?" chip row already established),
so the old "you must type a number" validation block was removed outright; forcing precision here
would have directly contradicted this item's own "keeps the initial interaction easy." Every other
field on that screen (text/category/party size) keeps its original required-field behavior
untouched.

Client: `CelebrateSomethingScreen.js`'s group-plan budget step and `AskBusinessScreen.js`'s solo
budget field both now render the identical 4-chip row + optional override, sourced from the same
one `celebrateSomething.js` export set rather than two independently-maintained copies. Both
screens' submit paths, retry/prefill round-trips ("Try a Wider Radius," the "Skip — post manually"
hand-off to AskBusinessScreen), and recap-summary text were all updated to compute the real
resolved max through `resolveBudgetMax()` rather than reading a raw text field. `AskBusinessScreen`'s
now-unused `styles.row` (only ever used to lay "Party size"/"Budget max" side-by-side) was removed
rather than left dead, since budget is now a full-width block.

9 new Jest tests for `resolveBudgetMax`/`initialBudgetSelectionFromMax`/`BUDGET_LEVEL_OPTIONS`;
full suite 494/494 passing. All three touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. No DB migration — pure client-side, confirmed safe against the real schema
(both columns already nullable with no non-null constraint). Not exercised in a running app (no
simulator/device tooling this session, standing note) — next session should confirm on a real
account that the 4-chip row renders and defaults to "No preference" on both screens, that
`AskBusinessScreen` is now submittable with zero budget input at all, and that "+ Set a maximum per
person" correctly expands and its typed value wins over the selected tier.

**Item 93 ("Let the user ask multiple businesses simultaneously") — audited, already fully DONE,
no code change needed (2026-09-16).** User's own example: "Find me something for my mom's 60th
birthday" should fan out to appropriate businesses and come back as a real "Your Offers"
comparison list (Restaurant A $70/person, Activity B $45/person, Private venue C $90/person) the
user can compare.

Verified live against the current codebase (not assumed from memory) that this is exactly how the
request/offer engine already works, end to end, and has for a long time: `create_business_request`
→ `_business_request_fanout()` (`supabase/migrations/20261104_plan_addons.sql:236`) ranks every
real nearby eligible `brand_partners` row by attribute/cuisine fit, reputation, and distance, and
pushes "New opportunity nearby!" to up to 10 of them in one submission — a single ask genuinely
reaches several appropriate businesses at once, not one. Each business independently decides,
completely unaware of the others, whether to respond with a real, structured offer (Item 92's
named title + ✓ included-items checklist + price) or decline. `BusinessRequestDetailScreen.js`
already renders exactly the comparison view the item describes: once 2+ real `'offered'` rows
exist, a "🔍 Compare Your Options" header appears ("N businesses want to make this happen — ranked
by reliability"), and `displayOffers` (line 278) sorts those specific rows by each partner's own
real completion-rate reputation (Nearby V3/V4 Phase C) while every other offer status keeps its
plain chronological position. This is reachable from the exact scenario in the item's own
example — the Occasion wizard's "Custom Occasion" free-text path (Item 74) or its structured
birthday flow both terminate at `AskBusinessScreen`/`create_business_request`, which is this same
fan-out, unconditionally.

**Follow-up, same day, direct user request ("add the per person field follow up") — fully DONE
(2026-09-16).** Added the real field rather than fabricating a label: `business_request_offers.
price_is_per_person` (boolean, default false — every existing, already-written offer keeps meaning exactly
what it always meant, a flat number). `submit_business_offer` gained a new trailing
`price_is_per_person_param` (old 10-arg signature explicitly dropped first); `admin_review_
business_content_screening`'s offer_response branch reads the same boolean back out of its own
jsonb content snapshot; `get_business_opportunities` (RETURNS jsonb, safe plain CREATE OR REPLACE)
now also returns it.

**A real, live, previously-silent bug was found and fixed in the same migration, not
hypothetical**: `_match_request_to_package()` (Item 68) computes `offer_price` two different ways
depending on whether the request's own `party_size` is known — `price_per_person × party_size` (a
genuine total) when it is, but `price_per_person` completely UNCHANGED (a genuine per-person rate,
never multiplied) when `party_size` is null. Every auto-generated Occasion Package offer with an
unknown party size has therefore always stored a real per-person number under `offer_price` while
every consumer-facing screen rendered it exactly like a flat total — a real mislabeling, now fixed
at the source (both the preferred-binding block and the general scan loop correctly set
`price_is_per_person = true` only in that exact case) rather than papered over client-side.

Client: `formatOfferSummary()` (`businessFulfillment.js`, feeding `AcceptedBusinessOfferCard`,
`ActivityScreen`, and the dashboard's own "Upcoming Nearby Visits" card) and the two direct offer-
card renders (`BusinessRequestDetailScreen.js`'s "Compare Your Options" list, `GroupPlanScreen.js`)
all now append a real "/person" suffix only when `price_is_per_person` is true — never inferred.
`BusinessDashboardScreen.js`'s "Make an Offer" modal gained a Total/Per Person chip toggle next to
the price field (shown only once a price is entered); picking "🎁 Use your own package" (Item 92)
now also sets it to true automatically, since a package's own `price_per_person` is genuinely
per-person by definition.

Verified live against production (`enmosvippabmuqslzrox`) via a disposable rolled-back transaction
with real fixtures: `submit_business_offer` with `price_is_per_person_param: true` correctly
stores it; a package match with a known party size correctly produces a real multiplied total with
`price_is_per_person = false`; a package match with an unknown party size correctly leaves the raw
per-person rate in place with `price_is_per_person = true` (the exact bug case above); `get_
business_opportunities` correctly returns the field. Rolled back with zero leaked rows confirmed.
Re-confirmed live after the real apply: the new column present (boolean, default false); all four
touched/new functions (`_match_request_to_package`, `submit_business_offer`, `admin_review_
business_content_screening`, `get_business_opportunities`) have exactly one overload each; `submit_
business_offer`'s new 11-arg signature keeps the correct `authenticated`-only grant, no `anon`
leak. `screen-business-content` Edge Function updated (parses/forwards `priceIsPerPerson`, folds it
into the write-path RPC call and the moderation content snapshot — never into the moderated text
itself, since it's a real boolean, not user-authored prose) and redeployed, confirmed live via the
decoded deployed bundle. Full Jest suite 485/485 passing (no new pure functions — this is DB-plus-
UI wiring over an already-tested display helper); all six touched/new files transform-checked
clean via `@babel/core` + `babel-preset-expo`; the Edge Function's TypeScript syntax-checked clean
via `esbuild`. Not exercised in a running app (no simulator/device tooling this session, standing
note) — next session should confirm on a real account that the Total/Per Person toggle renders and
saves correctly, and that a real per-person-flagged offer shows the "/person" suffix on the
consumer's own comparison card.

**Item 92 ("Businesses should be able to respond specifically to the occasion") — fully DONE
(2026-09-16), same-day direct follow-up to Item 91.** User's own mock: a birthday request (🎂 10
guests / Sat 7 PM / $75pp / outdoor seating preferred) gets back a real "Special Birthday Offer —
$65/person / ✓ Private table / ✓ Birthday dessert / ✓ Complimentary champagne alternative / ✓ 7:30
PM available / Accept Offer" — "much more compelling than a generic restaurant listing."

Audited the real gap first: `business_request_offers` had exactly one free-text field
(`offer_description`) to carry all of this — a business could type a whole paragraph, but the
consumer-facing card could only ever render it as undifferentiated prose, never a real headline +
checklist. The single biggest real lever turned out not to be the manual "Make an Offer" modal at
all: `_match_request_to_package()` (Item 68) already auto-generates a real `'offered'` row the
instant a request matches one of a business's own standing Occasion Packages, but concatenated the
package's name + description into one string and discarded its own real `included_items` entirely.
Shipped via `20261111_occasion_aware_offer_response.sql`: two new purely-additive columns on
`business_request_offers` (`offer_title text`, `included_items text[] not null default '{}'`);
`_match_request_to_package()` (both its preferred-binding block and general scan loop, unchanged
signature) now carries the package's own real `name`/`included_items` onto the auto-generated
offer — meaning every business that already built an Occasion Package gets the mock's exact
compelling structured offer for free, zero extra manual work per request. `submit_business_offer`
(new trailing `offer_title_param`/`included_items_param`, old 8-arg signature explicitly dropped)
lets a business manually add the same real structure to a hand-written response, trimming/
filtering blank items the same way `create_occasion_package` already does — one validation rule,
not two. `admin_review_business_content_screening`'s `offer_response` branch got the identical
treatment for the MEDIUM/UNCERTAIN admin-reviewed write path. **A real bug was caught and fixed
during live verification, not hypothetical**: the screening branch's first draft read
`included_items` straight off the jsonb array with no trim/blank-filter, letting a literal empty-
string item survive — caught by a disposable rolled-back transaction's own Test 4 before this was
ever applied, fixed to match `submit_business_offer`'s own filter exactly.

Client: `screen-business-content` (parses/validates `offerTitle`/`includedItems`, folds both into
the real moderation text so a business can't bypass screening by hiding disallowed text in a title
or item instead of the description, forwards both through every write path) redeployed and
confirmed live via the deployed bundle's own decoded source. `businessFulfillment.js`'s two
submit-offer wrappers thread the new fields through. `BusinessDashboardScreen.js`'s "Make an
Offer" modal gained a real offer-title field, a real included-items add-one-at-a-time checklist
editor (mirroring the Occasion Package section's own identical editor), a real, unconditional
(never entitlement-gated — it's the business's own owned data, not an AI suggestion) "🎁 Use your
own '{Package Name}' package" suggestion (new `findMatchingOccasionPackage()`,
`occasionPackageFormatting.js`, prefers the most specific real match when several packages could
fit) that one-tap-fills title/description/price/items, and a lighter "✨ Use '{Special X Offer}'"
title suggestion (new `buildOccasionOfferTitle()`, distinct from the pre-existing
`buildOfferTitleScaffold()` which still seeds the description field) when no package matches —
both still fully editable, never auto-submitted. Picking an existing Signature Experience
suggestion now also seeds the new title field with that experience's own real title.
`BusinessRequestDetailScreen.js`'s offer card renders `offer_title` as a real bold headline
(distinct from the plain business-name line above it) and `included_items` as a real "✓ {item}"
checklist, in both the offered and accepted states.

Verified live against production (`enmosvippabmuqslzrox`) via a disposable rolled-back transaction
with real fixtures (a consumer, a bistro with an active Birthday Occasion Package, real
`SET ROLE authenticated` + `request.jwt.claims` impersonation for both the business-owner and
admin calls): the auto-matched package offer correctly carries the real title + included_items;
a party size below the package's own minimum correctly gets no structured offer at all; manual
`submit_business_offer` correctly trims the title and filters blank/whitespace-only included
items; the admin-review screening path correctly does the same from its own jsonb content
snapshot. Rolled back with zero leaked rows confirmed. Re-confirmed live after the real apply: both
new columns present, and all three touched/new functions (`_match_request_to_package`,
`submit_business_offer`, `admin_review_business_content_screening`) have exactly one overload each
— no signature drift. Full Jest suite 485/485 passing (9 new); all six touched/new client files
transform-checked clean via `@babel/core` + `babel-preset-expo`; the Edge Function redeployed and
confirmed live via its own decoded bundle source. Not exercised in a running app (no simulator/
device tooling this session, standing note) — next session should confirm on a real account that
the "🎁 Use your own package" suggestion renders and correctly prefills the modal, that a manually
typed title + checklist renders correctly as a headline + checkmarks on the consumer's own
`BusinessRequestDetail` screen, and that a real Occasion-Package-auto-matched offer shows the same
structured card with zero manual business action.

**Item 91 ("Add a 'Plan Status'") — fully DONE (2026-09-16), same-day direct follow-up to Item
90.** User's own progression: Planning → Awaiting Responses → Option Selected → Booking Pending →
Confirmed → Completed → Cancelled — "ties beautifully into your existing business-request state
machine." Replaced Item 90's original coarse Planning/Confirmed/Cancelled pill on the "Plan"
summary card with the full 7-value progression, derived entirely from real, already-fetched
columns (no new fetch, no new migration) — `getBusinessRequestWithOffers()`'s existing offers
query already embeds each offer's own `business_reservations(status, business_payments(status,...))`
row. New `resolveBusinessRequestPlanStatus()` (`planAddonReadiness.js`, exported alongside a new
`PLAN_LIFECYCLE_STATUS` enum) reuses the exact real sub-states the "Offer System Phase 1" migration
(`20260817_offer_system_phase1_reservation_payment_seams.sql`) already locked — "Offer → Offer
Accepted → Reservation Requested → Reservation Confirmed → Experience Confirmed" — rather than
inventing a second state machine: **Option Selected** = a business made a real offer
(`status='offered'`) now ready for the requester to review/accept; **Booking Pending** = an offer
was accepted but the booking isn't fully settled (reservation not yet `'confirmed'` — the seam a
future non-`'nearby'` provider like Resy/OpenTable would use — or reservation confirmed with a
real Stripe charge still `'pending'`, genuinely reachable today once a business finishes Stripe
Connect onboarding); **Confirmed** = reservation confirmed and payment resolved/not required;
**Completed** = an offer explicitly reached `'completed'` (`complete_business_reservation()`) OR
the plan's own real date has already passed while otherwise Confirmed (an honest "this already
happened" rather than reading "Confirmed" forever); **Cancelled** = the primary itself is
`cancelled`/`expired`, or — a real, non-obvious case — an accepted offer's own reservation ended
up `cancelled`/`failed`, which `cancel_business_reservation()` never reflects back onto
`business_requests.status` (that stays `'fulfilled'` forever), so this can only be caught by
reading the reservation directly, not the primary's own status. `buildPlanSummary()` now calls
this resolver instead of its old inline `isCancelled`/`isConfirmed` check. `BusinessRequestDetailScreen.js`'s
status pill gained two new visual tones (a warm-amber "in progress" treatment, reusing Item 84's
exact same tint, for Option Selected/Booking Pending; a muted/quiet tone for Completed) alongside
its existing Confirmed/Cancelled/neutral tones. 12 new Jest tests for the resolver plus one more
for `buildPlanSummary`'s Option Selected case; full suite 476/476 passing. Both touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Deliberately scoped to the
primary engagement only (matching Item 90's own scope) — an add-on's own state stays shown via
the existing per-add-on state chips in "🗺️ Your Plan," not this pill. Not exercised in a running
app (no simulator/device tooling this session, standing note) — next session should confirm on a
real account that a real offer-in-hand shows "Option Selected," that a Stripe-pending acceptance
shows "Booking Pending," and that a past-dated confirmed plan reads "Completed."

**Item 90 ("The 'Plan' itself becomes the source of truth") — fully DONE (2026-09-16), direct
follow-up to Items 88/89.** User's own example: once a plan is confirmed ("Sarah's Birthday 🎂 /
Sat Sep 19 / 7:00 PM / Restaurant / 8 people / Confirmed"), everyone should see the same
information — and if the time changes, the business cancels, or the host cancels, everyone gets
notified, "much cleaner than everyone having separate versions of the plan."

A background research fork audited the real current state first (reading every relevant function
live against production, not trusting past CLAUDE.md summaries): a business-request-destined
plan's info was genuinely scattered across `BusinessRequestDetailScreen.js` (raw_text/status/
per-offer cards/timeline, no single date-time-location-party-size-status block), and every one of
the 4 real "plan changed" events only reached a subset of the real roster (`plan_organizers` +
`group_plan_participants` via Item 88/36/Phase-D) — `submit_business_offer`/`accept_business_offer`
notified the original requester only; `set_plan_item_time` (Item 81's retime/relabel RPC) and
`decline_business_offer` sent literally zero notifications to anyone; `withdraw_business_offer`/
`cancel_business_reservation` notified only the direct counterparty; `cancel_business_request` sent
no notifications at all and was still hard-gated on literal `requester_id = auth.uid()`, contradicting
Item 88's own claim that "any organizer can manage any add-on" (never actually implemented there).

Shipped via `20261110_plan_source_of_truth_notifications.sql`: one new shared helper,
`_notify_other_plan_participants()` (built directly on the same roster logic `is_plan_participant`/
`get_plan_participants` already use — host, organizers, accepted group-plan guests — not a second,
possibly-drifting query), gated per-recipient on `notify_planning`, mirroring the existing
gathering-cancellation precedent (`notify_gathering_cancelled`/`cancel_community`, which already
fan out to every real attendee/member). Wired into `accept_business_offer` (the "Confirmed" moment
now reaches everyone, not just whoever tapped Accept), `decline_business_offer` (previously silent
— now notifies the requester too, a real pre-existing gap), `withdraw_business_offer`,
`cancel_business_reservation` (both the business-cancels and consumer-cancels branches),
`cancel_business_request` (widened so a primary plan stays host-only to cancel per Item 88's own
locked decision, while an add-on can now genuinely be managed by any real organizer — closing that
disclosed gap — plus the affected business is now notified of its vanished ask, previously silent),
and `set_plan_item_time` (a time/label change now notifies every other real participant). **A real
vulnerability was caught and fixed before this was considered done**: the new helper is a mutating,
side-effect function with no caller-identity check of its own (meant to be invoked only internally
by an already-authorized caller) — the first `revoke ... from public, anon` left the default
`authenticated` grant in place, which would have let any signed-in client call it directly to send
arbitrary push text to a real plan's participants; fixed to also revoke from `authenticated`,
mirroring `_cancel_reservation_by_offer`'s identical posture, and reconfirmed live.

Client: a new "Plan" summary card on `BusinessRequestDetailScreen.js` (primary's own screen only)
— title (the plan's own already-composed name, e.g. "Sarah's Birthday 🎂", sourced from the
already-fetched `planChatInfo.title` rather than a new query) / date+time / location (the accepted
offer's business name) / party size / a Planning-Confirmed-Cancelled status pill — computed by a
new pure `buildPlanSummary()` (`planAddonReadiness.js`, 6 new Jest tests) purely regrouping data
the screen already fetches, same "regroup what's already real" shape `buildPlanTimeline` already
established. New push types (`plan_confirmed`/`plan_cancelled`/`plan_addon_removed`/
`plan_item_time_changed`/`plan_reservation_cancelled`/`business_offer_declined`/
`business_request_cancelled`) routed in `notifications.js` to the same `BusinessRequestDetail`/
`BusinessDashboard` destinations their siblings already use.

Verified live against production (`enmosvippabmuqslzrox`) via two comprehensive disposable
rolled-back transactions with real fixtures (a host, a real `plan_organizers` co-organizer, a real
accepted `group_plan_participants` guest, a business owner, a stranger) and real
`SET ROLE authenticated` + `request.jwt.claims` impersonation, inspecting actual queued push rows
in `net.http_request_queue`: the fan-out helper correctly notifies organizer+guest while excluding
the acting user; `set_plan_item_time` now fans out where it previously sent nothing; a stranger is
correctly blocked from cancelling an add-on; a host correctly CAN cancel an add-on a co-organizer
created (closing Item 88's disclosed gap); a non-host organizer is correctly blocked from
cancelling the primary ("Only the host can cancel this plan"); the host cancelling the primary
correctly notifies the organizer+guest AND the business with a still-pending offer (previously
silent); `accept_business_offer` correctly fans out `plan_confirmed` to the organizer alongside its
existing pushes; `cancel_business_reservation` correctly fans out on both the business-cancels and
consumer-cancels branches. Both transactions rolled back with zero leaked rows confirmed
afterward. Re-confirmed live after the real apply: all 7 touched/new functions have exactly one
overload each, every pre-existing function kept its correct `authenticated` grant, and the new
helper's grant leak was caught and fixed (see above). Full Jest suite 461/461 passing (6 new); all
four touched files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised
in a running app (no simulator/device tooling this session, standing note) — next session should
confirm on a real account that the new "Plan" summary card renders correctly (title/date/time/
location/party size/status) on a primary request's own screen, and that a tapped
`plan_confirmed`/`plan_cancelled`/`plan_item_time_changed`/etc. push correctly lands on the right
screen for a co-organizer or accepted guest, not just the original requester.

**Item 89 ("Give the occasion a single shared conversation") — fully DONE (2026-09-13), same-day
direct follow-up to Item 88, resumed cleanly after a codespace restart (git was clean at session
start — Item 88 was the last commit; Item 89 had not been started, so this was a fresh build, not
a resume).** User's own framing: rather than Messages → individual chats → trying to coordinate,
the occasion itself should have a lightweight group conversation — "Sarah's Birthday 🎂 / 8 people
/ Plan / Chat / Guests / Business."

Audited the real current state before writing anything (a background research fork surveyed the
whole chat/occasion-plan stack first): a GATHERING-destined occasion (a party) already has exactly
this — `gathering_messages`/`GatheringChatScreen.js`, a real, already-shipped group chat for the
host and every approved attendee, reachable via "💬 Say Hello" once you're in. Building a second
one for that destination would be pure duplication, not a gap. The one genuine, concrete gap is
the OTHER real occasion destination: a business_request-destined plan (dinner/night out/activity)
— which, especially since Item 88's `plan_organizers` and Item 81's multi-request "Your Plan"
timeline, can now have a real host, co-organizers, and several invited people (via
`invite_to_business_request` or the older `propose_group_plan`/`confirm_group_plan` flow), all of
whom today could only coordinate via scattered 1:1 DMs. Item 89 was scoped to exactly that gap.

Shipped via `20261109_plan_group_chat.sql`: a new `plan_messages` table (plan_id/sender_id/body/
created_at) keyed on the already-unified `plans` object (Phase G) rather than a gathering- or
occasion-specific copy, so any future plan-type inherits the same mechanism for free. **One
deliberate posture choice, different from `plan_organizers`/`occasion_group_plans`' own "zero
client policies, RPC-only" convention**: Supabase Realtime's `postgres_changes` delivery evaluates
every change against the *subscribing client's own* RLS policies, not a service-role bypass — a
table with RLS enabled and zero policies can never deliver a live event to an ordinary
authenticated client, since RLS defaults to deny with nothing granted. A shared conversation's
whole value is messages arriving live while the screen is open, so `plan_messages` instead follows
`gathering_messages`/`community_messages`' own older, already-proven-live direct-policy shape:
real SELECT/INSERT policies gated by a new SECURITY DEFINER predicate, `is_plan_participant(plan_id,
user_id)` — host or organizer (reusing `is_plan_organizer`), OR a real accepted `group_plan_participants`
row tied to the plan's primary request. That last check had to cover **two different real
mechanisms** that can put a second person on a business-request-destined plan: Item 36's newer
`invite_to_business_request` (the primary request id stays the operative one forever, never
merged) and the older Phase D `propose_group_plan`/`confirm_group_plan` flow (confirming creates a
brand-new MERGED request and never updates `group_plan_participants.source_request_id` to point at
it) — resolved by also matching on the merged request's own `business_requests.group_plan_id`
column, found and added during live verification, not assumed correct on the first pass. Two more
RPCs: `get_plan_participants(plan_id)` (the real roster + host/organizer/guest role, for the
"👥 N people" header) and `get_plan_chat_info(business_request_id)` (the actual client entry point
— resolves a business_requests id the caller already has on screen, primary or any Item 81 add-on
via the same `coalesce(parent_request_id, id)` convention `get_plan_organizers` already
established, checks real participant access, and returns plan id + title + roster in one round
trip, since the client can never read the `plans` table directly for a plan it didn't create).
`plan_messages` was added to the `supabase_realtime` publication (same idempotent conditional-add
shape as the existing `20260815_v5_realtime_publication_fix.sql`).

Client: `src/services/planChat.js` mirrors `gatheringChat.js`'s exact 3-function shape
(`getPlanMessagesPage`/`getPlanMessageById`/`sendPlanMessage`, direct table queries now that RLS
allows it) plus the two new RPC wrappers. New `PlanChatScreen.js` mirrors `GatheringChatScreen.js`
closely (same `usePaginatedMessages`/`useChatComposer` hooks, same per-message realtime-INSERT-then-
rehydrate pattern, same inverted FlatList/photo-signing/report-block flow) minus its
gathering-specific extras (post story, suggest offers, out of scope here) — plus a "👥 N people ▼"
header that expands into a real host/organizer/guest roster. Registered as a new `PlanChat` route
in `RootNavigator.js`. Entry point: `BusinessRequestDetailScreen.js` gained a "💬 Group Chat (N)"
link, shown on both a primary's and an add-on's own screen (organizing/coordinating authority
already applies plan-wide either way, same reasoning Item 88's Organizers section already
established) — gated the same "presence is the render gate" way as `planOrganizerInfo`: a
best-effort `getPlanChatInfo(requestId)` fetch on load, silently null for anyone not a real
participant.

Verified live against production (`enmosvippabmuqslzrox`) via two disposable rolled-back
transactions covering both real mechanisms, with real fixtures and no shortcuts: (1) the
`invite_to_business_request` shape — host, an added co-organizer, an accepted guest, a
merely-invited-but-not-yet-accepted person, and a stranger — confirmed `is_plan_participant` is
true for the first three and false for the last two; confirmed `get_plan_chat_info` resolves both
the primary's own id and one of its add-ons to the identical plan with the correct 3-person roster;
confirmed RLS end-to-end via real `SET ROLE authenticated` + `request.jwt.claims` impersonation — an
accepted guest can send and read `plan_messages`, a stranger sees zero rows and is rejected on
insert, and the merely-invited-but-not-accepted person also correctly sees zero rows; (2) the older
`propose_group_plan`/`confirm_group_plan` merged-request shape — confirmed both the original host
and the original guest are still correctly recognized as participants on the plan behind the new
merged request even though neither of their `group_plan_participants.source_request_id` values was
ever updated to point at it, and a stranger is still correctly excluded. Both transactions rolled
back with zero leaked rows confirmed. Re-confirmed live after the real apply: both RLS policies
present, `plan_messages` in the `supabase_realtime` publication, and all three new functions
(`is_plan_participant`/`get_plan_participants`/`get_plan_chat_info`) have exactly one overload each
— including after a second `CREATE OR REPLACE` pass mid-session to add the merged-flow fallback,
re-confirmed with no signature drift.

No new pure functions were introduced (this is DB/RLS-plus-UI wiring, same shape as Item 88) — full
Jest suite 455/455 passing throughout; all four touched/new files (`planChat.js`, `PlanChatScreen.js`,
`BusinessRequestDetailScreen.js`, `RootNavigator.js`) transform-checked clean via `@babel/core` +
`babel-preset-expo`. **Deliberately NOT built, disclosed rather than assumed covered**: no push
notification for a new `plan_messages` row (matches the existing, already-shipped precedent for
`gathering_messages`/`community_messages` — live-while-open only, no push — a real fast-follow
candidate, not an oversight); no full Plan/Chat/Guests/Business tab-bar retrofit of
`BusinessRequestDetailScreen.js` (the mock's literal 4-tab layout) — its existing sections (🗺️ Your
Plan, 👥 Organizers, the offer list) already cover Plan/Guests/Business content vertically, and
retrofitting two large, already-complex screens into a segmented-tab layout is a materially bigger,
riskier UI rewrite than "give the occasion a chat" asks for; a gathering-destined occasion's chat
was left fully untouched since it already has its own, more mature equivalent. Not exercised in a
running app (no simulator/device tooling this session, standing note) — next session should
confirm on a real account that "💬 Group Chat (N)" renders correctly on both a primary and an
add-on's own screen, that the roster expand/collapse and message send/receive work end to end, and
—the one part of this item that most needs a second device to truly confirm — that a message sent
from one participant's device arrives live (via the real Postgres Realtime subscription) on
another participant's device without a manual refresh.

**Item 88 ("Let multiple people organize the same occasion") — fully DONE (2026-09-13), same-day
direct follow-up to Item 87.** User's own example: "Sarah's birthday could have Organizer: Allen,
Co-organizers: John + Emily. Everyone can help. One person might find the restaurant, another
invite people, another coordinate transportation, another handle decorations. You don't
necessarily need full task-management initially, but the architecture should support multiple
organizers."

Audited the real current state first: Item 66 ("Add collaborative planning") already built a real
co-organizer concept (`occasion_group_plan_participants.is_organizer`), but scoped to the VOTING
phase only — the moment a group plan is decided and a real `business_requests`/gathering is
created, that authority evaporated; only the one session that actually created the resulting row
could do anything with it from then on, even for the far more common path (a solo "Plan for
Someone" wizard submission with no group vote at all).

Shipped a real, generic, plan-type-agnostic organizer concept hung off the already-existing
unified `plans` object (Phase G) rather than a second, occasion-specific copy —
`20261108_plan_organizers.sql`: a new `plan_organizers` table (RLS-enabled, zero client policies,
every access through SECURITY DEFINER RPCs, same posture as `occasion_group_plans`), and
`is_plan_organizer(plan_id, user_id)` — one shared predicate (host via `plans.created_by`, OR a
real `plan_organizers` row) reused by every check below so "who can act on this plan" can never
drift into two different definitions. Deliberately bounded to what the item's own 4 examples need,
not full task-management: an organizer can view the plan, add/manage add-on business requests
(the real mechanism behind "coordinate transportation"/"handle decorations" — Item 81's plan-
timeline add-ons), invite people (Item 36), and retime/relabel plan items. Accepting a specific
business's offer, cancelling the plan, and adding/removing organizers all stay host-only — the
same "one real final decider" guardrail Item 66 already locked for the voting phase, now carried
through to the real resulting plan.

**Scoped to business_request-destined plans only** (the one destination with a real multi-request
"Plan" — add-ons — to actually share authority over) — a gathering-destined occasion (a party)
keeps its existing single-host model untouched, a real, disclosed follow-up, not silently assumed
covered by the generic table. `create_plan_addon_request`/`invite_to_business_request`/
`set_plan_item_time` (all unchanged signatures, safe `CREATE OR REPLACE`) now authorize via a new
`_can_manage_business_request()` helper (owner OR an organizer of the plan behind the row's
PRIMARY id — an add-on's own creator keeps their normal owner access too, and any organizer can
manage ANY add-on in the plan, not just their own). New RPCs: `get_plan_organizers`/
`add_plan_organizer`/`remove_plan_organizer` (all take a business_request id — the primary or any
of its add-ons — and resolve the plan behind it internally, so the client never needs to know
`plans.id`). `link_occasion_group_plan_to_plan` now also carries a decided group plan's own real
`is_organizer=true` participants forward onto the resulting real plan the moment it's linked — a
real integration point, not a parallel concept, so Item 66's voting-phase organizers don't lose
their authority the moment voting ends.

**A real bug was caught and fixed during live verification, not a hypothetical**: an RLS policy's
own `USING` expression runs as the *querying* role, not the table owner — so the first draft's
policies on `business_requests`/`business_request_offers`, which referenced `public.plans`
directly inside their `USING` clause, were themselves silently subject to `plans`' *own* RLS
("Users can view their own plans" — `created_by = auth.uid()` only), which a co-organizer always
fails since they aren't the plan's creator. Confirmed live: an inline `exists (select 1 from
plans...)` predicate evaluated false for a real, confirmed organizer, while the exact same logic
wrapped in a new SECURITY DEFINER function (`_is_organizer_of_primary_request`/
`_can_view_business_request_offers` — same reason `is_match_participant`/`is_group_plan_participant`
already exist as functions rather than inline policy subqueries) correctly evaluated true. Fixed
before ever being treated as done.

Client: `BusinessRequestDetailScreen.js` (shown on both a primary's and an add-on's own screen,
since organizing authority applies plan-wide either way) gained a "👥 Organizers" section — host +
co-organizers, a host-only "+ Add Co-Organizer" picker reusing the same real friend/match list
already loaded for "Invite Someone," and a host-only "Remove" per co-organizer. The pre-existing
"Invite Someone" eligibility gate and the add-on section's own `canAddAddons` flag were both
broadened from strictly `requester_id === me` to "me or any real organizer of this plan" — bundled
in was a real, disclosed pre-existing gap this fix closes for free: `canAddAddons` had no ownership
check at all before this (`request.status === 'open'` only), meaning the section was visibly
rendered for any viewer who could load the screen at all (a match participant, a gathering-
interest-approved attendee) even though only the true owner could ever succeed at the underlying
RPC — now it genuinely matches who can succeed.

Verified live against production (`enmosvippabmuqslzrox`) via a comprehensive disposable rolled-
back transaction (the full migration plus a real host/organizer/stranger fixture run together,
then rolled back) covering every boundary: a stranger is correctly blocked from adding an organizer
or creating an add-on; the host successfully adds a real friend as co-organizer (with a real push
queued, confirmed via `net.http_request_queue`'s decoded body); the new organizer can then view the
primary request and its offers via the new RLS policies, call `get_plan_organizers`, create a
Transportation add-on owned by themselves, and the host can retime that same add-on (shared
authority confirmed both directions); removing the organizer correctly revokes their RLS access
again; a decided group plan's own `is_organizer=true` participant is correctly carried onto the
real plan via `link_occasion_group_plan_to_plan`. Zero leaked rows confirmed afterward (the whole
fixture-plus-migration transaction was rolled back together). Re-confirmed live after the real
apply: all 11 new/changed functions have exactly one overload each (no signature drift), and both
tables' policy lists show the new organizer policies alongside every pre-existing one, untouched.

Full Jest suite 455/455 passing (no pure-function changes — this is DB/RLS-plus-UI wiring); all
three touched/new client files transform-checked clean via `@babel/core` + `babel-preset-expo`.
Not exercised in a running app (no simulator/device tooling this session, standing note) — next
session should confirm on a real account that the "👥 Organizers" section renders correctly for
both host and co-organizer, that "+ Add Co-Organizer" and "Remove" work end to end, and that a
tapped `plan_organizer_added` push correctly lands on the right `BusinessRequestDetail` screen.

**Item 87 ("Add 'Upcoming' to the person's profile") — fully DONE (2026-09-13), same-day direct
follow-up to Item 86.** User's own example: on a friend's profile, if I've saved a real occasion
for them, show "Upcoming / 🎂 Birthday · Sept 18" — but only if appropriate to privacy settings,
without turning profiles into a social timeline.

Shipped as a small new section on `ViewProfileScreen.js`, sourced from the already-existing
`get_upcoming_occasions()` RPC (`getUpcomingOccasions()`, `occasions.js`) rather than a new query
or table — fetched with a generous 365-day window (these are mostly annually-recurring occasions,
each already resolved to its real next occurrence server-side, so a short "act now" window like
Home's own nudge card uses would be the wrong shape for a standing profile fact) and filtered
client-side to `owner_id === me && who_for_friend_id === this profile`. That filter is the whole
privacy story, and it needs no new logic to be correct: `get_upcoming_occasions()` already returns
two structurally different kinds of row — ones I own, and ones merely *shared with me* about
myself (via `connected_user_id`) — and requiring `owner_id === me` excludes every row of the
second kind regardless of its `who_for_friend_id`, so this can never surface someone else's
private reminder, a surprise plan I'm not part of, or an occasion actually about me rendered as if
it were "about" a third person. What's left is by construction 100% my own already-private data
(RLS already scopes every row to its owner), just surfaced in a more useful, contextual place —
"only if appropriate to privacy settings" is satisfied structurally, not by an added runtime check.

Renders as a compact "Upcoming" label (reusing the same `sectionLabel` style Interests/Details/
Basics already use) plus one short line per real occasion — icon + label from the already-shared
`occasionIcon()`/`occasionLabel()` lookups (Item 84), a plain "month day" date (`Sept 18`, the same
inline-formatter convention several other screens already use for a compact date, e.g.
`MomentumScreen.js`) — never a list of every interaction, never anything beyond a real occasion
row I actually saved. Deliberately excluded from a person's OWN profile view of themselves (the
fetch only runs for `myId !== userId` at all) — this card is about occasions the VIEWER saved
about someone else, never a feed of what others have saved about you.

Full Jest suite 455/455 passing (no new pure functions — reuses `getUpcomingOccasions()`/
`occasionIcon()`/`occasionLabel()`, all already covered where they were first introduced; the new
`formatOccasionShortDate()` is a tiny inline formatter, same untested-local-helper precedent as
the many equivalent ones already in other screens). `ViewProfileScreen.js` transform-checked clean
via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device
tooling this session, standing note) — next session should confirm on a real account that a real
saved occasion for a friend renders correctly under "Upcoming" on their profile, that it's absent
when no such occasion exists, and that it never appears on a user's own profile view of themselves.

**Item 86 ("Let Nearby start from the person, not just the occasion") — fully DONE (2026-09-13),
same-day direct follow-up to Items 83-85 and "ok do it" above.** User's own example: on a friend's
profile, "Friends ✓ / Plan Something / Celebrate Claude" should open "What are you planning for
Claude? 🎂 Birthday / 🎉 Celebration / 🏆 Milestone / 🎁 Surprise / ✨ Something else" directly —
the relationship with the person becomes the starting point, not the occasion.

Shipped as a real entry point on `ViewProfileScreen.js`: a new "🎉 Celebrate {Name}" button, shown
for any real accepted friend (`friendshipStatus === 'accepted'`, checked independently of
`matchId` — this doesn't depend on the dating-match machinery at all, just a real friendship),
styled as the same outlined secondary treatment "Message" already uses in this state (Plan
Together/the dating-planning flow stays the screen's one coral primary action, per Item 37's
already-locked "coral = the one primary action" convention — this is an additional, not a
competing, primary). Navigates straight into the already-existing Occasion wizard
(`CelebrateSomething`) using the exact same `buildOccasionWhoForParams()` helper Item 64's
CreateHub who-for selector and every occasion push-deep-link already use — `whoFor: 'friend'`,
the real name and id, no new params shape invented. Deliberately passes no `initialOccasion` — the
whole point is that the person is already known and the occasion is the very next thing the user
picks, exactly matching the mock — so the wizard opens on its own real first step, Item 83's
already-shipped 5-tile quick-pick front door (Birthday/Anniversary/Celebration/Surprise/Custom;
kept as-is rather than relabeling to the mock's illustrative "Milestone"/"Something else" wording,
since these tiles are the one real, already-wired occasion vocabulary and "Milestone" already
exists as one of the 24 values reachable via "More occasions" — inventing a second, parallel label
set would be exactly the "category = X here, category = Y there" drift this repo's own locked "one
ontology" convention exists to prevent).

One small, genuine personalization closes the loop per the user's own framing ("intuitive" because
the relationship is already known): the occasion step's header, previously always the generic
"What are you planning?", now reads "What are you planning for {Name}?" whenever `whoForName` is
already real at that step — true for this new entry point, and for any other future entry that
pre-seeds who-for without pre-seeding an occasion, not a one-off special case. A real, previously
latent bug was found and fixed while touching `initialStepFor()` (the function that decides which
step a deep-linked entry lands on): its `hasOccasion && hasWhoFor` branch unconditionally returned
step index 2, but `occasion === 'other'` has its own 2-step `buildStepDefs()` (occasion,
custom_describe) with no who_for/activity/when steps at all — index 2 would have been out of
bounds. Not reachable before this item (no existing caller combined `initialOccasion: 'other'`
with `initialWhoFor`), but disclosed and fixed rather than left as a live trap, since a future
entry easily could.

Full Jest suite 455/455 passing (no new pure functions — this reuses `buildOccasionWhoForParams()`,
already covered by `createHubWhoFor.test.js`; the label change and the `initialStepFor` fix are
plain in-component render/routing logic, consistent with this screen's existing untested-helper
precedent). Both touched files transform-checked clean via `@babel/core` + `babel-preset-expo`.
Not exercised in a running app (no simulator/device tooling this session, standing note) — next
session should confirm on a real account that "🎉 Celebrate {Name}" renders correctly for an
accepted friend, that tapping it lands on the personalized "What are you planning for {Name}?"
occasion step with the friend chip already pre-selected once the who_for step is reached, and that
picking each of the 5 quick-pick tiles (including Surprise, which also needs the friend as
who_for to make sense of surprise_mode) proceeds correctly from there.

**"ok do it" (Who to invite -> Options for a business-destined Occasion) — fully DONE
(2026-09-13), same-day direct follow-up to Items 83-85.** Closed the one honest nuance flagged
when the user's own "Create -> Plan for Someone -> Occasion -> Who -> What -> When -> Who to
invite -> Options -> Business -> Plan" flow was checked against real code: for a business-destined
activity (dinner/night out/activity), "Who to invite" (the wizard's existing `who_involved` step)
used to be REPLACED by "Options," never shown before it. Now both render, in that order --
`buildStepDefs()` pushes `who_involved` then, only for the business destination, also `options`;
`goNext()`'s `who_involved` branch advances to the next step for a business destination instead of
jumping straight to `proceedToDestination()` (every other destination keeps its original
one-step-and-done behavior). The "Existing Group" chip is hidden for the business destination
specifically -- a business_requests row has no community concept to attach to, so offering it
would silently do nothing.

No new invite mechanism was built -- the real friend selection this step already collects
(`selectedInviteeIds`, already live for the gathering path since Item 71) now also carries forward
as `suggestedInviteeIds`/`suggestedInviteeLabel` onto the resulting request's own already-existing
"👤 Invite Someone" panel (Item 36) -- pre-checked and pre-expanded, sorted-to-top with a 🤝 badge
(same "✨ People you may want to invite" framing `GatheringConfirmationScreen` already established
for the gathering path, one convention instead of two), but still requires the same explicit "Send
Invite" tap it always did -- nothing is ever auto-invited. Threaded through both real ways a
business-destined plan can be submitted: the main "Ask These Businesses" path
(`submitSelectedBusinessRequests`, single-success case only -- a multi-business submit lands on
Plans with no one obvious request to attach a suggestion to, a disclosed boundary) and the
"Skip — I'll post a general request myself" escape hatch (`proceedToDestination`'s business
branch -> `AskBusinessScreen`, which now reads and forwards the same two params at its own submit
time). A real bug was caught and fixed before this was considered done: `BusinessRequestDetailScreen`'s
data-load function re-runs on every screen focus (`useFocusEffect`, this app's own established
pattern) -- without a guard, returning to this screen after unchecking a suggested invitee or
closing the panel would have silently re-applied the original suggestion and reopened it every
time. Fixed with a one-time-seed ref (`suggestionAppliedRef`) so the pre-selection only ever
applies once, never clobbering the user's own later edits.

Full Jest suite 455/455 passing (no pure-function changes — this is step-sequencing plus UI/route-
param wiring over already-tested services). All three touched files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that "Involve" really
does precede "Options" for a business-destined plan, that a real friend selected there shows up
pre-checked and 🤝-badged on the resulting request's "Invite Someone" panel, and that revisiting
that screen after manually changing the selection doesn't reset it.

**Items 84 & 85 ("make the UI feel emotionally different" / "keep the underlying architecture
unified") — fully DONE (2026-09-13), same-day direct follow-up to Item 83.** Paired ask: give the
Plan-for-Someone wizard real personality ("Sarah's 30th Birthday 🎂" vs. a plain gathering's
"Saturday Dinner") without becoming cheesy/cluttered (84), and do it by extending the already-
unified Occasion → Plan → People → Activity → Place/Business → Offer/Availability → Reservation →
Notifications pipeline rather than building a parallel "birthday system" (85, a restatement of the
already-locked architecture -- no new tables/RPCs/notification types were needed or added).

Shipped as two small, contained changes, both pure presentation-layer: (1)
`composeCelebrationTitle()` (celebrateSomething.js) now appends the occasion's own real icon
(new `occasionIcon()` export, businessAttributes.js, mirrors `occasionLabel()`) -- "Sarah's
Birthday 🎂," never a plain string. This is the one real title this wizard already produces, and
it already flows unmodified into every already-unified surface an occasion can become
(`gatherings.title` via `quickStartTitle`, `occasion_group_plans.title`, `occasions.title`) -- so
the personality travels everywhere for free with zero new screen-level code, exactly per Item 85's
own directive. A real, live-consumer bug this surfaced and fixed in the same pass:
`extractNameFromBirthdayTitle()` (parses a self-logged birthday occasion's title back out for
`notifications.js`'s `birthday_upcoming` push-tap routing) anchored its regex on the string
literally ending in "birthday" -- now strips a real trailing occasion icon first (looked up, not
hardcoded, so it can't drift) before matching; a title saved before this change (no icon suffix)
matches exactly as before. (2) The wizard's own occasion step onward now shows a small, warm-amber
(deliberately not `colors.primary`/coral, which this app's locked visual system reserves for
actionable buttons, not decoration) live preview banner of the real composed title -- appears the
moment an occasion is picked, refines live as who-for is answered, excluded for the Custom
Occasion path (occasion === 'other'), which has its own different, more open-ended framing.

Full Jest suite 455/455 passing (2 new: an unrecognized-occasion-key case for
`composeCelebrationTitle`, and an icon-stripping case for `extractNameFromBirthdayTitle`; 4
existing `composeCelebrationTitle` assertions updated for the new icon suffix). All four touched
files transform-checked clean via `@babel/core` + `babel-preset-expo`. No DB migration -- pure
client-side. Not exercised in a running app (no simulator/device tooling this session, standing
note) -- next session should confirm the amber preview banner renders correctly and updates live
as occasion/who-for change, and that a real device's birthday-reminder push still correctly
pre-fills the celebrated person's name when tapped.

**Item 83 ("Plan for Someone") — fully DONE (2026-09-13), same-day direct follow-up to Item 82
(which itself needed no new work — Item 81's two-transportation-legs case already covers the
ride-there/activity/ride-home orchestration it asked about).** User's own locked scope, given via
`AskUserQuestion` after an initial ambiguous pitch: keep Create at exactly 3 primary cards (no 4th
card), rename the existing "🎉 Occasion" card to "Plan for Someone" (label + subtitle only, same
`CelebrateSomething` destination) — "'Occasion' sounds like internal product terminology; 'Plan
for Someone' immediately communicates the action." Renamed everywhere user-visible:
`CreateHubScreen.js`'s primary card, `RootNavigator.js`'s nav title, and
`CelebrateSomethingScreen.js`'s in-body header. Internal identifiers (file name, `CelebrateSomething`
route key, `celebrateSomething.js`, the `occasion` state/column names) deliberately untouched —
same posture as Item 61's original rename.

Second locked piece: the wizard's own occasion step gained a real 5-tile quick-pick front door
(Birthday / Anniversary / Celebration / Surprise / Custom) in front of the existing 24-value
grouped picker, reached via a new "More occasions →" link — "simple front door, full capability
behind it... don't sacrifice the existing 24-value capability." 4 of the 5 tiles map directly onto
occasion keys the wizard already supported (birthday/anniversary/other); "Surprise" is a pseudo-tile
(no new vocabulary value) that sets `occasion='celebration'` and turns on Item 65's real
`surprise_mode`. The one real gap this surfaced: `'celebration'` was a long-standing legal
`business_requests.occasion` value but had never been added to `occasions.occasion_type` or
`occasion_group_plans.occasion_type`'s own CHECK constraints, nor to `OCCASION_GROUPS`
(`businessAttributes.js`) — so making it a first-class wizard tile would have broken the
"save to calendar" step and "Let the Group Vote" the moment a user picked it. Fixed via
`20261106_celebration_occasion_and_plan_for_someone.sql`: both CHECK constraints widened to add
`'celebration'`, `_occasion_emoji()`/`_occasion_noun()` (Item 78's shared push-copy helpers) gained
a `'celebration'` → 🎉/"Celebration" case, and `'celebration'` added to `OCCASION_GROUPS`'s
"Celebrations" group (businessAttributes.js) — which automatically makes it flow through
`CELEBRATE_OCCASION_KEYS`/`CALENDAR_SAVEABLE_OCCASION_KEYS`/`PERSONAL_OCCASION_TYPE_KEYS`
correctly with no special-casing needed. Every other occasion-vocabulary gate in the schema was
individually audited and confirmed to already accept `'celebration'` (business_requests/
brand_partners/business_partner_requests/business_occasion_packages and every function with its
own inline copy) — no other migration needed.

Verified live against production (`enmosvippabmuqslzrox`) via a disposable rolled-back transaction
before applying for real (both widened CHECK constraints accept a real `'celebration'` insert into
`occasions` and `occasion_group_plans`; `_occasion_emoji`/`_occasion_noun` return the correct new
case) with zero leaked rows afterward; both constraints re-confirmed live after the real apply.
Full Jest suite 453/453 passing (no new pure functions — this is DB-plus-UI wiring); all four
touched files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a
running app (no simulator/device tooling this session, standing note) — next session should
confirm on a real account that the "Plan for Someone" card renders with its new label/subtitle,
that the 5 quick-pick tiles render above "More occasions →", that tapping Surprise correctly
pre-checks the surprise-mode checkbox on the next (who_for) step, and that the full grouped list
still renders correctly once expanded.

**Item 81 ("One Plan can contain multiple businesses" -- the ride/dinner/live-music/ride-home
itinerary mock) — fully DONE (2026-09-13), resumed cleanly after a codespace restart (a complete
migration plus matching client edits were found already written and uncommitted at session
start; all read in full, checked against the user's own mock, and confirmed correct and complete
-- nothing needed to be redone, only verified live and shipped).** Direct extension of Item 80's
"Make it special" add-on architecture: Item 80 gave a plan a flat one-slot-per-type readiness
rollup ("2 of 3 extras confirmed"); this item turns it into the user's own literal mock -- a real
chronological itinerary (6:30 Ride / 7:00 Dinner / 9:00 Live music / 10:30 Ride home), including
the genuinely new case of TWO Transportation engagements in one plan (there and back), which
Item 80's own "one open add-on per type" duplicate guard had accidentally made impossible.

Shipped via `20261105_plan_timeline.sql` (applied and verified live against production
`enmosvippabmuqslzrox`): two new nullable, purely-descriptive columns on `business_requests` --
`plan_time` (when this specific engagement happens within the PLAN's own timeline, deliberately
distinct from `time_window_start`/`time_window_end`, which stay the requester's real availability
window for matching -- a native time picker only, never AI-inferred, per this repo's own standing
rule) and `plan_label` (a short freely-typed distinguishing label, "Ride home" vs "Ride there").
The duplicate-add-on guard in `create_plan_addon_request` (now a 4th trailing param,
`plan_time_param` -- old 3-arg signature explicitly dropped first, confirmed single overload
live) is relaxed to only reject a true accidental double-tap (same type AND same plan_time AND
same plan_label, null-safe via `IS NOT DISTINCT FROM`) rather than any second same-type add-on --
a deliberate second Transportation entry at a different time now succeeds. A new
`set_plan_item_time` RPC lets the caller freely retime/relabel any of their own requests in a plan
after the fact (the primary included -- e.g. labeling it "Dinner at Restaurant A" once a business
is accepted). `get_business_opportunities` (Item 69/80) now also returns `plan_time`/`plan_label`
so a business deciding on a Transportation add-on knows WHICH ride it is. A 7th add-on type,
`entertainment` (🎵, matching the mock's "Live music"), reuses the already-live `Music` leaf tag
under `entertainment_nightlife` -- no new taxonomy value needed.

Client: `planAddonReadiness.js`'s old one-slot-per-type model (`summarizeAddonsByType`/
`summarizePlanAddonReadiness`) was replaced with a real timeline builder, `buildPlanTimeline()` --
merges the primary + every live (non-cancelled) add-on into one sorted list, by whichever time is
actually known (a manually-set `plan_time` first, else a real accepted offer's own `proposed_time`,
else honestly "Anytime," sorted last, never guessed into a fake position); two same-type entries
each get their own row. `summarizePlanTimelineReadiness()` replaces the old readiness rollup,
computed directly off the timeline. `BusinessRequestDetailScreen.js`'s "✨ Make it special" section
is now "🗺️ Your Plan" -- a real chronological list (fixed-width time column + icon/label/business
name/state/actions per row), with a shared inline compose panel (native `DateTimePicker` + a label
`TextInput`, one open at a time per this app's own Progressive Depth doctrine) driving both "add a
new entry" and "retime an existing one." `BusinessDashboardScreen.js`'s opportunity card gained a
"🕐 {time}" chip showing the specific plan time for a business deciding on an add-on.

Verified live against production via two disposable rolled-back transactions using the real
`create_business_request`/`create_plan_addon_request` RPCs (not raw inserts -- confirmed
`business_requests` has no direct INSERT policy at all, only SECURITY DEFINER RPC access) with
real `SET ROLE authenticated` + `request.jwt.claims` impersonation: a second Transportation add-on
at a different time succeeds (previously blocked); an exact duplicate (same type/time/label) is
correctly rejected; a null-time/null-label duplicate is also correctly rejected (null-safety
confirmed); the new `entertainment` type creates successfully; `set_plan_item_time` correctly
retimes/relabels the primary; `get_business_opportunities` correctly returns `plan_time`/
`plan_label` in its payload for a business viewing an add-on. Both transactions rolled back and
re-confirmed afterward with zero leaked rows. Full Jest suite 453/453 passing (test files updated
to match the new `buildPlanTimeline`/`summarizePlanTimelineReadiness` shape); all eight touched/
new files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a
running app (no simulator/device tooling this session, standing note) -- next session should
confirm on a real account that the "🗺️ Your Plan" timeline renders correctly sorted by time, that
the inline time-picker/label compose panel works for both adding a new entry and retiming an
existing one, and that a business's opportunity card shows the correct plan-time chip.

**Item 80 ("Make it special" -- multi-business add-ons on a plan) — IN
PROGRESS, stopped mid-session for a codespace restart (2026-09-13).** User's
own explicit instruction: build the real thing end-to-end (schema, RPCs,
RLS, lifecycle, client UI, tests, live verification) -- NOT a backlog item,
NOT a design doc, NOT a mocked UI. Locked architecture, verbatim: **"One
Occasion -> one Plan -> multiple optional business engagements -> one
simple readiness view."** Each add-on (flowers/photographer/transportation/
decorations/dessert/gift) is its own fully independent business_requests
row with its own request->offer->accept/decline->reservation lifecycle --
one business declining an add-on must never affect another add-on or the
primary. No new business-request system was built; the existing one was
extended.

**What's DONE and verified live against production (`enmosvippabmuqslzrox`)
this session** -- full detail in `supabase/migrations/20261104_plan_addons.sql`'s
own header comments:
- Taxonomy: 3 new leaf tags (Florist, Party & Event Decor, Gift Shop) added
  to the `shopping` group in `gatheringCategories.js`'s `CATEGORY_GROUPS`
  (Photographer/Dessert reuse the existing Photography/Bakeries tags;
  Transportation is deliberately major-only, matching `auto_transportation`'s
  existing zero-leaf-tag precedent). All 7 real CHECK constraints that
  mirror this shared flat list were widened together (found via a live
  search for every constraint referencing the array, before writing the
  migration, so none drift).
- Schema: `business_requests` gained `parent_request_id` (self-FK) and
  `addon_type` (6-value CHECK), with a both-or-neither pairing CHECK. A new
  index on `parent_request_id`.
- `create_plan_from_business_request()` (the trigger that auto-creates a
  `plans` row on every business_requests insert) now skips add-on rows --
  the one guard that keeps "one occasion, one plan" real at the data level
  instead of a UI convention (without it, every add-on would spawn its own
  redundant Plans-tab entry).
- `_business_request_fanout()` generalized (DROP+CREATE, not duplicated)
  with two new optional trailing filters (`category_filter_param text[]`,
  `business_major_filter_param text`), both defaulting to null so the one
  existing caller (`create_business_request`) is byte-identical to before.
  Add-ons are the first caller to pass a real filter, so e.g. a Flowers
  add-on broadcasts only to real florist-classified partners instead of
  every nearby business.
- New RPC `create_plan_addon_request(parent_request_id, addon_type, note)`
  -- inherits location/date/time/party-size from the parent (never
  re-collected), generates a privacy-safe generic raw_text server-side
  (occasion-only, never the parent's own free text, which may carry a
  celebrated person's name -- mirrors Item 69's
  `composeCelebrationAskTextForBusiness` convention), rejects an addon-of-
  an-addon, rejects adding to a cancelled primary, and blocks a duplicate
  *open* addon of the same type (a cancelled/expired one doesn't block a
  retry -- audit trail preserved, a retry creates a new independent row,
  never mutates history). Deliberately skips `_match_request_to_policy`
  (no category awareness at all -- would cross-match any nearby business)
  and `_match_request_to_package` (occasion packages are the PRIMARY
  business's own concept) -- only the now-category-aware fanout plus
  `_match_request_to_availability`/`_ai_auto_respond_to_business_requests`
  run, and only when a real leaf category exists (skipped for
  Transportation, which is major-only).
- `get_business_opportunities()` (Item 69's RPC) now also returns
  `addon_type`/`is_addon` in its fixed jsonb column list -- same privacy
  boundary as everything else it returns (no requester identity, no parent
  request's own raw_text).
- Verified live via a disposable rolled-back transaction (real fixtures:
  2 users, 3 brand_partners -- a real Florist match, a real
  auto_transportation match, a non-matching food_drink business) BEFORE
  applying the migration for real: primary creates exactly 1 `plans` row;
  a Flowers add-on notifies ONLY the florist partner (not the diner or the
  transportation company) and creates ZERO `plans` rows; raw_text never
  leaks the parent's own free text; duplicate-open-addon rejected;
  addon-of-addon rejected; Transportation add-on (null category, major-only)
  notifies only the transportation partner; retry-after-cancel succeeds;
  cancelled-parent rejected; business-side `get_business_opportunities`
  correctly surfaces `addon_type`/`is_addon` with no `requester_id` leak.
  All assertions passed (each as a `RAISE EXCEPTION` that would have
  surfaced as an API error, confirmed by deliberately triggering and
  observing several real errors earlier in the same session). Re-confirmed
  after the real apply: `_business_request_fanout`/`create_plan_addon_request`/
  `get_business_opportunities`/`create_plan_from_business_request` each have
  exactly 1 live overload (no signature-drift risk).
- Client: `src/constants/planAddons.js` (the 6-type vocabulary + a
  deterministic, non-AI occasion->relevant-add-ons lookup,
  `relevantAddonTypesForOccasion` -- 9 new Jest tests) and
  `src/utils/planAddonReadiness.js` (pure state-derivation --
  `deriveAddonRequestState`, `summarizeAddonsByType`,
  `summarizePlanAddonReadiness`, `canRetryAddon` -- 19 new Jest tests, all
  independent-lifecycle behavior explicitly covered: one addon confirmed
  never affects another still pending, one declined offer among several
  doesn't sink the whole addon if another offer is still live, a "skipped"
  addon doesn't count against the readiness ratio). `businessFulfillment.js`
  gained `createPlanAddonRequest`/`getPlanAddons`/`removePlanAddon` (the
  last just reuses the existing generic `cancel_business_request` --
  no new remove primitive needed). `BusinessRequestDetailScreen.js` (the
  screen every business-request creation path already lands on, including
  Item 67's group-vote "Book It" flow -- so this needed zero new entry-point
  wiring) gained: (a) a "part of a bigger plan" context banner + back-link
  when the screen itself is showing an add-on, and (b) a full "✨ Make it
  special" section on the PRIMARY request's own screen -- occasion-relevant
  add-on chips to add, each existing add-on's real state
  (waiting/offered/confirmed/declined/skipped) with View/Try
  Again/Remove actions, and a one-line plan-readiness summary ("N of M
  extras confirmed"). `BusinessDashboardScreen.js`'s existing "What they're
  looking for" tag row now shows an add-on badge (e.g. "🌸 Flowers add-on")
  first, ahead of the category tag, so a business can tell a Make-it-
  special add-on apart from a standalone ask. Full Jest suite 448/448
  passing; every touched/new file transform-checked clean via
  `@babel/core` + `babel-preset-expo`.

**Follow-up session (2026-09-13): items 1, 2, and 6 below closed out; what's
left is genuinely just device-only verification + two disclosed, non-
blocking scope notes.** The codespace restart had actually landed cleanly --
`git status` was already clean with `aa74f01c` (this item's commit) already
in the log, so nothing was lost or needed re-committing. The two real open
verification gaps were closed via disposable live tests against production
(`enmosvippabmuqslzrox`), each using a real signed-up-and-confirmed disposable
auth user + a real minted session token (via the Admin API + password grant,
not just the Management API's table-owner bypass), so these are genuine
PostgREST/RLS-as-a-real-user round trips, not SQL-level approximations --
all test rows and the disposable auth user deleted afterward, zero leaked
rows confirmed by direct count query both times:
- **`getPlanAddons()`'s nested embed, confirmed live via a real REST call**:
  created a real primary request + Flowers add-on via the actual RPCs as a
  real authenticated test user, inserted a disposable florist `brand_partners`
  row + a `business_request_offers` row on the add-on, then hit
  `GET .../business_requests?parent_request_id=eq.<id>&select=*,business_request_offers(*,brand_partners(name))`
  with that user's own real access token. The exact embed shape resolved
  correctly: the add-on row (privacy-safe `raw_text`, "Flowers for a birthday
  celebration" -- never the parent's own free text), nested inside it the
  offer row, and nested inside *that* the florist's real name via the
  `brand_partners(name)` embed. Confirmed as a sanity check that a stray
  in-scope RLS gap exists but is unrelated to this item and fails closed, not
  open (see below).
- **Item 6, confirmed live**: accepted a real disposable add-on offer
  (`accept_business_offer`) to create a genuine `confirmed` reservation, then
  called `cancel_business_reservation` on it -- both the reservation and its
  offer correctly flipped to `cancelled`, and the primary request's own
  `status` stayed `open` throughout, confirming the "cancelling an add-on
  never touches the primary" guarantee holds for a *confirmed* reservation,
  not just a pending/offered one.
- **Incidental, unrelated finding, not fixed (out of scope for this item,
  disclosed rather than silently ignored)**: an unauthenticated (`anon`)
  PostgREST read of `business_requests` returns a hard `42501 permission
  denied for function is_match_participant` instead of an honest empty
  array -- `anon` lacks `EXECUTE` on `is_match_participant`/
  `is_group_plan_participant`, and at least one RLS policy combination
  reaches that check even when `match_id`/`group_plan_id` is null. Fails
  closed (no data exposure), pre-existing, unrelated to Item 80's own
  changes -- a real, small, separate cleanup candidate for later, not part
  of this item's own spec.

**What's genuinely still NOT done -- pick up here next session:**
1. **Not exercised in a running app** at all (standing limitation, no
   simulator/device tooling ever available in this project) -- next
   session with device access should confirm: the "✨ Make it special"
   section renders correctly under a primary request with occasion-
   relevant chips, tapping "+ Add" creates a real add-on and updates the
   row in place, "🔁 Try Again" after a decline works, the add-on's own
   detail screen shows the "part of a bigger plan" banner and back-link
   correctly, and the business dashboard's new add-on badge renders.
2. Optional/nice-to-have, not blocking: `create_plan_addon_request`'s
   `note_param` is wired end-to-end at the DB layer but has no UI surface
   yet (the "+ Add" chip fires with `note = null`) -- could add a small
   optional note field later if wanted.
3. Not built (disclosed, not an oversight): a dedicated business-side UI
   distinguishing an add-on's own response flow from a normal request --
   it currently reuses the exact same generic "Make an Offer"/"Can't
   accommodate" buttons every opportunity already has, which is correct
   and sufficient (an add-on's offer lifecycle IS a normal offer
   lifecycle), but there's no add-on-specific business messaging beyond
   the new tag.

**Item 79 ("businesses get a new demand signal") — fully DONE (2026-09-13),
same-day direct follow-up to Item 78.** User's own examples: "14 birthday
groups are looking for dinner this weekend." / "8 groups are looking for
graduation celebrations." / "23 users are looking for date-night
experiences Friday." -- consumer intent -> business supply, not business
posts an ad -> hopes someone sees it.

Audited the real current state before writing anything: "Match Radar"
(`get_aggregated_demand_for_partner()`, live since 2026-08-15, extended
2026-09-13 for occasion/period breakdowns) already delivers most of this
vision -- real, anonymized, geo-scoped demand counts, already broken down
by category/party-size/soonest-date/time-of-day, with a dominant-occasion
footnote inside each category row, plus `notify_aggregated_demand_
threshold()` already pushing a business the moment category demand nearby
crosses 2. The one real, concrete gap against this item's own literal
examples: every existing signal is CATEGORY-first -- occasion is a
footnote ("14 people are looking for Restaurants -- mostly birthday (9 of
14)"), never its own headline. This item's own examples are OCCASION-
first and cross-category ("8 groups are looking for graduation
celebrations" names no category at all) and weekend/day-qualified.

Added this as a genuinely new, complementary rollup rather than touching
Match Radar: `get_occasion_demand_for_partner()` (same real geo-eligibility
rule as its category sibling) groups by `business_requests.occasion`
instead, returning request_count/total_party_size/soonest_date/
dominant_category/dominant_category_count plus a new
`weekend_request_count` (a real count of how many open requests fall on
the upcoming Friday-through-Sunday window -- two of the item's own three
examples are explicitly weekend/day-qualified). A new occasion-primary
sibling push, `notify_occasion_demand_threshold()`, fires once when real
nearby occasion demand crosses 2 (same crossing-point-only shape as its
category sibling) -- catches a real pattern the category trigger alone
can't (graduation demand split across Restaurants/Photography/Venues would
never trip the category trigger on its own).

The real strategic connection the item calls for ("businesses can respond
to that demand") is made concrete, not just displayed: the new "🎉 What
They're Celebrating" dashboard section (client-only addition, sits right
above Match Radar) has a "→ Create a {Occasion} Package" CTA opening the
existing Occasion Package composer (Item 68) pre-selected to the surging
occasion -- Match Radar's own "Turn into an offer" button opens a generic
single-date availability posting instead, the right response to raw
category demand but not to a recurring, named-occasion pattern; a durable,
priced, day-of-week-scoped Occasion Package is the more apt supply-side
answer to "N groups keep asking about graduation."

Verified live against production (`enmosvippabmuqslzrox`) via disposable
rolled-back transactions with real `SET ROLE authenticated` + `request.jwt.
claims` impersonation (using separate single-row INSERTs, not one bulk
multi-row INSERT, per this repo's own already-learned "AFTER ROW triggers
in a multi-row INSERT see the whole batch at once" gotcha): the owner view
correctly returns birthday (2 requests, correct total party size, correct
weekend flag) and graduation (1 request) rows; a non-owner call correctly
returns empty; the occasion-demand push fires exactly once on the second
birthday request (the real crossing point) and correctly never fires for
the graduation request (never reaches 2). All rolled back afterward with
zero leaked rows. Full Jest suite 413/413 passing (no pure-function
changes -- this item is DB-plus-dashboard-wiring only); all three touched
files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not
exercised in a running app (no simulator/device tooling this session,
standing note) -- next session should confirm the new section renders
correctly above Match Radar and that "→ Create a {Occasion} Package"
correctly opens the composer pre-selected to the right occasion.

**Item 78 ("The notification system becomes dramatically more useful") —
fully DONE (2026-09-13), resumed clean after a codespace restart (no
uncommitted work was left behind -- the restart hit before anything had
been written to disk, confirmed via `git status`/`git stash list`/a search
for a `.wip_*` scratch dir, all clean).** User's own 6 examples of what a
push should read like once it has real context: "🎂 Sarah's birthday is
next week." / "💍 Your anniversary is coming up." / "🎓 John's graduation is
Saturday." / "🎉 Your group hasn't finalized the birthday plan yet." /
"🍽️ A business responded to your birthday request." / "✅ Your reservation
for Sarah's birthday is confirmed."

Audited each of the 6 against real current code before writing anything:
the first three were already fully live (`send_occasion_planning_nudges()`,
20261022, already sends exactly this shape for all 11 occasion types).
Closed the two real remaining gaps via
`20261102_occasion_aware_notifications.sql`:

1. **"Your group hasn't finalized the plan yet"** -- `occasion_group_plans`
   had zero stall detection. New `send_occasion_group_plan_stall_nudges()`
   (a new `stall_nudge_sent_at` dedup column, fire-once-ever per plan, same
   cron-nudge shape as its siblings) notifies the HOST ONLY -- the single
   final decider per Item 66's own "no complex RSVP, one decider" guardrail
   -- once a plan has sat in `voting`/`voting_business` for 3+ days, or its
   own `scheduled_date` is within 3 days and still undecided.
2. **Occasion-aware "a business responded"/"reservation confirmed."** New
   `_occasion_context_for_business_request()` reads the existing
   `plans.resulting_business_request_id` -> `occasions`/
   `occasion_group_plans.resulting_plan_id` linkage ("Occasion architecture
   should not be a silo," 20261021) -- its first read from the notification
   layer. Every site that sends `business_offer_received`
   (`admin_review_business_content_screening`'s offer_response branch,
   `post_business_availability`'s immediate-match branch,
   `submit_business_offer`) now leads with the linked occasion's emoji/noun/
   who-for-name when one exists, falling back to the exact previous generic
   copy otherwise (verified byte-identical for the non-occasion case). A
   genuinely new "✅ Reservation Confirmed!" push was added to the
   consumer's own side of `accept_business_offer` -- it previously only
   ever notified the BUSINESS that its offer was accepted, never the person
   who just booked. A real, separate bug was found and fixed in the same
   pass: `confirm_group_plan_offer`'s own final "everyone confirmed" push
   excluded `user_id <> auth.uid()` -- correct for the earlier "someone
   else confirmed, you should too" nudge above it, wrong here, since it
   meant the participant whose own tap just finalized the reservation was
   the one person who never learned it was confirmed. Per Item 69's own
   locked privacy boundary, who_for_name is used only in these
   consumer-facing sites -- never added to any business-facing push.
   Emoji/noun mappings were also extracted out of
   `send_occasion_planning_nudges()`'s own inline CASE into two new shared
   `_occasion_emoji()`/`_occasion_noun()` helpers (one ontology, not
   copies) -- and its anniversary emoji corrected from 💑 to 💍 to match
   this item's own example verbatim.

Verified live against production (`enmosvippabmuqslzrox`) via four
disposable rolled-back transactions with real test data (inspecting
`net.http_request_queue`'s actual queued push bodies, not just return
values): the context helper resolves a real linked birthday occasion
correctly and returns nothing for an unlinked request; all three
`business_offer_received` sites produce the correct enriched text for an
occasion-linked request AND the byte-identical original fallback text for a
plain one; `accept_business_offer` sends the exact literal text from the
item's own example, "Your reservation for Sarah's Birthday is confirmed!";
the stall nudge fires once, sets its dedup marker, does not re-fire on a
second run, and correctly does not fire for a fresh (<3-day-old, no
near-term date) plan; `confirm_group_plan_offer`'s fix was verified with a
real 2-participant group plan -- the final confirmer is now correctly
included in the reservation-confirmed push recipients. All four
transactions rolled back and re-confirmed afterward with zero leaked rows.
Every touched/replaced function confirmed to keep its exact prior
signature (`pg_get_function_identity_arguments`, single overload each,
before and after). Full Jest suite 413/413 passing (no pure-function
changes -- this item is DB-plus-routing only); `notifications.js`
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not
exercised in a running app or against a real device (no simulator/device
tooling this session, standing note) -- next session with device access
should confirm a real tapped `business_reservation_confirmed`/
`occasion_group_plan_stalled` push lands on the right screen.

**Item 77 ("Add an 'Occasion Hub' to Profile") — audited, deliberately NOT built as proposed, one
small real placement fix shipped instead (2026-09-13).** The user's own framing was conditional
throughout ("Potentially"..."I'd avoid adding another huge section if the existing Profile
hierarchy is already busy... the important thing is that occasions remain accessible without
becoming another top-level tab") -- read as an invitation to audit and recommend, not a firm spec
to build verbatim, so this was treated that way rather than implemented literally.

Audited the real current `ProfileScreen.js` hierarchy (1500+ lines) before changing anything:
it's already genuinely busy -- Interests, Your Plans, Your Connections, Your Story (5 links),
Achievements, Business, then a whole separate profile-editing half (More Photos, Prompts, Voice
Intro, About You, Details, Basics, Interests-editor). Adding a new "Occasion Hub" screen/section
consolidating My Plans + Occasions + Communities + Gatherings, as the user's own sketch proposed,
would be exactly the bloat they explicitly asked to avoid -- and it doesn't map cleanly onto what
actually exists: Communities and Friends on this screen are browse/discovery destinations (tap
through to browse *all* communities/friends), while Plans and Occasions are personal-record
screens (*my own* commitments/reminders) -- a fundamentally different kind of "list." Gatherings
has no dedicated Profile entry at all today (reached via Discover/Home instead); folding it in
would mean inventing a new entry point for something that already has a perfectly good one
elsewhere. Merging all four under one hub would conflate two different categories of screen, not
simplify anything -- so no new hub/screen was built.

The one real, warranted gap: Occasions was already reachable in one tap from Profile (confirmed:
it already was, "the important thing" per the user's own words was already true before this item)
-- but it lived in the "Your Story" group, alongside Timeline/Memory Vault/Your Activity/Your
Rewards, which is a *backward*-looking "how has my social life gone" group. An occasion (an
upcoming birthday, anniversary, etc.) is forward-looking planning, the same category as "Your
Plans" right above it, not personal history. Moved the existing Occasions link row (same icon,
label, subtitle, destination -- nothing new rendered) from "Your Story" into "Your Plans," right
under the Upcoming/Past quick-stat tiles -- net zero new UI, one row relocated to the section it
actually belongs in. This is the one respect in which Profile changed for this item; no new
section, no new screen, no new tab.

**Follow-up, same day, direct user request ("i want that polish so it feels more integrated"):**
the user reviewed the move, explicitly endorsed the "reorganize before creating anything new"
principle behind it, confirmed the new ordering (Your Plans → Occasions → Connections → Story →
Achievements → Business) matches their own ideal structure exactly, and asked for one visual
refinement -- the relocated Occasions row was its own separately-bordered card sitting right below
the Upcoming/Past tile card, which read as *adjacent* rather than *integrated*. Restructured so
the tiles and the Occasions row now share ONE outer card (`plansCard`: single border/radius/
background) with a plain hairline `plansCardDivider` between them, instead of two bordered cards
stacked with a gap -- same destinations, same copy, still zero new sections/screens/tabs, purely a
container change. "Your Connections" directly below keeps the original plain `quickStatsRow`
untouched, since it has no third row to integrate.

Full Jest suite 413/413 passing (no pure-logic changes, so no new tests); `ProfileScreen.js`
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note) -- next session should confirm the
Occasions row renders correctly in its new spot under "Your Plans" and that "Your Story" still
reads coherently with one fewer row.

**Item 75 ("Connect occasions to the user's calendar") — fully DONE (2026-09-13), same-day
direct follow-up to Item 74.** User's own locked spec (via `AskUserQuestion`): a real, production-
ready first increment, not a mocked UI or backlog item — permission-driven ("Allow Nearby to use
selected calendar events to help you plan?", never blanket access), read-only (Nearby never
creates/edits a device calendar event), a hard structural distinction between private calendar
information and events actually being planned through Nearby, calendar as a signal/context layer
rather than a new content type to manage, and integrated into existing flows (no new Calendar
tab/screen) — directly paired with Item 76's own locked boundary, "Calendar = when, Nearby = what
+ who + where + how" (now in Standing Conventions below).

Added `expo-calendar` (~15.0.8, SDK 54-compatible, via `npx expo install`) plus its config plugin
in `app.json` (iOS `NSCalendars(FullAccess)UsageDescription`/Android `READ_CALENDAR`+
`WRITE_CALENDAR`, the latter bundled unconditionally by the module's own plugin even though this
app never calls any calendar write API anywhere). New `src/services/deviceCalendar.js` is the one
real architectural choice this item hinges on: calendar permission state, which specific device
calendars the user has explicitly opted in to share (never all of them), and the "already
handled" dismissed-event-id set are ALL plain AsyncStorage on-device — raw calendar event data is
read live from the OS and rendered directly in the client, and NEVER reaches Nearby's servers at
all until the exact moment the user explicitly taps an action on one specific event. That's the
real mechanism behind the "private calendar info vs. events you're planning through Nearby"
distinction: an event only crosses that line when the user deliberately converts it into a real,
already-existing `occasions` row (`addOccasion()`, an unchanged RLS-scoped plain insert -- no RPC
overload risk since this was never an RPC to begin with). A new
`occasions.imported_from_calendar boolean default false` column
(`20261101_occasion_calendar_import_marker.sql`, applied and verified live against production) is
a pure, honest provenance marker for that one moment -- never storing the calendar event's own
device-local id server-side (meaningless off-device anyway); on-device dedup is tracked
separately, in AsyncStorage.

New pure, dependency-free `src/utils/calendarOccasionSuggestion.js` (11 new Jest tests) mirrors
`businessAttributeExtraction.js`'s own "real keywords only, honestly labeled guess, always
user-editable" shape: `guessOccasionTypeFromEventTitle()` (falls back to 'other'/Custom Occasion,
Item 74's own free-text catch-all, for anything ambiguous rather than guessing wrong),
`formatCalendarEventDateLabel()` (same short-date shape `formatRequestWhen()` already
established), and `filterUpcomingCalendarSuggestions()`/`nearestCalendarHint()` for dedup/context.

Client: `OccasionsScreen.js` (the existing "Occasions & Reminders" screen -- no new screen/route)
gained a new "From Your Calendar" section, above Group Plans. Not yet connected: a compact "📅
Connect Your Calendar" card. Tapping it shows the user's own exact requested copy as a contextual
`Alert` ("Allow Nearby to use selected calendar events to help you plan?...") before the real
native OS permission dialog fires; once granted, an in-place picker `Modal` (same "full-screen
slide sheet" shape `SurpriseMeSheet.js`/`FiltersModal.js` already established -- no new screen)
lets the user check specifically which device calendars to share, never a blanket "all calendars"
default. Once enabled, the section shows real upcoming events (60-day window) from only the
selected calendars, each with three explicit actions, none automatic: "Plan Something →" (marks
the event handled and lands directly on Item 74's Custom Occasion Describe step, prefilled with
the real event title -- the user's own example, "Dad's visiting," flows straight into the same
classify+resolve pipeline Item 74 already built); "Save as Occasion" (creates a real, tracked
`occasions` row with a reminder, tagged `imported_from_calendar: true`, shown with a "📅 From your
calendar" badge in the existing list); and a plain "✕" dismiss for "not relevant." "Manage"/
"Disconnect" links let the user change which calendars are shared or fully opt out at any time
(disconnecting clears Nearby's own opt-in state; the confirm dialog honestly discloses that this
doesn't revoke the device-level OS permission, which only the user's own Settings can do).
`CelebrateSomethingScreen.js` gained one new optional route param, `initialCustomDescription`,
threaded into its existing Custom Occasion Describe step's text state -- a one-line, low-risk
addition since `initialStepFor()`'s existing `hasOccasion` branch already lands correctly on that
step for `initialOccasion: 'other'` with no other change needed.

Per the user's own "where appropriate, use calendar signals to improve recommendations, planning,
occasions, and Surprise Me" -- both wired as small, genuinely additive touches, never a second
permission prompt of their own (only ever reading if the user already opted in via
OccasionsScreen): `surpriseMe.js`'s `runSurpriseMe()` now returns a best-effort `calendarHint`
(nearest real event within 5 days) fetched in parallel with its existing candidate resolution,
rendered on Home as one small, purely informational line ("📅 You also have '...' coming up...")
under the suggestion card -- never a gate on the suggestion itself. `HomeScreen.js`'s existing
ask-box placeholder rotation (the same "merge a real per-user signal into the pool" mechanism the
existing recurring-intent-pattern placeholder already established) gained one more real candidate
line, "Plan something for {title}…", only when a genuine near-term calendar event exists.

Deliberately NOT touched: onboarding (`OnboardingScreen.js`'s own header comment explicitly says
it "sells the outcome, not features... whatever someone needs to know, they'll learn by using the
app" -- a dedicated calendar-permission pitch mid-onboarding would contradict that design choice
on record, and OccasionsScreen is already the natural, contextual, existing-flow entry point the
user's own instruction asked for); any deeper `linkOccasionToPlan`/resulting-plan linkage for the
"Plan Something" path specifically (it reuses Item 74's existing Custom Occasion pipeline as-is,
which does not itself call `linkOccasionToPlan` for the 'other' destination -- a real, disclosed,
pre-existing scope boundary from Item 74, not something this item introduced or was asked to
close).

Verified live against production (`enmosvippabmuqslzrox`): the new `occasions.imported_from_
calendar` column applied and confirmed present via `information_schema.columns` (boolean, default
false). Full Jest suite 413/413 passing (11 new); all seven touched/new files transform-checked
clean via `@babel/core` + `babel-preset-expo`; `app.json` re-confirmed valid JSON after the manual
edit. **Not exercised in a running app or against a real device** (no simulator/device tooling
available this session, standing note) -- this is the one item in this whole build where that
matters most: native calendar permission dialogs, the OS-level calendar picker, and
`expo-calendar`'s actual runtime behavior have never been exercised at all. Next session with
device access should confirm: the contextual Alert correctly precedes the real OS permission
dialog; the calendar-selection picker correctly lists real device calendars and the selection
persists across app restarts; a real upcoming event renders with a sensible guessed occasion
type; "Plan Something" correctly lands on a prefilled Describe step; "Save as Occasion" correctly
creates a badged Occasion; and Disconnect correctly stops all calendar reads without needing an
app restart.

**Item 74 ("'Custom Occasion' is important... keeps the system open-ended") — fully DONE
(2026-09-12), same-day direct follow-up to Item 73.** User's own example: "My dad is visiting
from out of town" isn't a standard life event -- picking "Custom Occasion" should ask "What are
you planning?", the user types "Dad's visiting — want to take him somewhere special," and Nearby
understands the intent and starts building options directly, rather than forcing the usual
who/what/when interrogation.

Relabeled the occasion wizard's existing 'other' key from "Other Occasion" to "Custom Occasion"
(same key/data everywhere else it's used -- AskBusinessScreen, BusinessDashboardScreen's priority-
occasion picker, OccasionsScreen -- only the display label changed) and gave it a genuinely
different, much shorter path in `CelebrateSomethingScreen.js`: `buildStepDefs()` now branches on
`occasion === 'other'` to a 2-step flow (Occasion → Describe) instead of the usual 5, skipping
who_for/activity/when/who_involved entirely. The new 'custom_describe' step is one free-text box
("What are you planning?"), submitted through `runIntentSearch()` -- the exact same classify
(`create-assistant`) + resolve (`resolveIntent`/`resolveCommunityIntent`) pipeline Home's ask box
and Discover's search (Item 39) already use, not a new or weaker one. Real matching results
(gatherings/business availability/communities/perks) render inline as plain tap-through rows
(`navigateToIntentResultItem`); a `business_partner`-classified description routes straight to
`RequestBusinessPartner`; when nothing already exists, the same "🏪 Ask Nearby Businesses" /
"None of these? Create it yourself →" escape hatches every other empty/unclear intent result in
this app already offers apply here too (`goAskBusinessFromCustom`/`proceedToCustomCreation`,
mirroring HomeScreen's own `goAskBusiness`/`proceedToCreation` exactly) -- no dead ends, no
fabricated structure forced onto an open-ended ask.

Extracted `INTENT_SEARCH_TYPE_EMOJI`/`intentSearchDateLabel`/`intentSearchFallbackTitle` out of
`DiscoverHubScreen.js` (which had them as its own private helpers for rendering its "understood
as" search panel) into the dependency-free `intentResolverScoring.js` -- both screens now share
one result-rendering vocabulary instead of two copies that could drift (this repo's own
already-established Items 27/39 discipline), and the three functions are finally unit-tested
(`intentResolverScoring.test.js`, 5 new tests) since `intentResolver.js` itself transitively
imports supabase/expo-location and can't be imported in a plain Jest/Node test at all (confirmed
live: importing it throws trying to strip types out of an `expo-modules-core` file under
`node_modules`).

No DB migration -- pure client-side reuse of already-existing, already-tested infrastructure. Full
Jest suite 402/402 passing; all seven touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm on a real account that picking "Custom Occasion"
correctly shows the 2-step Describe flow, that a description like the dad-visiting example
produces sensible real results (or the correct escape hatches when it doesn't), and that "Try a
different description" correctly lets the user redo the search without losing their typed text.

**Item 73 ("This can work for non-social life events too ... don't hard-code the product around
birthdays") — fully DONE (2026-09-12), resumed after a codespace restart mid-build.** Found at
session start: a complete, uncommitted migration
(`20261031_occasion_vocabulary_life_events_expansion.sql`) and matching edits to
`businessAttributes.js`/`CelebrateSomethingScreen.js`/`HomeScreen.js`/`OccasionsScreen.js` (plus a
new `businessAttributes.test.js`) — all read in full, checked against the user's own list, and
found correct and complete. Widens the occasion vocabulary with 8 real values from that list not
previously covered (wedding/retirement/new_job/achievement/moving/reunion/welcome/
holiday_gathering) across every table CHECK constraint and function-level inline copy in the
schema, and — the real architectural ask — replaces the wizard's and `OccasionsScreen`'s single
ever-longer flat chip row with a genuine grouped structure (`OCCASION_GROUPS`: Celebrations/
Milestones/Social Moments/Custom in `businessAttributes.js`), with `CELEBRATE_OCCASION_KEYS`/
`PERSONAL_OCCASION_TYPE_KEYS` now derived from it instead of their own hand-maintained flat lists,
so the vocabulary can keep growing without silently drifting between the two. `HomeScreen.js`'s
occasion-nudge icon lookup was also generalized from a small hardcoded map to a lookup against
`OCCASION_OPTIONS` itself — the same "second copy drifts" bug pattern this migration's own
functions were being fixed for.

**Two real, additional, pre-existing gaps found live (via disposable rolled-back transactions)
after the rest of the migration was confirmed already applied, not present in the pre-restart
build** — both are DB constraints this migration's own stated goal ("widen every occasion
vocabulary gate together") should have caught but missed: (1)
`business_occasion_packages_occasion_type_check` (Item 68's Occasion Packages table) was still
stuck at the original 16-value list even though `create_occasion_package`'s own inline check was
already correctly widened to 24 in the found migration — creating a package for `retirement` (or
several already-existing values) hit a hard 23514 at the INSERT itself; (2)
`business_partner_requests_priority_occasions_check` (the pending-application table, distinct
from `brand_partners`' own copy) had never been widened even by the original Sep 16 2026 8→16
expansion, despite `BusinessPartnerApplyScreen.js`'s chip picker already rendering the full,
current `OCCASION_OPTIONS` list with no RPC layer in front of the insert — any applicant picking
`graduation`/`wedding`/etc. as a priority occasion has always hit an unexplained submission
failure. Both fixed and applied live to the same 24-value list as every other gate; the migration
file was updated to match so a from-scratch replay lands in the same state.

Verified live against production (`enmosvippabmuqslzrox`): every widened constraint and function
body confirmed present and matching the migration file exactly; `set_business_priority_occasions`
confirmed to have no duplicate overload; a disposable rolled-back transaction confirmed
`create_business_request(occasion:'wedding')`, `create_occasion_package(occasion_type:'retirement')`,
and a `business_partner_requests` insert with `priority_occasions: ['graduation','wedding',
'achievement']` all now succeed where at least the latter two previously failed — zero leaked rows
afterward. Full Jest suite 397/397 passing; all five touched/new client files transform-checked
clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device
tooling this session, standing note) — next session should confirm on a real account that the
Occasion wizard's occasion step renders the 4 grouped sections correctly and that a business can
successfully create an Occasion Package for one of the 8 new occasion types.

**Item 72 ("Make invitations frictionless") — fully DONE (2026-09-12).** User's own framing: a
plan invite shouldn't require the recipient to already have Nearby — "View Plan" and a lightweight
web experience should work for anyone, with "Open Nearby" as the upgrade path, creating a natural
acquisition loop. Audited every real share-a-plan call site first: `GatheringConfirmationScreen`'s
"Share Gathering," `GatheringHubScreen`'s growth-loop share prompt, and `InviteFriendsModal`'s own
`handleShareWithNonUser` (a function literally named for this exact case) all shared a bare
`nearby://gathering/:id` deep link — confirmed via `app.json` (only `"scheme": "nearby"`, no
`associatedDomains`/`intentFilters` anywhere) that this does nothing at all for anyone without the
app already installed. The opposite of frictionless.

Fixed by mirroring this repo's own existing Live Tracking precedent exactly
(`get_live_tracking_session` + `docs/track.html`, already shipped, already anon-callable): a new
`get_public_gathering_invite_preview(uuid)` RPC (`20261030_public_gathering_invite_preview.sql`,
SECURITY DEFINER, granted to `anon` — a deliberate, disclosed exception to the usual "revoke from
anon" convention) returns only minimal, non-sensitive fields (title, category, host display name,
time, attendee count) for anyone holding the link — no exact coordinates, no free-text description,
no participant list. A real correction made before this ever shipped: the migration's first draft
also returned `gatherings.area`, assumed to be a neighborhood name — reading `gatherings.js`'s own
`localArea()` showed it's actually a real lat/lng pair rounded to ~1km, i.e. genuine coordinate
data, which is exactly the kind of pre-acceptance overexposure Item 69 already drew a hard line
against; removed before it ever reached anon. A new static page, `docs/invite.html` (same GitHub
Pages hosting as the business web dashboard, same "plain HTML + direct REST call with the public
anon key" shape `track.html` already established), renders the preview with zero install — "Open
in Nearby" attempts the native deep link and falls back to the App/Play Store after a beat only if
the tab never backgrounds (a `document.hidden` check, not a raw timer race); "Get Nearby" goes
straight to the store. All three real share call sites now share this `https://` URL instead of the
dead-end `nearby://` link, via a new shared `gatheringInviteShareUrl()` (`gatherings.js`).

Deliberately scoped to gatherings only — the one concrete, already-externally-shareable "plan"
object across every existing share call site. Group-vote plans (`occasion_group_plans`) and
business-request plans are NOT covered: both structurally only ever invite the organizer's own
already-connected Nearby friends today (no existing "share with someone who might not be a Nearby
user" path to fix), and building genuine anonymous-guest voting is a materially bigger, separate
feature (guest identity, spam/abuse risk) than this item asks for — disclosed, not silently
skipped.

Verified live against production (`enmosvippabmuqslzrox`) via disposable rolled-back transactions:
a real gathering's preview returns correctly as `anon` (title/category/host name/time/attendee
count, and confirmed the payload never contains `requester_id`/exact coordinates/description); a
nonexistent id correctly returns `null`; zero leaked rows afterward. Full Jest suite 386/386
passing; all four touched JS files transform-checked clean via `@babel/core` + `babel-preset-
expo`; the page's inline script syntax-checked clean via `node --check`. Not exercised in a running
app or a real browser (no simulator/device/browser tooling this session, standing note) — next
session should confirm on a real device that tapping a shared invite link opens `docs/invite.html`
correctly, that "Open in Nearby" correctly hands off when the app is installed, and that "Get
Nearby" lands on the real App Store listing (the Play Store URL is constructed from the known
Android package id in `app.json` but has not been confirmed to resolve to a live listing).

**Item 71 ("Occasions can automatically suggest people") — fully DONE (2026-09-12).** User's
own example: creating "Sarah's birthday" should surface "Who should be included? People you may
want to invite — Sarah's friends: John, Emily, Mike," but only as a suggestion, never an automatic
invitation. Item 63 (2026-09-12) had already built exactly this mechanism for the group-vote
invite step (real mutual friends between organizer and the celebrated person, `get_mutual_friends`,
marked 🤝, never auto-selected) — this extends the same mechanism to the plain (non-group-vote)
`who_involved` step, which previously offered zero suggestions at all: picking Friends/Family/
Invite Specific just said "we'll take you to your new plan, invite from there." Now, when a real
connected friend/family member is who_for, that step shows a real "People you may want to invite —
{Name}'s friends" panel with tappable mutual-friend chips; nothing is invited from the wizard
itself — the selection carries through `CreateGathering` → `GatheringConfirmationScreen` as a
sorted-to-top, 🤝-badged suggestion on that screen's own real invite panel, where sending still
requires the organizer's own explicit per-friend "Invite" tap (same screen, same mechanism every
other invite already uses — no new send path). New pure `possessiveFriendsLabel()`
(`celebrateSomething.js`, 4 new tests).

**Real, previously-unnoticed bug found and fixed while building this**: Item 63's own mutual-
friends fetch (`ensureFriendsLoaded()`) was keyed off `whoForFriendId` but ran the instant the "A
Friend" chip is tapped — *before* the user picks which specific friend — so `whoForFriendId` was
still null at fetch time and `mutualFriendIds` was permanently stuck at an empty set for the rest
of the wizard session (the `friendsLoaded` guard prevents it from ever re-running). Fixed by
splitting mutual-friend fetching into its own `useEffect` keyed on the real `whoForFriendId` value,
so it actually refetches once a specific person is picked — this also retroactively fixes Item 63's
own "🤝 marks a friend you both know" badge on the group-vote invite step, which had never actually
lit up in practice since it shipped (a silent failure, not a crash, so nothing caught it before
now).

Full Jest suite 386/386 passing; all five touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm on a real account that the suggestion panel renders
with real mutual friends, that tapped selections correctly appear sorted-to-top and 🤝-badged on
`GatheringConfirmationScreen`, and that nothing is ever actually invited without an explicit tap
there.

**Item 70 ("Add 'What are you celebrating?' to business requests") — audited, fully DONE
(2026-09-12).** Audited first rather than assumed: `business_requests` already collects
occasion/party_size/budget_min/budget_max/date/time_window/attributes/cuisine (built across
Items 61/25-Aug semantic-tags work), `AskBusinessScreen.js` already asks for all of them, and
`get_business_opportunities()` (Item 69) already returns every one of those fields to the
business. The one real, concrete gap: the business's own pending-opportunity "What they're
looking for" tag row (`BusinessDashboardScreen.js`) never showed the requested DATE, even though
it's collected and already used for scoring — a business deciding whether to respond needs to see
"Sat, Sep 19" alongside occasion/party size/budget. Closed with a new pure
`formatRequestWhen()` (`src/utils/businessRequestWhen.js`, 7 Jest tests) wired into the tag row as
a new "📅 ..." chip. Full Jest suite 382/382 passing; `BusinessDashboardScreen.js`
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note).

**Item 69 ("Businesses shouldn't need to know the person's identity") — fully DONE (2026-09-12),
direct follow-up to Item 68.** User's own locked answer (via `AskUserQuestion`): a strict
two-stage boundary. Pre-acceptance, a business sees only what it needs to decide whether to make
an offer ("Birthday celebration · 8 people · Saturday evening · $75/person") — never a name.
Post-acceptance (a genuine confirmed reservation), the business gets the primary requester's real
name only — never phone/photo/other profile fields, never for a dating-sourced request (which
already has its own separate, deliberate "Two people planning to visit" anonymization predating
this item), and this must hold at the DB/RPC layer, not just by a client choosing not to render a
field.

Audited the real current model first (background research fork): `business_requests` has no
`title`/`who_for_name` column at all — the leak was entirely that the Occasion wizard's
auto-composed free text ("Sarah's Birthday") got stored verbatim as `raw_text`, plus a linked
gathering's real title got exposed a second, independent way via `getBusinessOpportunities()`'s
own `gatherings(title,...)` embed. Separately, `requester_id` (a real profile FK) was technically
over-exposable via the "Businesses can view requests they've received an opportunity for" RLS
policy (full-row SELECT the instant an opportunity exists) even though no shipped query currently
requested it — latent, not previously exploited, but real. And the opposite gap: nothing at all
revealed identity at confirmed-reservation time, not even the minimally-necessary name.

Two write-side fixes close the concrete leaks at the source: a new `composeCelebrationAskTextForBusiness()`
(`celebrateSomething.js`, no `whoFor`/`whoForName` ever) replaces `composeCelebrationAskText()` for
both of the wizard's direct-to-business paths — `submitSelectedBusinessRequests()`'s silent
multi-submit (no user-review step before the text reaches a business) and `AskBusinessScreen`'s
default prefill (still user-editable, but the safe default no longer requires the user to notice
and strip a name themselves). `composeCelebrationAskText()` itself is untouched and still used for
the gathering-title/calendar-save/"Custom" AI-box paths, which are either private or shown back to
the user for their own edit first. `GatheringDetailScreen.js`'s "Ask Local Businesses Now" (a
single tap, no review screen at all) stopped sending the host's own freely-chosen `gathering.title`
verbatim — same risk for any gathering, not just an occasion-sourced one — now sends a generic,
category-derived description instead.

Two read-side structural fixes close what a text fix alone can't, per the user's own explicit
"across RPCs and database authorization, not just by hiding fields in the client" instruction:
`getBusinessOpportunities()` (`businessFulfillment.js`) is now routed through a new
`get_business_opportunities(partner_id_param)` SECURITY DEFINER RPC
(`20261029_business_request_privacy_boundary.sql`) whose returned column list is fixed in the
function body — `requester_id` can never leave it no matter what a client asks for — and which
returns a linked gathering's non-identity `interest_tag` instead of its real `title`
(`BusinessDashboardScreen.js`'s `describeVisit()` updated to match). The RLS policy the old direct
embed relied on is dropped outright (confirmed via `pg_policies` that only the unrelated
consumer-side policies remain); the RPC does its own `managed_partner_id` ownership check. The
same RPC adds the post-acceptance reveal: a `requester_display_name` field, null unless this
specific offer's `status` is `accepted`/`completed` AND the request has no `match_id` (preserving
the existing dating anonymization) — surfaced as a new "👤 {name}" line on the dashboard's
"Upcoming Nearby Visits" card. `profiles` has only a single `display_name` column (no first/last
split, no phone anywhere on the table) — revealed as-is, nothing fabricated or split.

Verified live against production (`enmosvippabmuqslzrox`) via two disposable rolled-back
transactions before applying the migration for real: a pending offer and a match-sourced accepted
offer both correctly withhold `requester_display_name` (null); a genuine non-match accepted offer
correctly reveals it ("Sarah Smith"); the full jsonb payload never contains a `requester_id`
field in any of the three cases; an unauthorized caller (wrong `partner_id`) is correctly rejected
with the exact expected error; a direct table `SELECT` against `business_requests` by the
business owner (bypassing the RPC entirely) returns zero rows once the old policy is dropped. Both
transactions rolled back and re-confirmed afterward with zero leaked rows
(`auth.users`/`brand_partners`/`business_requests` counts all zero for the test ids). Function and
dropped policy both re-confirmed live after the real apply. Full Jest suite 375/375 passing; all
five touched files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised
in a running app (no simulator/device tooling this session, standing note) — next session should
confirm on a real account that a business dashboard's pending-opportunity card never shows a name,
and that the "👤 {name}" line correctly appears only after a real accepted (non-dating) offer.

**Item 68 ("Businesses could create occasion-specific offers") — first real increment shipped
(2026-09-12), direct follow-up to Items 61-67's Occasion work.** User's own framing: a restaurant
should be able to configure a real "Birthday Package" (dessert + a group table, minimum 6 guests,
available Fri/Sat, $X/person); a bowling alley a "Birthday Group Package"; a spa a "Birthday Group
Experience"; a golf course a "Birthday Golf Package" — Nearby's job becomes matching a real
occasion to real local supply, "much more compelling than simply displaying advertisements."

Shipped as a genuinely new, durable, named product concept — `business_occasion_packages`
(`20261028_business_occasion_packages.sql`) — distinct from both existing occasion-adjacent
business fields: `brand_partners.priority_occasions` (a flat "we want more of this occasion"
appetite signal, no structure) and `business_availability`'s own `bundle_occasion`/
`bundle_components` (a one-time posted, time-boxed slot that happens to bundle several components).
A package has its own name, real included line items (free text, e.g. "Birthday dessert," "Group
table"), a minimum party size, a per-person price, and which days of the week it's offered
(`available_days smallint[]`, reusing `business_fulfillment_policies.active_days`'s own exact
shape — 0=Sunday..6=Saturday, null means every day) — it exists independent of any specific date,
unlike an availability posting. RLS enabled, zero client policies, every access through a
SECURITY DEFINER RPC: `create_occasion_package`/`update_occasion_package`/
`set_occasion_package_active` (pause/resume)/`delete_occasion_package`/`get_my_occasion_packages`
(business-side CRUD, all owner-scoped via `profiles.managed_partner_id`) and
`search_occasion_packages` (the consumer-facing read, mirroring `search_policy_only_businesses`'s
own shape — requires a real occasion, hard-filters on `min_guests` vs. the caller's real party
size, returns `available_days` for the caller to render as a "why," not a hard filter, since the
resolver only ever has a coarse date bucket).

**Matching, not just display**: a consumer picking a package (via the resolver, see below) binds
directly to it at `'offered'` status immediately — the same "the business already explicitly
published these exact terms" reasoning that already justifies an immediate offer for a matched
`business_availability` posting (`preferred_availability_id`'s own precedent,
`20260822_availability_preferred_binding.sql`). New `_match_request_to_package()` mirrors that
function's two-part shape (a preferred-binding block plus a general scan for any OTHER real match
within radius, so a plain `AskBusinessScreen` submission with `occasion` set — no resolver
involved — still surfaces real package supply). `create_business_request` gained a 17th trailing
param, `preferred_package_id_param`; `business_request_offers` gained a nullable `package_id`
column (own real traceability, `ON DELETE SET NULL`, matching `availability_id`'s own precedent).
The computed offer price is `price_per_person × the requester's own real party size` when both are
known. **A real bug was caught live during verification and fixed before this was considered
done**: the general (non-preferred) matching loop's first draft used `not exists (select 1 from
business_request_offers where ...)` to skip any partner already in that table — but
`_business_request_fanout()` (which always runs FIRST in `create_business_request`, before any of
the three matchers) already inserts a `'pending'` row for every nearby partner, so that `not
exists` guard excluded literally every real candidate and the general scan could never fire.
Fixed to match `_match_request_to_availability`'s own correct shape exactly: always attempt the
`INSERT ... ON CONFLICT DO UPDATE ... WHERE status = 'pending'` upgrade, and only count it as a
genuinely new match when the partner wasn't already `'offered'` before. Caught and fixed via a
disposable rolled-back transaction against production before being treated as done — full detail
in the migration file's own comment at the fix site.

**A second real, pre-existing, unrelated-to-this-item bug was also found and fixed in the same
migration** (disclosed, not silently bundled, since it's the same occasion-vocabulary domain this
item was already touching): `create_business_request`/`create_business_request_for_gathering`/
`create_business_request_for_match` have each, since `20260912_business_request_occasion.sql`
first introduced `occasion_param`, carried their OWN inline copy of the occasion validation list
— and none of the three was ever updated when `20261016_celebrate_occasion_vocabulary_expansion.sql`
widened the real column CHECK from 8 to 16 values (adding graduation/baby_shower/engagement/
housewarming/promotion/farewell/milestone/life_event). Confirmed live before fixing: the column
itself has accepted all 16 values since Sep 16 2026, but these three functions' own inline checks
still rejected the 8 newer ones with "Invalid occasion" — a real, live, latent bug meaning any
consumer flow submitting one of those 8 occasions through any of these three functions (e.g. the
Occasion wizard's own business-options step, live since Item 61's "connect it to businesses"
fast-follow) would have hit a hard submission failure, never previously caught since no simulator/
device session has exercised that path live. All three fixed to the real 16-value vocabulary;
`create_business_request` needed a DROP+CREATE (new trailing param), the other two a plain
CREATE OR REPLACE (unchanged signatures).

**Resolver + client wiring**: a new `resolveOccasionPackages()` tier in `resolveIntent()`
(`intentResolver.js`) — only ever searched when the ask carries a real occasion — scores a match
at the same confirmed-tier floor as `business_availability` (`SCORE_OCCASION_PACKAGE_FLOOR`,
`intentResolverScoring.js`), since a package is a stronger, more specific declared-fit signal than
an untargeted posting. Surfaced as its own real candidate type (`business_occasion_package`),
never fed into `assembleExperience()`'s own bundle/component grouping (that's keyed to dinner/
dessert-shaped categories, not "a whole package"). `celebrateSomething.js`'s
`dedupeBusinessCandidates()` now includes packages from the flat list unconditionally (regardless
of whether an Experience also assembled); `extractBusinessCandidateIds()` (Item 67's group-vote
candidate list) deliberately stays filtered to `business_availability` only — `occasion_group_
plan_options` binds to a real `business_availability_id` FK a package has no equivalent row for,
so group-voting on a package is a disclosed, bounded fast-follow, not built here.
`CelebrateSomethingScreen.js`'s "options" step renders a new "🎁 Occasion Packages" section
(generic card reuse — no new JSX needed for the card itself, just a new filtered section) and its
submit path threads `preferredPackageId` instead of `preferredAvailabilityId` for a picked package.

**Business Dashboard**: a new "Occasion Packages" management section (between "Your Availability"
and "Fulfillment Policy," same list-plus-modal shape as both) — create/edit/pause-resume/delete,
occasion chip picker (reusing the existing `OCCASION_OPTIONS` vocabulary), a free-text
add-one-at-a-time included-items list, minimum guests, price per person, and a `DAY_OF_WEEK_
OPTIONS` chip picker (reusing the exact component `business_fulfillment_policies`' own Active
Days editor already established).

Deliberately NOT built in this pass, disclosed rather than assumed: gathering-/community-sourced
business requests (`create_business_request_for_gathering`/`create_business_request_for_match`)
are not wired to `_match_request_to_package` — occasion-vocabulary-fixed but package-matching-
unwired, a real bounded scope boundary; group-voting on a package (see above); `business_match_
exclusions` missed-match instrumentation for packages (the availability matcher's own bookkeeping
table, not extended here). Pure display helpers (`formatAvailableDaysLabel`/
`formatIncludedItemsLabel`/`formatOccasionPackageDetail`) live in a new dependency-free
`src/utils/occasionPackageFormatting.js` (re-exported from `services/occasionPackages.js`) rather
than the service file itself, so they stay directly unit-testable without dragging in `supabase`'s
own react-native/AsyncStorage imports — same reasoning `intentResolverScoring.js`'s own split from
`intentResolver.js` already established. Full Jest suite 375/375 passing (8 new tests); all seven
touched/new files transform-checked clean via `@babel/core` + `babel-preset-expo`.

Verified live against production (`enmosvippabmuqslzrox`) via disposable rolled-back transactions
with real `SET ROLE authenticated` + `request.jwt.claims` GUC impersonation: package create/list/
cross-owner-update-blocked/consumer-search (including the real min-guests hard-filter excluding a
too-small party) all confirmed correct before the matching-loop bug above was found, fixed, and
re-verified; the fixed general matching loop confirmed correct on all three cases (a genuine
Saturday/party-of-8 match now correctly lands `'offered'` with the right `package_id`/computed
price, a too-small party and a wrong-day request both correctly stay `'pending'`); the
`preferred_package_id_param` binding path confirmed correct (immediate `'offered'` row, correct
computed `offer_price`); the occasion-vocabulary fix confirmed live (`graduation` now accepted by
`create_business_request` where it previously raised). All transactions rolled back and
re-confirmed afterward with zero leaked rows. Not exercised in a running app (no simulator/device
tooling this session, standing note) — next session should confirm on a real account that the new
"Occasion Packages" dashboard section renders and saves correctly, that a package genuinely shows
up in the Occasion wizard's "options" step with correct price/min-guests/days text, and that
tapping "Request This Package" (via the existing generic selectable-card flow) lands on a real
`BusinessRequestDetail` showing the matched package.

**Item 67 ("Let the group vote on businesses") — fully DONE (2026-09-12), same-day direct
follow-up to Item 66.** User's own example: Nearby finds real options (Restaurant A 7:00 PM
$65/person / Restaurant B 7:30 PM $52/person / Restaurant C 8:00 PM $70/person), everyone votes,
Restaurant B wins → request/offer → availability → reservation → plan confirmed — "a social
commerce loop without making it feel like commerce." Before this item, the group vote
(`occasion_group_plans`) only ever covered WHAT TO DO (an activity_type); only the host
personally browsed real businesses afterward and picked alone. This adds a SECOND, optional
voting round on the same plan/options/votes tables: once the group decides a business-destined
activity type (dinner/night_out/activity), the plan moves to a new `voting_business` status
instead of `decided` (`20261027_occasion_group_plan_business_vote.sql`) — the host's device
fetches real live `resolveIntent()` candidates (the exact same resolver
`CelebrateSomethingScreen`'s own 'options' step already calls — no second matching engine) and
`propose_occasion_business_options` stores the top few as new, votable, real
`occasion_group_plan_options` rows (`option_kind='business'`, a real `business_availability_id`
FK) — every id is re-verified live server-side (active, not expired, has capacity, its own
business still active) before being stored, never trusted blindly from the client. The whole
group votes again on WHICH business (`cast_occasion_vote`, already fully generic over any option
id, only its status gate widened). The host decides the winner
(`decide_occasion_group_plan_business`) — re-verified live for availability a second time right
before finalizing, since a posting can go stale between being proposed and being decided
(verified live: a posting that fills up after being proposed is correctly rejected at decide time
with the plan left unchanged in `voting_business`, never partially applied). `get_occasion_group_
plan_detail` now returns each business option's real partner name/posting title/price/start time
via a live LEFT JOIN (never a stored snapshot, so a posting going stale between votes shows
`stillActive: false` honestly rather than stale cached data).

Client: `GroupOccasionPlanScreen.js`'s `handleDecide` branches on the decide response's new
`status` field — a business-destined activity type doesn't navigate away, it fetches and shows a
real "🍽️ Vote on Where" section right there (real partner/price/time per option, vote buttons,
host-only "Pick →"), with a genuine empty state (zero real businesses found nearby) offering
"Try Again" or a host-only "Skip — I'll Pick →" escape hatch
(`skip_occasion_group_plan_business_vote`, host-only, falls back to exactly the pre-Item-67
behavior — finalizes on the original activity choice and hands into CelebrateSomethingScreen's
own solo browse). Once decided, a business-kind winner gets its own decided card (real partner/
posting/price/time, no fabricated activity icon) with a host-only "Book It →" action
(`handleBookWinningBusiness`) that calls the existing `submitBusinessRequest
(preferredAvailabilityId)` primitive directly — no second trip through CelebrateSomethingScreen's
wizard steps — which itself instantly creates a real 'offered' `business_request_offers` row
(request → offer, in one step), then links back via the existing `linkOccasionGroupPlanToPlan` and
lands on the real `BusinessRequestDetail` screen. Deliberately host-only (not every joined
participant): a business_availability posting has finite real capacity, and letting several
participants independently "book" the same winning slot would create duplicate competing
requests against it — a disclosed, deliberate scope boundary, not an oversight. New shared pure
helpers in `celebrateSomething.js` (`dedupeBusinessCandidates`, `extractBusinessCandidateIds`,
`formatBusinessOptionDetail`) — `CelebrateSomethingScreen.js`'s own solo 'options' step was
refactored to reuse `dedupeBusinessCandidates` instead of its own copy, so the two screens can't
drift on what counts as a real selectable candidate.

Verified live against production (`enmosvippabmuqslzrox`) via disposable rolled-back transactions
before applying the migration for real: the full happy path (decide activity → propose 3 real
postings, one at zero capacity correctly skipped → guest votes → host decides the winner → detail
correctly shows live partner/price/time + vote counts) end to end; a non-host correctly blocked
from proposing business options; re-deciding an already-decided plan correctly rejected; the
`skip` escape hatch correctly falls back to the original activity-only payload shape; the
`option_kind`/`business_availability_id` CHECK constraint correctly rejects a malformed row; and,
in a separate follow-up transaction, a posting that goes stale (fills to zero capacity) between
being proposed and being decided is correctly rejected at decide time with the plan left
unchanged in `voting_business`. All transactions rolled back and re-confirmed afterward with zero
leaked rows. Full Jest suite 367/367 passing (13 new tests for the three new pure helpers); all
five touched/new files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not
exercised in a running app (no simulator/device tooling this session, standing note) — next
session should confirm on a real account that the second "Vote on Where" round, its empty/skip
states, and the host-only "Book It" action all render and behave correctly on a real screen, and
that a tapped `occasion_group_plan_voting_business` push correctly deep-links into
`GroupOccasionPlanScreen`.

**Item 66 ("Add collaborative planning") — fully DONE (2026-09-12), same-day direct user
follow-up to Item 65.** User's own mock for "Sarah's 30th Birthday": Organizers (Allen, John,
Emily) shown distinctly from Guests (8 invited), Ideas with vote counts (already shipped by the
original occasion_group_plans work), a Budget ($50-$100/person), and "Nearby is finding
options...". Closed the two real, concrete gaps that work didn't cover -- co-organizers and a real
budget range -- via `20261026_occasion_group_plan_collaborative.sql`.

**Co-organizers**: a new `occasion_group_plan_participants.is_organizer` flag (default false). The
host can promote any *joined* participant to organizer (`set_occasion_group_plan_organizer`,
host-only; a merely-invited person can't be promoted, enforced server-side) and demote back to a
plain guest. An organizer gains exactly one real new power -- inviting more real friends/matches
mid-voting (`invite_more_to_occasion_group_plan`) -- deliberately NOT decide/cancel authority,
keeping a single final decider and avoiding the "complex RSVP / giant event-management platform"
the backlog's own guardrail warns against. `invite_more_to_occasion_group_plan` checks eligibility
against the *inviter's own* friend/match network (not the host's) -- each organizer can only
surface their own real connections, never borrow the host's, per this repo's own "no stranger
discovery" rule; verified live that an organizer's own friend, a stranger to the host, gets
invited correctly.

**Budget**: `occasion_group_plans.budget_min`/`budget_max` (nullable integers, USD/person) -- a
real, explicit, chip-picked organizer input at plan-creation time (`BUDGET_RANGE_OPTIONS` in
`celebrateSomething.js`: Any/$0-25/$25-50/$50-100/$100+), never AI-inferred. A CHECK constraint
plus a function-level guard both reject min > max. Threaded all the way through: `decide_
occasion_group_plan` now returns it, `resolveDecidedGroupPlanParams()` carries it forward as
`initialBudgetMin`/`initialBudgetMax`, and the wizard's post-decide business-request submission
(`submitSelectedBusinessRequests`) and the "skip -- post manually" path (`AskBusinessScreen`'s own
single `budgetMax` ceiling field) both pass it through to `create_business_request`'s already-
existing `budget_min_param`/`budget_max_param` -- no DB change needed there, pure client wiring.
Also added a small, honest "✨ Nearby is finding options…" line next to the wizard's existing
options-step spinner, matching the mock's own framing -- deliberately NOT built as a live
per-idea preview during voting, since no single activity type is actually known until the group
decides (that's literally what the vote determines); doing so live would mean fabricating a
"searching" state with nothing real to search for yet.

`GroupOccasionPlanScreen.js` now shows a real "Organizers" section (host + promoted participants,
named, 👑/🎗️ marked) separate from a "Guests" section (a real, honest status-count summary --
"N invited · N joined · N can't make it" -- plus the existing per-person chip list), a budget line
under the header (`formatBudgetRange()`, honestly omitted when unset), host-only tap-to-promote/
demote on guest/organizer chips (with a confirm `Alert`, never silent), and an organizer/host-only
"+ Invite More Guests" expand-in-place panel (no new navigation, per this app's own Progressive
Depth doctrine) reusing `getMyFriends()` and filtering out anyone already in the plan and (when
`surpriseMode` is on) the celebrated person.

Verified live against production (`enmosvippabmuqslzrox`) via disposable rolled-back transactions
with real `SET ROLE authenticated` + `request.jwt.claims` impersonation: promoting a not-yet-
joined participant correctly rejected; a plain guest (never organizer) correctly blocked from
inviting more people; an organizer successfully invites their own real friend (a stranger to the
host); both the function-level and table-level budget-order guards correctly reject min > max;
`decide_occasion_group_plan` correctly returns the real budget. All rolled back with zero leaked
rows afterward. Full Jest suite 359/359 passing (5 new tests: `formatBudgetRange`, budget/
organizer fields on `resolveDecidedGroupPlanParams`); all six touched/new files transform-checked
clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device
tooling this session, standing note) — next session should confirm on a real account that the
Organizers/Guests split, the promote/demote confirm flow, the Invite More panel, and the budget
chip picker all render and behave correctly on a real screen.

**Item 65 ("Let the organizer keep the occasion private" / Surprise mode 🔒) — fully DONE
(2026-09-12), resumed after a codespace restart mid-build.** User's own spec: a "Surprise mode"
toggle so the person being celebrated never learns "Allen is planning your birthday," while
invited organizers can still collaborate freely. Found at session start: a complete, uncommitted
migration (`20261025_occasion_surprise_mode.sql`) and matching edits to
`CelebrateSomethingScreen.js`/`OccasionsScreen.js`/`celebrateSomething.js`/`occasionGroupPlans.js`/
`occasions.js` — all read in full and checked against the user's own spec, found correct and
complete. The migration's own header comment shows a real leak audit was already done covering all
3 paths that could tell the celebrated person something is being planned: (1)
`occasions.connected_user_id` (Item 62's "share this too" checkbox) — now structurally impossible
to combine with `surprise_mode` via a CHECK constraint, not just client-side hiding; (2)
`occasion_group_plans`' own invitee list — the organizer could accidentally select the celebrated
person as one of the "friends to invite to vote," now skipped both by an early-skip in
`create_occasion_group_plan` and, as a structural backstop, a BEFORE INSERT trigger on
`occasion_group_plan_participants` that covers any future insert path into that table, not just
this one RPC; (3) the resulting Gathering's own visibility — audited and found already safe
(`resolveCelebrationVisibility()` already forces `invite_only` for every group-planning-reachable
path, so the interest-matched discovery pushes that only ever fire for `visibility = 'everyone'`
can never reach the celebrated person this way) — no change needed there.

Two real gaps closed this session, not present in the pre-restart build: (1)
`GroupOccasionPlanScreen.js` — the one collaborator-facing surface the migration's own comment
named ("so the client can show a real 🔒 Surprise Mode indicator") — had received no client code
at all; added a 🔒 prefix on the header title (matching `OccasionsScreen.js`'s own existing
convention) and a dismissible-style banner ("🔒 Surprise mode — {name} isn't part of this plan and
won't be notified. Keep it quiet!") for invited collaborators. (2) `decide_occasion_group_plan`
didn't return `surpriseMode` in its result, so `resolveDecidedGroupPlanParams()` had no way to
carry surprise context forward into the wizard's post-decide "find options nearby" step — a host
deciding a surprise plan would land back in `CelebrateSomethingScreen` with local `surpriseMode`
state reset to its `false` default, silently re-showing the "share with friend" checkbox as if
nothing had ever been hidden (still opt-in/default-off, so never a hard leak, but a real loss of
continuity). Fixed by adding a `surpriseMode` field to `decide_occasion_group_plan`'s returned
jsonb (plain `CREATE OR REPLACE`, unchanged 2-arg signature, no overload risk), a new
`initialSurpriseMode` field on `resolveDecidedGroupPlanParams()` (4 new/updated Jest tests), a
`route.params?.initialSurpriseMode` seed on `CelebrateSomethingScreen`'s `surpriseMode` state, and
`detail.surpriseMode` threaded through `GroupOccasionPlanScreen.js`'s own `goFindBusinesses()` call
site (the other of the two real callers of `resolveDecidedGroupPlanParams`).

Verified live against production (`enmosvippabmuqslzrox`) via a comprehensive set of disposable
rolled-back transactions (real `auth.users`/`profiles`/`friendships` rows, real
`SET ROLE authenticated` + `request.jwt.claims` GUC impersonation, not just the Management API's
own table-owner bypass): `create_occasion_group_plan` correctly skips the celebrated person from
the invite list even when explicitly included (invitedCount reflects only the other real invitee;
participant rows confirm the celebrated person is genuinely absent); the
`occasion_group_plan_participants` BEFORE INSERT trigger independently blocks a direct insert of
the celebrated person with the exact expected error message; the `occasions` CHECK constraint
blocks `surprise_mode` + `connected_user_id` together; `get_occasion_group_plan_detail` and
`decide_occasion_group_plan` both correctly return `surpriseMode: true`. All rolled back and
re-confirmed afterward with zero leaked rows (`auth.users`/`occasion_group_plans`/`occasions`
counts all zero). Full Jest suite 354/354 passing (4 new/updated tests); all seven touched/new
files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running
app (no simulator/device tooling this session, standing note) — next session should confirm on a
real account that the 🔒 checkbox renders correctly in both `OccasionsScreen` and
`CelebrateSomethingScreen`, that an invited collaborator sees the new surprise banner on
`GroupOccasionPlanScreen`, and that the celebrated person genuinely never sees the occasion
anywhere in their own app.

**Item 64 ("'For Someone Else' is a huge distinction") — fully DONE (2026-09-12), same-day direct
user follow-up to Items 62 & 63 below.** User's own framing: the Create flow should explicitly
ask "Who is this for? Me / A friend / Family / Someone else" — not a cosmetic addition, but a
real expansion of what Nearby is for: not only a tool for the user's own activities, but a tool
for organizing experiences for the people they care about.

Shipped on `CreateHubScreen.js` itself — the one place every create path already funnels through
(Item 61's "I wouldn't clutter Create with 10 separate buttons" redesign) — as an always-visible
selector at the very top, above the 3 primary cards, using the exact same whoFor vocabulary
(`me`/`friend`/`family`/`someone_else`) `CelebrateSomethingScreen`'s own who_for step already
established, so the two questions never drift and Occasion can consume the answer directly.
Defaults to "Me," so a user who never touches it sees zero behavior change. Picking anything else
reveals the same real-friend-chip-plus-free-text-name combo the wizard already uses (lazy-loaded
via `getMyFriends()`).

The answer threads through as a real, always-editable prefill — never auto-submitted, per this
repo's own "AI suggests, never silently commits" discipline even though this isn't AI-driven:
**Occasion** gets full structural support for free (it already has `who_for_name`/
`who_for_friend_id` real columns from "Occasion architecture should not be a silo") — the card
tap now passes `initialWhoFor`/`initialWhoForName`/`initialWhoForFriendId` straight into the
already-existing route params `CelebrateSomethingScreen` reads, landing on its own who_for step
pre-filled rather than blank. **Gathering** and the "Ask Nearby Businesses"/"Start a Weekly
Meetup" quick actions (both of which also land on `CreateGathering`) get a real, editable title/
text prefill (`"{Name}'s Gathering"` / `"Something for {Name}"`, new pure `buildGatheringQuickStart
Title()`/`buildAskBusinessPrefillText()` in `src/utils/createHubWhoFor.js`, 12 new Jest tests) —
no new schema, since neither gatherings nor business_requests has (or needs) a structural "who
for" column for this. **Community was deliberately left out** — it's a shared, ongoing entity by
its own nature ("Build something ongoing"), not something "for" one person, and forcing a signal
onto it would fabricate context that doesn't fit; disclosed in the code rather than silently
applied. "Invite Friends"/"Plan a Date"/"Meet New People" quick actions are already inherently
about a specific person and were left untouched. The "Something Else" free-text AI box was also
left untouched — it can already express "for my mom" in natural language, and force-injecting the
selector's text into that field would fight with what the user is actively typing.

Full Jest suite 352/352 passing (12 new); all three touched/new files (`CreateHubScreen.js`,
`createHubWhoFor.js`, `createHubWhoFor.test.js`) transform-checked clean via `@babel/core` +
`babel-preset-expo`. No DB migration — pure client-side wiring over already-existing route params
and columns. Not exercised in a running app (no simulator/device tooling this session, standing
note) — next session should confirm the selector renders correctly above the 3 primary cards and
that tapping Occasion after picking a friend actually lands on a pre-filled (not blank) who_for
step.

**Items 62 & 63 ("Let users save important dates for people" / "make the reminder useful
immediately") — fully DONE (2026-09-12), same-day direct user follow-up to "Make Occasions
proactive" below.** User's own mock for item 62: an "Occasions & Reminders" section grouped per
person (Sarah / 🎂 Birthday — Sept 18 / 💍 Anniversary — June 12 / 🎓 Graduation — May 24), with
"strong privacy controls" — the user chooses what Nearby is allowed to remember and whether
reminders are enabled, and this shouldn't imply Nearby automatically knows sensitive information
about people's lives. Item 63: a reminder should land with useful context already populated
(who, relationship, relevant friends, location, interests, past plans) rather than dumping the
user at a blank "figure it out yourself" screen.

Audited the real gap before writing anything: `occasions.who_for_name`/`who_for_friend_id`
(added by "Occasion architecture should not be a silo") were only ever populated by
`CelebrateSomethingScreen`'s own wizard save-to-calendar step — `OccasionsScreen.js`'s manual
"Add an occasion" form had no way to name a person at all, so grouping by person was structurally
impossible for anything added there. Also found: every real write path
(`celebrateSomething.js`'s 3 call sites) set `occasions.connected_user_id` — which actually
grants that named friend real read access to the record via `get_upcoming_occasions()` —
unconditionally to whichever friend was picked as "who this is for." Naming someone for your own
organizational purposes was silently also sharing the record with them; there was no separate
"whether reminders are enabled" control at all beyond the blanket `notify_social` category
toggle.

Shipped via `20261024_occasion_reminders_and_sharing_controls.sql`: (1) a new
`occasions.reminder_enabled` column (default true), checked by `send_occasion_planning_nudges()`
alongside the existing `notify_social` gate — a real per-occasion mute, independent of the
category toggle and every other occasion; (2) while verifying this live, found and fixed a real,
pre-existing gap in the prior migration — both `send_occasion_planning_nudges()` and
`send_birthday_planning_nudges()` had been revoked from `public`/`anon` but not `authenticated`,
meaning any signed-in user could call either cron-only function directly and trigger a mass push
run on demand (this repo's own standing "a new function defaults to PUBLIC execute" convention
exists for exactly this). Fixed both; a broader audit of the other ~57 push-sending functions for
the same gap was NOT done — disclosed as a real, separate, larger task, not silently skipped.

Client: `OccasionsScreen.js`'s add form gained a real "Who is this for?" picker (Me / a real
connected friend, fetched via `getMyFriends()` / Someone Else with a free-text name field, same
vocabulary `CelebrateSomethingScreen` already uses) and, only when a real friend is picked, an
explicit "👀 Also share this with {name} too" checkbox — **defaulting OFF** — before
`connected_user_id` is ever set; picking a friend just for grouping no longer silently shares
anything. The title field auto-fills from occasion+person (reusing `composeCelebrationTitle()`,
the same pure function the wizard already uses) but stays fully editable and is never
force-overwritten once the user types their own. The list itself now groups by person via a new
pure `groupOccasionsByPerson()` (`src/utils/occasionGrouping.js`, 5 new Jest tests) — a real
connected friend id and a hand-typed name are matched case/whitespace-insensitively but never
conflated with each other (a friend-linked "Sarah" and a free-typed "Sarah" are two different
people until the user actually connects them); occasions with no linked person (personal
milestones, or anything saved before this feature existed) land in a trailing "Other" bucket
rather than being hidden or guessed into a wrong group. Each occasion row gained a 🔔/🔕 reminder
toggle (`setOccasionReminderEnabled()`, a plain owner-scoped update — no RPC needed, same posture
as the existing add/delete). Screen renamed "Occasions & Reminders" everywhere user-visible (nav
title + in-body header), matching the user's own naming.

`CelebrateSomethingScreen.js` got the matching "share this too" checkbox (same default-OFF
behavior) right below its own existing "save to calendar" checkbox, wired into all 3 real
`buildOccasionSaveParams()` call sites — `connectedUserId` is now `shareOccasionWithFriend ?
whoForFriendId : null` instead of always `whoForFriendId`. This is a real, disclosed behavior
change from before this item: an anniversary named via a real connected partner used to always be
auto-shared with them; it now requires the same explicit opt-in, per the item's own "the user
chooses" framing.

Item 63's own concrete gap, closed: the group-vote invite step (`stepKey === 'group_invite'`) now
surfaces real mutual friends of the celebrated person first in the friend-picker chip list,
marked with a 🤝, using the already-live `get_mutual_friends()` RPC (no new backend needed) — a
real "relevant friends" signal, never auto-selected (the user still makes the actual invite
decision, consistent with "AI suggests, never silently commits" run in a non-AI, deterministic
context). Every other piece of item 63's own example was found already real and already shipped
by prior work, verified by reading the actual code rather than assumed: the push already lands
with occasion+person prefilled via `initialOccasion`/`initialWhoFor`/`initialWhoForName`/
`initialWhoForFriendId`; location/interests/past-plans/favorite-business context is already live
in `resolveIntent()`'s scoring (`favoriteBusinessBonus`/`pastPlanBonus`/`occasionBonus`, from the
anniversary-nudge fast-follow). Deliberately NOT built: a true OS-level actionable "Plan
Something" button embedded in the push notification itself (vs. the current "tap opens the app
directly into the prefilled step") — this repo has no existing `categoryIdentifier`/notification-
action infrastructure at all, and "no simulator/device tooling has ever been available in any
session" means shipping untested native notification-action code carries real, unverifiable risk;
disclosed as a deliberate scope boundary, not silently skipped. Also not built: a signal for
"previous plans with this specific person" (vs. the caller's own general business affinity,
already covered) — no schema currently tracks "attended with whom" in a form scoring could use;
flagged as a real, distinct, unstarted gap.

Verified live against production (`enmosvippabmuqslzrox`): the `occasions` table had zero live
rows, so the column add and function replace carried no migration risk; the `reminder_enabled`
filtering logic was verified via a disposable rolled-back transaction (two test rows, one per
flag value, confirmed the WHERE-clause split before rollback, zero rows left afterward) rather
than invoking the full push-sending function (which would have fired a real `net.http_post` even
inside a rolled-back transaction — fire-and-forget by design, so the SQL-level check was the safe
verification here); the `authenticated`-grant fix was confirmed live before and after
(`information_schema.role_routine_grants` showed the leak, then showed it gone on both
functions); `link_occasion_to_plan`/`link_occasion_group_plan_to_plan`/`get_upcoming_occasions`/
`get_mutual_friends` were all spot-checked and confirmed correctly scoped to `authenticated` only
(no `anon`/`PUBLIC` leak) as a sanity check alongside the fix. Full Jest suite 340/340 passing
(5 new); all six touched/new files transform-checked clean via `@babel/core` + `babel-preset-
expo`. Not exercised in a running app (no simulator/device tooling this session, standing note)
— next session should confirm on a real account that the person-grouped list renders correctly,
that the share checkbox actually gates a connected friend's own visibility into the record
(`get_upcoming_occasions()` from their side), and that the mutual-friends badge appears correctly
in the group-vote invite step.

**"Make Occasions proactive, not just user-created" — fully DONE (2026-09-12), same-day direct
user follow-up to "Occasion architecture should not be a silo" below, resumed after a codespace
restart mid-commit.** User's own framing, generalized past birthday/anniversary: "Nearby already
knows you have an upcoming occasion because you chose to save it... 🎂 Sarah's birthday is
September 18. Want to plan something?" — extend the existing birthday/anniversary planning-nudge
mechanism (below) to all 11 real `occasions.occasion_type` values, not just those two.

`send_birthday_planning_nudges()` and `send_anniversary_planning_nudges()` (20261017/20261019)
already built exactly this shape, but as two separate, occasion-type-specific functions, and only
for 2 of the 11 values the column has allowed since `20261016_celebrate_occasion_vocabulary_
expansion.sql` widened it (graduation/milestone/life_event/baby_shower/engagement/housewarming/
promotion/farewell/other were never nudged about at all). Shipped via
`20261022_occasion_planning_nudges_generalized.sql`: (1) a new `send_occasion_planning_nudges()`
consolidates every self-logged `occasions` row (any of the 11 types) into one generic function —
a future occasion type added to the CHECK constraint now gets a real proactive nudge
automatically, no new migration needed; lead time is 14 days for occasions that typically need
more logistics (anniversary/graduation/baby_shower/engagement/housewarming, same reasoning the
original anniversary migration gave) and 7 days for the rest — a disclosed judgment call, not a
measured fact; (2) `send_birthday_planning_nudges()` is trimmed to only its structural Source 1 (a
connected Nearby friend/match's real `profiles.birthdate` — the one source the generic function
can't reach, since it has no `occasions` row behind it); (3) `send_anniversary_planning_nudges()`
is fully retired (unscheduled + dropped) — it was 100% self-logged-occasion-based, now entirely
covered by the generic function; (4) a recurring occasion already turned into a real plan for its
current upcoming date (`occasions.resulting_plan_id`/`last_planned_at`, from "Occasion
architecture should not be a silo" below) is skipped — don't nag about something already planned;
the ~350-day window is a disclosed approximation, since this table has no per-year-instance
concept to check exactly. The new push type, `occasion_upcoming`, carries the structured
`who_for_name`/`who_for_friend_id` fields (one consistent payload shape for every occasion type,
replacing each old type's own narrower field names) — `notifications.js` routes it generically
into `CelebrateSomethingScreen`'s existing `initialOccasion`/`initialWhoFor`/`initialWhoForName`/
`initialWhoForFriendId` route params (all pre-existing infrastructure from the birthday/
anniversary nudges, confirmed still correctly consumed) rather than each type inventing its own
routing case.

Client completeness fix bundled in: `OccasionsScreen.js`'s own manual-entry chip list was a
hardcoded 6-value list missing 5 real values the schema has allowed since the Sep 16 vocabulary
expansion (baby_shower/engagement/housewarming/promotion/farewell) — a real gap now that every
one of them gets its own proactive nudge. Fixed by sourcing it from a new shared
`PERSONAL_OCCASION_TYPE_KEYS`/`personalOccasionTypeOptions()` (`businessAttributes.js`, derived
from `OCCASION_OPTIONS`, same "one ontology" discipline as `CELEBRATE_OCCASION_KEYS`) instead of
its own copy, so this screen can never drift from what the table actually allows again. This
surfaced `life_event` needing to be added to `OCCASION_OPTIONS` itself (it existed in the DB CHECK
since the original `20260914_occasions.sql` but had no display label anywhere) — added, but
deliberately kept out of `CELEBRATE_OCCASION_KEYS`/`CALENDAR_SAVEABLE_OCCASION_KEYS` (the wizard's
own occasion picker): it stays a personal-record/manual-entry-only catch-all, never something
picked from scratch mid-wizard.

That exposed one real downstream bug, fixed via `20261023_life_event_occasion_downstream_fix.sql`:
`life_event` was never added to `business_requests.occasion`'s or `occasion_group_plans
.occasion_type`'s own CHECK constraints when the Sep 16/20 migrations widened everything else —
harmless while nothing could ever nudge about a life_event occasion, but now that
`send_occasion_planning_nudges()` proactively nudges about every type, a real recipient tapping a
life_event push and picking a business-destined activity or "Let the Group Vote" would hit a real
INSERT failure. Fixed by widening both CHECK constraints to accept `life_event`, nothing broader —
still not added to the wizard's own selectable chip list, per the reasoning above.

Verified live against production (`enmosvippabmuqslzrox`): both migrations were already applied
before the restart that interrupted this session — confirmed via direct queries showing
`send_occasion_planning_nudges()`/`send_birthday_planning_nudges()` present and
`send_anniversary_planning_nudges()` gone, the `send-occasion-planning-nudges` cron job scheduled
(daily 9am) and `send-anniversary-planning-nudges` removed, and all 3 widened CHECK constraints
(`business_requests_occasion_check`/`brand_partners_priority_occasions_check`/
`occasion_group_plans_occasion_type_check`) live with `life_event` present. The three client files
left uncommitted by the same restart (`businessAttributes.js`, `OccasionsScreen.js`,
`notifications.js`) were re-read in full this session, checked against the migrations and against
`CelebrateSomethingScreen.js`'s real existing route-param handling, and found correct and
complete — nothing needed to be redone. Full Jest suite 335/335 passing; all three touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app or
against a real device (no simulator/device tooling this session, standing note) — push
notifications specifically can't be end-to-end verified without a real device token.

**"Occasion architecture should not be a silo" — fully DONE (2026-09-12), same-day direct user
follow-up to "Group planning for an Occasion" below.** User's own list: an Occasion should carry
occasion type / person being celebrated / date / participants / preferences / plan / location /
business / status / notifications, reusing the existing categories/people/gathering/intent/
business/notification systems rather than building a parallel stack — "Nearby remembers the
moments worth doing something about, and helps you make them happen" as the stated bigger vision.

Audited the real current model (`occasions` + `occasion_group_plans`, both already built in prior
sessions) against that list field-by-field before writing anything. Verdict: the model already
satisfies almost all of it by genuine reuse, not duplication — occasion type/date/participants/
business/notifications all already flow through the real shared systems (friendships/matches for
participants+eligibility, resolveIntent()/business_requests for business, the existing
notify_planning category for pushes). "Preferences" deliberately gets no new stored field — it's
already served by the shared intent-resolver scoring system (favoriteBusinessBonus/pastPlanBonus/
attributeAndCuisineBonus/occasionBonus in `intentResolverScoring.js`); duplicating it onto the
occasion would be exactly the second copy this request warned against. "Location"/"business"
likewise stay unstored directly on the occasion — they already live on whichever real gathering/
business_request the occasion's plan link (below) points to.

One real, concrete gap found: once a celebration was actually acted on (a real gathering or
business_request created downstream via CelebrateSomethingScreen's existing hand-off), neither
`occasions` nor `occasion_group_plans` ever learned that happened — the already-existing unified
`plans` object (Phase G, `20260914_plans_unified_object.sql`) sat right there as the intended
cross-system pointer for exactly this, populated by triggers on gatherings/business_requests, but
nothing had ever linked an Occasion to it. Closed via `20261021_occasion_plan_linkage.sql`: (1)
`occasions` gains `who_for_name`/`who_for_friend_id` — the same structured "person being
celebrated" shape `occasion_group_plans` already had (title previously conflated person+occasion
as free text with no queryable field behind it); (2) both tables gain `resulting_plan_id` (a real
FK into `plans`), `occasions` also gains `last_planned_at` — an honest, derived-from-a-real-link
"was this acted on" signal rather than a fabricated status enum with its own separate lifecycle to
keep in sync; `occasion_group_plans.status` gains a real 4th value, `'fulfilled'`, set the moment a
resulting plan is linked (safe for this table specifically since, unlike the recurring `occasions`
table, a group plan is a genuinely one-time object); (3) two new SECURITY DEFINER RPCs
(`link_occasion_to_plan`/`link_occasion_group_plan_to_plan`) do the actual linking — each looks up
the real `plans` row the existing triggers already created for whichever resulting gathering/
business_request id the client passes, and is a safe no-op (never an error) if that row isn't
found yet, since both are always called best-effort/non-blocking right after the real creation
call already succeeded. `get_upcoming_occasions()` was widened to return the new columns (explicit
`drop function` first, per this repo's own RETURNS TABLE column-list gotcha).

Client wiring: `CelebrateSomethingScreen.js` now awaits its own optional "save to calendar" insert
(previously fire-and-forget) so it has the real created occasion id to link, tracks a new
`groupPlanId` state (threaded from a decided group-vote re-entry via
`resolveDecidedGroupPlanParams(decided, groupPlanId)`'s new second argument), and calls the
appropriate link function right after a real business_request or gathering is actually created —
covering both structured destinations (`submitSelectedBusinessRequests` for the business path,
`CreateGatheringScreen.js` for the gathering path, given a new `linkOccasionId`/
`linkOccasionGroupPlanId` route param pair). The 'custom' destination (hands off to
CreateHubScreen's free-text AI box) is deliberately NOT linked — genuinely open-ended, no
structured resulting object to link to, disclosed rather than silently skipped.
`GroupOccasionPlanScreen.js` now renders a distinct "✅ Turned into a real plan!" state once
fulfilled (still lets any other participant keep finding their own options, matching this object's
existing multi-actor shape); `OccasionsScreen.js` shows a real "✅ Planned" badge sourced from
`resulting_plan_id`.

Verified live against production via a comprehensive disposable rolled-back transaction (real
occasion linked to a real plan row; a non-owner correctly rejected; a decided group plan linked by
a non-host participant transitions to `fulfilled` and points at *that participant's own* created
plan, never another's; a non-participant correctly rejected; linking a still-voting plan is a safe
no-op; `get_upcoming_occasions()` round-trips the new columns) before applying for real; re-
confirmed live afterward (columns, widened status CHECK, both new functions, and zero `anon`
grant leak all present). Full Jest suite 335/335 passing (5 new/updated tests); all eight touched
files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running
app (no simulator/device tooling this session, standing note) — next session should confirm on a
real account that a decided group plan's "Find Options Nearby" submission actually flips
`GroupOccasionPlanScreen` to the fulfilled state and that OccasionsScreen shows the "✅ Planned"
badge after a solo (non-group) occasion's calendar-saved wizard flow completes.

**"Group planning for an Occasion" (Sarah's 30th Birthday example) — fully DONE (2026-09-12),
direct user follow-up to the Occasion rename/simplify pass below, picked up after a codespace
restart mid-build.** Found at session start: `supabase/migrations/20261020_occasion_group_plans.sql`
already written, uncommitted, and already applied live in production (confirmed via the
Management API) from the interrupted prior session — 4 new tables
(`occasion_group_plans`/`_participants`/`_options`/`_votes`, all RLS-enabled with zero client
policies, every access through a SECURITY DEFINER RPC, same posture as
`recommendation_push_log`) plus 7 RPCs (create/respond/propose/vote/decide/cancel/list). No
client code existed yet for it. User's own example: create the occasion, invite 8 friends,
everyone proposes/votes on what to do (Italian dinner/Bowling/Concert), Nearby turns the winner
into a real plan via the existing business pipeline — occasion → people → group decision →
activity → business → reservation. User's own explicit guardrail, honored throughout: no complex
RSVP systems, no elaborate invitations, no gift registries, no seating charts, no massive event
pages, no complicated calendars — just Remember → Plan → Invite → Find something → Connect
business → Do it.

Shipped: `CelebrateSomethingScreen.js`'s 'activity' step gained a real, distinct "🗳️ Let the Group
Vote" choice (not an 8th equivalent activity type — rendered separately below the main row) that
branches the wizard to a new 'group_invite' step (pick real connected friends, same friends-list
mechanism the 'who_for' step already used) instead of 'options'/'who_involved'. Choosing it calls
the already-live `create_occasion_group_plan` RPC and hands off to a new
`GroupOccasionPlanScreen.js` — invitees accept/decline, propose ideas (reusing the wizard's own 7
`ACTIVITY_OPTIONS`, now exported from `celebrateSomething.js` as a single source of truth instead
of a second copy), and vote, all live via a Postgres realtime channel subscription (same
whole-screen-refetch-on-any-event shape `GroupPlanScreen.js` already established). The host
picking a winner (`decide_occasion_group_plan`) hands straight back into
`CelebrateSomethingScreen` already past occasion/who-for/activity/when
(`resolveDecidedGroupPlanParams()`, new pure function, 3 new Jest tests) — the wizard's own
`initialStepFor()` now recognizes a fully-decided entry and skips straight to that activity type's
real last step (business 'options' pipeline, or gathering/custom 'who_involved'), so nothing the
group already answered gets re-asked. `notifications.js` routes both new push types
(`occasion_group_plan_invite`/`occasion_group_plan_decided`) to the new screen.
`OccasionsScreen.js` gained a "Group Plans" section (via `getMyOccasionGroupPlans()`) as a real,
durable, non-push entry point back into an open or decided plan — per this repo's own "no dead
ends" convention.

Verified live against production via disposable rolled-back transactions covering every RPC and
every authorization boundary before treating the DB layer as done: invite eligibility (a real
connected friend gets invited, an unconnected stranger is silently skipped), accept/join,
propose + vote (vote count correct), a non-participant blocked from both voting and reading plan
detail, a non-host blocked from deciding, the decide payload's exact shape (occasionType/title/
whoForName/whoForFriendId/whenPreset/scheduledDate/activityType/label/partySize — matches
`resolveDecidedGroupPlanParams()`'s own expected input field-for-field), proposing blocked once
decided, the plan correctly listed for its host via `get_my_occasion_group_plans`, cancel +
double-cancel correctly blocked, and a zero-invitee creation (`array[]::uuid[]`) not crashing —
all rolled back afterward with zero rows left in any of the 4 tables (confirmed via a live count
query). Full Jest suite 333/333 passing; all touched/new files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that the "Let the
Group Vote" chip, the invite/propose/vote realtime flow, and the hand-back into
CelebrateSomethingScreen's business-options step all render and behave correctly on a real
screen, and that both new push types deep-link correctly from a real device.

**"I'd call the whole feature 'Occasions' ... I wouldn't clutter Create with 10 separate
buttons" — fully DONE (2026-09-12), same-day direct follow-up to the anniversary nudge below.**
Two real changes, both per the user's own mock verbatim: (1) renamed the "Celebrate Something"
wizard to "Occasion" everywhere user-visible — `RootNavigator.js`'s nav title is now "Create an
Occasion" (was "Celebrate Something"), the wizard's own in-body header now reads "🎉 Create an
Occasion". Internal identifiers (the `CelebrateSomethingScreen.js` file, the `'CelebrateSomething'`
route key, the `celebrateSomething.js` service) were deliberately left unrenamed — not user-
visible, and renaming them would risk exactly the collision this rename has to avoid: this app
already has a real, different, pre-existing `OccasionsScreen.js`/`'Occasions'` route (a personal
reminder log, Phase H, Sep 14 2026). Resolved the same way this app already distinguishes
Gathering/Gatherings and Community/Communities — singular "Occasion" = create this one (the
wizard), plural "Occasions" = browse/manage what you've already logged (the pre-existing,
untouched screen). (2) Restructured `CreateHubScreen.js`'s entire top-level layout, which had
grown to a big activity-category icon grid plus 3 more grouped rows (With people/With businesses/
For an occasion) plus a second "bigger" secondary row — into exactly 3 large primary cards
(Gathering "Bring people together." / Community "Build something ongoing." / Occasion "Plan a
birthday, anniversary, milestone or celebration.", taglines copied verbatim from the user's mock),
the screen's one clear visual hierarchy. Every other real action the screen used to offer (Invite
Friends/Plan a Date/Meet New People/Ask Nearby Businesses/Start a Weekly Meetup/Something Else)
was kept, not deleted — the user asked for the primary view to stop looking cluttered, not for any
of that real, working functionality to disappear — demoted into one small flat "Quick Actions"
list below the 3 cards, the same demotion precedent this screen's own former "Want to build
something bigger?" row had already established. The old activity-category quick-pick grid
(Coffee/Dinner/Hiking/etc.) is the one thing not preserved on this screen specifically — verified
first that `CreateGatheringScreen`'s own "What" step already has a complete category picker, so
the grid was always just a skip-a-step shortcut, and the identical category set is also still
reachable from Home's own Quick Picks row (a separate, unmodified consumer of the same
`CREATE_HUB_OPTIONS`/`SUB_OPTIONS` constants this screen used to import its own copy of that grid
from). "Create a Community" (the old secondary row's own link) was removed as now-redundant with
the new Community primary card; "Start a Weekly Meetup" was kept (a real, distinct sub-flow of
Gathering, not redundant with anything). Full Jest suite 330/330 passing; all three touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note) — next session should confirm the 3-card
layout and the "Something Else" AI box (now reached via the Quick Actions list instead of a grid
tile) both render and behave correctly on a real screen.

**"Anniversaries could work the same way" — fully DONE (2026-09-12), same-day direct follow-up to
the birthday planning nudge below.** Two parts, both shipped: (1) a new push,
`send_anniversary_planning_nudges()` (`20261019_anniversary_planning_nudge.sql`), mirrors the
birthday nudge's mechanism but at a 14-day lead (per the user's own example) and from a single
real source — a self-logged `occasions` row of type 'anniversary' (no structural
`profiles.anniversary_date`-style column exists for this occasion type, unlike birthday). When
the occasion's own `connected_user_id` is set (only ever true when the Celebrate Something
wizard's "save to calendar" step originally attached a real, explicitly-picked connected friend/
match), the push carries that id + the partner's real `display_name`, letting the client deep-link
straight past the wizard's "who's this for" step the rich way, exactly like birthday's connected-
friend case; otherwise it falls back to occasion-only prefill. (2) The user's own broader ask —
"Nearby could use preferences, previous activities, favorite businesses, location, availability,
budget, past plans to suggest options" — audited against what `resolveIntent()` (the same
resolver the wizard's own "Options" step already calls, Item 61 fast-follow) already used:
location/availability/preferences were already real scored signals; "previous activities"/"past
plans" and "favorite businesses" were not. Closed both as two new real, non-fabricated scoring
bonuses in `intentResolverScoring.js` — `favoriteBusinessBonus()` (a business the caller has
explicitly followed, `business_followers`) and `pastPlanBonus()` (a business the caller has a
real past accepted/completed `business_request_offers` row with — genuine repeat-visit affinity,
never a browse/view) — fetched once per `resolveIntent()` call via new
`getMyBusinessAffinitySignals()` (`businessFulfillment.js`, best-effort, fails open to empty sets,
same non-blocking-parallel shape as the existing weather fetch) and wired into
`resolveBusinessAvailability()`'s scoring + `getBusinessAvailabilityReasons()`'s "why" text ("You've
been here before" / "A business you follow"). This benefits every `resolveIntent()` caller (Home's
ask box, Discover search, the wizard), not just anniversary. **Budget deliberately NOT built as a
third bonus** — no real, non-fabricated per-user budget signal exists to derive one from yet
(disclosed gap, not silently skipped). Verified live against production via disposable rolled-back
transactions (a connected-partner anniversary and a solo one both fire exactly once at the 14-day
mark with correct payloads; a wrong-lead-time occasion correctly doesn't fire) before applying the
migration for real; function + cron job (`send-anniversary-planning-nudges`, daily 9am) confirmed
live afterward. New Jest coverage for both scoring functions; full suite 330/330 passing; all five
touched files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a
running app or against a real authenticated session (no simulator/device tooling this session,
standing note) — the new `business_followers`/`business_request_offers` client queries reuse an
already-established `!inner()` join pattern from `homeDashboard.js` but weren't run against a real
signed-in user this session.

**"Birthday reminders as a recurring retention mechanism" — fully DONE (2026-09-12).** Direct
user follow-up, resumed after a codespace restart mid-build (uncommitted work found at session
start: a new migration file plus edits to `CelebrateSomethingScreen.js`/`celebrateSomething.js`/
`notifications.js` — all read in full, checked against the request, and found correct and
complete; nothing needed to be redone, only verified and shipped). A new push,
`send_birthday_planning_nudges()` (`20261017_birthday_planning_nudge.sql`), fires exactly 7 days
before a real birthday — once per person per year — from two real sources: a connected friend/
match's own `profiles.birthdate`, or a self-logged `occasions` row of type 'birthday' (covers a
non-Nearby-user person, e.g. "Mom" — same case Item 61's own same-day fast-follow addressed).
Distinct from the existing `send_birthday_reminders()` (fires same-day, "happy birthday" framing,
lands on a bare profile — left completely untouched). This one's push ("Sarah's birthday is in 7
days. Plan something?") deep-links straight into the Celebrate Something wizard, pre-seeded with
the real occasion + who-for so the user lands directly on "What would you like to do?" (Dinner |
Party | Activity | Surprise — the wizard's existing `ACTIVITY_OPTIONS` already matched the user's
own example verbatim, no new options needed) rather than re-answering what the push already knew.
Gated on the recipient's own `notify_social` preference (Item 29's category taxonomy). Verified
live against production via disposable rolled-back transactions — both positive cases (friend-
birthdate source and self-logged-occasion source each fire exactly once at the 7-day mark, with
the correct recipient/body) and negative cases (wrong day, `notify_social = false`) confirmed
before applying for real; confirmed live afterward (function + cron job both present). Full Jest
suite 323/323 passing; all four touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — push notifications specifically can't be end-to-end verified without a real
device token. Commit: `724b66d7`.

**Item 61 fast-follow ("don't require the celebrated person to be a Nearby user") — fully DONE
(2026-09-12), same day, direct user follow-up.** User's own example: planning a mother's birthday
should work by just typing "Mom" and her birthday — she should never need a Nearby account.
The wizard's "who is this for" step already satisfied this (free text, never gated on picking a
real friend) — but a real, pre-existing bug undermined it specifically for birthdays: both the
wizard's "save to calendar" step (this session's own earlier work) and the standalone
`OccasionsScreen.js` (Phase H, Sep 14 2026, predates this session) excluded 'birthday' entirely,
reasoning "`profiles.birthdate` + the existing Home nudge already own that signal" — true only for
a real connected Nearby user, never for someone who isn't one at all, which is exactly the case
this request is about. Confirmed live in the schema before changing anything: 'birthday' has
always been a legal `occasion_type` value (`20260914_occasions.sql`'s own original CHECK) — this
was purely a UI gap in both places, no migration needed.

Fixed both: `shouldOfferCalendarSave()` (`celebrateSomething.js`) now takes a second
`hasConnectedNearbyUser` argument and only excludes 'birthday' when a real, explicitly-picked
connected friend/match is attached (never inferred from a hand-typed name) — `recursAnnually`
also now defaults true for birthday, not just anniversary. `CelebrateSomethingScreen.js`'s three
call sites pass `!!whoForFriendId`. `OccasionsScreen.js` — the general, standalone "add an
occasion for anyone" surface, not just the wizard — gained 'birthday' as a 6th selectable chip
(its header comment's original reasoning corrected) and an updated subtitle clarifying this is for
anyone, including someone not on Nearby, with a note not to double-enter a connected friend's
birthday since that's already automatic. `HomeScreen.js`'s existing `OCCASION_TYPE_ICONS` already
had a defensive `birthday: '🎂'` entry for a case its own comment said "couldn't happen" — it can
now genuinely happen, comment corrected; the existing birthday-nudge and occasion-nudge cards are
already fully independent (can both render at once, confirmed by reading the render condition),
so no collision risk between a connected friend's automatic nudge and a manually-added one for a
different (non-Nearby) person. New Jest coverage for the new `shouldOfferCalendarSave` signature.
Full suite 320/320 passing; all five touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note).

**Item 61 ("Celebrate Something" life-events planning layer) — fully DONE (2026-09-12).** Full
architecture rationale: `PRODUCT_AUDIT/CELEBRATE_SOMETHING_2026-09-12.md`. User's ask: a new
Create-tab entry point walking through occasion → who's it for → what to do → when → who's
involved, then turning that into a real plan. Picked up after a codespace restart mid-build — the
DB layer, the wizard screen, the Create-tab entry point, `CreateGatheringScreen`'s
`quickStartWhenPreset`/`quickStartWhenISO` prefill, and both edge functions' widened
`VALID_OCCASIONS` prompts were all already written locally but neither deployed nor committed;
this session verified each piece, closed one real remaining gap, and shipped.

Shipped as a pure client-side orchestrating wizard (no new entity) — `CelebrateSomethingScreen.js`
collects occasion/who-for/activity/when/who-involved via `src/services/celebrateSomething.js`'s
pure routing functions, then hands off to an existing real screen with full prefill:
`AskBusinessScreen` for Dinner/Night out/Activity, `CreateGathering` for Party/Surprise/Weekend
trip, `CreateHubScreen`'s "Something Else" AI box for Custom. DB layer
(`20261016_celebrate_occasion_vocabulary_expansion.sql`, widening `business_requests.occasion`/
`brand_partners.priority_occasions`/`occasions.occasion_type` with 7 new life-event values) was
already live from the prior session. Both edge functions' updated `VALID_OCCASIONS` lists/prompt
examples were found NOT yet live (confirmed by pulling the deployed function bodies via the
Management API and grepping for the new keys — the deployed prompt still collapsed "promotion"/
"graduation" into generic "celebration") — redeployed
(`npx supabase functions deploy <name> --project-ref enmosvippabmuqslzrox`) and reconfirmed live
via the same body-pull-and-grep method.

One real gap closed this session, not present in the pre-restart build: the working doc's own
locked design named an optional "save to my calendar" step (the reason `occasions.occasion_type`
was widened at all), but the wizard as found had no such step — `CALENDAR_SAVEABLE_OCCASION_KEYS`
(`businessAttributes.js`) existed but was unused anywhere. Added a checkbox on the final step,
shown only for genuinely calendar-worthy occasions (excludes birthday — already has its own
dedicated signal — and other — too generic), that calls the existing `addOccasion()` RPC wrapper
non-blocking (an optional side effect never gates the real navigation). New
`shouldOfferCalendarSave()`/`buildOccasionSaveParams()` pure functions in `celebrateSomething.js`
(6 new Jest tests) — `recursAnnually` defaults true only for `anniversary`, every other
calendar-saveable occasion is a real one-time date. A friend picked from the wizard's own chip
list (not a free-typed name) now carries its real `connectedUserId` through to the saved
occasion, cleared whenever the name is hand-edited so a stale id can never attach to the wrong
person. Full Jest suite 316/316 passing; all seven touched/new files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note).

**Item 61 fast-follow ("connect it to businesses") — fully DONE (2026-09-12), same day, direct
user follow-up.** User's own example: "It's my friend's 30th birthday, plan something for 10
people" should assemble a real multi-part plan (Dinner + Something Fun) with real live business
options, not just a single prefilled ask. Real finding before writing code: the exact machinery
this needed already existed from the 2026-09-10 "Experiences assembly" work —
`experienceTemplates.js` already has a real birthday/anniversary template (Dinner + Something
Fun + Sweet Treat), and `resolveIntent()`/`assembleExperience()` already assemble real, already-
scored `business_availability`/`gathering` candidates into those components — just never wired
into anything the wizard could reach, since `resolveIntent()` was only ever driven by free-text
AI classification (create-assistant) before this.

Shipped: for a business-destined activity type (dinner/night_out/activity), the wizard's final
step is now a real live-options step ("Nearby found these options") that calls `resolveIntent()`
directly with the wizard's own already-collected structured answers (occasion/when/party size) —
no free text, no AI classification needed, since these are ground truth, more precise than
anything AI would re-extract from typed prose. This step *replaces* the "who's involved" question
for this destination rather than adding a 6th step — that question was already vestigial for a
business ask (its answer, `whoInvolved`, was collected but never actually used in the business
branch of `proceedToDestination()`, confirmed by reading the code, not assumed). Every other
destination (gathering/custom) keeps "who's involved" exactly as shipped. Added a new, optional
"How many people?" chip row (2/4/6/8/10+) to the "What" step — feeds `resolveIntent()`'s own real
hard capacity filter and the submitted request's `party_size` column; left unset is honest and
common, never defaulted.

Real options render as: a business's own self-declared multi-component "Experience Bundle" first
(when one exists), then each template component (e.g. 🍽️ Dinner, 🎉 Something Fun) with its own
real top-3 candidates as checkboxes; a `gathering`-type candidate (a real thing already happening
that fills a component) renders as a plain tap-to-view row instead, since a business_request can't
be sent against a gathering. "Ask These Businesses (N) →" submits one real `submitBusinessRequest`
per selected candidate in parallel, each bound via `preferredAvailabilityId` (same "skip straight
to offered" mechanism Item 53's own single-pick "Find options nearby" already uses on
AskBusinessScreen, extended here to several at once) — a single success lands on that request's
own real `BusinessRequestDetail` exactly like a normal solo ask; several land on the `Plans` tab,
where each is already independently visible (Item 52). "Skip — I'll post a general request
myself →" always stays available, reusing the exact original prefill-into-AskBusinessScreen path
unchanged (never a forced choice). The optional save-to-calendar checkbox (this session's earlier
fix) moved from the now-replaced "who's involved" step to the "When" step so it still applies
regardless of destination — fires from both the skip path and the new submit path. A real
staleness guard resets the fetched options whenever the user goes back and changes occasion/
activity/when/party size, so a stale result never silently survives an edited answer.

Deliberately did NOT extend `experienceTemplates.js` with new templates for the 7 new life-event
occasions (graduation/baby_shower/engagement/housewarming/promotion/farewell/milestone) — same
disclosed, intentional scope boundary the original Item 61 DB migration already drew for business-
side bundles; those occasions still get a real flat (non-templated) options list via
`resolveIntent()`'s own `items`, just no multi-component assembly. New `dateWindowForWhenPreset()`
pure function (`celebrateSomething.js`, 3 new Jest tests) maps the wizard's own deterministic
WHEN_PRESETS key onto `resolveIntent()`'s real dateWindow vocabulary. Full Jest suite 319/319
passing; all three touched/new files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app or against real business_availability data
(no simulator/device tooling this session, standing note) — next session should confirm on a real
account that the assembled birthday/anniversary experience renders correctly, that a multi-select
submission creates the right number of distinct `business_requests` rows each bound to its own
picked posting, and that the Plans-tab landing after a multi-submit shows all of them.

**Item 60 ("the CEO test," first-time-user obviousness) — fully DONE (2026-09-12).** All 5
questions (What is Nearby? / What can I do here? / How do I find something? / How do I meet/
connect with someone? / How do I actually make something happen?) PASS — each answer is obvious
from real on-screen copy/navigation with no chained explanation needed, per a full code trace of
the signed-out onboarding flow, Home, Discover's mode toggles, and the primary CTAs on Gathering/
Profile/Business detail screens. Two small, real first-impression soft spots found and fixed (both
copy-only, no navigation change): Home's rotating ask-box placeholders were 100% activity-shaped
with no hint that meeting people is also part of the app (added "Meet new people…," a real,
already-supported intent phrase); the Quick Stats "N people nearby" row read as a passive stat
rather than an action (reworded to "N people nearby to meet"). Full detail:
`PRODUCT_AUDIT/CEO_TEST_2026-09-12.md`.

**Item 59 ("the Thursday acceptance test," 5 end-to-end journeys) — fully DONE (2026-09-12).** All
5 journeys traced and verified against real current code; 6 real bugs found and fixed (friend-plan
mislabeling, 3 dating-language leaks in Chat, 1 dormant `plans.status` mapping gap), 2 real
scope-decision gaps disclosed but not built (Plan Together's menu placement; the host-only
gathering Plan CTA). Full detail: `CLAUDE_HISTORY.md`, search "Item 59"; per-journey trace detail:
`PRODUCT_AUDIT/THURSDAY_ACCEPTANCE_TEST_2026-09-12.md`.

**Item 57 ("the N mark should become part of the product language") — fully DONE (2026-09-12).**
User's own framing: use the redesigned N mark consistently beyond the app icon (loading, empty
states, "perhaps" success confirmation, subtle brand transitions, notification identity) but
"don't overdo it — the goal is for the N to become recognizable, not become decoration
everywhere." A research fork first confirmed real infrastructure already existed: a real,
approved SVG brand component (`src/components/brand/NearbyMark.js`, variants gradient/white/
black, "works on any background per the approved brand sheet" per its own header comment) already
used on Login/Onboarding/BusinessWeb, plus `BrandedLoader.js` already using the same mark (as a
raster PNG) at `RootNavigator.js`'s boot gate. **Loading and notification identity were both
already fully shipped** before this item — `BrandedLoader`'s gate (`loading ||
(session && profileLoading)`) already catches the sign-in transition too since `profileLoading`
flips true immediately on a fresh sign-in, and `app.json`'s `notification-icon.png` +
`color: '#FF5A5F'` (Android status-bar icon, confirmed still current) already gives every push its
own brand identity — no code needed for either. The three real remaining bullets were each
deliberately scoped to a small, concrete set of genuine moments rather than a blanket retrofit:
- **Empty states**: `NearbyMark` (small, muted/low-opacity) added to `LoadErrorState.js` — the
  one shared "couldn't load" component reused broadly across the app, so this single change
  reaches every screen that already uses it, rather than a per-screen retrofit. Also added to the
  3 real self-contained empty-state *blocks* (not the many inline single-line empty texts buried
  inside dense multi-section screens like `CommunityDetailScreen`/`GroupPlanScreen` — deliberately
  skipped those, since adding an icon to inline text mid-scroll would tip toward clutter, not
  identity): `BusinessRequestDetailScreen.js` ("no businesses responded yet"),
  `MomentumScreen.js` (empty weekly chart), `MakeAPlanScreen.js` ("no friends yet") — all three
  already gained real next-action CTAs in Item 56, which is what makes them genuine, deliberate
  empty-state moments rather than throwaway text.
- **Success confirmation** (the user's own softest ask — "perhaps"): `GatheringConfirmationScreen.js`,
  the app's one real, already-existing celebration screen, gained a small spring-in `NearbyMark`
  above its existing 🎉 emoji (same `Animated.spring`/`timing` entrance shape
  `MatchCelebrationModal.js` already established for a celebration moment) — an addition, not a
  replacement for the emoji's own fun/expressive energy. Deliberately did NOT build new success UI
  for community creation, business-offer-accept, or group-plan-confirm — all four currently have
  *no* dedicated success UI at all (confirmed by the research fork: community creation is a bare
  `Alert.alert`, the other two are silent state re-renders) — building 4 new celebration surfaces
  from scratch is a bigger scope decision than "extend an existing mark," and risks exactly the
  "decoration everywhere" the request warned against. Flagged as a real, disclosed, not-built
  opportunity rather than assumed out of scope.
- **Subtle brand transitions**: `RootNavigator.js`'s sign-out and onboarding-complete flips (both
  instant `Stack.Navigator` children swaps with zero transition before this — confirmed by the
  research fork, not assumed) now show one brief (450ms) `BrandedLoader` beat — reusing the
  existing component, not a new one — triggered by real state-change detection
  (`prevSessionRef`/`prevProfileCompleteRef` comparing against the previous render, never firing
  on initial mount).

Full Jest suite 295/295 passing; all six touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm the 450ms transition beat feels right in practice
(picked as a reasonable estimate, not measured against a real device) and that the empty-state
mark's muted opacity reads as "quiet identity" rather than "washed-out icon" on a real screen.

**Item 56 ("no dead ends") — fully DONE (2026-09-12).** Direct product requirement, locked as a
standing convention (see below): no major surface should end with unactionable "nothing here"
copy — always a concrete, tappable next step (Demand → supply → activity → engagement, in the
user's own words). Items 25/26 (2026-09-11) already did a big pass on this exact problem; this
item re-audited the whole app (background fork) against that baseline, specifically to catch
surfaces built or changed in the items since (27-55). Found and fixed 4 real remaining gaps:
`PlansScreen.js` (all 3 tabs had a text-only empty state — now "+ Host a Gathering"/"Explore
Things To Do"), `MomentumScreen.js` (weekly chart empty state, now "Explore Things To Do"),
`BusinessRequestDetailScreen.js` ("Try a Wider Radius" only ever rendered once, right after
submitting with `notifiedCount === 0` — now renders whenever the request is still open with zero
offers, and its prefill fields fall back to the real fetched request row's own columns when
route.params carry none, e.g. a revisit via push tap), `MakeAPlanScreen.js` ("no friends yet" had
no way to actually go add one — now links to `FriendDiscovery`). One low-priority candidate
(`RecommendationCustomizePanel.js`'s "add interests" copy) was initially left unfixed — no real
existing route anchored directly to the interest editor (an inline `ProfileScreen` section, not
its own screen) — **closed same day, per direct user request ("do the one low priority case"):**
rather than guess a destination, built a real scroll-anchor the same way this app already solves
"land on the right part of an existing screen" elsewhere (`scrollToGenderSection`/
`scrollToPreferences`) — a new `scrollToInterestsSection` route param on `ProfileScreen.js`
(`interestsSectionYRef` + `onLayout` + a route-param `useEffect`, identical shape to those two
precedents) scrolls straight to the real interest picker; `RecommendationCustomizePanel.js` gained
an `onPressAddInterests` prop, wired from both `SettingsScreen.js` call sites to
`navigation.navigate('Profile', { scrollToInterestsSection: true })`. Full Jest suite 295/295
passing; all three touched files transform-checked clean. Not exercised in a running app (no
simulator/device tooling this session, standing note) — next session should confirm the scroll
lands on the interests section specifically. Commit: `d7998ce0`. Full audit also confirmed a long
list of surfaces already correct from the Items 25/26 baseline (`DiscoveryScreen`/
`FriendDiscoveryScreen`/`MatchesScreen`/`FriendsScreen`/`CommunitiesScreen`/`GatheringsScreen`/
`DiscoverHubScreen`/`PlacesScreen`/`BusinessDashboardScreen`/`ChatScreen`/`RewardsScreen`/
`OccasionsScreen`/`CommunityDetailScreen`/`AskBusinessScreen`/`SurpriseMeSheet`/`ProfileScreen`),
plus 2 genuinely passive/analytics states in `GroupPlanScreen.js` correctly left honest (no
obvious retry destination exists for those, same precedent Item 25 batch 4 already set for
BusinessDashboard's own passive states). Full Jest suite 295/295 passing; all five touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note).

**Item 55 ("deep links should preserve context too") — fully DONE (2026-09-12).** A notification
tap used to dump the user onto a bare `GatheringDetail` with zero explanation of why they were
there — e.g. `notify_gathering_interest()` (a host learns someone's interested in their own
gathering) and `notify_gathering_interest_threshold()` (a stranger learns real nearby interest
matches their own tastes, `recommended_gathering`) both already compute a real, specific reason
sentence for the push body, but `routeNotificationTap()` only ever forwarded `gathering_id` —
the reason itself was read once, then thrown away.

Fixed by carrying the push's own real body text through as a route param, rather than inventing
new copy: `notifications.js`'s two `Notifications.*` listener call sites now merge the
notification's top-level `body` onto its `data` payload (`contentWithBody()`) before routing, and
the `gathering_interest`/`recommended_gathering` cases pass `notificationReason` (the literal real
sentence the user already read) through to `GatheringDetail` — plus `notificationSuggestsInvite:
true`, since those two are the only gathering-notification types where "Invite Friends" is
genuinely the one obviously-correct next step (capitalizing on real momentum). Every other
gathering-shaped push type (invite/reminder/waitlisted/updated/recurring) now also carries
`notificationReason` for its own real reason banner, but deliberately without the invite CTA —
there's no single obviously-correct action to force for those, and forcing one anyway would
violate the same "don't notify about things you can't act on" discipline Items 48/49 already
established for the push itself. `GatheringDetailScreen.js` renders a dismissible banner at the
very top of its content (before the title) showing that real reason text, with an inline "🤝
Invite Friends" button (reusing the exact same `InviteFriendsModal`/`setInviteModalVisible` every
other Invite link on this screen already uses — confirmed generic over host/attendee/not-yet-
joined callers alike, so it's safe for the `recommended_gathering` case where the recipient hasn't
joined yet) when `notificationSuggestsInvite` is set. Not built as a new "Plan" step beyond
View→Invite: for a gathering specifically, the gathering itself already *is* the plan — there's no
honest third stage to add without fabricating one.

Scoped to gathering-shaped notifications only, matching the user's own example exactly — the same
"real reason + obvious action" banner mechanism is a real fast-follow candidate for other detail
screens reached by notification (`BusinessRequestDetail`, `CommunityDetail`, etc.) but wasn't
built for those now; flagged here rather than assumed. Full Jest suite 295/295 passing (no new
pure functions to test — pure UI/routing wiring over already-computed, already-live push text);
both touched files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised
in a running app or against a real push notification (no simulator/device tooling this session,
standing note) — next session should confirm on a real device that a tapped `gathering_interest`/
`recommended_gathering` push shows the correct real reason text and that "Invite Friends" opens
the existing modal correctly from that banner.

**Item 55 fast-follow #1 (`BusinessRequestDetail`) — fully DONE, same day (2026-09-12).** Picked
up in-flight, uncommitted work interrupted by a codespace restart mid-session, then finished and
committed (`155ef16d`). Closes the first of the two concrete candidates the paragraph above
flagged as not-yet-built: a `business_offer_received`/`business_offer_withdrawn`/
`business_reservation_cancelled` notification tap now carries the push's own real body text
through as `notificationReason` (`notifications.js`, same `data.body ?? null` shape the gathering
cases already use), rendered by `BusinessRequestDetailScreen.js` as the same dismissible banner
at the very top of its content, styled identically to `GatheringDetailScreen`'s own version
(`colors.primaryMuted` fill, `colors.primary` border). Deliberately no forced CTA in this banner
(unlike the gathering `notificationSuggestsInvite` case) — the offer list rendered right below is
already the obviously-correct next thing to look at, so a second competing button would just be
noise; documented inline in the screen's own comment at the fix site. `CommunityDetail` (the
paragraph's other named candidate — `business_partnership_response`/`community_area_demand_growing`
taps, both of which currently navigate there with no reason at all) remains a real, un-started
fast-follow, not assumed done by this change. Full Jest suite 295/295 passing (no new pure
functions — same UI/routing-wiring shape as the original Item 55); both touched files transform-
checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app or against a
real push notification (no simulator/device tooling this session, standing note).

**Item 55 fast-follow #2 (`CommunityDetail`) — fully DONE, same day (2026-09-12).** Closes the
last remaining candidate the original Item 55 paragraph named, per direct user request ("do
community detail too"). `business_partnership_response` (community-target branch) and
`community_area_demand_growing` notification taps now carry `notificationReason` through to
`CommunityDetailScreen.js`, which renders the exact same dismissible banner
`BusinessRequestDetailScreen` already has (same styles, no forced CTA — the community's own
content below is already the obvious next thing to look at). Bundled in the same change:
`business_partnership_response`'s gathering-target branch also now passes `notificationReason` —
`GatheringDetailScreen` already fully supports the param generically (no CTA renders, since
`notificationSuggestsInvite` isn't set for this type), so this closed the same real gap for that
branch with no new code needed there. With this, every notification type this app sends that
routes to `GatheringDetail`, `BusinessRequestDetail`, or `CommunityDetail` now carries its real
reason text — the fast-follow list from the original Item 55 paragraph is fully closed out; no
further named candidates remain. Full Jest suite 295/295 passing; both touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app or
against a real push notification (no simulator/device tooling this session, standing note).
Commit: `8c37cc6e`.

**Item 54 ("the app should remember context on back navigation") — audited, already TRUE by
construction, no code change needed (2026-09-12).** Both named examples ("Things To Do → Today →
Fitness → open an event → back" and "People → Friends → filters → open a profile → back") traced
through the real navigation tree rather than assumed: `RootNavigator.js` registers `MainTabs` (the
`Tab.Navigator` holding Home/Discover/Create/Activity as plain `Tab.Screen`s, no nested per-tab
stacks, no `unmountOnBlur` anywhere) as one `Stack.Screen` sibling alongside `GatheringDetail`/
`ViewProfile`/every other detail screen in the single outer `Stack.Navigator`. Navigating to a
detail screen pushes it on top of that outer stack — `MainTabs`, and everything inside it, stays
mounted underneath (React Navigation's own default); popping back returns to the exact same
mounted instance with all local `useState` intact, no extra plumbing required.

Verified this actually holds for both examples by reading the real state, not just the general
mechanism: `DiscoverHubScreen.js`'s `mode`/`peopleSubMode`/`expandedContext` are all plain
`useState`, and the one `useEffect` that seeds `mode`/`peopleSubMode` from `AsyncStorage` runs only
on initial mount (`[]` deps) — it does not re-run on refocus, so it can't stomp on a value the
user already changed. The screen's own `useFocusEffect` only re-fetches gatherings/communities/
offers/businesses on refocus; it never touches `expandedContext`. People/Friends mode renders
`FriendDiscoveryScreen` as a directly-embedded child component (not a separate navigated screen,
per the Aug 24 2026 "embedded" pattern) — its own filter state (`interestFilters`/`distanceFilter`/
`verifiedOnlyFilter`/`onlineOnlyFilter`/quick-filter order) is likewise plain `useState`, and its
own `useFocusEffect` only reloads candidates, never resets a filter.

Not exercised in a running app (no simulator/device tooling this session, standing note) — next
session should still confirm this visually once tooling is available, since this conclusion is
from a full code trace, not an on-device observation.

**Item 53 ("The business relationship should attach to the Plan") — fully DONE (2026-09-12).**
Direct continuation of Item 52: "Allen + Claude + Dinner + Friday 7PM" should become a Plan, and
Nearby should then find real restaurant options for it — not force the user to wait on an
asynchronous "ask and hope a business responds" cycle before seeing anything real. Given a
direct user pick (via `AskUserQuestion`, among "build the plan-first flow now" / "hold, the data
model already satisfies it" / "small enrichment only"): **build the plan-first flow.**

Real finding before writing any code: the entire backend chain the user described — Plan →
location → business → availability → offer → reservation — **already existed end to end**,
verified live: `plans.resulting_business_request_id` → `business_request_offers` →
`business_reservations`, plus `submitBusinessRequest()`'s existing `preferredAvailabilityId` param
(Intent Layer UX walkthrough finding 5) already binds a request directly to one specific,
already-live `business_availability` posting — confirmed by reading `_match_request_to_availability()`
live: passing a preferred posting immediately inserts a real `business_request_offers` row at
`status = 'offered'`, no waiting on the business at all. The only genuinely missing piece was a
**client-side "search live options first" step for the general (non-match) ask** — that pattern
already existed for the dating-specific case (`DateProposalScreen`'s `handleFindNearby`/
`handleChooseNearby`, external UX critique reply item 4) but had never been generalized to the
plain solo "ask a business" flow.

Shipped by enhancing `AskBusinessScreen.js` (solo mode only — a gathering/community already
sources location server-side, and a match's own pre-accept search already lives on
`DateProposalScreen`) rather than building a duplicate new screen: a new "🔎 Find options nearby"
step, placed right after party size/budget so a real `partySize` is available to filter capacity,
calls the existing `searchActiveBusinessAvailability()` with real device location; picking a
result sets `pickedAvailability` and is threaded into the existing `preferredAvailabilityId` param
on submit (composes the "what do you want?" text field from the real chosen business, but only
when the caller hadn't already typed their own text). No new DB migration, RPC, or schema — every
moving part reused verbatim. The "who" half of the example ("+ Claude") also needed no new code:
`BusinessRequestDetailScreen.js` already has a real "👤 Invite Someone" panel (Item 36 chain 1)
that appears the moment the resulting request lands, open and not yet part of a group plan —
exactly where the plan-first flow's own submit navigates to.

Full Jest suite 295/295 passing (no test files needed changes — no new pure functions introduced,
only UI wiring over already-tested services); `AskBusinessScreen.js` transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that "Find options
nearby" returns real results, that picking one correctly shows as an already-"offered" business on
`BusinessRequestDetail` immediately after submit, and that "Invite Someone" still works right
after a plan-first submission.

**Item 52 ("Build a universal Plan object") — first real increment shipped (2026-09-12).**
The `plans` table (Phase G, `20260914_plans_unified_object.sql`) has existed since Sep 14 2026,
populated additively by triggers on gatherings/business_requests/date_proposals, but had zero
client readers until now (re-confirmed by Item 51's own migration comment the same day: "no
`.from('plans')` call exists anywhere in src/"). Given a locked scope decision via a direct user
message relaying their own advisor's reasoning — **"wire the client first" (Option 1)**: prove
the existing `plans` object can drive real UI before investing in completing its data model
(participants, business/place association, more trigger sources) or building a dedicated new
Plans screen. Explicit caveats given alongside: don't leave underlying Plan states inconsistent
(the existing lifecycle rules still apply), and don't add speculative schema complexity in this
pass.

Shipped: `src/services/plans.js` (`getMyStandaloneBusinessRequestPlans()`,
`getMyDateProposalPlans()`), both first real reads of the `plans` table — reused the existing
`PlansScreen.js` ("Your Plans," already the app's "complete commitment calendar" surface) rather
than a new navigation destination, per the caveat. Scoped to exactly the two `plan_type`s that
screen had **zero visibility into before this** — a solo business request (asked but never
merged into a Group Plan) and a dating date proposal — both now render as real `PlanCard` rows on
the Upcoming tab, same treatment Group Plans already got (no scheduled-slot sort, own unsorted
block, never split into Past — matching `getMyGroupPlans()`'s own existing precedent). New
`resolvePlanTableStatus()` (`constants/planStatus.js`, 3 new Jest tests) maps the table's own
already-collapsed `draft`/`confirmed`/`cancelled` status onto the existing six-word `PLAN_STATUS`
vocabulary used everywhere else on this screen.

Deliberately did NOT touch gathering-sourced plans (still read via the existing
`getMyAttendingGatherings()`/`getMyGatherings()` queries) — a gathering someone else hosts has no
`plans` row at all (RLS is `created_by`-only, no participant concept on this table yet), and
building one now would be exactly the speculative schema complexity the locked decision said to
defer. Also did not touch the already-shipped Group Plans list; standalone business-request plans
are explicitly de-duplicated against it client-side (excluded whenever the underlying
`business_requests.group_plan_id` is set — a real, disclosed gap in the original Phase G
migration is that this isn't synced onto `plans.status`, so it has to be checked directly).

Verified live against production (`enmosvippabmuqslzrox`) via two disposable rolled-back
transactions (real FK constraint names for `resulting_business_request_id`/
`resulting_date_proposal_id` confirmed first via `pg_constraint`; a solo open request, a
group-plan-merged request, and a cancelled request inserted, and the filtering logic — the
merged one is present at the SQL level but excluded by the client-side filter, the cancelled one
is excluded already by `status <> 'cancelled'`, the solo one is present — was confirmed correct
in both directions; a real date-proposal row correctly produced a `dating_date` plan row with the
right `match_id` for navigation), plus a live, unauthenticated REST call against the actual
PostgREST endpoint with the exact embed-join query strings the client uses, confirming they parse
correctly (rejected on `anon`'s missing table grant — the expected/correct outcome — never on a
malformed embed). Both disposable transactions rolled back and re-confirmed zero leaked rows.
Full Jest suite 295/295 passing; all four touched/new files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that a genuine solo
business request and a genuine date proposal each render correctly as a Plans-tab row and that
tapping each lands on the right existing screen.

Real next increments, not started, no code exists for them yet (flagged, not assumed): the
gathering-attendee/participant gap named above; folding `plans` into other existing ad-hoc
surfaces (e.g. `getMyBusinessEcosystemActivity()` on ActivityScreen still queries
`business_requests` directly rather than `plans`); a `birthday`/`anniversary`-sourced plan row
(no trigger populates these plan_types yet, a real disclosed gap from the original Phase G
migration, unrelated to this pass).

**Item 51 ("cancellation needs to propagate everywhere") — fully DONE (2026-09-12).** Cancelling a
Gathering or Community used to be a partial state change: an already-ACCEPTED business offer
(a confirmed reservation, possibly a captured payment) tied to it survived untouched. Fixed by
extracting Item 50 fix 5's cancellation logic into a shared `_cancel_reservation_by_offer()`
helper that `cancel_gathering()`/`cancel_community()` now also call for any accepted offer,
preserving the same real-money-safety rule (captured/authorized payments block auto-cancellation,
both sides notified to coordinate directly). Every other concern the user listed (attendee
notification, dead deep links, recommendation surfaces, stale promotion) was checked live and
found already correct — no fix needed. One client gap closed: `CommunityDetailScreen.js` no
longer offers "Invite Friends"/"Host a Gathering" on a cancelled community. Verified live via 4
disposable rolled-back scenarios against the real deployed functions. Full detail:
`CLAUDE_HISTORY.md`, search "Item 51".

**Items 48 & 49 ("notifications need a reason + action" / "don't notify about things you can't
act on") — fully DONE (2026-09-11).** Picked up in-flight, uncommitted work from an interrupted
prior session: `get_business_availability_by_id()` (`supabase/migrations/
20261010_business_availability_by_id.sql`) was already written AND already applied live in
production, but never wired into the client — this was the single biggest violation. A background
audit fork then surveyed all 59 live push-sending Postgres functions in production against both
rules, cross-referenced against `notifications.js`'s `routeNotificationTap()` switch (full report:
`PRODUCT_AUDIT/NOTIFICATION_REASON_ACTION_AUDIT_2026-09-11.md`). Found and fixed 6 concrete gaps,
all now shipped: (1) `recommended_business_availability` taps now fetch the specific matched
posting via the new RPC and land on `AskBusinessScreen` pre-filled with it (`matchedAvailability`,
same shape `intentResolver.js` already builds), falling back to the generic Discover tab only when
the slot's genuinely gone (expired/inactive) by the time it's tapped; (2)
`notify_gathering_interest`'s push now includes `gathering_id` in its payload (was already
computed, just never passed through) so a host's tap lands on the specific gathering instead of a
generic browse; (3) `submit_social_offer()`/`respond_to_social_offer()` now resolve and include the
real `group_plan_proposals.id` via `resulting_request_id` (a social offer's only real
consumer-facing surface is `GroupPlanScreen`, keyed by `proposalId`) — a request created outside
the group-plan flow honestly yields no `proposal_id`, no fabricated destination; (4-6) added
tap-routing cases for four notification types that previously had **none at all** (tap did
literally nothing): `community_cancelled` (→ Communities browse, same "row's gone" shape as its
`gathering_cancelled` sibling), `business_offer_withdrawn` (→ `BusinessRequestDetail`, same
destination as its `business_offer_received` sibling), `date_proposal`/`date_proposal_response`
(→ `DateProposalScreen`, already keyed by the `match_id` both payloads already carried). Everything
else surveyed (the large majority) was already correctly reason-bearing and actionable — no changes
needed there; full function-by-function table in the audit report. Migration
(`20261011_notification_reason_action_fixes.sql`) verified live via disposable rolled-back
transactions (confirmed `gathering_id` now flows into the queued push payload; confirmed the
`proposal_id` lookup resolves correctly for a request with a real originating group plan) before
being treated as done; `get_business_availability_by_id()` itself was separately verified live the
same way (an active posting returns full data, an expired one honestly returns nothing). Full Jest
suite 292/292 passing throughout; all touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — push notifications specifically can't be end-to-end verified without a real
device token. Commits: `760c0fef`, `d72a189c`.

**Item 50 ("state consistency audit") — fully DONE (2026-09-12).** All 6 findings shipped: fixes
1/2/3/4/6 (2026-09-11) plus fix 5, "cancel a confirmed reservation"
(`cancel_business_reservation()` RPC + client wiring in `BusinessRequestDetailScreen.js`/
`BusinessDashboardScreen.js`), resolved after a resumed session traced the prior "reproducible
PL/pgSQL anomaly" to a mundane cause — a CHECK constraint that hadn't been widened yet in the
same still-unapplied migration, not an engine bug. Full detail: `CLAUDE_HISTORY.md`, search
"Item 50 ... fix 5".

**Items 46 & 47 ("personalization should determine what appears first" / "don't
over-personalize too early") — first real increment shipped (2026-09-11).** Paired ask: Discover
should genuinely reorder itself around a real, earned behavioral signal ("someone who constantly
searches fitness should see Fitness near you"), but must never fabricate personalization for a
user with no real history yet (explicit cold-start fallback list given: Popular nearby/Happening
today/Friends are interested/Based on your selected interests). Built on top of the "10/10
roadmap" Part 7 infrastructure already in place (`intent_submissions`, RLS-scoped to each user's
own rows) rather than inventing new instrumentation, per the user's own "the architecture you've
been building makes this possible."

Shipped: a new pure `findTopSearchedCategory()` (`src/utils/intentPatterns.js`) — a broader
sibling of the existing day/time-scoped `findRecurringIntentPattern()` (used for Home's smart
placeholder): counts a caller's own real `intent_submissions.category` history with no day/time
constraint, returns the top category at 3+ real occurrences (same `MIN_OCCURRENCES` floor, same
"null means honestly unknown" discipline), or `null` for anyone who doesn't qualify yet. Wrapped
by `getMyTopSearchedCategory()` (`src/services/intentOutcomes.js`, same query shape as the
existing `getMyIntentPatterns()`). Wired into `DiscoverHubScreen.js`: when a real qualifying
category exists AND real matching gatherings genuinely exist nearby, a "{Category} Near You"
section renders **first** — ahead of Happening Now/Today/This Weekend/Categories — with a "See
all →" reusing the exact same single-`interestTag` expand-in-place mechanism a single gathering
tile's own context already used (no new navigation surface). Its ids are excluded from every
section below it, extending the exclusion chain those sections already apply to each other, so
nothing repeats. For a cold-start user (no qualifying history), the section simply doesn't
render — the screen falls straight through to the exact same Happening Now/Today/This
Weekend/Categories hierarchy every user already sees (item 14), with no fabricated "we know what
you like." Audited item 47's own prescribed fallback list against what's already real and
present rather than inventing new sections for it: "Happening today" already exists verbatim as
the Today section; "Based on your selected interests" and "Friends are interested" are already
real, itemized per-tile reasons every gathering tile surfaces via `getGatheringFitReasons()`
(`REASON_TEXT.MATCHES_INTERESTS`, `"N of your friends are attending"`) rather than needing to be
their own separate top-level sections; "Popular nearby" is effectively what the existing
fit-score-sorted tiers already surface. New Jest coverage (6 tests) for
`findTopSearchedCategory()`; full suite 286/286 passing; all three touched files transform-
checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no
simulator/device tooling this session, standing note) — this reads real per-user data
(`intent_submissions`), so behavior can't be confirmed against a live account this session.
**Follow-up, same day, per direct user request ("build that durable frequency signal... you
never finished earlier"): the deferred "mainly uses Friends" piece is now also DONE.** Shipped
real, durable, server-side usage-frequency tracking replacing the "last used" AsyncStorage-only
proxy as the sole signal. `20261009_people_submode_usage_tracking.sql` adds two plain counter
columns (`profiles.people_submode_dating_uses`/`people_submode_friends_uses`, same "counter
columns on profiles" pattern already used elsewhere in this schema) and a narrow, self-scoped
`record_people_submode_use(submode)` RPC (SECURITY DEFINER, `REVOKE ... FROM public, anon` per
this repo's own standing convention — verified live via `information_schema.role_routine_grants`
after a first attempt only revoked from `public` and left `anon` still granted, a real instance
of the exact gotcha that convention exists to catch). New pure
`resolveDefaultPeopleSubMode()` (`src/utils/peopleSubModePreference.js`, 6 Jest tests) only lets
the real usage counts override the remembered last-used value once there's a genuine, durable
skew (5+ combined real uses, not a tie) — below that threshold it defers to the exact same
last-used/default behavior as before, same "don't over-personalize too early" discipline as item
47. `DiscoverHubScreen.js`'s `selectPeopleSubMode()` now calls the new
`recordPeopleSubModeUse()` (`src/services/peopleSubModeUsage.js`) alongside its existing
AsyncStorage write; the mount effect now reads both the remembered value and the real counts
(`getMyPeopleSubModeUsage()`) in parallel and feeds both into the pure resolver. Verified live via
two disposable rolled-back transactions (a real counter-increment assertion, and an invalid-
submode rejection) before and after applying for real, plus a live grants check that caught and
fixed the `anon`-grant gap. Full Jest suite 292/292 passing; all three touched/new files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note) — this reads/writes real per-user data,
so behavior can't be confirmed against a live account this session.

**Item 44 ("give each screen ONE visual hero") — fully DONE (2026-09-11).** Direct continuation
of the "Things To Do feels busy" observation, reframed by the user as a visual-hierarchy problem
rather than a content problem: Discover's Things-mode header had title, subtitle, a full-width
two-box mode toggle, and a bordered search pill all competing at roughly the same visual weight
before any real content appeared. Per the user's own mock (Discover / "What are you looking
for?" / [search] / Things to Do | People / content), made the search bar the screen's one real
hero and demoted everything else around it, without reordering or removing any control (all
still fully functional, same conditional logic for breadcrumb/expandedContext untouched):
(1) Things mode's subtitle copy changed from the disconnected status line "What's happening
nearby." to a real lead-in question, "What are you looking for?", so title+subtitle+search now
reads as one intentional block instead of three separate elements. (2) The outer Things to Do |
People mode toggle (`modeToggleRow`/`modeToggleButton`) — previously two full-width, bordered,
filled boxes, the same visual weight class as the search bar and filter chips — is now a plain
auto-width text-tab treatment (thin colored underline on the active tab, no box or fill),
reading as clearly secondary navigation. Left the People sub-mode's own inner Dating|Friends
toggle (`peopleSubToggleRow`) untouched — it was already given a lighter treatment than the
outer toggle in the Aug 30 2026 fix, and that relationship still holds (arguably more clearly
now, since the two no longer share the same box-chrome family at all). (3) The search bar itself
(`searchBarWrap`/`searchInput`) got a modest bump in physical presence — taller input, slightly
bigger font, a touch heavier border, and the same `shadow.card` elevation this codebase already
uses to mark other "look here" surfaces — so it visually reads as the obvious place for the eye
to land. Filter chips/view toggle below it were left as-is; they were already a light chip row,
not part of the actual clutter. Full Jest suite 280/280 passing; `DiscoverHubScreen.js`
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note) — this is a styling-weight change with
no layout/behavior change, but if anything reads visually off, this is the first place to check.

**Item 43 ("consider eliminating unnecessary section headers") — fully DONE (2026-09-11).**
Direct continuation of the "Things To Do feels busy" observation: a title on its own line,
content, then a separate "See all in X →" link on its own line below the content adds a full
extra row of visual weight per section, repeated across a whole screen it reads as a dashboard.
Fixed the concrete instance across Discover's Things-To-Do view (item 14's Today/This Weekend
sections, plus the Gatherings/Communities/Places/Perks browse-all sections) by merging each
section's title and its own "See all" onto one row (`sectionHeaderRow`/`sectionHeaderRowLabel`/
`seeAllInline`, new shared styles in `DiscoverHubScreen.js`) — "🌅 Today &nbsp; See all →" /
[content] / "🌴 This Weekend &nbsp; See all →" / [content], matching the user's own mock exactly.
Shortened each link's visible text to the generic "See all →" (the section's own header already
names what it's a see-all *of*; kept the more specific string in each `accessibilityLabel` for
screen readers). Sections with no "See all" at all (Happening Now, Categories, Recommended For
You, Happening Nearby) were already single-line headers with no description/button underneath —
untouched, already the lean shape the mock asks for. Removed the now-fully-dead `seeAll` style
(every call site converted). Full Jest suite 280/280 passing; `DiscoverHubScreen.js` transform-
checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no
simulator/device tooling this session, standing note).

**Item 42 ("Stories should reinforce People, not compete with it") — fully DONE (2026-09-11).**
Direct user principle: a story is a signal on a person, not its own separate discovery
hierarchy — "Allen 🔴 / Sarah 🔴 / Mike," never a "Stories" row sitting above a "People" row.
Item 8 (2026-09-10) already built this correctly for the People tab itself (Dating/Friends
swipe decks: the avatar carries the ring, tap the ring for the story, tap the card for the
profile — no separate Stories row there). This session found and closed the one remaining
violation: Discover's Things-To-Do "All" view still had its own separate "Public Stories Near
You" horizontal strip (`DiscoverHubScreen.js`) — a second Stories hierarchy, unattached to any
person list, browsing public-story posters generally (not just Dating/Friends candidates).
Per direct user pick (via `AskUserQuestion`): removed the strip entirely rather than relocating
that people-pool into the People tab (which the user explicitly rejected — folding it in would
just recreate the same "competing feeds" problem one level down, "People" becoming a collection
of different people-feeds). Public-story posters who are also real Dating/Friends candidates
still surface via the existing avatar-ring mechanism there; standalone public-story browsing via
the map (`getPublicStoriesOnMap`) is untouched — a genuinely different, non-hierarchy-competing
surface (a map, not a list). Removed alongside the JSX: the section's own state
(`publicStories`, `storyPhotoUrls`, `viewerTarget`), its loader (`loadPublicStories`), its
`StoryViewerModal` usage/import in this file (the component itself stays — still used by
`DiscoveryScreen.js`/`GatheringsScreen.js`/`FriendDiscoveryScreen.js`), its now-unused styles
(`storyRing`/`storyAvatar`/`storyAvatarPlaceholder`/`storyName`), and the now-fully-dead
`getPublicStoriesGrouped()` query function in `src/services/stories.js` (confirmed zero other
callers anywhere in `src/` before deleting). User's own broader framing, worth carrying forward
as a lens for future work: "don't create a separate surface for something that can be a signal
on an existing object" (story → ring on person; friendship → relationship state on person;
interest → attribute on person/activity; business availability → signal on business). Full Jest
suite 280/280 passing; both touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note).

**Item 41 ("make 'People' about people, not dating") — audited, one real concrete gap closed
(2026-09-11).** User's ask: keep "People" as the parent label over Dating|Friends (explicitly likes
this architecture because it leaves room for more social-relationship types later without
restructuring) — but don't add anything new now, just make sure "People" doesn't silently mean
"Dating." Audited the app directly (not from memory) for exactly this conflation. The outer
architecture already matches what the user described, built in prior sessions: Discover's People
mode already has a real, visually co-equal Dating|Friends toggle (`DISCOVER_MODES`/
`PEOPLE_SUBMODES` in `DiscoverHubScreen.js`), a neutral 👥 icon (not a heart), and no other
top-level "People" label exists anywhere else in the app to fix. No restructuring needed or done —
Groups/Communities deliberately NOT added as sub-modes now, per the user's own explicit
instruction. Found one real, concrete violation: `HomeScreen.js`'s "Quick Stats" card showed "N
people nearby" (neutral icon, generic label) backed by a real count
(`dashboard.nearbyPeopleCount` ← `getNearbyMatches()` in `homeDashboard.js`) that's actually
dating-preference-filtered (show_me/age range/ethnicity/hair/eye color/interested_in_genders) —
tapping it routed straight to the standalone, dating-only `DiscoveryScreen` (`'Nearby'` stack
route) with no visible path to Friends at all. Fixed: gave `DiscoverHubScreen` an
`initialMode`/`initialPeopleSubMode` route param pair (an explicit navigation intent wins over the
remembered last-used mode for that one visit, falling back to AsyncStorage as before when absent)
and pointed the Quick Stats card at Discover's own real People > Dating|Friends toggle instead of
the walled-off legacy screen — same real Dating content pre-selected (the count itself is
unchanged, still accurate), but Friends is now one tap away rather than absent. No new query, no
relabeling of the count, no new screens. Full Jest suite 280/280 passing; both touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no
simulator/device tooling this session, standing note). Commit: `4161c6d0`.

**Item 40 ("categories should be the fallback, not the primary burden") — audited, one real
concrete gap closed (2026-09-11).** User's own stated hierarchy: intent/search first, categories
second, manual filtering third — categories still matter for discovery/SEO/business matching/
structured data, but shouldn't be the primary burden a consumer has to navigate. Audited every
consumer-facing discovery surface against this directly (not from memory): Home's ask box and
Discover's own search (item 39) already lead with intent; Discover's default Things-To-Do view
(item 14) already leads with Happening Now/Today/Weekend before its Categories row; Gatherings
already puts its search bar above its own collapsible filter accordion; Create leads with quick-
picks + free text ("Something Else"), never a forced category tree. `AskBusinessScreen`/
`BusinessPartnerApplyScreen`'s own required category fields are deliberately out of scope — those
are structured-data capture on a form the user already opened with clear intent, exactly the
"business matching, structured data" carve-out the item's own text names. `CommunitiesScreen.js`
has no category browsing at all to begin with (flagged separately, out of scope, by item 26's own
audit) — nothing to fix there for this item either. The one real, concrete violation found:
`PlacesScreen.js` (reached via Discover's "See all places" link) had 19 category chips as the
*only* way in, no search box at all, even though `searchNearbyPlaces()` already supports a keyword
param the parent Discover screen already uses. Fixed: added a real, debounced search box above the
chips. While actively searching, category stops acting as a hard type filter (Google's Nearby
Search ANDs type+keyword together, so a stale "Coffee" chip would silently zero out an unrelated
search) — mirrors Discover's own existing choice for its "All" tab keyword search. Tapping a
category chip while searching switches back to plain category-browse mode (clearing the search)
rather than combining into a confusing hybrid state. Empty-state copy, the loading caption, and the
item 26 "Ask Nearby Businesses" escape-hatch prefill all now reflect the real search text when one
was active. Full Jest suite 280/280 passing; `PlacesScreen.js` transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note). Commit: `87855fb0`.

**Item 39 ("search should understand the same language as the Intent Box") — fully DONE
(2026-09-11).** Connected to item 14. The real gap: Discover's unified search box only ever did a
literal ILIKE substring match over titles/descriptions/tags (`searchGatherings`/
`searchPublicCommunities`/`searchOffers`, plus item 26's own earlier taxonomy-aware tag matching)
— a genuine non-literal ask like "something fun with my girlfriend Saturday" has no title/tag it
could ever literally match, so it always fell straight through to "nothing matched anywhere" ->
Create It, never actually understood, unlike Home's own ask box. Shipped `runIntentSearch()`
(`src/services/intentResolver.js`) — composes the same `classifyCreateRequest()`/`resolveIntent()`/
`resolveCommunityIntent()`/`detectFriendDiscoveryIntent()` calls, same branching semantics,
HomeScreen's own `handleHomeIntentSubmit` already uses inline. `DiscoverHubScreen.js`'s search box
now runs a query through it on explicit submit (Enter/Search key — not the live per-keystroke
debounce the literal search still uses, since this costs a real LLM round trip, same reasoning
Home's own box already follows) and renders an "understood as" panel above the existing literal-
match sections: a real title (an assembled Experience's own title when one genuinely applies, e.g.
"✨ Your Date Night", else a category-based fallback), honest tag chips (📍 Nearby, 📅 the real
dateWindow bucket, ❤️/👥/🧍 from partyType), then the real matching gatherings/communities/perks/
businesses. Purely additive — literal per-section results are untouched and still render alongside
it. Also extracted `navigateToIntentResultItem()` (the per-type routing switch both HomeScreen's
`handleIntentResultTap` and Discover's own new result rows need identically) and
`buildFriendDiscoveryResultItem()` out of `HomeScreen.js` into the same shared module — HomeScreen
now imports both instead of keeping its own copies (mechanical extraction, verified same resulting
behavior via diff), so the two search surfaces share one routing rule instead of two that could
drift. Deliberately did NOT fold `handleHomeIntentSubmit` itself into `runIntentSearch()` — that
inline code has several Home-specific concerns interleaved (Surprise Me clearing, RSVP nudges) and
no automated coverage in a codebase with no simulator/device testing available, so refactoring it
now would be real regression risk for no behavioral gain; both call sites already compose the
identical underlying functions with the same params, which is what "the same language" actually
requires. `create-assistant`'s prompt gained two small real gaps closed as part of this: a plain
"Saturday"/"Sunday" (no other timing word) now explicitly maps to the existing "weekend" bucket
(previously undefined behavior), and "with my girlfriend"/"with my boyfriend" were added as
explicit `partyType` examples alongside "with my partner" — both additions to already-existing
bucket vocabulary, not new specific-date inference, consistent with the standing "AI never infers
or assigns a specific date/time from free text" rule. Edge Function redeployed and confirmed live
via the Management API's function-body endpoint. Full Jest suite 280/280 passing; all four touched
files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running
app (no simulator/device tooling this session, standing note). Commit: `62612669`.

**Item 38 ("don't force the user to know the app's terminology") — fully DONE (2026-09-11).**
Picked up a genuine in-flight, uncommitted change found at session start: `create-assistant`'s
prompt (the Edge Function behind `CreateHubScreen.js`'s "Something Else" free-text box) had
already been edited to extract `category`/`partySize`/`dateWindow`/`budgetMax`/`priceLevel`/
`partyType`/`attributes`/`cuisine`/`occasion` regardless of classified intent — previously
`category` was only ever extracted for `gathering`/`community` — with a comment noting an
"unclear" request like "can someone find me a good place for dinner?" correctly classifies as
unclear (it doesn't describe hosting/starting anything) but Nearby should still search relevantly
for it. That half was done; the client side wasn't: `CreateHubScreen.js`'s own `handleAskAssistant()`
still routed every "unclear" classification into `CreateGathering` with the raw typed text as a
literal title — exactly the terminology-forcing bug the item describes (the user says "find me a
place," the app forces them into "create a gathering called 'find me a place'"). Fixed: that branch
now routes to `AskBusinessScreen` instead, prefilled from the same `classifyResult` shape
HomeScreen's own `goAskBusiness()`/`business_availability` branches already use to prefill the
identical screen — the real matching product object, never auto-submitted. Deliberately left
`routeClassifiedIntentToCreation()` (Home's "None of these? Create it yourself" / Discover's
completion CTA) unchanged and documented why in its own comment: both of its callers only reach
"unclear" after the user already saw and rejected every real match `resolveIntent()` found, so
CreateGathering is the correct, already-informed landing spot there — a genuinely different context
from CreateHubScreen's first-touch box, which has no results-review step at all. The first example
in the item ("get 6 people together for dinner Friday" → a gathering) was already correctly handled
by existing `gathering`-intent routing; not changed. Edge Function redeployed
(`npx supabase functions deploy create-assistant`) and confirmed live via the Management API's
function-body endpoint (new prompt strings present in the deployed bundle). Full Jest suite 280/280
passing; both touched client files transform-checked clean via `@babel/core` + `babel-preset-expo`.
Not exercised in a running app (no simulator/device tooling this session, standing note). Commit:
`e7d7e6ba`.

**Item 37 ("make the primary CTA context-aware") — fully DONE (2026-09-11).** Full findings:
`PRODUCT_AUDIT/CONTEXT_AWARE_PRIMARY_CTA_2026-09-11.md`. Audited all 6 named contexts by reading
each screen's real button JSX + styles to check which button is *visually* primary (filled coral)
vs secondary, not just which exists. Two real gaps found and fixed: `ViewProfileScreen.js` had
"💬 Message" as the coral primary and "🤝 Plan Something" as the outlined secondary once connected
as both friend and match — swapped, and renamed to "🤝 Plan Together" to match the user's wording
(only when `friendshipStatus === 'accepted'`; a pure dating match still shows Message as primary,
correctly, since nothing else is actionable yet). `BusinessProfileScreen.js` had "+ Follow" as the
coral primary and "📅 Make a Plan Here" as the *weakest*-styled button on the screen (gray outline)
— swapped, renamed to "📅 Plan Here"; Follow is now always outlined, never filled, in both states.
Community (`CommunityDetailScreen.js`) and Gathering (`GatheringDetailScreen.js`) were already
correct — no changes. "Event" is not a distinct concept anywhere in this schema (folds into
Gathering per item 27's own same-day audit) — flagged rather than fabricating a parallel UI state
with no real data distinction behind it. Search results: `DiscoverHubScreen.js`'s existing
"nothing matched anywhere" escape hatch (item 26) was already coral-primary and correctly gated
(empty-state only, never alongside real results) — renamed "Create it →" to "Create What You're
Looking For →" to match the user's wording; `GatheringsScreen.js`'s own more-specific "+ Start a
{term} Gathering" CTA was deliberately left as-is (more informative for its single-type context).
Full Jest suite 280/280 passing (no test files touched); all three touched files
(`ViewProfileScreen.js`, `BusinessProfileScreen.js`, `DiscoverHubScreen.js`) transform-checked
clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device
tooling this session, standing note).

**Gathering-interest threshold push ("3 people nearby are planning X") — fully DONE (2026-09-11).**
The one explicitly-named deferred piece from item 17's own migration
(`20261004_recommended_for_you_push.sql`'s header comment): a brand-new gathering has zero
attendees at the moment its own creation trigger fires, so the "X people nearby are planning
this" social-proof copy needed its own separate trigger on real accumulating interest, not
gathering creation. Shipped as `notify_gathering_interest_threshold()`
(`20261008_gathering_interest_threshold_push.sql`), an `AFTER INSERT` trigger on
`gathering_interest` mirroring `notify_group_intent_threshold()`'s own "fire exactly once, at the
real threshold crossing" shape — fires only when a gathering's real interest-row count hits
exactly 3 (any status; a real gathering_interest row already means real expressed intent, not
confirmed attendance), never again for the 4th/5th/etc. person. Recipients are the exact same
interest-matched, presence-based, distance/time-pref/frequency-gated population
`notify_matching_things_to_do()` already computes for gathering creation, reused rather than
re-derived, minus the host and minus anyone who already has their own interest row for that
gathering; shares `recommendation_push_log`'s `source_type='gathering'` bucket and therefore the
same daily frequency cap as the creation-time push (one shared budget per user, not a second
independent one). No client changes needed — reuses the exact same `recommended_gathering` push
type `notifications.js` already routes to `GatheringDetail`. Verified live via a disposable
rolled-back transaction before applying for real — a first version of the test used one
multi-row `INSERT ... VALUES (a),(b),(c)` for the 3 interest rows and incorrectly showed 3 pushes
instead of 1 (all 3 AFTER-ROW triggers in one multi-row statement see the same final
post-statement count, since PostgreSQL fires AFTER ROW triggers only once every row in the
statement is already inserted) — re-verified with 3 separate single-row INSERTs, which is what
the app's real `join_gathering` RPC actually does (one row per user action), and got the correct
result: exactly one push, to the correct candidate, with the already-interested/wrong-interest/
host candidates all correctly excluded, and no re-fire at a 4th interest row. Confirmed live
afterward via `pg_proc`/`pg_trigger`. Full Jest suite 280/280 passing (no client files touched).
Not exercised in a running app or against a real device (no simulator/device tooling available
this session, standing note).

**Item 36 ("one intent → action pattern everywhere") — fully DONE (2026-09-11).** User's framing:
I want something → Nearby understands → shows options → I choose → Nearby helps make it happen —
audited against 4 example chains (dinner → restaurants → friends/match → availability → plan →
reservation; tonight → events/options → invite people → plan; meet people → Dating/Friends →
relevant people → connect → plan something; build something → Community/Gathering → create →
attract people → connect businesses). Full detail: `PRODUCT_AUDIT/INTENT_ACTION_PATTERN_2026-09-11.md`.
Chains 2 ("tonight"), 3 ("meet people"), and 4 ("build something") were already complete
end-to-end, verified by reading the real code paths (not re-trusted from memory). Chain 1
("dinner") had one real gap: resolving "dinner" landed on a fully solo `AskBusinessScreen` with
no way to deliberately bring a specific connected friend/match. **Initial design (pre-submission
companion picker) was locked, a build fork started against it, then the user reviewed and
redirected to a different shape before anything was committed** — nothing from that original plan
ever touched production; full clean slate. **Shipped design**: submission stays exactly as-is
(solo, no gate, zero added friction); an unobtrusive "👤 Invite Someone" expand-in-place section
on `BusinessRequestDetailScreen.js` (also literally the post-submit confirmation screen) lets the
owner invite a real connected friend or match *after* submitting, reusing the existing group-plan
consent architecture (`group_plan_proposals`/`group_plan_participants`/`respond_to_group_plan`/
`confirm_group_plan`, all read live via `pg_get_functiondef` before building, none modified) via a
new `invite_to_business_request` RPC (`20261007_invite_to_business_request.sql`) that auto-creates
a never-fanned-out placeholder request on the invitee's behalf to satisfy the participants table's
own FK, then relies on the existing generic accept/decline/confirm flow for everything downstream.
Verified live via a disposable rolled-back transaction (real friend/match invited while a stranger
is silently skipped; idempotent re-invite rejection; a blocked pair excluded despite being
connected; existing `respond_to_group_plan` confirmed fully generic over the new row shape), then
applied for real. Full Jest suite 280/280 passing throughout; every touched file transform-checked
clean. Not exercised in a running app — no simulator/device tooling available this session.

**Thursday plan items 34 & 35 (contextual loading states; "why am I here?" 7-question coherence
audit across Discover/People/Create/Plan) — fully DONE (2026-09-11).** Full findings:
`PRODUCT_AUDIT/DISCOVER_PEOPLE_CREATE_PLAN_COHERENCE_2026-09-11.md`. Item 34: 10 files gained real
contextual loading copy ("Finding things nearby…", "Finding people who match…", "Finding
availability…", "Building your options…") on genuine in-flight fetch/search moments that
previously had bare spinners — `HomeScreen.js` (intent resolution + Surprise Me),
`DiscoverHubScreen.js` (6 spinners), `FriendDiscoveryScreen.js` (mode-aware), `GatheringsScreen.js`
(+ all 11 locale translations of its generic "Loading..." initial-load string),
`PlacesScreen.js`, `CommunityDetailScreen.js`, `CreateGatheringScreen.js`,
`CreateHubScreen.js`, `DateProposalScreen.js`. Item 35: ran the user's own 7-question test against
all 14 screens in this cluster; verified (not just re-trusted) that items 8-33's prior work still
holds, specifically hunted for state-lost-on-return (Q6) and duplicated-navigation (Q4) bugs —
none found. No architecture-level consolidation proposal raised: this cluster's current
state-driven shape (DiscoverHubScreen mode/sub-mode/expand-in-place, CreateHubScreen's inline
assistant, FiltersModal/QuickFilterCustomize as in-place layers) was already built specifically to
avoid screen proliferation in prior sessions, not something this pass needed to fix. Full Jest
suite 280/280 passing; all touched files transform-checked clean. Not exercised in a running app
(no simulator/device tooling this session, standing note). Commits: `0bca8420`, `94277779`.

**Thursday plan items 32 & 33 (standardize relationship states; standardize action-verb
semantics) — fully DONE (2026-09-11).** Two global audits requested directly by the user, each
run as a background research fork (to survey the whole codebase without blowing up context),
each ending in concrete fixes, not just a report:

- **Item 32** (relationship states) — audit found 2 real bugs + 1 structural risk, all fixed:
  `block_and_unmatch()` never deleted the `friendships` row on block, so a blocked former friend
  stayed listed as a Friend on `FriendsScreen`/`ProfileScreen` while `ViewProfileScreen` correctly
  blanked their profile (exactly the "contradicting states across screens" failure described) —
  fixed in `20261006_block_clears_friendship.sql`, verified live via a rolled-back dry run before
  applying for real; `getCommunityMembers()` didn't filter blocked users, unlike every sibling
  roster function — fixed with the same blocked-both-directions pattern `getFellowAttendees()`
  already used; no canonical relationship-status function existed anywhere — extracted
  `getRelationshipStatus(otherUserId)` into `src/services/friends.js` and refactored
  `ViewProfileScreen.js` (the only real consumer) to use it instead of 3 separate inline queries.
  Candidate pools (dating swipe, friend swipe) were both already correctly excluding blocked/
  already-connected people — no bug there. Full matrix + audit methodology:
  `PRODUCT_AUDIT/RELATIONSHIP_STATE_MATRIX_2026-09-11.md`.
- **Item 33** (action-verb semantics) — audit found 5 real label/destination mismatches, all
  fixed: `GatheringDetailScreen.js`/`CommunityDetailScreen.js`'s shared business-help chooser
  labeled both its options "Ask..." despite routing to two deliberately different flows (reworded
  the `RequestBusinessPartner` one to "Request a specific business"); `MatchesScreen.js` used
  "Plan" for two different destinations (direct-to-DateProposal vs. the 12-option "Do Something
  Together" menu) — the menu branch relabeled to "Do Something"; `GatheringsScreen.js`'s "I'm
  Interested" button (and its `GatheringIntentModal` call) used a generic label while
  `GatheringDetailScreen.js`'s identical action already used the real three-way "Join Gathering"/
  "Request to Join"/"Join Waitlist" label for the same `gathering_interest` insert — applied the
  same computation; two smaller outliers ("Start a Community from This Gathering" →  "Create a
  Community...", "Start a Gathering" → "Host a Gathering") renamed to match their own screens'
  canonical titles used everywhere else. Save/Discover/Message/Ask-vs-Request-at-every-other-entry-
  point verb families were all already consistent — no changes needed there.

Both audits' full findings (including what was checked and found already-consistent, not just
what got fixed) are in the fork reports; the fix commits' own messages carry the same detail. Full
Jest suite 280/280 passing throughout; every touched file transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note).

**Thursday plan items 30 & 31 (Home/Discover/Create clarity; Profile is about ME) — audited,
mostly already-DONE, one real concrete gap closed (2026-09-11).** Both items turned out to be
close restatements of architecture already built and iterated on across many prior sessions —
verified by reading the actual current code, not assumed from memory.

**Item 30** (Home = "what do you want to do", Discover = "here's what's available", Create =
"here's how you make something happen"): already true in both navigation and content. Only 4 tabs
exist (`RootNavigator.js`: Home/Discover/Create/Activity), and each screen's own literal framing
text already independently arrived at almost the user's exact wording — Home's ask box literally
says "What do you want to do?" (Phase 1a of the Intent Layer plan); Discover's subtitle reads
"What's happening nearby"/"Who's around you" per mode; Create's reads "What do you want to
create?". Home's own sections (Quick Picks, Nearby Right Now, Happening Near You, Because You
Like…) are all small, personalized/algorithmic picks, never an exhaustive raw browse — that stays
Discover's job, a real, checked distinction. The one place Discover links to Create
(`DiscoverHubScreen.js`'s "+ Create a {topic} Gathering →" inside an empty Gatherings section) is
the correct escape-hatch relationship the user's own model implies (Discover shows what's real;
when nothing's real, it hands off to Create rather than fabricating content), not a boundary
violation. No code changes made — nothing to fix.

**Item 31** (Profile about ME: identity → what can I do with them; own Profile emphasizes
identity/interests/plans/communities/activity, Settings separate): `ViewProfileScreen.js` already
matches the "who are they, then what can I do" shape closely — photos/name lead, then real
primary actions (Message only when a real `matches` row exists; Plan Something only once friends
are `accepted`; Friends ✓ / Request Sent / Add Friend / Accept-Decline reflecting real
`friendships` state), with Report/Block tucked into a header "⋯" menu rather than competing for
attention, and no discovery-surface bleed (no "people like this" feed at the bottom). The one real
state overlap (Add Friend button shown alongside Message, for a dating match who isn't yet a
formal friend) is two independently true facts, not a bug — confirmed via the code's own
`on_friendship_accepted_create_match` note that friend-acceptance always creates a real match too,
so pure "connected but not `matches`-linked" friends can't actually happen. Own `ProfileScreen.js`
already led with a real identity snapshot (Aug 23 2026 IA pass) and already had Plans → Connections
(Communities/Friends) → Story (Timeline/Memory Vault/Activity/Occasions) sections in almost the
user's own order, with Settings reached only via a separate gear icon. The one real, concrete gap:
**interests had no read-only summary near the top** the way Plans/Connections already did — only
the toggleable chooser far down inside "Edit Your Profile." Added a "My Interests" read-only
section right after the identity snapshot (before "Your Plans"), reusing the exact chip treatment
`ViewProfileScreen.js` already uses to show a *real other person's* interests — the editable
chooser is untouched, still the actual editing tool. Full Jest suite 280/280 passing;
`ProfileScreen.js` transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised
in a running app (no simulator/device tooling this session, standing note).

**Thursday plan item 29 (notification categories — "an intelligent layer, not a firehose") —
fully DONE (2026-09-11).** Picked up after a codespace restart mid-build — an untracked
`.wip_notification_categories/` scratch directory (originals + partially-fixed copies of every
push-sending DB function, 45 of 59 already converted) was found, checked against the user's own
locked spec, and completed rather than restarted: the remaining 14 files were fixed following the
exact same mapping pattern the prior partial pass had already established. Per the user's own
spec, replaced the growing, ungoverned pile of individual per-feature `notify_*` booleans
(friends/dating/messages/waves/plans/things_to_do/nearby_opportunities/crossed_paths/
businesses_offers — several generations of one-off additions, see item 17's own history) with 6
named categories a user controls independently: Social, Discovery, Proximity, Planning, Business,
Community. Every one of the 59 functions in the schema that sends a push was individually
re-gated onto the 6 new columns — verified live afterward with a query for any function still
calling `send-push` without referencing one of the 6 (zero found). This full audit surfaced a
real, previously-undocumented gap: 12 business-side functions (`_accept_business_offer_internal`,
`_business_request_fanout`, `_match_request_to_availability`, `_match_request_to_policy`,
`_ai_auto_respond_to_business_requests`, `accept_business_offer`,
`admin_review_business_content_screening`'s offer-response branch,
`approve_business_partner_request`, `deny_business_partner_request`,
`notify_aggregated_demand_threshold`, `post_business_availability`,
`request_more_business_partner_info`, `respond_to_business_partnership_request`) fired pushes with
**no preference check of any kind** before this change — all now gate on `notify_business`.
`notify_community_area_demand_threshold` gates on `notify_community`; `cancel_community` gains its
first-ever gate, also `notify_community`. Mapping for the rest: notify_friends/dating/messages/
waves → notify_social; notify_things_to_do/nearby_opportunities → notify_discovery (their own
separate frequency/distance/time-pref/categories sub-preferences from item 17 are unchanged —
only the plain on/off master switch collapsed); notify_crossed_paths → notify_proximity;
notify_plans → notify_planning; notify_businesses_offers → notify_business. Migration
(`20261005_notification_categories.sql`) backfills existing users' 6 new columns honestly from
whatever they'd already set on the old ones (OR'd across every folded-in constituent, so a user
who'd opted out of everything in a now-shared category stays opted out), then drops the 9
fully-superseded old columns. Verified live: rolled-back dry-run transaction first (confirmed
clean apply + the specific gate/backfill assertions), then applied for real and re-confirmed
against production directly (6 new columns present, 0 old columns remaining, 0 ungated
`send-push` callers anywhere in the schema). `SettingsScreen.js` collapsed from 9 toggles to 6,
each with real descriptive subtext; Discovery keeps both existing "Things To Do"/"Nearby
Opportunities" customize sub-panels (now nested under its own toggle rather than each having its
own separate master switch). Full Jest suite 280/280 passing; `SettingsScreen.js` transform-
checked clean via `@babel/core` + `babel-preset-expo` (this repo's own `npx babel` resolves to a
stale global shim that fails on any modern syntax — use `require('@babel/core').transformFileSync`
directly, per this repo's own established precedent). Not exercised in a running app (no
simulator/device tooling this session, standing note). One unrelated pre-existing dead column
found during this audit, deliberately not touched (out of the scope actually asked for):
`profiles.notify_matches`, superseded by the Sep 13 2026 "Phase E" 7-category taxonomy per that
change's own code comment, but never dropped — no live function references it.

**Thursday plan item 28 ("Surprise Me") — fully DONE (2026-09-11).** Picked up mid-stream after a
usage-limit restart (the prior session's untracked `surpriseMe.js`/`surpriseMe.test.js` were
read in full and checked against the locked spec — both were correct and complete, no rewrite
needed; a real bug was found and fixed in `pickSuggestion()`, which assumed its pool argument was
pre-sorted by score instead of picking the max explicitly). Shipped exactly per the user's own
4-part locked spec: a small "✨ Surprise Me" text-link beside Home's ask box (never competing with
the coral "Find it" button); an inline quick-picker sheet (`SurpriseMeSheet.js`, a full-screen
slide `Modal`, same pattern `FiltersModal.js` already established) for When (Now/Today/This
Weekend, `gatheringDateFilter.js`'s real `DATE_OPTIONS` keys) and Mood (Social/Chill/Active/
Foodie/Date/Something New, each mapped to real existing occasion/attribute/partyType/category-tag
vocabulary in `surpriseMeLogic.js` — no free text, no new screen); one assembled suggestion
(`assembleExperience()` when the mood's occasion has a real template, else the top-scored real
`resolveIntent()` candidate) with a "You could go with {name}" enrichment only when a real
accepted friend/match's own `profiles.interests` genuinely overlaps the suggestion (never a
stranger, never forced); and a Shuffle Again that re-rolls within the already-fetched candidate
pool, only re-fetching over the network when that pool is genuinely exhausted. No new DB
migration, table, or location code — pure client-side reuse of `resolveIntent`/
`assembleExperience`/`getMyFriends`/`getMyMatches`. Full Jest suite 280/280 passing (22 new
tests); all four touched/new files (`HomeScreen.js`, `SurpriseMeSheet.js`, `surpriseMe.js`,
`surpriseMeLogic.js`) transform-checked clean under `babel-preset-expo`. Not exercised in a
running app (no simulator/device tooling this session, standing note). Commits: `7cef8df1`
(service layer), `d3c9d6b6` (Home UI wiring).

**Thursday plan item 27 (one ontology, not category = X on one screen and category = Y on
another) — audit-only, fully DONE, no code changes needed (2026-09-11).** Direct restatement of
the standing `project_intent_engine_vision` memory's own vision. Code-verified, not guessed from
memory: checked all 12 pipeline stages the critique named (user interests, intent, Discover,
Gatherings, Communities, Businesses, Events, Recommendations, Notifications, Search, Matching,
Business offers) against the actual current code. **Bottom line: the ontology is already unified
everywhere data actually gets matched** — gatherings/communities/perks/business postings/
recommendations/notifications/search/compatibility all read the same `interest_tag`/
`profiles.interests`/`categories` values, sourced from the one `INTEREST_OPTIONS`/`CATEGORY_GROUPS`
list (`gatheringCategories.js`). "Events" isn't a distinct concept anywhere in the schema — folded
into Gatherings' `interest_tag`, matching the vision doc's own "Events should be cross-category,
not a category" note, so there's nothing to fragment. Three low-risk nits found, none live bugs:
(1) `brandOffers.js` matches interests via a per-item `.toLowerCase()` string loop instead of the
array-containment operator (`@>`/`&&`) every other matcher uses — cosmetic, would only bite on a
future casing mismatch; (2) `BUSINESS_CATEGORIES` (the business-major-category list) is a
hand-maintained array that currently mirrors `CATEGORY_GROUPS`'s majors rather than being derived
from it — in sync today, nothing enforces it stays that way; (3) `businessCategoryClassifier.js`'s
free-text keyword map is necessarily its own hardcoded dictionary (classifies prose into
`BUSINESS_CATEGORIES`), inheriting nit (2)'s same caveat. None of the three were fixed — all are
maintenance-burden observations, not fragmentation a user could ever actually hit, and fixing (2)
would mean choosing whether `BUSINESS_CATEGORIES` should just become `CATEGORY_GROUPS`'s own major
keys, which is a real (if small) design call better posed to the user than silently done.

**Thursday plan item 26 (consistent "escape hatch" — never dead-end a search) — fully DONE
(2026-09-11).** An audit of every genuine "searched/browsed and found nothing, no path forward"
moment beyond item 25's own sweep. Most surfaces already had a real escape hatch, some predating
this session: `DiscoverHubScreen.js`'s unified search already routes a true "nothing matched
anywhere" search through `classifyCreateRequest()` into a real Create It flow (`nothingMatchedAnywhere`,
built 2026-08-27); `GatheringsScreen.js`'s search-empty state already offers a prefilled "Start a
[term] Gathering" (item 25 batch 2); `CommunitiesScreen.js` has no free-text search to dead-end on
at all; Home's ask-box and `CreateHubScreen.js`'s "With businesses" row already cover the
business-request escape hatch (items 4/20). Two real gaps found, both in Places (a Google-
Places-backed browse — a place can't be "created" the way a gathering/community can, so the right
escape hatch is asking businesses directly, not creating supply): `DiscoverHubScreen.js`'s
embedded Places section and the dedicated `PlacesScreen.js`'s "Nothing found nearby" state both
gained an "Ask Nearby Businesses →" action into `AskBusinessScreen`, free-text prefill only
(`PLACE_CATEGORIES` and `AskBusinessScreen`'s own leaf-tag category chips are deliberately
separate vocabularies — see `placeCategories.js`'s header comment — so this never silently
pre-selects a chip that might not actually match); `PlacesScreen.js`'s location-denied state had
no action at all (a hard dead end), fixed with a real "Enable Location →" button re-running the
screen's own existing permission flow. Full suite 258/258 passing; both touched files
transform-checked clean. Not exercised in a running app (no simulator/device tooling this
session, standing note). Commit: `3f197cd5`.

**Thursday plan item 25 (empty states need real next-actions) — fully DONE (2026-09-11).** An
audit fork inventoried the app's empty states; four batches closed every real gap it found across
the highest-visibility surfaces:
- **Batch 1** (`61cf05db`) — People/Matches/Friends: `DiscoveryScreen.js`'s browse-filtered/
  crossed-paths-filtered/first-visit empty states merged into one `renderPeopleEmptyState()` with
  real Adjust Filters/Invite Friends/Adjust Preferences actions; `FriendDiscoveryScreen.js` got a
  real Clear Filters action; `FriendDiscoverySwipeCards.js` got Invite Friends;
  `MatchesScreen.js` got Explore Things To Do + Invite Friends; `FriendsScreen.js` got a direct
  Meet New People action and its "no circles yet" modal now opens the real New Circle modal
  instead of pointing back at the screen it's already on.
- **Batch 2** (`56ded70b`) — Discover/Communities/Gatherings: `DiscoverHubScreen.js`'s category
  drill-down and all 4 unified-search empty states got real actions, including a genuine new
  `enableLocation()` (`requestForegroundPermissionsAsync` — `loadCore()` previously only ever
  checked existing permission, never prompted); `CommunitiesScreen.js` got a real Create a
  Community button; fixed a real bug in `GatheringsScreen.js` where the Nearby tab's "+ Start a
  Gathering" button was wrongly gated on a search/filter being set and so never rendered for the
  true first-visit empty state its own copy promised it to.
- **Batch 3** (`2ae744ae`) — `ActivityScreen.js`'s "Nothing new yet" got Explore Things To Do +
  Discover People actions (`notices.emptyText` checked and confirmed an orphaned, uncalled
  translation key — nothing to fix there).
- **Batch 4** (`ab06cf16`) — `BusinessDashboardScreen.js`: most of the 10 flagged empty states
  already sat beside a real always-visible action button, or are genuinely passive received-not-
  created displays (requests inbox, aggregated demand, offer performance, insights, missed/
  declined history) where forcing a CTA would be a fabricated action — left as honest empty
  states per this repo's no-fabricated-signals convention. Two were real gaps; fixing them
  surfaced a real pre-existing bug — both copy blocks promised "create one from the Create tab
  and it'll show up here," but `getMyBusinessGatherings()`/`communities.js` scope this section to
  `hosting_partner_id` = this business, and no create flow anywhere in the codebase
  (`CreateGatheringScreen.js`, `CreateCommunityScreen.js`) ever sets that column — the promise was
  already false. Softened the copy to drop the unfulfillable claim and pointed the new action at a
  real destination instead; wiring an actual business-hosted create path is flagged in-code as a
  separate, bigger feature, not silently built.

Full suite 258/258 passing throughout; every touched file transform-checked clean under
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note).

**"Thursday plan" (external UX critique items 18-24, "one connected system" objective) — fully
DONE (2026-09-11).** User's overarching ask: Nearby should feel like one connected system
(Discover → find people → decide to do it → create a plan → connect a business/place → go do
it), not a collection of separate screens. Two research forks audited the actual current state
against all 7 items before any code changed — most of it was already built from prior sessions;
only real, concrete gaps got code changes:
- **#18** (unified Discover hierarchy: What are you looking for? → Things to Do | People → sub-
  tabs, filters as content not navigation) — **already fully built**, no code needed.
  `DiscoverHubScreen.js`'s `mode`/`peopleSubMode` are in-screen state, not routes; Things-To-Do's
  category drill-down is the Phase 8 "expand in place" mechanism, also not navigation.
  `StoriesRow.js` confirmed gone (per the 2026-09-10 Discover UX cleanup).
- **#19** (filters should sit as a layer over results, never a navigation destination) — mostly
  already true (`FiltersModal` was already a real in-place modal). One real gap: the deeper
  `QuickFilterCustomize` screen it links to was a full stack push. Fixed:
  `presentation: 'modal'` in `RootNavigator.js`.
- **#20** (Create as Discover's inverse, same taxonomy powering both) — mostly already true
  (`CreateHubScreen.js` already mirrors Discover's own framing and sources `CREATE_HUB_OPTIONS`/
  `SUB_OPTIONS` from the same `INTEREST_OPTIONS` taxonomy). One real gap: no path to
  `AskBusinessScreen` (the "post a request, any business can respond" flow, distinct from the
  Phase 7 "Request a Business Partner" affiliate flow deliberately removed from this screen
  earlier) — it was only ever reachable *from* an existing gathering/community/match/Home-ask
  context. Added a "With businesses" row, navigated with no params (a genuinely blank ask).
- **#21** ("Plan" should exist everywhere it logically can) — mostly already true
  (`ViewProfileScreen`/`GatheringDetailScreen`/`BusinessProfileScreen` all already have a real
  Plan-type CTA reusing the same planning engine, `dateProposals.js`). One real gap:
  `MatchCelebrationModal` (shown right after a new match) offered only Message/dismiss. Added a
  "Plan Together" button routing to the same Together-menu destination the match row's own
  "🤝 Plan" button already uses.
- **#22** (business as the natural endpoint of Person + Intent → Activity → Place, not a separate
  ad section) — **already satisfied** by prior work: the intent resolver's `business_availability`
  results, Experience Bundles, and `DateProposalScreen`'s "Find something nearby" search (item 4)
  already implement exactly this flow; Discover's own Perks section is woven into the same
  unified results list, not a separate sponsored unit. No code change needed.
- **#23** (every recommendation should explain WHY) — real, confirmed gap on two of four
  surfaces. Gatherings and Friends discovery already had real reason text (`getGatheringFitReasons`,
  `FriendDiscoverySwipeCards`'s `sharedBits`). Fixed: `SwipeableDiscoveryCards.js` (dating swipe
  deck, plain Browse mode) now shows the same tappable compatibility "Why?" badge + shared-
  interests line the list view (`DiscoveryScreen.js`) already had, reusing the same already-
  computed `item.compatibilityScore`/`item.sharedInterests` fields. `business_availability`
  intent results (and the Experience Bundles/components that reuse the same candidate objects)
  had zero why-reasoning at all — new `getBusinessAvailabilityReasons()`
  (`intentResolverScoring.js`) mirrors each existing scoring bonus's own exact condition
  (category/subcategory/secondary-category, distance, cuisine, attribute, party-type, occasion)
  and surfaces real text for whichever ones actually fired, appended to the existing title/price
  subtitle. New Jest coverage.
- **#24** (social proof honesty — never display a count not calculated from verified underlying
  relationships) — the specific bug the user remembered ("said 3 when there was only 1") was
  **already fixed** in a prior session: `homeDashboard.js`'s `friendsActivity` dedupes by
  `host_id` before capping at 3, with an explicit code comment naming this exact failure mode. No
  other fabricated/stale social-proof count found in the surfaces checked (not exhaustive —
  community screens, `FriendsScreen`/`MatchesScreen` copy, and all push-notification bodies
  weren't individually re-checked this session).

Full suite 258/258 passing throughout; every touched file transform-checked clean under
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note). Commits: `1cad107d` (19/21/23-dating), `3678bfb3` (23-business), `2ccd3e39` (20).

**"This matches you" recommendation push notifications, external UX critique item 17 — fully
DONE (2026-09-11).** Real push notifications for gatherings/communities and business postings
that genuinely match a user's own declared interests, with real controls (on/off, frequency,
categories, distance, time preferences) — not the two dangling "honest placeholder" toggles
(`notify_things_to_do`/`notify_nearby_opportunities`, added 2026-09-13 with zero real trigger)
they were before. Scoped down to 3 concrete architecture decisions via `AskUserQuestion` before
building (all confirmed by direct user answer): (1) reuse the existing background-presence
pipeline's coarse last-known location rather than add any new location capability — and a real
finding *during* that research made this free: `presence_reports` (user_id pk, area, reported_at,
upserted by `report-presence`) already existed as exactly that table, RLS-enabled with zero
policies (confirmed live), so no new table/Edge Function/permission was needed at all; (2)
real-time pushes, capped per day, not a daily digest; (3) a simple Anytime/Evenings & Weekends
time control, not a custom quiet-hours picker. Shipped: `20261004_recommended_for_you_push.sql`
— 8 new profile preference columns (frequency/categories/max-distance/time-pref × 2 categories),
a new `recommendation_push_log` table (frequency-cap tracking, RLS enabled/zero policies,
internal only), and two real `AFTER INSERT` triggers (`notify_matching_things_to_do()` on
`gatherings`, `notify_matching_business_availability()` on `business_availability`) matching on
real interest overlap (`profiles.interests`), real distance (haversine against the presence
table, respecting both the user's own preference and — for business postings — the posting's own
stated `radius_miles`), and real time-of-day/day-of-week checks against the row's own
`scheduled_at`/`starts_at`. Only ever considers `visibility = 'everyone'` gatherings (a
friends/invite-only/community-scoped gathering is not general discoverable supply — pushing it to
an arbitrary interest-matched stranger would violate this app's own no-stranger-discovery rule).
Verified live via a comprehensive disposable rolled-back transaction against production covering
all 8 real cases (genuine match fires; wrong interest/too far/stale presence/private-visibility
all correctly suppressed; the frequency cap holds a user at exactly 3 for `few_per_day`; a
business's own linked profile is never pushed about its own posting) before applying for real —
confirmed live afterward (triggers, all 8 new columns, `recommendation_push_log` all present).
Client, original shape: a standalone `RecommendationPreferencesScreen.js`, reached via a new
"⚙️ Frequency, categories, distance & time" link under each of the two existing Settings toggles.
**Refactored same day (2026-09-11), direct user pushback**: a whole navigation destination for 4
rows of controls fought this app's own "fewer screens, contextual disclosure" direction (the
Progressive Depth doctrine in Standing Conventions below). The screen is gone; its content is now
`src/components/RecommendationCustomizePanel.js`, an inline expand-in-place panel rendered
directly under each Settings toggle's own "Customize" link (local `expandedRecPanel` state in
`SettingsScreen.js`, no navigation). Same columns/behavior, same "categories = only your own
already-declared interests" scoping — purely a presentation change, not a data-model change.
`notifications.js` routes both new push types (`recommended_gathering` → `GatheringDetail`;
`recommended_business_availability` → the Discover tab, since no per-posting consumer detail
screen exists yet). Deliberately NOT
built, disclosed rather than silently skipped: the "3 people nearby are planning X" social-proof
copy variant from the user's own example — a brand-new gathering has zero attendees at the moment
its own INSERT trigger fires, so that needs its own separate trigger on `gathering_interest`
INSERT checking a real attendee-count threshold crossed (mirroring the existing
`notify_group_intent_threshold()` shape) — a real, distinct fast-follow. Full Jest suite 252/252
passing; a direct `@babel/core` + `babel-preset-expo` transform check passed clean on all four
touched/new client files. Not exercised in a running app (no simulator/device tooling this
session, standing note).

**"Build Something Bigger" section, external UX critique item 16 — fully DONE (2026-09-11).**
`CreateHubScreen.js`'s "Want to build something bigger?" section used to promise more than its
one real button ("Create a Community") delivered. Per direct user pick (via `AskUserQuestion`,
two rounds — first the overall approach, then the exact label for the new button): added a
second, genuinely distinct entry point, "🔁 Start a Weekly Meetup," which deep-links into
`CreateGathering` with `quickStartRecurring: true` — pre-selects "Repeats: Weekly" (and
pre-expands the "More options" section that setting lives in, so it's visibly selected rather
than silently sitting collapsed) while leaving the "What" step un-skipped and every field fully
editable, same "prefill but confirm" shape every other quick-pick path on this screen already
uses. Deliberately did NOT add "Host an Event" (redundant — the icon grid above this section
already does exactly that) or "Become a Local Organizer" (no organizer role/dashboard/workflow
exists anywhere in this codebase — would have been a fabricated feature). Deliberately did NOT
label the new button "Start a Community" despite that being the user's first instinct — it
creates a recurring *gathering* (`gatherings.recurring_series_id`), never a `communities` row,
and labeling it "Start a Community" right next to the real "Create a Community" button (a
genuinely different entity) would have had two adjacent buttons both saying "community" produce
two different kinds of thing. Full Jest suite 252/252 passing; a direct `@babel/core` +
`babel-preset-expo` transform check passed clean on both touched files
(`CreateHubScreen.js`, `CreateGatheringScreen.js`). Not exercised in a running app (no simulator/
device tooling this session, standing note).

**Taxonomy-aware search — fully DONE (2026-09-11).** Closed a real gap: `searchGatherings()`/
`searchPublicCommunities()`/`search_offer_ids()` used to only match title/description (name/
description for communities), completely blind to `interest_tag`/`target_interest_tag` — a
gathering tagged `Yoga` titled "Morning Stretch Session" was invisible to a search for "yoga."
All three now also ILIKE the tag column, merged client-side same as the existing columns. New
trigram GIN indexes (`20261003_taxonomy_aware_search.sql`) on all three tag columns, same
precedent as `20260809_indexed_text_search.sql`. Verified live: function body, all 3 indexes, and
`pg_trgm` extension all confirmed present in production via the Management API. Full Jest suite
252/252 passing. Full detail: `CLAUDE_HISTORY.md`, search "Taxonomy-aware search."

**"Things To Do needs a UX pass" — external UX critique item 14 — fully DONE (2026-09-11).**
`DiscoverHubScreen.js`'s default "All" Things-to-Do landing view (the one item 14 was about) no
longer shows a single quick-date-chip toggle silently reshaping one flat "Recommended For You"
list underneath it. It now shows four real, always-visible, consistently positioned sections in
the order the critique asked for — Happening Now (a small horizontal set), Today, This Weekend,
Categories — answering "where do I want to go / what do I want to do / when do I want to do it?"
directly instead of via a wall of independent tiles. All three time sections reuse the exact same
real date-bucket logic already earmarked for this in `utils/gatheringDateFilter.js`'s own header
comment (`matchesDateFilter`, the identical logic the dedicated Gatherings screen's own "When"
filter uses) and the same fit-scoring/hero-tiering already built (`getGatheringFitReasons`,
`HERO_SCORE`/`STANDARD_SCORE`, extracted into a shared `renderGatheringTile()` so the tile
treatment isn't tripled); each tier excludes whatever a more-urgent tier already showed so nothing
repeats. Categories is a real browse row over this codebase's own single canonical 19-group
taxonomy (`CATEGORY_GROUPS`, `constants/gatheringCategories.js`) — no invented list — reusing the
existing Phase 8 "expand in place" mechanism (generalized: `expandedContext` now supports a whole
category's tags, not just one gathering's own tag+time-bucket). The dedicated "Gatherings" tab and
the search-results view are both untouched (their own prior flat-list/notable-gatherings behavior
preserved exactly) — this only reshapes the default landing view. Full Jest suite 252/252 passing;
a `@babel/core` + `babel-preset-expo` transform check passed on the touched file. Not exercised in
a running app (no simulator/device tooling this session, standing note).

**Discover UX cleanup items 8 & 9 — fully DONE (2026-09-10)**, external UX critique reply. Item 8:
the People tab's separate Stories row is gone; the signal now lives on each candidate's own avatar
(a colored ring in `DiscoveryScreen.js`/`SwipeableDiscoveryCards.js`/`FriendDiscoverySwipeCards.js`,
tapping it opens the story directly, tapping the card body always opens the profile), and "post a
story" moved to a small camera icon in the People header (`DiscoverHubScreen.js`). `StoriesRow.js`
deleted outright. Item 9: user explicitly chose "leave as-is" for both open questions (no Age/
Intent/Lifestyle consolidation into Quick Filters; no distance filter for Dating) — no code
changed. Full locked design + build detail: `CLAUDE_HISTORY.md`, search "Discover UX cleanup items
8 & 9". Not exercised in a running app (no simulator/device tooling this session, standing note) —
full Jest suite (252/252) and a babel-transform syntax check on every touched file both pass.

**"Plan" means a real place, not a generic toolbox — fully DONE (2026-09-10)**, external UX
critique reply item 4. DB migration (`20261001_plan_something_real_supply.sql`) and all client
work (`dateProposals.js`, `DateProposalScreen.js`) shipped: proposing a plan now offers a real "🔎
Find something nearby" search over live business availability before the invite is sent, and
accepting a plan with a chosen place auto-creates the bound business request instead of requiring
a second manual step. Full build/verification detail: `CLAUDE_HISTORY.md`, search `"Plan" means a
real place`. Not exercised in a running app (no simulator/device tooling this session, standing
note) — full Jest suite (252/252) and a direct babel-transform syntax check both pass.

**Unified Crossed Paths across Dating and Friends — fully DONE (2026-09-10).** ONE Crossed Paths
mechanism shared by Dating and Friends, preferring real shared-past-gathering attendance
("You were both at {title} · {time}") over a proximity sighting when both are real for a pair,
never blending the two. New `get_shared_gathering_partners()` RPC
(`20260930_shared_gathering_crossed_paths.sql`, applied and functionally verified live via
disposable rolled-back transactions) and new `src/services/crossedPathsSignals.js` (pure
merge/format/filter functions, 16 Jest tests, full suite 252/252). `proximity.js`'s
`getNearbyMatches()` and the new `friendDiscovery.js`'s `getFriendCrossedPaths()` both source from
the merged sightings+gatherings union; `FriendDiscoveryScreen.js` gained a Browse | Crossed Paths
mode switch it previously lacked entirely. Fixed a real fabricated-signal bug found during this
work: `SwipeableDiscoveryCards.js` used to show "📍 Within about 35 feet" unconditionally even for
Browse-mode data with no real proximity signal. **Not exercised against a live authenticated
session** (no simulator/device available this session, per this repo's standing note) — if
something looks wrong in the running app, check `getNearbyMatches()`/`getFriendCrossedPaths()`
first. Full locked design, research, and build/verification detail: `CLAUDE_HISTORY.md`, search
"Unified Crossed Paths."

**Category/place/business taxonomy expansion (19 groups/75 tags) — fully DONE (2026-09-06),
picked up mid-stream after a codespace restart and shipped this session, then extended same-day
per direct user follow-up.** Gathering/community categories (`gatheringCategories.js`), Places
browsing (`placeCategories.js`, new), and business categories (`BusinessPartnerApplyScreen.js`,
`businessCategoryClassifier.js`) all now share one 19-category taxonomy (was 6 groups/26 tags for
gatherings, a separate 5-vertical list for business; first pass landed 15 groups/63 tags, then a
same-day follow-up added Stay & Getaway/Health & Personal Care/Education & Classes/Attractions &
Things to See). `brand_partners.category`/`business_partner_requests.category` widened via two
migrations (`20260922_business_category_taxonomy_expansion.sql`,
`20260923_business_category_taxonomy_v2_new_majors.sql`), both verified live. Found and fixed 3
real bugs left by the interrupted prior session that would have broken production on arrival: the
first migration's `update_business_profile()` rewrite targeted a stale 8-arg signature instead of
the real live 11-arg one; three Edge Functions (`submit-business-application`,
`screen-business-content`, `business-onboarding-assistant`) still validated/suggested against the
old 6-value list; a couple of smaller stale references (a Google-type-to-category guess table, a
dead import, a stale migration-filename comment, two literal old values in a disposable
live-verify script). Full build/verification detail: `CLAUDE_HISTORY.md`, search "Category/place/
business taxonomy expansion." `docs/business/` regenerated and recommitted twice
(BusinessDashboardScreen imports from a changed file).

**Standing direction, partially built**: the user's stated product vision (saved to memory,
`project_intent_engine_vision`) is that this taxonomy should power a free-text intent engine
underneath Discover's existing "what do you want to do?" ask box (`intentResolver.js`), never
become the app's primary category-picker navigation. **First increment of layer 4 (occasion)
shipped 2026-09-06**: create-assistant's already-extracted `occasion` (birthday/anniversary/
date_night/celebration/casual_hangout/business_meal/family_gathering) now threads through
`resolveIntent()` → `resolveBusinessAvailability()` → new `occasionBonus()` in
`intentResolverScoring.js`, scored against a business's own real `brand_partners
.priority_occasions` (flat bonus, never a filter, same shape as the existing attribute/cuisine/
party-type bonuses). `search_active_business_availability()` migration
(`20260924_business_availability_priority_occasions.sql`) adds `priority_occasions` to its return
columns — verified live. The same extracted occasion now also genuinely prefills
AskBusinessScreen's existing occasion chips end to end (Home → AskBusiness →
BusinessRequestDetail), fully visible/editable, never silently committed. **First increment of layer 2 (subcategory) also shipped 2026-09-06**, per direct user pick when
asked which piece to build next: a business's own durable self-classification
(`brand_partners.subcategory` / `business_partner_requests.subcategory`, both new columns) can
now hold a finer, real leaf-tag value under whichever major `category` the business already
picked — reuses `gatheringCategories.js`'s existing ~75-tag vocabulary directly (via the new
`subcategoryOptionsFor()` export), no second taxonomy invented. Wired into
`BusinessPartnerApplyScreen.js` (new applications), `BusinessDashboardScreen.js` (edit-profile
picker + profile-header display + defaulting the "Post Availability" category picker from the
business's own subcategory), `update_business_profile()`/`approve_business_partner_request()`
RPCs, and `screen-business-content`'s business_profile branch — every existing write path that
touches a business's category was individually re-checked and updated so none of them silently
null out subcategory on an unrelated edit (see this migration's own header comment,
`20260925_business_subcategory_layer.sql`, for the full per-callsite audit). **Both deferred pieces closed out the same day, per direct "keep going"**:
(1) the AI onboarding assistant (`business-onboarding-assistant` Edge Function,
`classifyBusinessDescription()`) now also extracts a best-effort `subcategory` alongside
category/attributes/cuisine/priorityOccasions, validated against that same call's own resolved
category so it can never mismatch majors — still manual-confirm like every other AI-suggested
field on that screen. (2) `search_active_business_availability()` now also returns
`brand_partners.subcategory`, and a new `subcategoryBonus()` in `intentResolverScoring.js` scores
it as a flat bonus in `resolveBusinessAvailability()` — a business's own *standing* identity
match now counts even when the specific posting itself is untagged or tagged differently,
distinct from (and additive to) the existing per-posting `row.category` match right above it in
that same function. Deliberately still NOT touched: `businessCategoryClassifier.js`'s
deterministic keyword classifier (inventing ~75 leaf-tag keyword lists is a real content/taste
decision better left for the user to weigh in on, not a mechanical extension like the two above).
**Layer 3 (general semantic tags) first increment shipped 2026-09-27, per direct user pick of
scope (expand the existing `businessAttributes.js` vocabulary + wire it into ranking, keep the
flat text[] structure, no new tags schema) — and the same pass folded in the "Hobbies & Interests
should be a semantic tag layer, not a category" item too, per direct "yes, fold it in."**
`BUSINESS_ATTRIBUTE_OPTIONS` grew from 8 to 18 values: 5 general quality/vibe tags
(`specialty_coffee`, `laptop_friendly`, `dog_friendly`, `waterfront`, `late_night`) and 5
hobby-adjacent tags (`board_game_friendly`, `photography_friendly`, `book_lovers`,
`craft_friendly`, `fitness_focused`) — any business in any category can self-tag "good for board
games," which is how a hobby mention in an ask reaches a matching business across categories
(the vision doc's own photography example) without a new category-fan-out mechanism. No new
resolver code was needed for ranking itself — `attributeAndCuisineBonus()`
(`intentResolverScoring.js`) already scores any overlap between an ask's extracted attributes and
a business's own `row.attributes` generically, vocabulary-agnostic by construction, so widening
the array was sufficient. Every touch point that validates/suggests/extracts this vocabulary was
updated together: `brand_partners`/`business_requests` `attributes` CHECK constraints
(`20260927_business_semantic_tags_expansion.sql`, applied and verified live with disposable test
data), `update_business_profile()`/`create_business_request()` (re-`CREATE OR REPLACE`d on their
unchanged signatures — confirmed single-overload before and after), `businessAttributes.js`'s
display vocabulary, `businessAttributeExtraction.js`'s deterministic "Teach Nearby" keyword list
(new Jest coverage added), and all three Edge Functions that had their own hardcoded copies
(`create-assistant`, `business-onboarding-assistant`, `screen-business-content`) — including each
one's own AI-prompt examples, since a value merely being in the valid-list enum without a
worked example rarely gets chosen. All three functions redeployed via `npx supabase functions
deploy <name> --project-ref enmosvippabmuqslzrox` and confirmed live via the Management API's
function-body endpoint (new tag strings present in the deployed bundle). Deliberately did NOT add
a separate "romantic" value — `date_friendly` already names that same real quality.

**Multi-classification businesses — fully DONE (2026-09-10), resumed after a genuine paused
handoff (2026-09-06 session cut short by weekly usage limit).** `brand_partners`/
`business_partner_requests` gained a `categories text[]` secondary, cross-major classification
array (reusing the same 75-tag `INTEREST_OPTIONS` vocabulary `subcategory` already uses) —
DB layer (`20260928_business_multi_classification.sql`), resolver scoring
(`secondaryCategoryBonus()` in `intentResolverScoring.js`, same flat-bonus weight as
`occasionBonus()`/`attributeAndCuisineBonus()`, capped so more tags can never outrank a real
subcategory match), every write path (`brandOffers.js`, `screen-business-content`,
`BusinessDashboardScreen.js`, `BusinessPartnerApplyScreen.js`), and the public
`BusinessProfileScreen.js` display all shipped and verified live. Bundled fix: `create-assistant`'s
own hardcoded `VALID_CATEGORIES` copy was found stale a second time (still the pre-expansion
26-tag list) and widened to the real 75-tag list, redeployed and confirmed live. Full build/
verification detail: `CLAUDE_HISTORY.md`, search "multi-classification businesses."

**AI-suggestion for `categories` in `business-onboarding-assistant` — also DONE (2026-09-10),
same session, direct user follow-up ("finish what you didn't start").** Mirrors subcategory's own
AI-suggestion precedent: `classifyBusinessDescription()` now also extracts a best-effort
`categories` array, validated against the full 75-tag vocabulary and de-duped against whatever
`subcategory` it also picked (avoids double-counting the same real signal across
`subcategoryBonus()`/`secondaryCategoryBonus()`). Wired into `BusinessPartnerApplyScreen.js`'s
existing manual chip picker + AI-summary banner. Redeployed and verified live.

**Cross-category "Experiences" assembly, first increment — fully DONE (2026-09-10), same session,
per direct user "finish what you didn't start" + detailed design guidance given verbatim when
asked to pick a scope via `AskUserQuestion`.** An extensible, data-driven "recommendation recipe"
framework — `experienceTemplates.js` names, per real already-extracted `occasion`
(date_night/anniversary/birthday/celebration/family_gathering), an ordered list of components
(e.g. 🍽️ Dinner → 🎵 Something to Do → 🍰 Finish the Night), each keyed to real leaf-tag categories
from the existing 75-tag vocabulary. `assembleExperience()` (`experienceAssembly.js`) is a PURE,
client-side regrouping of `resolveIntent()`'s own already-fetched, already-scored
`business_availability` candidates — same "regroup what's already real, nothing new fetched or
computed" shape `HomeScreen.js`'s own `groupIntentResultsByType()` already uses. A component with
no genuine match is silently dropped, never forced — a recipe, not a rigid itinerary; nothing is
ever invented. Wired inline into the existing ask-box result flow (`HomeScreen.js`) as a new
section above the flat list, with claimed items filtered out of that flat list so nothing repeats.
Jest coverage added (8 tests, `experienceAssembly.test.js`); full suite 230/230 passing. Full
build/verification detail: `CLAUDE_HISTORY.md`, search "Experiences assembly." This was the last
fully-unstarted piece of the intent-engine vision — both deferred pieces named at the top of this
session (this, and the `categories` AI-suggestion above) are now shipped.

**Both of this increment's own deliberately-deferred pieces — fully DONE (2026-09-10), same day,
direct user follow-up ("finish business side experience bundles and extending the assembly beyond
business_availability").** (1) `assembleExperience()` now also includes real `gathering`
candidates, not just `business_availability` — `resolveGatherings()` (`intentResolver.js`) carries
the gathering's own real `interest_tag` as `category` onto its candidate object, the exact same
field shape `resolveBusinessAvailability`'s candidates already carry, so a genuinely matching
gathering (e.g. a live-music gathering filling "Something to Do") now fills a component
identically to a business posting — `community`/`perk`/etc. still carry no such field and remain
excluded, a real, not-yet-done, separate follow-up. (2) Business-side Experience Bundles: a
business can now explicitly self-declare, on ONE of its own live `business_availability`
postings, that it covers MULTIPLE components of one specific occasion's template all by itself
(e.g. a restaurant's own "Date Night Package" bundling dinner + live music + dessert) — two new
columns (`bundle_occasion`, `bundle_components`), both business-typed with no AI involved,
validated against a flat CHECK vocabulary (union of every template's component keys, interpreted
contextually per-occasion at read time, same precedent `brand_partners.categories`/`attributes`
already set) plus matching validation in `post_business_availability` (now 11 args — old 9-arg
signature explicitly dropped per this repo's own overload-trap convention) and in
`admin_review_business_content_screening`'s MEDIUM/UNCERTAIN raw-insert branch (the *other* write
path into this table — confirmed via `pg_get_functiondef` this is the only other one).
`search_active_business_availability` (4th column-list change now, same drop-first discipline)
returns both new fields; `resolveBusinessAvailability` carries them as
`bundleOccasion`/`bundleComponents` on the candidate. `experienceAssembly.js`'s
`assembleExperience()` pulls a genuine bundle (bundleOccasion matches the ask's own occasion AND
at least 2 of that occasion's own real component keys are covered) out and claims it as one whole
unit *before* the normal per-component loop runs, so it's presented as its own "✨ One place has
it all" unit (`HomeScreen.js`) rather than competing for a single component slot; a posting that
only ticked one box is just a normal single-component candidate, no special casing needed.
Migration `20260929_business_experience_bundles.sql` — schema, all three functions, and every
CHECK constraint verified live against production inside rolled-back transactions (valid bundle
insert + both admin-approve and low-tier RPC write paths + all three invalid-input rejections:
bad occasion, bad component, components-without-occasion). `screen-business-content` Edge
Function redeployed and confirmed live via the Management API's function-body endpoint (new
vocabulary strings present in the deployed bundle) — its own body-parsing glue was verified by
code review + bundle-content confirmation, not exercised via a live authenticated HTTP call (no
test user session available this session). Business owner picks the bundle occasion + components
via new chip pickers in `BusinessDashboardScreen.js`'s existing "Post Availability" modal, entirely
optional, resets cleanly if the occasion is changed. Jest suite extended to 14 tests
(`experienceAssembly.test.js`); full suite 236/236 passing. Deliberately NOT built: Signature
Experiences (`business_experiences` — a different, older, single-category showcase concept never
wired into the intent resolver at all) gaining its own bundle concept — out of scope, not implied
by this change.

**Crossed Paths sighting push notification — fully DONE (2026-09-11).** Item 12 of the Sep 6 2026
external UX critique's last open piece: a genuine sighting now sends a real push to both people in
the pair (each gated on their own new `notify_crossed_paths` preference, default on), deep-linking
to the other person's profile. Shipped as `notify_sighting_crossed_paths()`, a plain `AFTER INSERT`
trigger on `sightings` (`20261002_crossed_paths_sighting_notification.sql`) — the same direct-
table-trigger shape every sibling `notify_*` push in this codebase already uses (there is no
`notification_events` intermediate table anywhere in this schema, confirmed live). Dedup comes free
from `sightings`' own real shape (`UNIQUE(user_a, user_b)` + `report-presence`'s upsert never
touching `first_seen_at` on conflict, confirmed by reading the real deployed Edge Function body) —
a repeated sighting between the same pair is always an `UPDATE`, which an insert-only trigger never
fires on, so no extra dedup column was needed. Verified live via a disposable rolled-back
transaction (genuine push logged once, correctly gated per-recipient, then a re-upsert of the same
pair produced no second push). Client: `notifications.js` routes the new `crossed_paths_sighting`
type to `ViewProfile`; `SettingsScreen.js` has a new "👋 Crossed Paths" toggle. Full Jest suite
252/252 passing; real device push delivery not exercised (no simulator/device tooling available in
this project, standing note). Full research trail and design reasoning: `CLAUDE_HISTORY.md`,
search "Crossed Paths sighting push notification."

**Quick Filters customization copy — Crossed Paths "keep the app open" wording fixed, DONE
(2026-09-06), external UX critique item 12.** Real background location detection already exists
(`startBackgroundPresenceReporting`, a registered background task, started on login in
`RootNavigator.js`) — "keep the app open" was outdated, unnecessarily discouraging friction. Both
`discovery.emptyText` and `discovery.radiusInfoText` (`src/i18n/translations.js`, all 11 locales)
reworded to state what's actually true: no need to keep the app open, background checking exists,
but — per the backlog item above — the copy stops short of promising a push notification, since
none exists yet.

**Branded loading treatment — DONE (2026-09-06), external UX critique item 13.** New
`src/components/BrandedLoader.js` (the app's real splash mark + a subtle coral sweep, not a
generic spinner) now replaces `RootNavigator.js`'s session/profile boot gate, which used to be a
bare `return null` (a blank screen) — the one loading moment every app open passes through.
Deliberately scoped to that one spot rather than replacing all 16 existing `SkeletonCard` call
sites — those are still the right treatment for in-list "more items loading," per direct user
steer not to use the branded treatment everywhere.

**Quick Filters real customization (select + set values + reorder) — fully DONE (2026-09-06),
external UX critique item 9.** Dating's Customize screen used to only reorder/show-hide a fixed 3
booleans; now a shared catalog (`src/constants/quickFilterCatalog.js`) + one generic
`QuickFilterCustomizeScreen` (mode-driven) gives Dating a real settable Match % threshold plus a
new Shared Interests filter, and gives Friends its own first-time Customize affordance over its 4
real dimensions. Migration `20260921_quick_filter_customization.sql` applied and verified live.
Not tested in a running app (no simulator tooling available this session). Full build detail:
`CLAUDE_HISTORY.md`, search "Quick Filters: real select+set-values+reorder customization." The
same critique's items 10 (Messages button visual weight) and 11 (People→Dating/Friends
hierarchy) were both found already fully shipped by prior Aug 23/30 2026 work — no code change
needed for those two.

**Discover/People-Friends parity plan — fully DONE (2026-09-06).** All 4 items (Discover mode
filters in-place, Friends mode mirrors Dating's architecture, Add Friend bug, generalized "Plan
Something" flow) shipped. Full build/verification detail: `CLAUDE_HISTORY.md`, search "Discover/
People-Friends parity plan." **Follow-up fix, 2026-09-10**: the Add Friend bug's original fix
(real friendship-status lookup + Friends ✓/Message/Plan Something rendering) was correct but had
one remaining gap — `ViewProfileScreen.js` used a plain `useEffect(load, [])`, so revisiting an
already-mounted `ViewProfile` route (React Navigation reuses rather than remounts it — e.g.
profile → Chat → that same person's profile again via the chat header) never re-ran `load()`,
leaving `friendshipStatus`/`matchId` frozen at whatever they were on first mount. Switched to
`useFocusEffect` (this codebase's own established pattern) so it's always freshly read on every
focus. See `src/screens/ViewProfileScreen.js`'s own comment at the fix site for the full account.

**Host cancellation lifecycle for Communities and Gatherings — fully DONE (2026-09-06).** Both
items shipped: Communities got a real `status` column (active/paused/cancelled) with a "Manage
Community" section (Edit / Pause-Resume / Cancel / Delete-Permanently-once-cancelled); Gatherings
kept their delete-based mechanism but gained a `cancel_gathering` RPC and a "Cancel Gathering"
action in the detail screen that was previously missing entirely. Verified live against
production with disposable test data. Full build/verification detail: `CLAUDE_HISTORY.md`, search
"Host cancellation lifecycle." **2026-09-10 parity follow-up**: user re-asked for this exact spec
verbatim (unaware it had already shipped); confirmed still live and correct on re-read (including
that gathering cancellation fires a real push via `notify_gathering_cancelled()`, not just a DB
row), then closed the one real cosmetic gap — `GatheringDetailScreen.js`'s Edit/Cancel links now
sit under their own "Manage Gathering" label (new `manageSectionLabel` style, mirroring
Communities' own "Manage Community" label) instead of loose inside the general host banner.

**Phase 8 (Discover visual hierarchy + expand-in-place) is fully DONE, including section H.**
Full account moved to `CLAUDE_HISTORY.md` ("Phase 8 ... section H — BUILT").
"Business Web as an Operating System" (Phases 1-7) is fully DONE. Phases 1-6 (decline reasons,
day-of-week availability, offer-performance funnel, media-on-offer
upload, weather digest card, Requests→Opportunities rename) were verified live in production —
see `CLAUDE_HISTORY.md`, search "Business Web as an Operating System" for the full plan/audit and
each phase's build/verification detail. **Phase 7** (Path A: Expo web export of the existing
business dashboard, reusing RN screens verbatim, deployed as a static site at
`/Nearby/business/` via GitHub Pages from the committed `docs/business/` folder) landed
2026-09-05 — `App.web.js` / `BusinessWebNavigator.js` / `BusinessWebHomeScreen.js` /
`PlatformDateTimeInput.js` are the new web-only surface; `BusinessDashboardScreen.js` and
`businessFulfillment.js` gained `Platform.OS === 'web'` branches for the handful of native-only
actions (camera Moments, Stripe Connect OAuth return, native DateTimePicker, native file upload,
Share.share, GatheringDetail/CommunityDetail navigation) with honest fallback messages/behavior
rather than silent failure. Verified: `expo export -p web` builds clean, output serves correctly
under the `/Nearby/business/` base path via a local static server, no secrets in the built
bundle. **Not verified in an actual browser** — no browser/simulator tooling was available in
that session; if something looks visually off on the deployed site, that's the first thing to
suspect. `docs/business/` must be regenerated (`NEARBY_WEB_EXPORT_BASE_URL=/Nearby/business npx
expo export -p web`, then copy `dist/*` over it) and recommitted any time a business-facing
screen changes — it is not auto-built by CI (no GitHub Actions workflow exists for this yet).

**2026-09-05 fix**: `experiments.baseUrl` was originally a static value in `app.json`, which is a
*global* Expo config field, not web-scoped — `@expo/cli`'s asset-copying code applies it to every
platform's build, not just web. This broke native iOS archive builds (`ENOTDIR` copying assets
into a bogus `Nearby.app/Nearby/business/assets/...` path during "Bundle React Native code and
images"). Fixed by moving config to `app.config.js`, which only injects `experiments.baseUrl`
when the `NEARBY_WEB_EXPORT_BASE_URL` env var is set — i.e. only during the docs/business export
command above, never during a native EAS build. Do not put `baseUrl` back into `app.json` as a
static value.

## Backlog (v2 candidates — not started, do not build without a direct ask)

Deliberately out of scope for "Group planning for an Occasion" (see above) per the user's own
explicit v1 guardrail — the killer loop is Remember → Plan → Invite → Find something → Connect
business → Do it, and these would each turn it into a "giant event-management platform" the user
specifically said not to build yet:

- Complex RSVP systems (beyond the current plain invited/joined/declined on
  `occasion_group_plan_participants`)
- Elaborate invitations (custom invite text/design, themed invite cards, etc.)
- Gift registries
- Seating charts
- Massive event pages (a dedicated rich event-detail surface beyond `GroupOccasionPlanScreen`'s
  current lean voting view)
- Complicated calendars (recurring sub-events, multi-day itineraries, etc. — beyond the single
  `scheduled_date` the occasion already has)

## Standing Conventions (Locked)

These are the load-bearing rules distilled from thousands of lines of prior build history. Full
original reasoning/citations for any of these: `CLAUDE_HISTORY.md`.

- **No invented numbers, no fabricated signals, ever.** Every metric/count/reason shown anywhere
  in the app must trace to a real query result. An absent signal renders as an honest empty
  state, never a guessed placeholder.
- **Calendar = when, Nearby = what + who + where + how (Item 76, locked 2026-09-13).** Nearby
  may read device calendar context (Item 75) to inform suggestions, plans, occasions, and
  Surprise Me, but must never become a calendar-management surface itself -- no new "Calendar"
  screen/tab, no event creation/editing, no calendar-app-shaped view. Any future calendar-adjacent
  work should read and suggest, never manage.
- **No dead ends (Item 56, locked 2026-09-12).** No major surface's empty state may be
  unactionable "nothing here" copy alone — it must offer a concrete, tappable next step to a real
  existing destination (create/adjust-filters/invite/explore-elsewhere, whichever genuinely fits),
  never a fabricated one. Applies to any new empty state a future change introduces, not just the
  surfaces already audited under Items 25/26/56.
- **Coral (`colors.primary`) = action, not decoration.** Tappable-and-advances-the-user → coral.
  Informational → must not visually impersonate a button. Destructive → `colors.danger`, never
  coral. Progress/data-visualization (a fill bar, an achievement indicator) → coral is fine when
  clearly non-interactive. Secondary actions (Cancel, dismiss) → neutral/outlined; coral is
  reserved for a surface's *primary* action. This visual system is frozen — no further
  consistency sweeps expected unless new work introduces a genuinely new pattern.
- **No stranger discovery via intent, ever — hard privacy rule.** Any "find things for you"
  resolver-shaped feature (Home's intent box, Business Fulfillment matching, group-intent
  signals, etc.) may only ever surface real supply (gatherings/communities/businesses) or people
  the caller is already connected to (accepted friend or match) — never proximity/interest-based
  surfacing of an unconnected stranger. Businesses are deliberately exempt (they're discoverable
  supply by design, not a privacy concern the way a person is).
- **AI never infers or assigns a specific date/time from free text.** A user always picks
  date/time through deterministic UI (preset buttons + a picker). AI may suggest title/category/
  location/description for confirmation, never silently commit a date/time guess.
- **AI suggests, never silently commits.** Every AI-derived value anywhere in the app is shown
  back for the user's own explicit confirmation before it's saved — this holds for every
  AI-classification feature in this codebase, no exceptions.
- **Each actor only ever reports its own side's state.** A business says "I accept this Request"
  (→ becomes an Offer); a consumer says "I accept the Offer" (→ becomes a Commitment); Nearby's
  own SECURITY DEFINER RPCs compute the combined/derived state. No client ever directly flips
  another party's state.
- **Decline reasons feed a real, owner-visible insight surface — never automated re-weighting of
  the matching engine.** A business owner sees their own decline pattern and can manually tighten
  their own settings in response; nothing auto-adjusts matching behavior from decline history
  without its own separate, explicit authorization.
- **"Don't navigate for information, navigate for tasks"** (the Progressive Depth doctrine,
  locked Sep 15 2026 as a standing rule for all future UI work): a screen change should only ever
  happen when the user's actual task changes, or real information depth genuinely requires it —
  never merely because a filter, category, or already-visible data changed.
- **Feature-freeze convention**: don't start a new product surface or architectural change
  without a direct, explicit user request. This does not block bug fixes, security fixes, or
  stabilization work — those are always in scope. A direct request is always sufficient to
  proceed on something bigger; this has been explicitly invoked and overridden dozens of times
  since it was first declared (2026-08-15) and is really just describing normal operating mode.
- **Real external accounts / real money (Stripe, a real reservation/transportation provider,
  etc.) always need the user present for that decision** — never set up or connected
  autonomously, even if the schema/UI scaffolding around the seam is otherwise safe to build
  ahead of time.
- **Migration/verification discipline**: one migration file per schema change (never a
  duplicate hand-patch baked into a squashed baseline file in the same change — that exact
  mistake once broke this repo's own "rebuildable from an empty database" guarantee). Verify a
  schema change live against production with real disposable test data before considering it
  done; a full from-scratch Docker replay (`supabase/postgres:15.1.0.147`, drop/recreate an empty
  `public` schema, patch the two known image-version gaps — `auth.users.phone`,
  `storage.buckets.public` — onto the test container only, run the full `supabase/migrations/`
  folder in filename order via `psql -v ON_ERROR_STOP=1`) is the gold-standard extra proof this
  repo has historically done, but isn't mandatory for every small change — disclose plainly
  whether it was done, don't silently skip and claim parity.
- **`CREATE OR REPLACE FUNCTION` creates a second overload instead of replacing the original
  whenever the parameter list changes at all — even with an unchanged return type**, not only
  the already-documented RETURNS TABLE column-list case. Adding a new trailing default
  parameter to an existing function (discovered 2026-09-06 adding `update_business_profile`'s
  `subcategory_param`) leaves the old signature live and independently callable side by side
  with the new one, silently defeating the change for any caller still resolving to the old
  overload. Always re-check `pg_get_function_identity_arguments` for the function name right
  after any such migration; if more than one row comes back, `drop function` the old exact
  signature explicitly, and add that same explicit drop into the migration file itself before
  its `create or replace` so a from-scratch replay lands in the same single-overload state.
- **A new Postgres function defaults to PUBLIC execute access** — always explicitly
  `revoke ... from public, anon` unless it's genuinely meant to be public. Rate-limit/counter
  triggers use `SELECT ... FOR UPDATE` to avoid race conditions. Privileged `profiles` columns
  (`is_premium`, `managed_partner_id`, daily-counter columns, etc.) are guarded by a
  `prevent_self_premium_edit()`-style trigger; a legitimate server-side write to one of these
  must `perform set_config('app.trusted_update', 'true', true)` first.
- **Git workflow for this repo**: commit and push after each individual phase/increment as it
  lands, not batched at the end — this is this project's own long-standing, explicitly
  pre-authorized convention (not something to re-confirm each time), specifically so a
  mid-session restart never loses more than one increment's worth of work.
- **Migration filename ordering matters.** Migrations replay in filename lexical order,
  independent of when they were actually written — a new migration that depends on an earlier
  one must sort *after* it by filename, or a from-scratch replay will fail even though production
  (already migrated in real chronological order) looks fine. This has bitten this repo more than
  once; double-check filename ordering against real dependencies before naming a new migration.

## Reference

- `CLAUDE_HISTORY.md` — the complete historical build log (pre-2026-09-17), unedited, reverse-
  chronological. Grep by date or feature name.
- `PRODUCT_AUDIT/` — standalone audit documents from past sessions, mostly historical snapshots.
  `PRODUCTION_ARCHITECTURE_2026-08-15.md` (system-wide architecture reference) and
  `SIGNAL_CONTRACT.md` (per-signal collection/matching/ranking contract) are the two most likely
  to still be useful as a reference rather than pure history.
- No automated test framework beyond Jest unit tests on pure functions
  (`jest.config.js`/`jest.babel.config.js`) — no simulator/device testing has ever been available
  in any session on this project.
