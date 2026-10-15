# Nearby — Project Instructions

Nearby is a proximity-based dating/social discovery app (React Native/Expo, Supabase backend).
Supabase project ref: `enmosvippabmuqslzrox`. A Management API access token lives in
`.claude/mcp.json` (gitignored), used via direct `curl` against
`https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/database/query` for schema
inspection/migration application (the Supabase MCP server has not been reliably available).

## How this file is organized (slimmed 2026-10-11)

This file holds only what is OPEN plus the locked rules in short form. The complete record (every
finished item's build + verification trail, and the full text of every rule below) is in
**`CLAUDE_HISTORY.md`**, newest first; its top section is the full CLAUDE.md as of 2026-10-11.
Grep it by item number ("item 86"), migration number ("20270222") or feature name. Open it when you
need the reasoning behind a shipped feature, not "just in case".

**Standing rule:** keep this file to a few hundred lines. When work finishes: (1) put the full account
at the TOP of `CLAUDE_HISTORY.md`, (2) leave at most one status line under "Open work" (none if it
needs nothing further), (3) fold any new locked rule into "Standing conventions" as ONE short bullet.
Locked items say "do not reopen": respect that unless the owner reopens them.

## Master principles (owner item 87, locked)

1. **Optimize the journey, not the screen.** Every recommendation, gathering, invitation, request, offer,
   notification, CTA and destination reflects the object's ACTUAL state and leads to the right next action.
2. **One source of truth per object** (a server function/table + one shared client helper such as
   `objectState.js`, `objectLifecycle.js`, `primaryAction.js`, `homeSignalMerge.js`,
   `recommendationContext.js`). Never a second representation that can drift; a drift symptom is fixed
   in the shared source, never patched per screen.
3. **Audit by journey:** creation -> discovery -> action -> completion for Gathering, Invitation,
   Interest, Business Request, Offer, Reservation/Redemption, Recommendation, People Match. A change is
   verified by its journey in `src/journeys/` (`npm run journeys`; needs `SUPABASE_ACCESS_TOKEN`, runs in
   one rolled-back transaction). Report which journey covers it and which steps stay uncovered. A
   user-visible flow change is not done until its journey exists or is extended and passes.
4. **Audit as one connected system:** a UI symptom is evidence of a state/routing/data gap; fix the
   shared helper or rule so every surface inherits it. Never a duplicate flow or parallel schema.

## Open work

**Next priority (owner, 2026-10-10):** verify the whole offer experience on a real phone and browser,
not more features: `PRODUCT_AUDIT/OFFER_EXPERIENCE_DEVICE_CHECKLIST_2026-10-10.md` (not yet run; needs
Anthropic credit first).

**Item 31 (Interested -> Attending) is OPEN until** native-speaker review of its 11 strings and a device check are
recorded in `PRODUCT_AUDIT/ITEM_31_INTERESTED_TO_ATTENDING_REVIEW_2026-10-11.md` (built, tests and journey pass).

**Item 32 (offer merges into Your Plan + confirmed-plan look) is OPEN until** every check in
`PRODUCT_AUDIT/ITEM_32_DEVICE_CHECKLIST_2026-10-11.md` is recorded as passed on a real device (device, OS, appearance mode,
results), and `titleAtBusiness` has native review. Tests and parse checks are not visual sign-off. The checks:
(1) connecting line: faint and broken before booking, solid success green after, draws smoothly top to bottom, lines in order
activity/time/place/people, still solid after navigating away and reloading, visible in light and dark; (2) logo: none on the plan
before acceptance (no bias between offers), screened logo replaces the 📍 after booking, recognizable at 18 px, still there on a
completed plan, screened source only, missing or failed logo falls back to 📍; (3) assembly: the card waits while the chip
travels, logo and line wait for it to land, text always readable, no flicker/shift/flash, under 0.9 s, Reduce Motion = finished
card at once. Keep the 14 confirmed-plan-look tests and the offer-journey tests intact. Item 33 (reservation confirmation) is covered by item 32 as built (owner, 2026-10-11).

**Item 36 (weather contextual layer) is APPROVED, READY FOR DEVICE VERIFICATION (not device-verified) until** every check in
`PRODUCT_AUDIT/ITEM_36_WEATHER_LAYER_DEVICE_CHECKLIST_2026-10-11.md` is recorded on a real device (owner: wording and card-only scope locked).

**Item 37 (strong match) is APPROVED, READY FOR DEVICE VERIFICATION (not device-verified) until** every check in
`PRODUCT_AUDIT/ITEM_37_STRONG_MATCH_DEVICE_CHECKLIST_2026-10-11.md` is recorded on a real device AND native review of `vocab.confidence.high`
is done; then close it without expanding scope (owner: wording, ticks-as-intent, interaction LOCKED; ranking/device not verified by this item).

**Item 39 (friend is nearby) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_39_FRIEND_NEARBY_DEVICE_CHECKLIST_2026-10-11.md` is recorded on two real phones AND native review of the 8
`ui.friendNearby.*` strings is done (migration 20270296; journey `friendNearby` passes).

**Item 40 (friend + activity collision) is APPROVED (owner, LOCKED), READY FOR DEVICE VERIFICATION until** every check in
`PRODUCT_AUDIT/ITEM_40_FRIEND_ACTIVITY_COLLISION_DEVICE_CHECKLIST_2026-10-11.md` is recorded on two real phones (incl. #15: shared
interest, nearby and attending stay three distinct facts), native review of `ui.friendNearby.together` / `togetherA11y` is done, and a
from-scratch migration replay is done before claiming fresh-install verification (migration 20270297; journey `friendNearby` 15/15). Do not expand scope.

**Item 41 (friends are making plans) is APPROVED (owner, 2026-10-11), READY FOR DEVICE VERIFICATION until** every check in
`PRODUCT_AUDIT/ITEM_41_FRIENDS_PLANNING_DEVICE_CHECKLIST_2026-10-11.md` is recorded on a real device (journey `friendsPlanning`; no new strings).

**Item 43 (Create: formation on publish) is APPROVED (owner, 2026-10-11, LOCKED), READY FOR DEVICE VERIFICATION until** every check in
`PRODUCT_AUDIT/ITEM_43_GATHERING_FORMATION_DEVICE_CHECKLIST_2026-10-11.md` is recorded on a real device (journey `gatheringFormation`; no new strings). Do not expand scope.

**Item 44 (map pin grows into the business sheet) is APPROVED (owner, 2026-10-11), BUILT, DEVICE VERIFICATION PENDING until** every check in
`PRODUCT_AUDIT/ITEM_44_PIN_TO_SHEET_DEVICE_CHECKLIST_2026-10-11.md` passes on a real iPhone AND a real Android phone (anchor alignment incl.
Android status bar, timing, interaction, Reduce Motion); then close it. Keep as built; `PIN_HEAD_LIFT` (18 px) changes only on device evidence. No new strings.

**Item 45 (search understanding chips) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_45_ASK_UNDERSTOOD_DEVICE_CHECKLIST_2026-10-11.md` is recorded on a real device (journey `outdoorMatch`; no new strings).

**Item 46 (refinement next-step emphasis) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_46_REFINE_NEXT_STEP_DEVICE_CHECKLIST_2026-10-11.md` is recorded on a real device (journey `outdoorMatch`; no new strings).

**Item 47 (offer countdown) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_47_OFFER_COUNTDOWN_DEVICE_CHECKLIST_2026-10-11.md` is recorded on a real device (journey `offer`; no new strings).

**Item 48 (business "signal received") is APPROVED as built (owner, 2026-10-12), BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_48_SIGNAL_RECEIVED_DEVICE_CHECKLIST_2026-10-11.md` is recorded with a real business + customer (journey `offer`; no new strings).
Owner: keep the existing headline (no "Someone is looking for this" unless business-owner testing shows it's unclear) and the locked Accept/Alternative/Decline.

**Item 49 (live Customer Preview in Make an Offer) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_49_LIVE_CUSTOMER_PREVIEW_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real phone and the business website (journey `offer`; no new strings).

**Item 51 (business's first offer confirmation) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_51_FIRST_OFFER_CONFIRMATION_DEVICE_CHECKLIST_2026-10-12.md` is recorded (needs Anthropic credit + a business with no offers yet)
AND native review of the 2 `ui.bizHelp.confirm.first*Title` strings (migration 20270299; journey `offer`; `partner-first-offer.sql` 13/13).

**Item 52 (first successful redemption) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_52_FIRST_REDEMPTION_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real device AND native review of
`ui.requestDetail.firstVisitNote` (10 languages) is done (no migration; journey `offer`).

**Item 53 ("N plans this month" + streak push retired) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_53_PLANS_THIS_MONTH_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real device AND native review of
`ui.home.plansThisMonth` / `plansThisMonthA11y` is done (migrations 20270300 + 20270301; journey `plansThisMonth`; live `streak-nudge-retired.sql` 7/7).

**Item 54 ("You've been into X lately") is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_54_NOTICED_ACTIVITY_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real device AND native review of the 3
`ui.home.noticed*` strings is done (migration 20270302; journey `noticedActivity`).

**Item 55 (the Nearby Pulse, consolidation) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_55_NEARBY_PULSE_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real iPhone AND a real Android phone (no new strings, no migration). Owner (2026-10-12): scope closed at the five moments;
record device failures in the checklist without changing locked behavior to work around them.

**Item 28 (friend joins, LOCKED) is NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_28_FRIEND_JOINS_DEVICE_CHECKLIST_2026-10-12.md` is recorded on two real phones (written 2026-10-12; no new strings;
incl. item 73's checks 15-16: four joins in 10 s = one full + three small, full again after 10 s quiet).

**Device session order (owner, 2026-10-12):** item 55 first (its overlap map records shared results against items 44/48), then items 28
and 32, then items 82 and 84 (one phone, a few minutes), then the offer experience once Anthropic credit exists (never bypass screening). One phone first is fine: other platform stays PENDING.

**Item 62 (several replies -> one notification) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_62_REPLY_PUSH_REPLACE_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real iPhone AND Android phone, incl. whether each
replacement sounds/vibrates again (migration 20270303, send-push v23; journey `replyPushCollapse`). Fallback count line: not built unless the device shows it's needed.
Items 59-61 recorded as met (nothing built).

**Item 63 (replies ranked by what was stated; "Our pick" = fit + record) is BUILT, NOT DEVICE-VERIFIED, OPEN until** the request
screen is checked on a real device AND native review of `ui.requestDetail.pickFitsTime` / `pickWithinBudget` is done (migration
20270304 marks automatic policy/AI replies = unknown time; journey `offer` 28/28).

**Offer screens without screen-wide motion (owner, 2026-10-12) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/OFFER_SCREEN_WIDE_MOTION_DEVICE_CHECKLIST_2026-10-12.md` is recorded (incl. whether acceptance / the GroupPlan card exit feel jumpy: report, never add motion).

**Item 89 (signal path, 2026-10-15) is IMPLEMENTED IN CODE (items 48/25/23/62/32/52), nothing built, END-TO-END NOT VERIFIED until** the offer
experience checklist passes with a real customer + business (needs Anthropic credit); no "4 people are looking", no "picked up your request" (LOCKED).

**Item 93 (Phase D aligned with item 92, owner 2026-10-15) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_93_INTENT_VISIBILITY_DEVICE_CHECKLIST_2026-10-15.md` is recorded on two phones AND native review of the 3
`ui.settings` strings is done (migration 20270307; journey `intentVisibility`). Visual merge declined (LOCKED).

**Item 111 (2026-10-15) Best Pick reveal VERIFIED against the locks and DECLINED: card stays static, all information from frame one (LOCKED), nothing built.** **Item 110 (2026-10-15) Home as doors MET as built (surface jobs, weather card -> filtered Discover, items 27/45/109 doors), nothing built; in-place expansion, transitions and headline glyph DECLINED (LOCKED); device check C12.** **Item 109 (2026-10-15) "Tonight looks great" MET by item 34 (`meetTonight.js`: rules + grey reason line + Meet People -> People mode), nothing built; weather/activity reasons, "Strong People activity" and any transition DECLINED (LOCKED); device check C11.** **Item 108 (2026-10-15) live time labels APPROVED as built, NOT DEVICE-VERIFIED until** check C10 of `PRODUCT_AUDIT/FIRST_DEVICE_SESSION_CHECKLIST_2026-09-19.md` passes (shared minute clock on Home + Discover; no motion; no new strings). **Follow-up, OPEN, not scoped:** midnight rollover ("Tomorrow" -> "Today" only on the next redraw while a screen stays open) is a separate stale-label issue; needs its own defined scope before building. **Item 107 (2026-10-15) spatial distance MET by the distance-first context line (`formatDistance`, `validReasons`, detail "0.3 mi away"), nothing built; pin-to-card animation DECLINED (LOCKED); vague proximity on a phone = fix the shared filter.** **Item 106 (2026-10-15) tappable why MET by GatheringDetail's "Why this fits you" (`ReasonList`) + `recommendationSurfaces.js`, nothing built; why-sheet and assembly animation DECLINED (LOCKED); perk/community full reasons + Places personal reason = observations only, pending device evidence.** **Item 105 (2026-10-15) confidence builds MET by item 37 (`strongMatch.js`), nothing built; interests/friends/weather ticks, "Strong fit" and use on ordinary cards DECLINED (LOCKED); clarity via item 37's checklist.** **Item 104 (2026-10-15) "Who is this for?" MET by `recommendationContext.js` + item 37, nothing built; reason animation DECLINED (LOCKED); wording clarity = device check C9 in the first-session checklist (copy, never motion).** **Item 103 (2026-10-15) "Nearby Orbit" MET by items 28/73/43/32/34/95-98, nothing built; orbit, moving cards, face orbit and pre-acceptance logo DECLINED (LOCKED); join/assembly unification DEFERRED until both pass on real phones.** **Item 102 (2026-10-15) "living local network" vision (ask -> ... -> learns) + rarest signature MET AS BUILT (items 45/55/48/25/28/73/43/21/12/32/47/34/52/35/53/54/57), nothing built; signature-only-on-first-reply DEFERRED until a phone shows repetition (would reopen item 25).** **Item 101 (2026-10-15) DONE: motion spec rule + `PRODUCT_AUDIT/MOTION_SPEC_TEMPLATE.md`; no code or motion changed.** **Item 100 (2026-10-15) DONE, APPROVED as built (placements LOCKED): eight motion primitives = documentation-only `MOTION_PRIMITIVES` map + guard `motionPrimitives.test.js`;
no motion changed. Item 99 corrected: `occasionParticles` (item 58's locked exception) is the only place particles exist.**

**Item 99 (2026-10-15) motion restraint met by existing rules (items 22/25/36/57/58/122, tap-to-play video, calm tone, 900 ms cap,
Reduce Motion); nothing built, no new rule; no global/ambient/decorative motion or new transitions (LOCKED).**

**Item 98 (2026-10-15) "one object evolving" met by master principle 2, states-not-folders, item 45, item 58 and the in-place
transformations (items 12/32/30/31/34, 95-97); nothing built, no new rule; authorizes no new motion (LOCKED).**

**Item 97 (2026-10-15) gathering card lifecycle met by items 30/31/34 + the one viewer relation, nothing built; cross-screen
transformation, requested/waitlisted moments and motion in the recommended state DECLINED (LOCKED); NOT DEVICE-VERIFIED (follows items 30/31/34).**

**Item 96 (2026-10-15) card transformation met by items 12/32/34/52, nothing built; cross-screen transformation, an upcoming-state
transition and any duplicate lifecycle DECLINED (LOCKED); NOT DEVICE-VERIFIED until those items' existing checklists pass.**

**Item 95 (2026-10-15): design + implementation ACCEPTED (items 12/32, 33 via 32; nothing built; extra offer -> reservation -> plan
animation DECLINED, LOCKED); DEVICE VERIFICATION OUTSTANDING (owner runs it on a real phone; acceptance is not verification) until**
item 12's checks in `PRODUCT_AUDIT/OFFER_EXPERIENCE_DEVICE_CHECKLIST_2026-10-10.md` (booked card, confirming/failed, group; needs
Anthropic credit) AND every check in `PRODUCT_AUDIT/ITEM_32_DEVICE_CHECKLIST_2026-10-11.md` are recorded as passed.

**Item 94 (2026-10-15) met by items 12/13/32/49/93/149 (party size end to end), nothing built; offer templates, a "4 people -> 1 group offer" animation and aggregate demand claims DECLINED (LOCKED).** **Item 92 (2026-10-15) partly met (invites + item 40), nothing built; auto-pairing of asks DECLINED (LOCKED). Item 90 (2026-10-15) met by items 25/57 (the one signature = a business responds), nothing built, device check with item 89. Item 91 (2026-10-15) met by items 25/32, nothing built; never "match" for a business transaction (LOCKED). Item 88 (2026-10-15) mostly met by items 45/82/84/86, nothing built (no cross-screen travel animation; People only for people asks; LOCKED). Items 65/67/69/70/71/77/78/81/83 recorded as met, 66/68/74 declined, 72/75/76/79/80 partly met (nothing built). Perk redemption claimed vs confirmed (owner, 2026-10-12) is BUILT, LIVE,
NOT DEVICE-VERIFIED until** every check in `PRODUCT_AUDIT/PERK_REDEMPTION_DEVICE_CHECKLIST_2026-10-12.md` is recorded (migration 20270305; journey `perkRedemption`; live `confirmed-visit-counts.sql` 16/16).

**Item 82 ("Create it": what you said on Create's first screen; + item 85's settle on the opening step) is BUILT, NOT DEVICE-VERIFIED, OPEN until** every check in
`PRODUCT_AUDIT/ITEM_82_CREATE_FROM_ASK_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real phone (journey `outdoorMatch`; no new strings, no migration).

**Item 84 (request from an ask: carried facts + every missing field before Send) is BUILT, NOT DEVICE-VERIFIED, OPEN until** every check in
`PRODUCT_AUDIT/ITEM_84_REQUEST_FROM_ASK_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real phone (journey `outdoorMatch`; no new strings, no migration).

**Item 86 (search -> People) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_86_SEARCH_TO_PEOPLE_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real phone (journey `peopleMatch`; no new strings, no migration).

**Understood chips: People count + remove only (owner, 2026-10-15) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/UNDERSTOOD_CHIP_REMOVAL_DEVICE_CHECKLIST_2026-10-15.md` is recorded on a real phone (migration 20270306; journey `outdoorMatch`; no new strings). Decision 3 (change/pickers) DEFERRED until a phone shows remove-only isn't enough.
Item 87 (2026-10-15) is met by these chips + its resolver fix (`outdoors` is the setting when an activity is named; locked count rule), check 15 of that checklist.

**Item 34 (Plan complete) is OPEN until** every check in `PRODUCT_AUDIT/ITEM_34_PLAN_COMPLETE_DEVICE_CHECKLIST_2026-10-11.md` is
recorded on a real device (built; tests, the `planComplete` journey and parse checks pass; no new strings).

**Blocked on the owner:**
- **Anthropic credit:** every AI edge function returns 500 ("credit balance is too low"). Never run live:
  the intent extractor, offer/creative/logo/video screening (owner-typed content fails closed to "Try
  again"), "Read this for me", "See it in plain language", Tell Nearby extraction.
- **A device:** nothing has ever been rendered on a phone/simulator; all UI, motion and push work is
  unit-tested and parse-checked only. Checklists: `PRODUCT_AUDIT/FIRST_DEVICE_SESSION_CHECKLIST_2026-09-19.md`,
  the offer checklist above, `PRODUCT_AUDIT/VIDEO_SCREENING_DEVICE_TEST_CHECKLIST.md` (needs a new native
  build with `expo-video-thumbnails`). Also never run: realtime delivery to a real signed-in customer /
  business / host, a real push on a real phone, the business website in a real browser.
- **Live market:** seed 10-20 real businesses in the South Palm Beach market (real addresses, hours, largest
  group, offers, several categories), then real ask -> routing -> offer -> reservation -> outcome.
  Diagnose with `request_journey`, `intent_funnel_stages`, `routing_candidate_outcomes` (service role).
- **Resend secrets** (`RESEND_API_KEY`, `EMAIL_FROM`, optional `BUSINESS_WEB_URL`; the owner sets them,
  never paste the key in chat): the business email fallback is inert until then.
- **Stripe / sponsored:** test mode only; live needs `STRIPE_LIVE_APPROVED` (+ `SPONSORED_LEGAL_REVIEW_COMPLETE` for sponsored)
  set by the owner, counsel review of the sponsored terms (`v1-draft-1`), a named finance approver row
  (owner SQL), and an approval audit table before the first live checkpoint. Sponsored allow-list stays
  empty (serves nothing). Run `bash scripts/deploy-sponsored-functions.sh` before any sponsored test.
- **Native-speaker review** of all machine-authored non-English strings (most items since 2026-09-28).

**Item 168 (V1 category set) is LIVE (2026-10-11):** migration 20270294 applied, 3 edge functions deployed, merged; journeys
20/20 on the migrated DB. Still open, each tracked on its own: (1) native review of its labels in 11 languages; (2) the
business signup page (`docs/business.html`) in a real browser; (3) on-device check; (4) a from-scratch migration replay on an
empty DB (never done). `item168_backup` (the rollback snapshot) stays (owner re-confirmed 2026-10-11: keep it until the four follow-ups are done) until the owner explicitly orders its drop; dropping it
ends the clean rollback (`PRODUCT_AUDIT/ITEM_168_MIGRATION_RUNBOOK_2026-10-11.md`). Later: relevance review of a broad
Travel & Getaways interest weakly matching the 10 lodging categories.

**Waiting on evidence (do not build without it):** Momentum fold decision (`momentum_viewed` /
`momentum_cta_tapped` usage); removal of any relationship tool (B9 usage review); item 152 intent ->
action conversion; item 159 business-declared reach (only if requests are consistently too far); item
128 unmatched-ask analysis (trigger script `scripts/analysis/item-128-unmatched-ask-trigger.sql`); item 204
demand-backed acquisition (needs >= 25 distinct people per category in the market); a "High demand"
label (needs real comparison data); Discover first-viewport fit (needs a phone).

**Owner decisions on the former open questions (2026-10-11; recorded, NOT built -- each needs its own build ask):**
(1) "Mark as Completed" is never allowed before the scheduled visit date; (2) an "Also nearby (not a Nearby partner)" Places row is
allowed, clearly labelled, kept distinct from partners, never implying they take part in Nearby offers; (3) gathering age limits:
use the existing age/safety rules; inspect current rules and applicable requirements before proposing any change, no new restriction
without approval; (4) offer value only from saved offer + redemption data: shown only with a real price/discount AND a confirmed
redemption; never estimated revenue or invented value.

**Owner scope of 2026-10-11 finished** (records in CLAUDE_HISTORY.md): plan-chat push live; item 41 "See gatherings" dedupe; item 35
closed; `docs/business.html` headless 56/56. Left open from it: native review of the reworded Messages hint (10 languages); the owner's own
real-browser review of that page (its two headless findings, phone header wrap and the invented "6 interested", and the "Near by" logo gap are FIXED, headless 110/110; same logo fix on invite/occasion-invite/shared-night, 75/75). (b) DONE: "See gatherings" lists only friends' plans beyond the chips (`splitFriendsActivity` -> `friendsActivityMore`), absent when none.

**Known residuals, reported and left as is:** `submit_business_offer` is directly callable, so offer TEXT
can skip the classifier via a direct call; `profiles` itself is not block-filtered (a direct read by id
returns a verified profile); `viewer_blocked_either_way` / `is_blocked` are client-callable; one-way client
block filters remain in `gatherings.js`, `stories.js`, `ActivityScreen.js` and inline-block RLS on
`business_messages`, `stories` and story storage (allow-listed in `blockVisibilityGuard.test.js`); a
business owner can open a known person's verified profile like any user; a screened logo is an
owner-hosted URL; video duration metadata that lies consistently passes; Tell Nearby can half-save on a
network failure between its writes; `LOCK TABLE` remains possible with direct DB UPDATE rights.
Older disclosed gaps: surprise-excluded person not pre-filtered in invite pickers (server enforces);
gathering stops create no child plans.

## Backlog (not started; do not build without a direct ask)

Occasion group planning v2: complex RSVP, elaborate invitations, gift registries, seating charts, big
event pages, multi-day calendars. Also: per-offer weather override; Places as experience components;
cuisine on gatherings / multi-cuisine businesses; a business "Specialty" axis (decided NOT to build).

## Standing conventions (locked; full text and history in CLAUDE_HISTORY.md)

### Product doctrine
- **One concept: "What do you want to do nearby?"** Nearby connects People + Plans + Places + Businesses
  around that intent: a two-sided intent graph (consumer: "I want this"; business: "I can fulfill this";
  Nearby matches). A new feature must sharpen one side's statement or improve the match. Not an events
  app, dating app, social network, Yelp, Groupon, ad platform, reservation or weather app. Refuse the next
  step toward reviews, a deals feed, self-serve ads, a timeline, or reservation management beyond offer -> booking.
- **The business proposition is qualified local demand** ("people actively looking for what you sell, right
  now"), never advertising. Sponsored placements (phases 1-3 built) stay inert; no new ad features until
  the intent -> offer loop is proven live.
- **Nearby is useful without a business**; a business appears only where it genuinely helps fulfil the intent.
  "Ask nearby businesses" is a secondary link after the person's results, absent for public-place asks.
- **Businesses don't manage Nearby; Nearby manages the complexity.** The owner sees four nouns:
  Opportunities, Bookings, Availability, Profile. Never add a concept the owner must learn; never "CRM,
  pipeline, lead, funnel, prospect" in business copy (`businessPlainWordsGuard.test.js`).
- **The consumer never feels a marketplace:** "I want something -> we found options -> here's what I can do
  -> I'll take this one -> you're booked". Acceptance IS the booking; never off-app to finish.
- **Surface jobs:** Home = what should I do now; Discover = what exists around me; Create = make it happen;
  People = who with; Business = create value from local demand. Six dimensions: WHAT/WHEN/WHERE/WHO/WHY/
  WHAT'S NEXT. The ontology layers and the pipeline live in `constants/nearbyOntology.js`
  (`NEARBY_PIPELINE`, `SURFACE_PIPELINE`, `STAGE_CALLERS`, `ENTITY_LINKS`); a surface calls a stage's ONE
  source, never re-implements it; new stages/surfaces are registered there first.
- **Feature freeze lifted (2026-10-03)**; a direct request is always enough. Real external accounts or
  real money always need the owner present.

### Truthfulness
- **No invented numbers, signals or states.** Every figure, badge, reason and button traces to a real query
  result; unknown renders as nothing, never 0 or a guess. The screen agreeing with its data is the test (global rule 7).
- **Money figures never mix:** fee owed (billing estimate, itemized), value of offers redeemed
  (`get_partner_offer_value`, owner-set prices), potential value ("up to $X", request data only). Never
  "revenue", "earnings" or customer spend without an explicit transaction amount (none exists).
- Trending = >= `TRENDING_ATTENDANCE_MIN` (5) approved attendees, everywhere (`constants/trending.js`).
  Place/time labels each mean one thing (`constants/surfaceVocabulary.js`); add a label there before using it.
- **Relative time labels stay true while open (item 108):** only via `hooks/useMinuteClock.js` (`utils/minuteClock.js`; Home + Discover,
  guard `minuteClock.test.js`): ticks only near a shown window, paused in background, plain text, never motion or urgency styling.
- A Home claim needs a visible, substantiated trigger of its own kind, and its CTA names where it goes.
  Home may say nothing; no filler rows or zero stats (`homeQuiet.js`).

### Privacy
- **Business payloads carry the minimum:** structured fields + `business_safe_request_summary()`. Never raw
  text, profile data, ids, requester name (except after acceptance), plan kind, party type, attendees or
  social context, in an RPC or a push. Free-text note only on a request addressed to ONE business. Guard:
  `businessPrivacyBoundary.test.js`, `businessPayloadPrivacyGuard.test.js`.
- **Floor of 5:** every business-facing aggregate about unconnected people uses `demand_min_people()`
  (distinct people, secondary figures withheld below it, including subtraction leaks). Consumer/community
  coordination pushes stay at 2. Lasting consumer interests shown to a business need 5 sharing them.
- **No stranger discovery via intent** (item 92: never pair people, strangers or friends, from coincidental asks; a typed ask is never shown to another person). People surfaces show only connected people (accepted friends/matches);
  strangers are counts. Attendee identities: friends and fellow attendees see names, others see counts.
- **Shared business requests (item 93, LOCKED):** "People you know are also asking" = `intent_visibility` 'friends' (OFF by default,
  only Settings turns it on), accepted friends only, never matches; shows only `sharedRequestFactsLine` (category · day · party
  size), never raw text; combining still needs each person's consent; no merge animation.
- **Interested is private:** never shown or counted to another viewer, never a business request, never
  commercial intent; the only business use is the anonymous floored aggregate (consent switch).
- **Blocks hide both ways, server-side,** via `viewer_blocked_either_way` / `is_blocked` inside the read;
  never an inline `from blocks` in RLS, never a client read of `blocks` (`blockVisibilityGuard.test.js`).
- Behavior signals are private (`behavior_events`, owner-only, 90 days, Forget/Clear). Stated dietary/access
  needs live only in the request/search (stripped from search logs). Never-learned categories
  (`NEVER_LEARNED_CATEGORIES` = `_category_never_learned`, e.g. Faith & Spirituality) resolve a search but are
  never stored, learned or counted. Raw typed ask text expires after 180 days (any new column holding it joins the purge).
- **Friend is nearby (owner item 39):** mutual opt-in, OFF by default, only the Settings toggle turns it on (Home may only turn
  it off); accepted friends only, never matches; yes/no, fresh < 30 min, ~1 mi, decided in `get_nearby_friends()` (ONE friend,
  id/name/photo only, every "not nearby" cause = no row); foreground fixes only via `userLocation.js`; Home social line LAST,
  no push/event/analytics. Guards: `friendNearby.test.js`, journey `friendNearby`.
- Not LinkedIn: no professional search, graph, résumé or job fields; Job Title is never compared.

### Understanding asks
- **One resolver:** `resolveAsk` / `classifyCreateRequest` (deterministic fallback when AI is down).
  AI may suggest category/cuisine/attributes/title only; facts (time, occasion, group, party size, budget)
  must be in the words. **Time comes only from the person's words or a deterministic picker**; Nearby
  never invents WHEN. AI suggests, the person confirms, always.
- **Infer first; never re-ask what Nearby knows** (carry the ONE interpretation or read the source object);
  ask only what blocks the next step (a search never asks; sending to a business asks what day). Missing stays missing.
- Typed asks: eligibility (hard filters, unknown kept) before ranking (map-only passes). Hard: declared
  restrictions, closed hours at a dated time, largest group, category group, radius, budget below minimum
  spend. Everything softer only orders (want-more, groups we take, booking mode, budget, accessibility,
  distance words). Distance words never widen beyond 50 mi; transit has no effect.
- **Party count (item 87, LOCKED):** People = TOTAL headcount incl. the person, one rule `partySizeFromText`: "4 people / of us / party
  of 4 / table for 4" = 4; companions add you ("with 4 friends" = 5, "me and 3 friends" = 4); chip, Create and AskBusiness agree.
- A need = a need category AND task framing in the words; needs order availability > proximity >
  reliability > personalization. Urgency is the spontaneity scale, words only.
- Surprise Me / "I don't know" = one model: up to 3 labeled rows each backed by a real result, never logged.
- Temporary intent never becomes a preference and expires with its time window (`intentExpiry.js`); only
  the Discover session persists (device + account sync). Explicit current intent beats history.

### Recommendations
- **Ranking ladder (10 tiers, lexicographic):** intent > hard constraints > friends > availability > time >
  strong interests > business opportunity > weather > popularity > discovery (`constants/signalPriority.js`,
  `compareRanked`). All five consumer surfaces use it; business routing stays separate.
- Declared interest (5) > learned behavior (0-4, needs 2+ separate pieces of evidence) > single click (0).
  Under any stated constraint, learned affinity and history are only literal tie-breakers.
- **"How was it?" ranks both ways (item 35, SIGNED OFF 2026-10-11):** the latest word per host/business/kind (`get_my_experience_feedback`, read only via
  `utils/experienceFeedback.js`): loved +5 / Not for me -5 in the interest tier, scaled by account maturity (`feedbackWeight`:
  one early rating weighs less), most specific wins, cancels learned behavior for a Not-for-me kind; reorders only; Not for me
  shows no reason. Home, Picked For You, Discover gatherings, typed asks; NOT Discover business/perk lists, communities, people.
- **Replies to one request (owner item 63, LOCKED):** `rankReplies` in `utils/replyFit.js` only: replies meeting every STATED
  constraint (time; budget when given) first, track record only breaks ties per tier, unknown never counts, price never a weight;
  "✨ Our pick" = first + qualifies + established record; reasons only the constraints met ("Fits 7 PM", "Within your budget").
  Automatic replies (availability, package, `auto_reply` policy/ai) never confirm a stated time. Ties keep created_at order.
  Never "best", never a special card, lift or reveal; a non-qualifying reply stays listed.
- **One object, once per surface, all its real reasons.** Home priority: firstRun > yourPlans > expanded
  insight > weather > bestPick > pickedForYou > nearbyRightNow (`HOME_SECTION_PRIORITY`). Discover: one dedupe chain.
- **Cards** (`recommendationContext.js`, `gatheringCardModel`): What / Why (max 2 strongest reasons, section
  reason first when real) / one "distance · when" line / accepted-friend social proof / ONE state-aware
  action. "Because you like X" only for a declared interest; never "Matches your interests". Distance via
  `formatDistance`, time via `whenLabel`/`timeWindowState`.
- Home: intent box -> Picked For You (max 3) -> Your Plans (max 3) -> social line -> Nearby Right Now (max 3).
  Home never expands sections in place.
- **Empty asks (owner item 81, LOCKED):** no out-of-radius fallback, even labelled (the radius stays a hard filter; only an explicit
  rule change reopens it); no "similar activities" until item 128's analysis AND a real phone show empty results recur (then labelled,
  real results, existing taxonomy relations, never AI-guessed substitutes); the empty state stays static (item 58).
- Weather reranks silently and speaks only when it materially changes the picks; businesses are judged
  only by their declared weather setting.

### Taxonomy
- Frozen for V1 (item 168's V1 set is live) except the taxonomy-miss process (a reported real miss -> test case ->
  smallest existing fix: synonym, attribute combination, existing mapping; new category only if truly
  needed; never mined from raw search text). Never create a category because a business asked.
- Change only through the canonical path (`admin_preview_category_change` + `admin_*_category_tag`); ids and
  keys are permanent; a new tag-name column joins `category_tag_references`. A change isn't done while code follow-ups are open.
- Flat axes, never a deep tree: group -> tag -> declared cuisine; attributes, genre, skill, format, environment are separate facts.
  Synonyms map phrases to tags (a specific phrase beats a broad one; a canonical name maps only to itself).
- One primary category, up to 5 secondary (DB trigger), unlimited attributes; attributes never route. Customer-only tags
  (`customer_only`, e.g. Date Night) are never declared, posted, boosted or served by a business (item 185).

### Navigation and screens
- **Screen reduction (item 45):** same job = same screen; prefer change content > expand inline > sheet >
  dedicated screen (entity, distinct workflow, management, communication, transaction). Filters and modes
  never navigate. "See all" expands in place unless the list has its own management job (then: its destination, e.g. Plans).
- **Rule 14:** every route has a registry entry with a job A-F (`constants/screenRegistry.js`); presentation
  routes render an existing surface on top (`navigation/presentationRoutes.js`). A new screen ships with its entry.
- Five tabs: Home, Discover, Create, Activity, Profile. Pushes and links open on top of where the person was
  (`openOnTop`, return trail); Back restores exact prior state and scroll.
- States, not folders: one viewer relation per gathering (hosting > attending > requested/waitlisted >
  interested), filtered by surfaces, never a screen per state.
- Create Gathering: five steps (What, When & where, Who's invited, Details, Review & Publish); step
  validation vs publish validation (`createGatheringValidation.js`).

### State and actions
- Objects have named, finite states; derived states come from `utils/objectState.js`; allowed actions from
  `objectLifecycle.js` (`canDo`); CTAs from `primaryActionFor` in `primaryAction.js`. Never a CTA label or
  availability condition inline in a screen; fix "wrong button" bugs in the table. One explicit action per card.
- Capacity = TOTAL people including the host (`_gathering_guest_limit`, `gatheringFullness.js`).
  Every shown attending/going figure includes the host too (`attendingFigure`; host + 3 joined = "4 attending");
  thresholds (Trending >= 5) still compare joined guests.
  Events are gatherings + `format`; `ticket_required` is informational only.
- Each actor reports only its own side's state; server RPCs compute derived state.

### Motion
- Glyphs: N = system thinking, ✨ = discovery, ❤️ = romantic, 🤝 = platonic, 🎉 = celebration, ✓ = done, 🔒 = privacy.
- Motion only for real events (the six marketplace moments, matches, confirmations, a join seen by the host);
  no animated cards/tabs/lists. Budget tiers in `motion/motionBudget.js` (max 900 ms); tokens, never literal
  durations. Reduce Motion = settled state. Haptics only after the person's own tap. Business transactions
  use the calm tone; no confetti. **Animation never delays information:** info text starts >= 0.6 opacity
  (`infoOpacity`, guard `animationNeverDelays.test.js`). No category animations; no offer templates; offer video is tap-to-play.
- **Motion amplifies correct data, never hides incorrect data (owner, 2026-10-11):** a moment animates only data that is
  already final and agrees with its static view (same set, same count); a mismatch is fixed in the shared source, never covered
  by motion; a moment never starts on placeholders that swap mid-play, never claims a server fact before the server returns, and
  never narrates staged progress on a timer. Audit `PRODUCT_AUDIT/MOTION_TRUTH_AUDIT_2026-10-11.md`; guard `motion/motionTruth.test.js`.
- **Animation is interruptible (owner item 20):** a tap acts at once (no button waits on, or is hidden by, an
  animation; a tap during the match intro or the surprise reveal jumps to the end state), a swipe dismisses at
  once (arrival pill up/sideways, Undo toast, match modal down) via `motion/swipeDismiss.js`; pure overlays are
  `pointerEvents="none"`. Guard `animationInterruptible.test.js`.
- **Performance (owner item 22):** transform/opacity on the native driver (JS driver only where allow-listed: layout or
  PanResponder); loops only in ambient loaders, each capped at `AMBIENT.maxLoopMs` and paused in the background (`governLoop`);
  photos/logos shrink on the phone before upload (`utils/mediaBudget.js`); signed media addresses reused; video never
  preloaded/autoplayed. Guard `motionPerformance.test.js`.
- **Request -> reply transition (owner item 23):** a reply arriving while its request is on screen travels from the request
  line into its card (no dim, both ends visible, never scrolls), then builds in (`replyToTravel`/`landOfferTravel` in `offerTravel.js`).
- **Wow moments (owner item 25):** a business responding is the ONE signature moment (`signature` tier, <= 1.5 s, calm,
  same for every business; no other sequence may use it). Join on the host's gathering = count roll + avatar + named line;
  "plan comes together" = every piece confirmed (`isPlanFullyConfirmed`), never an attendee count. No hook after an early return (guard).
  Item 28: the joining face flows in from the side while the others ease aside (no arc); several in one update arrive one
  together into Who's going's overlapping cluster (host + joined faces + "+N", `attendeeCluster`); the line says "X accepted your
  invite" only for the host's own accepted invite to that person for that gathering (`acceptedInviteeIds`).
  Item 73 (owner, LOCKED; a host-live-join convention only, never a general mechanism): first one full, the rest small. The full
  moment plays after 10 s with no join (`JOIN_QUIET_MS`, `joinArrivalPlan` in `utils/hostLiveJoins.js`, from each join's arrival
  time, never animation end); a join within 10 s of the previous one fades in in place (`smallMs` 180, no slide/grow/glow), the count
  still rolls, the line counts the run keeping its name; in one update the lead is full, the rest small, no stagger.
- **Interested (owner item 30):** marking it by your own tap shows "✓ Saved" with one small pulse, then returns to
  "★ Interested" (`motion/InterestedSaved.js`, detail + Home card; toast with Undo kept; one save in flight per button).
  Item 31: your own auto-approved join FROM Interested shows "★ ~~Interested~~ → ✓ Attending" (one glow) atop You're in
  (`motion/InterestedToAttending.js`), only via `interestedToAttendingMoment` (confirmed attendance; pending/waitlist/plain: none).
- **Something is happening near you (owner item 26):** one ring from the happening-now heading glyph (Home Nearby Right Now,
  Discover Happening Now; `motion/HappeningRipple.js`) only when the section shows a gathering not yet shown this session
  (`utils/happeningSeen.js`, one store for both surfaces, judged only while focused). Rows never move (item 15 stands).
- **Offer -> plan merge (owner item 32):** your own confirmed accept merges the booking into Your Plan (`utils/offerToPlanMerge.js`,
  `motion/OfferToPlanMerge.js`): chip travels up, gentle scroll (own accept only; any touch stops it), one plan glow; it replaces
  plan-comes-together for that accept. A booked plan reads "{what} at {business}"; day/time/party show once, in the plan. Home unchanged.
  The plan card has a "Your Plan" label and one when line from `displayWhen` (shared whenLabel engine), booked or not.
  Confirmed-plan look: its four lines (activity, time, place, people) are joined on the left by `PlanJoinRail` from
  `buildPlanSummary().joinLine` (`planJoinLine`: solid success green once booked, for good; faint broken before; none if cancelled;
  never stored). The merge's ONE moment assembles them (`offerToPlanAssembly`: lines in order, logo into the place line, line draws, one glow; < 0.9 s).
- **Plan complete (owner item 34):** an attended gathering that is OVER (`timeWindowParts` phase, never while going) takes Your Plans'
  first row, plays "~~Confirmed~~ → ✓ Completed" once per gathering ever (`utils/gatheringCompletion.js`, stored ids; `motion/PlanCompleted.js`,
  medium tier, no glow/haptic) and asks "How was it?" inline (`GatheringFeedbackInline`); the auto-opening Home modal is gone. ONE scale
  `constants/satisfactionScale.js` (Loved it/Good/Okay/Not for me) for gatherings and offers; App Store prompt stays keyed to Loved it.
- **Weather layer (owner item 36):** only the Home weather card carries weather: a quiet wash + condition icon
  (`constants/weatherAtmosphere.js`, 3 wash tokens) that fades in once when the condition changes that day (`motion/WeatherShift.js`,
  `utils/weatherShiftSeen.js`); never app-wide, never particles, wording unchanged (item 192). Owner LOCKED: card only (not top
  of Home, Discover or Happening Now), no more animation; judge it on a device before considering anything broader.
- **Strong match (owner item 37):** a typed ask's top pick (Home, Discover) whose activity, stated time AND close distance all really
  match (`utils/strongMatch.js`, the one rule; unknown never counts) shows those pieces ticking ✓ then "A strong match for you"
  (item 61 wording, never "perfect") in place of Nearby Pick (`motion/StrongMatch.js`, medium tier). Never reorders, never elsewhere.
  Owner LOCKED: it explains why the result fits, never that it is the best; no separate "Your intent" step; never tick an unmet constraint.
  Item 38 (owner LOCKED): the phrase is reserved for that rule; personalization never qualifies. Item 61's Home cards (incl. 'high')
  say "You might like this" (`CARD_HEADLINE_LEVEL`, leak guard in `strongMatch.test.js`); no new strength wording without a product decision.
- **Friend + activity collision (owner item 40, LOCKED):** the ONE Home card (Best Pick, then Picked For You; never Discover or Nearby
  Right Now) whose interest the nearby friend (item 39) and you BOTH explicitly declared (`shared_tags`, server) says "You + {Name} might
  like this" (`utils/friendCollision.js`), faces converge (`motion/FriendCollision.js`, medium, once per friend+gathering per session).
  Explanation only: never reorders, never touches Best Pick selection or scoring, separate from item 37. Suppressed when either hosts or
  joined. Never implies the friend attends or is present beyond what attendance/item 39 state confirms; never the friend's other or
  inferred interests; nothing to any AI service. Item 39's "{Name} is nearby · Invite" stays the only Invite; not merged into sharing.
- **Friends planning (owner item 41, approved):** Home's friends-planning line assembles (faces one after another, then up to 3
  one-line chips: glyph + real title, each opening its gathering's detail; then the line; `motion/FriendsPlanning.js`, medium) only
  when its set of plans has an id not shown before (`utils/friendsPlanningMoment.js`); chips static otherwise (the ONE exception to
  "no animated cards"). "See gatherings" = only the plans beyond the chips (`splitFriendsActivity`), absent when none. Wording never "nearby" (not distance-filtered; no radius filter added for it). Query: `selectFriendsActivity`.
- **Formation on publish (owner item 43):** the published panel's card is what/when/who/where (`formationPieces`, only real
  pieces, from the stored row + real publish result; Where follows the review step's rule) settling in via the shared
  `PlanComesTogether` (one glow, special tier); "first gathering" is decided by Create before the panel shows. Owner LOCKED: headline "Your gathering is live!" (never "Your plan is ready":
  publishing is not acceptance); four pieces only; no new motion.
- **Pin -> sheet (owner item 44):** a Discover map business pin opens the item-17 sheet growing out of the pin (`motion/PinToSheetFrame.js`,
  `motion/pinToSheet.js`, `SEQUENCES.pinToSheet`, medium): sheet rises/grows (info floor, buttons live at once) while a pin-coloured outline
  travels from the pin into its edge. Replaces the slide, adds no other motion; rows and Reduce Motion keep the plain modal animation.
- **Ask understood (owner item 45):** a typed ask shows quiet chips of what its words gave (WHAT/WHEN/WHERE/WHO; unknown = none; never
  a refinement chip's piece) under the loader and above the results, Home + Discover, from `utils/askUnderstood.js` only
  (`components/AskUnderstoodChips.js`); settles once per ask (small tier), then static. Owner 2026-10-15: + a People chip only for a
  stated number (`statedPartySize`); on RESULTS each chip has ✕ = remove only (no pickers), via `refineTypedAsk('understood_<piece>')`,
  recorded as a refinement; `removedUnderstood` on the classification stops the resolver re-reading that piece from the same words
  and is honoured by Create/AskBusiness params. Loader and People-mode chips stay non-tappable.
- **Refine next step (owner item 46):** item 107's row unchanged (no time step, no new chips, Under $25); only the next unanswered
  step's chips (Who, then Budget; `nextRefinementStep`) carry a soft wash, fading in after the person's tap; none while refining/empty.
- **Offer countdown (owner item 47):** only an open offer's real last 30 min (`presentOffer().countdown` <- `offerCountdown`): the existing
  "Ends in N min" line in amber `inProgress` (never red) + a thin bar easing each real minute (`OfferCountdown.js`); no flash/pulse/loop.
- **Signal received (owner item 48, approved):** moment 1's business side: a still-answerable opportunity new to the device arrives (rise +
  requestPulse's rings from its ✨; max 3 per load; once ever; live on INSERT) via `utils/opportunityArrival.js`; wording/buttons unchanged.
- **Live Customer Preview (owner item 49):** Make an Offer shows the customer's card live above Send Offer (no separate preview step),
  from ONE mapping `utils/offerDraftPreview.js` + `OfferCustomerBody` + `presentOffer`; nothing before a description; a piece Send would refuse is left out.
- **Offer delivery (owner item 50, LOCKED 2026-10-12, approved as built):** the business's only media choice is attach a photo, a video, or
  nothing (no "Offer card / Photo / Video" chooser); items 10 (whole media in the fixed frame, video tap-to-play), 11/21 (one card for
  every business), screened logo beside the name only (no brand colours, fonts, templates, button styles; coral stays Nearby's), item 49
  preview above Send Offer. Businesses get freedom over WHAT they offer, never over how prominently it is designed. Do not reopen.
- **First offer (owner item 51):** a business's first-ever offer = ONE server claim `partner_first_offers` (trigger on the first row to reach
  'offered' by ANY path, PK `on conflict do nothing`; no client grants); the sent confirmation reads "Your first offer/reply is on its way"
  (`replySentConfirmation(.., { first })`, kind per item 121) from the edge function's `firstOffer` / `get_my_offer_submissions.is_first_offer`.
  Words only; never on the queued "saved" step; the customer's first-reply moment stays as locked.
- **First redemption (owner item 52):** the customer's earliest-ever completed offer (server: min `completed_at` on their own requests,
  `fetchFirstRedemptionId`, read with the offers) adds "You used Nearby to turn a request into a real-world experience." under
  "✓ Visit confirmed" (`presentOffer().confirmation.firstVisitNote`); words only, inside VisitConfirmed's one settle; later ones: none.
- **Plans this month (owner item 53):** Home's "N plans this month" (replaced the weekly recap; opens Your Activity) counts only what HAPPENED,
  decided by `get_my_plans_this_month` (attended + over + checked in or answered "How was it?", or an offer visit completed; one plan once;
  hosting/RSVP/Interested never) over the device's local month; shown at >= 1 only; rolls once via `CountRoll` for a new plan key
  (`utils/plansThisMonth.js`). The streak push is RETIRED (never nudge a streak; guard `streakNudgeRetired.test.js`); the streak on
  Your Activity stays until the Momentum fold decision.
- **Noticed activity (owner item 54, LOCKED wording):** under Picked For You, "N You've been into {X and Y} lately. See what Nearby
  noticed →" (Settings > What Nearby has noticed). Behavior wording only (item 60 stands: never "you like"/"seem to enjoy"); only
  specific canonical categories, never groups or made-up combinations; max 2. ONE rule `get_my_noticed_categories`: 2+ separate
  things DONE (join/create/accept/redeem, never views/searches) in 30 days, learned, surely listed in Settings, not declared, never
  never-learned. Each category offered on one local day only (`utils/noticedActivity.js`); no motion, push or profile change.
- **The Nearby Pulse (owner item 55, LOCKED):** the one motion language for a CONNECTION (a signal from one thing to another):
  `motion/NearbyPulse.js`, forms ring (`usePulseRings`/`PulseRings`), still (`PulseMark`) and journey (`PulseJourney`, `pulseGeometry.js`).
  Request sent, signal received, Happening near you, the Right Now mark and pin -> sheet draw only through it (`PULSE_MOMENTS` in
  `constants/motionLanguage.js`), each keeping its own approved tokens, size, colour, trigger and Reduce Motion rule. A new connection
  moment registers there and reuses the Pulse, never a bespoke animation; no new animated places. Business responds stays the ONE
  signature, outside the Pulse. Guard `motion/nearbyPulse.test.js`. Owner (2026-10-12): person-to-person moments stay OUT of
  `PULSE_MOMENTS` (no motion added to item 39, item 40 not reopened); the Pulse unifies existing motion, never a reason to animate more.
  Item 56 (owner, 2026-10-12): MET by the marketplace sequence + the Pulse, nothing built; business responds (signature), item 28's
  join, item 32's accept/merge and the redemption glow + "Redeemed" stay exactly as approved, never moved into the Pulse for uniformity.
- **Motion levels (owner item 57, documentation only):** `MOTION_LEVELS` in `constants/motionLanguage.js` names the existing tiers:
  Level 1 micro = tiny/small (functional, only where locks permit; cards, lists, recommendations static; mode/filter changes instant),
  Level 2 contextual = medium/special (meaningful, never signature), Level 3 = signature, exactly ONE: a business responds. Accept,
  redemption, first business interaction, plan formation stay as approved. Guard `motion/motionLevels.test.js`.
- **Animation must explain something (owner item 58, LOCKED):** a real change, a meaningful connection, or a narrowly documented
  exception; never decoration alone. Every `SEQUENCES` entry and every file animating on a raw tier token declares its meaning
  (`MOTION_MEANINGS`, `SEQUENCE_MEANINGS`, `DIRECT_TIER_MEANINGS` in `constants/motionLanguage.js`), a label only when accurate. The ONE
  exception: the occasion tile celebrations (kept as is, nothing added). The empty-state invitation's entrance is retired (settled
  at once). Raw-tier files may instead be a reviewed RENDERING transition (empty/error fades) or GESTURE (swipe-dismiss settle-back =
  cancelled, nothing removed); never a catch-all. Guard `motion/motionMeaning.test.js`: passing it is NOT proof all motion has meaning
  (it can't see spring/default-duration/untokened motion or judge label accuracy).
- **Motion primitives (owner item 100, documentation only):** every `SEQUENCES` entry names one of eight forms (pulse, flow, merge,
  reveal, transform, assemble, complete, ambient) in `MOTION_PRIMITIVES` (`constants/motionLanguage.js`); describes, never authorizes
  or unifies (item 56); Ambient = only `responding` + `weatherShift`. Guard `motion/motionPrimitives.test.js`.
- **Motion spec first (owner item 101):** before building or changing any motion, its build plan or history entry answers eight
  questions (`PRODUCT_AUDIT/MOTION_SPEC_TEMPLATE.md`): what changed, why motion helps, start state, end state, duration, immediate
  interaction, Reduce Motion, and does it still read without the animation. Guards: `motionMeaning`, `motionPrimitives`,
  `animationInterruptible`, `animationNeverDelays`. Prospective only; the existing sequences are not retrofitted.
- **No screen-wide motion on offer screens (owner, 2026-10-12):** a card animates only its own state change; never `animateLayout`/
  LayoutAnimation, an animated gap-closing height, or a full-screen dim there (accept, arrival pill travel, GroupPlan booked card exit).
  Item 32's scroll, item 55's pulse, the travel's light/frame stay. Guard `motion/offerScreenWideMotion.test.js`.
- **Create from an ask (owner item 82):** the "From what you said" card (`components/FromWhatYouSaidCard.js`, rows/steps from
  `utils/fromWhatYouSaid.js`) shows at the top of step 1 and on step 2 (unchanged, its guidance line step 2 only), one Hide for both;
  settles once per Create on whichever step Create opened on (item 85: step 2 for a fully understood ask; never on a later step
  change; item 45's `SEQUENCES.askUnderstood`, Reduce Motion = settled). Never a
  location/setting row ("near me" is Create's default); no cross-screen transition; navigation never waits.
- **Request from an ask (owner item 84):** "Ask Nearby Businesses" from an ask opens AskBusiness with item 82's card on top (rows
  `requestCarriedRows` via `askBusinessParamsFromAsk`: activity, the day the words said, People only via `statedPartySize`; never
  purpose/budget/defaults) and marks each missing required field under its label from `askMissingFields` (Send's `askMissingField` =
  its first, same `askForm`); Send's alert stays as backstop. Only `prefillFromAsk`; no optional field is ever marked.
- **Search -> People (owner item 86):** a pure people ask (the `detectFriendDiscoveryIntent` phrases + no activity; the
  'Make New Friends'/'Dating' tags only restate it) opens People mode, decided ONLY by `utils/peopleAsk.js` (`runIntentSearch`
  outcome 'people'; Home navigates with the Home card's params, Discover switches in place, Back returns to the ask). Dating/Friends
  only from the words, else the person's own default; tonight context only for the resolver's "tonight" ("now" = no banner).
  Activity asks keep results; the meet-people row opens People -> Friends in place from tabs, the FriendDiscovery presentation from stack screens.
  Above People, item 45's `AskUnderstoodChips` show what the ask said (`peopleAskUnderstood`; none = nothing, never a filler cue).
- **Right Now radar (owner item 27):** a still dot+ring mark (`components/RightNowMark.js`, never animates on its own) on those
  two headings, wording unchanged; item 26's ring is its only motion. The heading opens Discover's Happening Now view (Home via
  `RIGHT_NOW_VIEW`, the one link allowed to land in a date view; closing it restores Discover's prior mode/tab/search/category).

- **Perk redemption (owner, 2026-10-12):** claiming creates a code, only the business's confirmation is a visit. ONE rule
  `utils/perkRedemptionState.js` (available = Redeem, claimed = `PerkCodeBox` every time the perk opens, confirmed = "Redeemed") on
  Discover, community and business profile perks; never "Redeemed" before confirmation. Dashboard redemption stats and the perk tier
  count confirmed visits only (`confirmed_at`, bucketed by `redeemed_at` like billing).

### Copy, colour, errors
- Coral = primary action or selected state; status colours have their own tokens (`theme.js`).
- Empty states from `constants/emptyStates.js`, each with a real next step. Errors via
  `presentRecoverableError` (service failure = Try Again; input problem = the fix). Confirmations say what
  happened (`actionConfirmations.js`). Undo only for private, local, reversible actions (allowlist guard).
- **Offer Presentation Engine (owner item 21):** `presentOffer()` in `utils/offerPresentationEngine.js` decides how a
  reply is shown (card waiting/open/closed/booked/visited; rendering static/animated/confirmation; media image/video/
  "Video attached") from offer data + name/screened logo + context. The customer card, the owner's Customer Preview,
  `OfferAssembly` and `OfferMedia` read it; screens never decide an offer's presentation. It reads no payment/sponsor/rank
  fields and same content = same presentation for every business (item 17). Improve motion there, not per screen.
- Offers read as a personal response ("X made you an offer"), never an ad; sponsored is always labeled and
  separate. "I'll take this one" and "You're booked" wording are locked.

### Notifications
- Every push goes through `_send_push` (outbox, dedupe, retry); only `_push_outbox_deliver` calls send-push.
  New notifications for registry events are decided in that event's handler (`constants/domainEvents.js`).
- Reply pushes (`business_offer_received`, item 62): one notification per request, replaced in place (`collapse_key` 'offers:<request id>' ->
  Expo collapseId + tag); worded by `_refresh_reply_push` from the LIVE open replies at every hand-off (1 = the reply's own words, 2+ = count,
  0 = not sent); every reply still pushes at once; never grouped across requests, never delayed or staged.
- Plan group chat pushes (`plan_message`): recipients = `_plan_participant_rows()` (the chat roster's one source) minus the writer and
  blocks either way; the Messages switch; at most one per person per plan per 2 min; tap opens PlanChat.
- Each push type has one priority (`notificationTier.js`), one navigation-only action button
  (`notificationActions.js`) and one mute group (`notificationPreferences.js`, one store `profiles.notification_mutes`).

### Engineering discipline
- One migration per schema change; verify live with disposable data in a rolled-back transaction; disclose
  whether a from-scratch replay was done. Filename order must follow dependencies.
- `CREATE OR REPLACE` with a changed parameter list creates a second overload: check
  `pg_get_function_identity_arguments`, drop the old signature in the migration. New functions:
  `revoke ... from public, anon`. Trusted writes to guarded profile columns set `app.trusted_update`.
- Every name a source file reads is declared or imported (`screens/undefinedNames.test.js`; no device has ever run the app,
  so this guard stands in for a runtime check).
- Tests that depend on "now" freeze it; local-day fixtures use local wall-clock, never a UTC `Z` string.
- Location only through `services/userLocation.js`; location-targeted pushes join `push_target_areas`.
- Business web export (`docs/business/`): regenerate after any business-facing screen change
  (`NEARBY_WEB_EXPORT_BASE_URL=/Nearby/business npx expo export -p web`, copy `dist/*`); never put
  `experiments.baseUrl` in `app.json`.
- Commit and push after each increment (pre-authorized for this repo).

## Reference
- `CLAUDE_HISTORY.md`: full history (top = full CLAUDE.md as of 2026-10-11).
- `PRODUCT_AUDIT/`: audit docs; `V1_TAXONOMY_SPEC_2026-10-03.md`, `SCREEN_REDUCTION_AUDIT_2026-10-08.md`,
  `PRODUCTION_ARCHITECTURE_2026-08-15.md`, `SIGNAL_CONTRACT.md` are the most useful references.
- Tests: Jest on pure functions (`npx jest`); journeys in `src/journeys/`; live check scripts in
  `scripts/live-verify/`. No simulator/device testing has ever been available.
