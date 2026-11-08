# Account deletion: what refused it, what it destroyed, what changed (2026-11-08)

**Status: 20270405 BUILT + LOCALLY VERIFIED, STAGED on `post-tier1/account-deletion-blockers` (stacked on 0404's branch). NOT merged, NOT deployed, NOT legally reviewed, not in build 87.** Own deploy approval, after 0404. `delete-account` itself is unchanged.

## How the audit was done

`scripts/replay/account-deletion-sweep.js`: for every foreign key whose parent is the account or a row its deletion cascades to, it makes one row, then runs the real deletion with every trigger and key on. A list of key types can't see a guard refusing the `SET NULL` a deletion causes, or a key that never fires because the cascade removed the row first, so the audit tries each one. Baseline on the stack through 0404: 266 relationships tried, 247 fine, 14 blocked, 5 refused (one of the 5 was the test's own fixture, see below).

## What refused a deletion

| Relationship | Who hits it | Decision |
|---|---|---|
| `group_plan_proposals.initiator_id`, `.resulting_request_id` | anyone who started a group plan | see group plans |
| `group_plan_participants.user_id`, `.source_request_id` | anyone ever in a group plan | see group plans |
| `group_plan_offer_confirmations.user_id`, `.offer_id` | anyone who confirmed a group offer | see group plans |
| `business_requests.group_plan_id`, `.superseded_by_group_plan_id`; `occasion_group_plans.winning_option_id` | reached through the above | clear the reference |
| `business_offer_submissions.submitted_by`, `business_content_screening_results.submitted_by` + `.reviewed_by` | a business owner or reviewer | record stays, id cleared |
| `business_customer_notes.updated_by`, `business_partner_requests.reviewed_by`, `plan_organizers.added_by`, `offer_redemptions.confirmed_by` | owner, admin, organizer | record stays, id cleared |
| `business_payments.payer_id` | a customer | see payments |
| **New: `account_restrictions.admin_id` / `.lifted_by` / `.review_case_id`** | **an admin who ever paused someone** (a guard refused the `SET NULL`) | guard allows clearing a reference to something already gone; a pause stays lift-only |
| **New: `sponsored_terms_acceptances.user_id`** | **anyone who accepted sponsored terms** (immutable guard) | guard allows clearing the id once that person is gone; partner, placement, version, time stay |

`brand_offers.unlock_community_id` showed as refused in the first sweep: that was the fixture's shape, not a defect. With a shape the app can make, 0394's gate-removed rule handles it. The sweep now builds that shape.

## What a deletion destroyed without refusing

- **A customer's payment record.** Request -> offer -> reservation -> payment all cascade, and a no-action key is checked at the end of the statement, so when the cascade reached the payment too, nothing refused and a captured payment disappeared. Now: a payment with money behind it (a Stripe id, or authorized / captured / refunded) outlives the reservation. Its person, reservation and failure text are cleared; its amount, status, Stripe ids, fee and business stay. Nobody can read it through the API (the read rules go through the reservation). A late Stripe webhook still lands, since it matches on the payment intent. A row with nothing behind it goes, as before.
- **Confirmed perk redemptions.** Not yet invoiced ones vanished with the customer, so the month's invoice would have counted fewer than the business really redeemed. Now a confirmed or invoiced redemption stays without its person; an unconfirmed claim goes.
- **A group plan's booking**, for everyone else in it, when its organizer left.

## Group plans

Same rules as leaving, plus what leaving never had to handle because an organizer can't leave:

- **Someone else's plan:** the person's row and confirmations go, the plan goes on (`leave_group_plan`'s behaviour).
- **Their plan, confirmed, someone else accepted:** the plan, its shared request and its plan row pass to the earliest to accept, who gets one push. The offers, the booking and the business's booking stay. The request stops carrying the person's location (takes the new organizer's) and their dietary needs (recomputed from who's left).
- **Their plan otherwise:** it ends, as the organizer's cancel would; everyone's own request is untouched. A pending one records a cancellation with no person on it.
- Two people leaving one plan at once take turns on a lock; a plan never passes to someone already leaving. **The race test found both a failure and a deadlock here before they were fixed.**

## Decisions for the owner

1. **Passing a plan to the earliest to accept** assigns a role nobody asked for. The alternative is ending the plan, which cancels a real booking for people who did nothing. I chose passing it; tell me if you'd rather not.
2. **Party size stays as booked** when someone leaves a plan, same as `leave_group_plan` today: the business may hold a seat for someone who's gone.
3. **A customer's business history shrinks when they delete.** Their request, offer and reservation go as they always have, so a business's bookings list and "Value of offers redeemed" can fall for a past month. Not a tax record, but the owner should know. Unchanged.
4. **An ended plan sends no push**, same as an organizer's cancel today.

## Questions for counsel

1. **How long are kept payment rows kept?** Nothing purges them today (`detached_at` records when they lost their person). Tax retention periods vary by jurisdiction.
2. Are the Stripe ids on a kept row acceptable? They're what makes a late refund or dispute work, but Stripe can tie them to a person on its side.
3. **An authorized or pending charge when the customer deletes:** nothing voids or refunds it. **Decide before Stripe goes live** (test mode only today).
4. A terms acceptance keeps which business, placement, version and when, but no longer who. Is that enough proof?
5. The published Privacy Policy section 5 doesn't list financial records among what's kept. Draft sentence, NOT published: "We keep records of payments made through Nearby, without your account reference, for as long as tax and financial law requires."

## Not changed, for a decision

Columns naming an account with no foreign key, so a deletion doesn't touch them (schema listing, not individually traced): `push_outbox.recipient_id` (with the notification's text), `domain_event_notifications.recipient_id`, `domain_events.actor_id`, `business_visit_no_shows.marked_by`, `private.link_check_usage.user_id`. These don't block a deletion but do leave the old id, and possibly words, behind. The deliberately kept security records (`account_recovery_*`, `content_removals`, `account_restriction_events`, `suspended_*`, legal holds) are recorded in `ACCOUNT_DELETION_AUDIT_RETENTION_2026-11-08.md`. Also unchanged: `referral_redemptions` cascade.

