# Batch 1 (0348-0354): approval packet, Tier 1 checklist, Privacy Policy wording (2026-11-25)

PREPARATION ONLY. Nothing here is approved or deployed. Each migration below needs its own explicit approval, given only
after the preconditions pass. Deploy branch `deploy/catchup-0348-0432`; isolated rehearsal results in
`MIGRATION_CATCHUP_ISOLATED_TEST_PROGRESS_2026-11-25.md`.

## Preconditions for the whole batch (all must be true before the first approval)
1. R2: no public App Store / external-tester copy of build 86 or older (owner, App Store Connect).
2. R3: Tier 1 below passes on build 87 against production as it is (0347).
3. R7: a production backup taken THE SAME DAY, restored in isolation, every table's rows identical (script prints PASS).
4. R8 pre-step: the owner signs in on the business website (Coastal Coffee), opens the five tabs, saves one profile change.
5. Right before each deploy: `npm run migration:status -- --target=prod` shows the previous migration as the last recorded.

## How each one is deployed (same for all seven)
```
NEARBY_PROD_APPROVAL=<version>:<sha256 below> NEARBY_APPROVAL_REF="owner approval <date/message>" NEARBY_SESSION_ID=<session> \
  npm run migration:deploy -- supabase/migrations/<file> --target=prod
```
`deploy.js` refuses an uncommitted/changed file, a hash mismatch, out-of-order, already-recorded. The migration and its
ledger row commit in one transaction. Stop at the first failed post-deploy check; no automatic rollback (owner decides).

| # | Migration | What it changes for people | Approval code (sha256) | Right after (verification) | Rollback (newest first) + limits |
|---|---|---|---|---|---|
| 1 | 20270348 profile_column_privacy | Another account can read only the viewer-safe profile columns (N6, HIGH). Build 86 breaks (stuck in onboarding); build 87 reads its own row via `get_my_profile()` | `12372a270d356266336f3163bf2f53afd84611dad4be1c8edfb610089585a515` | `get_my_profile()` own / cross-user / signed-out + catalog check; journeys profileColumnPrivacy, appVersionCompatibility, datingConsent, friendDiscoveryChoice, pushTokenPrivacy; then the owner repeats the website five-tab pass. Any failure = STOP | `20270348_profile_column_privacy.rollback.sql`: re-opens N6 (never with external users) |
| 2 | 20270349 verification_self_grant_guard | Nobody can mark themselves verified or admin; photo screening bound to the exact file; hidden/suspended/blocked profiles' photos closed; photo links 15 min | `e14971c04fd70bc79c0e66fa77b07637a7fbead2e572dab921859c86649c11cf` | **edge: deploy `moderate-photo` right after** (below); `scripts/replay/photo-storage-api.js` against prod storage (read-only); journeys photoScreeningBinding, trustSafety | `20270349_..._rollback.sql`; links already issued stay valid to expiry (documented residual) |
| 3 | 20270350 identity_verified_separate | "ID Verified" only from an approved ID, separate from photo verification | `4cf8bff802c3a370244912ecb574c7ebdb9d41adcdee0a0d6a7fc910b8100802` | journeys datingConsent, appVersionCompatibility | rollback restores the badge reading photo_verified only if the app is rolled back too |
| 4 | 20270351 account_suspension | Real suspension: an admin-suspended account's writes are refused, sessions end | `5ce0f0e8b742fcd41a0c874252e75c33c3c17ad31bb54f907c24b69912bc99aa` | journeys friendDiscoveryChoice, trustSafety; real-API suspension test incl. the OLD-token case (dedicated test account; each protection reported separately; unexpected = STOP) | WARNING: unsuspends anyone suspended meanwhile: check `suspended_at` + `banned_until` first |
| 5 | 20270352 phone_required_for_social | Social actions + discovery need a verified phone. The outlook business account (no phone) keeps business features only | `fb95bbd49b30fa033ed23cd6525f4679d2849c3be16ed914161c6c2433109efe` | journeys gatheringCreationLimits, trustSafety; Tier 1 item 0(f) (real phone sign-up can verify and act) | rollback restores the views on top of 0348's narrowed ones |
| 6 | 20270353 crossed_paths_push_consent | The crossed-paths push respects Dating consent | `3035c5c0dbb59cf65861f655734edc586bf48786c3287d5220d5e2e1bdce0a8b` | journey sightingExpiry | plain restore |
| 7 | 20270354 id_verification_upload_limits | ID-upload bucket limits (size, type) | `39704832c7061377b8e19e331c77799827237b10027a4871ae4425f86f410c8f` | journeys trustSafety, trustSafetyI123 | plain restore |

Rollback files are proven in isolation: all 85 run newest-first back to 0347 behaviour (only ACL order + whitespace differ);
re-apply identical. They restore the production definitions read 2026-10-27/28; the 2026-11-25 drift check confirms
production hasn't changed since (no functional drift).

### Edge function with Batch 1: `moderate-photo` (right after 0349; separate approval)
- Live: v17 (2026-08-01) = commit 806d524ef byte-for-byte. Saved bundle: `/workspaces/.nearby-verify/catchup/edge-rollback/moderate-photo.live.eszip`.
- New: deploy branch source (file-version binding for 0349, SHA-256 for 0357, dHash/pHash for 0368). Type-checks on Deno 2.1.4.
  Also bundles the current `_shared/` (incl. the JWT-key helper without its legacy fallback): first live use of that change.
