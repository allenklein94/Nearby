# Sponsored Placement — Paid Product Design (PROPOSAL, nothing built)

Status: proposal for owner approval. **Revision 3 (2026-09-20): owner parameters applied and the four open points CONFIRMED (locked v1)** ($25/slot-week, 10 mi, 1 per category per area, per-business cap, allow-list categories, default-on switch, refund terms, legal gate). Companion to CLAUDE.md item 44 (locked rule). No code, migration or Stripe
change exists for this. Numbers are the owner's (section 15); anything still open is marked there.

## 0. Locked rules this design must satisfy
1. Personalized response = organic, request-driven, never labeled an ad, keeps "made you an offer".
2. Sponsored = paid reach nobody asked for, always visibly "Sponsored", never inside a request's offers list, never
   organic language ("made you an offer", "Our pick", "Why this matches").
3. Sponsorship never touches routing, matching, ranking, offer order or organic recommendations. Own slot.
4. Paid status comes only from the platform's payment/placement records. Unknown = not displayed.
5. A creative may be reused; the placement carries the disclosure.
6. Sponsored impressions/taps never enter organic demand, matching signals or the feedback loop.

## 1. Smallest viable product: "Sponsored Spotlight"
**What a business buys:** one fixed-duration (7-day) spotlight of ONE of its own existing standing items (a Brand Offer /
perk, or its business card) in ONE sponsored slot, for its own local area (section 4). **Price: $25 per slot-week**
(2500 cents USD, stored in a price table read by the checkout function, never sent by the client). Prepaid, one-time.
**No auction, no bidding, no paid ranking, no pay-per-click/impression.** Every buyer pays the same price, so payment
can never order anything; the only ordering rule is the neutral tie-break in section 2.

**What the business is paying for:** the placement being live for the 7 days. It is NOT a guarantee of impressions or
taps (Nearby cannot promise how many people browse), which is also why a refund is tied to delivery of the placement,
not to results.

**Not in v1:** targeting people, conversion attribution, push, chat, request offers, Home, intent results, Surprise,
Celebrate, plans, or auto-renewal.

## 2. Placement surface, inventory and frequency
- **V1 surface: Perks/Places browse only** (Discover's Perks and Places lists). One sponsored card per screen view, in a
  fixed position as a separate card above the organic list; never interleaved, never replaces or reorders an organic
  row. Not in organic request offers, matching, routing or any recommendation surface (Home, intent results, Best Pick,
  Surprise, Celebrate, plans).
- If the sponsored business also appears organically, both show; the organic position is unchanged.
- **Inventory: at most 1 sponsored placement per category per local area at any time** (definitions in section 4).
  Enforced by the database (exclusion constraint on area + category + time range over holding/paid states), not just
  by the UI, and re-checked at payment confirmation.
- **One per business:** a business can hold only one active/held spotlight at a time in v1.
- **Frequency cap (revised): max 1 sponsored impression per person per business per 7 days.** The cap is keyed on
  the BUSINESS, not the placement, so a business can never reach the same person more often by holding several
  placements. Recorded when the server returns the card (a conservative "served" count, so no client trust needed).
  *Change from revision 1:* "per person" cannot be honored with a device-local counter (a second device or a
  reinstall would reset it), so v1 keeps one small table `sponsored_seen(user_id, partner_id, seen_at)`: owner-only RLS,
  purged after 7 days, read only by the serving function, never by any organic function, never shown to businesses.
  It is the only per-person sponsored record; it exists solely to enforce the cap. (If you prefer zero per-person
  storage, the fallback is a device-local cap, which is per device rather than per person.)
- **Deterministic tie-break** when two eligible sponsors could show in one view (area borders): the earliest `paid_at`
  wins, then placement id. Never price (all equal), never any consumer signal. A capped or hidden sponsor is skipped
  and the next eligible one may show; if none, no sponsored card.

## 3. Eligibility
- Active, approved business with a geocoded address (same requirement as request routing).
- The promoted item is a real, currently valid standing item of that business (server verifies ownership; no free text).
- Creative and text pass `screen-business-content` at tier low as a NEW purpose (`sponsored_spotlight`); outage = fail
  closed (503, nothing published), same as offers.
- **Category allow-list, fail closed.** Instead of listing excluded categories, only category groups explicitly present
  in a `sponsorable_category_groups` table can be sold. It ships EMPTY, so nothing is purchasable until the owner (after
  the legal/policy review in section 16) adds groups. Regulated/high-risk categories and any category needing extra
  advertising-policy review are simply never added. Suggested initial exclusions to hand to that review: alcohol,
  gambling, adult, health/medical claims, financial products, and any category that raises trust/safety concern.
- Business in good standing (no admin hold, no unresolved chargeback).

## 4. Targeting, "local area" and the 10-mile radius
**Allowed (contextual only):** (a) the viewer's position, used inside the serving RPC to test range; (b) the category
the viewer themselves opened in the Perks/Places browse.
**Forbidden, enforced by the RPC signature (it accepts none of these):** interests, `interest_groups`, onboarding
answers/goals, `behavior_events`, request/intent/search history, occasions, relationships, friends/matches, age, gender,
any profile field, dating/friends mode, Interested state. Businesses never choose or see people.
**Two narrow, non-targeting reads (both are suppressors, never selectors):** the viewer's own
`show_sponsored_places` switch and `sponsored_hidden` list (section 11), and `sponsored_seen` for the cap (section 2).

**"Category" for inventory = the category group** (the 19 majors in `category_tag_groups`, the same canonical mapping
used elsewhere) of the promoted item's business, matched to the category group of the list being browsed. (Leaf-tag
inventory is a later refinement; groups keep "1 per category per area" understandable.)

