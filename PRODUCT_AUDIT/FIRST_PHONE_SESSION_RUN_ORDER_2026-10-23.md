# First real-phone session: run order (owner, 2026-10-23; plan approved, adjusted same day)

Purpose: find out whether a first-time person can go ask -> understand -> correct -> Create or Ask Nearby Businesses -> place it
-> publish or send, confidently and without explanation. This file adds NO new expected results: every step points at an existing
check, which stays the source. It sets the order, how results are classified, and what to watch. Results go into the source
checklists. No new features and no speculative UX changes before the results exist.

## How to record a result (use exactly one per check)

| Code | Means | Counts as verified? |
|---|---|---|
| PASS | Ran on the phone, matched the source check | Yes, for that device/OS only |
| FAIL | The app did something wrong (wrong fact, crash, wrong screen, lost data) | No |
| USABILITY | Worked as built, but the person hesitated, misread, or wasn't sure | Yes as built; concern recorded |
| SETUP-BLOCKED | Could not run because test infrastructure was missing (no Anthropic credit, Maps key, seeded data, permission) | **No: stays NOT VERIFIED**, never a FAIL |
| NOT TESTED | Skipped (time, out of scope) | No |

Severity for FAIL and USABILITY:
- **Sev 1**: the person can't finish, OR a wrong day/time/place/party is published or sent, OR they publish/send not knowing what.
- **Sev 2**: they finish, but were misled or confused (needed to guess, retry, or ask).
- **Sev 3**: polish (wording, layout, fit) with no effect on what they did.

Rules: stop the session only for a Sev 1 FAIL that blocks the next step; everything else is recorded and fixed afterwards at its
shared source. A SETUP-BLOCKED flow is reported in its own list, never mixed with product failures.

## 0. Setup (each missing item = SETUP-BLOCKED for the steps that need it)

| # | Setup | Needed by |
|---|---|---|
| S1 | A native build of current main on ONE phone (iOS first; Android stays PENDING) | everything |
| S2 | Maps SDK for iOS (Android) + Places API (New) enabled on the key's project | 3.5 pin placement, address search |
| S3 | Location permission granted, phone in the seeded area | every search, distance, "near me" |
| S4 | Seeded TEST gatherings near the phone: this evening, tomorrow, the coming Friday + Saturday, one next week; Coffee, Pickleball, Live Music; one public, one requiring approval | parts 2-3 (else every result is an empty state) |
| S5 | One seeded TEST Coffee business (real address, its own pin), its owner signed in on the business website or a second phone | 4.4-4.5 |
| S6 | Two accounts: brand-new (no interests/friends) + one with a declared interest and one friend | 1.3 |
| S7 | Record sheet (below) | every result |

Not needed for parts 1-5: Anthropic credit (search and Create read words deterministically without it). Needs it (SETUP-BLOCKED
until topped up): business replies, offers, screening, AI-only phrases. Google discovery is OFF on purpose: no Places tab is
expected (C23 (0)), not a defect.

## Session A: your own run (the journey, in order)

1. **Get in**: C1 (cold start), C2 (onboarding incl. location), C21 (a) then (b).
2. **Search understands me**, Home AND Discover: item 45 checks 1-13; chip checklist (`UNDERSTOOD_CHIP_REMOVAL_DEVICE_CHECKLIST_2026-10-15.md`)
   checks 1-17; check 18j's search, date-chip, weekday-to-weekday and year bullets; item 86 checks 1-6, 8, 13-15; item 84 check 14.
3. **Create from the ask**: item 82 checks 1-11; chip checklist check 10 (Create half); check 18 (a-i) + 18j's Create bullets;
   C18 (a) and (d); **place it**: C24 (a), (b), (f), then publish; item 146 checks 2, 4, 13; the iOS time wheel (18j's last bullet;
   do not change the picker before this result).
4. **Ask Nearby Businesses**: item 84 checks 1-13, 15; chip checklist checks 10 (request half), 16e, 17d, 18d, 18j's AskBusiness
   bullets; C18 (b); Send to the seeded business (offer checklist section 1), and record the screen's words when NO business is
   reached; the business side's Opportunity card shows the same facts (from a hosted gathering: C19). Replies: SETUP-BLOCKED
   until Anthropic credit.
5. **The correction story** (one continuous run, written as what you saw): "pickleball friday at 2 PM" -> date chip -> Saturday ->
   results -> Create it -> Back -> Ask Nearby Businesses.

