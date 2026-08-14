# Intent Layer UX Walkthrough — 2026-08-14

Read-only. No application code was modified to produce this. This is a code-trace walkthrough,
not a live device/simulator run — this sandbox has never had simulator access (the same standing
limitation noted throughout CLAUDE.md). Every step below is grounded in the actual current source
(`HomeScreen.js`, `intentResolver.js`, `createAssistant.js` + its deployed Edge Function,
`businessFulfillment.js`, `AskBusinessScreen.js`, `BusinessRequestDetailScreen.js`,
`BusinessDashboardScreen.js`, `notifications.js`) and the live migrations that back the RPCs it
calls — not guessed. Where the actual outcome depends on live data this session can't query
without fabricating it (what gatherings/perks/businesses genuinely exist near a real device at
a real moment), that's stated explicitly rather than invented.

Classification outputs (the `intent`/`category`/`dateWindow` JSON) are produced by a real
Anthropic call (`create-assistant`, `claude-haiku-4-5-20251001`) — this session cannot execute
that call (no way to mint a real signed-in session token, same gap noted everywhere else this
function is discussed in CLAUDE.md). Expected classifications below are derived directly from
the deployed prompt's own instructions and its `VALID_CATEGORIES`/`VALID_DATE_WINDOWS` lists, not
guessed from vibes — but flagged as "expected," not "observed," throughout.

---

## Intent 1 — "I want dinner tonight for two."

**What the user enters**: types the sentence into Home's intent box (`HomeScreen.js`, "What do
you want to do?" section) and taps "Find it."

**How intent is classified**: `classifyCreateRequest()` → `create-assistant` Edge Function.
Expected: `intent: "gathering"`, `title: "Dinner"` (or similar), `category: "Foodie"`,
`partySize: 2`, `dateWindow: "tonight"`, `budgetMax: null` (no budget was stated).

**Which resolver branches execute**: `intent === 'gathering'` skips the
`community`/`business_partner` short-circuit and goes straight into `resolveIntent({ category:
'Foodie', dateWindow: 'tonight' })`. Location permission is requested/awaited first (the race fix
already applied), then all five branches run in parallel via `Promise.allSettled`:
- `resolveGatherings('Foodie', 'tonight')` — filters `getNearbyGatherings('wide')` to
  `interest_tag === 'Foodie'` and `scheduled_at` inside today's midnight-to-midnight window.
- `resolveCommunities('Foodie')` — category is present, so this runs: caller's own communities
  tagged `Foodie`.
- `resolveConnectedRequests('Foodie', 'tonight')` — friends'/matches' open `business_requests`
  rows with `category='Foodie'` and `date = today's date`.
- `resolvePerks('Foodie', location)` — active offers where `target_interest_tag` is null or
  `'Foodie'`.
- `resolveBusinessAvailability('Foodie', location)` — live `business_availability` postings
  matching category/radius, `ends_at > now()`.

**Which results are returned**: whatever real Foodie-tagged gatherings/communities/friend-asks/
perks/availability postings exist near the device right now — this session cannot know that
without fabricating data, so it's not asserted. What *can* be asserted from the code: every
branch that returns something gets a real, non-fabricated `score` (see Ranking below), merged and
capped at 4 (`RESULT_CAP`).

