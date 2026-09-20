# Sponsored Spotlight: business terms (DRAFT for counsel; not legal advice, not in force)

Drafted by engineering from what the product actually does (design sections 5-9, 16-17). Counsel should rewrite or
replace it. Bracketed items are open decisions. Nothing here is shown to businesses until counsel approves and the
purchase screen links to it (the Promotions panel currently shows only a one-line summary).

## 1. What you are buying
A Sponsored Spotlight is one paid placement for your business or one of your offers, shown for 7 consecutive days (UTC
days, starting on the date you choose) in the Places or Perks browse tabs of Nearby to people within 10 miles of your
business's address who are browsing your category. It is always labeled "Sponsored". Price: $25 (USD) per 7-day
placement, charged once through Stripe Checkout. It does not renew automatically.

## 2. What we do not promise
No number of views, taps, visits, redemptions or customers. Each person sees your spotlight at most once every 7 days,
and some people will never see it (they may hide it, hide sponsors, or turn off "Show sponsored places"). Only one
business per category per local area can hold a spotlight at a time; availability is first-paid, first-served. Reported
views and taps are approximate.

## 3. Your content
You provide a headline (up to 80 characters) and an optional description (up to 200). It is reviewed automatically
before payment and may be refused. You confirm you have the right to use it and that it is accurate, lawful, not
misleading and not in a prohibited category [counsel: prohibited content and category list; the launch category list
is set by Nearby and may change]. We may pause or remove a spotlight that breaks these terms or that people report; if
that is not caused by you, section 5 applies.

## 4. Eligibility
An active Nearby business account with a verified address, in a category Nearby has opened for spotlights. One
spotlight at a time per business.

## 5. Cancellation and refunds
- Before your start date: cancel any time for a full refund.
- After it starts: no refund for days already shown.
- If Nearby materially fails to deliver: a refund of the undelivered days at $25/7 per day, rounded up to the cent in
  your favor. "Materially fails" means your spotlight could not be shown for reasons on Nearby's side (for example an
  outage or Nearby pausing it without fault on your part) for more than 24 hours in total, or it cannot run its full term.
- Not a failure: low or no views, people hiding or switching off sponsored places, your own pause, content you
  changed, or a violation of these terms.
- Refunds go back to the original payment method and are issued by Nearby on request [counsel: request channel and
  timeline; today a named Nearby finance approver issues them]. Payment disputes pause the spotlight immediately.

## 6. Payment
Processed by Stripe; Nearby does not see or store your card details. [Counsel: taxes, invoicing/receipts, currency,
failed or late payments (a payment arriving after your slot was released is refunded, not served).]

## 7. People's data
Nearby uses only the person's current location and the category they are browsing to decide who sees a spotlight, and
keeps a private record of who was shown which business (to enforce the once-per-7-days limit) for 7 days. You receive
totals only (views, taps), never who saw or tapped it.

## 8. Changes and liability
[Counsel: right to change price/terms for future purchases with notice, category changes, limitation of liability,
governing law, entire agreement.]

## Owner decisions, LOCKED for v1 (2026-09-20) and implemented
1. **Pre-start cancellation: in-app.** A business cancels its own PAID placement before the start date for a full refund
   (no contact with Nearby). `owner_request_sponsored_cancel` + edge function `cancel-sponsored-placement`; the database
   checks ownership, paid, not started and computes the amount, pauses the placement while Stripe runs, restores it if
   Stripe fails. After start: no refund for elapsed days; material failure: prorated (admin refund, unchanged).
2. **10-mile radius: final for v1.** 3. **One placement per category (the 19 groups) per ~10-mile area: final for v1.**
4. **Who accepts:** the signed-in business user making the purchase, on behalf of the business they manage. No separate
   signature workflow.
5. **Acceptance record:** a ticked box (never a default), stored per purchase in `sponsored_terms_acceptances`:
   purchaser user id, business id, placement id, payment id, terms version, accepted timestamp and the Stripe Checkout
   session id. Terms text lives in `src/constants/sponsoredTerms.js`; each version's sha256 is stored in
   `sponsored_terms_versions` (immutable rows; acceptances cannot be edited or deleted). A Jest test fails if the text
   and its recorded hash diverge. Current version: `v1-draft-1` (NOT counsel-approved; live stays blocked).
Counsel-only items in brackets above remain counsel's, not product decisions.
