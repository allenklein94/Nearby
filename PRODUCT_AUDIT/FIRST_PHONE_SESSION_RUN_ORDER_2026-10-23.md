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

Quiet-when-shown checks (owner, idea "338", 2026-10-23; two phones, app OPEN on the receiving phone; record PASS/FAIL per line):
(a) host on that gathering's page, someone joins: no banner, no sound, the face flows into Who's going, and the push is still in the
phone's notification list (iOS Notification Center; Android tray: note whether it appears there at all); (b) host on a DIFFERENT
gathering's page: the normal banner; (c) both in the same chat / plan chat, a message: no banner, the message appears; another chat
open: banner; (d) customer on that request's screen, a business replies: no banner or sound, the reply travels into its card;
(e) customer on another screen, a business replies: banner AND the arrival pill (the pill does not replace the banner yet); (f) open a
sheet (e.g. a business preview) and have a business reply: is the pill visible above the sheet and tappable? (decides whether the pill
may later replace the banner: `REPLY_PILL_REPLACES_BANNER`, only after (e)+(f) pass on iPhone AND Android, owner decision); (g) app in
the background: normal pushes for all of the above. A missed update = Sev 1: report it, the fix is to keep the banner for that case.

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
5. Afterwards: "What did you just publish? What did you send? When and where is it?"
Record their words verbatim where they hesitate. Their results go in the same lists, marked "B".

## Record sheet

Per run: A or B, device, OS version, build, account, light/dark, language, Reduce Motion. Per check: code (PASS / FAIL /
USABILITY / SETUP-BLOCKED / NOT TESTED), severity for FAIL/USABILITY, one line of what happened, screenshot for every FAIL.
At the end, three separate lists, most severe first: (1) product FAILs, (2) USABILITY concerns, (3) SETUP-BLOCKED + NOT TESTED
(what stays unverified). Then F1-F4 answered in a sentence each. A one-line summary per part goes into CLAUDE.md's open-work lines.