**"Local area" for inventory = a fixed grid cell keyed on the BUSINESS's address, not on any viewer.**
- One SQL function `sponsored_area_key(lat, lng)` returns the cell id from fixed constants: about 10 miles on a side at
  mid-latitudes (latitude step 0.145 degrees; longitude step scaled for roughly 40 degrees north). Cells narrow slightly
  toward the poles, so this is honestly "approximately 10 miles", not exact; the constants live in one place and are
  verified by tests.
- Inventory rule: one holding/paid placement per (area_key, category group) over any time range. Two businesses in the
  same cell and category cannot both hold a week; the second is told "this slot is taken for those dates" (it may pick
  other dates). Nothing about consumers enters this rule.

**The 10-mile radius is fixed, not purchasable or adjustable.** A spotlight is eligible for a viewer when the
great-circle (haversine) distance between the business's stored coordinates and the viewer's position is at most 10
miles. Because cells are about 10 miles wide, a viewer near a border can be within 10 miles of a business in the next
cell; that is intended and resolved by the tie-break in section 2 (still one card per view).

**How consumer location stays private:**
- The viewer's coordinates are sent only to the serving RPC over the authenticated connection, used in the distance
  test, and immediately discarded: not written to any table, not logged, not returned in the response, not put in
  stats or events. The response carries the business's own public card and, at most, no distance at all (v1 shows none;
  it would be a fresh measurement the person did not ask for).
- Businesses never receive a location, cell, distance or direction for any viewer. Reporting is per placement per day
  (impressions, taps) with no location dimension and no per-cell or per-viewer breakdown (section 9).
- The business's own address (its stored, already-public location) is the only geography that is stored on a placement.
- Same central location rule as everywhere: the device fix comes from `services/userLocation.js`; no new permission
  prompt; no fix = no sponsored card (never a guess).

## 5. Payment architecture (Stripe)
- Nearby is the merchant; the business is the **customer** paying Nearby. This is the platform account, NOT the
  Connect flow used for consumer payments. Stripe-hosted Checkout (one-time payment). Nearby never sees card data.
- New edge function `create-sponsored-checkout` (owner-only; amount decided server-side from a price table, never by the
  client). Return URL = `BUSINESS_WEB_URL` (server-decided).
- **Activation only from a verified webhook** (`checkout.session.completed` / `payment_intent.succeeded`, signature
  checked, idempotent by Stripe event id) via service role. The client can never flip a placement to paid.
- Test mode only until the owner approves live; reuses the existing `STRIPE_LIVE_APPROVED` hard gate.
- **Approvals (existing authority rules apply):** the purchase is authorized by the business owner/authorized rep for
  their own account. Activating a live-money mechanism is checkpoint 6 = platform owner/admin (fallback: designated
  finance/ops approver). Claude never approves. **Prerequisite:** the approval audit table and approver permissions
  (already flagged "build before the first live step") must exist first.
