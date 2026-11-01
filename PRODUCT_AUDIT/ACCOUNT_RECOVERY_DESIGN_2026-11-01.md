# Account recovery, protected deletion, stronger sign-in: investigation + design (2026-11-01)

Status: DESIGN APPROVED WITH ADJUSTMENTS (owner, 2026-11-01) and BUILT as a revision of 20270375 IN PLACE (never deployed or
merged), branch `post-tier1/account-takeover`. NOT DEPLOYED, NOT MERGED, NOT DEVICE-VERIFIED. 0375 stays an EXTERNAL-LAUNCH
BLOCKER until the gates in section 5 pass. Build 87 + Tier 1 stay the immediate priority. Sections 1-3 = the original
investigation + proposal; section 4 = what was actually built after the owner's adjustments; section 5 = verification + gates.

## 1. What was tested (2026-11-01)

Isolated environment only: from-scratch replay (499/499 migrations, incl. 0375) + real Supabase Auth v2.197.0 (= production),
test OTP numbers, no SMS, nothing sent to production. Probe: `scripts/investigation/account-recovery-probe-2026-11-01.js`
(observations, not a pass/fail suite). Production Auth settings read-only via the Management API (selected fields).

| Question | Observed |
|---|---|
| Does the 24 h rule block an admin number change through Auth's admin API? | **Yes, and silently.** `updateUserById(phone, phone_confirm)` inside the window: Auth answers **OK**, nothing is saved, a `phone_change_refused` event is recorded. An admin would believe the recovery worked. After 24 h the same call saves. |
| Can an admin end every session? | Yes (Auth admin sign-out, global): both the intruder's and the owner's refresh tokens were refused afterwards. |
| Does the DB owner get around the rule? | Yes (direct UPDATE as `postgres`), as for every guard. Not a recovery procedure. |
| Does the owner's existing session survive an intruder's number change? | **Yes** (its refresh still worked). |
| Can the owner then change the number back from that session? | **No.** The intruder's number-change confirmation counts as a new sign-in (`last_sign_in_at` moved to that moment, a new session appeared), so 0375's rule refuses the owner's change back for 24 h. |
| Can the owner sign in with their own number afterwards? | It opens a **new, empty account**. |
| Can the intruder still end the owner's session? | Yes: Auth's own global sign-out from the intruder's session ended the owner's session. The database can't tell which session asked, so no database rule can stop this. |
| Production Auth settings that matter | `security_manual_linking_enabled` false (no second identity can be linked); passkeys as a second factor (`mfa_web_authn_*`) available but OFF; phone second factor OFF; TOTP ON (fails on phone-only accounts, no email); Sign in with Apple OFF; no session time limits; password reauthentication OFF (B5, staged). |

**Conclusion.** 0375 as staged has a design flaw on top of R4. Its clock ("24 h since the account's latest sign-in")
can't tell the owner from the intruder. After a successful move it works FOR the intruder: it stops the owner's change back
for 24 h, and during that time the intruder can sign the owner out. It also silently blocks legitimate admin recovery.

## 2. Proposed design (smallest safe change)

Principle: **trust the device that was there first, not the latest sign-in.** Phone-code onboarding stays exactly as it is.
No ID is required, no new sign-up step is added, and nothing is fingerprinted.

### D1. Sensitive changes need an established session (replaces 0375's clock; amend 0375 in place, it is unmerged)