**How results are ranked** — this is the one place with a real, confirmable problem (see
Cross-Cutting Finding #1 below): `resolveGatherings` scores each match via the *shared*
`getGatheringFitReasons()` (`services/gatherings.js:923`), unmodified from what Home's own Best
Pick / `GatheringDetailScreen` already use. That function's real weights are: interest match +5,
close distance (<2mi) +3, happening today +2, beginner-friendly +1, **plus
`Math.min(attendeeCount, 10)`** — up to +10 for a busy gathering. `intentResolver.js`'s own header
comment claims the shared scale is "interest match = 5, close distance = 3, happening now/today =
2" — it never mentions the attendee-count term, but the term is still there, silently, because
the resolver calls the exact same function Home/Detail use. A single popular "Dinner tonight"
gathering with 8 people already going could score `5 (interest) + 3 (close) + 2 (today) + 8
(attendees) = 18`; the best possible score for a live business-availability posting offering the
exact same thing right now is `5 + 3 + 2 = 10`; a friend independently asking for the identical
thing is a flat `6`. A loosely-matching but popular gathering will systematically outrank a
perfectly-fitting live business offer or a friend's own compatible ask, every time — the exact
failure mode the Aug 14 integration audit says it closed ("a rigid tier order let a handful of
loosely-matching gatherings silently starve out a better-fitting perk or business availability
posting"). It's not tier-ordering anymore, but the outcome — gatherings structurally dominating —
is the same, just moved into the scoring function instead of the branch order.

**What screen the user sees next**: if any branch returned something, a ranked list renders
inline under the intent box ("Already happening near you" — icon + title + subtitle per row,
tap-through to `GatheringDetail`/`CommunityDetail`/`ViewProfile`/`BrandOffers`/`AskBusiness`),
plus "None of these? Create it yourself →" and "Try something else." If every branch came back
empty, the empty-fallback panel renders instead (see Intent 5).

**Coherence / terminology / dead ends**: no internal jargon ("Tier," "resolver," "fulfillment")
appears anywhere in the rendered copy — confirmed via a repo-wide grep of visible strings. The
ranked-results panel and the empty-fallback panel are visually distinct (a plain tappable list vs.
a colored-pill CTA button) — a user who submits two similar asks back-to-back and gets one of each
outcome would notice the UI mode changed, though the copy for each explains itself honestly.

**Existing feature over-prioritized?** Yes — see the scoring finding above. A gathering's own
popularity (attendee count) is not a "does this fit the ask" signal in the way interest/distance/
timing are, but it's weighted more heavily than any of them in this shared cross-type ranking.

---

## Intent 2 — "I want something fun to do Saturday."

**What the user enters**: same box, same submit path.

**How intent is classified**: expected `intent: "gathering"` (closest fit — no `community`/
`business_partner` language), `title` likely "Something fun" or similar, **`category: null`**
("something fun" doesn't name a category from the 24-tag list — the prompt tells the model to
return `null` when none fit, and nothing here fits), `dateWindow: "weekend"` — "Saturday" is not
in `VALID_DATE_WINDOWS` (`today/tonight/tomorrow/weekend/flexible`), so the model is instructed to
pick the closest match, which is `weekend`.

**Which resolver branches execute**: same five, but with `category: null`. This changes behavior
materially:
- `resolveGatherings(null, 'weekend')` — the category filter (`if (category && g.interest_tag
  !== category) return false`) is skipped entirely, so **every** nearby gathering scheduled
  Saturday or Sunday becomes a candidate, scored purely on distance/attendance/beginner-
  friendliness/today-ness (today-ness will be false for most, since "today" is checked against
  the literal calendar date, not "is this weekend").
- `resolveCommunities(null)` — short-circuits to `[]` (gated on a real category; correctly
  reasoned in the code's own comment: no signal to rank an uncategorized "all your communities"
  list by).
- `resolveConnectedRequests(null, 'weekend')` — **here is Cross-Cutting Finding #2**: passes
  `date: dateWindowToDateParam('weekend')`, which returns only **Saturday's** date string, a
  single day — not a range. A friend's open ask for Sunday of the same weekend would not match
  (`get_connected_open_business_requests`'s `br.date = date_param` is an exact-date equality),
  even though the user asked for "Saturday" broadly and would plausibly consider Sunday fair game
  too if phrased as "this weekend." This is a real internal inconsistency: `resolveGatherings`'s
  own `matchesDateWindow('weekend')` treats "weekend" as the full Saturday-through-Sunday range,
  but `resolveConnectedRequests`'s date param collapses the same word to one calendar day. The two
  branches of the same intent don't agree on what "weekend" means.
- `resolvePerks(null, location)` — with `category` falsy, the ternary in `resolvePerks` takes the
  `: offers` branch, meaning **every** active offer is returned as a candidate regardless of
  targeting, each scored `0` (the score condition requires a real category to compare against).
  Zero-score, functionally-irrelevant perks can occupy a `RESULT_CAP` slot whenever fewer than 4
  higher-scoring candidates exist from the other branches.
- `resolveBusinessAvailability(null, location)` — same shape: category-untargeted postings pass
  through, each scoring only on distance/happening-now (no interest-match component since
  `category` is null), so a same-radius but topically irrelevant posting could rank alongside
  genuinely fun-sounding ones with no way for the user to tell why.

**Which results are returned**: a broad, mostly-unfiltered browse of nearby gatherings this
weekend, plus possibly-irrelevant perks/availability, real communities/friend-asks correctly
excluded (no signal). This is arguably the *correct* behavior for a genuinely vague ask ("browse
what's around"), but it's worth naming plainly: for an uncategorized intent, half the resolver's
five branches degrade to near-noise (untargeted perks/availability at score 0) rather than staying
silent the way `resolveCommunities` does.

**What screen next**: same ranked-list or empty-fallback pattern as Intent 1. Given a broad
category-less gathering query in most markets, the ranked-list branch is far more likely to fire
than the empty-fallback.

**Coherence / dead ends**: no jargon leak. The "weekend" ↔ single-Saturday-date mismatch above is
invisible to the user (they never see a date computed), but it means two conceptually-identical
"this weekend" asks — one routed through gatherings, one through friend-asks — silently apply
different date windows without the product ever explaining that distinction anywhere.

**Existing feature over-prioritized?** Less clear-cut than Intent 1 (no category to be "wrong"
about), but the same attendee-count scoring bias applies, and zero-score untargeted perks
occupying result slots is a real, confirmable instance of a lower-relevance candidate type
crowding out what should be an honestly-empty section.

---

## Intent 3 — "I want to play pickleball tonight."

**What the user enters**: same box.

**How intent is classified**: expected `intent: "gathering"`, `title: "Pickleball"`,
**`category: "Sports"`** — there is no `Pickleball` tag in `VALID_CATEGORIES`; the prompt tells
the model to "pick the closest match," and `Sports` is the only plausible one. `dateWindow:
"tonight"`.

**Which resolver branches execute**: same five, `category: 'Sports'`, `dateWindow: 'tonight'`.

**Which results are returned / ranking**: same mechanics as Intent 1, but worth naming the
`Sports`-specific consequence: `Sports` is a broad bucket covering everything from a pickup
basketball game to a marathon-training meetup to a Super Bowl watch party — none of which are
pickleball. Because the classifier only ever returns one of the 24 fixed tags (never "pickleball"
itself, never a sub-category), `resolveGatherings` will surface **any** Sports-tagged gathering as
a real, positively-scored candidate (interest match +5) regardless of whether it has anything to
do with pickleball specifically. A user asking for a very specific activity gets results
filtered only to the nearest *broad* category, with no secondary signal (raw_text, title) ever
consulted to narrow within it. This is a real, structural precision ceiling on every branch that
relies on the 24-tag category system (gatherings, communities, connected-requests, perks,
availability) — not a bug in any one function, but a product-level gap: the whole resolver is
only as precise as a 24-value enum, and a specific sport/activity/cuisine that isn't its own tag
degrades silently to "the nearest broad bucket," with the user never told that happened.

**What screen next**: ranked list (Sports-tagged gatherings, etc.) or empty-fallback, same
pattern.

**Coherence / dead ends**: no jargon leak. The "closest match" category collapse is invisible —
nothing in the UI ever shows the user what category their request was mapped to before showing
results, so if the results look off-topic (a 5-a-side soccer gathering instead of anything
pickleball-related), there's no way for the user to understand *why* without already knowing how
the system works internally.

**Existing feature over-prioritized?** Same attendee-count scoring bias as Intent 1, compounded
by the broad-category collapse: a large, popular, off-topic Sports gathering can outrank a small,
on-topic (or business-availability) pickleball-specific result.

---

## Intent 4 — "I want to meet people who are into this activity."

This is the most important case in the set, because it's the one most likely to collide with the
locked no-stranger-discovery principle, and it's also the one where the classifier's fixed
four-way taxonomy is weakest.

**What the user enters**: same box. Note the dangling reference — "this activity" has no
antecedent anywhere in this flow (the intent box is a fresh, stateless text field, not a
continuation of a specific category screen), so the phrase itself is ambiguous even before
classification.

**How intent is classified**: the `create-assistant` prompt only recognizes four buckets:
`gathering` (host an event), `community` (start a group), `business_partner` (name a business),
or `unclear`. "I want to meet people" describes none of these — it's not asking to host, start, or
partner with anything; it's asking to be introduced to people. Expected classification:
**`intent: "unclear"`**, `category: null` (no activity is actually named), `title: null`.

**Which resolver branches execute**: `unclear` is treated identically to `gathering` in
`HomeScreen.js` (`if (result.intent === 'community' || result.intent === 'business_partner')` is
the only short-circuit — `unclear` falls through to `resolveIntent()` exactly like `gathering`
does). So all five branches run with `category: null, dateWindow: null` (or whatever
`dateWindow` the model guessed, likely `flexible`).

**Which results are returned**: the same category-less degradation described under Intent 2 —
broad, mostly-unfiltered nearby gatherings; no communities (gated on category); friend-asks and
perks/availability collapse toward noise. **None of these five branches contains any
person-discovery logic at all** — there is no "people" candidate type anywhere in
`intentResolver.js` (confirmed: the only `type`s ever produced are `gathering`, `community`,
`friend_request`, `perk`, `business_availability` — `friend_request` means "a friend's own open
business ask," not "a person to meet"). The system has no way to directly answer "introduce me to
people," by design — the no-stranger-discovery principle means it structurally can't show
unconnected individuals. That's the *correct* refusal per the product's own locked constraint. The
problem is **how that refusal is communicated**: it isn't. The user never sees anything that says
"Nearby doesn't do stranger discovery — here's how to meet people instead (join a gathering/
community and you'll meet whoever's there)." They just get the same generic "Already happening
near you" gathering list (or empty-fallback) that any other vague ask produces, with zero framing
that connects "gatherings are how you meet people here" to what they actually typed.

**What screen next**: ranked-list or empty-fallback panel, indistinguishable in presentation from
Intent 2's outcome. If the resolver happens to be empty, the user would then see "Nothing already
happening for this" → "Ask Nearby Businesses" — a business-request CTA in response to "I want to
meet people," which is a real, concrete category mismatch a user would find confusing (asking a
restaurant to help you meet people is not what was asked for).

**Coherence / dead ends**: this is the clearest dead end in the whole walkthrough. The user's
actual intent ("introduce me to people who share an interest") is never resolved, never explained
as unresolvable, and never redirected toward the product's real answer (gatherings/communities are
the mechanism for meeting people, precisely because they avoid stranger discovery) — it's silently
reinterpreted as "find me an activity" with no acknowledgment that a different kind of request came
in. A first-time user typing this exact sentence — a very natural thing to type, given Home's own
prompt is "What do you want to do?" — gets an experience that never engages with what they asked.

**Existing feature over-prioritized?** Not a ranking problem here — a coverage problem: gatherings
get shown by default (they're the fallback for any unclassifiable ask), which happens to be the
product's real answer to "meet people," but nothing frames it that way.

---

## Intent 5 — "I want dinner tonight for two under $100," where no existing supply is sufficient
   and a real business request must be created.

**What the user enters**: same box, using the user's own example verbatim (also covers Intent 1's
scenario with a budget added — `budgetMax: 100` extracted this time).

**How intent is classified**: `intent: "gathering"`, `category: "Foodie"`, `partySize: 2`,
`dateWindow: "tonight"`, `budgetMax: 100`.

**Which resolver branches execute**: all five, as in Intent 1. For this scenario to reach the
business-request path, every branch must genuinely return nothing — a real, plausible outcome for
a market with few nearby gatherings/communities/perks tonight in the Foodie category.

**Which results are returned**: `resolved.length === 0` → `setIntentEmptyFallback({
classifyResult, typedText })` instead of `setIntentResults(...)`.

**What screen the user sees next**: the empty-fallback panel — "Nothing already happening for
this," a colored "Ask Nearby Businesses" button, "Or create it yourself →", "Try something else."
Tapping "Ask Nearby Businesses" calls `handleAskBusiness()`, which navigates to `AskBusinessScreen`
prefilled from the classifier's own output: `prefillText`, `prefillCategory: 'Foodie'`,
`prefillPartySize: 2`, `prefillBudgetMax: 100`, `prefillDateWindow: 'tonight'`. The screen renders
with every field already filled in — heading "Can Nearby make this happen?" — the user only has
to review and tap "Ask Nearby Businesses" again to actually submit (a second, real confirmation
step, not an auto-submit — consistent with every other result type's "review before commit"
discipline).

**Submission → fan-out**: `submitBusinessRequest()` requests location (already granted, from the
earlier resolver pass), then calls `create_business_request` — inserts the row, then (now, after
this session's own spam-guard migration) checks for a literal duplicate/cap before ever fanning
out. Assuming this is genuinely new: `_business_request_fanout()` finds the 10 nearest active
partners within 15mi, inserts a `pending` `business_request_offers` row for each, pushes each
business a real "New opportunity nearby!" notification. `_match_request_to_availability()` runs
in the same call — if any business had already posted matching live availability (Phase 4), that
row is immediately upgraded to `offered` with the business's own pre-declared terms, and the
business gets a "Your availability was just matched!" push — meaning the user could see a real,
already-answered offer the very first time `BusinessRequestDetailScreen` loads, with zero delay
and zero manual business action. This is the strongest evidence in the whole walkthrough that the
architecture genuinely works end-to-end, not just piecewise.

**Landing screen**: `navigation.replace('BusinessRequestDetail', { requestId, justSubmitted: true,
notifiedCount, duplicate })`. Banner: "We asked N nearby businesses — you'll be notified as offers
come in." (or the honest duplicate/zero-notified variants). Below: the raw ask, a status line, and
either "No businesses have responded yet" or real offer cards.

**Business side**: a notified business owner opens `BusinessDashboardScreen`'s "Requests" tab
(`section: 'requests'`, reachable directly from the push tap via `business_opportunity_received` →
`navigate('BusinessDashboard', { initialSection: 'requests' })`) and sees "Business Opportunities"
— the raw ask text, category/party-size/budget line, "Make an Offer" / "Not for me." Tapping "Make
an Offer" opens a modal: offer-type chips (Standard/Discount/Perk/Upgrade/**Alt. time**), a
free-text description, an optional price — **no date/time field of any kind**, even when "Alt.
time" is selected. `submitBusinessOfferResponse()`'s `proposedTime` parameter is never populated
by any caller anywhere in the app — confirmed via a full grep of every call site. The schema
supports it (`business_request_offers.proposed_time`), the RPC accepts it, but no UI on either
side ever reads or writes it. **This is Cross-Cutting Finding #3**: the "Alt. time" chip implies a
distinct, structured capability (propose a different time) that doesn't actually exist — a
business owner would have to fall back to typing the time into the free-text description (matching
the field's own placeholder example, "Table for 4 at 7:30"), and even if they did, the consumer-
facing `BusinessRequestDetailScreen` never renders `proposed_time` either way (only
`offer_description` and `offer_price` are shown for both the `offered` and `accepted` states) —
so the field is fully decorative today.

**Acceptance → reservation**: the consumer taps "Accept This Offer" on the matching offer card →
`acceptBusinessOffer()` → `accept_business_offer` RPC, which locks the parent request row,
verifies no sibling offer has already won, flips the winner to `accepted` and every sibling to
`expired`, flips the parent request to `fulfilled` — all one transaction, genuinely enforced
server-side (this session independently re-verified this exact guard live in the prior
conversation turn, not assumed). The screen re-loads and now shows "Accepted — your reservation"
with a "Mark as Completed" button for the business side to close the loop later
(`complete_business_reservation`).

**Coherence — direct answer to the user's own framing question**: does this feel like "intent →
relevant businesses → offer → acceptance → reservation" without making the user feel like they
entered a different subsystem? **Mostly yes, with one real seam.** No internal jargon ever
surfaces (`business_requests`/`partner_id`/"fulfillment" never appear in copy). The visual
language is consistent with the rest of the app (same card/chip/button conventions as everywhere
else). The one genuine seam: the transition itself is a hard mode-switch — one moment the user is
looking at a list of taps-navigate-to-existing-things rows (or nothing at all), the next they're
on a completely different screen type (a form) that asks them to *re-confirm* data they already
typed once (their own ask text, again, in a bigger text box) before anything happens. It's not
mislabeled or confusing, but it is a second data-entry step for information the system already
has, which is the most "you've left the smooth part of the app" moment in the whole flow.

**Existing feature over-prioritized?** Not in this specific trace (this is the case where nothing
existing *is* prioritized, correctly). The relevant finding here is the "Alt. time" dead field
above, not a ranking issue.

---

## Cross-cutting findings (candidates for the next fix pass — not modified this pass)

1. **Gathering popularity (attendee count) silently dominates the resolver's "one shared score."**
   `intentResolver.js` reuses `getGatheringFitReasons()` verbatim, but that function adds
   `Math.min(attendeeCount, 10)` and `+1` for `beginner_friendly` — neither is mentioned in the
   resolver's own "shared weights" comment, and together they can outweigh every other type's
   maximum possible score (perk max 5, business-availability max 10, community/friend-request
   flat 6). This is the same class of problem the Aug 14 integration audit already fixed once
   (tier-order bias) reappearing as score-magnitude bias. `src/services/intentResolver.js:100-116`
   vs. `src/services/gatherings.js:923-957`.
2. **"Weekend" means two different date ranges within the same intent resolution.**
   `matchesDateWindow('weekend')` (gatherings) covers Saturday through Sunday;
   `dateWindowToDateParam('weekend')` (connected friend-requests) collapses to Saturday only. A
   friend's genuinely-this-weekend Sunday ask is silently excluded from Tier 2 while a Sunday
   gathering correctly surfaces. `src/services/intentResolver.js:44-70` vs. `:78-98`.
3. **The "Alt. time" offer type has no actual time input anywhere, on either side.**
   `business_request_offers.proposed_time` / `submitBusinessOfferResponse()`'s `proposedTime` is
   never set by any caller and never rendered by `BusinessRequestDetailScreen` in either the
   `offered` or `accepted` state — the chip changes a stored `offer_type` value with no user-
   facing behavior attached to it. `src/screens/BusinessDashboardScreen.js:1467-1480`,
   `src/screens/BusinessRequestDetailScreen.js:150-166`.
4. **The empty-fallback's "try widening what you're looking for" has no widening control.**
   `AskBusinessScreen.js` submits with a hardcoded `radiusMiles: 15` — there is no radius input
   anywhere on the screen, so the copy invites an action the UI doesn't offer.
   `src/screens/BusinessRequestDetailScreen.js:135`.
5. **"I want to meet people" (and any ask the classifier can't place) silently becomes a
   gatherings browse with no explanation.** The no-stranger-discovery refusal is correct by
   design, but it's invisible — nothing tells the user that gatherings/communities *are* Nearby's
   answer to "meet people," so the connection between what they asked and what they got is never
   made. Most consequential finding in the set relative to the user's own framing question.
6. **The 24-tag category system is the resolver's real precision ceiling.** A specific ask
   ("pickleball," a named cuisine, a named artist) always collapses to the nearest broad bucket
   before any branch runs, with no secondary text-match narrowing and no indication to the user
   that this collapse happened.

None of the above were fixed in this pass — this was a read-only walkthrough, per instruction.