- Refunds are Stripe money movement: executed by a platform admin action, recorded with who/what/when.

## 6. Data / state model (new tables only; NO column added to any organic table)
- `sponsored_placements`: id, partner_id, item kind + item id, **area_key**, **category_group**, starts_at, ends_at,
  status, creative snapshot (screened text/media path), screening tier, created_by. No radius column (fixed 10 mi
  constant). Exclusion constraint (btree_gist): no two placements with the same (area_key, category_group) overlapping
  in time while in a holding/paid state. Unique: one holding/paid placement per partner at a time.
- `sponsored_payments`: placement_id, stripe ids, amount_cents (2500), currency (usd), status (pending/paid/failed/
  refunded/partially_refunded/disputed), refunded_cents, paid_at. Written only by the webhook/admin RPC.
- `sponsored_daily_stats`: placement_id, day, impressions, taps. Aggregate only, no user ids, no location.
- `sponsored_hidden`: user_id, partner_id (owner-only RLS). `sponsored_seen`: user_id, partner_id, seen_at (7-day purge).
- `sponsorable_category_groups`: allow-list (empty at ship). `sponsored_price`: one row, 2500 cents.
- `profiles.show_sponsored_places boolean not null default true`: the person's own switch. This is the ONLY column
  added to an existing table; it is read only by the serving RPC and only to SUPPRESS, and is covered by the privileged-
  column/owner-only update conventions.
- RLS: owner reads own placements/payments/stats; no client writes; all writes via SECURITY DEFINER RPCs; anon revoked.
- **State list (rule 1):** draft -> awaiting_payment (holds the slot up to 24 h) -> scheduled (paid, future) -> active
  -> completed; side states payment_failed, expired_unpaid (swept), cancelled, refunded, rejected (screening), paused
  (admin / dispute / delivery failure).
- **Serving predicate (one function, fail closed):** status in (scheduled, active) AND now in [starts_at, ends_at) AND
  payment status = paid AND screening ok AND business active AND category group on the allow-list AND the viewer's
  switch is on AND not hidden AND under the 7-day cap AND within 10 miles AND category matches. Anything else, including
  an unknown or missing payment row, is NOT returned. There is no "unlabeled" path.

## 7. Disclosure UI
- One dedicated component `SponsoredCard`, the only way a sponsored item renders. The "Sponsored" pill is hard-coded
  in the component (not data-driven), so a served card cannot lack it. Neutral outlined pill (coral = action).
- Line: "Sponsored · {Business}". "Why am I seeing this?" -> "{Business} paid to be shown to people browsing {category}
  near {area}. It isn't based on your activity." (true by construction, rule 7).
- CTA is plain "View" (rule 4: nothing else is honestly available). No "Get an offer" on the card. Accessibility label
  starts "Sponsored:".
- Banned in the component and its strings: "made you an offer", "Our pick", "Why this matches", "Because you like",
  "Trending", "Nearby found", any friend/going reason.
- Business dashboard: a separate "Promotions" area inside Availability's collapsed "More ways to offer" (no new tab).
  Never shown as an Opportunity.

## 8. Billing, expiry, refunds, cancellation
- Prepaid $25 for 7 days, no auto-renew; renewal is a new purchase. A slot is held during checkout only (24 h).
- **Before the start date: full refund** (cancel any time before `starts_at`).
- **After it starts: no refund for elapsed/delivered time.**
- **Prorated refund when Nearby materially fails to deliver.** "Materially fails" (defined so it is decidable, and
  recorded): the placement was not servable for reasons on Nearby's side (admin pause not caused by the business's own
  violation, screening/serving outage, Nearby deactivating the slot) for more than 24 hours cumulative, or the placement
  cannot run for its full term. Refund = undelivered days x ($25 / 7), rounded in the business's favor to the cent.
  NOT material failures: low or zero impressions (no impressions are promised), consumers hiding or switching off
  sponsored places, the business's own pause/policy violation, a business deactivating itself.
- Payment failed / expired_unpaid: never served. Dispute or chargeback webhook -> `paused` immediately, fail closed.
- Expiry swept by cron (like `expire_stale_business_requests`); the serving predicate also checks `ends_at`, so a missed
  sweep never over-serves.
