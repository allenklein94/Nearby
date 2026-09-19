# PROPOSAL (not built): Places and Perks as Experience components -- for review

Status: **Perks-as-add-on BUILT (2026-09-19, on "build 2"); Places NOT built** (recommendation to decline stands; an optional "Also nearby" row remains an open, separate decision).

## What exists today
`assembleExperience` (src/services/experienceAssembly.js) fills template components ("Dinner", "Live music", ...) only from
`EXPERIENCE_ELIGIBLE_TYPES = ['business_availability', 'gathering']`. Both are things a person can actually *do* at a stated time:
a business's live/scheduled posting (confirmed, capacity-checked) or a real gathering. Matching is by category/subcategory/
secondary categories; ordering reuses each candidate's own existing score; no second scoring pass.

- **Perks** = `offers` (business promotions, `resolvePerks`). Score is 5 only when `target_interest_tag` equals the category, else 0.
  No time, no capacity, no confirmation. A perk is a discount/benefit, not an event.
- **Places** = Google Places nearby search (`services/places.js`). Not Nearby supply: not a partner, cannot respond, no availability,
  no consent to be featured.

## The decision that matters
An Experience component today implies "Nearby can stand behind this." Adding either type changes that promise.

## Proposed rules (if you approve)
**Perks**
1. Eligible as a *supporting add-on line* inside an existing component ("+ 10% off dessert at X"), never as a component's primary item and never able to satisfy the "needs real inventory in >= 2 components" rule for a context suggestion.
2. Only perks from a business that also has a live posting in the same experience (perk decorates supply; it never stands alone).
3. Perk must be `active` and unexpired; category match must be exact (`target_interest_tag`), untargeted perks never attach.
4. Ranking: no score of its own; it cannot change item order (avoids paying-for-position effects). Shown after the ordered items.

**Places**
1. Recommend **not** making Google places Experience components. They are unconfirmable, unranked by any Nearby signal, and would break "Nearby found options and the business responds."
2. If you want them: a separate, clearly labeled "Also nearby (not a Nearby partner)" row *outside* the experience, below the components, never counted toward the >= 2 component threshold, never claimed, and never part of a booking flow. Requires a decision on Google's display terms and cost per query.

## Ranking / eligibility implications to decide
- Does a perk count as a "business offering something" for the one-card-per-business dedupe (yes, proposed: it folds into the business's card)?
- Consumer honesty: copy must never imply availability for perks/places ("may be able to help" tier language stays).
- Privacy: none of this touches business-facing payloads; consumer-side only.
- Stranger rule: unaffected (both are businesses/places, not people).
- Cost: places = paid API call per experience assembly unless cached; perks = zero (already fetched).

## Recommendation
Approve **perks-as-add-on only** (rules 1-4). Decline places as components; decide separately whether an "Also nearby" row is wanted.