- A number change is allowed only from a session that has existed for **7 days** (`auth.sessions.created_at`, read via the
  JWT's `session_id`). The intruder's new session doesn't qualify. The owner's long-signed-in phone does.
- The database trigger can't see which session is asking (Auth writes `auth.users` on its own connection), so the change
  goes through a permit. The app first calls a new RPC `request_phone_change(new_number)`, which checks the calling
  session's age and writes a single-use permit (user + new number, 15 min). The `auth.users` guard saves a number change
  only against an unexpired permit and consumes it. A raw Auth API call with no permit is quietly not saved (as today) and
  is recorded.
- The rest of 0375 stays: no password or email on a phone-only account, the security notices, the private record.
- Effect: the owner reacts to the "new sign-in" notice with Sign Out. The intruder has to sign in again, gets a new session,
  and the 7 days start over. While the owner is active and responds, the intruder can never move the number. If the owner
  still has their old device after a move, they can change the number back at once.
- **Residual (inherent):** an owner with no signed-in device, who never sees a notice, can still lose the account after
  7 days. D3 covers that case.

### D2. Protected deletion (Apple 5.1.1(v): deletion stays in the app; a delay is allowed if the person is told when)

- From a session at least 7 days old, deletion stays **immediate** (unchanged for the real owner on their own phone).
- From a newer session, deletion is **scheduled for 7 days later** (owner may pick 7-30). Every device gets an immediate
  notice ("Your account is scheduled for deletion on {date}. If this wasn't you, open Settings and tap Keep my account").
  The account works normally until then. Keep my account works from any session and from support (D3). The app states the
  date at the moment of the request (Apple asks for the timeline when deletion isn't immediate).
- An intruder can schedule a deletion again after the owner cancels it. Each request notifies again and is recorded, and
  repeats become an admin signal. Repeats cause no data loss while the owner keeps cancelling.
- Truthfulness gate: build 87's delete screen says "deleted". The server may schedule a deletion only for an app build
  that shows the date. Older builds keep today's immediate deletion until no device runs them (same device gate as 0348).

### D3. Emergency recovery: admin tools + a written procedure

Two admin-only functions (`private.require_admin`, 0369; reason required; each recorded and notified). They replace the
silent Auth admin path, which stays refused for number changes so that a service-role key alone can never move a number:

- `admin_recovery_hold(user, reason)`: **freeze**. Ends every session and blocks sign-in (Auth ban), number change and
  deletion. It is a separate state from suspension: never "account_suspended", never a penalty, never public, at most 14
  days unless renewed with a reason. Used as soon as a credible report arrives. It stops an intruder who still holds the
  SIM from signing in again.
- `admin_recover_account(user, case_id, restore_number)`: needs an open `account_recovery` review case (0369) with the
  evidence noted. It restores the number (a private per-transaction marker, as in 0361, never a client flag), ends every
  session, lifts the hold and notifies.

**Procedure (runbook, to be written and rehearsed):**
1. Intake works while signed out: a support address shown on the sign-in help link, in the "number changed" notice and on
   the website. The claimant gives the number and the approximate date.
2. Hold: if the account's private record shows a number change or a new sign-in in the last 30 days, apply
   `admin_recovery_hold` at once. Anyone could ask for a hold, so the abuse is a denial (a frozen account), which is
   time-limited and reviewed. That is accepted.
3. Evidence, independent of the stolen number. Restoring needs **control of the original number again** (an admin-sent
   code after the carrier has fixed the SIM) **plus at least one independent item**:
   - the carrier's confirmation of a SIM swap or port-out on that number, with dates matching the record;
   - a device still signed in from before the event (D1 keeps it alive);
   - a passkey the owner registered earlier (D4);
   - only if the person had voluntarily done it before: an ID check matching their earlier approved ID (0350). Never asked
     of anyone else.

   Knowing the account's content is never evidence (the intruder can read it). A recycled number alone is never enough.
4. Decide, note the reason, restore or decline. Declined: the hold lapses and the account stays as it is. Single-admin
   review is a recorded limit until there is a second admin.

### D4. Stronger than SMS: evaluate, optional, never required

- Recommended candidate: **a passkey as an optional second factor** (Supabase's WebAuthn factor, available, off). Offered in
  Settings, never at onboarding. When present it is required for a number change and an immediate deletion, and it counts
  as recovery evidence. It can be enrolled only from a session at least 7 days old; otherwise enabling it would recreate
  V4 (an intruder enrols their own factor).
- Alternative: Sign in with Apple as a linked recovery identity. Needs manual linking, which must then be gated the same
  way.
- Unknown, to evaluate first: whether Supabase's WebAuthn factor works in a native iOS app (associated domains on a domain
  we control). Needs a native build, so it can't be in build 87. SMS sign-in itself stays (simple onboarding). SMS is never
  described as SIM-swap resistant.

### Tradeoffs

- 7-day session age: someone who reinstalls the app or gets a new phone has to wait 7 days to change their number or delete
  instantly. The message gives the date. A real owner who lost both phone and number recovers through D3.
- Delayed deletion is a slower path for the real owner on a fresh install. Apple-compliant only if the date is shown.
- A hold can be abused as a temporary denial. It is time-limited and admin-reviewed.
- The procedure depends on human judgement and one admin. It is recorded, never automatic.
- The intruder can still read the account and sign the owner out until the carrier fixes the SIM. This is inherent to SMS
  sign-in, and the hold ends it once reported.

## 3. Gates (each needs separate owner approval; in order)

1. **Design approval:** D1-D4 and the numbers (session age 7 d, deletion delay 7-30 d, hold 14 d), and amending 0375 in
   place rather than in a new migration.
2. **Build, after Tier 1** (build 87 unchanged), on the stacked branches. App changes (Settings number change -> RPC first;
   deletion date + Keep my account) go into build 88.
3. **Local verification**, with each of these as a pass/fail check:
   - A new session can't move the number; a 7-day-old session can.
   - The owner's old session can change the number back after an intruder's move.
   - A raw Auth admin change is refused, and `admin_recover_account` works inside any window.
   - A hold stops SMS sign-in and lifts.
   - Scheduled deletion and Keep my account work; immediate deletion works from an old session; build-87 behaviour is kept
     for old builds.
   - Plus journeys, a from-scratch replay, concurrency (permit consumed once), rollback round trip and grants.
4. **Runbook written** + a tabletop exercise. Privacy Policy: deletion timeline, recovery evidence and its retention.
   Apple wording reviewed.
5. **Controlled real test on production** after deploy: two dedicated test numbers, real SMS, owner present. Covers the
   intruder scenario, hold, recovery, and scheduled + cancelled deletion.
6. **Deploy approvals** in migration order, build 88 on every device before the deletion schedule is switched on.
7. **External users** only after 1-6 pass. D4 can follow after launch only if the owner accepts that, recorded.

## 4. As built (owner's adjustments, 2026-11-01)

Owner adjustments: D1 session age alone is not proof, add step-up, admin recovery bypasses cooldowns under audited
authorization; D2 no blanket 7-day deletion delay, verify Apple first; D3 independent evidence, documented procedure, audit,
limited admins, safeguards against false claims, a trusted device supports but never establishes ownership, appeal +
escalation; D4 evaluate, verify how Supabase enforces a second factor, optional passkeys don't solve SMS takeover alone.

Facts checked before building:
- **Apple (5.1.1(v), developer.apple.com "Offering account deletion in your app"):** deletion must be initiable in the app;
  a process that "takes a reasonable amount of time" is acceptable if the person is told how long and gets a confirmation;
  apps "may add steps to verify the identity of the person making the request ... such as by entering a code from an email
  or phone number already associated with the account"; "unnecessarily difficult" deletion fails review; only offering
  temporary deactivation is insufficient.
- **Supabase MFA (supabase.com/docs/guides/auth/auth-mfa):** enforcement is NOT automatic; the app's database/APIs must check
  the JWT's `aal`. Passkeys/WebAuthn are experimental (browser + Swift helpers); nothing confirms React Native support.
- **Auth's reauthenticate endpoint** with Twilio Verify skips its own confirmation step (source, v2.177.0), so the step-up
  uses an ordinary code sign-in on a throw-away client instead, which Auth verifies on every provider.

What 20270375 now does:
- **D1 number change** needs ALL of: a calling session at least 7 days old; a step-up = a fresh sign-in code to the
  account's CURRENT number, verified by Auth, tied by the server to the established session (the fresh session is deleted
  again, sends no new-sign-in notice); aal2 when the account has a verified second factor; no recovery hold. The step-up
  yields a single-use permit for ONE number (15 min). Without a permit: starting a change is quietly not saved (recorded);
  the number itself changing (Auth admin API / dashboard) is REFUSED WITH AN ERROR (no more silent "OK"). Emergency changes
  go only through `admin_recover_account` (per-transaction marker, as 0361). Honest limit: under a SIM swap the intruder
  also receives the step-up code, so the step-up adds friction and an audit trail; the protection is the 7-day session +
  notices + hold.
- **D2 deletion**: the same step-up first (Apple explicitly allows a code to the account's number). Immediate in every case
  EXCEPT a session younger than 7 days on an account with a takeover signal in the last 30 days: then every session ends,
  the profile is hidden, sign-in is refused, and the account is permanently deleted 7 days later (the app shows the date;
  "reasonable time" + told + confirmation). Support can stop it (D3). Behind a server switch, OFF until every device runs a
  build that does the step-up and shows the date (build 87 does not: it deletes at once).
- **D3** recovery admins = admin + an owner-maintained allow-list + aal2 if they have a factor; never on their own account.
  Case required; hold 14 days, extendable with a reason, hard cap 42 days, expires by itself; recovery enforces: open case,
  takeover signal in 30 days, at least one INDEPENDENT item (carrier confirmation, prior passkey, prior ID match), a trusted
  device alone refused, a fresh proof account to restore the number. Append-only audit (24 months). Procedure, appeal and
  escalation: `ACCOUNT_RECOVERY_RUNBOOK_2026-11-01.md` (DRAFT, not rehearsed).
- **D4**: every function above requires aal2 when the account has a verified second factor (Supabase won't). No passkey
  enrolment built: native support unverified; optional enrolment never protects users who don't enrol.
- Kept from the first version: no password or email on a phone-only account; one security notice; the private record.
- App (build 88, never build 87): Settings number change and Delete Account run the step-up (code field in place; the code
  request carries a Turnstile token, since Auth checks CAPTCHA on every `/otp` call once enforcement is on); scheduled
  deletion shows its date. Before 0375 is live the app behaves exactly as before.

## 5. Verification (2026-11-01, local only, nothing sent to production) + remaining gates

Verified: from-scratch replay 499/499 + journeys 883/883 + all 11 concurrency scripts (`account-security-concurrency.js`:
no-permit writes, one permit vs two concurrent moves, single-use deletion step-up); real Auth v2.197.0 on the replay 23/23
(`scripts/replay/account-takeover-auth-local.js`); production journeys 883/883 with 0348-0375 as prelude (rolled back);
rollback round trip identical on the replay and on production in an aborted transaction (0 differences from 0348-0374);
grants replay = production + 0348-0375, 3310/3310; Jest 537/538 (only the known date-dependent benchmark).

Found and fixed while verifying: trusted-write flag save/restore in `account_deletion_authorize` + `admin_recover_account`
(0359 rule); step-up code request carries a CAPTCHA token; test fixtures that clear/move a test phone now do it like
`admin_recover_account` (the guard refuses them otherwise, correctly).

Owner decision (2026-11-01): ACCEPTED as code-complete + locally verified; staged, isolated, external-launch blocker; no
merge/deploy/publish/production change; no further security feature work before the first iPhone session unless a new
critical defect. 0375 does not fully prevent account takeover: an intruder holding the SIM with a session kept alive 7 days
can still move the number (proven on real Auth), the step-up code reaches a SIM-swapper too, and a refused password attempt
still signs the owner out (Supabase Auth). Passkeys are never mandatory for sign-up; stronger authentication + reliable
recovery must be resolved before public launch.

Hold checks (existing tests, journey `accountTakeoverProtection`): one open hold per account (`hold_exists`); extension
stops at 42 days from placement (`extend_capped`, then `hold_limit`); only allow-listed recovery admins act
(`recovery_admin_only`); release (`q_release`) and expiry (`hold_expired`) work; a release never shortens a suspension.
Open, recorded, not fixed: the 42-day cap is per hold (release + a new hold restarts it; audited and notified, the runbook
escalates repeats to the owner, the server does not enforce it); a release restoring sign-in on a non-suspended account is
not directly asserted (it uses the same `reset_account_ban` as recovery, which is) and not tested on real Auth. The
date-dependent benchmark failure is the recorded test debt (freeze its clock), to fix or formally waive before release.

Remaining gates (unchanged order): owner review of this revision + runbook; support address chosen; Privacy Policy
sentences (deletion timeline, recovery evidence + retention) approved; tabletop rehearsal; Apple wording reviewed;
native review of the new strings; controlled real-SMS test on production after deploy (two test numbers, owner present);
deploy approval in migration order after 0374; build 88 on every device before the deletion switch is turned on; external
users only after all of these.
