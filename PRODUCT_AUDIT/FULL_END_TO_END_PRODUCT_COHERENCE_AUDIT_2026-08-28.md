# Nearby — Full End-to-End Product Coherence Audit (Aug 28 2026)

**Method**: read-only. Every claim below is grounded in the current, live source code of this
repository, cited `file.js:line`. No application code, schema, or RPC was changed to produce
this document. No simulator/device was used — this sandbox has never had one; anywhere a
finding genuinely needs a real device to settle, it's marked 🟡 NOT VERIFIABLE FROM THIS
SANDBOX rather than guessed.

**Scope**: the whole consumer + business product, traced end-to-end — Home, Discover (People /
Things to Do), Dating, Friends, Gatherings, Business, Messaging, Profile/Settings — plus a
14-signal × 7-surface ranking audit, six real scenario traces, and an 11-transition "does this
still feel like one app" test.

**How this was produced**: two capped, concurrent, read-only research passes (Pass A: Home/
Discover/Dating/Friends; Pass B: Gatherings/Business/Messaging), each a fresh agent reading the
real current source directly — then a direct synthesis (not delegated) building the ranking
table, the scenario traces, the 11-transition test, severity classification of every finding,
and the two ranked top-10 lists below. This audit builds on, and re-verifies rather than
re-derives, the findings of two prior same-day audits already in this repo: the Aug 28 2026
Universal Signal & Recommendation Audit and its own follow-on remediation pass (see
`PRODUCT_AUDIT/SIGNAL_CONTRACT.md`).

---

# NEARBY PRODUCT COHERENCE SCORECARD

| # | Metric | Score |
|---|---|---|
| 1 | Navigation consistency | **7/10** |
| 2 | Visual consistency | **8/10** |
| 3 | Taxonomy consistency | **7/10** |
| 4 | Preference consistency | **6/10** |
| 5 | Filter consistency | **6/10** |
| 6 | Matching consistency | **6/10** |
| 7 | Ranking consistency | **5/10** |
| 8 | Context awareness | **6/10** |
| 9 | Business ↔ consumer integration | **5/10** |
| 10 | End-to-end actionability | **6/10** |

**Why these numbers, in one line each** — every one is a direct read on the findings below, not
a vibe:
1. Real, verbatim chrome reuse across most transitions (People↔Friends, the Things-to-Do↔People
   toggle) — held down by two chat-header asymmetries (Gathering/Business lack a "view the
   thing" link Community/1:1 both have) and one navigation dead end (Circles).
2. The strongest score here — style objects are reused verbatim, not approximated, at every
   toggle level checked.
3. Category (`interest_tag`) is a genuinely closed-loop control signal across the whole app —
   held down by two never-reconciled "price" representations and a real hole in the date-window
   vocabulary (no bucket for a specific named weekday at all).
4. Dating's canonical-field gender matching with an honest legacy fallback is excellent; held
   down by three independently-invented "why is this recommended" formulas across Home/Dating/
   Friends with no shared vocabulary between them.
5. Discover's Things-to-Do filters are real and functional; held down by Discover silently
   dropping price/party-type/cuisine/attributes/capacity for both gatherings and businesses even
   though the data is already fetched on every request.
6. Every individual matching mechanism (compatibility, friend-discovery ranking, the ask box's
   resolver) is honest and itemized on its own — held down hard by Circles being a complete
   dead end, which is the literal test system 4 asks for and fails.
7. The lowest non-tied score — gathering fullness is honestly surfaced on exactly one of at
   least four surfaces that rank/recommend gatherings, directly contradicting a principle the
   app already built once and never generalized.
8. Weather is a genuine, real re-ranking signal (not just copy) on two of the app's biggest
   surfaces — held down by a "now" window that's still two mirror-image definitions sharing one
   English word, and by the fact that a request naming a specific day of the week (not "tomorrow,"
   not "the weekend") cannot be represented anywhere in the Ask Nearby Businesses flow at all.
9. The lowest score on the scorecard — Business Opportunity match-explanation is genuinely real
   and itemized (a strong loop), but a confirmed venue for a "find us somewhere to go" gathering
   is completely invisible to every attendee except the host, which is the single most concrete
   "does a gathering create a dead end" failure found in this whole audit.
10. Most flows genuinely resolve to a real action — held down by Circles (dead end), the tennis
    scenario (falls to noise instead of Friend Discovery), and the Friday scenario (cannot be
    correctly acted on at all).

---

## Top 10 actual problems preventing Nearby from feeling like one product

Ranked, each with its severity bucket and a real file/line citation.

1. **🔴 P0 — A gathering's confirmed business venue never reaches any attendee except the host.**
   `GatheringDetailScreen.js:118-152` only fetches `businessRequest`/`acceptedBusinessOffer`
   `if (g.isHost)`; a non-host approved attendee's own `load()` sets both to `null`
   unconditionally (lines 147-151). `AcceptedBusinessOfferCard` (the component that shows the
   confirmed venue name/address/Uber link) renders in exactly 3 screens, none a non-host
   attendee view. `GatheringHubScreen.js`'s "Meet-Up Point" (`get_gathering_meetup_point()`
   RPC) always returns the gathering's *original* creation-time coordinates — never updated once
   a real business offer is accepted. An attendee who joins a "let's find us a restaurant"
   gathering has zero in-app way to learn where they're actually going. This is exactly the
   "does a full gathering create a dead-end recommendation" failure system 5's own checklist
   names directly — this is the real thing happening in the real world (a confirmed reservation),
   just never reaching the people who need to act on it.

2. **🔴 P0 — A request naming a specific day of the week (e.g. "Friday") cannot be represented
   anywhere in the Ask Nearby Businesses flow — neither by the AI classifier nor by the manual
   UI fallback.** `supabase/functions/create-assistant/index.ts:80` — `VALID_DATE_WINDOWS =
   ['now', 'today', 'tonight', 'tomorrow', 'weekend', 'flexible']` — no bucket represents "a
   named weekday beyond tomorrow," even though the model is explicitly told (line 128) *"Never
   guess a specific date, day of week, or clock time — only pick from this exact list."*
   `AskBusinessScreen.js:23-28`'s own `DATE_OPTIONS` chip set (Today / Tomorrow / This weekend /
   I'm flexible) has **no date-picker fallback at all** — confirmed via grep, zero
   `DateTimePicker` references in the file, unlike `CreateGatheringScreen.js`, which has a real
   one (`utils/whenPresets.js:13`, `CreateGatheringScreen.js:3,12,484`). This is the literal
   test the plan's own locked Scenario B runs ("Find me a nice Italian place for a date
   Friday") — the honest answer, checked directly, is that Nearby cannot currently fulfill this
   extremely common class of ask correctly on either the AI or the manual side.

