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
2. Headline + start date (tomorrow or later) > Continue to payment. Stripe test card `4242 4242 4242 4242`, any future
   expiry/CVC. Expect: the row moves "Waiting for payment" -> "Paid. Starts <date>." (webhook), price $25.
3. As a consumer within 10 miles browsing Discover > Places (or Perks), the card appears once, labeled **Sponsored**,
   only from the start date. Hide / Report / "Why am I seeing this?" work; Settings "Show sponsored places" off hides it.
4. Decline path: card `4000 0000 0000 0002`: nothing paid, slot released.
5. Abandon checkout: the hold frees after 24 h (or use the Stripe session expiry).

## 5. Test refund (as the approver in step 3)
Settings > Sponsored Refunds (Admin) > Refund... > pick the case (before start = full) > reason > confirm. Expect the
Stripe test refund, then the placement showing refunded and no longer served (the webhook does this, not the screen).
Audit trail: `select * from sponsored_admin_actions order by created_at desc;`

## 6. Turn it back off (until legal review is done)
`delete from sponsorable_category_groups;` (nothing servable/purchasable), leave live approvals unset.

## What this does NOT cover
Live money (needs the legal review and your approvals: see design section 16 and CLAUDE.md "Stripe approval AUTHORITY").
