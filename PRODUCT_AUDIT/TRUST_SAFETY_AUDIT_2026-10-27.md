# Trust & safety audit (owner, 2026-10-27)

Read-only. Code + live production (policies, triggers, functions, auth settings). Two behaviours were PROVEN in
rolled-back transactions under the real `authenticated` role (nothing saved). No production data changed, no feature
built, no third-party service or device tracking introduced. Nothing here is device-verified.

## Summary

| # | Finding | Status | Launch |
|---|---|---|---|
| B1 | Any signed-in user can mark their own profile verified (`profiles.photo_verified = true`) and insert their own `approved` verification row | PROVEN (rolled back) | BLOCKER |
| B2 | Admin "Suspend User" changes nothing (0 rows) yet says "Suspended"; no real suspension exists | PROVEN (rolled back) | BLOCKER |
| B3 | One flag `photo_verified` means three things: main photo passed automatic screening, ID approved, not suspended; the "✓ Verified" badge reads it | Code + live | BLOCKER (truthfulness; needed before any "verified only" rule) |
| B4 | ID + selfie images are kept forever after review; no bucket size/type limits; files uploaded without a submission row survive account deletion | Live | BLOCKER (privacy) |
| B5 | Email + password sign-up is open at the API (min 6 chars, no CAPTCHA), so an account can exist without a phone; 4 of 8 accounts today have no phone | Live | DECISION before launch |
| I1 | No duplicate profile-photo detection | Code | Before public launch (owner: High) |
| I2 | No rate limit on chat messages (gathering, community, plan chats), reports, invitations, business requests beyond the 10-minute duplicate check | Live | Before public launch |
| I3 | Reports carry no link to the content (message, gathering, photo), no record of the action taken, no notice to the admin | Code + live | Before public launch |
| I4 | Block gaps already disclosed in CLAUDE.md "Known residuals" (below) | Known | Review, mostly can wait |
| L1 | Device/IP risk scoring, third-party ID/liveness vendor | Not built | Later (owner) |

## 1. What each action requires today

| Action | Phone | ID | Notes |
|---|---|---|---|
| Create account (app) | Yes (SMS code via Twilio Verify) | No | The app offers phone login only |
| Create account (direct API) | **No** | No | Email + password enabled at the project level (B5) |
| 18+ | Enforced | n/a | DB check `must_be_18_plus` + onboarding |
| Appear in Dating discovery | n/a | **No** | Requires only the Dating opt-in (`is_dating_discoverable`) |
| Appear in Friends discovery | n/a | No | Shows the `photo_verified` badge only |
| Others see your extra photos | n/a | photo_verified | RLS on `profile_photos` (i.e. passed screening, not ID) |
| Host a public gathering | n/a | No | Daily limit trigger (`on_gathering_created_enforce_limit`) |
| 1:1 messages | n/a | No | Only inside a mutual match, blocked either way = refused (`messages` RLS) |
| Group chats | n/a | No | Membership/attendance only; no throttle |
| Friend request | n/a | No | Daily limit trigger; blocked either way refused |
| Ask businesses | n/a | No | 10-minute duplicate check only |

"Phone verification" therefore holds only for accounts made through the app (B5).

## 2. Should Dating, hosting, messaging require more?

- **Dating discovery: require ID verification (recommended).** Highest harm from a fake profile, and the opt-in pool
  is the one place strangers see each other. Possible only after B1 + B3 (a real `id_verified` that only the admin
  approval can set). Manual review by the owner is workable at launch scale.
- **Hosting a public gathering: phone-verified account + the existing daily limit, no ID at launch (recommended).**
  Attendees never get the exact point unless approved (item 146) and hosts can require approval. Revisit if reports
  show fake hosts. Option for the owner: require ID only for women-only gatherings.
- **Messaging: no extra verification (recommended).** 1:1 already needs a mutual match; group chats need attendance or
  membership. Add throttling (I2) instead.

## 3. Repeated sign-up, code abuse, spam, duplicates

- Phone: one account per number (Supabase). SMS sends 30/hour project-wide, at most one per 5 s per number, code
  expires in 60 s; Twilio Verify adds its own fraud checks. Internet (VoIP) numbers are accepted; the owner's own
  test account uses one, so never refuse them outright.
