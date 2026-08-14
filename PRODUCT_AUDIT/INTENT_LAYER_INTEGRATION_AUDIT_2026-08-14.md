# Phase 1 → Existing-System Integration Audit (2026-08-14)

Read-only audit, requested as a follow-up to `INTENT_LAYER_PHASE1_AUDIT_2026-08-14.md`. That
first pass confirmed the Home intent box's *placement/no-stranger-discovery/no-schema-writes*
requirements. This pass asks a different question: **does the intent resolver actually behave
like one coherent fulfillment system across gatherings, communities, connected friends/matches,
perks, and the business request/offer engine — or do those remain fragmented, individually
working parts?**

No code was modified to produce this report — every claim below was traced directly against
source: `src/services/intentResolver.js`, `src/screens/HomeScreen.js`,
`supabase/functions/create-assistant/index.ts`, `getGatheringFitReasons()`
(`src/services/gatherings.js`), `getActiveOffers()` (`src/services/brandOffers.js`), and
`get_connected_open_business_requests()` (`supabase/migrations/20260814_business_fulfillment_tier2.sql`).

## Resolver branch-by-branch

### Gatherings
- **Source**: `getNearbyGatherings('wide')` → filtered client-side (`interest_tag === category`
  exact match, `matchesDateWindow()`) → scored via `getGatheringFitReasons()` → sorted
  descending → sliced to 4.
