# Build 88 physical-device checklist (2026-11-26)

For build 88 = main at 62265e474 or later. Nothing here has been run on a phone. Record each check as
PASS / FAIL / USABILITY / SETUP-BLOCKED / NOT TESTED, with Sev 1-3 for a FAIL. A check whose migration isn't live yet is
SETUP-BLOCKED, never FAIL. For every check, write down: device, iOS version, light/dark mode, text size, which build
(staging or TestFlight), and the database version (`npm run migration:status`).

Where this runs: first on the **staging** build (`OWNER_STEPS_BUILD88_2026-11-26.md` step 2, staging at 0429 plus whatever
has been applied since), then once more on the **production** TestFlight build 88 before Phase 2 starts.
Two accounts (a second phone, or a simulator) are marked **[2]**.

## P. Pre-flight
- P1 Settings > About (or the TestFlight list) shows build 88. On staging the app name is "Nearby Staging".
- P2 Sign in with an existing account (phone code; on staging, use the test OTP, renewed after 2026-11-28).
- P3 **Build 88 against today's production schema** (0347, later 0372). Open every tab plus Dating Browse, Friends, Edit Profile,
  Business Mode and Settings. Any error banner, spinner that never stops, or blank list = FAIL. Build 88 falls back when a
  server function or column is missing (Dating Browse, `id_verified`, tattoo/piercing columns, offer view receipts, familiar hosts,
  crossed-paths sharing). That fallback is unit-tested only: there is no build-88 compatibility journey at 0347 or 0372 yet (R4
  covers build 87). This is the check that matters most.

## 1. Back navigation (react-native-screens patch + leave guard; first native compile happens in this build)
- 1a Edit Profile: Back with no edits leaves at once. After editing the bio, Back shows "Discard changes?"; Cancel stays, Discard leaves.
- 1b Swipe-back on Edit Profile does the same as 1a.
- 1c Save, then Back: leaves without the dialog.
- 1d Back works afterwards on Settings, Friends, a GatheringDetail, ViewProfile and a chat, many times in a row (the old bug left Back dead on later screens).
- 1e The back label shows the tab's name, never "MainTabs" / "Main Tabs".

## 2. Onboarding (fresh account, or staging)
- 2a "Anything else?" with "hiking pottery salsa" (no commas): all three are recognized; a word it doesn't know shows under "Not matched yet".
- 2b The heading reads "What kind of social plans do you enjoy?" and its subtitle doesn't mention Dating. Several choices can be picked; "I'm open to anything" clears the others.
- 2c Edit Profile > Interests shows the same social-plans choices, saved.

## 3. Dating and Friends
- 3a Browse loads, scrolls and refreshes. Pull-to-refresh stays in Browse (never jumps to Crossed Paths). Try Again after airplane mode works.
- 3b Cards show at most 2 reasons, and only answers both people gave. Check list and swipe deck at default and at the largest text size.
- 3c Dating Preferences: the tattoo/piercing choices are hidden until 0417 is live, then visible and saved. Hair/eye/height never hide anyone.
- 3d [2] Friends swipe: Pass, then Rewind, then a second swipe acts on the visible person (needs 0433 for the server-side history).

## 4. Business (owner account with a business; website checks in a browser too)
- 4a Make an Offer: the dock shows "Customer preview" + Send under the form. Opening it shows the card; with the keyboard up only Send stays; Send clears the home indicator; VoiceOver reads expanded/collapsed; works at larger text.
- 4b Business Home: "N new requests" lists up to 3 rows; tapping a row opens that exact request, outlined. No open requests = no section.
- 4c Category search: typing in "Also classify as" filters the list in place; selected categories stay visible.
- 4d Profile: the six closed groups each show what's saved ("Not set" when empty); "We go to customers" asks for a rough area only (needs 0419 to save).
- 4e Phone + website row saves (needs 0423).
- 4f Offer Performance: four equal cells plus "Value of offers redeemed" with its note; no "viewed" count anywhere.
- 4g [2] Visit confirmation: the customer taps "Mark as done" and sees "✓ Marked as done"; the business taps "Confirm visit" and the customer later sees "Visit confirmed". "Didn't show up" and confirming can't both happen (needs 0430-0432).
- 4h [2] Multi-location: switching location reloads that location only; a switch on device A makes device B's open screen refuse and reload (needs 0424-0427).

## 5. Things that should be gone or reworded
- 5a There's no host reputation line (GatheringDetail, profile, business profile) and no referral code box.
- 5b There's no "What people loved" line. The "How was it?" answer saves privately.
- 5c The waitlist reads "You're on the waitlist." and never promises a spot.
- 5d The Report sheet shows "Fake profile or impersonation" and "Inappropriate content".

## 6. Gated on Phase 2 services (SETUP-BLOCKED until they're live)
- 6a Public text (gathering title, community post): a refusal shows under the field, not as an alert (needs 0373 + `screen-user-content` + Anthropic credit).
- 6b Trending appears only with 5+ established attendees (needs 0409).
- 6c Hand-written offers screen and send (needs Anthropic credit).

## 7. App update screen (20270434; SETUP-BLOCKED until 0434 is on that project; try it on STAGING first, never by enforcing on production for a test)
Staging steps use `app-version-policy.js --target=staging` (no approval code). Afterwards switch everything off again.
- 7a Policy off (as installed): the app opens normally, with no notice. Airplane mode at launch: the app still opens.
- 7b Latest = a build above the installed one (recorded available on staging): one "A new version of Nearby is available." notice at the top; Not now hides it; it stays hidden after relaunch until a newer latest build is set. It never covers the tab bar or header buttons.
- 7c Minimum enforced above the installed build: "Time for an update" replaces the app at launch. Update Nearby opens the link (TestFlight on staging). Check again with nothing changed shows "This version still needs an update."
- 7d While 7c is set, switch it `off`: Check again (or returning to the app) opens the app normally. No reinstall, no sign-out.
- 7e With the app open on any screen, enforce the minimum: the next action that reaches the server shows the update screen (no endless spinner, no crash).
- 7f Sign out and back in while enforced: the update screen shows, not the sign-in loop.
- 7g Light and dark mode, the largest text size, VoiceOver: title read as a heading, buttons named, "Checking…" read while busy.
- 7h [2] Build 87 on the second phone while 7c is set: its screens show errors (expected: no update screen in 87). Record what it shows.
- 7i Website (browser): a page left open past an enforced web minimum shows "This page is out of date" + Reload.
- 7j With 7c showing, put the phone in airplane mode, relaunch (screen stays: last policy kept), then switch the minimum `off` on staging and turn airplane mode off WITHOUT touching the app: within about 30 s the app opens by itself.
- 7k While enforced, a photo upload (profile photo) and an AI feature (e.g. a message translation) from a build below the minimum: the update screen shows, nothing is saved.
- 7l Strict mode on (staging): the current build works everywhere; a shared gathering invite page (docs/invite.html) still opens in a browser; an old website tab is refused.
- 7m Delete account and Export my data still work from a build below an enforced minimum (never refused, on purpose); sign-out works.

## Results go to the owner as
Actual results / launch blockers / usability / fixes in priority order (same format as the Tier 1 run order).
