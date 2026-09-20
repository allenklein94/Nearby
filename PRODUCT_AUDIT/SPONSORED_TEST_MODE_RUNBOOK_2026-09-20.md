# Sponsored placement: Stripe TEST-mode runbook (owner steps)

Everything is built and deployed but inert. This is the order to turn it on in TEST mode only. Claude cannot do steps
1-3 (they are your Stripe account and your secrets). Never paste a key into chat; run the commands yourself.

## 1. Stripe (test mode)
1. In the Stripe dashboard switch to **Test mode**. Copy the **secret key** (`sk_test_...`).
2. Developers > Webhooks > Add endpoint:
   URL `https://enmosvippabmuqslzrox.supabase.co/functions/v1/sponsored-stripe-webhook`
   Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`.
   Copy the endpoint's **signing secret** (`whsec_...`).
   (This is a SEPARATE endpoint from the consumer Connect webhook; do not reuse that one's secret.)

## 2. Secrets (you run this; test values only)
```
supabase secrets set --project-ref enmosvippabmuqslzrox STRIPE_SECRET_KEY=sk_test_... STRIPE_SPONSORED_WEBHOOK_SECRET=whsec_...
```
Do NOT set `STRIPE_LIVE_APPROVED` or `SPONSORED_LEGAL_REVIEW_COMPLETE`. A `sk_live_` key is refused by all three
functions unless both exist. Note: `STRIPE_SECRET_KEY` is shared by the other Stripe functions (checkout for
consumer/business payments); a `sk_test_` value is the safe state for all of them until live is approved.
Check names only afterwards: `curl -s https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/secrets -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"`.

## 3. Allow one category and one approver (deliberate SQL, you decide; each is reversible)
```
insert into sponsorable_category_groups (group_key) values ('food_drink');
insert into sponsored_finance_approvers (user_id) values ('<your profiles.id>');   -- also requires profiles.is_admin = true
```
Remove either row to switch the feature back off.

## 4. Test purchase (business owner account with an address, active, in that category)
1. Business dashboard > Availability > "More ways to offer" > Promotions.
2. Headline + start date (tomorrow or later), then tick **"I accept the spotlight terms on behalf of my business"**
   (tap "Read the terms" to check the text is the current `v1-draft-1`). The payment button stays disabled until it is
   ticked. Then Continue to payment. Stripe test card `4242 4242 4242 4242`, any future
   expiry/CVC. Expect: the row moves "Waiting for payment" -> "Paid. Starts <date>." (webhook), price $25.
3. As a consumer within 10 miles browsing Discover > Places (or Perks), the card appears once, labeled **Sponsored**,
   only from the start date. Hide / Report / "Why am I seeing this?" work; Settings "Show sponsored places" off hides it.
   Check the record afterwards (SQL): `select user_id, partner_id, placement_id, payment_id, terms_version, accepted_at,
   stripe_checkout_session_id from sponsored_terms_acceptances order by accepted_at desc limit 1;` -- all fields filled,
   session id matches the Stripe Checkout session.
4. **Cancel before start (business, in-app):** with the paid placement still in the future, Promotions shows
   "Cancel for a full refund" > confirm. Expect: message "Cancelled. Your refund is on its way.", Stripe test dashboard
   shows a full refund on that payment, then the row reads "Refunded." and it is never served. Check the audit:
   `select refund_kind, status, amount_cents, stripe_refund_id from sponsored_admin_actions order by created_at desc limit 1;`
   (`owner_cancel_before_start`, `done`). The button must NOT appear once the start date has arrived.
   Failure path (optional): temporarily set an invalid `STRIPE_SECRET_KEY`, try cancel: expect "Your spotlight is
   unchanged" and the row back to "Paid. Starts ..." (not stuck paused); restore the key.
5. Decline path: card `4000 0000 0000 0002`: nothing paid, slot released.
6. Abandon checkout: the hold frees after 24 h (or use the Stripe session expiry).

## 5. Test admin refund (as the approver in step 3; for the Nearby-fault prorated case, not the normal pre-start cancel)
Settings > Sponsored Refunds (Admin) > Refund... > pick the case (before start = full) > reason > confirm. Expect the
Stripe test refund, then the placement showing refunded and no longer served (the webhook does this, not the screen).
Audit trail: `select * from sponsored_admin_actions order by created_at desc;`

## 6. Turn it back off (until legal review is done)
`delete from sponsorable_category_groups;` (nothing servable/purchasable), leave live approvals unset.

## Functions that must be deployed (all four are, as of 2026-09-20)
`create-sponsored-checkout`, `sponsored-stripe-webhook`, `admin-sponsored-refund`, `cancel-sponsored-placement`
(`bash scripts/deploy-sponsored-functions.sh`). Verify: `curl -s https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/functions -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"`.

## What this does NOT cover
Live money (needs the legal review and your approvals: see design section 16 and CLAUDE.md "Stripe approval AUTHORITY").
