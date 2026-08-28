# Signal Contract — 2026-08-28

**P3 item 9 of the Universal Signal Remediation Pass** (see `CLAUDE.md`'s "Aug 28 2026 —
Universal Signal Remediation Pass" section). A factual reference doc, **not prescriptive or
aspirational** — it describes the real, current, post-fix state of every signal in the
12-signal matrix `PRODUCT_AUDIT/UNIVERSAL_SIGNAL_RECOMMENDATION_AUDIT_2026-08-28.md` covered,
written once the authorized P0/P1/P2 fixes (items 1-8) had actually landed, matching this
repo's own "flag, don't silently build partial" convention: two real findings from that audit
(findings 8 and 9, both 🟡, both explicitly named as needing a human decision, not something a
build pass should silently resolve either way) were **not** in the authorized build order and
remain open — this doc says so plainly rather than implying they're closed.

Per signal: **meaning**, **collection point**, **null semantics**, **classification**
(hard-constraint / ranking-bonus / contextual — several signals are legitimately more than one
of these depending on which surface reads them, and this doc says so rather than picking one),
and **public-display status**. Every claim below is grounded in a direct read of the real,
current source — file/line citations throughout, no claim taken on an earlier pass's word alone
without re-checking it against the live code for this doc specifically.

No code was changed to produce this document.

---

## Quick reference

| # | Signal | Classification | Public-display |
|---|---|---|---|
| 1 | Personal interest (`profiles.interests`) | Ranking-bonus (Friends) / display-only (Dating Browse, see Finding 2) | 🟢 shown on profile |
| 2 | Category (`interest_tag`) | Hard-constraint (filter) + ranking-bonus | 🟢 shown everywhere it's set |
| 3 | Relationship intention | Ranking-bonus (`calculateCompatibility`) — same Finding 2 caveat as #1 | 🟢 shown on profile |
| 4 | Gender (canonical + legacy) | Hard-constraint (mutual match gate) | 🔴 never shown to a viewer (Finding 9, open) |
| 5 | Distance / proximity | Hard-constraint (radius) + ranking-bonus (close-distance) | 🟡 fuzzed only, never precise |
| 6 | Price (3 representations) | Ranking-bonus, never a hard filter | 🟢 shown to counterparty |
| 7 | Party size / party type | **Both** — hard-constraint in the consumer resolver, ranking-bonus on the Business Opportunities dashboard | 🟢 shown to counterparty |
| 8 | Business cuisine | Ranking-bonus | 🟢 shown on business profile |
| 9 | Business attributes + `priority_attributes` | Ranking-bonus | 🟢 attributes shown; `priority_attributes` owner-only |
| 10 | Availability / supply | Hard-constraint (capacity/expiry) + tiered ranking-bonus | 🟢 shown to requester once matched |
| 11 | Time / date-window | Hard-constraint (filter) | 🟢 shown as a real timestamp/date |
| 12 | Weather | Contextual (modulates ranking of other signals, never itself a constraint) | 🟢 shown as a headline/reason line |

---

## 1. Personal interest — `profiles.interests`

**Meaning**: a self-selected array of topic tags describing what a user is personally into
(distinct from `interest_tag`, signal #2 below, which describes what a *gathering/community/
business-request* is about — two deliberately separate vocabularies for two different
questions).

**Collection point**: the profile-editing flow (`ProfileScreen.js`), a plain multi-select chip
picker over the app's canonical interest tag list.

**Null semantics**: an empty array means "hasn't set any" — never treated as "interested in
everything." A caller comparing against an empty array on either side gets zero overlap, not a
fabricated match.

**Classification — genuinely two different answers depending on the surface, unchanged by this
pass**: on **Friend Discovery**, it's a real ranking-bonus — `get_friend_discovery_candidates()`'s
live SQL genuinely `order by (shared_interest_count + shared_community_count +
mutual_friend_count) desc, ...`. On **Dating** (`calculateCompatibility()`, `proximity.js`), it
contributes to the real `compatibilityScore` computed for every candidate — but per Finding 2 of
the Universal Signal audit (fixed for Browse only, see signal #3 below for the exact scope),
whether that score actually *orders* the results a user sees depends on which of the two Dating
modes they're in.

**Public-display**: 🟢 shown on `ViewProfileScreen`/`ProfileScreen` as real chips.

---

## 2. Category (`interest_tag`) — the control signal

**Meaning**: what kind of thing a gathering, community, or business request *is* — one value
from the shared canonical 26-tag vocabulary (`src/constants/gatheringCategories.js`'s
`INTEREST_OPTIONS`), reused verbatim across `gatherings.interest_tag`, `communities.interest_tag`,
and `business_requests.category`.

**Collection point**: a chip picker at creation time (`CreateGatheringScreen.js`,
`CreateCommunityScreen.js`), or a best-effort classification from `create-assistant` when the
ask arrives as free text (re-validated server-side against the same canonical list — a
hallucinated tag never reaches the client).

**Null semantics**: `null`/unset means "no category filter" everywhere it's read as a filter —
`resolveIntent()`'s branches that gate on category (`resolveCommunities`,
`resolveCommunityIntent`) correctly return nothing rather than a noisy "everything" result when
the ask has no detected category, per their own doc comments (an uncategorized "all your
communities" result would be noise, not a real match).

**Classification**: both a hard-constraint (an exact-match filter in `resolveGatherings`/
`resolveBusinessAvailability`/etc.) and a ranking-bonus (`SCORE_INTEREST_MATCH = 5`, the largest
single weight on the shared scoring axis — `intentResolverScoring.js`).

**Public-display**: 🟢 shown as the category badge/icon everywhere the item itself is shown.
Kept as the audit's own **control group** — this is the one signal every prior audit pass
(the Aug 24 2026 Universal Taxonomy Audit, this same Aug 28 2026 pass) has independently
re-confirmed fully closed-loop across all seven stages, with zero real gaps found — used
throughout this whole remediation as evidence the auditing method finds real gaps because real
gaps exist, not because it's calibrated to find something regardless of the code.

---

## 3. Relationship intention

**Meaning**: what kind of relationship a Dating user is looking for (a real multi-select array,
`profiles.relationship_intention` — not the retired `basics.relationship_goals` jsonb key,
consolidated onto this one canonical field by the Aug 25 2026 Taxonomy audit's own Phase 1).

**Collection point**: Settings' merged "❤️ Dating Preferences" card.

**Null semantics**: an empty array means "hasn't stated a preference" — `calculateCompatibility()`
treats it as contributing zero overlap, not a wildcard match.

**Classification**: ranking-bonus, folded into `calculateCompatibility()`'s own real weighted
sum alongside interest overlap and music. **Shares Finding 2's exact scope boundary, verified
directly for this doc rather than assumed**: `getBrowseMatches()` (`proximity.js:426`) now sorts
`.sort((a, b) => (b.compatibilityScore ?? 0) - (a.compatibilityScore ?? 0))` — confirmed live in
this pass, so relationship intention (as one real input to that score) now genuinely helps order
Browse. **Crossed Paths (`getNearbyMatches()`) is unchanged** — still `last_seen_at desc`, a
real, deliberate product decision per P1 item 4's own locked design (a "you were physically near
this person recently" surface is a genuinely different job from Browse's "here's who might be a
good match"), not an oversight.

**Public-display**: 🟢 shown on `ViewProfileScreen` (as the compatibility report's own real
"Big Topics" breakdown, not the raw array).

---

## 4. Gender (`gender_identity`/`interested_in_genders` + legacy `discovery_gender`/`show_me`)

**Meaning**: the canonical pair (`gender_identity`, `interested_in_genders` — both real arrays,
allowing a non-binary self-description and a multi-value interest set) is the current, correct
system; `discovery_gender`/`show_me` (single-value) are the legacy pair, kept live only as a
fallback for an account that has never set the canonical fields.

**Collection point**: Profile's own "About You" multi-select pickers (canonical) — the legacy
single-select fields are no longer writable from anywhere in the app (Settings' own legacy chip
pickers were removed outright by the Aug 25 2026 Dating Preferences consolidation; a real
one-time backfill migration converted any account still sitting on legacy-only values into
real, equivalent canonical values at that time).

**Null semantics — the one real, structurally significant null case in this whole doc, verified
directly for this doc, not assumed**: `passesGenderMatch()` (`src/services/proximity.js:163-182`)
treats **both fields having at least one real value on both sides of a pair** as the trigger for
canonical mutual matching (`bothHaveNewFields = myIdentity.length > 0 && myInterestedIn.length >
0 && theirIdentity.length > 0 && theirInterestedIn.length > 0`); the moment either party's
canonical fields are still empty, the whole pair falls back to the legacy `show_me`/
`discovery_gender` single-value check instead — an empty array is never treated as "open to
everyone," it's treated as "this account hasn't stated a canonical preference yet, use the
older signal instead."

**Classification**: a real hard-constraint — this is a genuine mutual-match gate
(`iWantThem && theyWantMe`), not a ranking bonus; a failing pair is excluded from Dating results
entirely, never merely ranked lower.

**Public-display**: 🔴 **never shown to a profile viewer** — confirmed via the original Universal
Signal audit's Finding 9 and re-confirmed here: neither the canonical fields nor the legacy ones
render anywhere on `ViewProfileScreen`. This is **not addressed by this remediation pass** —
Finding 9 was explicitly named 🟡 and never authorized for P0-P2 build. The audit's own framing
still holds: this is plausibly an intentional "private matching signal, not a public badge"
design (consistent with the legacy `show_me`/`discovery_gender` pair never having rendered
publicly either, even before the canonical fields existed) — but it has never been stated as a
deliberate decision anywhere in this codebase's own history. **Flagged here again, explicitly,
as a real open item needing a real yes/no from the user**, not silently resolved either way by
this doc.

---

## 5. Distance / proximity

**Meaning**: how close two real-world locations are — the load-bearing signal underneath almost
every other ranking in this app.

**Collection point**: real device GPS (`expo-location`), stored per-gathering as
`precise_lat`/`precise_lng` (host/attendee-only) plus a coarse, permanently-fuzzed `wide_area`
text bucket used for anything broader (Crossed Paths, coarse map display).

**Null semantics**: a `null` location on the caller's own side means the caller hasn't granted
location permission or hasn't resolved a fix yet — every distance-dependent resolver branch
(`resolveBusinessAvailability`, `resolvePolicyOnlyBusinesses`, `resolveCommunities`'s own
`communityAreaBonus`) checks for this explicitly and returns `[]`/`0` rather than guessing, per
`resolveBusinessAvailability`'s own `if (!location) return [];` guard (`intentResolver.js:248`).

**Classification**: both a hard-constraint (radius filters everywhere a search RPC takes one)
and a ranking-bonus (`SCORE_CLOSE_DISTANCE = 3`, awarded when `distance_miles < 2` — the shared
threshold every resolver branch reuses, including the newer `communityAreaBonus()`'s own
25-mile city-level variant, deliberately coarser since a Community Area is city-level, not a
venue).

**Public-display**: 🟡 always fuzzed for anyone but the gathering's own host/approved attendees
— this app has never given the client another person's raw coordinates, matching the standing
"no stranger discovery via precise location" principle re-confirmed by every pass in this file's
history that has touched location.

Left completely untouched by this remediation pass, and re-confirmed as this whole audit's own
positive control alongside category (#2 above) — fully closed-loop, zero real gaps, across all
seven of the audit's own stages.

---

## 6. Price (3 real representations)

**Meaning**: three genuinely distinct real price signals share the word "price" in this app —
`gatherings.price_level` (a host-declared `free|$|$$|$$$` tier for one specific gathering),
business Signature Experience/offer pricing (a business's own declared price tier for a
standing offer), and `business_requests.budget_min`/`budget_max` (a consumer-typed real dollar
ceiling on one specific ask).

**Collection point**: `gatherings.price_level` — a chip picker on `CreateGatheringScreen.js`.
Business pricing — the business's own dashboard, Signature Experience/offer creation forms.
`budget_max` — either typed directly on `AskBusinessScreen.js`, or best-effort-classified by
`create-assistant` from free text (never guessed past what the text genuinely implies, per its
own prompt discipline).

**Null semantics**: `gatherings.price_level` null means "the host didn't say" — never defaults
to `free`. `budget_max` null means "no stated ceiling" — never treated as $0 or excluded from
matching on that basis.

**Classification — genuinely split, verified directly for this doc**:
- `price_level` (the gathering tier) is a real ranking-bonus only, via `priceAndPartyBonus()`
  (`intentResolverScoring.js:91-96`) — a real signal match earns `SCORE_HAPPENING_NOW`, never a
  hard filter (a mismatched or unset `price_level` doesn't exclude a gathering, it just doesn't
  earn the bonus).
- `budget_max`, as of **P1 item 5 (this pass)**, is now a real ranking-bonus too, closing the
  audit's own Finding 5 (previously a confirmed dead end) — `scoreBusinessOpportunity()`
  (`businessOpportunityScoring.js:35-89`) takes a real `requestBudgetMax` param, awarding a
  monotonic bonus proportional to the real dollar amount, capped at `SCORE_OWN_NETWORK` via a
  disclosed placeholder reference constant (`BUDGET_BONUS_REFERENCE = 150`, explicitly *not*
  derived from real spend data since none exists yet) — never a hard filter; a low-budget
  request still scores, just lower, matching the explicit "a $100 request shouldn't necessarily
  be excluded from a $75 business" instruction this fix was built against.

**Public-display**: 🟢 all three are shown verbatim to the party deciding whether to act on
them — `price_level` on gathering cards, business pricing on the business's own profile,
`budget_max` on the Business Opportunities inbox card the business actually reads.

---

## 7. Party size / party type

**Meaning**: `gatherings.party_type` (a host-declared `solo|friends|groups|date` tag for who a
gathering suits), `business_requests.party_size` (a real headcount on one specific ask), and a
business availability posting's own `capacity`/`remaining_capacity`.

**Collection point**: `party_type` — a chip picker at gathering creation.
`business_requests.party_size` — typed on `AskBusinessScreen.js`, or best-effort-classified by
`create-assistant` (with an explicit, disclosed "with N friends" = N+1 total vs. "for N people"
= N total disambiguation rule in its own prompt — never a guess left to the model's own
judgment). Availability capacity — set by the business at posting time.

**Null semantics**: `party_size`/`partySize` null means "the ask didn't imply a number" — every
capacity check that reads it treats null as "don't filter on this," matching the SQL's own
`party_size_param is null or ...` passthrough (confirmed directly in this pass,
`20260828_business_availability_party_size_feasibility.sql:68/129/193/287-288`) — a null party
size is not treated as 0 or as "definitely fits," it's treated as "unknown, don't gate on it."
`remaining_capacity` null means "no fixed cap set" (unlimited), the same "null means honestly
unknown/unlimited" convention this schema uses everywhere else — never zero.

**Classification — the one signal in this whole doc that is genuinely, deliberately both, on
two different surfaces, per P0 item 2 / P1 item 6's own locked scope**:
- **Consumer-facing resolver (hard-constraint, P0 item 2, this pass)**: `search_active_
  business_availability()` and `_match_request_to_availability()` both take a real
  `party_size_param`; a posting whose real remaining capacity can't fit the requester's own
  real party size is now excluded server-side entirely, not merely ranked lower — verified
  directly against the live migration for this doc: `(ba.remaining_capacity is null or
  party_size_param is null or ba.remaining_capacity >= party_size_param)`. The same fix reaches
  `post_business_availability()`'s own reverse-scan and all three request-creation RPCs
  (`create_business_request`, `_for_gathering`, `_for_community`), all threading the requester's
  own real party size through. A genuine, additive `insufficient_capacity` reason value was
  added to `business_match_exclusions.reason`'s CHECK constraint (kept distinct from the
  existing `zero_capacity` value — "had capacity, just not enough" is a materially different,
  more actionable fact than "had none at all").
- **Business Opportunities dashboard (ranking-bonus, P1 item 6, this pass)**: never a hard
  constraint here — `scoreBusinessOpportunity()`'s `requestPartySize`/`fulfillmentPolicy` pair
  (`businessOpportunityScoring.js:41-48, 105-109`) awards `SCORE_CLOSE_DISTANCE` when the
  request's real party size falls inside the business's own real `business_fulfillment_
  policies.party_size_min/max` range — reusing the exact signal/weight
  `businessOfferRecommendation.js`'s `rankExperiencesForOpportunity()` already established for
  the identical fit check, not a second invented one. Silent (no bonus, no penalty) for a
  business with no fulfillment policy set.

`party_type` itself stays ranking-bonus-only throughout (`priceAndPartyBonus()`, same as
`price_level` above) — it was never part of P0 item 2's hard-constraint scope, since a
gathering's `party_type` describes suitability, not a scarce resource the way availability
capacity is.

**Public-display**: 🟢 `party_type` shown on gathering cards; `party_size` shown verbatim on the
Business Opportunities inbox card; availability capacity shown to the requester once a match is
found (the `matchedAvailability.remainingCapacity` field, `intentResolver.js:309`), never
exposed to a non-matching browser.

---

## 8. Business cuisine

**Meaning**: a business's own declared food/drink category (`brand_partners.cuisine`), matched
against a consumer's own best-effort-classified `cuisine` extraction from free text.

**Collection point**: the business's own dashboard profile form. Consumer side:
`create-assistant`'s best-effort classification (never guessed — only set when the text
genuinely names a specific cuisine).

**Null semantics**: `null` on either side means "no signal" — `attributeAndCuisineBonus()`
(`intentResolverScoring.js:113-121`) only ever awards its bonus on a genuine non-null match on
both sides; a business with no stated cuisine, or an ask with no implied cuisine, contributes
zero, never a fabricated match.

**Classification**: ranking-bonus only, deliberately — `attributeAndCuisineBonus()` is
additive on top of the base score, never a hard filter, so a relevant-but-slightly-farther
business can outrank a closer non-matching one without ever hiding an eligible posting outright.
Untouched by this remediation pass; already fully closed-loop per the original audit (three
independent, mutually-consistent, live-verified implementations: the resolver's own bonus,
`_business_request_fanout()`'s real SQL-level overlap count, and `scoreBusinessOpportunity()`'s
own dashboard-side scoring).

**Public-display**: 🟢 shown as a real chip on the business's own public profile.

---

## 9. Business attributes + `priority_attributes`

**Meaning**: `brand_partners.attributes` (a business's own real, curated qualities — e.g.
outdoor seating, live music) vs. `priority_attributes` (a subset the business has specifically
flagged as wanting *more* demand for right now) — two deliberately distinct signals, never
conflated.

**Collection point**: both set from the business's own dashboard; `priority_attributes` via a
dedicated "What are you looking for right now" picker, distinct from the general attribute
editor.

**Null semantics**: an empty `attributes`/`priority_attributes` array means "none declared" —
never a wildcard. `accommodates_party_types` (a related, adjacent business-declared signal —
which real party types/group shapes a business can accommodate) follows the same convention.

**Classification**: ranking-bonus on both — `attributeAndCuisineBonus()` (consumer-facing
resolver) and `scoreBusinessOpportunity()` (dashboard-facing, correctly keeping `attributes` and
`priority_attributes` as two separately-scored, never-double-counted signals per the original
audit's own confirmation). Never a hard filter on either surface.

**Public-display**: 🟢 `attributes` shown as real chips on the business's public profile.
🔴 `priority_attributes` is owner-only — correctly never shown to a consumer (it's an internal
"what to prioritize surfacing to me" signal, not a public claim about the business). **Related,
still-open Finding 8 from the original audit, not addressed by this pass**:
`brand_partners.accommodates_party_types` — collected specifically to answer "can this business
handle my kind of group" — still never reaches a consumer-facing filter, match, or rank stage
anywhere; referenced only inside the business's own dashboard/profile screens. Flagged again
here, explicitly, since it was never in the authorized P0-P2 build order.

---

## 10. Availability / supply (3 mechanisms)

**Meaning**: three real, distinct confidence tiers for "can a business actually fulfill this
right now" — a confirmed, time-boxed `business_availability` posting (the strongest); a standing
`business_fulfillment_policies` auto-accept rule (real but unconfirmed, "may be able to help");
and gathering capacity/waitlist (a different kind of supply — a spot at an already-planned
event, not a business).

**Collection point**: `business_availability` — the business posts a real, time-boxed offer.
`business_fulfillment_policies` — a standing rule the business sets once. Gathering
capacity/waitlist — `gatherings.capacity`, set (or left `null`, meaning no cap) at creation.

**Null semantics**: `gatherings.capacity` null means genuinely uncapped, not "unknown" — a
gathering with no cap can never be `isFull`. `business_availability.remaining_capacity` null
means unlimited (see signal #7 above). A posting past its own `ends_at` is excluded from every
matching query, never returned as if still live.

**Classification — hard-constraint at every scarcity boundary, tiered ranking-bonus above
that**:
- **P0 item 1 (this pass)**: gathering fullness was a pure mapping omission, not a missing
  query — `resolveGatherings()`'s mapped candidate object now carries real `capacity`/
  `attendeeCount`/`isFull` (confirmed directly for this doc, `intentResolver.js:60-84`), and a
  full gathering's own subtitle honestly reads "🔒 Full — Join Waitlist (N/M spots taken)"
  instead of silently ranking #1 as if open — matching `GatheringDetailScreen`'s own established
  copy, not a new visual language. The result is **never hidden** — a full gathering can still
  legitimately be the single best match (a waitlist spot can open), only now the client knows
  and can say so honestly.
- **P0 item 3 (this pass)**: a real, structural confidence floor —
  `SCORE_CONFIRMED_AVAILABILITY_FLOOR = SCORE_CLOSE_DISTANCE + 1` (a derived invariant, not a
  bare number — confirmed live in `intentResolverScoring.js:38-54`, with a real regression-guard
  unit test, `intentResolverScoring.test.js:229`, asserting the floor must exceed the ceiling
  it's defined against) — closes the
  documented cross-tier violation where an unconfirmed "may be able to help" business
  (`resolvePolicyOnlyBusinesses`, real ceiling `SCORE_CLOSE_DISTANCE = 3`) could previously
  outrank a confirmed, live posting (`resolveBusinessAvailability`, previous real floor
  `SCORE_HAPPENING_NOW = 2`) from a *different* business. `resolvePolicyOnlyBusinesses()` itself
  is completely untouched — the fix is entirely on the confirmed side's own floor.
- Party-size feasibility against remaining capacity is covered under signal #7 above (the same
  P0 item 2 fix touches both signals at once, since it's one real feasibility check).

**Public-display**: 🟢 a matched posting's real terms (title, price, remaining capacity) are
shown to the requester once matched (`matchedAvailability`, `intentResolver.js:291-310`).
🟡 raw capacity/expiry is otherwise invisible past the business's own dashboard — a browser who
never matches a posting never sees its capacity number at all, by design (it's not a public
inventory list).

---

## 11. Time / date-window

**Meaning**: when something is scheduled (`gatherings.scheduled_at`, a real timestamp) or when
a consumer wants something (the coarse `dateWindow` bucket: `now|today|tonight|tomorrow|
weekend|flexible`), plus `business_requests.date`/`time_window_start`/`time_window_end` (a plain
calendar date + optional time-of-day range, no finer granularity).

**Collection point**: gatherings — a real date/time picker at creation, never AI-inferred.
`dateWindow` — a coarse chip picker (`GatheringsScreen.js`'s own filter chips) or a best-effort
`create-assistant` classification from free text, **never a specific date or clock time** the
model is allowed to guess, per this app's own long-standing "AI never infers a specific date/
time" rule.

**Null semantics**: `dateWindow` null/`'flexible'` means "no time filter" — every consumer of it
(`matchesDateWindow`, `dateWindowToDateRange`) returns `true`/an unbounded range rather than
excluding everything.

**Classification**: hard-constraint (filter) — `matchesDateWindow()`/`dateWindowToDateRange()`
gate which candidates are even considered, they don't score a preference.

**P2 item 8 (this pass, just closed)**: previously two internally-consistent, mutually-
inconsistent meanings of "now" shared the same English words across adjacent surfaces —
`GatheringsScreen.js`'s own "Right Now" chip used a real, narrow `[-30min, +2h]` window;
`create-assistant`'s classification of "right now" phrasing collapsed into the same broad,
full-calendar-day bucket a plain "today"/"tonight" ask got (its own vocabulary had no distinct
`'now'` value at all — confirmed live via the Management API, no drift from the original
audit's own finding). Fixed with one real canonical source, `src/utils/rightNowWindow.js`
(`RIGHT_NOW_WINDOW_PAST_MS`/`RIGHT_NOW_WINDOW_FUTURE_MS`/`isWithinRightNowWindow()`), imported
by both `GatheringsScreen.js` (pure extraction, zero behavior change) and
`intentResolverScoring.js`'s `matchesDateWindow()` (a genuine new `'now'` branch, kept separate
from the unchanged `'today'`/`'tonight'` full-day branch). `create-assistant` gained a real,
distinct `'now'` value in its own vocabulary (`VALID_DATE_WINDOWS`), with its prompt now
explicitly distinguishing "right now"/"immediately"/"right away" from "tonight"/"this evening" —
deployed to production and verified live (`verify_jwt: true`, version 8, the deployed ESZIP body
confirmed via `strings` to contain the new vocabulary and prompt text).
`dateWindowToDateRange()` — used only against `business_requests.date`, a plain calendar date
with no time-of-day component — deliberately keeps `'now'` grouped with `'today'`/`'tonight'`;
there's no honest way to narrow further than "today" against a column with no time granularity,
so that collapse is the truthful answer, not a missed narrowing.

**Disclosed, real, separate finding from this same re-verification pass, explicitly NOT fixed**
(out of item 8's own locked scope): `homeDashboard.js`'s own, differently-named `happeningNow`
signal (Home's "Happening Near You" row) uses the identical two numbers (30min/2h) as
`GatheringsScreen.js`'s "Right Now" chip, but applied to the *opposite* sides of the window —
`[-2h, +30min]` (mostly backward-looking: already in progress) rather than `[-30min, +2h]`
(mostly forward-looking: starting soon) — genuinely the mirror image of each other, confirmed
directly by plugging in a concrete timestamp on both, not assumed from the matching variable
names. A pre-existing comment on `GatheringsScreen.js` claimed the two windows were "the same,"
which this pass found to be factually wrong. Left untouched — `homeDashboard.js`'s signal is a
distinct, already-shipped Home feature, and reconciling the two needs its own explicit product
decision (which framing is actually correct for "Happening Near You"), not a silent change
bundled into this pass.

**Public-display**: 🟢 a gathering's real scheduled time is always shown as a real, formatted
timestamp — never a vague bucket — wherever the gathering itself is shown.

---

## 12. Weather

**Meaning**: two genuinely distinct real signals, neither subsuming the other —
`forecast_label` (`'Quiet'|'Excellent'|'Good'`, a current-conditions bucket) and `rain_risk`/
`heat_risk`/`cold_risk`/`outdoor_favorable` (forecast-derived, a real lookahead window).

**Collection point**: `get_weather_result()` (the shared RPC every caller calls via
`getSocialForecast()`), backed by a real, live weather-provider integration.

**Null semantics**: a `null`/absent weather object (no location resolved yet, or the RPC hasn't
returned) means "no weather signal available this call" — every consumer checks for this and
skips the bonus entirely rather than guessing a bias.

**Classification — the clearest real example of a purely contextual signal in this whole
doc**: weather never gates or excludes anything on its own; it only ever modulates *another*
signal's own ranking (biasing indoor-tagged or outdoor-tagged candidates up or down within an
already-eligible set) — the textbook definition of "Context" in the audit's own seven-stage
model.

**P2 item 7 (this pass)**: previously three independent hand-rolled re-implementations of the
same indoor/outdoor rule (`homeRecommendations.js`'s `weatherAdjustment()`, `homeDashboard.js`'s
`indoorGatheringsToday`/`outdoorGatheringsToday`, `DiscoverHubScreen.js`'s own
`weatherIndoorBias`/`weatherOutdoorBias`), and the single most-used entry point in the app
(`intentResolver.js`, backing Home's own ask box) took no weather parameter at all — confirmed
zero references before this pass. Fixed with one real shared primitive,
`src/utils/weatherBias.js` (`isWeatherIndoorBiased()`/`isWeatherOutdoorBiased()` — a real union
of both the current-conditions and forecast-derived signals, adopted from `HomeScreen.js`'s own
already-most-complete definition rather than either narrower single-signal version), now the one
real source every caller imports from. Newly wired into `intentResolver.js` (a real
`getSocialForecast()` call kicked off in parallel with every other resolver branch, never
sequentially awaited, so this adds zero latency to a real ask-box submission) and
`GatheringsScreen.js`'s own full browse/filter surface (a real tiebreak sort plus an honest
banner), closing the audit's own confirmed gap that neither reached weather at all.

**Public-display**: 🟢 always shown as a real headline/reason line when it applies ("🌧️ Weather
coming in — showing indoor options first"), never a silent, invisible re-ranking.

---

## Findings from the original audit not addressed by this remediation pass

Restated here plainly, matching this doc's own "describe reality, don't imply more than what
happened" framing — these were both real, ranked findings in the original audit but were never
part of the P0-P2 authorized build order (the user's own explicit instruction: "not fix every
red/yellow item — a specific, bounded pass"):

- **Finding 8** — `brand_partners.accommodates_party_types` never reaches a consumer-facing
  filter, match, or rank stage anywhere (see signal #9 above).
- **Finding 9** — `gender_identity`/`interested_in_genders` are never displayed to a profile
  viewer, with no explicit statement anywhere in this codebase's history of whether that's a
  deliberate design or an oversight (see signal #4 above).

Both remain real, ready-to-build (or ready-to-explicitly-decide) items for a future,
separately-authorized pass — not silently resolved by this document either way.
