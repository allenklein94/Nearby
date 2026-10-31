# Offer safety (owner approved 2026-10-31, gaps 1-3) — progress tracker

Branch `post-tier1/offer-safety` (stacked on `post-tier1/business-verification`). Migration 20270372 (staged, NOT deployed).
Build 87 / main unchanged. No deploy, merge, publish or activation without separate owner approval.

## Findings (read-only on prod, 2026-10-31)
- Every screened business write is done by `screen-business-content` calling the write function AS THE USER, and the user
  can call the same function directly (EXECUTE granted to authenticated): `submit_business_offer` (offer replies),
  `post_business_availability` (availability -> immediate offers + push with its title), `update_business_profile`,
  `create/update_business_experience`; perks (`brand_offers`) and `business_updates` are table INSERTs by the user
  (RLS insert policy for the owner). All skip screening when called directly. Media paths too (offer media unscreened).
- Occasion packages (`create/update_occasion_package`) are never screened at all; they become automatic offers.
- Decline note: only returned to the business (`get_business_opportunities`), never to the customer: not a gap.
- `record_business_content_screening`: service role only; table: SELECT for owner/admin only -> a client can't forge a result.
- Prod data: 1 business, 0 offers, 0 availability, 0 screening rows -> nothing existing to clean up.
- Offer cards have no menu today.

## Design
1. Binding: each write checks for a LOW-risk, source 'submission', unconsumed screening row for auth.uid() + that
   business + target, < 30 min old, whose snapshot equals the content being written (per key); consumes it.
   Admin and server (auth.uid() null) paths exempt. Packages get a new 'package' screening branch.
2. Contact rule: ONE SQL rule `private.offer_contact_kind(text)` (url / email / phone, incl. obfuscations), enforced by
   triggers on offer text (replies, availability, packages, perks); edge pre-checks through it; shared test vectors.
3. Report this offer: reports.content_type 'business_offer', server captures the offer + sets reported_id = manager.

## Status
- [x] migration 20270372 written (wrappers: the 7 write functions moved to private as *_unscreened, thin public wrappers;
      triggers on brand_offers / business_updates; package approval trigger; contact rule + triggers; report capture)
- [x] journey harness: screened stand-ins (pg_temp.j_*) for submit_business_offer / post_business_availability /
      update_business_profile; `{ unscreened: true }` opts out
- [x] replay (isolated): 496/496 apply; existing journeys 843/843 on it with 0372; new `offerSafety` 7/7
- [x] edge function: 'package' branch, contact pre-check (offer_contact_info_kind), writeRefusal maps offer_contact_info,
      aiSuggested passthrough (not deployed)
- [ ] client (package via screening, Keep suggestion via screening, contact error message, ⋯ Report this offer)
- [ ] reschedule-reply-concurrency.js needs screening rows (calls submit/post as a client)
- [ ] full verification (prod prelude journeys 0348-0372, journey fails without 0372, concurrency, rollback round trip,
      grants replay vs prod+prelude, Jest)
- [ ] rollback script, records (CLAUDE.md, history, post-deploy plan)
