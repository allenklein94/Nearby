# Privacy Policy corrections: packet for legal review (2026-11-27)

DRAFTS by Claude, not legal advice, NOTHING published. Two parts, kept apart on purpose:
- **Part 1: processing that happens TODAY** (build 87 + production at 0347). The current `docs/privacy.html` doesn't
  describe it. Expedited: these can go out before any migration. Ready as a patch:
  `PRODUCT_AUDIT/PRIVACY_CORRECTIONS_LIVE_2026-11-26.patch` (`git apply --check` passes against today's page).
- **Part 2: FUTURE functionality** that starts only when a staged migration or setting goes live. Each sentence is
  published the same day as its migration (release rule 8), never before (it would describe processing that doesn't
  happen yet) and never after.

Every claim below was checked against the code on 2026-11-26/27 (details: `PRIVACY_CORRECTIONS_DRAFT_2026-11-26.md`).

## Part 1: live today (expedited)

| # | Sentence (in the patch, section 4 "With service providers", after the providers paragraph) | Verified in code | Questions for counsel |
|---|---|---|---|
| 1 | **With our AI provider (Anthropic)**: sends only what each feature needs: text/photo/video of a business offer or business profile under automated screening; a message you ask to translate; what you type into an assistant; for a conversation starter, introduction or strengths summary the profile details it uses (incl. favourite-track artists for strengths); for chat "help me say it" only the kind of message chosen. Another person's display name only in an introduction. Never email, phone, exact location or account identifier. Not used to train models under Anthropic's commercial terms. An automated screening result on business content can be reviewed by a person. | 12 app-called functions that call Anthropic (two more are deployed but no app build calls them: `moderate-chat-image`, `ai-concierge`, so NOT described). No function sends email/phone/coordinates/user id. Human review exists only for business content (`admin_review_business_content_screening`). | (a) Is "does not use it to train its models" accurate under Anthropic's CURRENT commercial terms, and should Anthropic's retention period be named? (b) Should the deployed-but-unused functions be disabled instead of left undescribed? (Claude's recommendation: disable them; separate approval.) |
| 2 | **Bot protection (Cloudflare Turnstile)** on the sign-in screen: Cloudflare receives IP + device/browser information for the check, under Cloudflare's privacy policy; never phone number or account details. | Widget on Login (app + business website); enforcement is OFF, the widget still runs, so the data flow is live. | Is Cloudflare a processor or an independent controller for Turnstile? (Changes "under Cloudflare's privacy policy".) |
| 3 | **Notifications (Expo)**: device notification token + the notification's text. | `send-push` posts to exp.host. | none |
| 4 | **GIF search (GIPHY)**: search words + IP, from the device. | `GifPickerModal` calls api.giphy.com directly. | Does GIPHY's own terms require a specific attribution/notice? |

Retention (Part 1): nothing new is stored at Nearby because of these four (translations aren't stored; AI usage is a
per-day count with no content; screening results of business content were already kept with the business's
submission). Retention at the four providers is theirs; the draft states none.

Already accurate (no change): Supabase, AWS moderation, Brevo, Twilio, PostHog, Sentry, Apple/RevenueCat, Google Maps.

## Part 2: future, published with its migration (NOT now)

| Ships with | What it adds | Draft |
|---|---|---|
| 0355 (Batch 2) | Reports keep the reported content; 12 months after resolution | `BATCH1_APPROVAL_PACKET_2026-11-25.md` "Privacy Policy wording" 1 |
| 0357 (Batch 2), revised at 0368/0380 | Photo fingerprints for duplicate-account review (not face recognition) | same packet, item 2 |
| 0358 (Batch 2) | Rate limits by phone verification + account age | same packet, item 3 |
| 0351 (Batch 1) | Data requests while suspended (support@thisisnearby.com) | same packet, item 4 |
| 0363 (Batch 3) | Rejected impossible location jumps: rough area, 1 hour | same packet, item 5 |
| **0373 (Batch 6)** | Public text screened by the AI provider before it is published | **NEW, below** |
| 0374 / 0375 / 0376 / 0378 (Batch 6) | Suspended-number code 12 months; security-event log 12 months; device-token code 90 days/12 months; repeated-text code 30 days | `TRUST_SAFETY_FIXES_2026-10-27.md` |
| 0391 (7) | Reported photo kept for review | `PUBLIC_MEDIA_AUDIT_2026-11-05.md` |
| 0396 (7) | Links in public text checked with Google Web Risk | `LINK_SAFETY_2026-11-07.md` |
| **0400 (8)** | ID document retention schedule | **NEW, below** |
| 0402 / 0403 (8) | Deletion + limited records kept | `staged-docs/privacy.html` sections 5 + 6 |
| 0413 (9, detector off until published) | Shared-website code, 30 days | `TRUST_SAFETY_FIXES_2026-10-27.md` |
| 0414 (9; deploy.js refuses until published) | Business details compared across applications | 0414 branch fixes doc |
| **0428 + Resend secrets (10)** | Business alert emails via Resend | **NEW, below** |

### New drafts (2026-11-27, from the migration headers)
- **0373:** "Before text you make public on Nearby (your profile, a gathering, a community, a question or comment) is
  published, it is checked automatically by our AI provider (see above) for harmful content. Text that the check isn't
  sure about is reviewed by a person at Nearby before it is published. Messages in a gathering or community chat are
  checked the same way just after they are sent; a message found harmful is hidden and kept for review. We keep a
  record of each check (a one-way code of the text and the result, never the text itself) for up to 30 days. Private
  one-to-one messages are not checked this way."
  Verified: `ugc_screenings` stores `text_sha256` + result, purged 30 days after validity; held text waits for a person;
  chat queue rows purged 7 days after done; 1:1 and group-plan chats excluded.
- **0400:** "If you submit an ID for verification, we delete the photo of your ID and the selfie 7 days after the
  review if it is approved, 30 days after if it is rejected, and at once if it is never reviewed within 60 days (it is
  then rejected). When you delete your account, they are deleted within about an hour. We keep a record that a check
  took place (its status and dates), never the images. Images are kept longer only if a legal hold applies."
  Verified: 0400 header (retention table, hourly job, legal holds, record without images). Note: new ID uploads stay
  refused until a separate admin migration turns them on.
- **0428 / Resend:** "If you run a business on Nearby and have no notification device, we email you business alerts
  (for example a new request) through our email delivery provider Resend. The email contains the alert and a link to
  the request; it never names the customer before they accept your offer."
  Verified: send-push email fallback only for owner alerts, only to a verified business email; customer identity
  never in a business payload before acceptance. Add Resend to the providers list at the same time.

## What counsel is asked to return
1. Part 1 approved (or edited) for immediate publication.
2. The answers to the Part 1 questions.
3. Part 2 wording approved in principle (each still publishes only with its migration).
