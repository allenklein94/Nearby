# Item 118: one business revision of a sent offer (price and time only) - BUILD PLAN (2026-10-16) - APPROVED AND BUILT, NOT DEPLOYED

Status: owner approved this plan with all five recommendations (2026-10-16). BUILT, migration `20270312_offer_revision.sql`
(NOT applied to production: deployment is a separate owner approval; the `send-push` edge function change ships with it). Verified
on a from-scratch replay and in rolled-back transactions on production. NOT device-verified: section 10 of
`OFFER_EXPERIENCE_DEVICE_CHECKLIST_2026-10-10.md`; native review of the new strings pending. See "As built" at the end.

## What it does

A business that already sent an offer may change its PRICE and/or TIME once, while the offer is still open and before the customer
acts. The customer's existing card updates in place to the current terms. Acceptance books exactly the terms the customer saw.

## Owner scope (LOCKED, 2026-10-16)

- One revision per offer, started only by the business that sent it, while the offer is open and before the customer acts.
- Changeable: price and proposed time only. Description, title, included items, package, media, redemption instructions, validity
  and the available window stay exactly as sent. No customer "Request changes", no counter-offers.
- One card, updated in place: no second card, chat, thread or history.
- Current price only: no "was $60", no strikethrough, no savings claim.
- Acceptance revalidates the full party and the exact chosen time (item 116 / item 119 rules unchanged).
- Calm: no business-responds signature, no urgency, no new motion beyond an instant state change.
- Item 119's two times stay their own capability; the revision may change one or both times under item 119's rules.

## How things work today (read from the code, 2026-10-16)

- One row per business per request in `business_request_offers` (status `pending` -> `offered` -> `accepted`/`expired`/...).
  A sent offer is never changed: `submit_business_offer` refuses anything that is not `pending` ("You have already responded").
