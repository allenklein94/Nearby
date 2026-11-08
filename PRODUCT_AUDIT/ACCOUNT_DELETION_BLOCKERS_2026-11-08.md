# Account deletion: what refused it, what it destroyed, what changed (2026-11-08)

**Status: 20270405 BUILT + LOCALLY VERIFIED, STAGED on `post-tier1/account-deletion-blockers` (stacked on 0404's branch). NOT merged, NOT deployed, NOT legally reviewed, not in build 87.** Own deploy approval, after 0404. `delete-account` and Settings changed for the owner's Option 1 decision (below), on this branch only: redeploy the function right after 0405; the warning reaches phones only in a build made after this is merged.

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
- **A group plan's booking**, for everyone else in it, when its organizer left, with nobody told.

## Group plans (owner decision, 2026-11-08: Option 1)

An explicit-agreement hand-over was approved first, then replaced: a deletion finishes instantly, so agreement would need a plan and booking that survive with no organizer (`requester_id` is required, the request cascades without it, and 69 functions + 9 access rules read it). **No hand-over exists. Nobody is ever given the organizer role or a payment.**

- **Someone else's plan:** the person's row and confirmations go, the plan goes on (`leave_group_plan`'s behaviour).
- **Their active plan, booked or not:** it ends. Each active booking goes through the reservation cancellation everyone else uses (`_cancel_reservation_by_offer`), so capacity comes back and its refusal stands. The business gets the customer-cancelled push; everyone accepted or invited gets "Your group plan was cancelled" (planning mute respected), which opens their own request. Both cancellations are on record.
- **Each person's own request comes back,** as on Reopen: open if its time hasn't passed, with unanswered business rows pending again; past its time it reads expired, where Reopen / Ask again take over. A reply the business already wrote stays closed, also as on Reopen.
- **A booking the rules refuse** (paid or authorized; there is no automatic refund): the whole deletion is refused and nothing changes. `delete-account` answers 409 with `group_plan_booking_unresolved` and says what to do: ask the business to refund it or confirm the visit. It checks before anything happens, including before a scheduled deletion ends sessions; the database has the last word if a payment lands in between. A scheduled deletion that hits this waits, recorded for an admin, with no hourly notice.
- **A plan already over** (visit completed, or cancelled/expired earlier): only the row goes. No push, nothing reopened, and a paid completed booking is not an open obligation, so its money record just stays.
- **The warning:** the final deletion confirmation adds one line when the person organizes an active plan; with a paid booking it says so instead of offering to delete. No new screen. It reads `account_deletion_plan_impact` (own plans only); the rule behind `unresolved` is a preview, kept equal to the real refusal by journey step `preview_matches_refusal`.

### What this can't do

- **A paid booking can hold a deletion for as long as the business doesn't act.** Apple expects in-app deletion to work (guideline 5.1.1(v)); confirm a refused deletion plus a support route is acceptable before Stripe goes live. **Unreachable on a group booking today:** `confirm_group_plan_offer` creates no payment row (only a solo `accept_business_offer` does), so a group pays the business directly. Only an add-on on the plan can carry one. The tests create the row by hand for this reason.
- **Someone mid-payment:** a pending payment is cancelled with the booking, as in any customer cancel. If Stripe then captures it, the webhook records `captured` on the kept row with no booking behind it, and nobody is alerted. Same as the existing customer cancel. Decide before Stripe goes live.
- **The warning can be skipped** if it can't be read (offline). The refusal still holds; an unpaid booking is cancelled without the line.
- **Deploying before a new build:** build 87 has no warning line, so anyone on it gets the old confirmation. It does show the server's refusal text, in English. Deploy 0405 only with a build that has the line on phones, or accept this for the test accounts.
- A scheduled deletion warns when asked; the plan carries on until the purge date, then ends.

## Decisions for the owner

1. **Party size stays as booked** when a participant leaves a plan, same as `leave_group_plan` today: the business may hold a seat for someone who's gone.
2. **A customer's business history shrinks when they delete.** Their request, offer and reservation go as they always have, so a business's bookings list and "Value of offers redeemed" can fall for a past month. Not a tax record, but the owner should know. Unchanged.

## Questions for counsel (owner, 2026-11-08: required before deploy)

1. **How long are kept payment rows kept?** The period must come from counsel, based on tax, accounting, payment and legal obligations, not a number chosen here. Nothing purges them until then (`detached_at` records when they lost their person).
2. Are the Stripe ids on a kept row acceptable? They're what makes a late refund or dispute work, but Stripe can tie them to a person on its side.
3. **An authorized or pending charge when a solo customer deletes:** nothing voids or refunds it (a group plan's refuses the deletion instead). **Decide before Stripe goes live** (test mode only today).
4. A terms acceptance keeps which business, placement, version and when, but no longer who. Is that enough proof?
5. The published Privacy Policy section 5 doesn't list financial records among what's kept. Draft sentence, NOT published: "We keep records of payments made through Nearby, without your account reference, for as long as tax and financial law requires."

## Not changed, for a decision

Columns naming an account with no foreign key, so a deletion doesn't touch them (schema listing, not individually traced): `push_outbox.recipient_id` (with the notification's text), `domain_event_notifications.recipient_id`, `domain_events.actor_id`, `business_visit_no_shows.marked_by`, `private.link_check_usage.user_id`. These don't block a deletion but do leave the old id, and possibly words, behind. The deliberately kept security records (`account_recovery_*`, `content_removals`, `account_restriction_events`, `suspended_*`, legal holds) are recorded in `ACCOUNT_DELETION_AUDIT_RETENTION_2026-11-08.md`. Also unchanged: `referral_redemptions` cascade.

## Strings

`ui.settings.deletionEndsGroupPlans`, `deletionBlockedGroupPlanTitle`, `deletionBlockedGroupPlanBody`: 10 languages machine-authored, native review needed. Server pushes are English, like the others.
