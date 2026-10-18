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

**"Save for later" (owner idea "152", 2026-10-17) MET BY ITEMS 30 + 31 + Plans' "☆ Interested" row, LOCKED, nothing built:** no separate Save/bookmark state, no "You saved this" or other saved-state strings, no saved businesses/places/favourites list. Host count DECIDED (owner, 2026-10-17, LOCKED): item 139's anonymous count stays, host-only, aggregate-only (privacy bullet "Interested is private"); journey `interestedPrivacy` 12/12 under real roles, guard `interestedHostCountGuard.test.js`. NOT DEVICE-VERIFIED: items 30/31 phone checks + item 31 native review; record results and defects before closing.

**"Not interested" (owner idea "153", 2026-10-17, LOCKED) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_153_NOT_INTERESTED_DEVICE_CHECKLIST_2026-10-17.md` is recorded on a real phone AND native review of the 11
`ui.notInterested.*` strings is done (migration 20270327 LIVE; journey `notInterested` 20/20 under real roles; prod journeys 539/539; replay 451/451 + journeys 539/539).

**Swipe is a choice, never the default (owner idea "156", 2026-10-17, LOCKED) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/IDEA_156_FRIENDS_LIST_FIRST_DEVICE_CHECKLIST_2026-10-17.md` is recorded on a real phone AND native review of the 7 new/reworded
strings is done (migration 20270328 LIVE; journey `friendDiscoveryChoice` 6/6; prod journeys 545/545; replay 452/452 + journeys 545/545). Met everywhere
else as built. Swipe stale-card defect (both decks: a swipe after the first acted on the FIRST card again, deck stuck) FIXED 2026-10-17 by the
shared `utils/swipeDeck.js` (owner-ordered; regression `swipeDeck.test.js` 23); NOT DEVICE-VERIFIED (checks 17-25 of that checklist, both decks).
Dating's deck buttons now show a word under each symbol (Skip / Wave / Notice / Rewind, owner 2026-10-17, `utils/datingDeckActions.js`); NOT DEVICE-VERIFIED (checks 26-29) and its 4 `ui.swipeCards.deck*` strings need native review.

