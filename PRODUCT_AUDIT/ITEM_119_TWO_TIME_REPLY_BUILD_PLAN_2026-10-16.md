# Item 119: two time options in one business reply - BUILD PLAN (2026-10-16) - APPROVED AND BUILT (migration 20270311, LIVE)

Status: owner reopened item 119 and approved this plan (2026-10-16). BUILT and LIVE (migration 20270311, screen-business-content
redeployed, journey `offer` 38/38). NOT device-verified: section 9 of `OFFER_EXPERIENCE_DEVICE_CHECKLIST_2026-10-10.md`.
Decision 1 below was REVISED by the owner during the build (see "Owner decisions"): two times everywhere, groups included.

## What it does

A business answering a request may offer up to TWO times in its one reply, both for the request's full party. The customer sees
ONE offer card with both times, taps one, and "I'll take this one" books that time. Everything else about the reply (price,
what's included, validity, media, logo) is shared by both times.

## How things work today (read from the code, 2026-10-16)

- One reply per business per request: `business_request_offers_unique_partner` (request_id, partner_id), since 20260814.
- A reply has one `proposed_time` (Make an Offer, or the quick "Offer Alternative" path in `utils/quickOfferResponse.js`) and/or an
  `available_from`/`available_until` window. Business replies go through `screen-business-content` -> `submit_business_offer`.
- Capacity (item 116) exists only for replies tied to a posted availability (`availability_id`, the automatic replies).
  `_take_availability_capacity` takes the whole party or refuses, atomically. A reply the owner writes by hand has
  `availability_id` null: no capacity row exists, so the owner's reply IS the declaration that they can seat the party.
- Accept: `accept_business_offer(offer_id)` (customer) and `_accept_business_offer_internal` via `confirm_group_plan_offer`
  (group plans). 12 non-test source files read `proposed_time` (card, plan, reservation, merge, countdown...).

## Design

1. **Data (one migration).** Add `business_request_offers.proposed_time_alt timestamptz null`: the second time. Checks:
   it requires `proposed_time`, differs from it, and is in the future when written. Two times are the structural maximum (no
   options table, so "max two" can't drift). Unique-per-business stays: still one reply.
2. **Submitting.** `submit_business_offer` gains `proposed_time_alt_param` (drop the old signature in the same migration, no
   second overload; revoke from public/anon). Allowed only on a reply the owner writes (never on automatic availability replies,
   which stay one time). Party size is never a field: both times are for the request's party.
3. **Accepting.** `accept_business_offer` gains `chosen_time_param timestamptz default null` (old signature dropped). Rules, all
   server side, in the same locked transaction as today:
   - a reply with two times REQUIRES a choice, and the choice must equal one of the two times exactly, else refuse;
   - the chosen time must still be in the future; the existing open/offered/valid checks stay;
   - the chosen time is written into `proposed_time` and `proposed_time_alt` is cleared, so after acceptance the offer has ONE
     time and every existing reader (plan, reservation, merge, countdown, calendar) needs no change;
   - capacity: unchanged item 116 path. If a time is ever tied to a posted availability, that availability is the one held
     (the "exact slot" rule); in this build no two-time reply has one, so there is no slot to check beyond the owner's reply.
4. **Business form.** Make an Offer and "Offer Alternative" get "Add another time" (one extra picker, max one). The live Customer
   Preview (item 49) shows both times through `offerDraftPreview.js`.
5. **Customer card.** `presentOffer()` exposes `times` (1 or 2); `OfferCustomerBody` shows the two times as selectable rows in
   the same card (coral = selected). "I'll take this one" stays the only button; with two times it is enabled only after one is
   picked. No new screen, no chat, no history, no animation (selection is an instant state change).
6. **Ranking and wording (item 63).** `replyTimeFit` checks each time; the reply qualifies when either time fits the stated time.
   "Fits 7 PM" shows only next to the time that actually matches. Price never weighs.
7. **Notifications (item 62).** Unchanged: still one reply, so one push, worded from the reply as today.

## Not included (locked)

Partial-party times, more than two times, customer counter-proposals or "Request changes" (item 118), a second card, any chat
or history, any new motion, two-time automatic replies, different prices per time.

## Verification

- Journey `offer` extended: two-time submit; accept without a choice refused; accept with a time not offered refused; accept the
  second time -> `proposed_time` = that time, `proposed_time_alt` null, reservation created, other replies expired; single-time
  replies unchanged; automatic replies refuse a second time.
- Jest: `offerPresentationEngine`, `offerDraftPreview`, `replyFit` (Fits on the matching time only), the customer card's
  selection rule; guards `businessPayloadPrivacyGuard`, `undefinedNames`, overload check.
- Rolled-back live check, then apply; from-scratch replay; business web export regenerated.
- Device: added to the offer experience checklist (needs Anthropic credit for screening). Not device-verified until then.

## New strings (native review needed, 11 languages)

"Add another time" (business form), "Pick a time" (customer card hint above the two times), one a11y label for a time row.

## Open decisions for the owner

1. **Group plans:** recommended to keep group/occasion requests to ONE time in this build (the group vote would need its own
   rule for who picks the time). Two times only on one person's request.
2. **The quick "Offer Alternative" path:** recommended yes (it is exactly the "6 at 8:30 instead" case), plus Make an Offer.
3. **Approve the three new strings** above (wording can change).

## Owner decisions (2026-10-16)

1. **Group plans: two times everywhere (REVISED, LOCKED).** The first answer was "one time for groups", but hiding the option or
   refusing it on a group request would tell the business the request is a group plan (business-privacy rule). Owner chose: every
   eligible reply may carry two times, groups included; no plan kind, party type or group flag in business-facing data; each
   participant confirms the offer AND a time (`group_plan_offer_confirmations.chosen_time`, visible only to that group's
   participants, the existing policy); it books only when everyone chose the SAME time; a split stays pending and Nearby never picks;
   automatic replies stay one time. Options "accept the leak" and "drop the second time silently" REJECTED.
   Safeguard checked before building: the existing confirmation table already holds one row per participant per offer and is
   readable only by the group, so one nullable column + a same-time count covers it with no new visibility.
2. **Quick "Offer Alternative": yes**, plus Make an Offer.
3. **Strings approved as written** ("Add another time", "Pick a time", "Choose {time}"); 10 languages machine-authored, native
   review pending.