- Deploy: `npx supabase functions deploy moderate-photo --project-ref enmosvippabmuqslzrox` from the deploy branch.
- Verify: upload one profile photo on build 87: it is screened and shows; the photo row carries the file version; logs clean.
  Before 0357/0368 are live the new hash recording calls fail softly (logged, upload unaffected): check that once.
- Rollback: `git checkout 806d524ef -- supabase/functions/moderate-photo` in a scratch worktree and deploy that.
- `delete-account` stays HELD (unchanged).

## Tier 1 on build 87 (production at 0347), exact list
Result codes PASS / FAIL / USABILITY / SETUP-BLOCKED / NOT TESTED, Sev 1-3. Source: run order
`FIRST_PHONE_SESSION_RUN_ORDER_2026-10-23.md` ("Tier 1"); P1 build check: TestFlight shows build 87.
0. Account basics (any failure = Sev 1, stop):
   a. Sign out, sign in with your existing account; note the time you tap send; SMS arrives; no unexplained ~15 s wait
      (a Cloudflare tick box is allowed); Home loads. Afterwards Turnstile Analytics should show a solved challenge then.
   b. Profile shows your details; Edit Profile saves one small change, then revert it.
   c. Open another person's profile (a friend or applereview).
   d. Settings > Notifications on; ask Claude for one test push; it arrives.
   e. Plans opens with no error.
   (f, the real new-phone sign-up + new-user path + block behaviour on two accounts, is a separate controlled test after Tier 1.)
1. Profile > "🔥 Your Progress": expands/collapses in place, scroll kept on collapse, "Keep the streak going" -> Discover Gatherings, screen reader says "expanded".
2. Settings > Safety > Emergency contacts in place (keyboard doesn't cover the field; remove what you add); date check-in link; Settings > Manage Subscription in place.
3. Business application (Profile): opens the right view for your latest application (don't approve a test application).
4. Home "N plans this month" -> Plans on Past; Plans loads at all (load error = Sev 1).
5. Interested sharing checks 1-3 (first ☆ Interested explains optional sharing; acknowledging never turns it on).
6. No seed needed: Discover quick pick "Dinner ✕" beside Tonight, ✕ clears it, "+ Start a Dinner Gathering" opens Create with Dinner + today and no time; Create's own Tonight = today + "Pick a time"; Gatherings search box shows suggested activities, a pick replaces the activity; Home "Explore nearby →" + the Right Now chevron; Join stays Join after ☆ Interested.
7. With one visible gathering of your own (host-cancel it after): Discover ☆ Interested (a)-(f), "1 attending" on your tile, List | Map show the same results and the map keeps its region.
8. In a chat with applereview, long-press THEIR message: Report is easy to find; read the sheet; cancel (or submit only on a controlled test message).
9. Only if a limit message appears: note exact words + screen (neutral, never "because you're new").
10. Build 87's UX changes (never on a phone): keyboard never covers fields on full screens and sheets; inline missing-field errors on Create/Edit Community, EditGathering, AskBusiness, Edit Profile (first problem scrolled to, entries kept); grouped interest picker in Edit Profile (length, scrolling, "N selected"); whole-row toggles toggle once (also tapping the switch), with VoiceOver on and off; the grey disabled button look readable in light and dark, never mistaken for active, a saving button not read as an error; header spacing; community gathering rows tappable.

## Privacy Policy wording needing approval for Phase 1 (owner + counsel; publish in `docs/privacy.html` with the migration)
1. **With 0355 (reports)**, safety/moderation section:
   > When you report someone, we keep a copy of the reported message or chat excerpt with your report so our safety team can review it, even if the message is later deleted. Reports are visible only to Nearby's safety team (you can see the reports you filed). We keep a report for 12 months after it is resolved, even if either account is deleted, and then delete it.
2. **With 0357, in the form that is true once 0368 is live** (Phase 1 includes 0368, and the redeployed `moderate-photo` records the similar-image fingerprints even while detection is off; the shorter SHA-256-only draft would then be untrue), profile photos section:
   > To find accounts that reuse the same photo, we compute fingerprints of each profile photo you upload: an exact one, and compact summaries of the image's overall pattern that also match resized, re-saved, filtered, mirrored or slightly trimmed copies. They are not face recognition and do not identify who is in a photo. A match is reviewed by a person and never by itself leads to action on your account. We keep a photo's fingerprints only while that photo is on your profile.
3. **With 0356/0358/0362 (limits)**, how we use information:
   > To prevent spam and abuse we limit how often some actions can be taken (for example, messages per minute or public posts with contact details per day). Limits depend on whether your phone number is verified and how long your account has existed.
4. **With 0351 (suspension)**, drafted 2026-10-27, needs a real support address:
   > **If your account is suspended.** You can still ask us for a copy of your personal data, or for its deletion, by emailing [support address]. We will first confirm the request comes from the account holder (for example, from the email address or phone number on the account). We may keep information we are required to keep by law, or need to keep to handle a safety report, a dispute or to prevent fraud; we will tell you what we keep and why.
5. **Question for counsel, no wording drafted:** 0363 keeps the ~1-degree area of a REJECTED location jump for 1 hour. The policy already says rounded presence location is kept 1 hour; confirm that covers it.

## Separate, staged: Friends Crossed Paths fix (20270433, branch `fix/friend-swipe-history`)
Server-only, fixes build 87 with no new build. sha256 `2c858e95a804873a957b281eb529f1006463b9b724ff57e3741180d67bfdcb41`.
`deploy.js` enforces number order, so as numbered it deploys after 0432. If you want it in Phase 1, say so: it would be
renumbered (it depends on nothing after 0347) and re-tested; any renumbering changes its approval code.
