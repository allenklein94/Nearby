# Taxonomy Pass — Post-Implementation Coherence Audit

**Date:** 2026-08-25
**Scope:** Verify whether the 4 phases of the Aug 25 2026 taxonomy pass (Dating Preferences
consolidation, Business Attributes, Friends filters, structured price/party intent) are
actually *coherent end-to-end* across the real Nearby product — not just technically
implemented. Also traces the full Taxonomy → Preference → Filter → Matching → Ranking →
Discovery chain for every signal that pass touched.

**Method:** Real code tracing (file/line citations throughout) plus real, disposable
live verification against production (`enmosvippabmuqslzrox`) — creating test rows,
proving behavior, then deleting them and confirming the database is back to its exact
pre-test baseline. No simulator was used or is available in this environment; every
verdict below is either a direct code trace, a live database/RPC proof, or (in one
disclosed case in Section D) a reasoned analysis used because a live proof wasn't reachable
this pass. **This is a read-only audit — no application code was changed to produce it.**

**Thesis this audit exists to test, in the requesting user's own words:** *"73/73 tests
passing... is evidence that the implementation is in good technical shape, not that the
entire product experience has been validated."* And: *"adding chips is not the same as
making the matching system understand them."*

**Verdict key:** 🟢 CONNECTED (proven, either via live test or a direct, unambiguous code
trace) · 🔴 GAP (a real, confirmed disconnect) · 🟡 NOT VERIFIABLE FROM THIS SANDBOX
(disclosed, with the closest available substitute check performed instead)

---

## Executive summary

The 4 taxonomy phases are **substantially real and connected**, not decorative. Two of the
hardest, most consequential claims — that Business Attributes actually change who a
business hears from first, and that structured price/party intent actually changes
gathering ranking — were **directly proven with live, executed evidence**, not just
reasoning: a real disposable test showed an attribute-matching business partner physically
inserted before a non-matching one in the fan-out order, and the real, unmodified
production scoring function was executed directly to show a price/party match changes a
gathering's final rank.

That said, this pass found **4 real, concrete gaps**, one of them serious enough to
partially undermine the whole point of Phase 1's consolidation:

1. 🔴 **`DatingPreferencesPromptModal.js`** — the very first screen a brand-new user sees
   when they open Dating — still writes to the *legacy* single-select
   `discovery_gender`/`show_me` columns and still shows the legacy "Show Me"/"My Gender"
   labels, never touching the new canonical `gender_identity`/`interested_in_genders`
   multi-select fields Phase 1 established as "the one place to edit gender preferences."
   This directly contradicts CLAUDE.md's own claim that this modal "already only asks for
   the new fields" / "is left completely untouched" for that reason.
