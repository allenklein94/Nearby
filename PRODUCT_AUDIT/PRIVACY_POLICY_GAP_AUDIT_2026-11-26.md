# Privacy Policy vs integrated functionality (2026-11-26, after build 88 merged into main)

Read-only audit. Nothing published. Compared: the PUBLISHED `docs/privacy.html` (live on GitHub Pages), build 88's staged
copy `staged-docs/privacy.html`, the app on main (build 88 source), production (0347) and the staged migrations 0348-0433.
Wording below is drafted by Claude, never legal advice: owner + counsel approve every sentence before it is published.

## Verdict
**No, the policy does not yet reflect the integrated functionality.** Two gaps are about what is ALREADY live (build 87 /
production today); the rest belong to staged migrations and must be published the same day each one goes live.

## A. Gaps that exist today (live, not waiting on any migration)
| # | What happens today | Policy says | Needed |
|---|---|---|---|
| A1 | Text and media are sent to Anthropic (AI provider) for screening and features: offer screening (`screen-business-content`), chat-image moderation, translation, "Read this for me", plain-language, create assistant, business assistants. Without credit the calls fail, but the content is still sent with each attempt. | Nothing about an AI provider (0 mentions). | New sentence in "How we share information" naming AI service providers, what is sent (only the content being checked or translated, not your profile), that it is not used to train their models (CHECK Anthropic's commercial terms before saying this), and that automated screening can be reviewed by a person. |
| A2 | Build 87's sign-in screen loads Cloudflare Turnstile (bot check) from the device (Auth CAPTCHA enforcement is OFF, the widget still runs). | Nothing about Cloudflare. | Sentence: "To protect sign-in from automated abuse we use Cloudflare Turnstile, which may process device and browser signals; see Cloudflare's privacy policy." |

## B. Must publish WITH a staged migration (drafted already; owner approved items 1-5 in principle 2026-11-26)
| Migration (batch) | Topic | Draft wording lives in |
|---|---|---|
| 0355 (2) | Reports keep the reported content, 12 months after resolution | `BATCH1_APPROVAL_PACKET_2026-11-25.md` "Privacy Policy wording" item 1 |
| 0357 (2), then 0368 version (4/6 with 0380) | Photo fingerprints for duplicate-account review | `TRUST_SAFETY_FIXES_2026-10-27.md` + `PHOTO_DETECTION_ACTIVATION_PLAN_2026-11-01.md` (the SHA-256-only version becomes untrue once 0368 is live) |
| 0373 (6) | Public text (profiles, gatherings, communities, chats, questions, comments, invites, requests) screened before it is saved, by an AI provider | NO draft yet: covered by A1's sentence if written broadly; add "public text you post" explicitly |
| 0374 (6) | Scrambled phone code kept 12 months after a suspended account is deleted | `TRUST_SAFETY_FIXES_2026-10-27.md` (0374) |
| 0375 (6) | Security-event log, 12 months | `TRUST_SAFETY_FIXES_2026-10-27.md` (0375) |
| 0376 (6) | One-way code of the device notification token, 90 days / 12 months | `TRUST_SAFETY_FIXES_2026-10-27.md` (shared device) |
| 0378 (6) | One-way code of repeated public text, 30 days | `TRUST_SAFETY_FIXES_2026-10-27.md` (shared text) |
| 0391 (7) | A reported photo is kept for review (deleted if no action, else 12 months) | `PUBLIC_MEDIA_AUDIT_2026-11-05.md` |
| 0396 (7) | Links in public text are sent to Google Web Risk | `LINK_SAFETY_2026-11-07.md` |
| 0400 (8) | ID document retention + deletion schedule | NO sentence found: draft from 0400's header before Batch 8 |
| 0402/0403 (8) | Deletion + limited records kept (legal preservation) | already written: `staged-docs/privacy.html` (sections 5 + 6) |
| 0413 (9, detector OFF until then) | One-way code of a website shared by several accounts, 30 days | `TRUST_SAFETY_FIXES_2026-10-27.md` (shared links) |
| 0414 (9) | Business details compared across applications (admin only) | business-comparison disclosure: drafted on the 0414 branch's fixes doc; `deploy.js` refuses 0414 until it is published |
| 0428 (10) + Resend secrets | Business owners without the app get emails sent through Resend | NO sentence: add Resend as an email processor before the production secrets are set |
| 0419 (10) | Service-area business sign-up | `staged-docs/business.html` (business page, not the policy) |

## C. Later, outside migrations
- Stripe: test mode only. Payment disclosure (Stripe processes card data; Nearby never sees the card) before live payments.
- Twilio Lookup (VoIP check): deferred; its sentence only if built (`VOIP_NUMBER_ASSESSMENT_2026-11-01.md`).

## Process
One policy change per publish: edit `staged-docs/privacy.html`, owner + counsel approve, copy it over `docs/privacy.html`
in its own commit on the day its migration deploys, delete the staged copy when nothing is left waiting
(`src/qa/stagedDocs.test.js` keeps the pending pages visible). A1 + A2 should go out first, independent of any migration.
