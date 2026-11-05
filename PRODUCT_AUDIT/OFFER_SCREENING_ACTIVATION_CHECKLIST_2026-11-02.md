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

### Phase A+: outage monitoring (owner, 2026-11-02; BUILT + STAGED as 20270387, see section 6)
- [ ] A4 Before ANY external business onboarding: 20270387 deployed (its own approval, after 0386) + `send-push` redeployed
      with the new type, and its post-deploy check passed (one deliberate failure state observed or a success recorded).
- [ ] A5 Before opening business onboarding: one successful REAL screening request (A2) in the environment businesses
      will use, recorded; automated tests alone never count (owner).

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
- **Credit can lapse again:** screening fails closed, so hand-written offers stop until it is restored. Admin alerts for
  this are BUILT + STAGED (20270387, section 6) but alert nobody until deployed with their edge functions + send-push.
- **Classifier never run in production** (0 results): its real verdict quality is unknown until A3; prohibited content
  outside the 13 categories, or a model change, may be classified wrongly.
- **Model id** `claude-haiku-4-5-20251001` may be retired; A2 detects it (fails closed). Changing it = a code change.
- Medium/uncertain offers wait for a human: an admin must watch the queue once real businesses exist.
- Accepted residual (unchanged): offer media and the AI's own suggestions rely on the same screening; anything the
  classifier misses is caught only by reports + admin review afterwards.

## 6. Screening outage alerts (owner 2026-11-02) — BUILT + STAGED, NOT DEPLOYED

Inspection (2026-11-02): no outage monitoring existed. Every provider failure (credit, bad key, retired model, timeout,
5xx) became the same `screening_unavailable` 503 + a console line; nothing told an admin. Reusable infrastructure found:
`_send_push` + push_outbox dedupe keys, 0355's admin-recipient rule (admins, not suspended), private failure tables, the
existing admin screen for held business content (`AdminContentReview`).

Smallest change (branch `post-tier1/screening-outage-alerts`, stacked on `post-tier1/gathering-review-signals`):
- `supabase/functions/_shared/screeningHealth.js` (pure, Jest-tested): failure KIND from the HTTP status + the provider's
  error type/message only (credit / credentials / model / rate_limit / timeout / provider_error / bad_reply) and a
  reporter that posts only { ok, kind, status, source } to a service-role RPC, 3 s timeout, never throws.
- `_shared/contentClassifier.ts` + the logo (vision) classifier in `screen-business-content`: every Anthropic call reports
  ok or its failure kind. A content verdict (incl. refused / held) is never a failure. Return values and fail-closed are
  unchanged (the vision call now also has the 20 s timeout and a caught network error = the same retryable 503 instead
  of an uncaught 500). The model's raw reply (which may echo the offer) is no longer logged, only its length.
- migration 20270387: `record_screening_service_result` (service_role only), `private.screening_service_failures`
  (kind, status, source, time; 30 days) + `private.screening_outages` (one open at a time, advisory lock + unique index;
  closed kept 90 days). Opens on the FIRST credit / credentials / model failure, or the 3rd other failure within 10 min
  since the last recovery. Alerts each unsuspended admin ONCE on open ("Offer screening is unavailable" + plain reason),
  at most one reminder per 24 h while failures continue, ONCE on the first success ("working again"); dedupe key per
  outage + phase + admin. The push carries only type / phase / kind: no offer text, business, user, request or key.
- push type `admin_screening_outage`: priority medium, never muted (account notice), action "Review Content" (11
  languages, 10 machine-authored: native review) opening `AdminContentReview`. No new screen.
Verified locally (fresh replay 510/510 with real Auth first, then 0387): journey `screeningOutageAlerts` 7/7 (fails 7/7
without 0387), journeys 1070/1070, `scripts/replay/screening-outage-concurrency.js` all pass (12 parallel failures = one
outage + one alert per admin; parallel successes = one "working again"; 6 parallel timeouts = one outage; interleaved =
never two open), rollback round trip identical (35,614 schema lines), Jest 543/543 (7358).
Not run (deploy gates): prod journeys with 0348-0387 prelude, prod aborted rollback, grants vs prod.
Deploy notes: 0387 is a migration after 0386 (own approval). The edge code reports only once deployed; before 0387 is
live a report is a swallowed 404 (harmless), so `screen-business-content` may ship in 0372's release from this branch.
The other three classifier users (resweep-business-content, rewrite-offer-plain-language, create-sponsored-checkout) each
need their own redeploy approval to report. `send-push` needs a redeploy for the priority + action button (before it,
the type falls back to medium with no button). Limits: an outage is detected only when someone tries to screen (no
traffic = no alert, no recovery); a provider that answers with valid JSON but wrong verdicts is not an outage; the user
content classifier (0373, `userContentClassifier.ts`) is not wired (separate decision).

## 7. Coordinated deployment of the outage alerts (owner 2026-11-02: 0387 ACCEPTED AS STAGED)

