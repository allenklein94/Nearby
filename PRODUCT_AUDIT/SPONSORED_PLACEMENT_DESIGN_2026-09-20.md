# Sponsored Placement — Paid Product Design (PROPOSAL, nothing built)

Status: proposal for owner approval. Companion to CLAUDE.md item 44 (locked rule). No code, migration or Stripe
change exists for this. Numbers marked **[OWNER]** are deliberately not invented here.

## 0. Locked rules this design must satisfy
1. Personalized response = organic, request-driven, never labeled an ad, keeps "made you an offer".
2. Sponsored = paid reach nobody asked for, always visibly "Sponsored", never inside a request's offers list, never
   organic language ("made you an offer", "Our pick", "Why this matches").
3. Sponsorship never touches routing, matching, ranking, offer order or organic recommendations. Own slot.
4. Paid status comes only from the platform's payment/placement records. Unknown = not displayed.
5. A creative may be reused; the placement carries the disclosure.
6. Sponsored impressions/taps never enter organic demand, matching signals or the feedback loop.

## 1. Smallest viable product: "Sponsored Spotlight"
**What a business buys:** one fixed-duration (7 days) spotlight of ONE of its own existing standing items (a Brand
Offer / perk, or its business card) in ONE sponsored slot, for ONE geographic area. Flat prepaid price per slot-week
**[OWNER]**. Not an auction, not pay-per-click, not pay-per-impression.

**Why flat and prepaid:** no bidding means no ranking pressure; no per-click billing means no incentive to fake taps
(impressions/taps are client-reported and therefore informational only); no auto-renew means no surprise charges.

**Not in v1:** targeting people, conversion attribution, push notifications, chat, request offers, Home, intent
results, Surprise, Celebrate, plans, or auto-renewal.

## 2. Placement surface and frequency
- **One surface:** Discover's Perks/Places browse lists (the "Explore" surface, rule 5). One slot per screen view, fixed
  position (a separate card above the organic list), never interleaved, never replaces or reorders an organic row.
- If the same business also appears organically, both show (separate); organic position is unchanged.
- **Frequency caps:** max 1 sponsored card per screen view; the same spotlight shown to a person at most **[OWNER: N]**
  times/day. The cap is **device-local**, so the server never stores who saw what. The server stores only aggregate
  daily counts.
- Slot capacity: max 1 active spotlight per (area cell x category group) at a time **[OWNER: confirm]**; first-come;
  a full slot cannot be purchased (checked at purchase, re-checked at payment confirmation).

## 3. Eligibility
- Active, approved business with a geocoded address (same requirement as request routing).
- The promoted item is a real, currently valid standing item of that business (server verifies ownership; never free text).
- Creative and text pass the existing `screen-business-content` screening at tier low, as a NEW purpose value
  (`sponsored_spotlight`); outage = fail closed (503, nothing published), same as offers.
- Category exclusions **[OWNER]** (suggest: alcohol/gambling/adult/health-claims excluded from v1).
- Business in good standing (no open admin hold, no unresolved chargeback).

## 4. Targeting: what can and cannot be used
**Allowed (contextual only):** (a) the viewer's coarse position at request time, matched against the spotlight's area
(business address + a radius up to a max **[OWNER]**); passed transiently to the RPC like existing search RPCs, not
logged; (b) the browse category the viewer themselves opened.
**Forbidden, enforced by the RPC signature (it does not accept these):** interests, `interest_groups`, onboarding
answers/goals, `behavior_events`, request/intent/search history, occasions, relationships, friends/matches, age,
gender, any profile field, dating/friends mode, Interested state. Businesses never choose or see people.
**Location/category/radius:** a spotlight is returned only if the viewer is within its radius AND its category group
equals the group of the list being browsed (`category_tag_groups`). Payment never extends the radius; a bigger radius
is not a v1 option.

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
- `sponsored_placements`: id, partner_id, item kind + item id, area cell + radius, category group, starts_at, ends_at,
  status, creative snapshot (screened text/media path), screening tier, created_by.
- `sponsored_payments`: placement_id, stripe ids, amount_cents, currency, status (pending/paid/failed/refunded/
  disputed), refunded_cents, paid_at. Written only by the webhook/admin RPC.
- `sponsored_daily_stats`: placement_id, day, impressions, taps. Aggregate only, no user ids.
- `sponsored_hidden`: user_id, partner_id (the person's own "hide this sponsor" choice; owner-only RLS; read by no
  organic function).
- RLS: owner reads own placements/payments/stats; no client writes; all writes via SECURITY DEFINER RPCs; anon revoked.
- **State list (rule 1):** draft -> awaiting_payment -> scheduled (paid, future) -> active -> completed; side states
  payment_failed, expired_unpaid (awaiting_payment > 24 h, swept), cancelled, refunded, rejected (screening),
  paused (admin / dispute).
- **Serving predicate (one function, fail closed):** status in (scheduled, active) AND now in [starts_at, ends_at)
  AND payment status = paid AND screening ok AND business active AND eligibility still true. Anything else, including
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
- Prepaid, fixed 7 days, no auto-renew; renewal is a new purchase. A slot is held during checkout only (24 h).
- Cancel before starts_at: full refund. After start: no refund for elapsed time.
- If Nearby cannot deliver (admin pause, screening reject after start, outage): prorated refund of undelivered days,
  initiated by Nearby.
- Payment failed / expired_unpaid: never served. Dispute or chargeback webhook -> `paused` immediately, fail closed.
- Expiry swept by cron (like `expire_stale_business_requests`); the serving predicate also checks `ends_at`, so a missed
  sweep never over-serves.

## 9. Reporting (business-facing)
Own placements only: days remaining, impressions, taps, tap rate, amount paid. No identities and no distinct-people
figures (they would need per-user data we deliberately do not keep). Shown only in Promotions; never in Home,
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
"Hide this sponsor" (per business, saved in `sponsored_hidden`), "Report this ad" (existing report flow), and
**[OWNER]** a Settings switch "Show sponsored places" (recommended: available, default on).

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

## 15. Decisions needed from the owner
Price per slot-week; frequency cap N; max radius; slot capacity per area x category; excluded categories; Settings
"show sponsored" default; refund policy in section 8; confirm the single Perks/Places browse surface for v1.
Also worth a legal check (not done here): ad-disclosure wording requirements and any app-store treatment of selling
promotion through the web dashboard.
