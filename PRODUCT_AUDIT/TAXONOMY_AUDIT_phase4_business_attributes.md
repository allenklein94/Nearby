# Phase 4 — Business Category/Attribute Audit

Part of the "Nearby Universal Taxonomy, Filters & Matching Audit" (see CLAUDE.md, top section).
Read-only research — no code was changed, no schema touched, no migration written. Every claim
below was confirmed directly against live production (`enmosvippabmuqslzrox`) via
`information_schema.columns`, not assumed from client code.

## The real finding, stated plainly

**Businesses in Nearby have exactly one taxonomy dimension — a 6-value broad industry category
(`food_drink`/`fitness_wellness`/`retail_shopping`/`arts_entertainment`/`professional_services`/
`other`) — and zero attribute dimensions.** Confirmed by reading the full column list of every
business-shaped table live:

- **`brand_partners`** (the business itself): `id, name, logo_url, description, active,
  created_at, latitude, longitude, address, tier, category, stripe_*, reservation_provider*`.
  No cuisine, no price tier, no ambiance/vibe field, no "outdoor seating"/"date-friendly"/
  "group-friendly"/"live music" boolean or tag array of any kind.
- **`business_requests`** (a consumer's ask): `raw_text, category, party_size, budget_min/max,
  date, time_window_start/end, latitude/longitude, radius_miles, status, ...`. Category, price
  range (budget), party size, and a time window — no cuisine/ambiance dimension to match against.
- **`business_availability`** (a business's standing offer): `partner_id, category, title,
  description, offer_type, price, capacity, ...`. Same shape — category + price + capacity, no
  attribute layer.
- **`business_fulfillment_policies`** (a business's standing auto-accept rule): `party_size_min/
  max, active_hours_start/end, min_spend_per_person, max_discount_pct, auto_accept_party_size_max,
  deposit_amount, cancellation_window_hours`. Real logistics constraints, still no attribute
  dimension.

**Net effect**: the external message's own worked example — a user who likes "Italian + outdoor +
date-friendly" being matched to "Italian restaurant + outdoor seating + romantic + 1.2 miles
away" — cannot happen today, at any layer. The `category` match (`Foodie`/`food_drink`) is the
entire signal available; "Italian," "outdoor seating," and "date-friendly" all have nowhere to
live on either side of the match (neither the business's own row nor the consumer's own ask can
express them).

## What this is not

This is not a bug — nothing here is broken, no existing feature silently fails. It's a real,
confirmed **absence**, consistent with how narrowly-scoped every business-fulfillment migration
in this app's history has been (each one added exactly the fields its own immediate feature
needed — category for matching, price/party-size for the offer shape, time-window for
scheduling — never a general-purpose attribute system). Nothing in this app's own history
suggests this was accidentally skipped; it was simply never asked for as its own piece of work
until now.

## What a real fix would look like, sized honestly (not a build, a scoping note for whoever picks
## this up)

Two independent, addable pieces, deliberately not designed in full here (that's a build-planning
pass, out of scope for a read-only audit):

1. **A small, curated attribute tag set per business** (e.g. a `brand_partners.attributes text[]`
   column, CHECK-constrained to a real, deliberately small vocabulary — "outdoor_seating",
   "date_friendly", "group_friendly", "live_music", "kid_friendly", "quiet", "casual",
   "upscale" — mirroring this codebase's own established "small, curated, CHECK-constrained
   enum, not a free-text tag cloud" convention used everywhere else in this file, e.g.
   `party_type`/`price_level` from today's own taxonomy pass). Businesses would self-declare
   these the same way they already self-declare `category`.
2. **A genuine cuisine sub-category, scoped to `food_drink` businesses only** (the one industry
   category where "what kind" meaningfully subdivides further — Italian/Mexican/Sushi/etc.,
   mirroring `basicsFields.js`'s own existing pattern of a field only being relevant/shown
   conditionally). Not a general sub-category system for all 6 industries — `fitness_wellness`/
   `retail_shopping`/etc. don't have the same obvious, well-known sub-taxonomy a user would
   reasonably expect to filter by, and inventing one for each would be exactly the kind of
   "add more categories without checking if they're needed" the audit's own opening framing
   warned against.

Both pieces would need to reach `intentResolver.js`'s business-availability/policy-only branches
and the `business_requests`/`business_availability` matching RPCs to be more than decorative —
matching Phase 3's own "a filter that never round-trips into a matching signal is cosmetic"
finding. Not designed further here; flagged as the single largest, most concrete recommendation
this whole audit produced.