3. **🟠 P1 — Gathering fullness/capacity is honestly surfaced on exactly one of at least four
   surfaces that recommend, rank, or browse gatherings.** Confirmed via direct grep: `isFull`
   appears exactly once in the entire codebase — `HomeScreen.js:695`, inside the Ask-Nearby
   intent-result panel only. `src/services/homeRecommendations.js` (Home's own "Nearby Right
   Now" section) never checks capacity at all. `GatheringsScreen.js` (the single most-used
   browse surface in the app, three tabs) shows zero fullness indication on any card — a user
   only learns a gathering is full *after* trying to join it. `DiscoverHubScreen.js`'s
   Recommended/Trending sections have zero capacity/fullness references anywhere. This directly
   contradicts a principle the app already built and locked once (P0 item 1 of the same-day
   Universal Signal Remediation Pass: *"never silently rank a dead-end result #1... show
   fullness on the result card itself"*) — that fix was scoped to one card type and never
   generalized to the other three real places a gathering recommendation renders.

4. **🟠 P1 — Friend Circles are a complete, confirmed dead end.** Real schema, real CRUD, real
   filter UI (`FriendsScreen.js:325-357,412-473`, `src/services/friendCircles.js`) — but
   `grep -rn "friend_circles|getMyCircles|friendCircles" src` outside those two files returns
   **zero results**. No invite-by-circle anywhere (`InviteFriendsModal.js`/`services/invites.js`
   have no circle awareness), no filter by circle anywhere else, no display of circle
   membership on `ViewProfileScreen`. This directly fails the plan's own explicit end-to-end
   test for system 4: "can a user discover a person → connect → organize them into a circle →
   use that relationship elsewhere in Nearby?" The first three steps work end-to-end; the
   fourth does not exist anywhere in the app.

5. **🟠 P1 — Three independent, unrelated "why is this recommended" scoring formulas coexist
   across Home/Dating/Friends with no shared vocabulary or comment connecting them.**
   (1) `getGatheringFitReasons()` (`gatherings.js:945-979` — +1/attendee capped 10, +5 interest,
   +3 distance, +2 today, +1 beginner-friendly, +1 first-timer) powers Best Pick/Trending on
   both Home and Discover. (2) `scoreGathering()`/`scoreOffer()` (`homeRecommendations.js:47-100`,
   the shared `SCORE_*` axis) powers "Nearby Right Now." (3) `scoreGatheringForResolver()`
   (`intentResolverScoring.js:170-186`, the *same* `SCORE_*` axis but a deliberately separate
   function, "because popularity would bias the cross-type ask-box ranking" per its own comment)
   powers the ask box. A fourth, genuinely different, unweighted equal-credit formula (shared
   interests + shared communities + mutual friends, `get_friend_discovery_candidates`) powers
   Friend Discovery. Each is individually honest — the issue is unexplained proliferation with
   no comment anywhere tying them together, a real risk that a future edit to one weight
   silently drifts the systems further apart without anyone noticing.

6. **🟠 P1 — "I want to meet new people who like tennis" never reaches Friend Discovery's own
   real interest-matching mechanism.** `create-assistant`'s intent taxonomy is exactly
   `gathering | community | business_partner | unclear` (`create-assistant/index.ts:118`) — there
   is no person/friend intent at all. This text classifies `unclear`, category stays `null`, and
   `resolveGatherings` runs with no date/category filter, meaning *every* upcoming gathering
   becomes a candidate, ranked only by a literal title-substring match on "meet"/"tennis"
   (`intentResolverScoring.js:69-77`). The user does see an honest disclaimer ("Nearby doesn't
   search for individual people directly…") — a real, non-silent refusal — but the fallback
   result set is close to noise, and the mechanism that could genuinely answer this
   (`get_friend_discovery_candidates`'s own `shared_interest_count` ranking) is never invoked.

7. **🟠 P1 — Two structurally separate, never-cross-checked "price" representations extracted
   independently from the same free text.** `gatherings.price_level` (a `free|$|$$|$$$` enum,
   used by `priceAndPartyBonus()` for gathering scoring) and `business_requests.budget_max` (a
   real dollar figure, used by `scoreBusinessOpportunity()`'s budget bonus) are two genuinely
   different signal shapes for "how much is this worth" — `create-assistant/index.ts:129-130`
   deliberately extracts both independently from the same ask. Coherent by design (each object
   stores price the way it always has), but a scenario like "something cheap tonight" produces
   two independent inferences that never validate against each other.

8. **🟠 P1 — The canonical "Right Now" window and Home's own `happeningNow` signal are still
   mirror-image opposites sharing the same English label.** `utils/rightNowWindow.js`'s own
   comment documents this directly: `homeDashboard.js:415-422`'s `happeningNow` uses
   `[-2h, +30min]` (mostly backward-looking — already in progress), while the canonical window
   used by the ask box's `dateWindow: 'now'` and by `GatheringsScreen`'s own "Right Now" chip
   uses `[-30min, +2h]` (mostly forward-looking — about to start). This was explicitly found and
   left open by a same-day earlier remediation pass (P2 item 8 of the Universal Signal
   Remediation Pass) — re-confirmed still true, not new.

9. **🟡 P2 — Asymmetric "view the thing" affordance across group-scoped chat headers.** 1:1
   Chat's header is itself a tappable profile link (`ChatScreen.js:374-390`); Community Chat has
   a real in-chat info panel plus a "View Full Community Page →" link
   (`RootNavigator.js:457-473`); Gathering Chat and Business Conversation both lack any
   equivalent — confirmed via full-file reads, zero `navigation.setOptions`/header-link wiring
   in either. Three of four sibling chat surfaces answer "where does this conversation's own
   subject live" differently, with no stated reason Gathering/Business specifically lack what
   Community/1:1 both have.

10. **🟡 P2 — Discover silently drops price/party-type/cuisine/attributes/capacity for both
    gatherings and businesses, even though the data is already fetched on every request, and
    Discover's own map-businesses layer carries no confidence-tier signal at all.**
    `getNearbyGatherings` already returns `capacity`/`price_level`/`party_type` on every row
    (`gatherings.js:29`) — `DiscoverHubScreen.js` never references any of them (confirmed via
    grep, zero hits). Separately, Discover's map businesses (`getNearbyBusinesses`) carry no
    "confirmed availability" vs. "may be able to help" distinction the ask box's own
    `business_availability`/`business_policy_match` tiers already establish — a business shown
    on Discover's map has no confidence-tier signal at all, even though the exact same app
    already has one for the identical concept elsewhere.

---

## Top 10 things that are already working and should NOT be disturbed

1. **The ask box's shared 6-branch resolver** (`resolveIntent`, `intentResolver.js:255-321`) —
   gatherings, communities, connected friend/match asks, standing perks, confirmed business
   availability, and policy-only businesses all rank on one genuinely comparable, itemized score
   axis, with real dedup logic preventing the same business from appearing at two confidence
   tiers at once. Not a fixed priority order — a real, working cross-type ranking system.
2. **Weather genuinely re-ranks results, not just captions the UI, on both Home and Discover**,
   via one single shared util (`utils/weatherBias.js`) with zero drift between the two screens —
   confirmed both the scoring code and the render branch on each screen independently.
3. **Dating's compatibility score is real, itemized, tap-to-explain, and genuinely drives
   Browse's sort order** (`calculateCompatibility`, `compatibility.js:1-91` — weighted, not a
   black box; `proximity.js:426` — a real `.sort()` on the returned score, not decorative).
4. **Dating's gender matching is mutual and canonical-field-first, with an honest, non-silent
   legacy fallback** (`passesGenderMatch`, `proximity.js:163-182`) for any profile that hasn't
   migrated to the newer fields yet.
5. **Friend Discovery's connect mechanism is genuinely race-hardened** — durable swipes, a real
   one-transaction friendship+match creation, and correct any-status-friendship exclusion rules
   (pending/declined/accepted all correctly block re-surfacing) — more defensive than a "just
   make it work" feature needed to be.
6. **`MatchesScreen` correctly suppresses dating-only UI for a non-romantic match** — a
   friendship- or gathering-sourced match never shows a nonsensical compatibility badge or
   "plan a date" CTA (`isRomanticMatch` check, `MatchesScreen.js:283-327`) — a genuine
   cross-surface honesty control most apps get wrong.
7. **Business Opportunity scoring produces real, itemized reasons rendered directly on the
   business's own dashboard row** (`scoreBusinessOpportunity`, `businessOpportunityScoring.js`
   — priority-attribute match, general attribute match, cuisine match, a real capped budget
   bonus, party-size fit, time-window fit) — a genuine, working answer to "does the business
   understand why Nearby sent this to them."
8. **Gathering capacity/waitlist mechanics are genuinely solid** — real row locks (no
   double-booking race), honest state labels ("🔒 Full — Join Waitlist"), and a documented rule
   that you can't retroactively "un-attend" something that already happened.
9. **Realtime delivery plus real cursor pagination is now consistent across all four
   chat-style screens** (1:1, Gathering, Community, Business) — the exact same underlying shape
   (`usePaginatedMessages`, a real `removeChannel` cleanup) confirmed in each, not three
   independently reinvented mechanisms with their own bugs.
10. **The People↔Friends and Things-to-Do↔People navigation transitions are the strongest
    single "one product, not five" signal found in this whole audit** — `FriendDiscoveryScreen`
    reuses `DiscoveryScreen`'s header style *values* verbatim, and Discover's outer and inner
    mode toggles both reuse the literal same `modeToggleRow` style object, not three
    independently-styled near-duplicates.

---

# Full per-system findings

## Systems 1-4 (Home, Discover, Dating, Friends) — Pass A

*(Full detail, reproduced verbatim from the read-only research pass.)*


Read-only. Every claim below is grounded in the current source, cited `file.js:line`. No code
was changed to produce this file.

---

## 1. Home (`src/screens/HomeScreen.js`)

**Question: does Home function as the intelligent starting point for everything Nearby can do,
or a loose stack of sections?**

**Verdict: mostly the former, with one real seam.** Home has a genuine hero (the ask box,
`HomeScreen.js:935-1029`) with an intentionally louder visual treatment than everything below it
(`intentSection` style, `HomeScreen.js:1753`, explicit comment calling it "Home's one hero
element"). Below the hero, content is organized into real named sections (Your Plans, Nearby
Right Now, Quick Picks, Happening Near You, Your Communities, Quick Stats, Because You
Like…) — not an undifferentiated stack. But three independent scoring/ranking systems for
"why is this gathering worth showing you" coexist on this one screen with no stated reason for
the split (see Finding H-1 below), and CTA hierarchy below the hero is genuinely flat (every
section reads at similar visual weight once you're past the hero).

### Checklist

- **Ask box / intent classification** — `handleHomeIntentSubmit` (`HomeScreen.js:521-566`) calls
  `classifyCreateRequest` (Edge Function `create-assistant`) then `resolveIntent`/
  `resolveCommunityIntent` (`src/services/intentResolver.js`). Real, not decorative — see the
  full resolver trace in Finding H-2.
- **Quick Picks** — `handleQuickAction` (`HomeScreen.js:421-443`) is discovery-first: navigates
  to `Gatherings` with `initialCategoryFilter`/`initialDateFilter`/`initialSearchQuery`, never
  straight to creation. Personalization is real: `getPersonalizedQuickPicks`/
  `getPinnedQuickPicks` (`src/utils/timeContext.js`, called `HomeScreen.js:895-897`) flavor
  labels from the caller's own real top-attended categories (`dashboard.becauseYouLikeCategories`,
  sourced `homeDashboard.js:541-546`), with a real user-editable pin override
  (`QuickPicksEditModal`, `profiles.home_quick_pick_categories`).
- **"Your Plans"** — real, DB-backed (`dashboard.plansGoing`/`plansHosting`/`plansGroup`,
  `HomeScreen.js:1081-1154`), links to `GatheringDetail`/`GroupPlan`, not fabricated.
- **Weather card** — real signal (`getSocialForecast`, async RPC), real reason text
  (`forecast_detail`), and now genuinely re-ranks/re-surfaces content (indoor/outdoor gathering
  suggestions, `HomeScreen.js:1353-1427`), not just copy — see Finding H-3.
- **CTA hierarchy** — one real hero (ask box). Below it: 8 more conditionally-rendered sections
  before the FAB. No second-tier visual demotion exists between "Your Plans" (a real
  `primaryHeader` style, `HomeScreen.js:1089`) and the rest (`sectionHeader`/`sectionHeaderRow`,
  visually uniform caption-weight). This is a real, if minor, flattening — once past Your Plans,
  everything else competes at the same weight.
- **Businesses on Home** — only ever surface as `business_availability`/`business_policy_match`
  ask-box result rows (`INTENT_RESULT_TYPE_LABELS`, `HomeScreen.js:68-78`) or as `perk`-type
  entries in Nearby Right Now / a perks banner. There is no standalone "featured business" section
  on Home.
- **People on Home** — Home never surfaces an individual person card. The only person-shaped
  content is the `friend_request` ask-box result type (a connected person with an open,
  compatible ask — `resolveConnectedRequests`, `intentResolver.js`) and the plain "N people
  nearby" stat row (`HomeScreen.js:1526-1530`, links to `Nearby`/Dating). No stranger discovery.

### Findings

- **H-1 (structural, not cosmetic) — three independent gathering-scoring formulas coexist on
  one screen with no stated distinction.**
  1. `getGatheringFitReasons` (`src/services/gatherings.js:945-979`) — weights: +1/attendee
     (cap 10), +5 interest, +3 distance, +2 today, +1 beginner-friendly, +1 first-timer count.
     Powers Best Pick and Trending (`homeDashboard.js:407-409,431-438`).
  2. `scoreGathering`/`scoreOffer` (`src/services/homeRecommendations.js:47-100`) — the shared
     `SCORE_*` axis (5/3/2/6) from `intentResolverScoring.js`. Powers "Nearby Right Now"
     (`HomeScreen.js:1164-1209`).
  3. `scoreGatheringForResolver` (`src/services/intentResolverScoring.js:170-186`) — same
     `SCORE_*` axis, but a distinct function, deliberately *not* reusing `getGatheringFitReasons`
     because its own comment explains popularity would bias the cross-type ask-box ranking
     (a genuinely good reason). Powers the ask box.
  Formula 1 vs. 2/3 is the real, uncited inconsistency: "Best Pick" and "Nearby Right Now" both
  answer "why should you see this gathering today," on the same screen, one section apart, using
  two different scales with no comment anywhere explaining why they aren't the same function. Not
  fatal (both are honest, itemized, real signals) but it's the kind of duplication the audit
  should flag structurally, not cosmetically — a future edit to one weight silently drifts the
  two systems further apart.
- **H-2 (positive control) — the ask box's compatibility-to-results link is real for gatherings,
  weak for cross-type ranking transparency.** `resolveIntent` (`intentResolver.js:255-321`) runs
  6 parallel branches (gatherings, communities, connected friend/match asks, perks, confirmed
  business availability, policy-only businesses) on one shared score axis, then a single
  `.sort((a,b) => b.score - a.score)` (`intentResolver.js:313`). Real dedup logic prevents the
  same business appearing at two confidence tiers (`intentResolver.js:305-311`). This is genuine,
  not a fixed priority order — see `PRODUCT_AUDIT/INTENT_LAYER_INTEGRATION_AUDIT_2026-08-14.md`
  reference in the code itself. However, nothing in the UI ever shows *why one result outranked
  another* across types — the user sees a title + one subtitle line, never "ranked above X
  because of Y," so the internal honesty of the score doesn't fully surface as user-visible trust.
- **H-3 (positive control) — weather genuinely changes results, not just copy, on Home.** The
  ask box's `resolveGatherings` (`intentResolver.js:37-83`) adds a real `SCORE_HAPPENING_NOW`
  bonus and reason text when `isWeatherIndoorBiased`/`isWeatherOutdoorBiased`
  (`src/utils/weatherBias.js:47-63`) matches the gathering's indoor/outdoor classification
  (`src/constants/gatheringIndoorOutdoor.js`). The weather card itself also renders a real,
  separate list of indoor/outdoor gatherings today (`HomeScreen.js:1377-1424`, sourced from
  `dashboard.indoorGatheringsToday`/`outdoorGatheringsToday`, `homeDashboard.js`). Genuine
  re-ranking/re-surfacing, confirmed by reading both the scoring code and the render branch.
- **H-4 — capacity/fullness is honestly surfaced on ask-box results but nowhere else on Home.**
  `resolveGatherings` computes `isFull`/`attendeeCount`/`capacity` and shows a real
  "🔒 Full — Join Waitlist" subtitle (`intentResolver.js:53-73`). "Nearby Right Now"
  (`homeRecommendations.js`) and Best Pick/Trending never check capacity at all — a full
  gathering can appear there with no fullness indicator. Inconsistent honesty within the same
  screen, not a design decision (no comment anywhere justifies the asymmetry).
- **H-5 — the "now"-window inconsistency the codebase's own P2 item 8 remediation explicitly
  left open is still open.** `utils/rightNowWindow.js:44-71` documents directly: Home's
  `happeningNow` signal (`homeDashboard.js:415-422`, window `[-2h, +30min]`, mostly
  backward-looking) uses the *mirror image* of the canonical "Right Now" window
  (`rightNowWindow.js:63-65`, `[-30min, +2h]`, mostly forward-looking) used by the ask box's
  `dateWindow: 'now'` and by `GatheringsScreen`'s own "Right Now" chip. Same English concept
  ("happening/right now"), two genuinely different real windows, confirmed by the file's own
  comment, not by inference.
- **H-6 — the "🍽️ You asked us to look for local business options" nudge and the ask box's own
  business flow are two different consent/entry mechanisms for the same underlying need**
  (`venueNeededGathering` nudge, `HomeScreen.js:1260-1278`, vs. the ask-box's business fallback,
  `HomeScreen.js:995-1027`). Not a coherence bug per se (different triggers — one is proactive
  based on a real gathering with no venue, one is reactive to a typed ask) but worth noting that
  Home now has two structurally distinct "ask nearby businesses" affordances.

---

## 2. Discover, both modes (`src/screens/DiscoverHubScreen.js`)

**Question: does switching between People mode and Things to Do mode feel like entering a
different application, or the same app with a different focus?**

**Verdict: the same app.** Both modes share the outer header (`Discover` title stays fixed,
`DiscoverHubScreen.js:467`), the identical `modeToggleRow`/`modeToggleButton` chrome is reused
verbatim for the outer Things-to-Do↔People switch *and* the inner Dating↔Friends switch inside
People mode (`DiscoverHubScreen.js:473-490` and `:582-599`, literally the same style object,
`styles.modeToggleRow`/`modeToggleButton`). Navigation model differs (Things-to-Do is a scroll of
sections; People is two embedded full screens with their own internal navigation), which is a
real, stated, and reasonable difference — People genuinely needs swipe-deck interaction, Things-
to-Do genuinely needs browse/filter/search. This reads as the same product with a different lens,
not two apps stitched together.

### Checklist

- **Stories** — Public Stories (Things-to-Do only, `DiscoverHubScreen.js:664-686`) vs. the
  personal `StoriesRow` (People mode only, `:581`) are deliberately different content classes per
  the code's own comment (`:46-58`, "converge identical user jobs, preserve genuinely different
  ones"). Real, justified split.
- **Filters/categories** — `TYPE_FILTERS` (All/Gatherings/Communities/Places/Perks,
  `DiscoverHubScreen.js:29-35`) exist only in Things-to-Do mode. People mode has **no filters at
  all** — no interest/distance filter surfaces on the Dating or Friends embedded screens from
  Discover's own chrome (each embedded screen has its own internal filters, see sections 3/4).
- **"Right Now"/"Today"/"This Week"** — three real quick-time cards
  (`DiscoverHubScreen.js:624-655`), Things-to-Do only, navigate to `Gatherings` with
  `initialDateFilter: 'now'|'today'|'week'`. `'now'` here correctly uses the canonical narrow
  window (see H-5 above — this is the *correct* one). No equivalent exists in People mode (not
  applicable — swiping has no time-window concept).
- **Weather** — real, shared `isWeatherIndoorBiased`/`isWeatherOutdoorBiased` re-ranks the
  "Recommended For You" gathering list and shows a real banner (`:387-411, 658-662`). Things-to-Do
  only; not applicable to People.
- **Businesses** — shown on the map view (`GatheringsMapView`, `businesses` prop,
  `:610-619`) and as Perks cards. Never shown in People mode (correct — not applicable).
- **Gatherings/people/recommendations/ranking** — Things-to-Do's "Recommended For You" reuses
  `getGatheringFitReasons` (see H-1) filtered to `fit.score >= 5`
  (`DiscoverHubScreen.js:395-411`) — a real, itemized threshold, not arbitrary display order.
  "🔥 Trending Near You" is a pure attendee-count sort (`:417-421`), same signal Home's own
  Trending uses (`homeDashboard.js:407-409`) — genuinely shared, a positive control.
- **Empty states** — real, per-section, honest ("No gatherings match "...".",
  `:753-758`; similarly Communities/Perks). A genuine "nothing anywhere matched" completion CTA
  exists (`nothingMatchedAnywhere`, `:441-455, 915-933`) routing the typed search through
  `classifyCreateRequest` into a real prefilled creation screen — never auto-submitted.

### Positive controls

- Mode-toggle chrome genuinely identical across all three toggle levels (outer, People's inner
  sub-toggle) — same style object, not three independently-styled near-duplicates.
- `DiscoveryScreen`/`FriendDiscoveryScreen` both accept a real `embedded` prop
  (`DiscoveryScreen.js:85-89`, `FriendDiscoveryScreen.js:50-53`) that suppresses their own
  redundant title — deliberate, documented, not an accident of reuse.
- Weather bias logic imported from the same single shared util both here and on Home
  (`utils/weatherBias.js`) — no drift between the two screens' definitions (this was itself a
  fix; the code comments document the prior 3-way drift and its resolution).

### Findings

- **D-1 — Discover never surfaces capacity/price/party-type/cuisine/attributes for gatherings or
  businesses, even though the data is already fetched.** `getNearbyGatherings` returns
  `capacity`/`price_level`/`party_type` on every row (`gatherings.js:29`, same
  `SAFE_GATHERING_FIELDS` constant the ask box's resolver reads), but
  `DiscoverHubScreen.js` never references `capacity`, `isFull`, `price_level`, `party_type`,
  `cuisine`, or `attributes` anywhere (confirmed via direct grep — zero hits). A full gathering
  can rank in "Recommended For You" or "Trending" with no fullness indicator, unlike the ask box
  (H-4's asymmetry extends to Discover too). Real gap, not a design choice — no comment anywhere
  explains the omission.
- **D-2 — People mode has zero filters, Things-to-Do has real ones; the two embedded People
  sub-screens (Dating/Friends) each carry their *own* internal filters instead.** Not itself
  wrong (each surface's filters are genuinely different — see sections 3/4), but it means "does
  Discover have filters" has three different answers depending on mode, with no unifying
  affordance. Minor, not a coherence break.
- **D-3 — the same `Coastal Coffee`-shaped "businesses" data is fetched independently here
  (`getNearbyBusinesses`, `:204`) and never cross-referenced against the ask box's own
  business-availability/policy-match tiers** — Discover's map businesses layer has no concept of
  "confirmed availability" vs. "may be able to help" the ask box's `business_availability`/
  `business_policy_match` distinction establishes (`intentResolver.js:68-78`). A business shown
  on Discover's map carries no confidence-tier signal at all. Real, if narrow, inconsistency
  between two surfaces both claiming to represent "businesses near you."
- **D-4 — the "create it" completion CTA (Decision 5) and the ask box's own "None of these?
  Create it yourself" (Home) are two independently-built instances of the same underlying flow**
  (`classifyCreateRequest` → `routeClassifiedIntentToCreation`), correctly sharing the same
  service function (`services/createAssistant.js`) — a genuine positive control, not a finding,
  noted here because it's easy to mistake for duplication; it isn't.

---

## 3. Dating (`src/screens/DiscoveryScreen.js`, `src/services/proximity.js`,
`src/services/compatibility.js`)

**Most important question: does the compatibility number actually correspond to why someone is
being shown, or is it decorative?**

**Verdict: real, not decorative — with one real structural caveat on Browse.**

- **Compatibility computation** — `calculateCompatibility`/`generateCompatibilityReport`
  (`src/services/compatibility.js:1-91`) is a genuine weighted blend: shared-interest overlap
  (Jaccard, weight 0.5), shared `basics` field matches (weight 0.35), shared music artists
  (weight 0.15) — itemized, not a black box. Tapping the badge opens the real underlying report
  (`showCompatibilityReport`, `DiscoveryScreen.js:261-265`, "Why?" affordance directly on the
  badge, `:722-733`) — genuinely explains itself, not a bare number.
- **Crossed Paths ordering** — `getNearbyMatches` (`proximity.js:184-302`) orders strictly by
  `sightings.last_seen_at desc` (`:233`), never by compatibility. This is a documented, locked
  product decision (recency = "you were physically near this person recently" is a genuinely
  different job than "best match"), not an oversight — confirmed no `.sort()` on compatibility
  anywhere in this function.
- **Browse ordering** — `getBrowseMatches` (`proximity.js:312-427`) now genuinely sorts by
  `compatibilityScore` descending (`:426`) — real fix, confirmed present. **Real structural
  caveat**: the sort happens *after* `.range(offset, offset + 19)` (`:381`), i.e. each fetched
  20-row page is sorted internally, but page 2's results are never re-sorted against page 1's —
  `loadMoreBrowse` (`DiscoveryScreen.js:225-232`) just appends. A lower-compatibility person on
  page 1 can precede a higher-compatibility person on page 2. The badge and the "70%+ Match"
  quick filter (`highCompatOnly`, `DiscoveryScreen.js:584`) are both real and consistent with the
  score, but the *list order* is only locally, not globally, compatibility-driven.
- **Filters** — Looking For / Quick Filters (Verified/70%+ Match/Online, user-customizable order
  via `QuickFilterCustomize`) / a premium-gated advanced-filters modal (education, drinking,
  etc., `DISCOVERY_FILTER_FIELDS`, `:36-39`) plus age range. All apply as real client-side
  predicates against already-fetched data (`filteredNearby`, `:429-450`) — no fabricated filter
  that doesn't actually narrow results.
- **First-open experience** — `DatingPreferencesPromptModal` (`DiscoveryScreen.js:813-821`),
  gated on `!mine.dating_preferences_set` (`:166-168`), writes the **canonical**
  `gender_identity`/`interested_in_genders`/`relationship_intention` fields
  (`DatingPreferencesPromptModal.js:96-101`) — confirmed not the legacy `discovery_gender`/
  `show_me` pair. Real positive control; the file's own header comment documents this was a
  previously-fixed bug (the modal used to write the legacy fields).
- **Canonical preferences / mutual gender matching** — `passesGenderMatch`
  (`proximity.js:163-182`) is real, mutual, bidirectional: both parties' `gender_identity` +
  `interested_in_genders` must agree when both have set the new fields; falls back to the legacy
  `show_me`/`discovery_gender` one-directional check only when either party hasn't migrated. This
  is an honest fallback, not silent breakage.
- **Cards / mutual interest** — Notice (silent) vs. Wave (announced) is a real, intentional
  asymmetric-consent design (`sendNotice`, `:327-385`; `confirmWave`, `:387-396`), distinct from a
  simple mutual-like model — explained directly in the UI's own info modal
  (`showRadiusInfo`, `:245-259`).
- **Connection to Matches/messaging** — a mutual notice creates a real `matches` row (verified via
  the shared `matches` table structure used identically by dating notices, group plans, and
  gathering/friendship-sourced matches — see section 4). `ChatScreen`/`MatchesScreen` correctly
  distinguish a romantic match from a friendship/gathering-sourced one
  (`isRomanticMatch = !source_gathering_id && !source_friendship_id`, `MatchesScreen.js:283`) and
  suppress the compatibility badge/Plan-a-date CTA for non-romantic matches (`:327`) — a genuine
  positive control for cross-surface honesty.

### Positive controls

- Compatibility is itemized, tap-to-explain, and genuinely drives Browse's local ordering — not
  decorative.
- Gender matching is mutual and canonical-field-first with an honest legacy fallback.
- Messages correctly distinguishes romantic vs. non-romantic matches so a friend-sourced match
  never gets a nonsensical compatibility badge.

### Findings

- **T-1 (structural) — Browse's compatibility sort is per-page, not global.** See above,
  `proximity.js:377-426`. A real, if narrow, gap between "compatibility drives ranking" (true,
  locally) and "the highest-compatibility person overall appears first" (not guaranteed across
  pagination boundaries).
- **T-2 — Dating has zero connection to the price/party/time/weather/capacity signal set the ask
  box and Discover's gatherings use.** Confirmed via grep: no `price_level`/`party_type`/
  `weather`/`capacity` reference anywhere in `DiscoveryScreen.js` or `proximity.js`. Expected
  (Dating candidates are people, not gatherings) but worth stating plainly for the signal table
  below — Dating is structurally isolated from every non-people signal.
- **T-3 — no first-open modal exists for Friend Discovery's own preferences the way Dating has
  one.** (Cross-referenced in section 4; noted here since Dating's own onboarding is comparatively
  richer.)

---

## 4. Friends (`src/screens/FriendsScreen.js`, `src/screens/FriendDiscoveryScreen.js`,
`src/services/friendDiscovery.js`, `src/services/friendCircles.js`)

**Specific test: can a user discover a person → connect → organize them into a Circle → actually
use that circle relationship anywhere else in the app?**

**Verdict: the first two steps work end-to-end and are genuinely well-built. The last two do
not connect — Circles are a real, confirmed dead end.**

### Trace

1. **Discover** — `FriendDiscoveryScreen` (opt-in gated, `open_to_friend_discovery`,
   `:118-138`), candidates from `get_friend_discovery_candidates`
   (`supabase/migrations/20260816_friend_discovery.sql:171-269`). Real, itemized, server-side
   ranking: `order by (shared_interest_count + shared_community_count + mutual_friend_count) desc,
   distance_miles asc nulls last, random()` (`:264-266`) — genuinely different scoring
   philosophy from both Dating's weighted-blend compatibility and the ask box's `SCORE_*` axis
   (unweighted equal-credit sum vs. two different weighted schemes elsewhere in the app — a real,
   if reasonable, third scoring system; not itself a bug, but the app now has three distinct
   "why is this person/thing ranked here" formulas across Home/Dating/Friends with no shared
   vocabulary between them).
   Alternative discovery path: `FriendsScreen`'s "People You May Know"
   (`getSuggestedFriends`, real mutual-friend-count based) and "Find Friends From Contacts."
2. **Connect** — mutual swipe on Friend Discovery creates a real `accepted` `friendships` row +
   a real `matches` row in one transaction (`record_friend_discovery_swipe`, migration
   `:281-380`) — a genuine, working end-to-end connect path, verified by reading the SQL. The
   plain `FriendsScreen` path (send/accept a friend request, `respondToFriendRequest`) is the
   slower, request-based alternative — both are real.
3. **Organize into a Circle** — `FriendsScreen.js:325-357` (chip row, filter), `:412-473`
   (create/manage modals), backed by `friend_circles`/`friend_circle_members`
   (`src/services/friendCircles.js`). Real CRUD, works.
4. **Use the circle relationship elsewhere** — **confirmed absent.** `grep -rn "friend_circles\|
   getMyCircles\|friendCircles" src --include=*.js` outside `FriendsScreen.js`/
   `friendCircles.js` itself returns **zero results**. No invite picker, no gathering-invite
   flow, no filter anywhere else in the app reads circle membership. `InviteFriendsModal.js`,
   `services/invites.js` (`sendInvite`), and `ProfileScreen.js` all have no circle awareness.
   Circles exist purely as a local, in-screen filter over the friends list
   (`FriendsScreen.js:177-179`) — the fourth step of the requested test fails.

### Checklist

- **Shares Dating's visual language** — genuinely yes at the chrome level: `FriendDiscoveryScreen`
  reuses `DiscoveryScreen`'s exact header/headerRow/headerTitle/headerSubtitle style *values*
  (`FriendDiscoveryScreen.js:363-369`, explicit comment confirming this is verbatim reuse, not
  approximation). Diverges intentionally at the interaction level: a simple binary Like/Pass deck
  (`FriendDiscoverySwipeCards.js:85-122`, two buttons) vs. Dating's asymmetric
  Skip/Wave/Notice/Rewind deck (`SwipeableDiscoveryCards.js:163-249`, four affordances) — a real,
  justified difference (Friends has no silent/announced consent asymmetry to express).
- **Simplified filters** — `FriendDiscoveryScreen.js:277-333`: one collapsible "Filters"
  accordion (Interests + Distance), deliberately smaller than Dating's two-section accordion, per
  its own comment. Real, purely client-side over the already-fetched 20-candidate batch
  (`:174-178`) — no server round trip per filter change.
- **Interests/distance** — both real fields already returned by the RPC
  (`interests`, `distance_bucket`), not fabricated.
- **Ranking** — see trace step 1 above; real and itemized, distinct formula from Dating/Home.
- **Empty states** — honest: `filtersActive && filteredCandidates.length === 0` shows
  "No one nearby matches these filters right now — try widening them"
  (`FriendDiscoveryScreen.js:335-343`), distinct from the "not yet enabled" explainer state
  (`:245-271`) — two genuinely different empty conditions, not conflated.
- **Friend Circles** — real CRUD, real filter, **zero downstream use** (see trace step 4).
- **Messages** — a friendship/Friend-Discovery-sourced match correctly renders in the same
  `MatchesScreen`/`Chat` surface as a dating match, with the romantic-only UI (compatibility
  badge, date-plan CTA) correctly suppressed (`MatchesScreen.js:283-327`, see section 3).
- **Friend discovery mechanics** — opt-in is fully separate from Dating (`open_to_friend_discovery`
  vs. Dating's implicit-always-on discoverability), own exclusion rules (any existing
  `friendships` row in any status excludes a candidate — pending/declined/accepted all correctly
  block re-surfacing, migration `:213-252`), own durable swipe table so passes persist across
  sessions/devices (`friend_discovery_swipes`).

### Positive controls

- The connect mechanism (mutual swipe → real friendship + real match, one transaction) is
  genuinely solid — race-condition-hardened per the codebase's own history (row locking on the
  friend-discovery-swipe race, referenced in migration comments), not just a happy-path insert.
- Header-chrome reuse between Dating and Friends is real and verbatim, not approximate — a
  genuine "same app" signal.
- Friend Discovery's own no-stranger-adjacent safety model (durable swipes, mutual opt-in,
  any-status friendship exclusion) is more defensive than it needed to be for a "just make it
  work" feature — a real quality signal.