- Email (B5): any address that can receive a confirmation, 6-character password, no CAPTCHA.
- Daily limits exist: gatherings, communities, friend requests, notices (waves), stories, AI uses
  (`enforce_*_daily_limit`, `check_and_increment_ai_use`), counters protected by `prevent_self_premium_edit`.
- No limits: chat messages, reports, invitations, business requests (beyond duplicates) (I2).
- Duplicate photos: nothing (I1). Photo screening (`moderate-photo`) uses AI and is currently down with the
  Anthropic credit, so new photos stay unscreened (hidden from others), which fails safe.

## 4. ID and selfie images

- Bucket `id-verification`: private. Upload only into your own folder; read = your own files or an admin.
  1 admin today (`profiles.is_admin`, protected from self-edit by `prevent_self_premium_edit`). 0 submissions,
  0 files in production.
- Admin screen shows them via 1-hour signed links: an admin can save them (no download control exists in any app).
- Retention (B4): no deletion after approve or reject; the Privacy Policy promises deletion only with the account.
  Account deletion removes the files listed on submission rows, not other files in the person's folder.
- No file size or type limit on the bucket.
- Submission row: the person can insert any `status` (B1); only admins can update; no delete for anyone but cascade.

## 5. Blocks

Hide both ways and refuse contact in: 1:1 messages + reactions, friend requests, community chat (reads), business
messages, Dating discovery, gatherings (item 147 rules), invitations (20270343). Already-disclosed residuals (CLAUDE.md):
`profiles` read by id is not block-filtered; the crossed-paths push names the other person regardless of Dating consent;
one-way client filters in `gatherings.js`, `ActivityScreen.js`; plan chat has no block filter (a shared group plan
keeps both people in it). Recommended before launch: only the crossed-paths push (it can expose someone who never
opted into Dating). The rest can wait for evidence.

## 6. Reports

Report + Block from profiles, Discovery and every chat (`ReportBlockModal`). Admin screen lists reports and can mark
them resolved (RLS allows). Gaps: Suspend does nothing (B2); no real suspension (no ban, no hidden flag set, no
sign-out); a report stores reason + free text only (no message/gathering/photo reference, I3); nothing records what
the admin did; no alert reaches the admin; no limit on reports per person.

## 7. Smallest fixes before public launch (each needs owner approval; none built)

1. **B1:** add `photo_verified` (only false -> true) to the existing profile guard trigger, the same way `is_admin` is
   protected (trusted server writes: `moderate-photo` runs as service role, the admin RPC sets `app.trusted_update`);
   do the same on `profile_photos`; the submission INSERT policy also requires `status = 'pending'` and empty review
   fields. Watch: `extraPhotos.js` promotes an extra photo to the main one by copying its flag from the client: move
   that swap into one server function. One migration + journey (self-verify refused, real flows still work).
2. **B3:** a separate `id_verified` set only by `admin_approve_id_verification`; the "✓ Verified" badge and any
   "verified only" rule read it; `photo_verified` keeps meaning "photo passed screening".
3. **B2:** one admin function `admin_suspend_user` (sets the existing `profile_hidden`, records the action on the
   report, optional sign-out) replacing the client update; the screen reports the real result.
4. **B4:** delete the ID + selfie files once a decision is made (keep the decision row), delete the person's whole
   folder on account deletion, bucket limits (image types, size); one sentence in the Privacy Policy.
5. **B5 (decision):** either turn off email sign-up for consumers (business sign-in path must be checked first, the
   business-owner test account uses email) or require a verified phone before any social action.
6. **I1:** exact-duplicate photo check (a hash of the uploaded bytes, compared on upload) as a first step;
   look-alike detection later.
7. **I2:** per-minute message throttle on group chats, daily caps on reports and invitations.
8. **I3:** optional reference to the reported item + an action log on the report.

## 8. Can wait for real-user evidence

Device/IP risk scoring, VoIP scoring, third-party ID or liveness, look-alike photo matching, automated report triage,
the remaining block residuals.

## Phone-session additions (suggested, not yet in the run order)

ID verification submit -> admin approve -> badge; reject; report from a chat; block from a profile (both phones:
the other person disappears everywhere); admin resolve. Results stay unverified until run.
