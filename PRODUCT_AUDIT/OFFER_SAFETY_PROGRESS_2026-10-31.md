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
- [x] client (package via screening, Keep suggestion via screening, contact error message, ⋯ Report this offer) (2026-10-31, after a codespace restart: re-checked)
- [x] reschedule-reply-concurrency.js records screening stand-ins when 0372 is present; new screening-single-use-concurrency.js
- [x] full verification (2026-10-31, re-run after the codespace restart; nothing written to prod):
      from-scratch replay 496/496 apply + journeys 850/850 on it; all 8 replay concurrency scripts pass on it, incl. the new
      `screening-single-use-concurrency.js` (10 rounds: one result = one write, the concurrent send refused at once, freed
      again on rollback) and `reschedule-reply-concurrency.js` with screening stand-ins; prod journeys 850/850 with 0348-0372
      as prelude (rolled back); `offerSafety` fails 7/7 with 0348-0371 only; rollback round trip identical on prod (aborted)
      and on the replay (4,681 functions / triggers / constraints / policies / columns / indexes / ACLs; first prod run found
      ACL entry ORDER only on the 7 restored functions, fixed in the rollback script); grants replay == prod+0348-0372
      3272/3272; Jest 534/534 suites, 7240 tests (4 stale guards updated: occasion packages now via serviceError, writeRefusal pattern
      window, two held-for-review dialogs -> showSuccessToast (idea 274), post-deploy step for 0372).
      Migration sha256 8267ea4eab4f0b030c87183af2c696e594283402a2ade5bca3d99f7613bdb047.
- [x] rollback script written (scripts/rollback/20270372_offer_safety.rollback.sql)
- [x] records (CLAUDE.md status line, CLAUDE_HISTORY.md top, post-deploy.js step 20270372)

## Not verified / open
- Not deployed: migration + `screen-business-content` redeploy (right after it) each need owner approval; after 0371.
- No real-API signed-in test yet (post-deploy manual step: direct call refused `screening_required`).
- Not device-verified: ⋯ Report this offer on the request screen, package save via screening, contact-info message.
- Native review: `ui.requestDetail.reportThisOffer` / `offerMoreA11y`, `ui.shared.errors.offerContactInfo` (10 machine-authored languages).
- Classifier path never run live (Anthropic credit). (CLAUDE.md, history, post-deploy plan)

## Owner decision (2026-10-31): ACCEPTED + CLOSED
Code-complete and locally verified; NOT deployed, NOT production-verified. The acceptance authorizes no code change, merge,
migration deploy, function redeploy or website publish. Activation gates, all mandatory, in order:
1. Restore Anthropic screening availability and verify a successful real screening call (controlled environment) before
   0372 goes live. Once deployed, every screened business save fails closed until screening works.
2. Deploy 0372 only after 0371, with separate owner approval, as one coordinated release with the `screen-business-content`
   redeploy and the documented rollback (`scripts/rollback/20270372_offer_safety.rollback.sql`).
3. Verify direct-API bypass protection (refused `screening_required`, nothing written) and that legitimate business saves
   succeed, through the real API with dedicated test accounts.
4. Test Report this offer, contact-detail refusal and package creation on the appropriate iPhone build.
5. Complete native-language review of the new strings before public release.
Build 87 unchanged. Next = Build 87 submission + Tier 1 iPhone testing; no further feature development unless a new
critical security defect is found.