### Findings

- **F-1 (structural, the requested test's own failure point) — Friend Circles are a complete
  dead end.** Real feature, real data, real UI, zero consumption anywhere else in the app. This
  directly fails the plan's own explicit end-to-end test ("organize them into a circle → use that
  relationship elsewhere"). No invite-by-circle, no filter-by-circle outside `FriendsScreen`
  itself, no display of circle membership on `ViewProfileScreen` or anywhere else.
- **F-2 — Friends has no first-open preferences modal analogous to Dating's
  `DatingPreferencesPromptModal`.** Friend Discovery's only preference is the binary
  `open_to_friend_discovery` toggle (`FriendDiscoveryScreen.js:245-270` "explainer" state) — there
  is no equivalent "what are you looking for in friends" onboarding moment. Not necessarily wrong
  (Friends' actual preference surface — interests/distance — is fully covered by the in-screen
  filter accordion), but worth noting as an asymmetry against Dating's richer first-open flow.
- **F-3 — a third independent ranking formula** (see trace step 1) — unweighted equal-credit sum
  of shared interests + shared communities + mutual friends, vs. Dating's weighted blend and the
  ask box's `SCORE_*` axis. Three real, honest, but structurally unrelated scoring systems for
  "why is this shown to you" across Home/Dating/Friends. Not necessarily wrong (each surface's
  signal set is genuinely different), but there is no shared vocabulary or comment anywhere
  connecting the three, which is a coherence risk for future maintenance more than a present
  user-facing bug.

---

## A. Signal × Surface — Home and Discover only

| Signal | Home | Discover |
|---|---|---|
| Category | USED — `resolveGatherings` category filter (`intentResolver.js:39`); Quick Picks category chips | USED — `TYPE_FILTERS`, `PLACE_CATEGORIES` (`DiscoverHubScreen.js:29-42`); `interest_tag` filter on Recommended |
| Interests | USED — `matchesYourInterests` in `getGatheringFitReasons`/`scoreGathering` (Best Pick, Nearby Right Now); `becauseYouLikeCategories` personalizes Quick Picks | USED — same `matchesYourInterests` via `getGatheringFitReasons` (Recommended) |
| Distance | USED — `distanceMiles < 2` bonus in all three home scorers | USED — same bonus in Recommended; `distanceLabel` shown on gathering cards |
| Price | USED (ask box only) — `priceAndPartyBonus` (`intentResolver.js:39-83`, `intentResolverScoring.js:88-93`) | **GAP** — `price_level` fetched (`gatherings.js:29`) but never read anywhere in `DiscoverHubScreen.js` (D-1) |
| Party type | USED (ask box only) — same `priceAndPartyBonus`; also a hard capacity filter for `business_availability` | **GAP** — same as Price, `party_type` never read (D-1) |
| Party size | USED (business tiers only) — hard feasibility filter on `resolveBusinessAvailability`/`resolvePolicyOnlyBusinesses` (`intentResolver.js:206-283`) | NOT APPLICABLE — Discover has no ask-box-style party-size input |
| Cuisine | USED (business_availability tier only) — `attributeAndCuisineBonus` (`intentResolverScoring.js:107-123`) | **GAP** — never read |
| Attributes | USED (business_availability tier only) — same function | **GAP** — never read |
| Compatibility | NOT APPLICABLE (no dating candidates shown on Home) | NOT APPLICABLE (Discover People mode delegates entirely to embedded Dating/Friends screens, no independent compat computation) |
| Weather | USED — real reranking + suggestion list (H-3) | USED — real reranking + banner (`:387-411`), same shared util |
| Time ("now"/today/week) | USED — `matchesDateWindow` in ask box; `happeningNow` on the dashboard (**inconsistent window**, H-5) | USED — 3 quick-time cards (`:624-655`), correct canonical "now" window |
| Availability (business) | USED — `resolveBusinessAvailability`, real remaining-capacity check | NOT APPLICABLE (Discover doesn't surface business availability as a distinct concept — only standing perks + map businesses) |
| Capacity (gathering fullness) | USED (ask box only, `isFull`, H-4) — absent from Nearby Right Now/Best Pick/Trending | **GAP** — never read anywhere (D-1) |
| Recency | USED — `friendsActivity`/`sinceAway` (new gatherings since last visit, `homeDashboard.js:564-567,601`) | USED (Happening Nearby stories sort only, `:346`) — not used for gathering/community/perk browse ranking |

---

## B. Scenario traces (as far as they touch Home/Discover/Friends)

### Scenario A — "I want something fun to do tonight with two friends."

`create-assistant/index.ts:127,131` extracts `partySize: 3` ("with two friends" → asker + 2, per
the prompt's own explicit rule), `dateWindow: 'tonight'`, `partyType: 'friends'` (implied by "with
... friends"). Threaded into `resolveIntent` (`HomeScreen.js:551`). **Real, but partial**: `dateWindow`
and `partyType` genuinely affect gathering scoring (`priceAndPartyBonus`,
`intentResolverScoring.js:88-93` — a flat bonus if `gathering.party_type === 'friends'`) and
`partySize` genuinely hard-filters business-availability capacity (`intentResolver.js:206-247`).
**Gap**: `partySize` is never checked against a *gathering's own remaining capacity* — only
whether the gathering is already full relative to its own approved attendees, never "can 3 more
people realistically fit." A gathering with `capacity: 4` and 3 already approved would still
appear as a top-ranked, non-full result even though only 1 more spot exists for a party of 3.
This is a real, narrow gap in Scenario A's own promise ("find appropriate activities... let the
user act") — the hand-off to the resolver leaves this to fall out of scope, at which point it's
Pass B's (Gatherings) territory to trace whether the join flow itself catches it (it does, at
join time — `join_gathering`, per CLAUDE.md — but not at *ranking* time).

### Scenario C — "It's raining. What can I do right now?"

The literal word "raining" is never parsed — `create-assistant` has no weather-extraction field.
What actually drives the outcome is real, independent GPS-based weather
(`getSocialForecast`, fetched inside `resolveIntent` in parallel with every other branch,
`intentResolver.js:339-347`) combined with `dateWindow: 'now'` (correctly mapped from "right
now," `create-assistant/index.ts:129`, using the canonical narrow window per H-5's "correct" side).
**Confirmed: weather genuinely changes results, not just copy** — `resolveGatherings` adds a real
score bonus and subtitle text to indoor-classified gatherings when the *real* forecast is
indoor-biased (`intentResolver.js:59-67`), independent of whether the user's own text said
"raining." This is arguably the right behavior (trust the sensor, not the user's claim) but is
worth stating precisely: the system does not comprehend "it's raining" as an assertion — it
happens to agree with reality because it queries reality directly.

### Scenario D — "I want to meet new people who like tennis."

**Confirmed: this ask does not reach Friend Discovery, Friend interest matching, distance, or
Circles at all.** `create-assistant`'s intent taxonomy is exactly `gathering | community |
business_partner | unclear` (`create-assistant/index.ts:118`) — there is no "person"/"friend"
intent. This text most plausibly classifies `unclear` (it describes neither creating an event nor
a group nor naming a business). Category extraction is scoped to `gathering`/`community` intents
only (`:119`), so for `unclear` the category stays `null`. In `resolveIntent`
(`HomeScreen.js:550-561`, `else` branch handles `unclear` identically to `gathering`),
`resolveGatherings` then runs with `category: null`, `dateWindow: null` (nothing timing-related
was said) — `matchesDateWindow` with no window returns `true` unconditionally
(`intentResolverScoring.js:149`), so **every** future gathering nearby becomes a "relevant"
candidate, ranked only by `scoreGatheringForResolver` (attendee-agnostic base scoring) plus a
`titleMentionBonus` — a literal substring check against `extractMeaningfulWords("I want to meet
new people who like tennis")` → `["meet", "tennis"]` (`intentResolverScoring.js:69-77`, "want,"
"people," "like" are all stopwords). Only a gathering whose *title* literally contains "meet" or
"tennis" gets any relevance boost; everything else is an unranked, undifferentiated dump of every
upcoming gathering. The user does correctly see the explicit disclaimer
(`intentUnclearNote`, `HomeScreen.js:961-967`, "Nearby doesn't search for individual people
directly — gatherings and communities are how you meet people here") — an honest refusal, not a
silent failure — but the fallback result set is close to noise, and **nothing routes this ask
toward Friend Discovery's own real interest-matching** (`get_friend_discovery_candidates`'
`shared_interest_count`, which genuinely could answer "tennis" if the taxonomy included it) even
though that mechanism exists and would be a materially better answer to this exact scenario.

---

## C. 11-transition "mini-app" test — 6 owned transitions

| Transition | Verdict | Notes |
|---|---|---|
| Home → Discover | ⚪ intentional difference, with one flag | Stacked-scroll+hero vs. header+toggle+search is a real, stated, differently-jobbed model ("what's happening in my life" vs. "what's out there"). 🟠 flag: Best Pick/Trending (shared `getGatheringFitReasons`, a positive control) sit alongside "Nearby Right Now" using a wholly different formula (H-1) — the *concept* of "recommended to you" isn't visually or structurally unified between the two screens even though it's partly the same code. |
| Discover → People | 🟢 consistent | Same screen, in-place content swap, literally the same `modeToggleRow` style object as every other toggle on this screen (`DiscoverHubScreen.js:473-490`). |
| Discover → Things To Do | 🟢 consistent | Symmetric to the above; same toggle, header persists, search/filter chips appear predictably. |
| People → Dating | 🟢 consistent | `DiscoveryScreen` embeds with its own title suppressed (`embedded` prop); own filters/accordion/mode-switcher chrome is internally consistent and independently well-built, distinct color/spacing tokens from Discover's outer chrome but visually close enough not to read as a different app. |
| People → Friends | 🟢 consistent | `FriendDiscoveryScreen` reuses `DiscoveryScreen`'s header style values verbatim (`FriendDiscoveryScreen.js:363-369`) — genuinely the strongest positive control found in this whole pass for chrome consistency. Interaction model (2-button deck vs. 4-affordance deck) differs, ⚪ intentionally, for a real, stated consent-model reason (no Notice/Wave asymmetry needed for friendship). |
| Friends → Circles | 🟠 flag (real inconsistency) | Not a navigation transition at all — Circles are an inline chip row + modal on the same `FriendsScreen`, never a distinct destination. The deeper problem isn't chrome, it's function: per F-1, organizing a friend into a Circle produces zero effect anywhere outside the screen where you made it. This is the one transition in the set of 6 that fails on substance rather than presentation. |

---

## Cross-cutting notes for synthesis (not final classification — informal severity only)

- **Structurally significant, not cosmetic**: F-1 (Circles dead end), H-5 (mirror-image "now"
  windows sharing the same label), D-1/H-4 (capacity/price/party/cuisine/attributes silently
  dropped on Discover and on most of Home despite being already fetched), Scenario D's finding
  (the ask box has no path to Friends at all, and its `unclear` fallback is closer to noise than
  a real answer for a person-shaped ask).
- **Cosmetic/minor**: H-1's three-scorer duplication (all three are individually honest, the
  issue is unexplained proliferation, not incorrectness), T-1 (Browse's per-page sort, real but
  narrow), F-3 (a third ranking formula with a real underlying reason but no cross-referenced
  vocabulary).
- **Genuine positive controls worth protecting in any future simplification pass**: the ask box's
  shared 6-branch resolver with real dedup (H-2); weather's real re-ranking on both Home and
  Discover via one shared util; Dating's mutual, canonical-field-first gender matching with an
  honest legacy fallback; Friend Discovery's connect mechanism (durable swipes, race-hardened,
  correct exclusion rules); `MatchesScreen`'s correct suppression of dating-only UI for
  friendship-sourced matches; the People↔Friends header-chrome reuse.

---

## Systems 5-7 (Gatherings, Business, Messaging) — Pass B

*(Full detail, reproduced verbatim from the read-only research pass.)*


**Scope**: Gatherings (5), Business side (6), Messaging (7) — the commitment/transaction/
communication surfaces. Read-only, no code changed. Method: direct current-code reading, no
simulator. Re-verifies prior CLAUDE.md claims against current source rather than trusting them.

---

## System 5 — Gatherings

**Trace: discover → view → join → capacity → messages → business connection → request → offer → confirmation**

| Step | File/line | Verdict |
|---|---|---|
| View | `GatheringDetailScreen.js` (whole file) | 🟢 Rich, real data throughout — fit reasons, host stats/reputation, vibe, timeline, Q&A, community/perk linkage |
| Join | `GatheringDetailScreen.js:185-225` → `expressInterest()` | 🟢 Real limit check, honest join/waitlist/request-approval branching, Success/Medium haptic differentiation |
| Capacity | `GatheringDetailScreen.js:343-349,564-574` | 🟢 Real `capacity`/`isFull`/spots-left math; "🔥 Almost full" nudge (`Math.max(2, ceil(capacity*0.2))`) uses a real, stated threshold, not fabricated |
| Waitlist | `GatheringDetailScreen.js:776-788`, `confirmLeave()` L249-277 | 🟢 A full gathering never dead-ends — "JOIN WAITLIST" always offered; leaving a spot correctly reads `"If someone's waiting on the waitlist, they'll take your spot"` |
| Messages | `GatheringChatScreen.js` (whole file) | 🟢 Real realtime channel (INSERT subscription, not polling), real pagination (`usePaginatedMessages`), real load/send error states |
| Business connection | `GatheringDetailScreen.js:600-736` | 🟢/🟠 mixed — see Finding B1 below |
| Request → offer → confirmation | `AskBusinessScreen.js`, `BusinessRequestDetailScreen.js` | 🟢 Full lifecycle real (offer comparison, Stripe payment, reservation, completion) — see System 6 |

### Finding B1 — 🔴 Confirmed business venue never reaches non-host attendees (structural, not cosmetic)

Once a host's "Find a Business for This Plan" flow lands a real accepted offer (e.g. a confirmed
restaurant for "Friday Dinner Plans"), **only the host ever sees it**:

- `GatheringDetailScreen.js:118-152` — `businessRequest`/`acceptedBusinessOffer` state is only
  ever fetched `if (g.isHost)`. A non-host approved attendee's `load()` call sets both to `null`
  unconditionally (line 147-151).
- `AcceptedBusinessOfferCard` (the component that renders the confirmed venue name/address/Uber
  link) is imported and rendered in exactly 3 screens (`GatheringDetailScreen.js:609`,
  `DateProposalScreen.js:217`, `CommunityDetailScreen.js:436`) — none of them a non-host
  gathering-attendee view.
- `GatheringHubScreen.js`'s own "Meet-Up Point" (the one attendee-facing location surface,
  L409-429) calls `getGatheringMeetupPoint()` → `get_gathering_meetup_point()` RPC
  (`supabase/migrations/00000000000000_baseline.sql:2536-2555`), which **always** returns
  `gatherings.precise_lat/precise_lng` — the location set at gathering creation, never updated
  by `accept_business_offer()`. Confirmed via grep across `supabase/migrations/*business*`: no
  migration ever writes `precise_lat`/`precise_lng` from the accepted-offer flow — they're only
  ever *read* (to seed the fan-out radius).