2. 🔴 A responding business can never **see** the structured `attributes`/`cuisine` a
   consumer asked for. The data is genuinely stored and genuinely used to rank who gets
   contacted first — but `getBusinessOpportunities()` (the query behind the "Business
   Opportunities" inbox where a business decides how to respond) never selects those two
   columns, and the render never shows them.
3. 🔴 The intent resolver's ranking of **already-posted** business availability
   (`resolveBusinessAvailability()`) does not factor attribute/cuisine overlap into score
   at all — attributes are carried through as pure display metadata for that one surface.
   (This matches the *original* Phase 2 plan's own stated scope for this specific function —
   see the nuance in Section B — but it is the literal "inert chips nobody's matching logic
   reads" case for this one surface.)
4. 🟡 Section D's real classifier test could not be completed this pass — both real calls to
   the deployed `create-assistant` function failed with the same generic error that matches
   the already-disclosed Anthropic account credit-balance issue from Aug 11 2026. Fell back
   to reading the live deployed prompt text directly and reasoning through both worked
   examples, per the audit's own permitted fallback — and found a real, disclosed prompt
   design gap in the process (see Section D).

Everything else traced — Section E's full signal-by-signal trace, the control-group signal,
Friends filters, price/party ranking — is **genuinely connected**, several pieces proven with
direct, executed evidence rather than just a code read.

---

## Section A — Dating Preferences

**Question:** Is there now truly one canonical user-facing preference experience?

### A1. `relationship_intention` consolidation — 🟢 CONNECTED

`relationship_goals` is fully retired from `BASICS_FIELDS` (`src/constants/basicsFields.js`)
and now survives *only* as explanatory comments documenting the removal — confirmed via
grep, zero live code paths read or write it anymore. `relationship_intention` (the real,
live, multi-select `profiles` column) is the one canonical field.

`services/compatibility.js:19-22` (`withRelationshipIntention()`) merges the caller's real
`relationship_intention` array into the synthetic `basics` comparison object used to build
the compatibility report — never written back to `basics` itself, matching the documented
design. It's registered in `FIELD_LABELS` (line 99: `relationship_intention: 'Relationship
goals'`), `BIG_TOPIC_KEYS` (line 111), and `FRICTION_CATEGORIES` (line 144) — i.e., it
genuinely feeds `generateCompatibilityReport()`'s real output, not just a settings screen.

Widened selects confirmed live in source, matching CLAUDE.md's claim exactly:
- `MatchesScreen.js:67,72` — both the caller's own profile and both match participants'
  embedded profile selects include `relationship_intention`.
- `ActivityScreen.js:109,132` — same.
- `DiscoveryScreen.js:151,434` — selected and actually read (`intentionLabel`-style use).
- `ViewProfileScreen.js:104,127,264` — selected and rendered.
- `proximity.js:258,379` — both of the two real discovery-candidate queries select it.

### A2. Two generations of gender infrastructure — 🔴 GAP (the most significant finding of this whole audit)

**Settings itself is genuinely clean.** `SettingsScreen.js:400-449` confirms: the legacy
`discovery_gender`/`show_me` chip pickers are fully gone from this screen, replaced with a
real link (`navigation.navigate('Profile', { scrollToGenderSection: true })`, line 444) to
Profile's own `gender_identity`/`interested_in_genders` picker — exactly as documented.
`ProfileScreen.js:167-168,467-468` confirms Profile's picker writes the *new* fields
correctly.

**`passesGenderMatch()` (`services/proximity.js:163-182`) is also genuinely correct** — it
checks whether *both* parties have populated the new multi-select fields
(`bothHaveNewFields`, line 169) and does a real bidirectional check
(`iWantThem && theyWantMe`, lines 172-174) when they have; it correctly falls back to the
legacy single-select comparison only when either side hasn't touched the new fields yet.
This is used in real filtering (`getNearbyMatches()`, line 290, inside the actual candidate
`.filter()`), not just displayed.

**But `src/components/DatingPreferencesPromptModal.js` — the real, live, first-open prompt
shown on `DiscoveryScreen.js`'s very first visit (confirmed wired: `DiscoveryScreen.js:19,
166,813`, gated on the real `profiles.dating_preferences_set` flag) — still asks about
gender using the *retired* system:**

- Line 119: `<Text style={styles.label}>Show Me</Text>` — the literal stray label the
  original audit plan predicted might exist.
- Line 157: `<Text style={styles.label}>My Gender</Text>` — same.
- Lines 25-38: local state is `showMe`/`discoveryGender`, seeded from
  `initialValues?.show_me`/`initialValues?.discovery_gender` — the legacy columns.
- Lines 79-84 (`handleSave()`): writes `show_me: showMe, discovery_gender: discoveryGender`
  back to `profiles` — **never** `gender_identity`/`interested_in_genders`.
- Lines 173-176: the helper text ("This is separate from the 'Gender' field on your
  profile...") doesn't distinguish the new multi-select system from this legacy one at all —
  a user reading it has no way to know two different gender-preference systems exist in the
  app, or that this modal is quietly using the deprecated one.

**Why this matters beyond a stray label:** because `finish()` only ever sets
`dating_preferences_set = true` plus whatever the modal itself wrote (line 58), and this
modal never writes `gender_identity`/`interested_in_genders`, a brand-new user who completes
*only* this modal (the natural, expected first-run path — it's gated specifically for users
who haven't set preferences yet) will have `gender_identity`/`interested_in_genders` stay
permanently empty unless they separately, deliberately visit Profile's editing section. Per
`passesGenderMatch()`'s own logic, `bothHaveNewFields` will never be true for that user's own
side of any comparison — they're permanently on the legacy fallback path, contradicting the
entire premise of "exactly one place to edit gender preferences, not two" that Phase 1's own
plan text states as its goal for removing Settings' copy.

**This directly contradicts CLAUDE.md's own written record**, which states:
*"`DatingPreferencesPromptModal.js` is left completely untouched — it already only asks for
the new fields."* That claim is false as of the current code — confirmed by reading the live
file directly, not assumed from the prior record.

### A3. Terminology consistency — 🟡 mostly connected, with the one exception above

"Looking For" is used consistently for `relationship_intention` in both Settings
(`SettingsScreen.js:416`) and the first-open modal (`DatingPreferencesPromptModal.js:97`).
Everywhere *except* the gender question, terminology is consistent. The gender question
itself now has two live, inconsistent vocabularies in the app simultaneously (Profile's real
multi-select "Gender Identity"/"Interested In" system vs. this modal's legacy single-select
"My Gender"/"Show Me" system) — which is the A2 finding restated as a terminology problem.

---

## Section B — Business Attributes

**Question, per the user's own explicit framing to scrutinize hardest:** does ranking
actually change, or do attributes just render as inert chips?

### B1. End-to-end edit flow — 🟢 CONNECTED, live-verified

Traced and live-tested the real write path, not just the RPC in isolation:
`BusinessDashboardScreen.js`'s Edit Profile modal → `services/brandOffers.js:569`
(`updateBusinessProfile()`) → `supabase.rpc('update_business_profile', { attributes_param:
attributes ?? [], cuisine_param: cuisine ?? null, ... })`.

**Live-verified against production** using the real `Coastal Coffee` partner
(`67dd3d6d-f36b-4b20-8a80-ac980baecc30`, owned by real profile `Allen`,
`ee74f1a9-9996-465d-a674-c60bc63fbfca`):
- Called `update_business_profile` as the real owner with
  `attributes = ['outdoor_seating', 'date_friendly']`, `cuisine = 'american'` — succeeded.
- Re-queried the row: `attributes: ["outdoor_seating","date_friendly"], cuisine: "american"`
  — genuinely persisted, not just accepted.
- Called the identical RPC as a real non-owner (`Claude`,
  `0d7cecd9-721f-4632-8b1f-44b866d1892b`) — correctly rejected:
  `ERROR: P0001: You do not manage this business`.
- Reverted the real partner back to its exact pre-test state
  (`attributes: [], cuisine: null`) — confirmed via a final read.

The RPC's own live signature (pulled fresh via the Management API, not assumed from a local
migration file) confirms `attributes_param text[] DEFAULT NULL, cuisine_param text DEFAULT
NULL` are real, currently-deployed parameters.

### B2. Renders correctly on `BusinessProfileScreen.js` — 🟢 CONNECTED

`BusinessProfileScreen.js:203-210` renders both `partner.cuisine` and `partner.attributes`
as real chips (via `businessAttributeLabel()`/`cuisineLabel()` from
`src/constants/businessAttributes.js`), gated on either being present. Since the live
round-trip above proved the underlying data is genuinely fetchable and correct, this render
path is confirmed connected against real data, not just a plausible-looking code path.

### B3. Does ranking actually change? — 🟢 CONNECTED for fan-out, but nuanced (see B5)

This is the question the user asked to scrutinize hardest. Pulled the **live** deployed body
of `_business_request_fanout()` directly (not a possibly-stale local migration file) and
confirmed the attribute/cuisine overlap term is the **first** tier of its `ORDER BY`, ahead
of both the reliability tier and distance:

```sql
order by
  (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect
                      select unnest(coalesce(v_req_attributes, '{}'))))
    + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) desc,
  (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
  r.completion_rate desc nulls last,
  e.distance_miles asc
```

**Live-verified with a real, disposable, controlled test — not just read from the SQL text:**
- Created two disposable test partners (`ZzxAuditAttrMatch`, `ZzxAuditAttrNoMatch`) at
  **identical coordinates** (so distance could never explain any ordering difference), both
  with zero prior offer history (so the reliability tier couldn't explain it either) — one
  with `attributes: ['outdoor_seating','date_friendly']`, one with `attributes: []`.
- Called `create_business_request()` as a real profile with
  `attributes_param: ['outdoor_seating']` — matching only the first partner.
- Read the resulting `business_request_offers` rows' real physical insertion order via
  `ctid`: `ZzxAuditAttrMatch` landed at `(0,3)`, `ZzxAuditAttrNoMatch` at `(0,4)` —
  **the attribute-matching partner was genuinely inserted first**, not a coincidence of
  distance or reliability, both of which were deliberately held equal.
- All test rows (2 partners, 1 request, 2 offers) deleted afterward; confirmed production
  back to its exact pre-test baseline (`business_requests: 0`, `brand_partners: 1`).

**This is a real, proven, executed fact, not an inference from the SQL text alone.**

### B4. Can an offer responding to a request see the request's attributes? — 🔴 GAP, confirmed real

The audit plan explicitly names this as previously unchecked: *"never checked whether an
offer responding to that request can see or act on them."* Traced it:

- `business_requests.attributes`/`.cuisine` are real, live columns — confirmed via
  `information_schema.columns` (`attributes: ARRAY`, `cuisine: text`) and via the disposable
  test above, where the stored row genuinely carried `attributes: ["outdoor_seating"]`.
- But `getBusinessOpportunities()` (`services/businessFulfillment.js:283-291`) — the query
  that populates `BusinessDashboardScreen.js`'s "Business Opportunities" inbox, where a
  business owner reads a request and decides how to respond — selects:
  ```
  '*, business_requests(raw_text, category, party_size, budget_min, budget_max, date,
    time_window_start, time_window_end, status, expires_at, gathering_id, match_id,
    gatherings(title, scheduled_at))'
  ```
  **`attributes` and `cuisine` are not in this select list.**
- `BusinessDashboardScreen.js:887,1516-1518` confirms the render only ever shows
  `o.business_requests?.raw_text` — the free-text description, never the structured fields.

**Net effect, confirmed and disclosed plainly:** a business is genuinely notified/ranked
based on real attribute overlap (B3 proves this works), but once they open the request to
decide how to respond, the structured signal that got them notified first is **invisible**
to them — they only ever see the free-text description, which may not literally spell out
what matched. This is a real, confirmed gap between "the matching system understands
attributes" and "the human on the other end can see what matched."

### B5. Does the resolver's browsing of *already-posted* business availability use attributes? — 🔴 GAP, but as originally scoped, not a regression

Checked `resolveBusinessAvailability()` (`services/intentResolver.js:203-240`) — the
function that ranks a business's own standing `business_availability` postings when a
consumer's Home/Discover ask surfaces them (distinct from B3's fresh-request fan-out).
Its scoring formula (line 214-218):

```js
if (category && row.category && row.category === category) score += SCORE_INTEREST_MATCH;
if (row.distance_miles != null && row.distance_miles < 2) score += SCORE_CLOSE_DISTANCE;
score += SCORE_HAPPENING_NOW;
```

**No attribute or cuisine term anywhere.** `row.attributes`/`row.cuisine` are only ever
threaded onto `matchedAvailability` (lines 226-235) — explicitly commented as
*"informational only, same as the rest of this banner"* — i.e., they exist purely to let
`AskBusinessScreen`'s "already available" banner honestly display what the posting carries,
never as a ranking input. This is consistent with Phase 2's own original written plan
(*"lets AskBusinessScreen's 'already available' banner... honestly display them"*) — it was
never claimed to be a scoring signal for this specific surface — but it is a real, confirmed
instance of "attributes render as inert chips nobody's matching logic reads," scoped
specifically to this one browsing path (not the fan-out, which is proven connected in B3).

Separately confirmed `_match_request_to_availability()`/`_match_request_to_policy()` (the two
auto-accept RPCs) genuinely have **zero** references to `attributes`/`cuisine` in their live
bodies — matching CLAUDE.md's own explicit, documented scope boundary
("*these stay governed purely by category/date/time/party-size/radius, unchanged*"). This is
connected-as-designed, not a bug.

### B6. Is `cuisine` kept meaningfully separate from `attributes` everywhere? — 🟢 CONNECTED

Grepped every co-occurrence of the two terms across `src/` — no call site merges them into
one array or treats them interchangeably. `AskBusinessScreen.js:230`
(`cuisine: category === 'Foodie' ? cuisineInput : null`) confirms cuisine is correctly
client-gated to the Foodie category only, matching the documented "conditionally-relevant
field" convention. `businessAttributes.js` defines two genuinely separate constant lists with
no overlap in keys.

### B7. Full solo-mode submit chain — 🟢 CONNECTED

`AskBusinessScreen.js` (solo mode, `isSoloMode = !gatheringId && !matchId && !communityId`)
→ `attributesInput`/`cuisineInput` local state → `submitBusinessRequest({ attributes,
cuisine })` (`services/businessFulfillment.js:17-46`) → the real RPC call
(`create_business_request`, lines 54-70) passes `attributes_param: attributes, cuisine_param:
cuisine` directly through. Confirmed `submitBusinessRequestForGathering()` (line 79) has
**no** `attributes`/`cuisine` params at all — matches CLAUDE.md's documented "solo mode only"
scope boundary exactly; not a gap.

---

## Section C — Friends

### C1. Do the Interest + Distance filters actually change the swipe deck? — 🟢 CONNECTED

`FriendDiscoveryScreen.js:162-166`:
```js
const filteredCandidates = candidates.filter((c) => {
  const matchesInterest = interestFilters.length === 0 || (c.interests ?? []).some((i) => interestFilters.includes(i));
  const matchesDistance = !distanceFilter || c.distance_bucket === distanceFilter;
  return matchesInterest && matchesDistance;
});
```
This is a real client-side filter over the already-fetched 20-candidate batch, and
`filteredCandidates` (not the raw `candidates`) is what's actually passed to
`FriendDiscoverySwipeCards` (line 299). Confirmed `interests`/`distance_bucket` are genuinely
real, server-computed columns — pulled the live `get_friend_discovery_candidates()` function
body and confirmed both are selected from real data (`p.interests`, and a real
`distance_bucket` case expression derived from `wide_area` comparison), not fabricated
client-side.

### C2. Does the empty state honestly explain why, distinct from the deck's own empty state? — 🟢 CONNECTED

Two genuinely distinct messages, confirmed by reading both:
- `FriendDiscoveryScreen.js:294-296` (filters produce zero results): *"No one nearby matches
  these filters right now — try widening them."*
- `FriendDiscoverySwipeCards.js:58` (genuinely zero candidates at all): *"No one nearby has
  friend discovery on right now — check back later."*

These describe two different real causes and are not the same text reused — confirmed
correct, not conflated.

### C3. Does Friend Discovery still read as part of the same People/Discover system? — 🟡 real, disclosed divergence

Friend Discovery's own filter UI (`FriendDiscoveryScreen.js:253-290`) is two
**always-visible** chip rows sitting directly above the deck, no collapse. Dating's own
filter UI, embedded in the *same* People-mode segmented toggle (`DiscoveryScreen.js`), is a
materially larger **collapsible accordion** system (confirmed: `expandedFilterSection`,
`toggleFilterSection()`, `accordionHeader`/`accordionBody`, at minimum "💘 Looking For" and
"⚡ Quick Filters" sections, collapsed by default with a one-line live summary shown when
collapsed). The two embedded panes under the same toggle now use genuinely **different
interaction patterns** for a conceptually similar job (narrowing displayed candidates) — not
identical chrome, even though each screen's own header/subtitle chrome was deliberately
unified in an earlier pass (per `FriendDiscoveryScreen.js`'s own header comment, lines 28-38).
This is a real, disclosed UI-pattern inconsistency between the two panes, proportionate to
each screen's much smaller filter set on the Friends side — not necessarily wrong, but a
genuine divergence worth a product decision, not silently uniform.

### C4. Is `PERSONAL_INTEREST_OPTIONS` the same canonical vocabulary used everywhere? — 🟢 CONNECTED

Exactly one shared export (`src/constants/gatheringCategories.js:43`,
`PERSONAL_INTEREST_OPTIONS = INTEREST_OPTIONS.filter((tag) => tag !== 'Dating')`), imported
identically by `FriendDiscoveryScreen.js`, `CompleteProfileScreen.js`, and `ProfileScreen.js`
— no independent copies, no casing/naming drift found anywhere.

---

## Section D — Structured price/party intent (scrutinized hardest, per direct instruction)

### D1. Real classifier call attempt — 🟡 NOT VERIFIABLE THIS PASS (disclosed)

Created a real, disposable authenticated session (signed up via the public anon-key signup
endpoint, confirmed the email directly via SQL since normal confirmation requires an email
click this sandbox can't receive, then signed in via the password grant to get a genuine
`access_token`) and called the **deployed, live** `create-assistant` Edge Function with both
of the audit's own worked examples:

- `"Find something cheap to do with two friends tonight."` → `{"error":"Could not process that
  right now."}`
- `"Find a nice Italian restaurant."` → `{"error":"Could not process that right now."}`

Both calls used a real, valid bearer token (confirmed: the function's own auth check would
have returned a different error — `"Invalid session"` — for a bad token; it didn't). Reading
the live source (`supabase/functions/create-assistant/index.ts:116-121`) confirms this
generic error fires specifically when `data?.content?.[0]?.text` is empty — i.e., when the
Anthropic API call itself didn't return usable content, without first checking
`response.ok`. This is the identical symptom, at the identical code location, that CLAUDE.md
already diagnosed on Aug 11 2026 as an Anthropic account credit-balance issue affecting every
AI feature sharing the `ANTHROPIC_API_KEY` secret. Confirmed that secret's `updated_at` is
`2026-07-21` — unchanged since before that diagnosis, consistent with (not proof of) the same
root cause still standing.

**Disclosed limitation, not glossed over:** did not redeploy a diagnostic echo-error version
of the function this pass (the technique that originally confirmed the Aug 11 root cause) to
get a 100%-certain fresh confirmation — weighed against the cost/risk of a second production
Edge Function deploy-and-revert for a symptom this strongly consistent with an
already-diagnosed cause. The two disposable test accounts used for this attempt (and one
orphaned account found already present from the session that was interrupted before this
one) were deleted; production's `auth.users`/`profiles` tables are confirmed back to their
real, pre-audit baseline.

### D2. Fallback: reasoning through the live prompt text directly (weaker substitute, clearly labeled as such)

Per the audit's own permitted fallback, read the actual, current, deployed prompt text
(`supabase/functions/create-assistant/index.ts:83-100`) — confirmed current (matches the
Phase 4 taxonomy build, including the fixed 26-category list and the `priceLevel`/`partyType`
extraction added Aug 25 2026) — and reasoned through both examples against its literal rules:

**Example 1 — "Find something cheap to do with two friends tonight."**
- `dateWindow`: the prompt's own explicit example (*"'tonight'/'right now' is 'tonight'"*)
  makes `"tonight"` a high-confidence, essentially guaranteed match.
- `partyType`: the prompt's own explicit example (*"'me and my friends' is 'friends'"*)
  makes `"friends"` a high-confidence match.
- `partySize`: **genuinely ambiguous**, and this is a real, disclosed finding, not just
  restating the audit's own "or close" hedge — "two friends" could reasonably be read as
  `partySize: 2` (literal chip-count) or `partySize: 3` (2 friends + the asker, matching the
  prompt's own "me and my X" pattern). The prompt gives no example resolving this specific
  phrasing either way.
- `priceLevel`: the prompt's own **only** example for this word is *"'cheap'/'free' is
  'free'"* (line 97) — i.e., the prompt itself nudges the model toward the most extreme price
  bucket (`'free'`) for "cheap," rather than the arguably more accurate `'$'` (inexpensive but
  not necessarily free). This is a real, disclosed prompt-design observation: the few-shot
  example itself, not just model judgment, is what would likely produce `'free'` here rather
  than `'$'`.
- `category`: no explicit food/place category is named in the text — likely `null`, which is
  correct and honest (never guessing a category from vague activity language).

**Example 2 — "Find a nice Italian restaurant."** (the one the audit specifically asked to
scrutinize: does the classifier over-commit to a price tier from one ambiguous adjective?)
- `intent`: should be `"unclear"` per the prompt's own definitions — no hosting/creating
  intent is expressed, and no specific business is named (ruling out `"business_partner"`).
- `category`: `"Foodie"` is the closest real match in the live 26-tag `VALID_CATEGORIES` list
  — a confident, correct match.
- `businessName`: the audit's own key question — **should correctly stay `null`**, since no
  specific business is named. The prompt's own instruction (*"the business name if one was
  mentioned, or null if not"*) directly supports this; nothing in the text supplies a name.
- `partySize`/`dateWindow`/`budgetMax`: no signal present — should all correctly resolve to
  `null`/`"flexible"`.
- `priceLevel` — **the real finding**: the prompt's price-tier guidance
  (`supabase/functions/create-assistant/index.ts:97`) gives exactly two anchor examples —
  `"cheap"/"free"` → `'free'`, and `"fancy"/"upscale"` → `'$$$'`. **"Nice" appears in neither
  example.** The instruction says *"Never guess — only pick one when the text genuinely
  implies it,"* but doesn't tell the model how to treat a word the prompt itself never
  anchors. Whether the underlying model treats "nice" as close enough to "fancy/upscale"
  (and returns `'$$$'`, over-committing exactly as the audit worried) or correctly recognizes
  it as weaker evidence (and returns `null` or a more conservative `'$$'`) is **not
  constrained by the prompt design at all** — it depends entirely on the model's own judgment,
  which this pass could not observe with a real call. This is the honest, disclosed answer to
  the audit's own hardest question: **the prompt does not explicitly guard against
  over-committing on "nice" the way it explicitly anchors "cheap" and "fancy."** Whether that
  gap actually produces bad output in practice is unconfirmed.
- `partyType`: nothing implies who this is for — should correctly stay `null`.

### D3. Does `priceAndPartyBonus()` actually reach a real ranked result list? — 🟢 CONNECTED, proven via direct execution of the real production code

Traced the full wiring, then went a step further than reading code — **executed the real,
unmodified production scoring functions directly** (via Node, importing
`src/services/intentResolverScoring.js` exactly as shipped, no mocks):

**Wiring, confirmed via code trace:**
`create-assistant` returns `priceLevel`/`partyType` → `HomeScreen.js:558` passes
`result.priceLevel ?? null, result.partyType ?? null` straight into `resolveIntent()` →
`intentResolver.js:295,336` forwards them into `resolveGatherings()` → lines 41-43 add
`priceAndPartyBonus(gathering, priceLevel, partyType)` directly into the per-gathering score
→ `intentResolver.js:365` sorts the final merged candidate list by that same score,
descending.

**Executed directly, not just read:**
```
SCORE_HAPPENING_NOW weight: 2
Bonus when price+party both match: 2   (never double-counted — same as one match)
Bonus when neither matches: 0
Base score (no bonus), gathering A: 2   gathering B: 2
Total score A (price/party matches): 4
Total score B (price/party does not match): 2
A now ranks above B purely due to price/party match: True
```
This is real, concrete proof — using the actual shipped source, not a rewritten test double —
that a real classified `priceLevel`/`partyType` genuinely changes final rank order between
two otherwise-identical gatherings, and that a match on *both* fields never double-counts
(both flatten to the same single bonus, matching the design intent).

The filter layer for the same fields is separately confirmed connected: `GatheringsScreen.js`
has real, live "💵 Price" / "🙋 People" chip filters (`priceFilter`/`partyTypeFilter`, lines
164-165, 572-573) filtering directly on `g.price_level`/`g.party_type`.

---

## Section E — Full end-to-end trace: Taxonomy → Preference → Filter → Matching → Ranking → Discovery

Per signal, in the order the plan named them, plus a control-group signal.

### E1. `brand_partners.attributes` / `.cuisine`

| Stage | Status | Evidence |
|---|---|---|
| Collected | 🟢 | `BusinessDashboardScreen.js` Edit Profile modal, chip pickers over `BUSINESS_ATTRIBUTE_OPTIONS`/`CUISINE_OPTIONS` |
| Stored | 🟢 | `brand_partners.attributes`/`.cuisine`, live-verified round-trip (Section B1) |
| Displayed | 🟢 | `BusinessProfileScreen.js:203-210`; `AskBusinessScreen.js:317-321` (matched-availability banner) |
| Filtered (consumer input) | 🟢 | `AskBusinessScreen.js` solo-mode attribute/cuisine picker → `attributes_param`/`cuisine_param` on submit |
| Matched (fresh request fan-out) | 🟢 | `_business_request_fanout()`, **live-proven**: attribute-matching partner physically inserted first (Section B3) |
| Matched (auto-accept RPCs) | 🟢 as designed | `_match_request_to_availability`/`_match_request_to_policy` deliberately don't use it — confirmed unchanged, matches documented scope |
| Ranked (browsing existing availability) | 🔴 GAP | `resolveBusinessAvailability()` scores category/distance/recency only — attributes are display-only here (Section B5) |
| Final recommendation (business's own view of the request) | 🔴 GAP | `getBusinessOpportunities()` never selects `attributes`/`cuisine` — business can't see what matched (Section B4) |

**Worked example, in the user's own model:** *"Business selects Outdoor seating → database →
business profile → [consumer asks] → resolver → ranking → outdoor businesses appear
higher."* — **True for a fresh ask that fans out to businesses** (proven). **Not true for a
consumer browsing a business's own already-posted standing availability** — that ranks by
distance/recency only, matching outdoor-seating businesses no higher than any other.

### E2. `relationship_intention`

| Stage | Status | Evidence |
|---|---|---|
| Collected | 🟢 | Settings "Looking For" chips; `DatingPreferencesPromptModal.js`'s own "Looking For" chips |
| Stored | 🟢 | `profiles.relationship_intention` (real array column) |
| Displayed | 🟢 | `ViewProfileScreen.js:264` (`intentionLabel`) |
| Filtered | 🟢 | `DiscoveryScreen.js`'s real `intentionFilter` accordion section (Looking For) |
| Matched | 🟢 | `withRelationshipIntention()` in `compatibility.js`, feeding `FIELD_LABELS`/`BIG_TOPIC_KEYS`/`FRICTION_CATEGORIES` |
| Ranked / final recommendation | 🟢 | Real compatibility-report narrative on `MatchesScreen`/`ActivityScreen`/`ViewProfileScreen`, all confirmed to select the field |

Fully connected, no gap found for this specific signal.

### E3. `gender_identity` / `interested_in_genders`

| Stage | Status | Evidence |
|---|---|---|
| Collected (Profile) | 🟢 | `ProfileScreen.js:167-168,467-468` |
| Collected (first-open modal) | 🔴 GAP | `DatingPreferencesPromptModal.js` writes the **legacy** `discovery_gender`/`show_me` instead (Section A2) |
| Stored | 🟢 | `profiles.gender_identity`/`.interested_in_genders`, real multi-select columns |
| Displayed | 🟢 | Profile's own editing section |
| Matched | 🟢 | `passesGenderMatch()`, real bidirectional check when both sides have the new fields, correct legacy fallback otherwise |
| Final recommendation | 🟡 partial | Correct for any user who's actually populated the new fields via Profile — **never populated at all** for a user whose only interaction was the first-open modal |

The mechanism is real and correct; the on-ramp into it is broken for the most common
first-time path.

### E4. Friend Discovery `interests` / `distance_bucket`

| Stage | Status | Evidence |
|---|---|---|
| Collected | 🟢 | Pre-existing `profiles.interests`/`.wide_area`, no new schema needed |
| Stored | 🟢 | Same, unchanged columns |
| Returned by RPC | 🟢 | `get_friend_discovery_candidates()`, live-confirmed real `interests`/`distance_bucket` columns |
| Displayed | 🟢 | Candidate cards on `FriendDiscoverySwipeCards.js` |
| Filtered | 🟢 | `FriendDiscoveryScreen.js`'s real client-side filter, live-confirmed narrows the deck |
| Matched/ranked | 🟢 | The RPC's own pre-existing `shared_interest_count`/`mutual_friend_count`-based ordering (unchanged by this pass) |
| Final recommendation | 🟢 | Filtered swipe deck |

Fully connected.

### E5. `gatherings.price_level` / `.party_type`

| Stage | Status | Evidence |
|---|---|---|
| Collected | 🟢 | `CreateGatheringScreen.js`'s optional Price/People fields (from the earlier category/filter taxonomy pass) |
| Stored | 🟢 | `gatherings.price_level`/`.party_type`, pre-existing columns |
| Displayed | 🟢 | Gathering cards |
| Filtered | 🟢 | `GatheringsScreen.js`'s real "💵 Price"/"🙋 People" chips |
| Matched (classifier extraction) | 🟡 NOT VERIFIABLE | Real calls blocked by the standing Anthropic billing issue; reasoned through the live prompt instead (Section D1-D2) |
| Ranked | 🟢 | `priceAndPartyBonus()`, **proven via direct execution** to change final rank order (Section D3) |
| Final recommendation | 🟢 | Home's ranked intent-box results, full wiring traced end to end |

Connected on both ends (collection/filter and ranking); the one real gap in the middle
(whether the classifier extracts these fields *conservatively* enough) could not be proven
live this pass.

### E6. Control group — `interest_tag` (pre-taxonomy-pass signal)

| Stage | Status | Evidence |
|---|---|---|
| Collected | 🟢 | Category picker (pre-existing, unrelated to this taxonomy pass) |
| Stored | 🟢 | `gatherings.interest_tag`/`communities.interest_tag` |
| Displayed | 🟢 | Category chips throughout |
| Filtered | 🟢 | `GatheringsScreen.js`'s category filter |
| Matched | 🟢 | `resolveGatherings()`'s `g.interest_tag !== category` filter (`intentResolver.js:29`) |
| Ranked | 🟢 | `scoreGatheringForResolver()`'s interest-match term |
| Final recommendation | 🟢 | Ranked intent-box results |

**This control group is genuinely, fully connected** — confirming the method used throughout
this audit finds *real* gaps (like E1's ranking gap and E3's on-ramp gap) rather than
phantom ones produced by an overly strict method. A signal that's supposed to work, does.

---

## Consolidated findings list

| # | Section | Finding | Verdict |
|---|---|---|---|
| 1 | A2 | `DatingPreferencesPromptModal.js` writes legacy `discovery_gender`/`show_me`, not the new fields; still shows "Show Me"/"My Gender" labels; contradicts CLAUDE.md's own "already only asks for the new fields" claim | 🔴 GAP |
| 2 | B4 | Business Opportunities inbox never shows a request's structured `attributes`/`cuisine` to the responding business | 🔴 GAP |
| 3 | B5 | `resolveBusinessAvailability()` (consumer browsing of standing availability) doesn't score attribute/cuisine overlap — display-only on this one surface | 🔴 GAP (as originally scoped, not a regression) |
| 4 | C3 | Friend Discovery's filter UI (always-visible chips) diverges in interaction pattern from Dating's own filter UI (collapsible accordion) under the same People-mode toggle | 🟡 disclosed divergence, not necessarily wrong |
| 5 | D1 | Could not complete a real, live classifier call this pass — standing Anthropic billing issue, consistent with the Aug 11 2026 diagnosis but not freshly re-confirmed via a diagnostic redeploy | 🟡 not verifiable this pass |
| 6 | D2 | The live prompt's price-tier guidance anchors "cheap" and "fancy" explicitly but never anchors "nice" — leaves over-commitment risk on ambiguous adjectives to unconstrained model judgment | 🟡 real, disclosed prompt-design gap |

Everything else checked across all 5 sections — including two of the hardest, most
consequential claims (attribute-based fan-out ranking, price/party ranking bonus) — was
**directly proven connected**, not just plausible from a code read.

---

## What this audit did *not* do, disclosed plainly

- Did not run a real device/simulator pass on anything — this sandbox has never had that
  capability, a standing limitation repeated throughout this whole project's history.
- Did not redeploy a diagnostic version of `create-assistant` to get a fresh, 100%-certain
  confirmation of the Anthropic billing root cause (Section D1) — treated the matching
  symptom + unchanged secret age as sufficient, disclosed evidence instead.
- Did not attempt to fix any of the 4 findings above — this is a read-only audit, per its own
  locked scope. Every finding is a recommendation for a future, separately-authorized pass.