- Price fields: `offer_price` (+ `price_is_per_person`), `discount_pct` (capped by `business_request_offers_enforce_discount_cap`,
  the business's `max_discount_pct`). Time fields: `proposed_time`, `proposed_time_alt` (item 119), plus the
  `available_from`/`available_until` window (not in scope).
- Business text and media pass AI screening (`screen-business-content`). A price/time-only revision carries no text or media, so
  it needs no screening and works while Anthropic credit is unavailable.
- Accepting: `accept_business_offer` reads the offer WITHOUT a lock, then locks the request. `_accept_business_offer_internal`
  (group plans) locks offer then request. `confirm_group_plan_offer` locks the proposal, then the offer, then writes one
  `group_plan_offer_confirmations` row per participant (with `chosen_time`, item 119).
- **Race found while reading:** because `accept_business_offer` reads the offer before taking any lock, an accept that starts
  while a revision is committing would book with the price it read before the revision. Today nothing changes a sent offer, so it
  is harmless; with revisions it is not. The plan fixes it (step 3).
- History: `business_request_offers_lifecycle_history` records status changes only; a revision changes no status.

## Design

1. **Data (one migration).** `business_request_offers.revision smallint not null default 0 check (revision between 0 and 1)`
   (one revision is the structural maximum) and `revised_at timestamptz`. Automatic replies (`availability_id` / `package_id` /
   `auto_reply` not null) are never revised: their price and slot come from what the business posted; the business changes that
   instead (check constraint, like item 119's).
2. **Revising: `revise_business_offer(offer_id, offer_price, discount_pct, proposed_time, proposed_time_alt)`** (new; revoke from
   public/anon). Locks the offer, then the request (the internal accept's order, so the two serialize). Refuses unless: the caller
   manages the offer's business; offer `offered`; request `open` and not past `expires_at`; `valid_until` not passed; `revision = 0`;
   something actually changed. Price basis (`price_is_per_person`) and offer type stay as sent. Times follow item 119's checks
   (both ahead, different, alt only with a first); the discount cap trigger still applies. Writes the new values, `revision = 1`,
   `revised_at = now()`, a `business_lifecycle_events` row (kind 'revised', no status change), and an event `BUSINESS_OFFER_REVISED`.
   Group confirmations of that offer are handled per decision 2.
3. **Accepting what the customer saw.** `accept_business_offer`, `_accept_business_offer_internal` and `confirm_group_plan_offer`
   gain `seen_revision_param smallint` (old signatures dropped, no second overload). If it differs from the offer's `revision`:
   refuse "This offer just changed. Check the new terms." `accept_business_offer` is reordered to lock the request and then
   re-read the offer `for update` before any check, closing the race above. Capacity, chosen time, payment amount: unchanged
   paths, now reading the locked current row.
4. **Business side.** On the business's own sent offer (Opportunities / the request detail), while `offered` and `revision = 0`:
   one "Change price or time" action opening a sheet with only the price field(s) and the time picker(s), reusing Make an
   Offer's controls and the live Customer Preview (item 49, `offerDraftPreview.js`). After sending: "Your updated offer is on its
   way". Once used, the action disappears with a plain line "You've already changed this offer once." The business learns
   nothing new about the customer (privacy boundary unchanged; no "viewed", no group flag).
5. **Customer card.** `presentOffer()` reads the current row as today; it gains only `revised` (per decision 4). No old value is
   ever passed to the card. The card re-renders in place on the realtime update; a selected time that no longer exists is
   cleared. `rankReplies` (item 63) re-ranks on current terms ("Within your budget" may now appear: true by construction).
6. **Telling the customer (decision 3).** Through `_send_push` with the request's existing collapse key (`offers:<request id>`),
   so it replaces the one reply notification in place (item 62), never a second notification.
7. **Motion.** None (item 101 spec answered: the card's text changes instantly; it reads fully without animation; Reduce Motion
   identical). Never the signature, never a countdown or pulse.

## Not included (locked)

Changing anything but price/time; a second revision; customer counter-proposals; revising automatic replies; showing a previous
price, a difference or "lower price"; a revision feed, history view or chat; new motion; any change to item 116 capacity or
item 119's same-time group rule.

## Verification

- Journey `offer` extended: revise price -> card terms current, `revision` 1; second revision refused; revision after accept /
  decline / expiry refused; revision of an automatic reply refused; revision by another business refused; accept with the old
  `seen_revision` refused, with the new one books the revised price (payment amount = revised price); revision to two times then
  accept requires a pick; discount cap enforced on revision; group: confirmations handled per decision 2, booking still needs
  everyone on the same time.
- Concurrency (live, like item 116's check): revision and accept started together -> exactly one wins; the booking never carries
  a price the accepter did not see.
- Jest: `offerPresentationEngine` (`revised`, no old value anywhere in its output), `offerDraftPreview`, `replyFit`, the
  card's cleared-selection rule; guards `businessPayloadPrivacyGuard`, `undefinedNames`, overload check, `motionMeaning`.
- Rolled-back live check, then apply (deployment gated separately, as before); from-scratch replay; business web export
  regenerated; device checks added to the offer experience checklist (needs Anthropic credit only for the ORIGINAL offer's
  screening). NOT device-verified until then.

## New strings (native review needed, 11 languages)

"Change price or time", "You can change this offer once.", "You've already changed this offer once.", "Your updated offer is on
its way", "This offer just changed. Check the new terms.", plus per decisions 3-4: push body "{business} updated their offer" and
the card word "Updated".

## Open decisions for the owner

1. **Which way may the price move?** Recommended: **down or unchanged only** (lower `offer_price`, or a higher `discount_pct`).
   Raising the price after the customer has seen it reads as bait-and-switch, and the item's purpose is winning a request that
   was slightly over budget. Time may change either way. Alternative: any direction (still safe because of step 3's check).
2. **Group plans when some participants already confirmed.** Refusing the revision would tell the business the request is a
   group (a single person's request has no "partly confirmed" state), which breaks the business-privacy rule, the same conflict
   item 119 resolved. Recommended: **the revision is allowed and clears that offer's confirmations; each participant confirms the
   current terms again** (they see the updated card; nothing books on old terms). Alternative: allow it only before anyone has
   confirmed, accepting the leak (not recommended).
3. **Tell the customer?** Recommended: **yes, one replacement in the existing per-request notification**: "{business} updated
   their offer" (new string; at most once per offer by structure; mute group and priority as the reply push). Alternative: no
   push; the card just shows the current terms when opened.
4. **Mark the card "Updated"?** Recommended: **yes, one quiet word beside the price/time line** (a true fact, no old value, so a
   customer who saw the first terms knows to look again). Alternative: nothing; only current terms.
5. **Approve the new strings** above (wording can change).

## Owner decisions (2026-10-16, all five recommendations approved)

1. Price only down or unchanged (a bigger discount counts); never up. Time earlier or later.
2. Group plans: the revision is allowed, clears every confirmation, and everyone confirms the revised terms; the business is
   never told whether anyone had confirmed. Prior consent is never kept.
3. One calm notification "{business} updated their offer", replacing the request's existing notification in place.
4. "Updated" on the existing card; never the previous price or a saving.
5. One revision per offer enforced by the database and server; automatic replies can't be revised; no text or media, no screening.

## As built (2026-10-16)

- Migration `20270312_offer_revision.sql`: `revision` (0/1, check) + `revised_at`; the check also forbids a revision on an automatic
  reply. `revise_business_offer(offer, price, discount, time, time_alt)` (authenticated): locks offer then request; refuses a closed
  offer/request, an expired offer, an automatic reply, a second revision, a higher price, a smaller discount, a discount over the cap
  (checked here because the cap trigger skips already-offered rows), adding a price/discount/time the reply never had, a different
  number of times, a past or duplicate time, and no change. Deletes the offer's group confirmations; emits `BUSINESS_OFFER_REVISED`
  (added to the `domain_events` CHECK and `DOMAIN_EVENTS`). `_on_business_offer_revised`: the requester gets
  `business_offer_revised` with the request's collapse key; each other person whose confirmation was cleared gets the group variant
  (`proposal_id`, opens GroupPlan). `_push_outbox_deliver` drops a revised push whose offer is no longer open at hand-off.
  `accept_business_offer` + `confirm_group_plan_offer` take `seen_revision_param` (null = 0); `accept_business_offer` now locks the
  offer row first (it used to read it unlocked). `get_business_opportunities` returns the business's own offer fields the sheet
  needs (title, items, discount, validity, window, auto_reply, revision). Old signatures dropped; one overload each.
- Changes from the plan: the revision is audited in `domain_events` (not `business_lifecycle_events`, which records status changes
  only); the number of times stays the same (a one-time reply's wording "this time" stays true); a price, discount or time is
  changeable only where the reply already had it; two extra hint strings (price only lower, discount only bigger).
- Client: `utils/offerRevision.js` (the one client rule), `components/ReviseOfferSheet.js` (dashboard Opportunities), `presentOffer().updated`
  -> `OfferCustomerBody` "Updated" (+ GroupPlanScreen), accept/confirm send the seen revision, "This offer just changed" re-reads
  the card. Push type `business_offer_revised`: medium, `view_offer`, `business_offers` mute group, destination request/group plan.
- Known residual: the reply's free-text description is the business's own words and can't change in a revision; if it states a
  price ("$60 per person") it will contradict the new price. The sheet's preview shows the description so the business sees it.
