# First device / browser session checklist (2026-09-19)

No simulator, device or browser has ever been available to any session, so everything below is unit-tested (Jest 930) and
live-verified against Supabase with rolled-back data, but never *seen*. This is the ordered list for the first session that
has a phone and a browser. **Stop-and-fix any failure before moving on; each step depends on the one before.**

## A. Already verified by automation (do NOT re-test by hand)
- Data rules: 5-distinct-person floors (demand card, availability preview, post-availability count, unfulfilled, weekend, match-fit),
  owner-only authorization on every business RPC, business-safe payloads, discount cap, occasion offering, dietary union -- all
  via `scripts/live-verify/*.js` against prod, rolled back.
- Pure logic: opportunity card copy, match reasons, budget tiers, quick-offer payloads, blended ranking, experience assembly,
  attribute vocabulary parity (client == every CHECK == every edge list), web-parity seams, motion budget / Reduce Motion policy.
- Email fallback handler logic (stubbed deps): verified+enabled address only, mute honored, token owners get push not email.
- Migrations: from-scratch Docker replay (212 migrations) was clean as of `20261218`; later ones were applied live only.

## B. Needs a real browser (business web, `docs/business/` on GitHub Pages) -- do first, cheapest
1. Sign in as a business owner; dashboard loads with five tabs (Home / Opportunities / Bookings / Offers / Profile).
2. **Profile -> "Tell Nearby about your business"**: type the Italian-restaurant sentence -> chips read back -> Edit un-checks one -> Yes, continue -> values appear in Edit Profile. *(Blocked until the Anthropic key has credit; see status below.)*
3. **Occasion / group capability editing**: Offers tab occasion chips save per tap; party-type chips save; refresh and confirm persistence.
4. **Opportunities**: a pending card shows "Why" bullets; Accept -> Standard availability; Offer Alternative time picker (date/time inputs work in the browser); Decline reason sheet.
5. **Alerts**: confirm dialogs actually appear (Cancel Reservation, delete package) -- `webAlert` adapter is the riskiest web seam.
6. **Home tab**: "Demand near you" (expect the "still gathering activity" state on prod's tiny data), "Your business matches N", More tools collapse.
7. **Offer Performance**: "How well your matches land" is absent until 5 people answer (expected; not a bug).
8. **Post a Moment** via the browser file picker; **confirm redemption** with the 6-digit code.
9. **Gatherings / communities** on web: create, edit, detail, chat; location picker (address search / business address / browser location); ViewProfile.
10. **Stripe onboarding handoff (TEST MODE only)**: start onboarding from the site, complete in Stripe-hosted test flow, land back on the business URL. Any live-key attempt must return 503 -- confirm it does. **Do not proceed past a Stripe approval checkpoint.**
11. Note "QR scanner": there is no QR scanner in the app (no expo-camera); redemption is 6-digit entry on both surfaces. Nothing to test.

## C. Needs a real device (consumer app)
1. Cold start, Reduce Motion off then on: motion components, N loader, tab/mode/filter transitions, pull-to-refresh.
2. Onboarding end to end (goals -> interests -> looking-for -> location -> notifications -> account) and Home "What you're here to do" chips.
3. **AskBusiness -> BusinessRequestDetail**: submit a request; see offers ("Nearby found N options"); "I'll take this one" -> "You're booked" -> Add to Calendar (native compose sheet).
4. **Good match?** after a plan: answer the optional question in `OfferOutcomeModal`; confirm Home later credits "You loved this kind of experience".
5. **Push**: opportunity (urgent only), digest, offer received, tap routing to the right screen; mute groups honored.
6. "Make it a night" suggestion on Home for a tonight/weekend date ask (needs real inventory in >= 2 components; may legitimately not appear).
7. Settings: goals edit, interest groups, "Clear my activity history".
8. Share cards (view-shot) and calendar export.

## D. Needs both surfaces (state-machine parity)
Consumer request -> business opportunity appears on web -> Accept/Offer on web -> consumer sees offer on phone -> accept -> reservation on both -> cancel from either side (reason sheet is optional) -> both show the same status.

## F. Sponsored placement (2026-09-20; only after `SPONSORED_TEST_MODE_RUNBOOK_2026-09-20.md` steps 1-3)
- Web + phone: Promotions panel layout (chips wrap, date chips, payment button, released hold), Stripe test checkout return.
- Phone: Sponsored card on Discover Places/Perks (label visible, Hide/Report/Why work, appears once, never in All/search); Settings switch + Reset.
- Admin: Settings > Sponsored Refunds (Admin): list, confirm sheet, refund, then placement stops serving.

## E. Blocked on the owner, not on testing
- **Anthropic API credit**: the project's `ANTHROPIC_API_KEY` returned "credit balance is too low" on 2026-09-19, so *every* AI edge function (Tell Nearby, create-assistant, screening) currently 500s. Top up before any AI step above.
- **Resend** secrets (`RESEND_API_KEY`, `EMAIL_FROM`, optional `BUSINESS_WEB_URL`) for the email fallback; then add an address on the dashboard card and confirm the 6-digit code -- the only real end-to-end test.
