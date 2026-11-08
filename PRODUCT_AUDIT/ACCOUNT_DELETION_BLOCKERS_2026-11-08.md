# Account deletion: what refused it, what it destroyed, what changed (2026-11-08)

**Status: 20270405 BUILT + LOCALLY VERIFIED, STAGED on `post-tier1/account-deletion-blockers` (stacked on 0404's branch). NOT merged, NOT deployed, NOT legally reviewed, not in build 87.** Own deploy approval, after 0404. **Deploy gate (owner): 0405 does not deploy until a released build with the deletion warning is on phones. Build 87 doesn't have it.** `delete-account` is unchanged; Settings changed on this branch only.

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
- **A paid booking never holds a deletion, and is never silently cancelled (owner, 2026-11-08):** see Payment exceptions. The money comes off the booking first, then the booking cancels like any other.
- **A plan already over** (visit completed, or cancelled/expired earlier): only the row goes. No push, nothing reopened, and a paid completed booking is not an open obligation, so its money record just stays.
- **The warning:** the final deletion confirmation adds one line when the person organizes an active plan, and one when they have a paid booking (solo too): it will be cancelled, the business will be asked to refund it, keep your receipt. No new screen. It reads `account_deletion_plan_impact` (own account only).

## Payment exceptions (owner, 2026-11-08)

Account deletion and settlement are now separate. The account and personal data go at once; only what a refund needs stays.

| | Paid booking ended | Charge after cancellation |
|---|---|---|
| When | the customer deletes with a captured or authorized payment on a booking still to happen (group or solo) | Stripe's success lands on a payment whose reservation is cancelled or gone (any path, incl. an ordinary customer cancel) |
| Opened by | the deletion trigger | a database trigger on the payment's status, so the webhook is unchanged and no path can miss it |

- **Kept:** payment id, business, kind, amount, currency, Stripe payment intent. **No person:** no account id, name, contact or request text. The payment row itself stays with no person on it.
- **Told:** the business's owners ("A refund is needed", with the amount and Stripe payment id, opening Opportunities) and the admins. At most one open per payment, so a webhook retry doesn't repeat it.
- **Closed:** by the refund (Stripe's `charge.refunded` -> status `refunded`, by itself), or by an admin with a required reason (`admin_resolve_payment_exception`). `admin_list_payment_exceptions` lists open ones. No screen: for now an admin calls these directly.
- **Not forgotten:** one still open after 3 days reminds the admins, then weekly (cron `remind-open-payment-exceptions`).
- **Audit:** `private.payment_exception_events` is append-only (opened, reminded, resolved + who for an admin). No client can read either table.

### What this can't do

- **Nearby can't refund.** It tells the business and reminds the admins; the money moves only if someone refunds in Stripe. The customer has no account to chase it from, which is why the warning says keep your receipt. If a business never refunds, an admin must act; there's no escalation beyond that.
- **The push assumes the business can refund in Stripe.** Direct charges to its own Stripe account should allow that; **not tested** (test mode only, no real Connect account has done it).
- **Any refund closes it:** `charge.refunded` sets `refunded` on a partial refund too, so a partial refund closes the exception. Stripe is test mode only; check before going live.
- **Reservation not live (requested or failed):** nothing to cancel; it goes with the request. A payment on it still opens an exception if captured.
- **Group bookings make no payment row today:** `confirm_group_plan_offer` doesn't create one (only a solo `accept_business_offer` does), so a group pays the business directly. The group-paid path is reachable only through an add-on on the plan. The tests create that row by hand, for this reason.
- **The warning can be skipped** if it can't be read (offline): the person deletes without the extra lines. The exception still opens.
- A scheduled deletion warns when asked; the plan carries on until the purge date, then ends.

## Decisions for the owner

1. **Party size stays as booked** when a participant leaves a plan, same as `leave_group_plan` today: the business may hold a seat for someone who's gone.
2. **A customer's business history shrinks when they delete.** Their request, offer and reservation go as they always have, so a business's bookings list and "Value of offers redeemed" can fall for a past month. Not a tax record, but the owner should know. Unchanged.

## Questions for counsel (owner, 2026-11-08: required before deploy)

1. **How long are kept payment rows kept?** The period must come from counsel, based on tax, accounting, payment and legal obligations, not a number chosen here. Nothing purges them until then (`detached_at` records when they lost their person).
2. Are the Stripe ids on a kept row and an exception acceptable? They're what makes a late refund or dispute work, but Stripe can tie them to a person on its side.
3. **An authorized charge when a customer deletes:** nothing voids it automatically; the exception tells the business and admins. **Decide before Stripe goes live** (test mode only today).
4. A terms acceptance keeps which business, placement, version and when, but no longer who. Is that enough proof?
5. The published Privacy Policy section 5 doesn't list financial records among what's kept. Draft sentence, NOT published: "We keep records of payments made through Nearby, without your account reference, for as long as tax and financial law requires."

## Not changed, for a decision

Columns naming an account with no foreign key, so a deletion doesn't touch them (schema listing, not individually traced): `push_outbox.recipient_id` (with the notification's text), `domain_event_notifications.recipient_id`, `domain_events.actor_id`, `business_visit_no_shows.marked_by`, `private.link_check_usage.user_id`. These don't block a deletion but do leave the old id, and possibly words, behind. The deliberately kept security records (`account_recovery_*`, `content_removals`, `account_restriction_events`, `suspended_*`, legal holds) are recorded in `ACCOUNT_DELETION_AUDIT_RETENTION_2026-11-08.md`. Also unchanged: `referral_redemptions` cascade.

## Strings

`ui.settings.deletionEndsGroupPlans`, `deletionPaidBooking`: 10 languages machine-authored, native review needed. Server pushes are English, like the others.
