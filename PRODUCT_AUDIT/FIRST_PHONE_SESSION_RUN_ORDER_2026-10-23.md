# First real-phone session: run order (owner, 2026-10-23)

Purpose: use Nearby the way a person would (ask -> understand -> correct -> Create or Ask Nearby Businesses -> place it) on a real
phone, before any more features. This file adds NO new checks: every step points at an existing check, which stays the source of
its expected result. It only sets the order (by user impact) and lists what to watch for. Record results in the source checklist.

Rules for the session
- Run in order. **Stop only for a blocker** (the person can't finish the step); fix that, then continue. Every other defect is
  recorded with device/OS/steps and fixed afterwards at its shared source (never per screen).
- No new features, no change to locked behaviour during or because of the session. "Report only" checks stay report only.
- Not verified until the check is actually run and recorded (Met vs verified rule).
- Skip what is superseded: item 45 check 9 ("chips are not tappable") was replaced by the chip removal/change checks (2026-10-15/20).

## 0. Before the session (blocking setup)

| # | Setup | Why |
|---|---|---|
| S1 | A native build with the current main installed on ONE phone (iOS first if possible; Android stays PENDING) | Nothing has ever run on a phone |
| S2 | Maps SDK for iOS (and Android) enabled on the key's project; Places API (New) enabled | Pin screen + address search (C24); without it, placing a venue may be impossible |
| S3 | Location permission granted on the phone, in the test area | Every search, distance and "near me" default needs it |
| S4 | A few seeded TEST gatherings near the phone: today evening, tomorrow, the coming Friday + Saturday, one next week; categories Coffee, Pickleball, Live Music; one public, one requiring approval | With production's near-empty data, search shows only empty states and nothing can be judged |
| S5 | One seeded TEST business (Coffee, real address, its own pin), owner signed in on the business website or a second phone | Needed for "We asked N" and for the Opportunity to arrive; without it Send reaches nobody |
| S6 | Two accounts: a brand-new one (no interests/friends) and one with a declared interest + one friend | C21 |
| S7 | Record sheet: device, OS version, build, account, light/dark, language, Reduce Motion on/off | Every result needs it |

Not needed for parts 1-5: Anthropic credit (the search and Create readers are deterministic without it). Needed later: business
replies, offers, screening (part 7). Google discovery stays OFF (no Places tab is EXPECTED, C23 (0)).

## 1. Get in (blocking)

1. Cold start, Reduce Motion off: C1 (first device checklist, section C).
2. Onboarding end to end, incl. the location step: C2.
3. New account Home: C21 (a) — record whether Home reads useful or broken. Then the account with an interest: C21 (b).

## 2. Search understands what I said (highest impact: every journey starts here)

Do each on Home AND Discover unless the check says otherwise.
1. The chips appear and say what the words said: item 45 checks 1-8, 10-13 (`ITEM_45_ASK_UNDERSTOOD_DEVICE_CHECKLIST_2026-10-11.md`).
2. People count + removing a chip: `UNDERSTOOD_CHIP_REMOVAL_DEVICE_CHECKLIST_2026-10-15.md` checks 1-9, 11-15.
3. Changing WHEN / People: same checklist, check 16 (a-g).
4. The clock chip: check 17 (a-f).
5. Weekdays and dates in search: check 18j, the bullets on "pickleball friday", "coffee November 4", "coffee 11/4", the date chip
   row, weekday-to-weekday, and the year.
6. People asks go to People, activity asks keep results: item 86 checks 1-6, 8, 13-15.
7. A public-place ask shows no business link: item 84 check 14.

## 3. Create from the ask (the "make it happen" handoff)

1. The "From what you said" card: item 82 checks 1-11.
2. Removed/changed chips are not carried: chip checklist check 10 (Create half).
3. Day and time carried: check 18 (a-i) and 18j's Create bullets (Today at 3 PM, explicit date, date-only + "Pick a time").
4. Facts survive across screens: C18 (a) and (d).
5. **Place it** (location selection): C24 (a), (b), (c), (f); then publish and check the distance wording: item 146 checks 2, 4, 13.
6. The time picker on a date-only day (iOS): check 18j's last bullet. **Do not change the picker before this result exists.**

## 4. Ask Nearby Businesses from the ask

1. Carried facts + missing fields: item 84 checks 1-13, 15.
2. Corrections carried: chip checklist checks 10 (request half), 16e, 17d, 18d, 18j's AskBusiness bullets.
3. Facts survive: C18 (b).
4. Send with the seeded business (S5): offer checklist section 1 (request sent: the "We asked N" line, rings, no premature "sent").
   Record what the screen says when NO business is reached (e.g. a category the test business doesn't serve).
5. The business side receives it: on the business website or second phone, the Opportunity card shows the same facts
   (category, day, time, party). From a hosted gathering instead: C19.
6. Stop here unless Anthropic credit exists (replies need screening).

## 5. The correction journey, end to end (owner's question, 2026-10-23)

One continuous run, recorded as a story (what the person saw at each step), not as separate checks:
"pickleball friday at 2 PM" -> results (Friday chip + "At 2 PM") -> tap the date chip -> pick Saturday -> results show Saturday,
the 2 PM chip is gone -> Create it (Saturday + "Pick a time") -> Back -> Ask Nearby Businesses (📅 Saturday, Time empty).
Record, report only: **does the empty time clearly say "choose a new time" without making it feel like Nearby lost the request?**
Would the person know why 2 PM went away?

## 6. If time remains (same phone, lower impact)

C9 (card reasons), C12 (Home doors), C10 (live time labels), item 46 (refine next step), C20 (confirmations self-clear).

## 7. Later sessions (not this one)

- Offer experience (needs Anthropic credit + seeded business): `OFFER_EXPERIENCE_DEVICE_CHECKLIST_2026-10-10.md` sections 2-12, C18 (c).
- Motion-focused order (owner 2026-10-12): item 55 first, then items 28 and 32 (two phones), then the rest of the motion checks
  (C13-C16). This session's journey-first order (owner 2026-10-23) does not replace that order for the motion session.
- Two-phone checks: C17, C22, item 39/40, item 146 checks 7-8.
- Android: repeat parts 1-5 on an Android phone (C24 (c) POI behaviour is Android-specific).

## Watch list: could confuse people or stop them finishing

Record each when it happens (or explicitly "not seen"). These are known risks from the built behaviour, not decisions to change.

Could stop completion
- W1 No seeded data near the phone: every result is an empty state (S4). Not a product defect; fix the setup.
- W2 Maps SDK missing or location denied: the pin screen or "near me" may not work (S2/S3). Record exactly what the person sees.
- W3 Send reaches no business: record the screen's words; the person must still know what happens next (part 4.4).
- W4 Words only the AI would understand (no credit): no chip, generic results. Record the phrase as a taxonomy-miss candidate; don't fix in session.

Could confuse
- W5 Silent drops of a day: "sat", "fri", "Fridays", "11/4", "tonight November 4" all carry NO day and nothing says so (by design:
  never guess). Watch whether the person notices the day chip is missing.
- W6 Two behaviours for a missing time: "pickleball tomorrow" opens Create at Tomorrow's default (noon, 18b) while "pickleball
  saturday" asks "Pick a time" (18i). Record whether either feels wrong.
- W7 "tonight after 7" opens Create at Tonight's default (7 PM), which can look like a carried start (18c).
- W8 After a day change the time is empty (part 5).
- W9 iOS wheel resting on noon: choosing exactly noon needs a scroll off and back (18j).
- W10 The date chip's row has 12 choices; check it wraps and reads on a small phone (18j, 16g).
- W11 Up to three amber "missing" marks at once on Ask Nearby Businesses (item 84 check 12).
- W12 Create's review step shows no map: a host could publish the wrong spot without noticing (C24 (f)).
- W13 Android: tapping a Google place label doesn't place the pin (C24 (c)).
- W14 Gathering pins/distances are approximate (up to ~1 km, "About x mi"): a guest may think the map is wrong (item 146 checks 1-2, 13).
- W15 Chips have ✕ on results but not above People (chip checklist check 11): record whether the difference is noticed.
- W16 No Places tab and no non-partner places (Google discovery held): searches may feel thin (C23 (0), expected).

## Record

For each part: device, OS, build, account, mode, language; per check pass / fail / note; for a defect: steps, what was expected
(quote the source check), what happened, screenshot. Results go into the source checklists; a one-line summary per part goes into
CLAUDE.md's open-work lines when the session ends.
