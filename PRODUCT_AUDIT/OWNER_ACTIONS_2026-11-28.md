# What only you can do, and in what order (2026-11-28)

Everything below needs your hands, your accounts or your approval. What Claude can do alone is at the end.

## A. Before Batch 1 (privacy fixes 0348-0354) — about 45 minutes
1. **App Store Connect (R2).** appstoreconnect.apple.com > Apps > Nearby:
   - Distribution > iOS App: is any version **Ready for Distribution / on the App Store**? Write the build number, or "none".
   - TestFlight > Builds > iOS: for each build <= 86, is it **Expired**? If not: open it > Expire Build.
   - TestFlight > External Testing: any group with build <= 86? Remove it.
   - Tell Claude: "R2: no public build; builds <= 86 expired" (or what you found).
2. **Coastal Coffee website pass (R8)**, right before 0348 and again right after it. Use the CURRENT published site
   (thisisnearby.com/business or allenklein94.github.io/Nearby/business), signed in with the Coastal Coffee account:
   | # | Do | Pass = |
   |---|---|---|
   | 1 | Sign in with the phone code | Dashboard loads (not blank, not "complete your profile") |
   | 2 | Open Home | "Today at Coastal Coffee" card shows; no error banner |
   | 3 | Open Opportunities | List or "no requests" empty state; no error |
   | 4 | Open Bookings | "No bookings yet" or the list; no error |
   | 5 | Open Offers | Loads |
   | 6 | Open Profile, change one small field (e.g. description, add a word), Save, then revert it | Both saves say saved; the value shows after reload |
   | 7 | Sign out | Returns to sign-in |
   Write PASS/FAIL per row with the time. Any FAIL before 0348 = we fix before deploying; any FAIL after = STOP.
3. **Backup passphrase ready** (Bitwarden). On the day Claude runs the backup script (needs your OK: it creates a
   temporary read-only role on production), you download the encrypted file and confirm its sha256.
4. **Decide**: (a) may Batch 1 go before Tier 1 (recommended; Tier 1 then runs on the fixed database)? (b) close sign-up
   meanwhile (`disable_signup`), yes/no? (c) keep 0384 in Phase B (recommended)?
5. **Approve each file** with its code from `BATCH1_APPROVAL_PACKET_2026-11-25.md` (one message per file is fine:
   "approve 20270348:12372a27…a515").

## B. Tier 1 on the phone (build 87) — about 40 minutes
The exact list is `BATCH1_APPROVAL_PACKET_2026-11-25.md` "Tier 1 on build 87" items 0-10. The 2026-11-27 session was a
findings session and does **not** count as Tier 1. If Batch 1 is already deployed, Dating Browse, Crossed Paths and "Set
as main photo" should now WORK (record PASS/FAIL; before Batch 1 they are KNOWN defects, not FAILs).

## C. Anthropic credit (needed for Phase B and every screening check)
Follow `EXTERNAL_SERVICES_SETUP_2026-11-27.md` section 1: a SEPARATE Anthropic organization for staging (new email, own
billing, monthly limit), key set with `read -rs K && supabase secrets set --project-ref hxsioiiulubavhogzipo
ANTHROPIC_API_KEY="$K"; unset K`. Production's org: add credit only when you decide Phase B is near. Never paste a key in chat.

## D. Test accounts for Dating and Friends
A person shows in Dating only if their "What are you looking for?" includes **Go on dates**, their photo is screened and
the profile isn't hidden (after 0352 also a verified phone). Friends discovery needs **Open to meeting new friends** on
both sides. You need two such accounts on two devices (your iPhone + a second phone or a simulator), e.g. the phone-login
account + applereview. On each: Profile > Edit > "What are you looking for?" -> Go on dates (+ Make new friends);
Discover > People > Friends: turn on being discoverable when it asks (that screen holds the switch). Crossed Paths additionally needs both phones near each other.

## E. Manage Subscription
Settings > Manage Subscription opens Apple's native sheet: only a real TestFlight build on the phone can show it (finding
22). Check: the row opens the status section in place, "Manage" opens Apple's sheet, closing it returns to Settings.
Record what you see; nothing to buy.

## F. Native-language review
Machine-written strings in 10 languages wait for a native speaker. Practical minimum before outside users in a language:
`ui.appUpdate.*`, `ui.shared.errors.gatheringLimit`, `ui.onboarding.socialPlansTitle/Subtitle`, the cuisine and
Dating reason strings, and the item checklists named in CLAUDE.md. Send a reviewer the English + target line pairs
(Claude can export them per language on request).

## G. Later approvals (each its own message)
`moderate-photo` redeploy after 0349; Privacy sentence for 0351 (+ 0355/0357 later) published on main; taxonomy
inventory sync after merge (diff below); merge of `fix/device-findings-nov27` into main; build 88 (you run EAS);
website export publish; Phase B files.

## What Claude does without you
Code, tests, journeys and replays on the isolated local database, screenshots from fixtures, read-only production catalog
checks, packets and plans. Never: production writes, migrations, Auth/secrets, publishing, merging, EAS builds.