**Net effect**: an attendee who joins a "let's find a restaurant" gathering has zero in-app way
to learn where the confirmed restaurant actually is. They'd have to be told manually in the
group chat by the host. This is exactly the "does a full gathering create a dead-end" shape the
plan's system 5 checklist asks about — not a literal empty-results dead end, but a real-world
outcome that never propagates to the people who need to act on it. This was a deliberate,
disclosed scope decision when built (see the code's own comment, `GatheringDetailScreen.js:130-136`:
"Host-only — business_requests' own RLS only ever lets the real requester... see the row at
all"), not an oversight — but it's a genuine, still-open coherence gap worth flagging at full
severity, since "does the gathering flow through to a real dead-end-free outcome" is the exact
test system 5 names. **A real fix would need either (a) a scoped RLS widening so an approved
attendee can read their own gathering's accepted-offer row, or (b) denormalizing the confirmed
venue's name/address onto `gatherings` itself once accepted** — either is a real schema/RLS
change, not a client-only fix.

### Positive controls (working correctly, don't disturb)

- Capacity/waitlist mechanics are genuinely solid — real row locks, honest state labels, a
  documented "you can't un-attend something that already happened" rule (`leave_gathering`).
- The "Find a Business for This Plan" merged chooser (`GatheringDetailScreen.js:669-720`) is a
  real, single front door replacing what used to be two competing links — confirmed no
  duplicate/competing CTA exists anywhere else on this screen.
- `GatheringHubScreen.js`'s "Who You'll Meet" stacks every real true fact (shared interests,
  first-timer, organizer stats) rather than picking one best-guess line — matches the plan's own
  "no invented numbers" convention exactly.
