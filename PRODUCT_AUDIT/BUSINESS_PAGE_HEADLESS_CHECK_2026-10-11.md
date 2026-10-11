# docs/business.html - headless browser check (2026-10-11)

Owner scope: verify rendering, links, console errors and form interactions in a headless browser; the real-browser review stays
OPEN until the owner checks it personally (item 168 follow-up 2).

**How:** `scripts/web-check/business-page-headless.py` (run command at its top): Playwright 1.47 / Chromium in Docker, the page served
locally from `docs/`, desktop 1280x800 and phone 375x812. **Every request to Supabase was intercepted**: no application reached
`submit-business-application`, no row was written to `business_acquisition_events`.

**Result: 56/56 checks pass** (desktop, phone, server-error run, offline run).

| Area | What was checked | Result |
|---|---|---|
| Rendering | HTTP 200, title, no horizontal scroll at 1280 and 375 px, screenshots reviewed | pass (one layout issue, below) |
| Links | 4 in-page anchors have targets; 3 local links (index, privacy, terms) return 200; no external/mailto/tel links | pass |
| Console / JS | no console errors, no page errors, no failed requests; only third-party host = the Supabase project (intercepted) | pass |
| CTAs | all three buttons reveal the application form | pass |
| Validation | empty submit -> name, category, address, name, email, phone, authorization, each with its own message, in order | pass |
| Categories | "coffee" -> Food & Drink -> Coffee; activities, other categories and attributes appear; other categories stop at 5; customer-only "Date Night" never offered | pass |
| Submit | one request with the expected payload (category, subcategory, 5 extra categories, honeypot empty); success hides the form and shows the phone | pass |
| Failures | server 400 -> its message, form kept, button re-enabled; network failure -> "Could not reach Nearby...", button re-enabled | pass |
| Funnel | landing_viewed + cta_clicked fire (intercepted) | pass |

**Found, not changed (owner to decide):**
1. **Phone header wraps:** at 375 px the nav (What you can do / How it works / Pricing / FAQ) wraps beside the logo and
   "How it works" breaks across two lines. Rendering only; a small CSS change (hide or move the nav on narrow screens).
2. **"6 interested" in the customer-preview mock** (`docs/business.html` line ~732, "7:00 PM · 6 interested"), right above the
   caption "not a mockup with invented numbers". It is an invented figure (truthfulness rule), and it shows an Interested count
   to a viewer, which the locked privacy rule forbids (Interested is never shown or counted to another viewer).

## Follow-up: both findings fixed (owner approved, 2026-10-11)

1. **Phone header:** at <= 600 px the nav sits on its own row under the logo; each label is `white-space: nowrap`
   (so "How it works" never breaks); the row wraps only between labels (at 320 px "FAQ" moves to a second row). Font size
   unchanged; links got 6 px vertical padding for a larger tap area. Desktop layout unchanged.
2. **"6 interested" removed** from the preview mock; the line now reads "7:00 PM" only. No number or other interest
   representation put in its place.

**Re-run: 100/100 pass** (the original 56 + 4 mock checks on desktop/phone + 4 header checks at each of 320, 360, 375, 390,
414, 600, 601, 768, 1024, 1280 px: every label on one line, no overlap with the logo, every label on screen, no horizontal
scroll). The same script against the previous page fails 6 of them (the mock count on both viewports, "How it works" split at
360 and 375), so the new checks do catch the old problems. Unit tests 419 suites / 5,663 pass. Journeys not re-run: the page
is static HTML outside every journey.

**Still open, not claimed by this check:** the owner's own review in a real browser (desktop and phone); nothing here
is a phone verification. Logo (owner approved, same day): it rendered as "Near by" at all widths (the brand's flex `gap`
also applied between "Near" and the "by" span); FIXED by moving the 8 px to the icon's right margin. A check per header width
(10 widths) measures 0.0 px between "Near" and "by": **110/110 pass**. The same gap on
`docs/invite.html`, `docs/occasion-invite.html` and `docs/shared-night.html` was then FIXED the same way (owner approved):
`scripts/web-check/public-pages-logo-headless.py`, 3 pages x 5 widths (320, 375, 414, 768, 1280) x 5 checks (one word,
icon keeps 8 px, logo on screen, no horizontal scroll, no console/JS errors): **75/75**; the old pages fail only the
one-word check (15/15 widths). Those pages were loaded without an invite link (Supabase intercepted, empty data), so
only their shell and logo were checked, not a real invitation.

**Not covered (still open):** a real browser (Safari / Chrome on a phone and a desktop) by the owner; real email/phone formats
the server rejects; the live submit path end to end (deliberately never called).