- All refunds are Stripe money movement done by a platform admin action, logged with who/what/when/which placement.

## 9. Reporting (business-facing)
Own placements only: days remaining, impressions, taps, tap rate, amount paid. No identities and no distinct-people
figures (the cap table `sponsored_seen` is used only to enforce the cap and is never exposed or aggregated for businesses). Shown only in Promotions; never in Home,
Opportunities, "Demand near you", Match Radar, match-fit or Offer Performance. Labeled "approximate" (client-reported).
Conversions are **deferred**: attribution would touch request rows and risks contaminating organic analytics; revisit
only with a separate attribution table that no organic function reads.

## 10. Isolation and anti-confusion safeguards
- Separate RPC (`get_sponsored_spotlight`), separate tables, separate component, separate events. Organic RPCs and
  services never reference these tables (Jest guard scans them, like `businessPayloadPrivacyGuard`).
- A tap on a spotlight writes no `behavior_events`, no Interested, no trending input. Counts such as "Nearby found N
  options" and every demand aggregate exclude sponsored by construction (they never query the new tables).
- No `is_sponsored` column on `brand_offers`, `business_requests`, offers or gatherings: an organic row cannot be
  flagged sponsored by mistake, and a business cannot toggle itself.
- Copy guard: sponsored files contain none of the banned organic phrases; consumer offer files (item 43 guard) still
  contain no "Sponsored".
- Minimum-payload rule unchanged: the sponsored payload is the business's own public item; no consumer data flows out.

