# Item 119b: a second time for fewer people (owner, 2026-10-16)

Owner reopened item 119's partial-party lock ("open the lock to build it") for the case
"6 people tonight -> We can accommodate 4 at 7 PM or 6 at 8:30 PM".

## Owner decisions (LOCKED)

1. A smaller-party time is only ever the SECOND option beside a whole-party first time, never the only one
   (enforced by the database and the forms).
2. Group plans never see it: participants confirm only the whole-party time; the server refuses the smaller one.
   The business is never told the request was a group.

Unchanged: item 94 (party size end to end) for every whole-party time; item 116 (automatic replies, the only ones holding
availability capacity, can't carry a second time); item 118 (a revision moves times, never the headcount); item 63 (a smaller
time never counts as fitting the stated time).

## As built (NOT deployed)

- Migration `20270313_smaller_party_time.sql`:
  - `business_request_offers.proposed_party_size_alt` (the second time's headcount; null = whole party; only beside a second
    time) and `proposed_party_size` (headcount booked, written at acceptance only when the smaller time was taken).
  - Trigger `_offer_party_size_fits_request`: fewer than the request's party, and only when the request stated 2+.
  - `submit_business_offer` + `proposed_party_size_alt_param` (old signature dropped, one overload, public/anon revoked);
    `admin_review_business_content_screening` carries it from a held reply; `accept_business_offer` /
    `_accept_business_offer_internal` write `proposed_party_size`; `confirm_group_plan_offer` refuses the smaller time;
    `get_business_opportunities` and `get_partner_offer_value` read the booked headcount.
- Edge function `screen-business-content`: passes the headcount through (NOT deployed).
- Client: `utils/offerTimes.js` (`timePartySize`, `wholePartyView`, applied once in `getBusinessRequestWithOffers` so every
  reader of a group gets the whole-party view), `replyFit.js`, `acceptedBooking.js`, `offerDraftPreview.js`,
  `planAddonReadiness.js`, `OfferCustomerBody` ("For {count} of your {total}"), `components/SecondTimePartySize.js`
  (business: "For fewer people" stepper on the second time in Make an Offer and Offer Alternative), `ReviseOfferSheet` preview.
- New strings (6, machine-authored in 10 languages, native review pending): `ui.bizDash3.forFewerPeople` / `secondTimeFor` /
  `onePersonFewerA11y` / `onePersonMoreA11y`, `ui.requestDetail.forCountOfYour` / `forCountPeople`.

## Verified

- Jest 449 suites, 6016 passed (incl. `smallerPartyTime.test.js`).
- Journeys on production, migration as prelude, rolled back: 33 suites 373/373; `offer` incl. 8 new item-119b steps
  (rules, direct-write bypass refused, customer card, smaller-time booking = 4 in booking/business view/offer value, whole-party
  booking, revision keeps headcount, group never sees/takes the smaller time). Production confirmed unchanged afterwards.
- Business web export regenerated.

NOT verified: from-scratch replay, any screen on a device, the business website in a browser. Deployment needs owner approval.