- Empty/error states throughout `GatheringDetailScreen.js`/`GatheringHubScreen.js` are real
  (`LoadErrorState` with working retry), not silent blank screens.

---

## System 6 — Business side (the entire loop)

**Trace: onboarding → profile → categories/cuisine/attributes → availability → opportunities → consumer request → match explanation → offer → acceptance → reservation/action**

| Step | File/line | Verdict |
|---|---|---|
| Categories/cuisine/attributes | `BusinessDashboardScreen.js` (chip pickers, confirmed via CLAUDE.md's own extensively-verified Aug 25 taxonomy/Business Story passes — not re-read in full this pass, spot-checked instead) | 🟢 |
| Availability posting | `BusinessDashboardScreen.js:2535` "Your Availability" section | 🟢 |
| Opportunities inbox | `BusinessDashboardScreen.js:2449-2510` | 🟢 real, itemized match reasons (see Finding B2/positive control) |
| **Match explanation ("does the business understand *why*")** | `services/businessOpportunityScoring.js` (full file read) | 🟢 — see below |
| Consumer request creation | `AskBusinessScreen.js` (grepped) | 🟢 real required-field validation, real recap card |
| Offer → acceptance → reservation | `BusinessRequestDetailScreen.js` (full file read) | 🟢 real Stripe Connect flow, real reservation/payment status branches, real "Compare Your Options" comparison |
| Business sees confirmed visit | `BusinessDashboardScreen.js:2341` "📅 Upcoming Nearby Visits" | 🟢 loop closes back to the business |

### The critical question, answered directly: yes, with one confirmed gap

`scoreBusinessOpportunity()` (`src/services/businessOpportunityScoring.js`, full file) produces a
real, itemized `reasons` array — never a single opaque score — covering: priority-attribute
match, general attribute match, cuisine match, a real budget bonus (proportional, capped, with an
explicitly-disclosed placeholder reference constant), party-size-range fit (against the
business's own fulfillment policy), time-window fit, and an active priority-boost signal. Every
one of these renders on the dashboard row as a real "🎯 {label}" line
(`BusinessDashboardScreen.js:2471-2478`) — confirmed this is genuinely wired, not just computed
and discarded. **This is a real, working answer to the plan's own critical question.**

**Gap confirmed still open**: `scoreBusinessOpportunity()` takes no weather parameter at all —
Weather is not a signal in Business Opportunity ranking, even though it's now wired into
Gatherings' own browse/filter surface and the ask box (CLAUDE.md P2 items 7/8, Aug 28 2026). A
business deciding which of several open requests to respond to first gets no "this one's for an
outdoor patio and rain is coming" signal the way a consumer browsing gatherings now does. This
matches what the Universal Signal Audit already found and left unfixed (P2 scope was explicitly
"ask box + GatheringsScreen," not Business Opportunity scoring) — re-confirmed still true against
current code, not newly discovered.

### Finding B2 — 🟡 Two structurally separate "price" representations, by design, not reconciled

`gatherings.price_level` (a `free|$|$$|$$$` enum, used by `priceAndPartyBonus()` in gathering
scoring) and `business_requests.budget_max`/`business_requests` (a real dollar figure, used by
`scoreBusinessOpportunity()`'s budget bonus) are genuinely two different signal shapes for the
same underlying concept ("how much is this worth"). `create-assistant`'s extraction (`supabase/
functions/create-assistant/index.ts:129-130`) deliberately extracts **both** `priceLevel` and
`budgetMax` from the same free text independently — this is coherent by design (each downstream
object stores price the way it's always stored it), not a bug, but worth flagging for the
Signal-Contract-style system 9 table as two genuinely distinct rows rather than one unified
"Price" signal, since a scenario like F ("something cheap tonight") produces two independent,
never-cross-checked inferences.

### System 9 notes (Signal × Surface, Gatherings/Business columns)

| Signal | Gatherings | Business (Opportunity ranking) |
|---|---|---|
| Category | USED — `interest_tag` filter/scoring (`intentResolver.js:43-84`) | USED — `activePrioritySignals` boost (`businessOpportunityScoring.js:131-140`) |
| Interests | USED — via category match | NOT APPLICABLE (no personal-interest concept on the business side) |
| Distance | USED — `getGatheringMeetupPoint`, resolver distance scoring | USED at fan-out (radius-bounded before opportunities are ever created) — NOT re-scored within the opportunity list itself |
| Price | USED — `price_level` (`priceAndPartyBonus`) | USED — `budget_max` bonus (`businessOpportunityScoring.js:85-91`) — see Finding B2, two separate representations |
| Party type | USED — `priceAndPartyBonus` | NOT scored directly (no `party_type` param in `scoreBusinessOpportunity`) |
| Party size | NOT APPLICABLE at browse (capacity is separate) | USED — fulfillment-policy range fit (`businessOpportunityScoring.js:104-113`) |
| Cuisine | NOT APPLICABLE (gatherings have no cuisine field) | USED (`businessOpportunityScoring.js:75-78`) |
| Attributes | NOT APPLICABLE | USED, two-tier (priority vs general match, `businessOpportunityScoring.js:53-73`) |
| Compatibility | NOT APPLICABLE | NOT APPLICABLE |
| Weather | USED (`intentResolver.js:43-70`, `GatheringsScreen.js:582-600`) | **GAP** — `scoreBusinessOpportunity()` has no weather param at all |
| Time | USED (`priceAndPartyBonus`, "Right Now" window) | USED — time-window-vs-priority-hours fit (`businessOpportunityScoring.js:115-125`) |
| Availability | NOT APPLICABLE (gathering existence itself is the availability) | USED — feasibility hard-constraint at request-creation (CLAUDE.md P0 item 2, re-confirmed present via `businessFulfillment.js` weather/party-size code read this pass) |
| Capacity | USED — real, see System 5 above | NOT APPLICABLE at ranking (party size fit is the analog) |
| Recency | Implicit (chronological base order before scoring) | Implicit (base opportunity list order before scoring) |

### System 10 scenario notes (handoff for synthesis)

- **Scenario B** ("nice Italian place for a date Friday") — `create-assistant` correctly does
  NOT let "nice" alone imply a price tier (explicit instruction, `index.ts:130` — "leave
  priceLevel null unless something else... implies a real price tier"). `cuisine: 'italian'`
  extraction is real and gets threaded through `resolveIntent()` → `resolveBusinessAvailability()`
  (`intentResolver.js:247,279-305`) for cuisine/attribute overlap scoring. **Verified**: this
  scenario resolves correctly through the code, both for gathering-shaped candidates (party_type
  `date` via `priceAndPartyBonus`) and for business-availability candidates (cuisine match).
- **Scenario E** ("something for 8 people Saturday") — `partySize` is a hard constraint at the
  consumer resolver (business availability capacity check, per CLAUDE.md P0 item 2) but is
  never scored as a *relevance* signal for gathering candidates at the resolver stage — only
  used as a hard filter, matching the plan's own locked design. Confirmed still true.
- **Scenario F** ("something cheap tonight") — see Finding B2. `priceLevel: 'free'|'$'` should
  correctly resolve via `create-assistant`'s explicit mapping; `partyType` is correctly left null
  (no party signal in this ask) per the same file's explicit instruction not to guess.
- Hand-off point for Pass A: all four scenarios traced above assume the ask originates from
  Home's intent box (`resolveIntent()`'s caller) — Pass A owns tracing from the actual typed text
  through classification to the `resolveIntent()` call.

---

## System 7 — Messaging

**Matches, friends, circles, gathering chats, business conversations, chat titles, bubble sizing, keyboard behavior, navigation, back behavior, unread states, attachments, media, empty states**

| Surface | File | Verdict |
|---|---|---|
| 1:1 Chat | `ChatScreen.js` (grepped, ~1594 lines) | 🟢 richest surface — typing indicator, read receipts, voice notes, GIF, photo/video, real pagination+realtime |
| Matches list | `MatchesScreen.js` | 🟢 real empty state, real compatibility badge (dating-source only, correctly suppressed for friend/gathering-sourced matches) |
| Friends (embedded) | `FriendsScreen.js` via `MessagesScreen.js` | 🟢 real circles UI — see Finding B3 |
| Gathering chat | `GatheringChatScreen.js` (full file read) | 🟢 realtime+pagination, real load/send error states |
| Community chat | Confirmed via `RootNavigator.js:457-474` header comment (real in-chat info panel, replacing a confusing dead-end-reading headerRight) | 🟢 |
| Business conversation | `BusinessConversationScreen.js` (full file read) | 🟢 realtime+pagination — see Finding B4 for one asymmetry |
| Chat titles | `RootNavigator.js:400,452,458-473,486` | 🟢 consistent "{X} Chat" convention across Gathering/Community; 1:1 Chat and Business use the person/partner name directly (a real, intentional difference — a 1:1 conversation's "title" is the person, not "X Chat") |
| Unread states | `MessagesScreen.js` mode-toggle badges, `homeDashboard.js`'s `getPendingInvitesCount` | 🟢 (per CLAUDE.md's own extensively-documented Aug 15 realtime-publication fix and Aug 9 badge-undercounting fix — not re-derived, spot-checked) |
| Keyboard/device sizes | All chat screens use `KeyboardAvoidingView` w/ `behavior: Platform.OS === 'ios' ? 'padding' : undefined` | 🟡 NOT VERIFIABLE FROM THIS SANDBOX — no simulator/device access exists in this environment; the pattern is consistent across all 4 chat-style screens (`ChatScreen`/`GatheringChat`/`CommunityChat`/`BusinessConversation`), so if one is wrong on a real device, all four likely share the exact same bug. Flag explicitly for a real device pass. |
| Bubble sizing | `maxWidth: '75%'` (gathering), `'80%'` (business), presumably similar in ChatScreen | 🟡 NOT VERIFIABLE FROM THIS SANDBOX — small numeric inconsistency (75% vs 80%) noted but cosmetic; real rendered size on a real device screen can't be confirmed here |

### Finding B3 — 🟠 Friend Circles are a real, working feature with zero downstream use anywhere else in the app

`getMyCircles()`/`friendCircles.js` is referenced in exactly one file: `FriendsScreen.js`
(confirmed via `grep -rln "friendCircles\|getMyCircles" src/` → 2 hits, the service file and
its one consumer). A user can genuinely discover a person, connect, and organize them into a
circle (`FriendsScreen.js:5,28-160,327-374`) — but no other screen in the entire app reads a
circle: not `InviteFriendsModal` (no "invite my Fitness circle" option), not
`CreateGatheringScreen`, not any filter anywhere. This directly answers system 4's (Pass A's own
scope) "can a user discover → connect → organize into a circle → **use that relationship
elsewhere in Nearby**?" question with a concrete no for the fourth step — flagging here since I
found it while auditing the Friends-embedded view inside Messages, but this is genuinely a
system-4 finding; Pass A/synthesis should own final classification.

### Finding B4 — 🟠 Asymmetric "view the thing" affordance across group-scoped chat headers

- **1:1 Chat** (`ChatScreen.js:374-390`): header title is itself a tappable `navigate('ViewProfile', ...)` link.
- **Community Chat** (`RootNavigator.js:457-473`): a real in-chat info panel + "View Full
  Community Page →" link (per its own code comment, replacing a confusing dead-end).
- **Gathering Chat** (`GatheringChatScreen.js`, confirmed via full read — no `navigation.
  setOptions` call anywhere in the file): **no equivalent** — no way to jump from the gathering
  chat back to `GatheringDetail` except the native back button (which pops to whatever was
  actually on the stack, not necessarily `GatheringDetail`).
- **Business Conversation** (`BusinessConversationScreen.js:58-70`): `headerRight` exists but is
  a Report action only (`⋯`) — no "View Business Profile" link anywhere.

Three of four chat surfaces answer "where does this conversation's own subject live" differently
— Community got a real fix for this exact problem (per its own code comment, an earlier session
already recognized and fixed it there); Gathering and Business conversation still lack it. This
is a real, concrete 11-transition-test finding (Gathering → Chat, Match → Chat) — the
interaction model changes across sibling surfaces with no stated strong reason for Gathering/
Business specifically lacking what Community/1:1 both have.

### Positive controls (working correctly, don't disturb)

- Realtime delivery (INSERT subscriptions) + real cursor pagination is now consistent across all
  four chat-style screens — confirmed the exact same shape (`usePaginatedMessages`,
  `useChatComposer`, a real `removeChannel` cleanup) in `GatheringChatScreen.js` and
  `BusinessConversationScreen.js`, matching what CLAUDE.md's Aug 15 scalability pass already
  established for `ChatScreen.js`.
- Load-error and loading-initial states are real and distinct from the empty-conversation state
  in every chat screen read this pass (previously conflated per CLAUDE.md's own history — now
  fixed and consistent).
- `MessagesScreen.js`'s Matches/Friends toggle is a genuine content swap in place, reusing
  Discover's own `modeToggleRow` chrome verbatim — not a second invented visual language.
- The "Hide this chat" mechanism for a past gathering (`MessagesScreen.js:85-104`) is honest —
  explicitly local-device-only, explicitly doesn't touch real attendance history, states this
  plainly in its own confirm dialog.

### 11-transition test (Pass B's four transitions)

| Transition | Verdict |
|---|---|
| Gathering → Chat | 🟠 Flag — see Finding B4 (no "view gathering" link from inside the chat, unlike Community's equivalent) |
| Business → Opportunity | 🟢 Consistent — real itemized reasons, real chip rendering, same card language as the rest of the dashboard |
| Opportunity → Offer | 🟢 Consistent — same modal/chip conventions dashboard-wide, confirmed via `BusinessDashboardScreen.js` structure |
| Match → Chat | ⚪ Intentional difference, with reason — 1:1 Chat's header IS a profile link (richest treatment); this is correctly the *strongest* version of the pattern, not a gap |

---

## Severity read (my own, not final — synthesis owns the 5-bucket classification)

- **Finding B1** (confirmed venue never reaches attendees) — feels structurally broken, not
  cosmetic. Real users would hit this on the exact "gathering finds a business" flow the whole
  Offer System was built for.
- **Finding B2** (two price representations) — cosmetic/architectural, not user-visible breakage.
- **Finding B3** (circles unused elsewhere) — feels like an unfinished feature, not broken —
  worth flagging but low urgency at real usage.
- **Finding B4** (asymmetric chat headers) — cosmetic/consistency, real but low-stakes.
- **Weather gap on Business Opportunity ranking** — already-known, already-scoped-out gap, not
  new; low urgency unless business volume grows.

---

## System 8 (Profile / Settings) — done directly, not delegated

**Checked directly against `ProfileScreen.js`, `SettingsScreen.js`, `CompleteProfileScreen.js`.**

- Profile: leading "Your Plans" section (2 real quick-stat tiles) → "Your Connections"
  (Communities/Friends) → "Your Story" (Timeline/Memory Vault/Momentum/Rewards) → "Business"
  (own header) → a real visual break ("Edit Your Profile") → identity-editing fields. All
  confirmed present exactly as CLAUDE.md's own history claims (`ProfileScreen.js:644,656,672,
  768,795`). 🟢
- A real "🎛️ Preferences" row (`ProfileScreen.js:574`) deep-links into
  `Settings, { scrollToPreferences: true }` — confirmed the receiving half genuinely works:
  `SettingsScreen.js` has a real `preferencesYRef`/`onLayout`/`scrollTo` wired to that param
  (`SettingsScreen.js:86-110,417-419`). 🟢
- A real profile-completeness card: shows the real percent, an itemized list of exactly what's
  missing, and a "Complete Profile →" CTA that scrolls straight to the identity-editing section
  (`ProfileScreen.js:609-632`). This directly satisfies the plan's own named principle for this
  system — "if Nearby tells a user something is incomplete, it must say what is missing and let
  them fix it immediately." 🟢 **Positive control.**
- Settings: confirmed the real 7-group structure (Account / Preferences [4 sub-labels] /
  Notifications / Privacy & Safety [2 sub-labels] / Business (Admin) / Connect / Support) is
  live exactly as documented (`SettingsScreen.js:316,417,725,758,865,942,998`). 🟢
- `CompleteProfileScreen.js`: confirmed the real 3-step wizard (`STEP_DEFS`, progress dots,
  draft persistence across app restarts, a Sign Out safety valve present on every step) is live
  and matches CLAUDE.md's claims exactly. 🟢 **Positive control.**

### Finding S8-1 — 🟡 P2 — The "say what's missing, let them fix it" principle is honored on
### Profile but not consistently extended to business account state

`BusinessDashboardScreen.js` still only ever shows a one-time `Alert.alert('Submitted for
Review', ...)` at 6 separate call sites (lines 564, 907, 1197, 1367, 1749, 1816) for every
content-screening submission (profile edits, experiences, offers, availability, updates, offer
responses) — confirmed via direct grep, **zero** persistent "pending review" badge/indicator
exists anywhere on the dashboard once the owner navigates away from the one-time alert. This is
CLAUDE.md's own already-self-disclosed gap (Decision 6 Phase 1's own "Not done" note),
**re-confirmed still true** on this pass. Restated because it's a direct instance of system 8's
own named principle not being honored on the one other account-management surface (business
account state) that has an analogous "something's not final yet" situation to Profile's own
completeness card, which does handle it correctly.

### Positive controls, system 8

- Profile completeness card (itemized missing fields + working CTA that scrolls to the exact
  place they need to fix it, not just to the top of the screen).
- The Preferences deep-link + scroll-to-section mechanism, reused (not reinvented) from the
  Dating Preferences consolidation work.
- `CompleteProfileScreen`'s wizard draft auto-saves per-account, survives an app restart, and
  caps at the Photo step if restored past it (never silently satisfies the required-photo gate
  with a stale/broken local file URI) — a real, careful correctness detail, not just polish.

---

## Cross-cutting finding — done directly — gathering fullness is honestly surfaced in exactly
## ONE of at least four places a gathering gets recommended to a user

**Found while grounding System 9's Capacity row, independent of either research pass's assigned
scope.** CLAUDE.md's own Aug 28 2026 Universal Signal Remediation Pass, P0 item 1, fixed
gathering fullness honesty — re-reading the actual fix (and re-verifying it against current
code) shows it was scoped to exactly one surface: `HomeScreen.js`'s Ask-Nearby intent-result
panel, where `item.isFull` genuinely renders a real "🔒 Full — Join Waitlist" state
(`HomeScreen.js:695`, confirmed live).

**Confirmed via direct grep that `isFull` appears nowhere else in the entire `src/` tree.**
Three other real surfaces recommend/rank/list gatherings and never check fullness at all —
`src/services/homeRecommendations.js` (Home's own "🎯 Nearby Right Now" section — zero hits for
`capacity`/`isFull`), `src/screens/GatheringsScreen.js` (the single most-used browse surface in
the app — the only "waitlist" references anywhere in the file are the post-tap `Alert.alert`
shown *after* attempting to join, never on the browse card itself), and
`src/screens/DiscoverHubScreen.js` (zero references anywhere).

**Why this matters**: the P0 fix's own locked design explicitly states the reasoning this gap
now violates on three of four surfaces — *"never silently rank a dead-end result #1... show
fullness on the result card itself, never hide the result."* That principle was applied
correctly to one card type and never generalized to the other three real places a gathering
recommendation/browse card renders. This is exactly the class of "does a discovered gathering
ever create a dead-end" question systems 1, 2, and 5 of this audit ask directly.

**Severity: 🟠 P1 — Inconsistent.** Not broken (joining still correctly waitlists you, nothing
crashes or lies about your own status) — but the same honesty principle the app already
committed to, and already built once, is silently absent from the majority of places a user
actually encounters a gathering recommendation.

---

## Scenario B, traced directly — "Find me a nice Italian place for a date Friday." — a real,
## structural gap in both `create-assistant`'s own prompt AND `AskBusinessScreen.js`'s UI

Read `supabase/functions/create-assistant/index.ts`'s live prompt text directly (lines 80,
95-145). Confirmed two real, independently-verified facts:

1. **`VALID_DATE_WINDOWS = ['now', 'today', 'tonight', 'tomorrow', 'weekend', 'flexible']`**
   (line 80) — the model's own instructions (line 128) explicitly say *"Never guess a specific
   date, day of week, or clock time — only pick from this exact list."* There is no bucket
   representing "a specific named weekday beyond tomorrow." An ask naming "Friday" (when today
   isn't Thursday, and Friday doesn't fall on the weekend) has no honest classification
   available — the model is boxed into either silently dropping the day name to `flexible`
   (discarding a real, explicit signal the user gave) or, despite the instruction not to guess,
   plausibly rounding "Friday" to the nearest available bucket (`weekend`), which is simply
   wrong for a Friday-evening date plan most people wouldn't call "the weekend."
2. **`AskBusinessScreen.js`'s `DATE_OPTIONS`** (lines 23-28) — the actual submission screen for
   "ask nearby businesses" — has exactly four chips: Today / Tomorrow / This weekend / I'm
   flexible. **Confirmed via grep: zero `DateTimePicker`/"Pick a Date" anywhere in this file.**
   Unlike `CreateGatheringScreen.js`, which genuinely has a real native `DateTimePicker` behind
   its own "🗓️ Pick a Date" preset (`utils/whenPresets.js:13`,
   `CreateGatheringScreen.js:3,12,484`), there is **no way, anywhere in the Ask Nearby
   Businesses flow — neither AI-classified nor manually picked — to represent a specific day of
   the week at all.**

**Net effect, traced against the scenario verbatim**: the app's own explicit design principle —
"AI never infers a specific date; the user always explicitly picks date/time through
deterministic UI" — breaks down here specifically, because the deterministic UI itself has no
control that can express "Friday." A user asking for something on a specific day beyond
tomorrow can neither have it correctly classified nor manually correct it on this one screen.
The one partial mitigation: `raw_text` (the literal typed ask) is still sent to businesses, so
a human business owner reading it would still see the word "Friday" — but the structured
`date`/`dateWindow` field driving automated matching/fan-out timing would not honor it.

**The rest of Scenario B resolves correctly**: `create-assistant/index.ts:130` explicitly does
NOT let "nice" alone imply a price tier; `cuisine: 'italian'` extraction is real and gets
threaded through `resolveIntent()` → `resolveBusinessAvailability()`
(`intentResolver.js:247,279-305`) for real cuisine/attribute overlap scoring; `partyType: 'date'`
is correctly inferred and scored via `priceAndPartyBonus`.

**Severity: 🔴 P0.** This isn't a ranking nuance — it's an entire class of extremely common
real-world asks ("Friday," "next Tuesday," "the 15th") that the flow structurally cannot
represent, silently degrading to either the wrong bucket or no date constraint at all.

---

## "Right Now"/"Today"/"This Week" canonical window — re-verified, still consistently wired
## where it's supposed to be, still open where it was already disclosed as open

Confirmed live: `utils/rightNowWindow.js`'s `isWithinRightNowWindow()` is genuinely imported and
used by both `GatheringsScreen.js:36,93` (the "Right Now" chip) and
`intentResolverScoring.js:15,156` (the ask-box's own `dateWindow === 'now'` branch) — P2 item 8's
claim holds. **Also re-confirmed still open, exactly as CLAUDE.md's own text already discloses**:
`homeDashboard.js`'s separate `happeningNow` signal (Home's "Happening Near You" row,
`homeDashboard.js:418`) does NOT import `rightNowWindow.js` — it's still the original,
independent, mirror-image 30min/2h window, never reconciled with the canonical definition.


---

# System 9 — Universal Ranking Audit (Signal × Surface)

**Note on the "People" column**: the locked table shape names one "People" column distinct from
"Dating" — interpreted here as **Friends / Friend Discovery** specifically, since Dating already
gets its own explicit column. Every cell below is backed by a citation from Pass A, Pass B, or
this synthesis's own direct checks (see the sections above). USED / NOT APPLICABLE / GAP per the
plan's locked verdict vocabulary, with a real qualifier in parentheses wherever the honest answer
is more nuanced than a clean binary (which is often — see the findings above for the "why").

| Signal | Home | Discover | Gatherings | People (Friends) | Dating | Business | Ask Nearby |
|---|---|---|---|---|---|---|---|
| **Category** | USED — Quick Picks chips, personalization | USED — `TYPE_FILTERS`/`interest_tag` filter on Recommended | USED — real accordion category filter, grouped | NOT APPLICABLE | NOT APPLICABLE | USED — `activePrioritySignals` boost | USED — `resolveGatherings` category filter + `create-assistant` extraction |
| **Interests** | USED — `matchesYourInterests` bonus | USED — same, on Recommended | USED — `getGatheringFitReasons`'s "Why this fits you" | USED — `shared_interest_count`, the strongest signal in Friend Discovery ranking | USED — Jaccard overlap in `calculateCompatibility` (weight 0.5) | NOT APPLICABLE — no personal-interest concept on the business side | USED — same `matchesYourInterests` via `scoreGatheringForResolver` |
| **Distance** | USED — `<2mi` bonus | USED — same bonus + `distanceLabel` on cards | USED — real distance display/sort | USED — `distance_bucket`, a real field | USED, coarse — `wide_area` bucket bounds the candidate pool (both Browse & Crossed Paths); not a fine per-candidate ranking bonus | USED — at fan-out radius only; not re-scored within the opportunity list itself | USED — `SCORE_CLOSE_DISTANCE` bonus |
| **Price** | **GAP** — `homeRecommendations.js` never reads `price_level` | **GAP** — confirmed, zero references anywhere | USED — real 💵 Price accordion filter (`price_level`) | NOT APPLICABLE | NOT APPLICABLE (confirmed: zero `price_level` reference in Dating code) | USED — `budget_max` bonus (Finding B2: two never-cross-checked price representations exist app-wide) | USED — `priceAndPartyBonus` |
| **Party type** | **GAP** — never read | **GAP** — confirmed, zero references anywhere | USED — real 🙋 People accordion filter (`party_type`) | NOT APPLICABLE | NOT APPLICABLE | **GAP** — no `party_type` param in `scoreBusinessOpportunity` at all | USED — `priceAndPartyBonus` |
| **Party size** | NOT APPLICABLE | NOT APPLICABLE — no ask-box-style party-size input | NOT APPLICABLE at browse (capacity ≠ asker's party size) | NOT APPLICABLE | NOT APPLICABLE | USED — fulfillment-policy range fit | USED (business tiers) — hard feasibility filter; **GAP** — never checked against a *gathering's* own remaining capacity at ranking time (only at join time), per the Scenario A trace |
| **Cuisine** | NOT APPLICABLE | **GAP** — never read | NOT APPLICABLE — gatherings have no cuisine field | NOT APPLICABLE | NOT APPLICABLE | USED — real cuisine match bonus | USED (business_availability tier) — `attributeAndCuisineBonus` |
| **Attributes** | NOT APPLICABLE | **GAP** — never read | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | USED, two-tier (priority vs. general match) | USED (business_availability tier) — same function |
| **Compatibility** | NOT APPLICABLE — no dating candidates shown | NOT APPLICABLE — People mode delegates entirely to embedded screens | NOT APPLICABLE | NOT APPLICABLE — Friends uses its own separate weighted-sum ranking, a genuinely different signal | USED — real, itemized, drives Browse's sort order; **per-page only, not global across pagination** (Finding T-1) | NOT APPLICABLE | NOT APPLICABLE — the ask box's `friend_request` result surfaces a connected person's open ask, never ranked by compatibility |
| **Weather** | USED — real re-ranking + indoor/outdoor suggestion list | USED — real re-ranking + banner, same shared util as Home | USED — wired into the full browse/filter surface (P2 item 7 of the Signal Remediation Pass) | NOT APPLICABLE | NOT APPLICABLE (confirmed: zero weather reference in Dating code) | **GAP** — `scoreBusinessOpportunity()` takes no weather param at all (already-known, re-confirmed open) | USED — real gathering weather bonus + business-availability weather-informed capacity check |
| **Time** ("now"/today/week) | USED, split — `matchesDateWindow` on the ask box (correct canonical window); Home's own `happeningNow` uses a **mirror-image, unreconciled window** (Finding: still open) | USED — 3 quick-time cards, correct canonical window | USED — Right Now/Today/This Week chips, correct canonical window | NOT APPLICABLE — swiping has no time-window concept | NOT APPLICABLE | USED — time-window-vs-priority-hours fit | USED, with a real hole — **no bucket or UI control represents a specific named weekday at all** (Scenario B finding, 🔴 P0) |
| **Availability** (business) | USED — ask box's confirmed/policy-only tiers | NOT APPLICABLE — Discover has no distinct "business availability" concept, only standing perks + map | NOT APPLICABLE — gathering existence itself is the availability | NOT APPLICABLE | NOT APPLICABLE | USED — real feasibility hard-constraint at request-creation | USED — real remaining-capacity check |
| **Capacity** (gathering fullness) | **GAP on passive sections** (Nearby Right Now/Best Pick/Trending); USED only on the Ask-Nearby result panel | **GAP** — never read anywhere | USED at the detail-view level (real "🔥 Almost full" nudge, honest spots-filled math); **GAP on the browse-card level** — `GatheringsScreen.js`'s own list cards show zero fullness before a join attempt | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE at ranking (party-size fit is the business-side analog) | USED — real, honest `isFull`/attendee-count subtitle |
| **Recency** | USED — `friendsActivity`/`sinceAway` (new gatherings since last visit) | USED (Happening Nearby stories sort only) — not used for gathering/community/perk browse ranking | Implicit — chronological base order before scoring | Not independently re-verified this pass — likely an implicit base order before the shared-interest sort, not confirmed as a first-class signal | USED, as a **primary** sort key on Crossed Paths (`last_seen_at desc`, a deliberate, locked design choice — recency-first, not a fallback); not used on Browse (compatibility-first there) | Implicit — base opportunity-list order before scoring | Implicit — not independently confirmed as a first-class scored signal |

**Reading this table honestly**: Category, Interests, Distance, and Weather are the four
signals with the fewest real gaps — each is a genuine, working, mostly-consistent cross-surface
signal. Price/Party type/Cuisine/Attributes are consistently strong on the business side and on
Gatherings' own filters, but consistently absent from Discover and Home's passive
recommendation sections despite the data already being fetched there. Capacity is the single
worst-covered row on the table — real and honest in exactly the two places it was explicitly
built for (the ask-box result panel, and `GatheringDetailScreen`'s own detail view), and silently
absent everywhere else a gathering gets recommended or browsed.

---

# System 10 — "Would a normal person understand this?"

## The six locked scenarios

### Scenario A — "I want something fun to do tonight with two friends."

`create-assistant/index.ts:127,131` correctly extracts `partySize: 3` (asker + 2, per the
prompt's own explicit "with two friends" → +1 rule), `dateWindow: 'tonight'`, `partyType:
'friends'`. These genuinely affect scoring — `dateWindow`/`partyType` feed
`priceAndPartyBonus()` (a real flat bonus if `gathering.party_type === 'friends'`), and
`partySize` genuinely hard-filters business-availability capacity feasibility.

**Real gap**: `partySize` is never checked against a *gathering's own remaining capacity* at
ranking time — only whether the gathering is already full relative to its currently-approved
attendees, never "can these specific 3 more people realistically fit." A gathering with
`capacity: 4` and 3 already approved would still rank as a top, non-full result even though only
1 more spot genuinely exists for a party of 3. The join flow itself does correctly catch this at
the moment of actually joining (per the app's real capacity/waitlist mechanics) — but the
*ranking* the user sees before tapping in doesn't reflect it.

**Verdict**: understands and ranks correctly overall; one real, narrow gap between "can I join
this at all" (correctly enforced at join time) and "does this actually fit my whole party"
(not reflected in what gets ranked #1).

### Scenario B — "Find me a nice Italian place for a date Friday."

**See the full trace above** ("Scenario B, traced directly"). Cuisine, party type, and the
"nice" ≠ price-tier rule all resolve correctly. **The date — the single most literal, concrete
piece of the whole ask — cannot be represented anywhere in this flow, neither by the classifier
nor the manual UI.** 🔴 P0. This is the weakest result of all six scenarios.

### Scenario C — "It's raining. What can I do right now?"

The literal word "raining" is never parsed — `create-assistant` has no weather-extraction field
at all. What actually drives the outcome is real, independent GPS-based weather
(`getSocialForecast`, fetched in parallel with every other resolver branch) combined with a
correctly-mapped `dateWindow: 'now'` (using the canonical narrow window). **Confirmed: weather
genuinely changes results, not just copy** — `resolveGatherings` adds a real score bonus and
subtitle text to indoor-classified gatherings when the *real, sensor-derived* forecast is
indoor-biased, independent of whether the user's own text said "raining."

**Verdict**: arguably the *right* behavior (trust the real forecast, not the user's own claim
about it) — but worth stating precisely: the system doesn't comprehend "it's raining" as an
assertion, it happens to agree with reality because it queries reality directly rather than
parsing the sentence. A user whose local weather doesn't match their own phrasing (e.g. asking
during a lull between rain bands) would get a result that silently ignores what they typed in
favor of what the API says — reasonable, but undocumented anywhere in the UI.

### Scenario D — "I want to meet new people who like tennis."

**Confirmed: this ask does not reach Friend Discovery, interest matching, distance, or Circles
at all.** `create-assistant`'s intent taxonomy is exactly `gathering | community |
business_partner | unclear` — there is no person/friend intent. This text classifies `unclear`,
category stays `null`, `dateWindow` stays `null` (`matchesDateWindow` with no window returns
`true` unconditionally), so **every** upcoming gathering nearby becomes a candidate, ranked only
by a literal title-substring match against `["meet", "tennis"]` (stopwords "want"/"people"/
"like" are stripped) — only a gathering whose *title* literally contains "meet" or "tennis" gets
any relevance boost; everything else is an unranked, undifferentiated dump.

The user does see a real, honest disclaimer ("Nearby doesn't search for individual people
directly — gatherings and communities are how you meet people here") — a genuine refusal, not a
silent failure. But the fallback result set is close to noise, and the mechanism that could
genuinely answer this — `get_friend_discovery_candidates`'s own real `shared_interest_count`
ranking — is never invoked even though it exists and would be a materially better answer.

**Verdict**: honest about its own limitation, but the actual result is poor, and a real,
already-built, better mechanism sits one hop away, unreachable from this exact phrasing. 🟠 P1.

### Scenario E — "Find something for 8 people Saturday."

Per Pass B's direct trace: `partySize` is a genuine **hard constraint** at the consumer resolver
(business-availability capacity check) but is never scored as a *relevance* signal for gathering
candidates at the resolver stage — matching the app's own locked design (party size is a filter,
not a ranking bonus, for gatherings specifically). `capacity = 4` postings are correctly excluded
from a party-of-8 ask on the business side. Confirmed still true.

**Verdict**: correctly rejects what can't fit (on the business side); correctly does not invent a
ranking bonus where the locked design says there shouldn't be one. Works as designed.

### Scenario F — "I'm looking for something cheap tonight."

Per Pass B's direct trace: `priceLevel: 'free'|'$'` resolves correctly via `create-assistant`'s
explicit mapping (free/cheap are correctly distinguished from "nice"/upscale); `partyType` is
correctly left `null` (no party signal in this ask, and the prompt's own instructions explicitly
forbid guessing one from a price-only ask).

**Verdict**: correctly distinguishes free from cheap, correctly avoids assuming a party type from
a price-only ask. Works as designed — a genuine positive control.

---

## The "mini-app" test — all 11 transitions

For each: does navigation, terminology, card language, buttons, colors, spacing, filters,
headers, or the interaction model change without a strong reason?

| Transition | Verdict | Why |
|---|---|---|
| Home → Discover | ⚪ intentional difference, with one flag | Stacked-scroll+hero vs. header+toggle+search is a real, differently-jobbed model ("what's happening in my life" vs. "what's out there"). 🟠 flag: "recommended to you" isn't visually/structurally unified between the two screens even though it's partly the same underlying code (three-scorer duplication, Finding #5 above). |
| Discover → People | 🟢 consistent | Same screen, in-place content swap, literally the same `modeToggleRow` style object as every other toggle on this screen. |
| Discover → Things To Do | 🟢 consistent | Symmetric to the above — same toggle, header persists, filters appear predictably. |
| People → Dating | 🟢 consistent | `DiscoveryScreen` embeds with its own redundant title suppressed; internally consistent chrome, visually close enough to Discover's outer chrome not to read as a different app. |
| People → Friends | 🟢 consistent (strongest positive control in the whole audit) | `FriendDiscoveryScreen` reuses `DiscoveryScreen`'s header style *values* verbatim. Interaction model (2-button deck vs. 4-affordance deck) differs, ⚪ intentionally, for a real, stated consent-model reason — Friends has no Notice/Wave silent-vs-announced asymmetry to express. |
| Friends → Circles | 🟠 flag (real inconsistency — substance, not chrome) | Not a navigation transition at all — Circles are an inline chip row on `FriendsScreen` itself, never a distinct destination. The real problem isn't presentation, it's function: organizing a friend into a Circle produces zero effect anywhere outside the screen where you made it (Finding F-1 / top-10 problem #4). |
| Gathering → Chat | 🟠 flag | No "view gathering" link from inside Gathering Chat, unlike Community Chat's equivalent (Finding B4 / top-10 problem #9). |
| Business → Opportunity | 🟢 consistent | Real itemized reasons, same chip/card language as the rest of the dashboard. |
| Opportunity → Offer | 🟢 consistent | Same modal/chip conventions dashboard-wide. |
| Match → Chat | ⚪ intentional difference, with reason | 1:1 Chat's header IS a tappable profile link — correctly the *strongest* version of the "view the thing" pattern, not a gap. |
| Business Conversation → (view business) | 🟠 flag | `headerRight` exists but is a Report action only — no "View Business Profile" link anywhere, the same asymmetry as Gathering Chat (Finding B4). |

---

## Severity classification — every finding from every phase, in one place

- **🔴 P0 — Broken / misleading**: the confirmed-venue-invisible-to-attendees finding (top-10
  #1), and the "Friday"/named-weekday gap in Ask Nearby Businesses (top-10 #2, and Scenario B).
- **🟠 P1 — Inconsistent**: gathering fullness surfaced on 1 of ≥4 surfaces (top-10 #3), Friend
  Circles as a dead end (top-10 #4), the three unrelated scoring formulas (top-10 #5), Scenario
  D never reaching Friend Discovery (top-10 #6), the two price representations (top-10 #7), the
  mirror-image "now" windows (top-10 #8), Friends→Circles and Gathering→Chat/Business
  Conversation→(view business) in the 11-transition test.
- **🟡 P2 — UX improvement**: the asymmetric chat-header "view the thing" links (top-10 #9),
  Discover silently dropping price/party/cuisine/attributes/capacity plus its map-businesses
  confidence-tier gap (top-10 #10), Home vs. Discover's "recommended to you" not being visually
  unified, the Business Dashboard's lack of a persistent "pending review" indicator (Finding
  S8-1), Browse's per-page-only compatibility sort (Finding T-1), Scenario A's gathering-
  remaining-capacity ranking gap.
- **🟢 P3 — Future opportunity, do not build now**: none surfaced at this severity in this pass
  — every real finding above was either concrete enough to rank as a problem or a genuine
  intentional design choice.
- **⚪ Intentional difference, leave alone**: Crossed Paths staying recency-ordered instead of
  compatibility-ordered (a real, locked, differently-jobbed design); the 2-button vs.
  4-affordance swipe deck difference between Friends and Dating; Stories' personal-vs-public
  split between People and Things-to-Do modes; Scenario C's "trust the real sensor over the
  user's own claim" behavior; Scenario E's "party size is a hard filter, never a ranking bonus"
  design for gatherings.

---

## Direct answers to the plan's own five closing questions

**A. Can a brand-new user understand Nearby in 30 seconds?** Largely yes for the consumer side —
Home has one genuine hero (the ask box), and the People↔Friends↔Dating navigation reads as one
coherent product, not several stitched together. The one real comprehension risk: three
independently-scored "recommended for you" systems living one screen apart with no shared
language between them means a curious user who compares two sections closely could reasonably
wonder why the same-looking recommendation logic disagrees with itself.

**B. Does Nearby currently feel like one product?** Mostly yes at the chrome/navigation level
(the strongest evidence in this whole audit — verbatim style reuse across the People↔Friends and
Discover mode-toggle boundaries) — but noticeably less so at the *mechanism* level once you look
underneath: gathering fullness is honest in one place and silent in three others; Circles exist
without a second half; and Business Opportunity ranking still lives in its own weather-blind
world relative to the consumer side.

**C. What are the biggest remaining sources of cognitive load?** The inconsistent honesty about
gathering fullness (a user has to learn, by trial, which screens they can trust to tell them a
gathering is full and which they can't); the fact that "ask nearby businesses" quietly cannot
handle "Friday" the way every other part of the date/time system can.

**D. What are the biggest duplicate/converging user jobs?** The three gathering-recommendation
scoring formulas (Home's Best Pick, Home's Nearby Right Now, the ask box) all answer the
identical question — "why should you see this gathering" — independently, with no shared
vocabulary. This is the single clearest candidate for convergence in the whole audit.

**E. If feature development stopped today, what would be fixed before launch?** The two 🔴 P0
items — the confirmed-venue visibility gap (a real transaction happening in the real world with
no way for most of the people involved to find out about it), and the "Friday" gap (an entire,
extremely common class of real-world asks the flagship "ask a business" flow cannot honestly
fulfill).

---

*Produced Aug 28 2026. Two working files this audit was assembled from —
`PRODUCT_AUDIT/FULL_AUDIT_PASS_A_2026-08-28.md` and `_PASS_B_2026-08-28.md` — and the direct-
synthesis scratch file `FULL_AUDIT_SYNTHESIS_NOTES_2026-08-28.md` were folded into this one file
and deleted, matching this repo's own established "one file, not five" convention for a
multi-pass audit of this size.*