Accepted as staged, subject to the existing approvals and production verification. Nothing deployed. The danger to
avoid: 0387 live while the functions that REPORT are still old = monitoring that looks on but never fires. Every step
below is its own approval unless grouped; stop at the first failure and report.

| # | Step | Why this order | Verify |
|---|---|---|---|
| D0 | Prerequisites: 0348-0386 live in order; 0372 + `screen-business-content` (from `post-tier1/screening-outage-alerts` or later, so it carries the reporter) released together (section 3, Phase C) | the 0372 release already redeploys this function; shipping the reporting version then avoids a second redeploy | record the deployed version + bundle hash; before 0387 its reports are swallowed 404s (harmless, screening unchanged) |
| D1 | Redeploy `send-push` with `admin_screening_outage` (priority medium, action review_content) | must exist before the first alert, else the alert arrives with no button | one ordinary push still delivered (real phone); rollback = previous version |
| D2 | Deploy 0387 via `deploy.js` | alerts can only be created once the functions report (D0) and send-push knows the type (D1) | read-only: both private tables 0 rows; anon / authenticated no EXECUTE on `record_screening_service_result`; journey `screeningOutageAlerts` on prod without prelude |
| D3 | Redeploy `resweep-business-content`, `rewrite-offer-plain-language`, `create-sponsored-checkout` from the same commit | they share `_shared/contentClassifier.ts`; until redeployed, THEIR failures are not seen (screen-business-content's are) | list function versions = the commit's; until done, record "monitoring covers screen-business-content only" |
| D4 | **[APPROVAL] End-to-end proof** (the only way to prove the deployed functions report: a success leaves no row): (a) open a synthetic outage with ONE service-role call `record_screening_service_result('business-content', false, 'provider_error', 500)` x3 -> the owner's iPhone gets ONE "Offer screening is unavailable"; tap opens Content Review; (b) one REAL screening request through the app (needs credit, section 3 A2) -> the function's success report closes it -> ONE "Offer screening is working again" | proves D0-D2 are wired together on prod | outage row closed by the function (recovered_at set right after the real request); exactly one push of each phase; delete nothing (history = evidence) |
| D5 | Build with the "Review Content" button on the admin's phone + native review of `review_content` (10 languages) | the label is client-side | tap from the push shows the button text |

Rollback (owner decides, never automatic), reverse order: D3 functions back to their previous versions (optional: an
old function just doesn't report) -> 0387 rollback script (monitoring gone; reports become swallowed 404s) -> send-push
previous version. Screening itself is unaffected by every rollback step.

Unchanged requirements before ANY outside business onboarding: one successful REAL screening request (A2/A5), 0372's
bypass verified closed through the real API (Phase D2), the outage alerts proven end to end (D4), and business video and moments refused through the real API with 0388 + 0389 live (section 8). Withholding outside approvals until then reduces exposure; it does
not close the bypass.

## 8. Business video paused for the first launch (owner 2026-11-02: Option A, TEMPORARY, not a removal)

Outside businesses may submit text and image offers only until video moderation is built and tested.

Why: a business video is judged only from 1-3 still frames the business's own phone chooses and uploads. A modified client
can pair harmless frames with a different video; the audio is never checked; a reviewer sees only the first frame. Business
Moments were worse: a direct insert with no screening at all, readable by every signed-in user.

Enforcement = migration 20270388 (STAGED, NOT DEPLOYED, own approval, in order after 0387). One switch
`private.business_video_settings.enabled` (false, no client access); while off, the database refuses a NEW video on
`business_request_offers`, `business_creatives`, `business_experiences` and business `stories` (moments), whoever writes
(hint `business_video_paused`). `screen-business-content` refuses early so a refused video costs no AI call; the database
stays the authority. Every video column, the 30 s length gate, storage, the picker and the player are kept for later.

**Business Moments paused too (owner 2026-11-05, temporary):** migration 20270389 (STAGED, NOT DEPLOYED, own approval, in
order after 0388) refuses every new moment, photo included, because moments have no screening at all. Infrastructure kept.

**Gate:** 0388 AND 0389 live AND both real-API checks passed (`post-deploy.js` 20270388, 20270389) before any outside business
is approved. Disabling media in a checklist is not the restriction: until they are live, the production API still accepts
business video and moments.

**To re-enable (a separate owner-approved migration, nothing else), all required:**
1. frames extracted by the server from the actual uploaded file, never supplied by the client;
2. audio transcribed by the server, and the transcript screened like offer text;
3. OCR of on-screen text, with the 0372 contact-detail rule applied to both OCR text and transcript;
4. held videos playable in full, with audio, by an administrator in the review queue;
5. Business Moments screened through the same pipeline (they have no screening today).

To re-enable Moment photos (a separate approved migration): image screening for moments, built and tested. Client changes
for a later build: `PRODUCT_AUDIT/PUBLIC_MEDIA_AUDIT_2026-11-05.md` section 4.

These substantially improve screening but cannot guarantee detection of every harmful visual or spoken claim; a few sampled
frames can miss what happens between them. Reports and human review stay part of the design.

Build 87 and Tier 1 are unaffected: nothing in this checklist changes main or the build.
