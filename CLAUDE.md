# Nearby — Project Context for Claude Code

Nearby is a proximity-based dating/social discovery app (React Native/Expo/Supabase).
This file captures known outstanding work as of early August 2026, so a fresh Claude Code
session has the same context as the chat session that built most of this.

## Known gaps against the Aug 7 2026 external roadmap doc

The user pasted an external 16-item roadmap doc (plus a "Phase 5 (Magic)" wishlist) on
Aug 7 2026 prioritizing remaining screen work. Checked against actual repo state that same day.
Discover (item 1) was closed that session — see the section below. The rest, so nothing here
gets silently forgotten:

**Confirmed NOT built** (checked directly — grepped for it, found nothing, or the screen
exists but doesn't do the thing):
- **Create Flow as a guided multi-step wizard** — doc's vision: What do you want to do? →
  Choose activity → Date & time → Location → Public/private → Invite friends → Preview →
  Publish. What actually exists: `CreateHubScreen.js` (simple link hub) → single-screen
  `CreateGatheringScreen.js` with every field on one form, no preview step, and **no way to
  invite specific friends to a gathering at all** — `notifications.js` has a rendering `case
  'gathering_invite':` with nothing anywhere in the codebase that ever creates one; it's dead/
  vestigial. Also found (while reading this screen for this exact gap): `CreateGatheringScreen.js`
  line 35 has `uuseEffect(() => {...})` — a typo'd `useEffect` call, which is not a defined
  identifier. This throws a `ReferenceError` on every render, meaning **the whole "Host a
  Gathering" flow is currently broken/crashing in production**, unrelated to any doc gap.
- **Unified Map Experience** (#10) — `GatheringsMapView.js` plots gatherings + brand deals +
  public stories only. No people, no communities, no businesses-as-such, no "live activity"
  layer.
- **Insights** (#13, user-facing "you've attended 18 gatherings") — no dedicated screen. Real
  stats exist but are scattered inside `ProfileScreen.js` (`getProfileQuickStats`/
  `getEarnedProfileStats`), not surfaced as their own Insights experience.
- **Safety — emergency contact + check-in** (#15, half of it) — reporting, blocking, and ID
  verification all exist (`AdminReportsScreen.js`, `BlockedUsersScreen.js`,
  `IdVerificationScreen.js`). Emergency contact and a safety check-in flow do not exist
  anywhere — zero matches for `emergency_contact`/`EmergencyContact`/`safetyCheckIn` in `src/`.
- **AI Concierge** (Phase 5) — no natural-language "find me something tonight" flow anywhere.
  Would be this codebase's first real LLM call; every other place that could have used one
  (Home's `getHomeInsight()`, Discover's "Recommended for you") deliberately used real-signal
  heuristics instead, per this file's own existing entries. Needs its own explicit review
  (cost, latency, prompt-injection surface via user-generated titles/descriptions) before
  building, not a silent bolt-on.
- **Friend Circles** (Phase 5) — `FriendsScreen.js` exists (flat friends list) but no grouping
  concept (Work/Fitness/Family/Travel) anywhere in the schema or UI.
- **Momentum** (Phase 5) — no "social momentum" signal/screen anywhere.
- **Empty-state audit** — the doc's own closing suggestion (design an empty state for every
  major screen before the full version). Not done as a deliberate pass; some screens have ad
  hoc empty states (e.g. `PlacesScreen.js`'s location-denied state), most are unaudited.

**Likely fine, not re-verified against the doc's exact sub-bullets** — screens exist and are
substantial, but nobody has checked them line-by-line against the doc since:
- **Profile** (#5) — `ProfileScreen.js` (986 lines) has real stats/achievements; Memories and
  Timeline live as separate screens (`MemoryVaultScreen.js`, `TimelineScreen.js`), unconfirmed
  whether that split matches what the doc means by "Profile contains Memories/Timeline."
- **Community Screen** (#7) — `CommunityDetailScreen.js` + `CommunityChatScreen.js` exist;
  Leaders/Calendar sub-features unconfirmed.
- **People Profile** (#8) — `ViewProfileScreen.js` exists; unconfirmed whether its framing
  actually reads as "would I enjoy hanging out with this person" vs. a followers-style layout.
- **Business Profile** (#9) — `BusinessDashboardScreen.js` is the *owner's* dashboard. A
  public-facing profile a regular user browses to (gatherings/rewards/reviews/photos for that
  business) is unconfirmed to exist as a distinct screen.
- **Rewards** (#11) — perks + real billing exist (`BrandOffersScreen.js`, billing section
  below); loyalty and group-unlock mechanics unconfirmed.
- **Business Community CRM** (#12) — partially covered by `BusinessDashboardScreen.js`; full
  attendance/analytics CRM depth unconfirmed.
- **Settings** (#16) — `SettingsScreen.js` exists; unconfirmed whether Payments/Business Mode
  sections match the doc's scope.

## Outstanding: Discover mini-app (unified search/filter/map/list + recommendations)

Closed against a user-pasted external roadmap doc (Aug 7 2026) that prioritized "Discover" as
the single biggest remaining screen — a search/filter/People/Gatherings/Communities/Places/
Perks/map-list-card/AI-recommendations mini-app. Before building, checked that doc against the
actual repo state and found most of its other "build next"/"phase 2/3/5" items (Gathering
Detail, Gathering Hub, Inbox, Profile/"You", Community screens, Rewards/billing, even Timeline/
Memory Vault) already built and committed — the doc was stale. Discover was correctly identified
as the one real gap: `DiscoverHubScreen.js` was a thin 2-card router (Meet People → `Nearby`,
Gatherings → `Gatherings`) plus a stories carousel, not a browsable/searchable surface. **Core
build is done and committed; not yet manually tested in a running app** — same caveat as every
other entry in this file: verified via `@babel/core` compile of both touched files and a full
`npx expo export --platform ios` (1823 modules, same count as prior clean passes), not a
simulator/device run.

- `DiscoverHubScreen.js` rebuilt in place (same route, no navigation changes needed) into a real
  unified surface over the four already-listable/searchable content types — **not** including
  People. People were deliberately kept as their own entry card, not folded into unified text
  search: this is a proximity dating app, and searching nearby people by name is a stalking
  vector nothing else in this codebase has ever built; Browse/Crossed Paths on the dedicated
  `Nearby` screen stays the only way to find people.
- **Search**: one text box filters `getNearbyGatherings('wide')` (title/description),
  `getPublicCommunities()` (name/description), and `getActiveOffers()` (title/business name/
  description) client-side against already-fetched data — no new queries for those three. Places
  is the exception: Google Places is a metered external API, so it's only queried (debounced
  350ms) when the Places filter is active, or when a search of 2+ characters is typed with
  location granted. `searchNearbyPlaces()` in `services/places.js` gained an optional `keyword`
  param passed straight through to Google's Nearby Search `keyword=` parameter — a real,
  pre-existing Google API capability, not a new fabricated signal.
- **Filters**: a type chip row (All / Gatherings / Communities / Places / Perks) scopes which
  sections render; Places additionally gets its own category chips (coffee/restaurants/parks/
  hubs, same `PLACE_CATEGORIES` as `PlacesScreen.js`) since Google's Nearby Search requires a
  `type`. Communities already-joined by the caller are excluded (checked via `getMyCommunities()`
  against `getPublicCommunities()`), matching `CommunitiesScreen.js`'s own existing convention.
- **Map/List views**: list is default; map (shown only when the type filter is All/Gatherings/
  Perks, since Communities/Places have no map story) reuses `GatheringsMapView.js` completely
  unmodified — gatherings via their existing fuzzed coordinates, perks via `brand_offers`' own
  real lat/lng (same `mapDeals` pattern already used by `GatheringsScreen.js`). **Card view was
  not built** — `DiscoveryScreen.js` already owns a dedicated swipe-card interaction for people,
  and a generic "everything" card view has no single natural gesture across four differently-
  shaped content types; scoped out rather than built shallow.
- **"Recommended for you"**: reuses `getGatheringFitReasons()` (the existing shared scorer
  already powering Home's `bestPick` and `GatheringDetailScreen`) against the same
  already-fetched gathering list — real interest/distance/attendance/beginner-friendly signals,
  score ≥ 5 threshold, top 3, exact same convention as Home. This **is** the "AI recommendations"
  line item from the roadmap doc — a real signal-based scorer, not a new LLM call. No genuine
  natural-language "AI Concierge" was built or attempted; that would be this codebase's first
  actual LLM integration and needs its own explicit review (cost, latency, prompt-injection
  surface via user-generated gathering titles/descriptions), not a silent addition here.
- Existing working functionality preserved during the rebuild: the "Tonight" / "This Weekend"
  quick-shortcut cards (→ `Gatherings` with `initialDateFilter`) and the Gathering Memories /
  Public Stories Near You sections are all still present, unchanged in behavior.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through: unified search across all four types, the type filter chips, list↔map toggle, Places
  category chips with real location, and confirm the Recommended section's reasons render
  correctly, on both iOS and Android.

## Outstanding: Gathering Hub ("What happens after you tap Join?" redesign)

Closed against a third user-supplied vision doc (forwarded email, Jul 30 2026) describing a
live, day-of "Gathering Hub" experience that replaces the old `Alert.alert("You're In!")`
dead end. Core build is done and committed; **not yet manually tested in a running app** —
same caveat as the Gathering Detail Screen entry below. Verified: every touched file compiles
via `@babel/core`, a full `npx expo export --platform ios` (1823 modules) built clean, and the
new schema/RPCs were applied to production (`enmosvippabmuqslzrox`) and exercised directly
against the live database via `set_config('request.jwt.claims', ...)`.

- New `src/screens/GatheringHubScreen.js` + `GatheringHub` route (`RootNavigator.js`), distinct
  from `GatheringDetailScreen` for the same reason Detail was split from the list last pass:
  Detail's job is persuading you to join; Hub is the live experience for people already in.
  Joining a public (auto-approve) gathering from Detail now does
  `navigation.replace('GatheringHub', { gatheringId, justJoined: true })` instead of just
  reloading in place — Hub shows a 2.2-second "You're In! 🎉" banner (`setTimeout`, no new
  screen/route needed for it) before revealing the full hub. Host-approval gatherings still land
  on Detail's pending panel, since there's nothing live to enter until approved. Already-approved
  visitors to Detail now get an "Open Gathering Hub →" button (promoted to primary CTA; "Say
  Hello" demoted to a secondary link under it). Also wired from `GatheringsScreen`'s attending
  tab (replaces the old per-card "Group Chat" button, since Hub's own Group Chat entry covers
  that) and hosting tab (added alongside the existing Group Chat button, so hosts can check
  who's on their way/checked in without losing direct chat access).
- **Who You'll Meet**: up to 5 fellow approved attendees, each showing *every* true honest fact
  that applies (stacked, not just the first match — matches the vision doc's own example, where
  Sarah gets both a shared-interest line and "First time here" at once): real shared-interest
  overlap (`profiles.interests` intersection, same pattern as `compatibility.js`/
  `ChatScreen.js`'s existing shared-interest suggestions), the existing
  `getFirstTimerAttendeeIds()` flag, and for the host specifically "Organizer" plus a real
  `getHostStats()` "Hosted N gatherings" line (same RPC already shown on Detail). Falls back to
  "Going to {title}" only when nothing else applies. The vision doc's "Lives nearby" line for
  non-host attendees was **not** built — checked live, `profiles` has no lat/lng/location column
  at all, so there is no real per-attendee proximity signal to draw from.
- **Ice Breakers**: static, category-keyed conversation starters
  (`src/constants/gatheringHubContent.js`) — deliberately not a real AI/LLM call, same
  no-new-API-cost tradeoff already made for Home's `getHomeInsight()`. Tapping one deep-links to
  `GatheringChat` with a new `draftText` route param that prefills the message input (small
  addition to `GatheringChatScreen.js`) rather than sending on the user's behalf.
- **Checklist ("Before You Go")**: real weather via the existing `getSocialForecast()` RPC
  (reusing `getGatheringById`'s already-fetched `get_gathering_distances` fuzzed coordinates —
  no extra query) plus static, category-keyed prep tips (same constants file). The vision doc's
  "parking available" line was **not** built — no real parking-availability signal exists
  anywhere in this codebase, and a generic tip can't honestly claim it without becoming a
  fabricated per-venue fact.
- **Meet-Up Point**: a real single-pin map using the gathering's actual `precise_lat/lng` —
  previously never exposed to the client at all (`SAFE_GATHERING_FIELDS` deliberately excludes
  it; the app has only ever shown fuzzed coordinates, per `GatheringsMapView.js`'s own comment).
  New SECURITY DEFINER RPC `get_gathering_meetup_point()` (in
  `20260807_gathering_hub.sql`) returns the exact coordinates only to the host or an approved
  attendee of that specific gathering — a narrow, honest-need exception to the fuzzing rule,
  not a change to it. Verified live: an approved attendee gets real coordinates back, an
  unrelated user gets an empty result set.
- **"I'm On My Way" / "Who's Here"**: two new nullable timestamp columns on
  `gathering_interest` (`on_my_way_at`, `checked_in_at`), set via two new SECURITY DEFINER RPCs
  (`set_gathering_on_my_way`, `check_in_to_gathering` — no self-UPDATE RLS policy was opened,
  matching this codebase's existing avoidance of broad client UPDATE access on a table that also
  holds `status`/`match_id`). **These are self-reported taps, not GPS verification** — tapping
  "I'm On My Way" just records a timestamp and shows fellow attendees a count. Checking in
  switches the checked-in user's own view into a minimal "during the gathering" mode (Have fun 🎉
  / Who's Here count / Say Hi / Questions / Photos), matching the vision doc's "put the phone
  away" framing.
  **Deliberately not built**: the vision doc's Uber-style "Live Mode" (continuous location
  sharing, an actual ETA countdown, GPS-verified arrivals). This codebase has no directions/ETA
  API integrated anywhere, and continuous location sharing between attendees who haven't met
  yet is a materially different privacy posture than the fuzzed-coordinates-only approach used
  everywhere else in the app. Treat real GPS-based ETA/arrival tracking as a distinct future
  feature requiring its own explicit review, same category as the "verified visits" billing
  metric noted below — not something to bolt on here.
- **Post-gathering "what's next"**: `GatheringFeedbackModal` now has a second step after
  submitting feedback — "Anything you'd like to do next?" with Coffee / Dinner / Another walk
  chips (reusing the exact category tags `getQuickPrompts()` already maps those same labels to
  in `timeContext.js`, so they prefill `CreateGathering` the same way Home's quick-action chips
  do) plus "Join next week" (browses `Gatherings`). Requires a new `navigation` prop, now passed
  from both its call sites (`HomeScreen.js`, `GatheringHubScreen.js`); skips straight to closing
  if no `navigation` prop is given, so nothing breaks for any caller that doesn't pass one. The
  vision doc's exact rating copy ("Did tonight make your day better?" / Absolutely / Yes) was
  **not** substituted in — the modal's existing "How was it?" four-option scale (loved it/good/
  okay/not for me, from an earlier pass) is a different, already-human-framed question, and
  changing its wording wasn't attempted since the wording doesn't feed `get_host_reputation`
  (that RPC reads `felt_welcoming`/`would_attend_again` from the separate inline
  `GatheringFeedbackPrompt` widget, not `satisfaction_rating`) — no functional coupling, just an
  intentionally unmodified pre-existing question left as the user finds it. Revisit only if the
  literal copy actually matters to whoever's reading this.
- Two real, pre-existing bugs found and fixed while building this (unrelated to the feature,
  same pattern as the duplicate-import fix from the Gathering Detail pass):
  - `SelectGatheringLocationScreen.js` had a leftover `Alert.alert('DEBUG', ...)` firing on
    every render — was popping a debug alert every single time a host tried to set a custom
    gathering location.
  - `GatheringFeedbackPrompt.js` (the inline 👍/👎 prompt on past attending gathering cards) was
    calling `submitGatheringFeedback(gatheringId, feltWelcoming, wouldAttendAgain)` with two
    positional booleans, but the function's actual signature takes a single options object
    (`{ feltWelcoming, wouldAttendAgain, ... }`). Destructuring a bare `true` off that silently
    produced `{feltWelcoming: null, wouldAttendAgain: null}` — every submission through this
    specific prompt (not the richer `GatheringFeedbackModal`) was recording empty feedback.
- **Not done yet**: same as Gathering Detail — no manual run-through in a simulator/device.
  Next session should click through: join a public gathering from Detail (banner → full hub),
  tap an ice breaker (chat prefill), tap "I'm On My Way" then "check in" (minimal mode), and
  the post-feedback "what's next" chips, on both iOS and Android.

## Outstanding: Gathering Detail Screen ("Can I see myself here?" redesign)

Closed against a second user-supplied vision doc — this one about what happens after tapping
into a single gathering. Core build is done and committed; **not yet manually tested in a
running app** (no simulator/device session run this pass), so treat as "should work, verify
before considering this fully closed."

- The vision doc assumed an immersive full-screen "you tapped in" experience. That screen
  **did not exist at all** before this pass — gatherings only ever expanded in place inside
  the `GatheringsScreen.js` FlatList rows (still true, left alone). Confirmed with the user
  that the right move was a real dedicated screen, not a bigger expand-card, since several
  vision-doc pieces (a true full-bleed hero, a distinct post-join state) can't work as an
  in-list expansion.
- New `src/screens/GatheringDetailScreen.js` + `GatheringDetail` route (`RootNavigator.js`),
  reusing the same `headerTransparent` full-bleed pattern already established by
  `Gatherings`/`CommunityDetail`. Wired from every existing entry point that names a specific
  gathering: the title/host row on all three `GatheringsScreen` tabs (nearby/attending/hosting),
  all three map-view marker taps (previously just `Alert.alert` summaries — replaced with real
  navigation, net simplification), and Home's `bestPick` card (previously navigated to the
  generic `Gatherings` list with **no gathering id at all** — now deep-links to the specific
  gathering).
- Sections, each backed by real data, no invented numbers (same convention as the Home
  redesign's `bestPick`/`weeklyRecap`):
  - **Hero**: true full-bleed `cover_photo_path` image; a category-colored/icon fallback block
    (not a stock photo) when a gathering has none.
  - **"Why this fits you"**: `getGatheringFitReasons()`, a new shared pure function in
    `services/gatherings.js`. This *replaces* the reason-scoring logic that used to live only
    inline inside `homeDashboard.js`'s `bestPick` block — Home's best pick now calls the same
    function, so the two surfaces can't drift. Net behavior change on Home: `bestPick` reasons
    can now also include "Beginner friendly" (real flag, wasn't scored before); first-timer
    count is intentionally *not* computed for Home's pick (would mean an extra query per
    candidate gathering just to rank one) — only the detail screen, for its single gathering,
    computes that.
  - **Who's Going**: real avatars/names, plus an honest first-timer count via new
    `getFirstTimerAttendeeIds()` — someone who has zero other *past* approved gatherings
    anywhere, derived from `gathering_interest` (which is already publicly readable for
    approved rows), not a new RPC. Vision doc's "N people coming alone" was **not** built —
    no real signal exists for it (no "attending together" concept in the schema) and this
    codebase's convention is to skip rather than fabricate.
  - **The Vibe**: `energy_level`/`conversation_level`/`group_size_feel` now render as an actual
    read-only 5-dot fill (matching `EditGatheringScreen`'s edit-mode picker's low/high labels —
    "Chill ↔ High energy" etc.) instead of the plain "Energy 3/5" text badge that's still used
    in the in-place list-card expansion.
  - **Timeline**: `timeline_steps` now render with a connector-dot visual instead of plain text
    lines (again, only on the new screen — the list-card version is untouched).
  - **Community Perk**: expanded `GatheringOfferBadge`'s single-line badge into a full card
    (title, business name, description) using the same `getGatheringOffer()` /
    `gathering_id`-scoped `brand_offers` row that already existed.
  - **Meet the Organizer**: `getHostStats()`/`getHostReputation()` (existing RPCs, previously
    only ever rendered on `ViewProfileScreen`) now also shown inline on the detail screen. Added
    **"What people loved"**: a new `getHostLovedTags()` in `services/gatherings.js`, aggregating
    the real `great_because` tag array across a host's past `gathering_feedback` rows (that
    table is publicly SELECTable per its RLS, so no new RPC needed) into e.g. "The people · Great
    conversations · The host". This is the honest equivalent of the vision doc's "what people
    loved" quotes — there is **no free-text field anywhere** in `gathering_feedback` (confirmed
    against the live schema), so literal testimonial quotes were not built; this is real
    aggregate categorical data standing in for them, most useful for a host with an established
    track record and correctly renders as nothing for a new host with no feedback yet.
  - **Questions**: reused `GatheringQnA` as-is.
  - **Join CTA**: big button, honest copy — "JOIN GATHERING" for `is_public` gatherings (real
    auto-approve), "REQUEST TO JOIN" for host-approval gatherings (was "I'm Interested" for
    both cases in the list-card flow, which is still true there — untouched, still valid).
    `GatheringIntentModal` gained a `confirmLabel` prop (default unchanged) so the two screens
    can each show honest, context-correct copy without duplicating the modal.
  - **Post-join state**: no more `Alert.alert("You're In!")` — the detail screen re-fetches
    after joining and renders a real in-screen "You're in! 🎉" panel with a "Say Hello" button
    that deep-links straight into `GatheringChat` for that specific gathering (the old Alert's
    "Send a Message" button went to the generic `Matches` screen, not the gathering's own
    chat — that gap is now closed, only on this new screen). Host viewers see a "you're hosting
    this" banner instead of a join button; pending (awaiting host approval) viewers see a
    plain status panel. No leave/cancel-request action was added — out of scope, doesn't exist
    in the list-card flow either.
  - Skipped per the "don't fabricate" decision: star-rating widgets (reputation is real
    percentage text, not a 0–5 star signal the schema doesn't have) and the vision doc's
    specific "you'll probably enjoy coffee afterwards, 6 attendees usually continue here" —
    no continuation/attendance-linking data exists to back a claim that specific.
- While verifying files before this build, found and fixed a real, already-committed bug
  unrelated to this feature: `RootNavigator.js` had a duplicate `import OnboardingQuestionsScreen`
  (two lines, same specifier) — invalid ES module syntax that would have failed to bundle at
  all. Introduced by commit `58478501`, whose own message claimed to *remove* a duplicate route
  but the diff shows it *added* this one — looks like a mismerge from an interrupted session.
  Fixed as a one-line deletion since it blocked the whole app, not just this feature.
- **Not done yet**: no manual run-through in a simulator/device this pass. What *was* verified:
  every touched file compiles via `@babel/core`, a full production Metro export
  (`npx expo export --platform ios`, 1821 modules) built clean with no resolution errors, and
  every new/changed Supabase query shape (the `getGatheringById` joins, `getFirstTimerAttendeeIds`,
  `getHostLovedTags`) was run directly against the live production schema to confirm the
  columns/foreign keys/RLS assumptions are real, not just plausible-looking. What's still
  unverified is purely visual/UX: next session should launch the app and click through —
  tap-in from all three `GatheringsScreen` tabs, the Home best-pick card, and both a public
  and a host-approval gathering's join flow — to confirm the layout and the post-join panel
  actually look right, not just that the code runs.

## Outstanding: Billing / Monetization (contract + invoice generation + scheduling now live, Stripe still not started)

The brand-matching business model (businesses offer targeted, quantity-limited discounts;
redemptions are tracked; a "spread"/commission is the intended revenue model) now has real
per-partner billing math running end-to-end on a schedule, but no money actually moves yet:

- The WHEN design decision is resolved: billing is monthly/batched, not per-redemption
  real-time. `supabase/migrations/20260806_partner_contracts_billing.sql` adds
  `partner_contracts` (per-partner `billing_model`: per_redemption/flat_monthly/hybrid/custom,
  with rates, contract dates, `max_monthly_spend` cap, `auto_renew`) and
  `generate_monthly_invoices()`, a SECURITY DEFINER function. It locks that partner's unbilled
  `offer_redemptions` rows (`FOR UPDATE`, following the codebase's race-condition convention),
  sums them per the contract's billing model, writes a row to `business_invoices` (status
  `draft`), and stamps each redemption with `invoice_id` so it's never double-billed. `custom`
  contracts insert with `amount_due = 0` (not `null` — the column is `NOT NULL`) for finance
  to correct by hand while still in `draft`.
  **Applied to production** (`enmosvippabmuqslzrox`) and verified against the live schema —
  `business_invoices` already had matching `period_start`/`period_end`/`redemption_count`/
  `amount_due` columns from an earlier session.
- `20260806_schedule_monthly_invoices.sql` schedules it via `pg_cron` (already installed and
  in use for 8 other jobs, e.g. `send-match-reminders`) as job `generate-monthly-invoices`,
  `0 6 1 * *` (06:00 UTC on the 1st, billing the just-closed prior month, the function's
  default period). Runs as `postgres`, which owns the function, so the function's own
  `revoke all` (correctly there to stop client-side calls) doesn't block the cron invocation.
  **Also applied and verified live** (`cron.job` id 9).
- `getEstimatedAmountOwed()` in `src/services/brandOffers.js` now calls
  `get_partner_billing_estimate()` (same math as the invoice generator, run against the
  current open month) instead of the old flat $3/redemption placeholder. Returns
  `{ redemptionCount, estimatedAmount, billingModel, includedUnits, billableCount }`;
  `billingModel` is `null` when the partner has no active contract yet.
  `BusinessDashboardScreen.js` shows this in the insights tab, gated on `billingModel` being
  present and not `'custom'`, and calls out how many of the included allotment have been used.
- `partner_contracts.included_units` (added in `20260807_billing_included_units.sql`, default
  0) lets `per_redemption`/`hybrid` contracts include N free redemptions before the per-unit
  rate applies — e.g. "100 included, $0.75 each after" — instead of billing from redemption
  #1. Both billing functions compute `billable_count = greatest(count - included_units, 0)`
  and multiply that by `redemption_fee`, not the raw count. `flat_monthly`/`custom` ignore it.
- Fixed a real bug in both billing functions (`20260807_billing_contract_window_bound.sql`,
  applied and verified live): the redemption lookup was bounded only by the invoicing
  period, not by the contract's own `contract_start`/`contract_end`. A contract starting
  mid-month would have swept in — and permanently stamped `invoice_id` on — redemptions
  from before it existed; one ending mid-month would do the same for redemptions after it
  lapsed. Now both clip the window with `greatest(period_start, contract_start)` /
  `least(period_end, coalesce(contract_end, period_end))` before aggregating. Didn't show
  up in the Coastal Coffee verification below since that contract is open-ended and
  predates all its redemptions — re-verified $20.00/0-redemptions unaffected after the fix.
- One test contract exists: partner **Coastal Coffee** (`67dd3d6d-f36b-4b20-8a80-ac980baecc30`),
  contract `787d5b41-...`, `hybrid` billing, `$20/month` + `$1/redemption`, `included_units: 0`,
  open-ended, `auto_renew: true`. Verified end-to-end (simulating the real caller via
  `set_config('request.jwt.claims', ...)` since the Management API has no user session) —
  returns `$20.00` with 0 redemptions so far this month, as expected.
- No other `partner_contracts` rows exist, and there's deliberately no self-serve UI to
  create one (finance/ops decision, written via the SQL editor/service role or a future admin
  tool). Nothing will actually get invoiced for other partners until a contract is created by
  hand.
- Pricing philosophy note (from a strategy discussion, not yet decided as final policy):
  billing by raw redemption count is what's actually instrumented today; a "verified visits"
  metric (join gathering + GPS/check-in + dwell time or QR scan) was floated as a better
  long-term metric but requires building attendance/check-in verification that doesn't exist
  yet — treat that as a distinct future feature, not a pricing tweak.
- Still missing before this is real billing: no Stripe integration at all (no account
  connection, no webhook handler, no actual charging, no dispute/refund handling). Invoices
  will sit in `draft` with nothing downstream until that's built.
- A Supabase Management API access token lives in `.claude/mcp.json` (gitignored) — that's
  what made direct schema inspection and migration application against the live project
  possible from inside a Claude Code session; project ref is `enmosvippabmuqslzrox`
  (see `src/services/supabase.js`).

## Recently completed, for context (do not re-build)

- Home screen "dream redesign" gaps, closed against a user-supplied vision doc (checked
  feature-by-feature against actual code first — several items in the doc were already partly
  built under different names, e.g. "Continue Your Story" ≈ existing "Continue Your Community"):
  - **Happening Now**: `getHomeDashboard()` in `homeDashboard.js` now also returns
    `happeningNow` — gatherings from the same already-fetched `nearbyGatherings` list whose
    `scheduled_at` falls in [-30min, +2h] around now (no end-time field exists on gatherings,
    so "in progress" is approximated). Rendered as a horizontal chip row using
    `categoryStyleFor()` for icons, no extra query.
  - **Time-of-day quick actions**: `getQuickPrompts()` (already existed in `timeContext.js`,
    previously only surfaced one layer deep inside `StartSomethingModal`) is now also rendered
    directly on Home as a visible chip row under a period-aware header (`Good Morning` /
    `This Afternoon` / `Tonight` / `This Weekend`). Tapping a chip either deep-links straight to
    `CreateGathering` with a prefilled title/category, or — for the one prompt with sub-options
    (`Dinner` → Pizza/Mexican/etc.) — opens `StartSomethingModal` pre-set to that category via
    a new `initialCategory` prop, reusing the modal's existing decision tree instead of
    duplicating it. `StartSomethingModal`'s `SUB_OPTIONS` map is now exported so Home can check
    membership without hardcoding which labels have sub-menus.
  - **One AI sentence**: deliberately **not** a real LLM call — `getHomeInsight()` in
    `homeDashboard.js` is a pure, no-I/O function that picks one honest sentence from signals
    the dashboard already computed (friends making plans → best pick exists → good weather
    forecast → things happening now), in that priority order, returning `null` if none apply.
    This was an explicit tradeoff discussed with the user: no new Edge Function, no API key,
    no per-request cost, and it matches this file's existing "no invented numbers" convention
    (see `getHomeDashboard()`'s own comments on `bestPick`/`weeklyRecap`/`sinceAway`) rather than
    introducing a genuinely novel-but-untethered-from-reality text generator.
  - **"You have N opportunities" greeting line**: reuses the already-computed
    `gatheringsTodayCount`, not a new number — only shown when > 0, period-aware wording
    ("today" / "tonight" / "this weekend").
  - **Floating action button**: the "+ Start Something" button moved from an inline
    scroll-flow button to a real `position: 'absolute'` FAB pinned bottom-right over the
    ScrollView (matching the existing bottom-anchored-bar pattern already used in
    `DiscoveryScreen.js`), with extra `paddingBottom` added to the scroll content so the last
    card isn't hidden behind it.
  - Deliberately left alone: the "92% Match" hero-card framing and "unlocked because 8 members
    joined" perk copy from the original vision doc were **not** built — both would require
    fabricating numbers the codebase has no real signal for, which conflicts with the
    established convention throughout `homeDashboard.js` of never inventing a metric.
- Gathering detail redesign: three schema pieces (`20260807_gathering_detail_vibe_and_photo.sql`,
  `20260807_gathering_questions.sql`, `20260807_gathering_intents.sql`, all applied and
  verified live) plus full frontend wiring, built in one pass after a codespace restart
  interrupted the session partway through (schema files existed but were unapplied and
  completely unwired — this closed that gap):
  - `gatherings` gained `energy_level`/`conversation_level`/`group_size_feel` (1-5, nullable),
    `beginner_friendly` (default `true`), `timeline_steps` (jsonb array, max 8, `{time, label}`),
    and `cover_photo_path` (private `gathering-photos` storage bucket, host-only upload,
    `${gatheringId}/cover-*.jpg` path convention matching the `profile-photos`/`stories`
    RLS-by-folder pattern). Editable via `EditGatheringScreen.js` (1-5 tap-to-select scale
    pickers, a beginner-friendly `Switch`, an add/remove timeline step list, a cover photo
    picker reusing the `photos.js` base64-upload pattern — `fetch().blob()` silently produces
    0-byte files on iOS for local file URIs, so this stays on `FileSystem.readAsStringAsync`
    + a hand-rolled base64 decoder like the other upload paths). Displayed on gathering cards
    in `GatheringsScreen.js` (cover photo always shown when present; vibe/timeline behind a
    new "Details & questions" expand toggle on nearby cards, folded into the existing expand
    section on attending cards, always-visible on hosting cards).
  - `gathering_questions`: public Q&A, anyone can ask, only the host can answer (`GatheringQnA.js`,
    a shared component mounted with `isHost` toggled per tab — `nearby`/`attending` pass `false`,
    `hosting` passes `true` unconditionally since that list is already scoped to the caller's
    own gatherings). Both ask and answer run through `checkTextModeration` first, matching the
    rest of the codebase's text-input conventions.
  - `gathering_intents`: the private pre-join "what are you hoping for tonight?" signal —
    deliberately **never surfaced to the host**, not even in aggregate (no such RPC exists;
    don't add one without a separate explicit review, per the migration's own comment).
    `GatheringIntentModal.js` intercepts both "I'm Interested" entry points (the nearby-tab
    button and the map-view marker alert) before the existing `handleExpressInterest` fires,
    and pre-fills a user's previous answer via `getMyGatheringIntent` so re-opening it isn't
    a blank slate. Saving the intent never blocks joining — failures are swallowed with a
    console log, same as the existing post-gathering feedback modal's philosophy.
- Full security audit: RLS on every table, all Edge Functions, all storage buckets, 38+
  functions found with unintended PUBLIC/anon execute access (fixed), several race conditions
  in rate-limiting triggers fixed with `SELECT ... FOR UPDATE`.
- Navigation restructure: Profile → "You", Places (Google Places-powered), real Trending,
  Inbox split into Requests/Invitations/Reminders, two-step quick-create flow.
- Stories redesign: gathering-linked stories, differentiated expiry, host + fellow-attendee
  visibility on both the table and storage bucket RLS.
- Full onboarding redesign: landing screen, preference questions, immediate recommendations,
  post-gathering feedback loop, "first mission" + real scheduled follow-up reminder, earned
  profile stats.
- Brand-matching vision: quantity-limited offers (`redemption_limit`), interest targeting
  (`target_interest_tag`), location scoping (`brand_partners.latitude/longitude`, 50-mile
  radius via `get_nearby_offer_ids`), real shared-interest suggestions for both 1-on-1
  matches (`ChatScreen.js`) and group gatherings (`GatheringChatScreen.js`), scarcity count
  display, business-side redemption visibility.

## Known conventions in this codebase

- `trusted_update` pattern: privileged profile columns (is_premium, managed_partner_id,
  *_created_today/date counters, etc.) are protected by `prevent_self_premium_edit()` trigger;
  legitimate server-side writes must call
  `perform set_config('app.trusted_update', 'true', true)` first.
- Rate-limit triggers use `SELECT ... FOR UPDATE` on the profiles row to avoid race conditions.
- New Postgres functions default to PUBLIC execute access — always explicitly
  `revoke ... from public, anon` unless intentionally public.
- Direct SELECT on `offer_redemptions` is scoped to each user's own rows only (RLS) — always
  go through a SECURITY DEFINER RPC (e.g., `get_offer_redemption_counts`,
  `count_redemptions_since`) to get true aggregate counts.