- **Eligible when**: category tag matches exactly (no fuzzy/semantic matching — a category like
  "Foodie" will not match a gathering tagged something else, even if it's genuinely dinner-shaped)
  and the date falls inside the coarse window (today/tonight/tomorrow/weekend/flexible).
- **Priority**: always runs first, unconditionally. Fills up to 4 slots before any other branch
  is even attempted.
- **On no results**: falls through to the next branch (does not short-circuit the whole
  resolver).
- **Presentation**: unified list item, `type: 'gathering'`.

### Communities
- **Source**: none. There is no community query anywhere in `intentResolver.js` — confirmed via
  a direct grep for "communit" in the file, zero matches.
- This is a real, concrete gap against both the original CLAUDE.md Tier 2 design ("Communities
  you already belong to... and friends/matches") and this audit's own checklist. Communities
  were dropped somewhere between the plan and the actual Phase 1b / Tier-2-retrofit build, with
  no explicit callout in CLAUDE.md's own status notes that this happened. Not a bug — never
  built.

### Friends/matches with a compatible open ask
- **Source**: `get_connected_open_business_requests()` SECURITY DEFINER RPC — computes the
  caller's connected set as accepted `friendships` UNION `matches` (both directions), inner-joins
  `business_requests` where `status = 'open'`.
- **Eligible when**: the caller is genuinely connected (friend or match) *and* that friend has
  already, independently, submitted their own open business request with a matching
  category/date. This branch does **not** surface "friends who might also want dinner" in
  general — only friends who already went through the business-request submission flow
  themselves. A narrower signal than the label "Tier 2" implies.
- **Priority**: only queried `if (results.length < 4)` — i.e., only when gatherings didn't
  already fill the cap.
- **On no results**: falls through to perks.
- **Presentation**: unified list item, `type: 'friend_request'`.

### Perks
- **Source**: `getActiveOffers()` → filtered by `target_interest_tag === category` (or
  untargeted offers, visible to everyone), gated on real location permission (silently skipped,
  not an error, if permission isn't granted).
- **Eligible when**: active, not gathering-attached, not expired, category-matching or
  untargeted, within 50mi when targeted by location.
- **Priority**: only queried `if (results.length < 4)` — same gate as friends/matches. **If
  gatherings alone already produced 4 results, perks are never even queried**, regardless of how
  well a specific perk would actually fit the request.
- **No scoring at all**: `getActiveOffers()` sorts by `created_at desc` only — there is no
  relevance/fit score computed for perks, unlike gatherings.
- **Presentation**: unified list item, `type: 'perk'`.

### 1:1 business-request flow ("Tier 4")
- **Source**: not part of `resolveIntent()` at all. It is a separate UI branch in
  `HomeScreen.js`, rendered only when `resolveIntent()` returns **zero results across all three
  branches above, combined**.
- **Eligible when**: gatherings + friend-requests + perks together produced nothing.
- **Priority**: not ranked against anything — it is not a candidate the resolver evaluates and
  scores. It is a fallback screen shown only in the total-empty case.
- **On tap ("Ask Nearby Businesses")**: navigates to `AskBusinessScreen` with prefilled
  text/category/party size/budget/date-window — nothing is submitted yet. The user must review
  the form and explicitly tap Submit. Only then does `submitBusinessRequest()` fire, creating a
  real `business_requests` row and triggering `_business_request_fanout()` (radius-based fan-out
  to businesses) plus `_match_request_to_availability()` (check against already-posted standing
  availability). Even after that, the result is **asynchronous** — a business has to respond
  with a real offer before there is anything to accept. There is no synchronous "here's a
  business offer" result at the moment the user types an intent.
- **Presentation**: not unified. Mutually exclusive with the `intentResults` list — confirmed
  directly in the JSX: `intentResults` and `intentEmptyFallback` are two separate conditional
  blocks that never both render, and `intentEmptyFallback`'s block is the *only* place the "Ask
  Nearby Businesses" button exists anywhere in `HomeScreen.js`.
- **Is it "naturally reachable from Home intent"?** Technically yes — but only via a dead-end
  path (zero other results) → a manual navigation → a manual form review/submit → an
  asynchronous wait. It is never presented as a candidate alongside a gathering or a perk in the
  same result set, and never appears at all if even one gathering happens to loosely match
  category+date.

## Exact trace: "I want dinner tonight"

```
HomeScreen.handleHomeIntentSubmit()
  → classifyCreateRequest("I want dinner tonight")
      → POST create-assistant edge function
      → Anthropic Haiku classifies:
          intent: "gathering"      (not "business_partner" -- no business named)
          category: "Foodie"       (closest VALID_CATEGORIES match -- no "Dinner" tag exists)
          dateWindow: "tonight"
          title: best-effort short title
          partySize / budgetMax: null unless explicitly stated in the text
  → intent is "gathering" -> NOT routed to proceedToCreation, goes to resolver:
  → resolveIntent({ category: "Foodie", dateWindow: "tonight" })
      → getNearbyGatherings('wide')
          → filter: interest_tag === "Foodie" AND scheduled today
          → score via getGatheringFitReasons, sort desc, slice(0,4)
          → results.push(...) for each -- type: 'gathering'
      → IF results.length < 4:
          → getConnectedOpenBusinessRequests({category:"Foodie", date:<today>})
          → results.push(...) for each match -- type: 'friend_request'
      → IF results.length < 4:
          → check location permission
          → getActiveOffers(lat,lng) -> filter target_interest_tag === "Foodie" or untargeted
          → results.push(...) for each -- type: 'perk'
      → return results
  → back in HomeScreen:
      IF resolved.length > 0:
          → setIntentResults({items: resolved, ...})
          → renders "Already happening near you" -- a mixed list of whichever of
            {gathering, friend_request, perk} actually filled the 4 slots, in
            strict fill order (gatherings always first, perks last and only if
            slots remain) -- NOT a cross-type relevance ranking.
          → "Ask Nearby Businesses" is NOT shown here, at all.
      IF resolved.length === 0:
          → setIntentEmptyFallback({...})
          → renders "Nothing already happening for this"
          → "Ask Nearby Businesses" button appears HERE ONLY
          → tap -> navigate('AskBusiness', {prefill...}) -- no request created yet
          → user reviews/edits form -> taps Submit
          → submitBusinessRequest() -> INSERT business_requests row
              → _business_request_fanout()          (radius search, notifies matching partners)
              → _match_request_to_availability()     (checks existing postings)
          → returns notifiedCount -- request now sits open, waiting on businesses
```

There is no branch in this trace where a community, or a synchronous business match, is ever
considered as a candidate alongside a gathering. Communities aren't queried at all; the business
path only activates after everything else has already failed, and only after a second explicit
user action beyond the original intent submission.

## Answer to "would 'Tier 4 = last resort' be an acceptable characterization?"

**No — and it is literally what the code does.** This is not a mischaracterization to push back
on; it is an accurate description of `HomeScreen.js` lines 321–366 and `intentResolver.js` in
full. Two concrete consequences follow directly from tracing the code, not from inference:

1. **Gatherings can silently starve out perks with no comparison ever happening.** If 4+
   gatherings loosely match category+date (even mediocre fits — "Matches your interests" is
   worth the same 5 points as being 1.9 miles away in `getGatheringFitReasons()`), the
   `results.length < 4` guard means `getActiveOffers()` is **never called**. A "perfect
   restaurant offer" that would have been an ideal fit never enters the comparison — not because
   it lost a ranking, but because it was never queried in that case.
2. **There is no cross-type scoring anywhere in this codebase.** `getGatheringFitReasons()`
   computes a score in isolation for gatherings only; perks have zero score (sorted by recency
   only); friend-requests have zero score (sorted by recency only). No function anywhere takes a
   gathering-candidate and a perk-candidate and decides which one better answers "dinner for two
   tonight." The current design is a strict fill-the-bucket hierarchy (gatherings → friend-asks →
   perks → [empty] → business), not a "candidate pool → eligibility → relevance ranking → best
   options" pipeline.

## Gaps against "intent is the universal entry point; Nearby determines the best available
fulfillment path without exposing unknown nearby individuals"

1. **No unified candidate/relevance model.** The four branches never compete on the same axis —
   there is no shared "how well does X answer this intent" score. This is the core gap: the
   architecture is a priority *queue*, not a relevance *ranking*.
2. **Business fulfillment is structurally a dead-end fallback, not a fulfillment option.** It's
   excluded from the result set by construction (a separate conditional block), and even when
   reached, it cannot return a comparable "answer" in the same turn — it starts an asynchronous
   process. It cannot currently be "the best available fulfillment path" in the same sense a
   gathering or perk can, because the product has no synchronous business-offer inventory to
   draw from at the moment of intent — only a live, standing-availability + request-fanout
   mechanism that takes real minutes/hours to produce an answer.
3. **Communities are entirely absent** from the resolver, despite being named in both this
   audit's checklist and the original CLAUDE.md plan.
4. **No-stranger-discovery principle: still holds, no gap here.** Confirmed nothing in any
   branch, including the business branch, ever surfaces an unconnected individual — this part of
   the architecture is sound and unaffected by the gaps above.

## Net assessment

Individually: the gatherings query works, the perks query works, the friend/match
connected-request signal works, the business request/offer/accept engine works. Nothing here is
broken. But they are **not integrated as a single fulfillment-resolution system** — they are
stacked in a fixed hierarchy with no shared scoring, and the business engine specifically is
reachable only through a dead-end, never treated as a real, comparable candidate. This is the
"feature A/B/C/D all individually work but intent doesn't connect them intelligently" scenario —
confirmed by tracing the code, not hypothetical.

**No code was changed as part of this audit.**
