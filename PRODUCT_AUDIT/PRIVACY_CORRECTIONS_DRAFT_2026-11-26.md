# Privacy Policy corrections for what is ALREADY live (draft, 2026-11-26)

DRAFT by Claude, not legal advice, NOT published. Owner + counsel approve every sentence first. Covers only processing that
happens today (build 87 + production at 0347), so it can go out before any migration. Staged-migration wording stays in
`PRIVACY_POLICY_GAP_AUDIT_2026-11-26.md` section B.

## Files
- Live candidate: `PRIVACY_CORRECTIONS_LIVE_2026-11-26.patch` = these sentences only, against today's `docs/privacy.html`
  (`git apply --check` passes). Publishing = apply it, update "Last updated", commit on main (GitHub Pages publishes it).
- Build 88's copy: the same sentences are already in `staged-docs/privacy.html` (same place: section 4, after the service
  providers paragraph), so the later publish of the staged page doesn't drop them.

## What changes and why (each checked against the code, 2026-11-26)
| # | Sentence | Evidence | Still to verify before publishing |
|---|---|---|---|
| A1 | **AI provider (Anthropic)**: what is sent per feature; names only for an introduction; never email, phone, exact location or account id; not used for training; a person can review a screening result | 15 edge functions call `api.anthropic.com`: screen-business-content (offer text, business profile, offer photos/video frames), moderate-chat-image (chat photo), translate-message, create-assistant / business-ai-assistant / business-onboarding-assistant / ai-concierge / rehearsal-chat / rewrite-offer-plain-language / read-offer-creative (what is typed or uploaded), generate-icebreaker + generate-strengths (interests, prompts, basics, bio), generate-introduction (shared interests, matching fields AND the other person's display name). No AI function sends email, phone, coordinates or a user id (grep of every function). | Anthropic's CURRENT commercial terms say API data is not used for training (counsel to confirm wording + whether to state Anthropic's retention period; I did not state one). Today the calls fail (no credit) but the content is still sent with each attempt. |
| A2 | **Cloudflare Turnstile** on sign-in: IP + device/browser signals, never phone or account | `utils/captcha.js` + `components/TurnstileWidget*` load `challenges.cloudflare.com` on Login (app + business website); Auth CAPTCHA enforcement is OFF, the widget still runs. | Counsel: whether Cloudflare is a processor or an independent controller for Turnstile (affects "under Cloudflare's privacy policy" wording). |
| A3 | **Expo** delivers push notifications: token + notification text | `send-push` posts to `exp.host`. Not in today's policy. | none |
| A4 | **GIPHY** GIF search: search words + IP from the device | `components/GifPickerModal.js` calls `api.giphy.com` directly. Not in today's policy. | none |

## Checked and already accurate (no change)
- Brevo (email): production Auth's SMTP host is `smtp-relay.brevo.com` (read 2026-11-26, that field only).
- Twilio (SMS): production Auth `sms_provider` = `twilio_verify`.
- PostHog, Sentry, RevenueCat: in `package.json` / `services/purchases.js`. Amazon Web Services: `moderate-photo`, `moderate-text`.
- Google Maps Platform section: unchanged.

## Not in this draft (separate, later)
- Spotify: an optional connection exists (0 accounts have ever connected). Add a sentence before it is offered to outside users.
- Stripe: test mode only; a payment sentence before live payments.
- Resend: production secrets not set; its sentence goes in before they are (gap audit B, 0428).
- Retention: these four add no new storage at Nearby, so section 5 is unchanged. (Anthropic / Cloudflare / Expo / GIPHY
  retention is theirs, under their terms.)
