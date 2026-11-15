# 0372 write-path audit (owner, 2026-11-12) — read-only, nothing changed

Environment: from-scratch replay of `post-tier1/business-duplicate-signals` (all 538 migrations, 0348-0414 included),
PG 17.6 image, isolated network. Queries: `/workspaces/.nearby-verify/audit372/q*.sql`. Production NOT queried.

## Closed (with 0372 applied)
- Direct table writes: offers, availability, experiences, packages have client table grants but NO client INSERT/UPDATE
  RLS policy (RLS on) -> refused. `brand_partners` (profile text) same. Perks (`brand_offers`): INSERT gated by
  0372's trigger; UPDATE policy exists but the only updatable column is `active`. `business_updates`: INSERT gated; no
  UPDATE policy.
- The seven content functions (submit offer, post availability, update profile, create/update experience,
  create/update package) are 0372's screening wrappers; the unscreened bodies are private, no client EXECUTE.
- Other client-callable writers of these tables only change status/price/time (accept, cancel, complete, confirm,
  decline, withdraw, mark viewed, reopen, `revise_business_offer` = price + time only, `set_occasion_package_active`)
  or are admin-only. Automatic replies copy already-screened availability/package text.
- Storage: business logos + offer media = INSERT only, no client UPDATE or DELETE, so a screened file can't be swapped.

## Not covered
1. **Availability pulse note (REAL BYPASS).** `set_business_availability_pulse(note_param)`: 140-char free text, shown on the
   public business profile (`BusinessProfileScreen`), readable by anon; never screened, no contact-detail rule; untouched
   since 20260903. A business can publish an ad, link or phone number there.
2. **Decline note (hidden channel, low).** `decline_business_offer` stores `decline_note` (reason "other"); the customer can
   read the column through the API (requester SELECT policy + column grant), though the app and push never show it. No
   screening, no contact rule.
3. **Business messages (by design).** Follower-started chat; the business can only reply inside it. Private messaging =
   reports-based (idea 21 known limitation) + 0363 repeated-message signal. Not offer content.

## Fix options (NOT built; owner decides)
- Note 1: (a) retire the free-text note (server refuses a non-null note, existing notes cleared, profile stops showing
  it; pulse itself kept) — smallest; or (b) screen it as profile text through `screen-business-content` + contact rule.
- Note 2: add `decline_note` to `private._offer_contact_guard` (or stop storing it for customers to read).
Either fix = a new staged migration after 0414 (0372 stays as accepted), own approval, in number order.