6. **Request deadlines** (run order "Request deadline watch"): create the ~20-minute gathering and send its request FIRST, then
   do parts 2-5 and 7 while it runs; come back for the after-start checks. Never wait idle for it.
7. **Offer to booking, end to end** (owner, 2026-10-24; TWO phones/accounts: consumer phone + business owner on a second phone or
   the business website, signed in as the seeded business's owner): Request -> business reply -> "I'll take this one" -> "You're
   booked" -> "✓ Visit confirmed". Ask for TODAY (the business can mark a visit completed only on or after its day).
   - (a) Automatic reply, runs WITHOUT Anthropic credit: on the business side set "Auto-accept party size up to" (fulfillment
     settings) to 10 before the consumer sends; the reply is created by the database (`auto_reply` 'policy', no AI). Expected: the
     consumer's request screen gets the reply in place (item 23 travel + item 25 signature; with the app closed, one push that opens
     that reply, item 62); an automatic reply never claims to fit a stated time and never shows "✨ Our pick" (item 63).
   - (b) Hand-written reply (Make an Offer) = SETUP-BLOCKED until Anthropic credit (screening fails closed), never a FAIL.
   - Then on the consumer phone: "I'll take this one" (other replies' buttons disabled while it books, idea "193") -> "You're booked"
     on the SAME card + Add to Calendar / Get Directions / Share / Invite (item 121), merged into Your Plan "{what} at {business}"
     (item 32). Business side: the Opportunity reads Offer sent -> Accepted (item 13); the business taps Mark as Completed ->
     consumer card "✓ Visit confirmed" (first time: the first-visit line, item 52); business card -> Redeemed.
   - Compare the two phones: what the consumer sent (category, day, time, party) = what the Opportunity shows (idea "246").
   - Source checks: offer checklist sections 1, 4, 6, 11 + item 13 / item 32 / item 52 checklists; expected rows in `LIFECYCLE_MATRIX.md`.

## Recording every scenario (owner, 2026-10-24)

Per scenario, beside the codes above: **Functional** PASS / FAIL / BLOCKED (= SETUP-BLOCKED); **Usability** Clear / Confusing
(what was unclear, in the person's words); **Visual** issues (layout, fit, contrast, cut-off text); **Device + OS** (model, iOS/
Android version, light/dark, text size); **Evidence**: a screenshot or screen recording for every FAIL and Confusing. Only what
was performed on a physical phone is recorded; a skipped step is NOT TESTED. No app changes during the session unless a Sev 1
defect stops further progress. Afterwards findings are sorted into launch blockers / important improvements / post-launch.

If time remains: C9, C12, C10, item 46, C20. Later sessions (not this one): offer experience sections 2-12 (credit), the
motion order of 2026-10-12 (item 55, then 28 and 32 on two phones; C13-C16), two-phone checks (C17, C22, items 39/40, item 146
checks 7-8), and parts 1-5 again on Android (incl. C24 (c)).

## Focus: does a first-time person understand it? (record for every run, A and B)

These four are the session's main questions. Each gets an answer even when every check passed.

| # | Question | Where it comes up | Record |
|---|---|---|---|
| F1 | **Did they notice the day/time changed**, and could they say what it is now? | Date chip -> Saturday (part 5); ✕ on Tonight; clock chip AM/PM | What they said it was for, before you told them |
| F2 | **Did they understand why a time must be picked again** (or why info is missing), without feeling Nearby lost their request? | Create / Ask Nearby Businesses after a day change; date-only "Pick a time"; amber "missing" marks (item 84 check 12); a day silently not read ("sat", "11/4", "tonight November 4") | Hesitation, retyping, going back, saying "it forgot" |
| F3 | **Could they tell if the pin was in the wrong place before publishing?** | C24 (a)/(f): place a pin, review step (it names the venue, shows no map), publish; then item 146's "About x mi" | Did they check it; where they thought people would meet; publish a wrong spot without noticing = Sev 1 |
| F4 | **Did they publish or send confidently**, knowing what, when, where and for how many? | Create's Publish; Ask Nearby Businesses' Send, then the request screen | Ask "what did you just send/publish?": a wrong or unsure answer = USABILITY (Sev 1 if a wrong fact went out) |

Navigation watch (owner, ideas "314"/"315", 2026-10-23): when going from Discover (a business's preview) into Ask Nearby Businesses
and, after Send, onto the request screen, record whether the move felt natural or like a detour (hesitation, Back pressed, "where am
I?"), A and B. Report only: the flow stays as built unless this shows a real problem.

Business hours watch (owner, idea "331", 2026-10-23): "Does the person understand whether a business is open at the time they
requested, without having to open its preview or check its hours manually?" (e.g. "coffee tonight at 8"). Record separately whether
they mean OPEN NOW or OPEN AT THE REQUESTED TIME (different facts; note if the person or the screen confuses them). Report only.

Join clarity watch (owner, idea "337", 2026-10-23; first TWO-phone session, alongside item 28's checklist): when someone joins
the host's gathering, does the host understand what happened from the existing join push ("{Name} joined", opens that gathering)
and the Who's going section (face flows in, count rolls, named line) alone, without wanting another surface (Home, Activity)?
Report the specific confusion only; any fix prefers existing wording (`joinedNote`), never a new screen, row or notification.

Quiet-when-shown checks (owner, idea "338", 2026-10-23; implementation APPROVED as built, UX pending these checks; two phones, app
OPEN on the receiving phone unless stated; run on iPhone AND Android; record PASS/FAIL per line; `REPLY_PILL_REPLACES_BANNER` stays
false throughout):
1. Same screen, same object: the screen updates with no banner and no sound. (a) host on that gathering's page, someone joins: the
   face flows into Who's going; (b) both in the same chat / plan chat, a message appears; (c) customer on that request's screen, a
   business replies: the reply travels into its card.
2. Different object: the normal banner + sound. (a) host on a DIFFERENT gathering's page, someone joins the first; (b) another chat
   open, a message in the first; (c) customer on another request's screen or any other screen, a business replies.
3. Business reply arrival pill: visible and tappable (opens that request on that offer) (a) on normal screens (Home, Discover,
   Activity, Profile) and (b) while a native sheet is open (e.g. a business preview, the invite panel). Today the banner shows too;
   record whether the pill alone would have been noticed. Only (a)+(b) passing on BOTH platforms lets the owner decide on the switch.
4. History and badge, each platform: every quiet push from check 1 is still in the notification list (iOS Notification Center;
   Android tray: note whether it appears at all) and counts in the app badge, the same as a bannered push.
5. Sound, with Settings' sound cues ON (iPhone; Android has no cue) and OFF: a reply on another screen = the system sound once, never
   also the cue; a reply on its own request screen (quiet) = the cue plays once if ON, silence if OFF, never two sounds, never
   silence while the cue is ON; ringer/silent switch both ways.
6. Returning from background: put the app in the background, send a reply / join / message, bring the app back: each push is in the
   list, the screen shows the change, nothing is lost; then send another within a few seconds of returning: it gets its banner
   (or is quiet only under check 1's conditions).
A missed or lost update = Sev 1: report it; the fix is to keep the banner for that case, never another notification feature.

Map pin glyphs (owner, idea "346", 2026-10-23): during any visit to Discover's map, run check C25 of the first-session checklist
(four pin types told apart without tapping, also in Grayscale; legible at phone size; stacks, callouts, business sheet, labels
unchanged). Watch especially: the live badge in Grayscale, category symbols at 26 px, selecting overlapping pins (C25 (g)-(i)).
Report readability/intuitiveness only; a fix stays on the pin glyph, never a map redesign. No map work before this check.

Moments watch (owner, idea "352", 2026-10-23; observation only, no setup): when a business reply arrives (signature + travel), a
friend joins (Who's going faces), a booking assembles Your Plan, or a gathering goes live, record whether the moment felt meaningful,
connected to what the person did, and easy to understand, and whether anything felt like too much. Code shows these moments exist,
not how they feel; report the specific moment and reaction, never propose new motion.

One-gathering watch (owner, idea "354", 2026-10-23; observation only, existing item 28/31/32/34/43 checks): as friends join, an
offer arrives, the booking confirms and the gathering completes, record whether it reads as the SAME gathering evolving. Specifically:
does the person recognize that an accepted business offer belongs to their original gathering? Unclear = report the exact spot;
the fix is a small clarity improvement on the existing gathering page, never a new screen, stepper or system.

Interested watch (owner, idea "355", 2026-10-23; observation only, items 30/31 checks): after tapping Interested, ask "Do you have
a spot?" Record whether they understand nothing is reserved (especially on a gathering with limited capacity), whether Interested
vs Attending reads as two different things, and whether Join / Request to Join feels like the obvious next step. Unclear = report
the exact wording or spot; never propose a new state, reminder or invitation feature.

Host watch (owner, idea "356", 2026-10-23; observation only): as host, open a gathering with some people Interested and some
joined. Can the host immediately tell people who are interested from people who have committed to attend (the "☆ N people are
interested but haven't joined yet" line vs the attending count)? Record any moment they read Interested as confirmed attendance.

Invite watch (owner, idea "369", 2026-10-23; observation only, alongside C26): as host, invite three friends from the gathering's invite
sheet. Does the host clearly understand the invitations were SENT but attendance has NOT increased yet (rows "Sent", attending count
unchanged until someone really joins)? Record any moment they read an invite as a confirmed attendee. Unclear = report the exact
wording or spot; never propose card growth or invite-driven motion.

Leave watch (owner, idea "370", 2026-10-23; two phones; (a) is a REQUIREMENT, PASS/FAIL): the host keeps the gathering's page open
while an attendee taps Leave. (a) PASS only if the attending count drops and the face leaves Who's going without the host navigating
away and back (code reading suggests it may only show after refocus: DELETE realtime events aren't filterable without replica
identity full); FAIL = a functional bug (Sev 1-2): propose the smallest reliable fix, implications evaluated first, no replica
identity full or motion change before that. (b) nothing animates, glows, announces or notifies the host about the leave. (c) it
reads as neutral.

Booked-time watch (owner, 2026-10-24, migration 20270343; PASS/FAIL; needs a gathering with a business booking accepted from it):
as host, open Edit, change ONLY the time, Save: "This time is booked" explains why and to cancel the reservation first, no Try Again,
the booked card still shows the original time. Then change only the description, Save: it saves. Record the wording on screen (the
string is machine-authored outside English; native review is separate). No late-arrival flow exists or is to be tested (LOCKED).

Expired invite watch (owner idea "392", 2026-10-24; PASS/FAIL; needs an invitation to a gathering whose start has passed): Activity shows
"Invitation expired" / "{title} · {date} • Past" with only Dismiss (no Accept / Decline); Dismiss clears the row only (the gathering and
the inviter see no decline); the Activity badge does not count it.

Offer expiry watch (owner idea "393", 2026-10-24; PASS/FAIL; a reply with an end a few minutes away, seeded test business): keep the
request screen open across the end: "I'll take this one" disappears at that minute without touching anything and the card reads "This
offer has expired"; repeat with the app in the background across the end, then reopen: already updated. If a tap lands right at the
end: the message says the offer expired, no Try Again.

Request deadline watch (owner idea "394", 2026-10-24, migration 20270344; PASS/FAIL; seeded test business): (a) host a gathering
starting in ~20 min, ask nearby businesses from it: the request is sent (no "already passed"); after the start, the request reads closed
and "Ask" from the gathering refuses with "That time window has already passed.", no Try Again. (b) a gathering with a request no
business has answered: Edit, change ONLY the time, Save: it saves and the request screen shows the new day/time. (c) after the test
business replies (or declines): change the time again: "Businesses have replied" + body (cancel the request first), no Try Again, the
other edits still save with the original time. (d) a standalone ask with a day + time ~10 min away: after that time the request reads
closed. Record the wording on screen (the 2 new strings are machine-authored outside English; native review is separate).

Ask again watch (owner idea "395", 2026-10-24; PASS/FAIL; seeded test business; follows the request deadline watch's (d)): (a) the
expired request from (d) (its stated day + time passed): the expired line shows "Ask again for tomorrow", NOT "Reopen Request". (b) an
expired request whose day/time is still ahead (or no day): "Reopen Request" is still there and works. (c) tap "Ask again for tomorrow":
the existing request form opens (no new screen) with the original activity, party size and preferences filled in, Tomorrow selected,
and the original clock time shown in the Time field and correct for tomorrow; words that named a day ("tonight") are NOT carried
(the box is empty and asks again). (d) nothing is sent until they tap Send ("Ask Nearby Businesses"); Send shows a NEW "We asked N"
and a new request screen; the old request stays expired; no push about the old request. (e) form clarity (USABILITY, ask the person):
"Are you sending a new request or reopening the old one?" Record the answer verbatim. (f) a gathering's expired request whose
gathering started: no Reopen and no Ask again button (rescheduling the gathering is the path); a match / community / group-plan /
add-on request whose time passed: no Ask again. `ui.requestDetail.askAgainTomorrow`: 10 machine-authored languages, native review
pending (separate).

Weather watch (owner, idea "371", 2026-10-23; observation only, with item 36's checklist; only when the forecast really brings
the card up): does the weather card feel genuinely useful (it changed what the person would do) or like another Home section to
scroll past? Report the reaction only; no weather UI change before this.

Home length review (owner, idea "373", 2026-10-23; REQUIRED before idea "373" closes): on a NEW account and on a realistically
ACTIVE one (plans, friends, invitations, offers, activity), scroll Home top to bottom and record: (a) the blocks visible at once
(list them, in order); (b) whether Best Pick, Your Plans, Picked For You and Nearby Right Now are easy to find; (c) any block that
duplicates another's action or information; (d) whether the person can say what each block is for; (e) for each skipped block:
skipped as irrelevant, or because Home felt too long. About six visible blocks = review trigger, not a cap. Look first at polls,
quick stats, "try something new", "since you were away". Clutter = a specific removal/consolidation proposal for owner approval,
duplicates and rarely actionable blocks first; never an automatic cap or hiding of useful content.

Interested sharing checks (owner, idea "356", 2026-10-23; migration 20270340; result codes as above):
1. On a fresh account, Settings > "Include my "Interested" in anonymous local trends" is OFF.
2. Tap Interested on a public gathering for the first time: the explanation appears (with sharing off: "…It's off unless you turn
   it on in Settings."), and the person can say in their own words that sharing is optional and off. Repeat on an account that
   turned sharing on first: the explanation appears with the opted-in wording.
3. Tap Got it, then open Settings: the switch is still OFF (Got it never enables sharing). "Change in Settings" opens Settings
   without changing the switch.
4. As host (= the host watch line above): Interested and Attending read as different numbers; no interested person's name, photo
   or list is visible anywhere.

Other known risks: note them only if seen, don't set them up. Tomorrow without a time opens at a noon default while Saturday
asks "Pick a time" (18b vs 18i); "tonight after 7" opens at 7 PM, which looks carried (18c); the iOS wheel resting on noon (18j);
the date chip's 12 choices (18j); chips with ✕ on results but none above People (chip checklist check 11); Android's Google
place labels don't place a pin (C24 (c)); searches feel thin with Google discovery off (C23 (0)).

## Session B: someone who has never seen Nearby (owner recommendation, after session A)

Hand them the phone signed in to the brand-new account. Give tasks in plain words only, never app words (no "chip", "Create
it", "Ask Nearby Businesses", "pin"). Don't explain or help; ask them to think aloud. Answer F1-F4 for each task.
1. "Find something to do this Friday afternoon."
2. "Actually, you meant Saturday. Fix that." (watch: do they find the day chip, or retype?)
3. "Set up a pickleball game Saturday at a court you'd pick, and invite people." (Create + pin + publish)
4. "Ask local coffee places if they can host 4 of you tomorrow at 7." (Ask Nearby Businesses + Send)
5. "Find a gathering you'd like to go to and show you're interested." Then, after the other tasks, without any hint: "Find that
   gathering again." (owner, idea "353": watch where they look first, Home / Discover / Plans' ☆ Interested row / Profile, and whether
   it reads as the same thing with the same state everywhere they meet it; finding it naturally = evidence the shared state is understood. Idea "379" watch: if they look for a "Saved" tab or list (after the momentary "✓ Saved"), record it verbatim as USABILITY: evidence for rewording that confirmation, never for a Saved feature.)
6. Afterwards: "What did you just publish? What did you send? When and where is it?"
Throughout: does moving between Home, Discover, Create, Activity and Profile feel like one connected app or five separate ones?
Record the moment it felt disconnected, if any (idea "353").
Button watch (owner, idea "377", 2026-10-24; observation only): before each of their first taps on a button (Join, Request to
Join, I'm Interested, View Plan, Meet People, I'll take this one, Get Directions, Reserve / Book / Request), ask "What do you think
happens if you tap that?" and write the answer verbatim, then what actually happened. Focus: Reserve / Book / Request on a business
result or profile: ask "Is that a reservation now, or are you asking them?"; then, on the form it opens ("Book with {name}"), "Have
you booked anything yet?" Needs a seeded business with a declared booking mode; none in the market = SETUP-BLOCKED. Evidence = a
wrong prediction that changes what they do (expecting an instant booking and leaving, or thinking they're booked before a reply);
one hesitation that the next screen clears is not. Evidence = USABILITY with the label, both answers and the screen; the fix is a
wording proposal in the shared table (`primaryAction.js` / `i18n/ui/actions.js`) for owner approval, never a change without it.
Plan stop links (owner, idea "383", 2026-10-24; same watch): on an Experience plan, each stop's link names where it goes: a
gathering or an already-requested/booked stop = "View →"; a stop not requested yet = Reserve / Book / Request (the business's
booking mode; "Request" when none). Ask what each will do before tapping. Also note whether Home's "Continue Browsing →" reads as Discover.
Walk-in stop (owner, 2026-10-24): a walk-in business's stop reads "Request" (it opens a request form, so it is truthful); note whether the
person expected to just walk in. Confusion = USABILITY, reported; no label change without this evidence.
Send button (owner, idea "384", 2026-10-24; same watch + screen reader on): asking ONE business (its Reserve / Book / Request, or a
picked business) the Send button reads and is spoken "Ask {name}"; a general ask = "Ask Nearby Businesses". With VoiceOver / TalkBack on,
confirm the spoken label equals the visible one.
Exclusive posting (owner, idea "384" follow-up, 2026-10-24, LOCKED; observation only): open a seeded business's OWN posting from search
(declared booking mode) and tap its Reserve / Book / Request. Expected as built: heading "Book with {name}" (or Reserve at / Request from),
the posting's banner (title, price), Send reads and is spoken "Ask {name}"; after Send the request screen names that one business, and its
reply arrives with the posting's price and description. Ask before Send: "Will this confirm a booking right away, or does {name} still
have to respond?"; after Send: "Are you booked yet?" Expecting an instant confirmed booking = USABILITY (with their words), never a wording
change without that evidence. Also, if possible, a posting that has filled or ended before Send: expect "No longer available", the draft
kept, nothing sent. Needs a seeded business with a live posting; none = SETUP-BLOCKED.
Card scan watch (owner, idea "386", 2026-10-24; observation only): on a gathering card showing two reasons AND friend faces (smallest phone
available), give 3 seconds, cover it, ask "What is it, when is it, and what happens if you tap the button?" Write the answers verbatim.
A wrong or missing answer, or text truncated/overlapping = USABILITY with a screenshot; the fix is that card's shared model
(`gatheringCardModel`), proposed for owner approval; nothing removed and no layout change without this evidence.
Next step watch (owner, idea "387", 2026-10-24; observation only): right after (1) a business reply arrives, (2) they join a gathering,
(3) a plan is over, ask nothing and wait 10 seconds: do they find the next step unaided (take the offer / View Plan or Message group /
"How was it?")? Then ask "What would you do next?" Write it verbatim. Stuck or a wrong guess = USABILITY with the screen; the fix is the
shared source of that step (`primaryActionFor`, `requestTimeline.js`, Your Plans row), never a "next best action" module or "best" wording.
Booked card watch (owner, idea "388", 2026-10-24; observation only): on the request screen right after "You're booked", screenshot the
card and ask "What did you just book, and when?" before they touch anything. Note whether Add to Calendar / Get Directions / ride /
Share / Invite read as secondary links under the confirmation or compete with it (eye goes to the links first, confirmation scrolled
off on a small phone). Competing = USABILITY with the screenshot; propose the smallest change for owner approval; no redesign without it.
Connect vs Add Friend (owner, idea "382", 2026-10-24; same watch): when they meet Connect (friend discovery) and Add Friend (a
profile), ask "What's the difference between those two?" Connect = friends only if both connect; Add Friend = a request they accept.
Confusion = USABILITY; the fix is contextual explanation first (existing hint/empty-state lines), a rename only after that fails.
Record their words verbatim where they hesitate. Their results go in the same lists, marked "B".

Reference (idea "391"): `PRODUCT_AUDIT/LIFECYCLE_MATRIX.md` lists every object state with what should show (status word, CTA,
allowed actions, expiry, which push opens it, which animation may play). A screen that disagrees with its row = FAIL; the row is generated
from code, so it says what the app SHOULD do, never whether people understand it.

## Record sheet

Per run: A or B, device, OS version, build, account, light/dark, language, Reduce Motion. Per check: code (PASS / FAIL /
USABILITY / SETUP-BLOCKED / NOT TESTED), severity for FAIL/USABILITY, one line of what happened, screenshot for every FAIL.
At the end, three separate lists, most severe first: (1) product FAILs, (2) USABILITY concerns, (3) SETUP-BLOCKED + NOT TESTED
(what stays unverified). Then F1-F4 answered in a sentence each. A one-line summary per part goes into CLAUDE.md's open-work lines.
