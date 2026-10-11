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

**Item 35 (feedback ranks both ways) is READY FOR OWNER SIGN-OFF** (live, migration 20270295; owner review applied: one early rating
weighs less for a new account). Not covered: Discover business/perk lists, communities, people.

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

**Open owner questions:** whether "Mark as Completed" may happen before the visit date; an "Also nearby
(not a Nearby partner)" Places row in experiences; the gathering age-restriction system (parked: needs
verified-age join/invite design first); where a real "offer value / potential earnings" figure would come
from (none exists; never estimate it).

**Known residuals, reported and left as is:** `submit_business_offer` is directly callable, so offer TEXT
can skip the classifier via a direct call; `profiles` itself is not block-filtered (a direct read by id
returns a verified profile); `viewer_blocked_either_way` / `is_blocked` are client-callable; one-way client
block filters remain in `gatherings.js`, `stories.js`, `ActivityScreen.js` and inline-block RLS on
`business_messages`, `stories` and story storage (allow-listed in `blockVisibilityGuard.test.js`); a
business owner can open a known person's verified profile like any user; a screened logo is an
owner-hosted URL; video duration metadata that lies consistently passes; Tell Nearby can half-save on a
network failure between its writes; `LOCK TABLE` remains possible with direct DB UPDATE rights.
Older disclosed gaps: surprise-excluded person not pre-filtered in invite pickers (server enforces);
no push for `plan_messages`; gathering stops create no child plans.

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
- **No stranger discovery via intent.** People surfaces show only connected people (accepted friends/matches);
  strangers are counts. Attendee identities: friends and fellow attendees see names, others see counts.
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
- **"How was it?" ranks both ways (item 35):** the latest word per host/business/kind (`get_my_experience_feedback`, read only via
  `utils/experienceFeedback.js`): loved +5 / Not for me -5 in the interest tier, scaled by account maturity (`feedbackWeight`:
  one early rating weighs less), most specific wins, cancels learned behavior for a Not-for-me kind; reorders only; Not for me
  shows no reason. Home, Picked For You, Discover gatherings, typed asks; NOT Discover business/perk lists, communities, people.
- **One object, once per surface, all its real reasons.** Home priority: firstRun > yourPlans > expanded
  insight > weather > bestPick > pickedForYou > nearbyRightNow (`HOME_SECTION_PRIORITY`). Discover: one dedupe chain.
- **Cards** (`recommendationContext.js`, `gatheringCardModel`): What / Why (max 2 strongest reasons, section
  reason first when real) / one "distance · when" line / accepted-friend social proof / ONE state-aware
  action. "Because you like X" only for a declared interest; never "Matches your interests". Distance via
  `formatDistance`, time via `whenLabel`/`timeWindowState`.
- Home: intent box -> Picked For You (max 3) -> Your Plans (max 3) -> social line -> Nearby Right Now (max 3).
  Home never expands sections in place.
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
  after another (`arrivalDelayMs`) into Who's going's overlapping cluster (host + joined faces + "+N", `attendeeCluster`); the line says "X accepted your
  invite" only for the host's own accepted invite to that person for that gathering (`acceptedInviteeIds`).
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
  "no animated cards"). Wording never "nearby" (not distance-filtered; no radius filter added for it). Query: `selectFriendsActivity`.
- **Formation on publish (owner item 43):** the published panel's card is what/when/who/where (`formationPieces`, only real
  pieces, from the stored row + real publish result; Where follows the review step's rule) settling in via the shared
  `PlanComesTogether` (one glow, special tier); "first gathering" is decided by Create before the panel shows. Owner LOCKED: headline "Your gathering is live!" (never "Your plan is ready":
  publishing is not acceptance); four pieces only; no new motion.
- **Right Now radar (owner item 27):** a still dot+ring mark (`components/RightNowMark.js`, never animates on its own) on those
  two headings, wording unchanged; item 26's ring is its only motion. The heading opens Discover's Happening Now view (Home via
  `RIGHT_NOW_VIEW`, the one link allowed to land in a date view; closing it restores Discover's prior mode/tab/search/category).

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