## 11. Consumer controls
- **"Show sponsored places" setting: ON by default**, a clear switch in Settings (with a one-line explanation: "Businesses
  can pay to be shown here. They're always labeled Sponsored. It doesn't change your other results."). Off = the serving
  RPC returns nothing and no `sponsored_seen` row is written. A person who never opens Settings is covered by the
  card-level controls below.
- On every sponsored card: "Hide this sponsor" (`sponsored_hidden`), "Report this ad" (existing report flow), and a
  link to the setting.
- The disclosure sentence says the placement is paid and not based on the person's activity; it must remain true.

## 12. Failure states
| Situation | Behavior |
|---|---|
| Payment pending / failed / unknown / no payment row | not served; owner sees "Awaiting payment" / "Payment failed" |
| Webhook delayed | stays scheduled-unpaid, not served until confirmed |
| Duplicate webhook | idempotent by Stripe event id |
| Dispute / chargeback | paused immediately |
| Screening outage | 503, nothing saved or served |
| Business deactivated or item removed | not served (predicate); refund per section 8 |
| Slot filled while in checkout | payment confirmation re-checks; if lost, auto-refund |
| Serving RPC error | client shows no sponsored card; organic list unaffected |

## 13. Tests and audit requirements
- Jest guards: organic files never reference sponsored tables/RPC; `SponsoredCard` is the only renderer and always
  contains the label; banned-phrase guards in both directions; the RPC signature has no profile/behavior params.
- Live rolled-back verification scripts (repo convention): serving predicate for every status/payment combination
  (unknown = not served), non-owner cannot write or read others, client cannot set paid, capacity, radius/category
  match, expiry, refund state, hide, anon grants.
- Webhook tests with the real handler and stubbed deps (bad signature, duplicate, out-of-order).
- Confirm organic RPC outputs are identical with and without an active spotlight (proves rule 3).
- Full from-scratch replay, and disclose device/browser testing status plainly.

## 14. Phasing
0. Approval audit table + approver permissions (prerequisite, already owed).
1. Schema + serving RPC + `SponsoredCard` + guards, no payments (admin-created test placements, test data only).
2. Stripe test-mode checkout + webhook + business Promotions screen.
3. Reporting + refunds/admin actions.
4. Live enablement, only via the checkpoint approvals.

## 15. Decisions (LOCKED for v1, 2026-09-20)
$25 per slot-week; max 1 impression per person per business per 7 days (keyed on the business); 10-mile delivery
radius; 1 sponsored placement per category per local area; no auctions/bidding/paid ranking; regulated/high-risk
categories excluded; "Show sponsored places" ON by default with a consumer off switch; refund terms as in section 8;
v1 surface = Perks/Places browse only; legal review before live payments. Confirmed by the owner:
1. **Per-person exposure table (`sponsored_seen`): APPROVED.** Enforces the cap across devices and reinstalls. Purged
   after 7 days. **No device-local fallback.** Used only for sponsored-frequency enforcement (section 17).
2. **`profiles.show_sponsored_places`: APPROVED.** Used only to suppress sponsored cards; never affects organic content,
   matching, routing, ranking or recommendations.
3. **"Category" = the 19 top-level category groups.** Subcategories/leaf tags are not separate sponsored inventory in v1.
4. **"Area" = the roughly 10-mile inventory grid**, used only for slot allocation. Delivery radius stays 10 miles
   (great-circle from the business). The grid and any consumer location are never exposed to businesses.
The category allow-list (section 3) stays EMPTY until the legal/policy review; the owner adds groups after it.

## 16. Live-payment launch gate (advertising-disclosure / legal review)
Live payments stay blocked (Stripe test mode, `STRIPE_LIVE_APPROVED` unset) until ALL of these are recorded done:
1. **Advertising-disclosure review by qualified counsel** (not done, not something engineering can certify). Questions
   to hand over: whether the "Sponsored" pill plus "Sponsored · {Business}" line is clear and conspicuous enough for the
   markets served; wording of the "Why am I seeing this?" text; disclosure in accessibility labels and screenshots;
   any state/country rules on paid placements and on the category allow-list.
2. Category/advertising policy for the allow-list, and the business-facing terms accepted at purchase (what is and is not
   promised, refund terms above, prohibited content).
3. Stripe account/terms and restricted-business checks for selling ad placements; sales-tax treatment of the fee;
   app-store treatment of selling promotion through the web dashboard.
4. The existing approval checkpoints and audit table (section 5 and CLAUDE.md "Stripe approval AUTHORITY"), including
   checkpoint 6 by the platform owner/admin.
Engineering can build and test everything in test mode ahead of this; nothing live turns on by default.

## 17. Cap counting behavior and retention/privacy safeguards
**How the 7-day cap counts (exact rules):**
1. Unit = one row per (person, business) in `sponsored_seen` with the time it was last served. Not per placement, per
   category, per surface or per device, so a business cannot exceed the cap by holding several placements or by the
   person switching devices/reinstalling.
2. An "impression" is counted when the server returns the card, not when it is scrolled into view (the server cannot
   see the screen; this is deliberately conservative: it may count a card the person never looked at, never fewer).
3. The window is rolling: a business may be served to a person again only when the last served time is 7 days or more
   in the past. The check and the write are ONE atomic statement (insert-or-update-only-if-expired), so two
   simultaneous requests cannot both serve.
4. A request that returns nothing, errors, or is blocked (switch off, hidden, out of range, capped, category mismatch)
   writes NO `sponsored_seen` row. When the top candidate is capped the next eligible business is tried (still at most
   one card).
5. A repeat call inside the same session does not re-serve: the client keeps the card it already received for that
   screen state, so scrolling, tab switches and re-renders do not consume more exposure or hide the card.
6. Taps never reset or extend the cap. Hiding a sponsor does not write the exposure table.
7. Only the sponsored product's own daily aggregate (`sponsored_daily_stats.impressions`) is incremented, and only when a
   card is actually served.
**Retention and privacy safeguards:**
- `sponsored_seen` rows older than 7 days are deleted by a daily cron, and the serving function ignores anything older
  than 7 days regardless of whether the purge has run. Rows also cascade-delete with the account.
- The table holds only user id, business id and one timestamp: no location, no category, no device id, no surface, no
  count history. Consumer coordinates are never stored anywhere in this feature.
- No grants and no RLS policies for anon or authenticated: not readable or writable by clients, and not readable by
  any organic function, RPC, analytics or recommendation code (Jest guard scans them). Businesses never receive it in
  any form, including aggregated by person; their reporting comes only from `sponsored_daily_stats`.
- `sponsored_hidden` (the person's own choices) is kept until the person removes it or deletes the account; Settings
  gets "Reset hidden sponsors". "Clear my activity history" does NOT clear `sponsored_seen` (it would reset the cap and
  the rows expire within 7 days anyway), and this is stated in the Settings text.
- `show_sponsored_places` is read only by the serving function to suppress; turning it off writes nothing to the
  exposure table and returns no card.
- Any data export or account-deletion routine must include/cascade these person-linked rows.
