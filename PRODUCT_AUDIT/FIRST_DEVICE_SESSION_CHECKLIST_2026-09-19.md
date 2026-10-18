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
9. **Recommendation reasons (item 104, 2026-10-15)**: on Home, Picked For You and Discover cards, the reasons (max 2) + the "distance · when" line + friend social proof read clearly at a glance and aren't truncated. Record any problem as copy/legibility, never as a motion request. **Item 112 (2026-10-15):** also the Home Best Pick hero ("Best Pick Tonight"): its two reasons and the "distance · when" line stay readable over the hero image, in light and dark.
10. **Live time labels (item 108, 2026-10-15)**: with a gathering starting within the hour, leave Home (then Discover) open: "Starts in N min" counts down once a minute as plain text (no fade/flash), becomes "Happening now" at the start time and the plain label after 30 min. Background the app for a few minutes, return: the label is correct at once.
11. **Meet someone new tonight (item 109, 2026-10-15)**: in the evening, with a meet-people goal and >= 3 people nearby, Home shows "Tonight looks like a great night to meet someone new." in normal text WITH its grey reason line beneath ("You're here to meet people, and N were near you in the last day."); readable; "Meet People" opens People mode at once (Dating/Friends per goals, banner, counted people first); Back restores Home. A red claim or a claim without its reason = investigate the actual build, never add a UI treatment.
12. **Home doors (item 110, 2026-10-15)**: each Home CTA opens the exact Discover state it names (weather card -> gatherings filtered to outdoor/indoor, not all; Right Now heading -> Happening Now; Meet People -> People mode; a typed ask -> its results), at once, and Back restores Home (and Discover) to its prior state. Weather card visuals: item 36's checklist. Fix only a verified mismatch; never add expansion or transition.
13. **Motion hierarchy on two axes (owner idea "168", 2026-10-18; verification only, never reopens the design)**: on a real phone, with Reduce Motion off then on, record whether what you see matches `MOTION_LEVELS` / `MOTION_PRESENTATIONS` in `constants/motionLanguage.js`: (a) Ambient: only the N "responding" loader and the Home weather card's wash fade, both barely noticeable; (b) Micro: button/state feedback stays small, cards/lists/recommendations never animate; (c) Contextual: joins, strong match, plan merge, plan complete, Pulse moments read as "something relevant changed", never louder than (d); (d) Signature: a business responding is the most prominent moment and the only one of its kind (needs Anthropic credit for a real reply); (e) Full-screen: the mutual match modal is the ONLY full-screen moment, and it does not feel stronger than the signature; first offer, accept/booking and gathering creation stay inline. Record device, OS, results; a mismatch is a defect to report, not a change to the levels.
14. **Home follows the period while open (idea "202" follow-up, 2026-10-18)**: wait in real time (the timer counts elapsed time, so changing the phone clock while Home is open is caught only on the next return to the app or to Home, which is the resume check below) through 11:59 AM, 5:59 PM and 11:59 PM on a weekday, and 11:59 PM on a Friday and a Sunday; keep Home open and untouched across each boundary: greeting, subtitle ("What sounds good ...?"), quick-pick header and picks switch to the new period within about a second, with no flicker, scroll jump or animation, and a quick pick tapped afterwards opens Discover under the NEW period's filter. Then background the app before 5:59 PM, return after 6:00 PM: Home shows evening at once. Switch to another tab across a boundary and back: Home shows the new period. With no boundary crossed, nothing on Home changes. Record device, OS, results.
15. **Day words roll over at midnight while open (item 108 midnight follow-up, 2026-10-18)**: on Discover AND Home, with a gathering shown tomorrow morning ("Tomorrow · …"), one the day after, and one several days out, keep the screen open and untouched across 11:59 PM -> 12:00 AM in real time (no phone-clock change): within a few seconds of midnight the first reads "Today · …" (or "Tonight · …" for an evening start), the second "Tomorrow · …", the third keeps its date; plain text only, no motion, nothing reorders or jumps. Then background the app before midnight, return after it: the right words at once. Record device, OS, results.
16. **One animation per Home visit (owner idea "207", 2026-10-18)**: set up a Home visit where several arrival moments are due together (e.g. the first open after an attended gathering ended, with a new "N plans this month" and something new in Nearby Right Now; ideally a nearby friend + a shared-interest card and friends planning too). Open Home: exactly ONE of them moves, the highest on the screen (friend collision > Completed > friends planning > Right Now ring > plans-this-month roll); every other shows its finished state from the first frame, all text readable. Leave Home and come back: none of them replays. The weather fade, "✓ Saved", toasts and typed-ask results still move as before. With Reduce Motion on: nothing moves. Known limitation (accepted, not a defect): if the friend card or friends-planning line arrives after the loading spinner has cleared and another moment already started, it shows finished; record whether that happened. Also try once on a slow connection (e.g. throttled): the moment that moves is still the highest among Completed / Right Now / plans-this-month. Record device, OS, which moment moved, results.

## D. Needs both surfaces (state-machine parity)
Consumer request -> business opportunity appears on web -> Accept/Offer on web -> consumer sees offer on phone -> accept -> reservation on both -> cancel from either side (reason sheet is optional) -> both show the same status.

## F. Sponsored placement (2026-09-20; only after `SPONSORED_TEST_MODE_RUNBOOK_2026-09-20.md` steps 1-3)
- Web + phone: Promotions panel layout (chips wrap, date chips, payment button, released hold), Stripe test checkout return.
- Web + phone: terms checkbox gates the payment button; "Read the terms" expands; "Cancel for a full refund" appears only for a paid, not-yet-started spotlight.
- Phone: Sponsored card on Discover Places/Perks (label visible, Hide/Report/Why work, appears once, never in All/search); Settings switch + Reset.
- Admin: Settings > Sponsored Refunds (Admin): list, confirm sheet, refund, then placement stops serving.

## E. Blocked on the owner, not on testing
- **Anthropic API credit**: the project's `ANTHROPIC_API_KEY` returned "credit balance is too low" on 2026-09-19, so *every* AI edge function (Tell Nearby, create-assistant, screening) currently 500s. Top up before any AI step above.
- **Resend** secrets (`RESEND_API_KEY`, `EMAIL_FROM`, optional `BUSINESS_WEB_URL`) for the email fallback; then add an address on the dashboard card and confirm the 6-digit code -- the only real end-to-end test.
