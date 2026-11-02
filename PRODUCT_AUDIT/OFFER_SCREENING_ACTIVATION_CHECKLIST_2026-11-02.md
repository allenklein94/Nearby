# Offer screening: activation checklist for 0372 (owner, 2026-11-02)

Owner decision (2026-11-02): the two production issues are PRIORITY RELEASE BLOCKERS: (1) AI screening fails because the
Anthropic credit is unavailable, (2) the live `submit_business_offer` API (and its sibling write functions) can bypass
screening until 0372 is deployed. The architecture is NOT redesigned: no second screening system, no relaxing of
fail-closed. This document prepares activation only. Nothing here spends money, changes billing, deploys a migration
or a function, or touches production; each step marked **[APPROVAL]** needs the owner's separate, explicit approval.

## 1. Facts checked today (read-only, production, 2026-11-02)

| Fact | Result |
|---|---|
| `ANTHROPIC_API_KEY` secret exists | yes (name only read; value never read) |
| `screen-business-content` live version | v47, ACTIVE, deployed 2026-10-28 22:30 UTC (pre-0372 code: no package branch, no contact pre-check) |
| Screening results ever recorded (`business_content_screening_results`) | **0** (no successful screening has ever run in production) |
| Bypass: `authenticated` has EXECUTE on `submit_business_offer`, `post_business_availability`, `update_business_profile` | **yes, all three: the bypass is live** |
| Who can use the bypass | only a signed-in account that manages an approved business (`submit_business_offer` refuses "not manage a business"); businesses are admin-approved |
| Approved businesses today | 1 (Coastal Coffee, the owner's own); offers 0 |
| Migration ledger | latest recorded = 20270347; 0348-0371 are all staged ahead of 0372 |
| 0372 file | sha256 8267ea4eab4f0b03… = the version verified 2026-10-31 (unchanged) |
| Classifier model in the staged + live code | `claude-haiku-4-5-20251001` |

NOT checked (can't be without a call or the owner's console): whether the Anthropic account has credit **today**. The
"credit balance is too low" error was last recorded 2026-09-19 and the AI features have been treated as blocked since.
Also unverified: that `claude-haiku-4-5-20251001` is still served (a retired model would fail the same way, closed).

## 2. The ordering constraint (the main risk to "priority")

`deploy.js` refuses out-of-order versions, and 0372 depends on 0355 (report content capture) and 0370 (reason codes).
So 0372 can go live only AFTER 0348-0371, in order. That chain starts with 0348, which requires build 87 (or later) on
every device first (build 86 breaks after 0348). Consequence: the earliest 0372 can be live is
**build 87 installed everywhere -> Tier 1 passes -> 0348 ... 0371 deployed + verified in order -> 0372**.
Deploying 0372 ahead of them would permanently block 0348-0371 (same reason 0367 was kept in order). Re-cutting a
standalone bypass fix outside the chain would be a new migration + edge redesign (declined: no redesign).

Exposure meanwhile is narrow (section 1): only a manager of an approved business can call the functions directly, and
the only such business is the owner's. **Recommended interim gate [APPROVAL: owner decision]:** approve no external
business application until 0372 is live and verified. Under that gate the live bypass has no external user.

## 3. Activation checklist (in order; stop at the first failure and report)

### Phase A: restore the screening dependency (can run in parallel with build 87 / Tier 1)
- [ ] A1 **[APPROVAL + money]** Owner checks the Anthropic console (Billing) for the account behind `ANTHROPIC_API_KEY`
      and adds credit, or names another explicitly approved provider (that would be a code change: separate decision).
      Reading the console balance costs nothing; Claude never handles the key or billing.
- [ ] A2 **[APPROVAL, ~cents]** One real screening call in a controlled environment, before anything else changes:
      the owner-approved way = the live v47 function, signed in as the owner's business account (Coastal Coffee) in
      the app or business website, sending ONE low-risk test reply to a test request, OR a local run of the staged
      function against the from-scratch replay with a key the owner sets in a local env (never pasted in chat).
      Pass = a screening row with a risk level, no "credit balance" / model error.
- [ ] A3 **[APPROVAL, ~cents]** Classification spot check (same environment as A2), each result recorded:
      | Example | Expected |
      |---|---|
      | "20% off brunch for your table of 4, Saturday 11 AM" | low -> shown |
      | an ambiguous claim (e.g. "detox package that boosts immunity") | medium/uncertain -> held for admin, not shown |
      | "Free prescription medication, no doctor needed" | high -> refused, nothing saved, attempt logged |
      | "Investment opportunity: double your money" | high (financial_scams) -> refused |
      | "Click this link and enter your card: example.com" | refused (0372 contact rule after deploy; fraud_scams before) |
      A wrong verdict = report it; the classifier prompt is changed only with a separate approval.

### Phase B: pre-deploy gates for 0372 (after 0371 is live; nothing written to prod)
- [ ] B1 Prod journeys with 0372 as a rolled-back prelude on the then-current prod (0348-0371 live): all pass, incl.
      `offerSafety` 7/7, `offerJourney`, `availabilityNoBroadcast`, `exclusivePostingRequest`.
- [ ] B2 Rolled-back apply + `scripts/rollback/20270372_offer_safety.rollback.sql` on prod (aborted transaction):
      schema identical to before, item for item (incl. ACL order on the 7 restored functions).
- [ ] B3 Grants: replay == prod + 0372 (`scripts/replay/grants-snapshot.sql`).
- [ ] B4 Replay-only concurrency: `screening-single-use-concurrency.js` + `reschedule-reply-concurrency.js` pass.
- [ ] B5 `npm run migration:deploy -- supabase/migrations/20270372_offer_safety.sql --target=prod --check` clean;
      `npm run migration:status -- --target=prod` shows 0371 deployed, 0372 next.
- [ ] B6 The staged `screen-business-content` (with the package branch + contact pre-check) is ready to deploy, and its
      rollback = redeploy v47 (record v47's bundle hash before the deploy).

### Phase C: the coordinated release **[APPROVAL: one approval naming 0372's sha + the function redeploy]**
- [ ] C1 Deploy 0372 via `deploy.js` (approval code `20270372:<sha256>`).
- [ ] C2 Immediately redeploy `screen-business-content` from the staged code (between C1 and C2, package saves are
      refused and some screened writes may be: keep the gap minutes, not hours).
- [ ] C3 Rollback trigger: any C/D failure = STOP and report; rollback (revert function to v47, then the 0372 rollback
      script via its own approval) is the owner's call, never automatic.

### Phase D: post-deploy verification (`post-deploy.js` 20270372)
- [ ] D1 Read-only: 0 screening results consumed right after the deploy.
- [ ] D2 **Bypass closed, real API**, dedicated test account that manages a test business: direct `submit_business_offer`
      and `post_business_availability` calls -> refused `screening_required`, nothing written; also
      `update_business_profile` and a direct perk / business-update insert.
- [ ] D3 **Legitimate saves still work:** one reply and one availability posting through the app (screened) succeed;
      the same screening result can't be reused for a second write.
- [ ] D4 Contact rule: an offer with a link / email / phone is refused with the contact message.
- [ ] D5 Phone (build with the 0372 client changes): ⋯ Report this offer on a real reply -> one report, reported_id =
      the business manager, content captured; package creation via screening.
- [ ] D6 Native review of `ui.requestDetail.reportThisOffer` / `offerMoreA11y`, `ui.shared.errors.offerContactInfo`
      before public release.

## 4. Actions that need the owner's explicit approval
1. Anthropic credit / billing (A1), or naming another provider (code change, separate decision).
2. The real screening calls A2 + A3 (small spend; writes screening rows / a test reply in prod if run there).
3. The interim gate: no external business approved until 0372 is live (section 2).
4. Each migration 0348 ... 0371 before it, each its own approval (existing sequence).
5. The 0372 + `screen-business-content` coordinated release (C1-C2), one approval naming both.
6. Any rollback (C3).
7. The dedicated business test account / test business used in D2-D3.

## 5. Remaining risks
- **Until 0372 is live the bypass exists**; mitigated only by who can reach it (approved business managers: today only
  the owner). Approving an outside business before 0372 makes it real.
- **Timing:** 0372 waits on the whole 0348-0371 chain, which waits on build 87 + Tier 1. Any slip there delays it.
- **Credit can lapse again:** screening fails closed, so hand-written offers stop until it is restored. No alert exists
  for this today (a monitoring line is a possible later, separately approved item; not built).
- **Classifier never run in production** (0 results): its real verdict quality is unknown until A3; prohibited content
  outside the 13 categories, or a model change, may be classified wrongly.
- **Model id** `claude-haiku-4-5-20251001` may be retired; A2 detects it (fails closed). Changing it = a code change.
- Medium/uncertain offers wait for a human: an admin must watch the queue once real businesses exist.
- Accepted residual (unchanged): offer media and the AI's own suggestions rely on the same screening; anything the
  classifier misses is caught only by reports + admin review afterwards.

Build 87 and Tier 1 are unaffected: nothing in this checklist changes main or the build.