**"Ask a business" signature (owner idea "157", 2026-10-17) MET AS BUILT, LOCKED, nothing built:** Send replaces the form with the request screen ("Request sent to {name}. You'll be notified when they respond." + item 55's Pulse rings only when really reached); a reply travels into that screen's card (item 23, the ONE signature, item 25); the push opens that exact reply (items 62/132). DECLINED: a signature on Ask, a folding card, a redirect to Home/Discover. NOT DEVICE-VERIFIED: offer checklist section 1 (incl. whether N->✨->✓ + rings together feel like too much; report only).

**"Ask nearby businesses" spreading (owner idea "158", 2026-10-17) MET AS BUILT, LOCKED, nothing built in the app:** "We asked N nearby businesses. You'll be notified when they respond." at once, N = businesses REALLY reached (one offer row each, from `create_business_request`'s `notifiedCount`; never searched/matched; duplicate and nobody-reached = 0, no rings), item 55's two soft rings behind it, Reduce Motion = line only, form replaced by the request screen. DECLINED: a larger animation, the count after the animation, "N businesses can potentially help". Proven by journey `requestSentCount` 6/6 (prod journeys 551/551) + `marketplaceMoments.test.js`; NOT DEVICE-VERIFIED: offer checklist section 1.

**No premature "sent" (owner item 159, 2026-10-17) MET AS BUILT, LOCKED, PENDING REAL-PHONE VERIFICATION (offer checklist section 1, slow-connection + failure checks):** while sending only the button spinner; "We asked N…" + rings + success animation only after the server returns (requests saved to the reached businesses' Opportunities; never claims push delivery or that an owner saw it); failure = existing retry, draft kept. DECLINED: a "finding eligible businesses" animation, "Sent to 3 businesses" copy. Guard `marketplaceMoments.test.js`.

**Plans response count (owner item 160, 2026-10-18, option (b), LOCKED) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_160_PLANS_REPLY_COUNT_DEVICE_CHECKLIST_2026-10-18.md` is recorded on a real phone (no migration, no new strings; journey `plansReplyCount` 7/7; prod journeys 558/558).

**"Get out of the way" after Send (owner idea "161", 2026-10-18, option a, LOCKED) is MET AS BUILT + empty state reworded, NOT DEVICE-VERIFIED:** no searching screen or loader after Send (item 159's button spinner only); `request_no_responses` = "No responses yet" / "You'll be notified when a business responds." (11 languages; 10 machine-authored, need native review; guard in `emptyStateLanguage.test.js`); offer checklist section 1 check (item 161).

**One state, several presentations (owner item 163, 2026-10-18) MET AS BUILT, LOCKED, nothing built:** a reply (`submit_business_offer`, status `offered`, `BUSINESS_OFFER_SENT`) = customer's signature + travel into its card + one in-place push opening that reply, and the business's own card at "Offer sent" (never animates); a request (`create_business_request`, `BUSINESS_REQUEST_SENT`) = business's Opportunity arrival + customer's "We asked N" moment. Same state, own voice per side (item 129); documented in item 162's `MOTION_TRIGGERS`. No animation, event or database work.

**Animation driven by state, not screens (owner item 164, 2026-10-18) MET AS BUILT, LOCKED, nothing built:** each moment's shared rule (`offersToAnimate`, `offerToPlanMerge`, `replyToTravel`, `newJoinsToAnimate`, `interestedToAttendingMoment`, `planComesTogetherNow`, ...) decides from real saved state (item 162's `MOTION_TRIGGERS`); motion only on the object's own card or its authorized place; elsewhere the notification opens the exact item. DECLINED: app-wide/full-screen confirmations, a central animation dispatcher or event platform (item 125), new animation places (item 55). "A first viewing may animate; revisiting never replays" (see Motion).

**A reply arriving on any screen (owner item 165, 2026-10-18) MET AS BUILT, LOCKED, nothing built, NOT DEVICE-VERIFIED:** the ONE in-app signal = the arrival pill (`components/OfferArrivalSignal.js` in `App.js`, rules `services/offerArrivals.js`): genuinely new unviewed replies on open requests, never when that request is on screen; name for one, count for several close together; tap = that request (exact reply + item 23 travel for a single reply; several requests = Activity); leaves after 6 s (first-ever reply 9 s) or a swipe (item 20); no vibration/blocking, no sound except idea "169"'s optional cue; Reduce Motion = no animation; app closed = the per-request push (item 62). Home/Discover/gathering rows stay static until their normal refresh (item 160), no surface-specific notices; not a general animation layer (item 164).

**The app never hijacks you (owner item 166, 2026-10-18) MET BY ITEMS 20 + 165, LOCKED, nothing built, NOT DEVICE-VERIFIED until** offer checklist section 4's two item 166 checks (non-interruption + VoiceOver/TalkBack) are recorded: the arrival pill never navigates by itself, blocks or interrupts scrolling; tap = the request + item 23 travel; leaves after 6 s (first-ever 9 s) or a swipe; polite screen-reader announcement; Reduce Motion = no animation. No visible ✕ or screen-reader dismiss action unless that phone test shows a concrete defect.

**Full-screen moments are extremely rare (owner item 167, 2026-10-18) MET AS BUILT (stricter than proposed), LOCKED, nothing built, NOT DEVICE-VERIFIED:** see the Motion bullet; first offer, accept/confirmation, bookings, business transactions and gathering creation keep their inline/context presentation (items 12/25/32/43/44/51 + offer-screen rule).

**Motion hierarchy, two axes (owner idea "168", 2026-10-18; NOT item 168, the V1 category set) MET AS BUILT + documented and guarded, LOCKED:** see the Motion levels bullet. Documentation only; no animation, timing or screen changed. Owner re-confirmed 2026-10-18 (keep as built; items 167 + signature NOT reopened). NOT DEVICE-VERIFIED until check C13 of `PRODUCT_AUDIT/FIRST_DEVICE_SESSION_CHECKLIST_2026-09-19.md` is recorded (a verification item, never a reason to reopen the design).

**Optional sound cues (owner idea "169", 2026-10-18; NOT item 169, the Food & Drink spec) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/IDEA_169_SOUND_CUES_DEVICE_CHECKLIST_2026-10-18.md` is recorded on a real iPhone (incl. silent switch + Reduce Motion) AND native review of the 3
`ui.settings.soundCues*` strings is done (no migration; guard `utils/soundCues.test.js`). Owner DECIDED (2026-10-18, LOCKED): iOS-only; the Focus/DND limit is accepted (cues may play in a Focus with the ringer on; no Apple entitlement or workaround); Android keeps the switch hidden and no cue, no native Android code. Remaining = verification only: device checklist + native review, reported separately, neither claimed until done; fix found defects without expanding scope.

**Haptics for major moments (owner idea "170", 2026-10-18) MET AS BUILT, LOCKED, nothing built:** success haptic only after the person's own accept/confirm/plan creation; an arriving offer = pill only (app open) or the OS push (closed), never a haptic; Visit confirmed none. Arrival lock, item 165 and own-tap-only NOT reopened. NOT DEVICE-VERIFIED (separate): `PRODUCT_AUDIT/IDEA_170_HAPTICS_DECISION_2026-10-18.md` checks 1-6.

**Cause and effect, one connected chain (owner idea "171", 2026-10-18) MET AS BUILT, LOCKED north star, nothing built:** ask -> response -> join -> reply -> accept -> booking -> arrive -> redeem -> complete is delivered by items 45/55/158/159, 28/73, 25/23/165/48/13, 12/32, the manual check-in, 52/34 under items 98/162/164/58/99/167. No location-inferred arrival (Option B stays deferred). NOT VERIFIED that the chain FEELS connected: only the device session (order below) can establish it; a disconnected link is fixed at its shared source, never with added motion.

**"What do you feel like?" (owner idea "172", 2026-10-18) MET BY ITEM 45, LOCKED, nothing built:** chips only from stated words, never inferred mood chips (Social, Casual, ...). "...get out tonight but don't know what" = `Tonight` chip + open-ended results (Nightlife + Food & Drink); "...don't know what to do" = item 90's labelled rows; the difference is ACCEPTED (phrase fix DECLINED: it would change the answer format). Revisit only on real-usage evidence.

**Intent as a living object (owner idea "173", 2026-10-18) MET AS BUILT, LOCKED, nothing built:** the saved business request IS the evolving intent object: stated facts only (item 84) -> server-confirmed "We asked N" + rings (items 55/158/159, no searching animation) -> reply signature + arrival/push (items 25/23/165/62) -> "You're booked" on the same card (item 12) -> merged into Your Plan (item 32) -> Visit confirmed / Completed (items 52/34); one request = the source of every count/status (items 160/98). Searches stay temporary: no saved search objects or search-history feed (intent expiry, 180-day typed-ask purge kept); no second offer-to-plan animation or cross-screen morph (items 95-97). NOT DEVICE-VERIFIED: offer checklist (separate).

**"Nearby is working on it" (owner idea "174", 2026-10-18) MET AS BUILT, LOCKED, nothing built:** typed-ask wait = ambient N loader "Understanding your request…" -> real-phase caption (`intentPhaseCaption`: "Finding activities…" / "Finding communities…" / "Checking availability…") + item 45 chips when the reading returns -> results under the same chips. DECLINED: moving You -> time -> place -> activity signals (no such stages exist), timer-driven captions, placeholder motion, the business-search animation (items 159/161), "Finding the best nearby options…" (unsupported ranking claim). NOT DEVICE-VERIFIED: item 45 checklist (separate).

**Don't fake AI thinking (owner idea "175", 2026-10-18) MET by the motion truth rule, LOCKED:** loaders reflect real work only (guard `motion/motionTruth.test.js`). Cleanup DONE: `NLoader`'s unused timed caption-cycle prop removed + guarded; no visible change. The two "Thinking…" captions (business AI assistant, dating strengths) stay: both sit on real AI calls (rewording DECLINED).

**"Found something" (owner idea "176", 2026-10-18) MET by FoundLine + item 37, LOCKED:** no new "Found something…" string (items 113/37/38/61). Bug FIXED: Discover + Celebrate's FoundLine was English-only; now `ui.common.foundResults` (11 languages; 10 machine-authored, need native review; guard `motion/foundLine.test.js`).

**"Almost found it" (owner idea "177", 2026-10-18) MET by items 81 + 69, LOCKED, nothing built:** "We found something close." DECLINED (item 81 Gap 1); "Need a different time?" DECLINED (items 107/46); "Want to expand your distance?" DEFERRED behind item 81's evidence gate (item 128 analysis + real device); if reconsidered, one person-tapped step to 30 mi on the 15/30/50 list, never automatic or past 50.

**Visual distance expansion (owner idea "178", 2026-10-18) COVERED by idea "177"'s deferral, LOCKED, nothing built:** radii only from `SEARCH_RADIUS_OPTIONS` (15/30/50; no other ladder, no "Nothing within 2 miles" state); expanding-radius animation DECLINED (items 55/58/101; any later one needs its own motion spec + approval, never before the server returns).

**Time expansion (owner idea "179", 2026-10-18) MET by item 45 (✕ on the When chip, in place) + time from the person's words, LOCKED, nothing built:** Tonight -> Tomorrow -> This weekend ladder DECLINED (items 107/46, idea "177"); time editing stays behind the understood-chips change/pickers deferral (2026-10-15).

**Category expansion (owner idea "180", 2026-10-18) COVERED by item 81's Gap 2 hold, LOCKED, nothing built:** empty state unchanged; any future "try similar" = existing taxonomy relations only (no curated similarity without a V1 taxonomy decision), never a synonym of the ask ("Cafés" = Coffee), only with a real result behind it, labelled + static, never AI-guessed.

**"Ask instead" escape hatch (owner idea "181", 2026-10-18) MET AS BUILT, LOCKED, nothing built:** item 81's typed-ask empty state + empty category "Create {topic}" + Create's invites (items 135/136) + item 93's opt-in; universal "Can't find it? Ask Nearby" menu DECLINED (items 190/92/45). Observation: time-view empty state offers only "Show everything"; revisit only on device evidence.

**Create preserves everything (owner idea "182", 2026-10-18; NOT item 182) MET AS BUILT by items 82/85/187, LOCKED, nothing built, NOT DEVICE-VERIFIED (item 82 checklist):** carry-over only from the words; no location/setting row ("near me", "beach"); card settles once; cross-screen animation DECLINED (items 82/88).

**Business request knows what was said (owner idea "183", 2026-10-18; NOT item 183) MET by item 84 (+ items 87/112; item 190 = link placement), LOCKED, nothing built, NOT DEVICE-VERIFIED:** item 84 checklist, checks 13-14 added (example + link placement).

**"What happened to my request?" (owner idea "184", 2026-10-18; NOT item 184) MET AS BUILT, LOCKED, nothing built, NOT DEVICE-VERIFIED:** request-screen status line (`requestTimeline.js`, real events + times only) + "Next:" line + items 158/159/160/62/165/173; "Looking" step, split Responses/Offer steps and "Your request is active" DECLINED; offer checklist section 11 added.

**A request quietly becomes active again (owner idea "185", 2026-10-18; NOT item 185) MET for sent requests (items 80/114/62/165/23/25/164/160/173), LOCKED, nothing built, NOT VERIFIED (item 89's late-reply check, offer checklist section 11):** plain searches never reactivate (no saved-search alerts, no inferred reactivation); "A new option just became available" DECLINED.

**Retention from relevant events (owner idea "186", 2026-10-18; NOT item 186) MET + RETIRED, LIVE, LOCKED:** `first_mission_reminder` and `reward_tier_nudge` pushes + their jobs removed (migration 20270329 LIVE; live check 7/7; guard `engagementNudgesRetired.test.js`; replay 453/453, prod journeys 558/558). Retention effect and phone behaviour NOT verified.

**Business side asynchronous (owner idea "187", 2026-10-18; NOT item 187) MET AS BUILT, LOCKED:** direct/urgent request pushes, hourly digest, automatic-reply pushes, item 48's arrival, items 62/165 for the customer; "New nearby demand" DECLINED (one request = an opportunity; "demand" = item 128 aggregates). **Exact-opportunity push (idea 187 fix) BUILT, NOT DEVICE-VERIFIED:** `business_opportunity_received` with a request id opens Opportunities on that request (item 140's focus + outline, kept as built, no fade; scrolled into view once; stale = "no longer available", nothing outlined; navigation tests 47/47); journey `notificationAction` 9/9, prod journeys 559/559. Open: real push on a phone, the scroll on a device, email fallback (Resend secrets).

**"Business is interested" state (owner idea "188", 2026-10-18; NOT item 188) MET AS BUILT, LOCKED, nothing built:** items 48/13/140/151/187 (opportunity arrives, stays open to the deadline, expiry warning, state-driven actions, Offer sent -> Accepted -> Redeemed / expired); "Considering"/"Interested" state DECLINED both sides, no business draft/shortlist (idea "150"); see the meaningful-response bullet.

**Business previews what the customer sees (owner idea "189", 2026-10-18; NOT item 189) MET AS BUILT by items 49/50/21/119, LOCKED, nothing built, NOT DEVICE/BROWSER-VERIFIED:** live preview above Send Offer from the one mapping; no preview step, templates or new motion; side-by-side DECLINED unless item 49 checklist check 13 (website) shows the preview is hard to see while editing (checks 11-13 added).

**Business personality within Nearby's system (owner idea "190", 2026-10-18; NOT item 190) MET AS BUILT by item 50 (+ items 10/21/25/49 + logo item), LOCKED, nothing built:** business supplies offer photo/video (tap-to-play), screened logo beside the name, its own words; Nearby owns structure, type, spacing, CTA, motion, accessibility (`presentOffer`). Branded motion, brand colours/fonts/templates/button styles DECLINED. NOT DEVICE-VERIFIED: item 49 checklist + offer checklist.

**Offer card adapts to the media (owner idea "191", 2026-10-18; NOT item 191) MET, VERIFICATION PENDING, LOCKED:** screened video = muted, fixed frame, tap-to-play; legacy unscreened = "Video attached"; none = plain card; screened logo beside the name only; media only from the reply, never the profile; one card + one component for customer card and preview. **Every image whole, never cropped (owner, 2026-10-18; changes item 10) BUILT, NOT DEVICE/BROWSER-VERIFIED:** `OFFER_MEDIA_FIT = 'contain'` over the blurred copy, near-frame cover case removed. Video/looping backgrounds, autoplay, logo artwork, colour washes, enlarged logos, business styling DECLINED (items 22/50). Verification: offer checklist section 5 + item 49 check 14, phone + website.

**Offer "physicality" (owner idea "192", 2026-10-18; NOT item 192) MET BY ITEM 25, CLOSED, LOCKED, nothing built:** the signature stays exactly as built (light travels in, frame grows into the card, contents fade + rise 6 px, one coral glow, settle; same for every business, <= 1.5 s). Spring (reserved for You're booked), bounce, micro-scale, animated shadow DECLINED; static offer-card shadow NOT authorized. NOT DEVICE-VERIFIED: offer checklist's arrival checks.

**"Accept" feels decisive (owner idea "193", 2026-10-18; NOT item 193) MET BY ITEM 12, CLOSED, LOCKED; gap 2 IMPLEMENTED + AUTOMATED-TEST VERIFIED (code level: rule states + wiring; screen-reader state and success/failure recovery from code reading only), DEVICE VERIFICATION OPEN, no further changes unless a defect:** while one offer books, every other "I'll take this one" is visibly disabled (`utils/offerAcceptLock.js`), restored from the reloaded server state after success or failure. Press compression SKIPPED (owner: no ScaleButton/press-scale/bounce); timer-driven "Confirmed" and renaming declined. Verification: offer checklist section 6 (new check).

**"Pass" feels frictionless (owner idea "194", 2026-10-18; NOT item 194) KEEP AS BUILT, CLOSED, LOCKED, nothing built:** no Pass action or dismissal workflow; unwanted offers stay unanswered to expiry or until another is booked (booking closes the rest by their real state); all offers stay visible together (items 117/63); confirms only for real consequences. DECLINED: Pass button, offer-card ⋯ "Not for me", dismissal animation, business told of a declined offer; item 200's exception not widened; offer-screen whole-screen motion ban stands.

**Offer comparison with motion (owner idea "195", 2026-10-18; NOT item 195) KEEP AS BUILT, MET BY ITEMS 63 + 117, CLOSED, LOCKED, nothing built:** `rankReplies` order + eligibility kept, price never ranks, "✨ Our pick" only when earned, all replies in one card format together with no staging/entrance animation; no extra emphasis or offer-screen change.

**"Your choice" confirmation (owner idea "196", 2026-10-18; NOT item 196) KEEP AS BUILT, CLOSED, LOCKED, nothing built:** flow stays earned "✨ Our pick" -> "I'll take this one" on the card -> time pick only if two times -> server confirms "You're booked" -> Your Plan "{what} at {business}" with day/time/party once. No extra confirmation tap, summary or replacement heading (items 12/32/63/119/193/194).

**"Friends liked this too" (owner idea "197", 2026-10-18; NOT item 197) KEEP AS BUILT, CLOSED, LOCKED, nothing built:** DECLINED "{Friend} is interested" (Interested is private, items 138/194), "Friends liked this" (item 35 ratings stay personal) and an entering-avatar animation (item 40's converging faces = the only friend animation on recommendation cards). Kept: friend going/hosting reasons outrank popularity in reasons + ranking; item 40's line only for mutually declared interests.

**Trending animation from real momentum (owner idea "199", 2026-10-18; NOT item 199) KEEP AS BUILT, CLOSED, LOCKED (item 75 re-confirmed), nothing built:** attendance popularity + Trending section kept; cards and discovery lists static; Interested never a signal for others; no growth-rate/momentum signal without usage evidence; no animation on reaching 5 attendees; item 26's Happening Now ring stays the one discovery-motion exception.

**"Live local pulse" on Discover (owner idea "200", 2026-10-18; NOT item 200) KEEP AS BUILT, CLOSED, LOCKED, nothing built:** one signal per real event: item 26's Happening Now ring (rows + map indicators static), item 165's pill + item 62's push for a business reply, items 28/39/41/73 for friends. DECLINED: live card entrances, moving rows, timed update stream, friend-joined feed on Discover, cross-app animation layer; rows stay static until normal refresh.

**"A window into the local moment" (owner idea "201", 2026-10-18; NOT item 201) MET BY EXISTING IMPLEMENTATION, CLOSED, LOCKED, nothing built:** "What do you want to do nearby?" stays the one concept; Discover = what exists nearby (Happening Now one view, not the objective); Home = decide what to do; items 26/27/108/120 kept; motion only for real events. No second north star, rule or build.

**Home changes with the moment (owner idea "202", 2026-10-18; NOT item 202) KEEP AS BUILT, CLOSED, LOCKED, nothing built:** `getTimePeriod` = the one period rule for greeting, subtitle "What sounds good …?" and quick picks (11 languages), picks open the matching Discover time filter (item 137b), time ranking + Best Pick wording kept, Home static; no "What's happening…" / "What are you doing tonight?" wording. **Period-boundary follow-up BUILT (2026-10-18), NOT DEVICE-VERIFIED:** `hooks/usePeriodClock.js` + `utils/periodClock.js` re-render Home at the real noon / 6 PM / midnight change (`homeMomentKey`, `nextHomeMomentBoundary` in `timeContext.js`; Home still reads `getTimePeriod` at render), only while Home is focused and foregrounded, one capped timer, re-check on resume/focus, text only; guard `periodClock.test.js` (Jest 475/6389); check C14 of the first-session checklist. Item 108's midnight follow-up: see item 108.

**Stable structure, changing content (owner idea "203", 2026-10-18; NOT item 203) MET AS BUILT, CLOSED, LOCKED, no new rule, nothing built:** fixed tabs + jobs, fixed Home/Discover section order (personalization changes content/ranking within a section), static cards/lists, Back restores state, idea "202" changes wording only, empty sections omitted without reordering.

**Stable structure, meaningful motion (owner idea "204", 2026-10-18; NOT item 204, demand-backed acquisition) MET AS BUILT, CLOSED, LOCKED, no new rule, nothing built:** motion only for real events (items 58/99/164, motion truth rule), cards/lists/rows/tabs static, no screen-wide motion, one signature (item 25, outside the Pulse), full-screen = mutual match only (item 167), interruptible (item 20), Reduce Motion = settled; no motion decision reopened.

**Quiet mode (owner idea "205", 2026-10-18; NOT item 205) MET AS BUILT, option (a), CLOSED, LOCKED, nothing built:** the phone's Reduce Motion / Remove animations is the ONE source (`motion/motionPolicy.js` + `useReduceMotion`; springs instant + loops off app-wide; each moment = settled state; sound cues silent under it). No in-app motion setting: Full/Reduced/Minimal and a "Reduce motion in Nearby" switch DECLINED; idea "169"'s sound-cue switch stays independent. Works-without-animation NOT DEVICE-VERIFIED.

**No motion question in onboarding (owner idea "206", 2026-10-18; NOT item 206) MET BY IDEA "205", CLOSED, LOCKED, nothing built:** onboarding asks no animation preference (none exists; only the loader animates there); the phone's setting is respected. A later "Motion" entry in Settings would reopen idea "205" (DECLINED there), never added on its own.

**One animation per Home visit (owner idea "207", 2026-10-18; NOT item 207) BUILT, option (a), LOCKED, NOT DEVICE-VERIFIED:** `utils/homeMomentBudget.js` gates Home's five arrival moments (see the Motion bullet); guard `homeMomentBudget.test.js` (17); check C16 of the first-session checklist. Loading-gate fix (owner, 2026-10-18): nothing is decided while the spinner is up (`homeFocused && !loading`); limitation kept: a friend moment landing after the spinner clears settles if another already started.

**Animation priority follows importance (owner idea "208", 2026-10-18; NOT item 208) MET AS BUILT, CLOSED, LOCKED (owner: keep as built, no new rules or animations) by item 57 + idea "168"'s `MOTION_LEVELS`, nothing built:** new business offer = Signature (Level 3, the ONE, item 25); friend accepted / joined = Contextual (Level 2, item 28's join); recommendation changed, card loaded = no motion at all (cards/lists static, items 15/111/113); tab selected = instant (Level 1 forbids mode/tab motion). Stricter than proposed: the 3/1/1-star rows get no animation. No star scale, ranking table or new level added.

**Nearby Network Visualization (owner idea "209", 2026-10-18; NOT item 209) DECLINED, CLOSED, LOCKED, nothing built:** the request screen's real-state words stay the explanation ("From what you said", "We asked N", `requestTimeline.js` status + "Next:", offer cards -> You're booked -> Visit confirmed). No network view, people nodes, reached-business map, glowing connections, staged progress, branded motion or new full-screen moment (items 103/92/158/188/55/167, motion truth). If a phone shows the chain unclear, fix `requestTimeline.js` wording, never another view.

**60-second product demo (owner idea "210", 2026-10-18; NOT item 210) CLOSED as recommended, LOCKED, nothing built:** the demo = a recording of the REAL flow (ask coffee tonight -> "We asked N" -> business Opportunity -> reply signature + travel -> accept -> You're booked -> Your Plan; items 45/55/158/159/48/25/23/12/32). No demo mode, scripted data, fake businesses, staged states or extra animations; idea "209" stays declined. Record only after the full flow passes end to end on two phones with a seeded test business + Anthropic credit (offer checklist); too fast on camera = edit the video, never the app.

**Motion serves the product story (owner idea "211", 2026-10-18; NOT item 211) MET AS BUILT, CLOSED, LOCKED, no new rule, nothing built, NOT VERIFIED that the story reads instantly (device session + idea "210"'s recording):** Intent (item 45 chips) -> Discovery (item 26 ring, item 37 strong match, FoundLine) -> Connection (item 55 Pulse: request sent / signal received; item 28 joins) -> Offer (item 25 signature + item 23 travel) -> Plan (items 12/32/43) -> Real-world experience (item 52 Visit confirmed, item 34 Completed). Enforced by item 58 (never decoration) + idea "171" (the chain north star); no separate six-step map (would duplicate `MOTION_PRIMITIVES` / `MOTION_TRIGGERS`).

**"Crazy but smart" shortlist (owner, 2026-10-18; 15 moments) #1-#14 MET AS BUILT, CLOSED, LOCKED; #15 DEFERRED (not rejected), nothing built:** #1-#14 = items 55/158, 23/25, 62/117, 12, 28/73, 32/43, 82/85, 44, 40, 30/31/34/143 + 108, 26, 13, 45, 81/181 (see history). #15 (first-ever reply as a FULL-SCREEN signature) DEFERRED until the existing signature (+ "Your first reply from a local business" + longer arrival notice, 2026-10-10 LOCKED) is seen on a real phone (offer checklist arrival checks); items 167 and 25 stay LOCKED; only if it underwhelms there, revisit #15 with item 101's motion-spec template.

**"One surface, many states" (owner idea "216", 2026-10-18; NOT item 216) KEEP AS BUILT, CLOSED, LOCKED, no new rule, nothing built; revisit only if check C12 on a real phone shows the hop to Plans breaks the flow:** the principle is already the core rule (item 45 screen reduction: change content > expand inline > sheet > screen; states-not-folders; item 98). The example (Home's "See all plans" expanding Upcoming/Hosting/Past in place) CONFLICTS with "Home never expands sections in place" + item 110 (in-place Home expansion DECLINED, LOCKED) and the See-all rule (a list with its own management job opens its destination: Plans, registry job C). Recommended: keep as built (Home's "See all plans" -> Plans; Plans already = Upcoming/Hosting/Past on one surface; a tap there opens the detail).

**"Depth budget" (owner idea "217", 2026-10-18; NOT item 217) MET AS BUILT, CLOSED, LOCKED, no new rule, nothing built:** Level 0-1 = item 45's ladder (change content > expand inline > sheet; filters/modes never navigate); Level 2-3 = Rule 14 (a dedicated screen only with a registered job A-F in `constants/screenRegistry.js`, guard `screenRegistry.test.js`) + presentation routes on top (`openOnTop`, Back restores). A per-screen depth number would be a second representation of the registry's jobs.

**Your Plans expands inline on Home (owner idea "218", 2026-10-18; NOT item 218) MET AS BUILT under idea "216"'s decision, CLOSED, LOCKED, no new rule, no new screen, nothing built:** Plans stays the one source for Upcoming / Hosting / Past; Home keeps its layout (no inline expansion, no duplicate plan list); Profile's three plan-stat links, Celebrate Something, Shared Night and Past's memory counts (item 123) kept; item 110 and "Home never expands sections in place" stay locked. Revisit only if check C12 on a real phone shows the hop to Plans breaks the flow.

**Happening Now in place on Discover (owner idea "219", 2026-10-18; NOT item 219) MET AS BUILT, CLOSED, LOCKED, no new rule, screen or code:** the Happening Now heading (item 27), time chips (item 34), "See all" (item 206) and map pill (item 120) switch Discover to the full list in place via `openDateView` (no navigation, no separate screen); the full list replaces the shorter sections (no duplicate gatherings); returning restores Discover's prior state + scroll; Home opens Discover straight into that list (`RIGHT_NOW_VIEW`) and leaving restores Discover's prior state; "🔴 Happening Nearby" stays the separate business-moments viewer.

**Home is a preview, never the whole list (owner idea "220", 2026-10-18; NOT item 220) MET AS BUILT, CLOSED, LOCKED, no new rule or code:** max 3 per Home section (`utils/homeAttention.js`); Your Plans keeps its rows (what, when, party size), attending/hosting first; "See all plans" opens Plans (Upcoming / Hosting / Past); item 110 locked (no in-place expansion); empty sections hidden, never placeholders. Count-and-title-chips variation NOT built (a separate design decision).

**"Don't navigate away to see more of the same" (owner idea "221", 2026-10-18; NOT item 221) MET AS BUILT, CLOSED, LOCKED, rule text unchanged, no new rule or code:** item 45 stays the single source for screen reduction; Rule 14 governs when a dedicated screen is justified; the exception stands ("See all" opens a dedicated screen when the list has its own management job, e.g. Home -> Plans). No duplicate rule, no rewrite of item 45, no other version of the principle.

**"New screen when the job changes" (owner idea "222", 2026-10-18; NOT item 222) MET AS BUILT, CLOSED, LOCKED, no new rule, duplicate principle or code:** item 45 + Rule 14 stay the unchanged sources; Discover browsing, filters, time views and Happening Now stay in place; editing a gathering (`EditGathering`), Make an Offer (its modal workflow) and account/security (`Settings`) keep their workflows; Home's "See all plans" -> Plans kept (ideas "216"/"218"/"220"/"221").

**"Is the person doing something fundamentally different?" (owner idea "223", 2026-10-18; NOT item 223) MET AS BUILT, CLOSED, LOCKED, no new rule or rewording:** same rule as ideas "221"/"222": item 45 (same job = same screen) + Rule 14, whose registry forces the question (a route needs its job A-F entry or `screenRegistry.test.js` fails); See-all management exception (Home -> Plans) kept.

**Bottom sheets keep context (owner idea "224", 2026-10-18; NOT item 224) MET AS BUILT, CLOSED, LOCKED, no new rule, sheets or code:** item 45 stays the one screen-reduction ladder; the business preview sheet (item 17), invite panel (`InviteFriendsModal`) and native share sheet stay; filters, quick details, Who's going faces, location details, offer preview (item 49) and recommendation reasoning stay visible in their current contexts; never move inline content into a sheet; no reasoning sheet (item 106 LOCKED).

**Sheets never become mini-apps (owner idea "225", 2026-10-18; NOT item 225) MET AS BUILT, CLOSED, LOCKED, no new rule, sheets or code:** the 19 sheets/panels in `src/components/` stay as they are, one question or one quick action each; a sheet closes before opening a dedicated screen; multi-step work stays on its own screen (Create Gathering, Edit Gathering, Settings); Make an Offer stays one form; `CompatibilityReportModal`'s three views stay (one level, no nesting). Governed by item 45 + Rule 14.

**"Why am I seeing this?" sheet (owner idea "226", 2026-10-18; NOT item 226) DECLINED as written, CLOSED, LOCKED, no new rule, sheet or code:** item 106 stays locked (no "why" sheet); never reveal that a specific friend marked a gathering Interested (host-only aggregate count stays the one exception); item 146 stays locked (gathering distance "About x mi", never exact). Kept: card = max 2 genuine reasons (interest reason only for a declared interest) + one distance-and-time line; GatheringDetail's "Why this fits you"; Back restores Discover's prior state.

**"Who's going?" sheet (owner idea "227", 2026-10-18; NOT item 227) DECLINED as written, CLOSED, LOCKED, no new screen, sheet or rule:** attendee information stays on the gathering (no Attendees screen); Who's going faces + "+N" stay inline; names only to friends and fellow attendees, others see counts; "Who you'll meet" + host attendee management stay on GatheringDetail; never an individual's Interested by name (host-only total count); item 138 locked (no Going / Interested split); idea "224" holds (inline content never moves into a sheet).

**Business details sheet (owner idea "228", 2026-10-18; NOT item 228) MET AS BUILT under item 17, CLOSED, LOCKED, no new rule or code:** item 17's `BusinessPreviewSheet` unchanged (name, real business distance, hours, up to 2 business-provided qualities, the primary action, optional "View business"). DECLINED: public star ratings (Nearby has no public review-rating system); a person's request-specific offer shown as a standing deal to browsers (perks keep their Discover place); a duplicate Directions button when the primary action already gives directions.

**Sheets animate from their object (owner idea "229", 2026-10-18; NOT item 229) MET AS BUILT, CLOSED, LOCKED, no new motion, rule or code:** item 44's pin -> business sheet (travelling pin-coloured outline; text readable + buttons live from frame one; Reduce Motion = plain slide) kept; business list rows keep the plain slide (item 44 = map pins only); gathering + perk cards keep opening in place on Discover; detail screens open over the existing context, Back restores exact state; items 95/96/97/103 stay locked (no card-to-detail morph). Next: item 44 on a real iPhone + Android phone before any motion extension.

**Card -> detail transformation (owner idea "230", 2026-10-18; NOT item 230) DECLINED as written, CLOSED, LOCKED, no new animation, rule or code:** items 95/96/97/103 stay locked (no card-to-detail-screen morph); no request-specific offer anchored to a business card for browsing (idea "228"); continuity kept: gathering/perk cards open in place, business previews over Discover, map pins via item 44, Back restores prior state. Prerequisites before any motion extension: item 101's spec + item 44 tested on real phones.

**Gathering card expands into full detail (owner idea "231", 2026-10-18; NOT item 231) CONFLICTS WITH LOCKS, ASSESSED, recommended DECLINE as written, owner decision pending, nothing built:** a gathering's full detail (attendees, place, linked offer/plan, actions) is GatheringDetail (item 45 names it a dedicated screen; registry jobs A/B/C, host management there); growing a card into it = the card-to-detail morph DECLINED under idea "230" (items 95/96/97/103 LOCKED); a full inline copy on the card = a second GatheringDetail (master principle 2) and against "one explicit action per card" (item 200). Kept: Discover's in-place context expansion (`openContextFor`: same interest + time, related places, accepted connections), cards with What/Why/one line/one action, detail on top with Back restoring state.

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

**Item 126 (business "proof" numbers, owner 2026-10-16) is MET by item 150 as built (Performance tile + Offer Performance), nothing built; count-up animation and "Nearby generated" wording DECLINED (LOCKED).**

**Item 128 ("N people are looking for what you offer" made true, owner 2026-10-16) + follow-up (one eligibility rule, leftover floor) is BUILT, LIVE, NOT BROWSER/DEVICE-VERIFIED until** business Home
is checked in a real browser and on a phone (migrations 20270316 + 20270317 LIVE; from-scratch replay 441/441 + journeys 399/399 on it; journey `offeredDemand`; no new strings).

**Item 129 (consumer and business as mirrors, owner 2026-10-16) is MET as built, LOCKED, nothing built:** one transaction state, two views: customer = `presentOffer()` (personal), business = item 13's Offer sent -> Accepted -> Redeemed + item 147's pipeline (operational); never identical wording or animation, no business-side signature copy (item 57), item 56's motions unchanged, no new funnel (item 127); business feedback stays item 48 + item 13's step glows.
**Item 127 (a redemption moves through the funnel on one card, owner 2026-10-16) is MET by item 13 + item 147's pipeline, nothing built; another funnel visualisation or a sliding-card animation DECLINED (LOCKED).**
**Business offer lifecycle (owner idea "150", 2026-10-17) MET BY ITEM 13 as built, LOCKED, nothing built:** no Draft state, draft persistence or draft table; "Offer sent" never renamed "Live"; item 49's live preview stays the pre-send view; business view stays operational (item 129); no other funnel or sliding card (item 127). Verification = item 13's checklist below.
**Expired offer visibility (owner idea "151", 2026-10-17) MET AS BUILT + business-card gap FIXED, NOT DEVICE/BROWSER-VERIFIED:** expired offers are never deleted (customer closed card, business "No longer open" in history); the business card now reads `isOfferOpen` at the exact expiry like the customer card + pipeline (journey `offer` expiry block 8/8; no strings, migration, motion or tile). Prod has 0 offers: real-data expiry unverified; phone/browser via item 13's checklist + offer checklist (Anthropic credit).
**Item 13 (business card Offer sent -> Accepted -> Redeemed, LOCKED; owner re-confirmed 2026-10-16) is APPROVED, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_13_OFFER_PROGRESS_DEVICE_CHECKLIST_2026-10-16.md` passes with a real signed-in business on a phone AND in a browser (statuses vs saved
records, no glow replay on reopen, Reduce Motion skips it, pipeline + month totals = the records) AND native review of `ui.bizDash2.progress.*` is done. The glow stays exactly as approved.

**Item 51 (business's first offer confirmation) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_51_FIRST_OFFER_CONFIRMATION_DEVICE_CHECKLIST_2026-10-12.md` is recorded (needs Anthropic credit + a business with no offers yet)
AND native review of the 2 `ui.bizHelp.confirm.first*Title` strings (migration 20270299; journey `offer`; `partner-first-offer.sql` 13/13).

**Item 52 (first successful redemption) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_52_FIRST_REDEMPTION_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real device AND native review of
`ui.requestDetail.firstVisitNote` (10 languages) is done (no migration; journey `offer`).
Item 124 ("You asked. X responded. You went.", owner 2026-10-16) is MET by item 52 as built, nothing built; loop wording and repeats beyond the first visit DECLINED (LOCKED).

**Item 53 ("N plans this month" + streak push retired) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_53_PLANS_THIS_MONTH_DEVICE_CHECKLIST_2026-10-12.md` is recorded on a real device AND native review of
`ui.home.plansThisMonth` / `plansThisMonthA11y` is done (migrations 20270300 + 20270301; journey `plansThisMonth`; live `streak-nudge-retired.sql` 7/7).
Item 125 (the app shows its value, owner 2026-10-16) is MET by item 53, nothing built; a cross-request "N businesses responded" figure DECLINED (LOCKED).

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

**Item 120 ("N happening now" on the Discover map, owner approved 2026-10-16) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_120_MAP_AREA_ACTIVITY_DEVICE_CHECKLIST_2026-10-16.md` is recorded on a real phone AND native review of the 4 `ui.mapView.area*`
strings + the reworded red-pin `ui.mapView.gatheringLiveA11y` is done (no migration, no journey: client-only). Build APPROVED (owner, 2026-10-16); red-pin screen-reader
label FIXED ("starting soon or under way", look/timing unchanged); next-redraw refresh and pill->list drift ACCEPTED (checks 10/10b). Pulse/glow, people density, heatmaps, trending areas DEFERRED (owner).

**Item 122 (a gathering leaves a memory, owner 2026-10-16, LOCKED) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_122_GATHERING_MEMORY_DEVICE_CHECKLIST_2026-10-16.md` is recorded on real phones AND native review of the 10
`ui.gatheringMemories.*` strings is done (migration 20270315; journey `gatheringMemory`). Release gate 1 (rebuild) PASSED 2026-10-16:
from-scratch replay 439/439, journeys 387/387 on it, both concurrency scripts pass, stories/storage policies + functions = prod, grants = prod 623/623.

**Item 123 ("📸 N memories" on Plans -> Past's completed card, owner 2026-10-16) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_123_MEMORY_COUNT_ON_PAST_CARD_DEVICE_CHECKLIST_2026-10-16.md` is recorded on real phones AND native review of
`ui.gatheringMemories.count` is done (no migration; journey `gatheringMemory` 9/9). Static line (owner, 2026-10-16: keep it static, "animate into" DECLINED, LOCKED).

**Item 121 follow-up (Dating consent, cards + counts, owner 2026-10-16) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_121_DATING_CONSENT_DEVICE_CHECKLIST_2026-10-16.md` is recorded on real phones (migration 20270314; journey `datingConsent`; no new strings).

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

**Item 119 (two times in one reply, owner reopened + approved 2026-10-16) is BUILT, LIVE, NOT DEVICE-VERIFIED until** section 9 of the offer
experience checklist passes AND native review of `ui.bizDash3.addAnotherTime`, `ui.requestDetail.pickATime` / `chooseTimeA11y` is done (migration
20270311, screen-business-content redeployed; journey `offer` 38/38; from-scratch replay 435/435 + journeys 353/353 on it). Partial-party offers: REOPENED by the owner as item 119b (below). **Item 119b (a second time for fewer people, owner reopened 2026-10-16) is BUILT, LIVE (deployed 2026-10-16), NOT DEVICE-VERIFIED (from-scratch replay after deploy: 437/437, journeys 373/373, concurrency both pass, grants = prod 621/621):** only the SECOND time may be for fewer people beside a whole-party first time; groups never see it (LOCKED); migration 20270313 + `screen-business-content` v45 LIVE; journeys 373/373 on prod (no prelude, rolled back); 6 new strings need native review; `PRODUCT_AUDIT/ITEM_119B_SMALLER_PARTY_TIME_BUILD_PLAN_2026-10-16.md`. **Item 118 (one business revision, price and time only; owner approved 2026-10-16) is BUILT, LIVE (deployed 2026-10-16), NOT DEVICE-VERIFIED until** section 10 of the offer experience checklist passes and native review of the 8 new strings (`ui.bizDash3.changePriceOrTime` / `youCanChangeThisOfferOnce` / `alreadyChangedThisOfferOnce` / `updatedOfferOnItsWay` / `revisePriceOnlyLower` / `reviseDiscountOnlyBigger`, `ui.requestDetail.offerUpdated` / `offerJustChanged`) is done (migration 20270312 + `send-push` LIVE; journeys 365/365 on prod rolled back, no prelude; from-scratch replay after deploy 436/436 + journeys 365/365 + `offer-revision-concurrency.js` 20/20 + booking concurrency, function grants replay = prod 620/620). **Item 117 (2026-10-16) offer competition MET as built (items 62/121/23/25/63/21), nothing built; staged reveal of existing replies, comparison table, "best" card, price ranking and a distance line on reply cards DECLINED (LOCKED); request-screen count heading + phone rendering NOT verified (offer experience checklist).** **Item 116 (2026-10-15) "N spots left" MET (real counts only); booking capacity FIXED to count people (migration 20270308, LIVE; journey `bookingCapacity` 8/8; concurrency checked live); tightening card and live count updates DECLINED (LOCKED).** **Item 114 IMPLEMENTED (2026-10-15):** the interest-based availability push is removed (migration 20270309, LIVE; journey `availabilityNoBroadcast`; Settings' Nearby Opportunities panel removed). Settings panel removal and the hint "Gatherings and places you can explore nearby." (11 languages) APPROVED (owner). **From-scratch replay DONE (2026-10-16): all 434 apply, journeys 343/343 + concurrency on the rebuilt DB** (`scripts/replay/`). `20270310_function_execute_grants_match_prod.sql` (closes a grant drift where a rebuilt DB was wider than prod on 90 functions) APPLIED to production 2026-10-16 after a rolled-back check showed 0 changes; prod grants unchanged, replay grants = prod 617/617 (no DB migration ledger exists: applied status lives here + CLAUDE_HISTORY.md). CLOSED (owner, 2026-10-16; checkpoint 56bea7b5). **Item 115 (2026-10-15) capacity-window animation MET by the "Posted: {title}" card (floored match count) + the reply path (items 62/23/25), nothing built; outward ring, match-triggered animation, new business motion and "Available nearby now" DECLINED (LOCKED); verified via item 89.** **Item 114 (2026-10-15) business "drops" MET by Availability matching open requests only (item 80; reply push/travel/signature), nothing built; broadcast drops, interest-only targeting, "just opened N spots" copy and a new business noun DECLINED (LOCKED); verified via item 89's end-to-end check.** **Item 113 (2026-10-15) "Something for you" MET by item 26 (one Pulse ring from the Right Now / Happening Now heading for an unseen gathering), nothing built; card entrances, live row insertion, a "Found something" string and any notification DECLINED (LOCKED); device check 3 of item 55's checklist.** **Item 112 (2026-10-15) Best Pick shows why MET as built (fit-score threshold, max 2 reasons + separate distance/time line, all reasons on detail; "Best Pick Tonight" kept), nothing built; extra reasons, "N friends nearby", filler weather and "Best fit" wording DECLINED (LOCKED); device check C9 (hero image legibility).** **Item 111 (2026-10-15) Best Pick reveal VERIFIED against the locks and DECLINED: card stays static, all information from frame one (LOCKED), nothing built.** **Item 110 (2026-10-15) Home as doors MET as built (surface jobs, weather card -> filtered Discover, items 27/45/109 doors), nothing built; in-place expansion, transitions and headline glyph DECLINED (LOCKED); device check C12.** **Item 109 (2026-10-15) "Tonight looks great" MET by item 34 (`meetTonight.js`: rules + grey reason line + Meet People -> People mode), nothing built; weather/activity reasons, "Strong People activity" and any transition DECLINED (LOCKED); device check C11.** **Item 108 (2026-10-15) live time labels APPROVED as built, NOT DEVICE-VERIFIED until** check C10 of `PRODUCT_AUDIT/FIRST_DEVICE_SESSION_CHECKLIST_2026-09-19.md` passes (shared minute clock on Home + Discover; no motion; no new strings). **Midnight follow-up (owner, 2026-10-18) BUILT, NOT DEVICE-VERIFIED:** the same minute clock also ticks at the local midnights when a shown upcoming label's day word changes (`dayWordChangeAt` in `utils/minuteClock.js`: date -> "Tomorrow" -> "Today"/"Tonight"), Home + Discover, no second clock, same cap/background pause/resume tick; guard `minuteClock.test.js` (17); check C15. **Item 107 (2026-10-15) spatial distance MET by the distance-first context line (`formatDistance`, `validReasons`, detail "0.3 mi away"), nothing built; pin-to-card animation DECLINED (LOCKED); vague proximity on a phone = fix the shared filter.** **Item 106 (2026-10-15) tappable why MET by GatheringDetail's "Why this fits you" (`ReasonList`) + `recommendationSurfaces.js`, nothing built; why-sheet and assembly animation DECLINED (LOCKED); perk/community full reasons + Places personal reason = observations only, pending device evidence.** **Item 105 (2026-10-15) confidence builds MET by item 37 (`strongMatch.js`), nothing built; interests/friends/weather ticks, "Strong fit" and use on ordinary cards DECLINED (LOCKED); clarity via item 37's checklist.** **Item 104 (2026-10-15) "Who is this for?" MET by `recommendationContext.js` + item 37, nothing built; reason animation DECLINED (LOCKED); wording clarity = device check C9 in the first-session checklist (copy, never motion).** **Item 103 (2026-10-15) "Nearby Orbit" MET by items 28/73/43/32/34/95-98, nothing built; orbit, moving cards, face orbit and pre-acceptance logo DECLINED (LOCKED); join/assembly unification DEFERRED until both pass on real phones.** **Item 102 (2026-10-15) "living local network" vision (ask -> ... -> learns) + rarest signature MET AS BUILT (items 45/55/48/25/28/73/43/21/12/32/47/34/52/35/53/54/57), nothing built; signature-only-on-first-reply DEFERRED until a phone shows repetition (would reopen item 25).** **Item 101 (2026-10-15) DONE: motion spec rule + `PRODUCT_AUDIT/MOTION_SPEC_TEMPLATE.md`; no code or motion changed.** **Item 144 (2026-10-17) "last spot" animation MET as built (real "{n}/{cap} spots filled" -> You're in -> "🔒 Full — {n}/{cap} spots taken" + Join Waitlist), nothing built; the "1 spot left" highlight DECLINED (item 116 LOCKED: no scarcity styling).** **Item 142 (2026-10-16) capacity indicator MET as built ("{n}/{cap} spots filled" / "🔒 Full — {n}/{cap} spots taken", host included; full = "Join Waitlist" everywhere; host sees item 28's count roll), nothing built; live animated count for other viewers NOT built (item 116 LOCKED: counts read on load, no scarcity styling).** **Item 141 (2026-10-16) private gathering feel MET as built (`needsApproval` -> "Request to Join" / "Requested"; host push + "N requests to join · Review" + Activity "wants to join"; Approve -> Who's going + `gathering_approved` push), nothing built. Approve's alert reworded (owner, 2026-10-16): "Approved! You can now chat with them." (key `ui.gatheringParts.youCanNowChatWithThem`, 11 languages; the chat connection is still created server-side); NOT native-reviewed; guard `utils/gatheringApprovalAlert.test.js`.** **Item 140 (2026-10-16) auto-accept visual state MET as built ("Who can join?" Anyone vs Require approval; one rule `needsApproval` -> "Join" vs "Request to Join" on every surface; auto-approved join -> You're in at once, item 31 from Interested), nothing built; separate "Open to join" badge NOT built.** **Item 139 (2026-10-16; count kept by owner 2026-10-17, LOCKED) host Interested signal MET as built (host-only count "☆ N people are interested but haven't joined yet"; conversion from the person's own side: starts-soon reminder, friend-joined push, item 31); "Invite interested people?" DECLINED (Interested is private; acting on it reveals it), nothing built.** **Item 138 (2026-10-16) Who's going sections (Going / Interested, faces moving between) DECLINED: Interested is private, never shown to another viewer (LOCKED privacy rule); met where allowed by item 28's flow-in, item 31 (own button only) and the host's requests/invitations/Interested-count view; nothing built.** **Item 136 (2026-10-16) group invite burst MET as built (Create's Who's invited step = one "We invited {sent} of {count}" line; Invite a Circle = one tap, one haptic, rows "Sent"; one toast host, never a pile), nothing built; outward pulse and post-publish multi-select NOT built (items 55/43/45).** **Item 135 (2026-10-16) invite as a signal MET as built (Invite -> "Sent" + "Invitation sent to {name}" after the server returns; return = item 28's "{Name} accepted your invite"), nothing built; travelling signal both ways and avatar moving Friends -> Invited NOT built (item 55: person-to-person stays out of the Pulse; no animated lists).** **Item 133 (notification -> destination continuity, owner 2026-10-16) is BUILT, LIVE, NOT DEVICE-VERIFIED:** gathering pushes already open the gathering with the push's words on top (host's "{Name} joined" = `gathering_interest` -> GatheringDetail, Who's going shows them); FIXED "{Name} accepted your friend request." -> that friend's profile (was the Friends list; migration 20270318 adds `user_id`, `send-push` v25 action `view_profile`, unused "View Friends" label removed; journey `friendAcceptedPush`). Wave stays -> Activity (who waved is premium-locked there). **Item 132 (2026-10-16) "Nearby Moment" notification MET as built, nothing built:** the reply push already says what happened ("{emoji} {Business} responded" + what they sent, item 62 / `_business_reply_push`) and a tap opens that exact offer (item 136's `focusOfferId`: scrolled to + outlined; item 23's travel). A pulse IN the notification is not possible (the phone's system draws it, the app can't animate it); no new in-app pulse (item 55: no new animated places). **Item 131 (2026-10-16) the "Aha" inferred-plan animation DECLINED (owner, LOCKED), nothing built:** Nearby responds to declared intent and never composes an unprompted "here's your plan" from inferred signals (friends' Interested, availability, weather, "tonight is open"). Met by items 37/40/32/43; card reasons, "Why this fits you", item 40's collision and silent weather reranking stay. Reopen only for a proposal starting from intent the person typed; pairing people (e.g. "coffee tonight with Claude") also needs item 92 explicitly reopened. **Item 130 (2026-10-16) a small set of motion primitives MET by item 100 (`MOTION_PRIMITIVES`, eight forms, placements LOCKED), nothing built, LOCKED (owner): no rename, no repositioning, Confirm stays inside complete (never split), documents only, authorizes no motion:** Signal = pulse, Connect = flow, Reveal, Merge, Transform as is, Confirm + Complete = complete; assemble/ambient have no item-130 name. **Item 100 (2026-10-15) DONE, APPROVED as built (placements LOCKED): eight motion primitives = documentation-only `MOTION_PRIMITIVES` map + guard `motionPrimitives.test.js`;
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

**Item 143 (moved off the waitlist -> "~~On waitlist~~ → ✓ Attending", item 31's moment once per gathering; owner approved 2026-10-16) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_143_WAITLIST_PROMOTION_DEVICE_CHECKLIST_2026-10-17.md` is recorded on real phones (migration 20270319 LIVE; journey `waitlistPromotion` 8/8; replay 443/443 + journeys 409/409; no new strings). Never for Requested or a normal join (LOCKED).

**Item 145 ("Get directions" on a gathering's meet-up point, owner 2026-10-17) is BUILT, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_145_GATHERING_DIRECTIONS_DEVICE_CHECKLIST_2026-10-17.md` is recorded on a real phone (journey `gatheringDirections`; no migration, no new strings). Ready-state motion, urgency styling and last-hour reordering DECLINED, met as built (item 108, LOCKED).

**Item 146 (gathering precise-location security, owner approved 2026-10-17) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_146_PRECISE_LOCATION_DEVICE_CHECKLIST_2026-10-17.md` is recorded (migration 20270320 LIVE; journey `preciseLocation` 17/17 under
real roles; replay 444/444 + journeys 431/431; grants replay = prod 1556/1556; scope + results `ITEM_146_PRECISE_LOCATION_SECURITY_SCOPE_2026-10-17.md`).

**Item 147 (non-public gathering rows, owner approved 2026-10-17, HIGH PRIORITY SECURITY) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_147_NON_PUBLIC_GATHERING_ROWS_DEVICE_CHECKLIST_2026-10-17.md` is recorded on real phones (migration 20270322 LIVE; journey
`gatheringRowPrivacy` 28/28 under real roles; journeys 473/473 on prod; replay 446/446 + journeys 473/473; parity 12451/12451). Signed-in real-API test still open.
**Signed-in real-API test for items 147 + 148 DEFERRED (owner, 2026-10-17), OPEN until it actually passes:** database-level journeys are NOT proof the real API
blocks a signed-in user. Before running: an authorized operator checks `auth.users` for an account left by the interrupted 2026-10-17 run and deletes
one only after verifying it belongs to that run (never by creation time or a test-looking email alone). Then a dedicated test account created only at
run time, cleanup guaranteed even on failure, deletion verified, results recorded. Never bypass production safeguards to finish it.

**Item 148 (Stories & Sightings location privacy, owner approved D1-D4 2026-10-17, LOCKED) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/ITEM_148_STORY_SIGHTING_LOCATION_DEVICE_CHECKLIST_2026-10-17.md` is recorded (migration 20270321 LIVE; journey `storySightingLocation` 14/14;
replay 445/445 + journeys 445/445; grants = prod). Story/business-moment media GPS metadata DEFERRED, UNRESOLVED until check 10 runs on a device.
Also OPEN: a signed-in test through the real API (DEFERRED, see item 147's line), backup/WAL retention for the old sighting value
(Free plan, 0 restorable backups, WAL archiving on: ask Supabase support, record expiry; never assume gone). Presence retention FIXED
2026-10-17: `purge_stale_presence_reports` every 10 min (migration 20270323 LIVE; deletes reports > 1 h, every reader uses <= 1 h). Expired
sightings are NOT purged yet: Crossed Paths ignores `expires_at`, so purging would drop people 48 h after last crossing (owner to decide).
`delete-account` / `moderate-photo` repo sources recovered verbatim from their live bundles (not redeployed; guard `edgeFunctionSourcesGuard.test.js`);
13 live functions have NO repo source (export-data, revenuecat-webhook, review-login, setup-review-account, moderate-text, moderate-chat-image,
translate-message, get-online-status, rehearsal-chat, generate-courage-message/-icebreaker/-introduction/-strengths): not recovered, owner to decide. Do not call location privacy complete.

**Item 146 pin averaging, Option A (owner approved 2026-10-17, LOCKED; B/C rejected) is BUILT, LIVE, NOT DEVICE-VERIFIED until** checks 1-3 + 12
of item 146's device checklist pass (migration 20270324: pin keyed by host + ~780 m cell via item 148's `private.location_pin`, per-gathering
`gathering_pin` dropped; map stacks shared pins via `utils/mapPinStacks.js`; journey `preciseLocation` 21/21; replay 448/448 + journeys 477/477;
prod journeys 477/477; grants = prod 7220/7220). Results: `PRODUCT_AUDIT/ITEM_146_PIN_AVERAGING_ASSESSMENT_2026-10-17.md`.
**Place-count oracle removed + approximate location in words (owner Option A, final, 2026-10-17) is BUILT, LIVE, NOT DEVICE-VERIFIED until** item 146
checklist checks 1-3, 9, 12 and new 13 pass on a real phone AND native review of the 3 new strings (`reasons.approxDistance` / `approxDistanceAway`,
`ui.mapView.gatheringPinsApproximate`) is done (migration 20270325 LIVE drops `count_gatherings_near_batch`; journey `preciseLocation` 21/21, fails on the
old DB; guard `approximateGatheringLocation.test.js`; replay 449/449 + journeys 477/477; grants = prod 3339/3339). `PRODUCT_AUDIT/PLACE_COUNT_ORACLE_SCOPE_2026-10-17.md`.

**Gathering clock + check-in window (owner 2026-10-17: fix G1 + G2, "You're here" option A manual only, no new headlines) is BUILT, LIVE, NOT DEVICE-VERIFIED until** every check in
`PRODUCT_AUDIT/GATHERING_CHECK_IN_WINDOW_DEVICE_CHECKLIST_2026-10-17.md` is recorded on a real phone (migration 20270326 LIVE; journey `gatheringCheckIn` 22/22 incl. ms-exact
boundaries; prod journeys 499/499; replay 450/450 + concurrency; no new strings). "You're here" = Option A, LOCKED (owner, 2026-10-17); Option B DEFERRED until this passes on a phone.

**Offer validity window (owner idea "149", 2026-10-17) MET AS BUILT, LOCKED, nothing built:** reply end + availability start/end change one card in place on the shared time engine; NO start time on replies/offers, no activation delay (acceptance is the booking), timing = `proposed_time` (+ item 119's second time); no migration, Make an Offer field or "Offer is active" wording. NOT DEVICE-VERIFIED: offer (needs Anthropic credit), item 47 and item 108 checklists still to run. `PRODUCT_AUDIT/OFFER_VALIDITY_WINDOW_SCOPE_2026-10-17.md`.

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

**Waiting on evidence (do not build without it):** a business "set aside" for requests (idea "188": only if real owners show the need); Momentum fold decision (`momentum_viewed` /
`momentum_cta_tapped` usage); removal of any relationship tool (B9 usage review); item 152 intent ->
action conversion; item 159 business-declared reach (only if requests are consistently too far); item
128 unmatched-ask analysis (also gates idea "177"'s person-tapped radius step; trigger script `scripts/analysis/item-128-unmatched-ask-trigger.sql`); item 204
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
returns a verified profile, incl. a non-Dating person's, outside Dating discovery); the crossed-paths push (`notify_sighting_crossed_paths`) names
the other person regardless of Dating consent (producer: the live `report-presence` edge function; Friends uses sightings too); `viewer_blocked_either_way` / `is_blocked` are client-callable; one-way client
block filters remain in `gatherings.js`, `ActivityScreen.js` and inline-block RLS on
`business_messages` (allow-listed in `blockVisibilityGuard.test.js`; stories + story storage fixed by 20270315); a
business owner can open a known person's verified profile like any user; a screened logo is an
owner-hosted URL; video duration metadata that lies consistently passes; Tell Nearby can half-save on a
network failure between its writes; story media may carry GPS metadata (item 148 check 10, unverified); `LOCK TABLE` remains possible with direct DB UPDATE rights.
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
- **Availability reaches only matching OPEN requests (item 114, LOCKED):** a business posting or changing availability never notifies
  anyone by interest, distance or time preference; only a matching open request gets the reply + its reply push. Guards
  `availabilityNoBroadcastGuard.test.js`, journey `availabilityNoBroadcast`.
- **The system brings the next thing; the person never jumps through it (owner, 2026-10-16):** intent appears -> Nearby responds ->
  information unfolds -> people connect -> businesses respond -> plans form. Navigation and motion are one idea: the next relevant thing
  comes to the person where they acted (screen reduction item 45, one object evolving item 98, travel-into-place items 23/32/44). Only
  in response to stated intent, never unprompted from inference (item 131, item 114); Home stays doors, never an unfolding feed (items 50/110).
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
- **Met vs verified (owner, 2026-10-18, LOCKED):** MET = implemented (cite items/code/tests; no duplicate build); VERIFIED = the specified
  checks actually ran and passed in the specified environment, results recorded; MET, VERIFICATION PENDING = built, checks outstanding;
  NOT MET = missing, wrong or failing. A checklist, plan, code review or "it's built" is never verification; a defect found is fixed
  without rebuilding what works; never claim inspection or test runs that didn't happen.
- **Money figures never mix:** fee owed (billing estimate, itemized), value of offers redeemed
  (`get_partner_offer_value`, owner-set prices), potential value ("up to $X", request data only). Never
  "revenue", "earnings" or customer spend without an explicit transaction amount (none exists).
- **Social proof and urgency are never fake (owner idea "198", 2026-10-18, LOCKED):** no "people are interested" line, count or motion
  unless real people are (and Interested itself is never shown beyond the host's aggregate, see Privacy); "Trending" only when its
  criteria hold (`constants/trending.js`); no fake urgency: countdowns only from a real deadline (item 47's last 30 min, amber, never
  red), "N spots left" only from real counts with no scarcity styling (item 116), time labels never urgency-styled (item 108), motion
  never claims what the data doesn't (motion truth rule). A new social-proof or urgency cue cites its real source before it ships.
- Trending = >= `TRENDING_ATTENDANCE_MIN` (5) approved attendees, everywhere (`constants/trending.js`).
  Place/time labels each mean one thing (`constants/surfaceVocabulary.js`); add a label there before using it.
- **One gathering end, one check-in window (owner, 2026-10-17, LOCKED):** end = start + duration, else start + 30 min; NOT active at the
  exact end (exclusive everywhere: `timeWindowParts`, `whenLabel`, SQL `_gathering_ends_at`); Home, Discover, detail, Messages, needs and
  strong match all read it (guard `gatheringCheckInWindow.test.js`). Check-in only in [start - 30 min, end), enforced by `check_in_to_gathering`
  + trigger `gathering_interest_check_in_guard` (idempotent, never moved, never on insert); never a redemption. The "Right Now" discovery window is separate, unchanged.
- **"You're here" = manual check-in only (owner, 2026-10-17, LOCKED):** in the check-in window an eligible attendee sees Check in, Message
  group, Directions; nothing decided from location (no automatic arrival, no "Looks like you're here"); no new stage headlines ("Time to go",
  "You're here"); check-in never redeems (only a business-confirmed visit does; offer-booked plans keep their visit flow). Option B only
  after the check-in checklist passes on a phone, and then: already-granted foreground permission, compared on the phone only, the
  attendee still taps, location never sent or stored for it. `PRODUCT_AUDIT/PLAN_LIFECYCLE_AND_YOURE_HERE_SCOPE_2026-10-17.md`.
- **Relative time labels stay true while open (item 108):** only via `hooks/useMinuteClock.js` (`utils/minuteClock.js`; Home + Discover,
  guard `minuteClock.test.js`): ticks only near a shown window or at a midnight that changes its day word, paused in background, plain text, never motion or urgency styling.
- **"Request sent" count (idea 158, LOCKED):** "We asked N nearby businesses" = businesses really reached by that call (`notifiedCount`,
  one `business_request_offers` row each), never searched/considered/matched; 0 or duplicate = no line of reach, no rings (journey `requestSentCount`).
- **Only a meaningful response reaches the customer (item 89 + idea "188", LOCKED):** a real recorded business action that communicates an
  outcome or concrete option (offer, genuine alternative, explicit decline where the workflow tells them, another substantive reply;
  automatic replies are real offers). Viewing, opening, leaving open, considering, delivery or receipt never make a customer status,
  push, timeline step or implied commitment; a recorded action not shown today needs its own decision before it notifies.
- A Home claim needs a visible, substantiated trigger of its own kind, and its CTA names where it goes.
  Home may say nothing; no filler rows or zero stats (`homeQuiet.js`).

### Privacy
- **Business payloads carry the minimum:** structured fields + `business_safe_request_summary()`. Never raw
  text, profile data, ids, requester name (except after acceptance), plan kind, party type, attendees or
  social context, in an RPC or a push. Free-text note only on a request addressed to ONE business. Guard:
  `businessPrivacyBoundary.test.js`, `businessPayloadPrivacyGuard.test.js`.
- **"Looking for what you offer" (item 128):** only the business's own primary + secondary categories, distinct people, >= 5, from `get_aggregated_demand_for_partner`'s summary row via `splitAggregatedDemand`; no declared category = no line, never a fallback.
- **What a business offers = `business_offered_tags()` (item 128 follow-up, 20270317):** own primary + secondary only, no group fallback;
  governs the Home line, "Demand near you" (incl. its supply count) and the "Growing demand nearby" push. Every "n of total" breakdown
  needs `demand_breakdown_visible` (n >= 5 AND leftover 0 or >= 5). Routing keeps `business_served_tags()`.
- **Floor of 5:** every business-facing aggregate about unconnected people uses `demand_min_people()`
  (distinct people, secondary figures withheld below it, including subtraction leaks). Consumer/community
  coordination pushes stay at 2. Lasting consumer interests shown to a business need 5 sharing them.
- **No stranger discovery via intent** (item 92: never pair people, strangers or friends, from coincidental asks; a typed ask is never shown to another person). People surfaces show only connected people (accepted friends/matches);
  strangers are counts. Attendee identities: friends and fellow attendees see names, others see counts.
- **Shared business requests (item 93, LOCKED):** "People you know are also asking" = `intent_visibility` 'friends' (OFF by default,
  only Settings turns it on), accepted friends only, never matches; shows only `sharedRequestFactsLine` (category · day · party
  size), never raw text; combining still needs each person's consent; no merge animation.
- **Gathering rows (item 147):** readable only per `_gathering_row_visible` (the gatherings SELECT policy; signed out = none); by-id RPCs and
  id lists apply it; joining/Interested/inviting/asking never grant visibility (trigger 'Gathering not found'). Guard `gatheringRowPrivacyGuard.test.js`, journey `gatheringRowPrivacy`.
- **A gathering's precise point (item 146, LOCKED):** only host + approved attendees, only via `get_gathering_meetup_point`; precise_lat/lng
  have no client SELECT (column allowlist on `gatherings`); pins/distances/radius only from the secret-keyed host + cell pin (`private.gathering_location_pin`, Option A; shared pins stack on the map);
  no place gathering counts (removed, 20270325; never a pin count, place id or rate-limited variant). A gathering's distance always reads
  "About x mi" (`approximateMiles` in `utils/formatDistance.js`, miles only) and the map says its pins are approximate, in words. A migration adding a gatherings column must `grant select (<col>)` to anon,
  authenticated (guard `gatheringPreciseLocationGuard.test.js`, journey `preciseLocation`).
- **Story & sighting location (item 148, LOCKED):** never stored precisely: triggers store only `private.location_pin` (item 146's secret,
  keyed by person + 0.007 deg cell, so repeated posts share one pin); business moments store none; no client SELECT on
  `stories.latitude/longitude` / `sightings.approx_area` (a new column on either needs its own grant). Guard `storySightingLocationGuard.test.js`, journey `storySightingLocation`.
- **Interested is private (owner, 2026-10-17, LOCKED):** the person sees only their own mark; never a name, photo, list or per-person record to
  anyone; never a business request, lead or booking, never a push or analytics event that identifies who. ONE exception: the HOST of that
  gathering sees the current aggregate count (item 139), only in their own GatheringDetail host view (`HostCommandCenter`), via
  `get_gathering_interested_count` (host-checked; none after cancel); never on Home/Discover cards, public detail, other attendees,
  businesses. Business use = only the anonymous floored category aggregate (consent switch, no ids). A new reader of `gathering_interested`
  must be added to journey `interestedPrivacy`'s reviewed set. It is the ONE saved state: never a second Save/bookmark, "You saved this"
  wording, or saved businesses/places (owner idea "152"). Guard `interestedHostCountGuard.test.js`.
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
- **Gathering memories (owner item 122, LOCKED):** a gathering's photos are seen ONLY by its host + approved attendees
  (`viewer_was_at_gathering` in the stories + storage policies, 20270315; friends/matches/public never grant it), shown only on
  a completed gathering (`gatheringMemoryState`: was there + item 34's `isGatheringOver`; title "{title} · Completed"), added only
  by choice. Never a feed: not in Discover/story rings/map, no Home row, push, likes, comments, anniversaries, collages, sharing.
  Guards `gatheringMemory.test.js`, journey `gatheringMemory`.
- **Activity, never implied people density (owner item 121, LOCKED):** a map/area/"heat" signal counts activity (public gatherings) and
  says so ("N happening now", "Activity nearby"), never "People nearby", crowds or density. A count of people only from a pool its
  members explicitly opted into (friend discovery, item 39, dating discovery) or real stated requests (business side, floor of 5).
  Heatmaps/people density stay DEFERRED; item 120's gathering count stays separate from every people count. Guard: item 121 test in `mapAreaActivity.test.js`.
- **Dating discovery = explicit Dating opt-in only, cards AND counts (owner, 2026-10-16, LOCKED):** a person appears in any Dating
  card (Crossed Paths, Browse, Home's crossed-paths row, Activity's crossed rows) or count only if their own "What are you looking
  for?" is Dating or Both (`'Go on dates'`). Decided by the server: `is_dating_discoverable` + `dating_candidates_visible_to_me`
  (20270314; the only Dating read, narrowed columns), re-checked by `isDatingOptedIn` (reads only the server's `dating_opted_in`).
  Shared gatherings, interests, proximity or past interactions are never consent; threshold 3 and Friends unchanged.
  Guards `datingCountConsent.test.js`, `blockVisibilityGuard.test.js`, journey `datingConsent`.
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
- **"Not interested" (owner idea "153", 2026-10-17, LOCKED):** ⋯ -> one inline "Not interested" row on Home's Picked For You +
  Nearby Right Now cards and Discover browse gathering tiles only (never Best Pick, typed-ask/search results, own plans, other
  card types), only for an upcoming gathering with no viewer relation and not Interested (`utils/notInterested.js`, server
  re-checks). Hides that gathering for that person and is a kind word in `get_my_experience_feedback` (latest word per kind,
  never host/business), at FULL weight (`feedbackDelta`); a typed ask naming the kind ignores it (`forTypedAsk`). Card replaced at
  once, no motion, by "We'll show you less like this." (only when a kind is lowered) or "You won't see this one again." + Undo
  (reverses both). 90 days; a kind edit lifts the hide, cancel keeps the kind word. Private: table has no client grant, only the
  owner's RPCs (migration 20270327). Settings Forget per kind; Clear clears it. Journey `notInterested`, guard `notInterested.test.js`.
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
  availability condition inline in a screen; fix "wrong button" bugs in the table. One explicit action per card (item 200; ONE
  exception: idea 153's quiet ⋯ "Not interested" on the cards listed under Recommendations, never a second visible button).
- **Swipe is a choice, never a requirement (owner idea "156", LOCKED):** decisions are explicit labelled actions (Join, Interested,
  Invite, Ask, View, Accept, Pass, Connect); a swipe only dismisses an overlay (item 20) or is an OPTIONAL people deck the person chose.
  Dating and Friends open as lists (`discovery_view_style` / `friend_discovery_view_style`, separate columns, default 'list'); a deck
  offers the same choices as buttons (Friends: worded `FriendDecisionButtons` from `FRIEND_DECISIONS`; Dating: ✕ 👋 ♡ ↺ each with its word under
  it from `DATING_DECK_ACTIONS`, the word = short form of its screen-reader label); never copy telling people to swipe. Every deck decides only through `createSwipeDeck`
  (`utils/swipeDeck.js`): it acts on the person visible at release, ignores input during a fly-off, restores the person on a failed
  save; never a gesture handler that reads render state directly. Guards `friendDiscoveryView.test.js`, `swipeDeck.test.js`; journey `friendDiscoveryChoice`.
- Capacity = TOTAL people including the host (`_gathering_guest_limit`, `gatheringFullness.js`).
  Every shown attending/going figure includes the host too (`attendingFigure`; host + 3 joined = "4 attending");
  thresholds (Trending >= 5) still compare joined guests.
  Events are gatherings + `format`; `ticket_required` is informational only.
- Each actor reports only its own side's state; server RPCs compute derived state.
- **One "offer still open" rule (owner, 2026-10-17):** `isOfferOpen` (`objectLifecycle.js`: offered, before its `valid_until` and its request's deadline,
  closed AT them, before the hourly sweep stores it) decides the business card's "Offer sent" (`offerProgress`, `businessCardStatus` -> "No longer open")
  and the pipeline's Offered; the customer's accept applies the same checks. Expired offers are never deleted (history + analytics); no expired tile.
- **One reply tally (owner item 160, LOCKED):** every row counting a request's replies (Home Your Plans, Plans, GatheringDetail + host line,
  Matches, DateProposal) reads `tallyBusinessReplies` / `requestReplyStatuses` / `placeStatusLine` (`utils/planCompletion.js`): open replies only
  (`isOfferOpen`), "N offers — choose one" only when every one is an offer (`businessReplyKind`), else "N businesses responded"; read on load/focus, never live.
- **Mirrored sides, different voices (owner item 129, LOCKED):** customer and business read the SAME offer/request state (`objectLifecycle.js`)
  but never share wording or animation: personal for the customer, operational for the business; no business-side signature.
- **One offer revision (item 118, LOCKED):** a business may change an open, hand-written reply ONCE, price only down (or a bigger
  discount) and its time(s) earlier/later, same number of times; never terms it didn't have, never an automatic reply
  (`revise_business_offer`, client `utils/offerRevision.js`). Same card, current terms + "Updated", never a previous price or saving;
  accepts/confirms name the revision seen (`seen_revision_param`); a revision clears group confirmations and the business never learns of them.
- **Two times in one reply (item 119, LOCKED):** a reply the business writes may carry `proposed_time_alt` (max two, both for the full
  party; never on automatic replies); `_offer_chosen_time` (server) + `utils/offerTimes.js` (client) are the one rule: a pick is required,
  it is written into `proposed_time` at accept. Groups too: every participant confirms the same time or nothing books; never a group
  flag to the business. One card (`OfferTimeChoice`); "Fits" only beside the matching time (`fittingTime`).

### Motion
- Glyphs: N = system thinking, ✨ = discovery, ❤️ = romantic, 🤝 = platonic, 🎉 = celebration, ✓ = done, 🔒 = privacy.
- Motion only for real events (the six marketplace moments, matches, confirmations, a join seen by the host);
  no animated cards/tabs/lists. Budget tiers in `motion/motionBudget.js` (max 900 ms); tokens, never literal
  durations. Reduce Motion = settled state. Haptics only after the person's own tap, never on an arrival (idea "170", LOCKED). Sound = only idea "169"'s cues (below). Business transactions
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
  "✓ Visit confirmed" (`presentOffer().confirmation.firstVisitNote`); words only, inside VisitConfirmed's one settle (+ idea "169"'s optional cue, same for every visit); later ones: none.
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
  redemption, first business interaction, plan formation stay as approved. Owner idea "168" (LOCKED): two independent axes. Attention =
  Ambient (Level 0: only `responding` + `weatherShift`, each keeps its tier) < Micro < Contextual < Signature; Presentation = full-screen
  is a flag, never a level (`MOTION_PRESENTATIONS.fullScreen`: only `matchIntro`, stays medium, never outranks the signature). Guard `motion/motionLevels.test.js`.
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
- **Truthful triggers (owner item 162, documentation only):** every `SEQUENCES` entry names its trigger in `MOTION_TRIGGERS`
  (`constants/motionLanguage.js`: kind, stored state or real source, server function, playing files); a new sequence registers
  its trigger; no new server event just for an animation (item 125); never claims delivery (item 159). Guard `motion/motionTriggers.test.js`.
- **Full-screen celebration = the mutual match only (owner item 167, LOCKED):** the match modal (`motion/MatchAnimation.js`, 🤝/❤️) is
  the ONE full-screen overlay moment; first offer (items 25/51), accept/confirm (items 12/32), bookings and business transactions
  (calm tone, no confetti), gathering creation (item 43's panel) and everything else stay inline, in an existing sheet/banner or an
  approved small animation. A new full-screen moment needs the owner to reopen the relevant item. Other modals are tools the person opens.
- **Sound cues (owner idea "169", LOCKED):** the ONLY in-app sounds: three customer cues (`SOUND_CUES`: reply arrives while open, from
  `offerArrivals`' `onArrival`; own accept/confirm, with its haptic; "✓ Visit confirmed"'s first play), one rule `utils/soundCues.js`
  (wired by `services/soundCues.js`). Off by default (one Settings switch, kept on the phone), iOS only, Focus limit accepted, no Android native code (owner, 2026-10-18) (ambient session: silent switch,
  mixes), silent under Reduce Motion (asked fresh, unknown = silent), in the background, while recording, or within 10 s of a reply
  push's own sound; never awaited, never instead of a visual or a push sound, never on the business side or for any other moment.
  Files are Nearby's own (`scripts/sounds/generate-sound-cues.py`). Guard `utils/soundCues.test.js`.
- **First viewing may animate, revisiting never replays (owner item 164):** a real change the person has not seen plays its existing
  moment once when they arrive (push tap included: items 13/21/132/48 as locked); already seen = never again; state and text readable
  from frame one; Reduce Motion = settled; no app-wide layer, dispatcher or new animated place.
- **One animation per Home visit (owner idea "207", LOCKED):** of Home's arrival moments (friend collision, Completed, friends planning, Right Now ring, plans-this-month roll; `HOME_MOMENT_ORDER`) only the highest that would play moves on a visit (a focus); the rest show settled and count as seen (never replay, never take a later visit's slot); one later-ready moment after a winner settles; no queue/sequence/delay; `utils/homeMomentBudget.js` only. Exempt: weather fade, own-tap feedback, typed-ask result moments. A new Home arrival moment joins `HOME_MOMENT_ORDER`.
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
- **Map area activity (owner item 120):** "N happening now" pill on the Discover map only from `happeningNowAreas` (`utils/mapAreaActivity.js`):
  pins the viewer already sees, inside `isWithinRightNowWindow`, 400 m single-link, 2+; plain All view only; static; tap = Happening Now limited
  to that area (`buildDiscoverDateView` `areaIds`), back returns to the map. Red "Live now" pins keep their own rule (`isMapLiveNow`, unchanged).
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
- **No engagement nudges (item 53 + idea "186", LOCKED):** a push only for something relevant that happened to the person's own things
  (or a real unfinished thing they started/entered: match with no message, own birthday/occasion, stalled group plan); never a
  streak, tier, "still waiting" or come-back push (guards `streakNudgeRetired.test.js`, `engagementNudgesRetired.test.js`).
- Plan group chat pushes (`plan_message`): recipients = `_plan_participant_rows()` (the chat roster's one source) minus the writer and
  blocks either way; the Messages switch; at most one per person per plan per 2 min; tap opens PlanChat.
- Each push type has one priority (`notificationTier.js`), one navigation-only action button
  (`notificationActions.js`) and one mute group (`notificationPreferences.js`, one store `profiles.notification_mutes`).

### Engineering discipline
- One migration per schema change; verify live with disposable data in a rolled-back transaction; disclose
  whether a from-scratch replay was done (`scripts/replay/from-scratch-replay.sh`: isolated network, never production; 20270294
  needs its code-inventory sync step, done by the script). Filename order must follow dependencies.
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
