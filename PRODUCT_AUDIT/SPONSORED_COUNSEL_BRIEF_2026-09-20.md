# Sponsored placement: brief for advertising-disclosure / legal review

Not legal advice and not certified by engineering. This packages what counsel needs; the launch gate (design section 16)
stays closed until they respond. Product: local businesses pay Nearby $25 per 7-day "spotlight" shown in Discover's Places
and Perks browse tabs to people within 10 miles, always labeled "Sponsored".

## What the consumer sees (please review wording)
- Pill "Sponsored" (constant in the component, cannot be omitted) + line "Sponsored · {Business}", plain "View" button.
- "Why am I seeing this?": "{Business} paid to be shown to people browsing {category} near {area}. It isn't based on your activity."
- Controls: Hide this sponsor, Report this ad, Settings switch "Show sponsored places" (default on), Reset hidden sponsors.
- Accessibility label starts "Sponsored:". Never inside offers, "Our pick", or any recommendation reason.
- Targeting: business location + fixed 10-mile radius + the category the person is browsing. No profile/behavior inputs.
- Frequency: max 1 exposure per person per business per rolling 7 days (a private table with user, business, timestamp; purged after 7 days).

## Questions
1. Is "Sponsored" pill + "Sponsored · {Business}" clear and conspicuous for the markets served (US first)? Anything to change?
2. Is the "Why am I seeing this?" wording adequate and accurate (no personalization is used)?
3. Any rules on paid placements in a dating/social app, on the category allow-list (currently empty; food/drink first), or on age/vulnerable-audience restrictions?
4. Business-facing terms at purchase (not yet written): price, 7 days, no auto-renew, full refund before start, no refund for elapsed days, prorated refund when Nearby materially fails to deliver (>24h cumulative), no impression guarantee, prohibited content (text is auto-screened before payment). Please draft or review.
5. Selling promotion via the web dashboard vs app-store rules for a consumer app that displays it.
6. Sales-tax treatment of the fee; Stripe restricted-business rules for selling ad placements; refund/dispute handling.
7. Privacy: is the exposure-cap table (user id, business id, timestamp, 7-day retention) adequately disclosed in the privacy policy? (Settings text exists; the policy itself is not updated.)

## Facts for counsel
Payments: Stripe-hosted Checkout, Nearby is merchant, no card data touches Nearby. Refunds only by a named finance approver, audited.
Reference: `PRODUCT_AUDIT/SPONSORED_PLACEMENT_DESIGN_2026-09-20.md` (sections 5-9, 16, 17). Currently served in production: nothing.
