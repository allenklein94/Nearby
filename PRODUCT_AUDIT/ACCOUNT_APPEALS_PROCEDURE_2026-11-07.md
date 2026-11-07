# Account appeals: manual review procedure (DRAFT, 2026-11-07)

Owner approval 2026-11-07: basic manual appeals now. No new screen, migration, automated restriction or separate appeals system.
It reuses the suspension and restriction messages, the admin controls that already reverse decisions, and their audit records.
Status: client wording BUILT + TESTED, STAGED on `post-tier1/admin-restrictions` (NOT merged, NOT deployed, NOT in build 87).
This procedure has NOT been legally reviewed and has never been rehearsed.

## 1. What can be appealed

| Decision | Who makes it | How it is reversed (existing) | Audit record (existing) |
|---|---|---|---|
| Account suspension (0351) | admin | `admin_reinstate_user(user, reason)` (reason required) | `account_moderation_actions` (action, reason, admin_id, time) |
| Temporary pause of chosen actions (0399) | admin | Lift Pause in Admin Reports = `admin_lift_account_restriction` (reason required) | append-only restriction record + lift row (lift_reason, admin, time) |
| Recovery hold (0375) | recovery admin | `admin_release_recovery_hold` (reason required) | recovery audit (append-only) |

Not appealable decisions, because nobody decided anything about the person: rate limits and daily limits (`rate_limited`,
`gathering_limit`, friend-request limits). They end by themselves, so their messages carry no review line. Review signals and
review cases are not penalties and never restrict anyone, so there is nothing to appeal.

## 2. How a person asks (intake)

- ONE support address, shared with account recovery: `src/constants/support.js` (`SUPPORT_EMAIL`, `SUPPORT_EMAIL_VERIFIED`).
  It is shown only once BOTH are set. Today both are unset, so every message leaves the review line out. No address is
  invented, and the owner's personal address is not used by default.
- Where the line appears (`utils/accountReview.js`, one helper):
  - **Signed out, at sign-in:** Supabase Auth refuses a suspended or held account (`user_banned`). The Login screen now says
    "This account can't sign in right now. It has been suspended, or it is on hold while an account problem is checked."
    + "If you think this is a mistake, email {email} with the phone number on your account to ask for a review." There is no
    Try Again, and the raw "User is banned" is never shown. This needs no sign-in, so a suspended person can always see it.
  - **Signed in, a refused action:** the suspension message (`account_suspended`) and an admin's pause (`account_restricted`,
    every path incl. the chat composer) add the same line.
- 11 languages (`ui.shared.errors.signInBlocked`, `requestReview`). 10 are machine-authored and need native review.
- No turnaround time is promised anywhere (owner: not until staffing can meet one).
- Website: no page carries the instructions yet. A signed-out person who no longer has the app has no public route. Proposed
  sentence for Terms §9 (NOT added: a legal page needs review and approval, and the address does not exist yet): "If you believe
  your account was suspended or limited by mistake, email {support address} from any address, with the phone number on your
  account, to ask for a review."

## 3. Review steps (admin)

1. **Confirm the account.** The email sender proves nothing. Match the phone number given to the account (its `auth.users` row, service role; no admin screen shows numbers today). Never
   reveal whether a number has an account, or anything about the account, to the sender before that.
2. **Assign a reviewer.** Whenever possible, a DIFFERENT admin from the one who made the decision (shown on the record:
   `admin_id` / restriction admin). When only one admin exists (today: the owner), say so in the written decision. Recovery
   holds keep 0375's rules (allow-listed recovery admin, a second admin for a new incident).
3. **Re-read the evidence** the decision was based on: the linked report or review case, its server-kept copies (reported
   messages, report snapshots, held photos), and the original written reason. Consider anything new the person sends.
   Evidence under a legal hold stays held whatever the outcome.
4. **Decide in writing.** Uphold, or reverse with the existing control (reinstate, Lift Pause, release hold). Every reversal
   already requires a reason, so the decision is in the audit record. For an upheld decision, write the outcome in the linked
   report or case note (no new table).
5. **Reply to the person** from the support address: the outcome only. Never the reporter, the evidence, other accounts or
   internal notes. If reversed: they can sign in or use the action again. A suspension ends immediately; a pause can also simply
   run out.
6. **Keep the email thread** only as long as the linked report or case (12 months after resolution), unless a legal hold applies.

## 4. Decisions needed from the owner

1. **The support address** (recommended: `support@<the app's own domain>`, once the domain exists). Then set the mailbox up,
   send and answer a test message, set `SUPPORT_EMAIL` + `SUPPORT_EMAIL_VERIFIED = true`, and ship it in a native build (no
   expo-updates). Until then the line stays hidden.
2. **Who reviews appeals** while the owner is the only admin (independent review is "whenever possible").
3. **Terms §9 sentence + Privacy Policy** (appeal emails are personal data): legal review before publishing.
4. Native review of the 2 strings in 10 languages.

## 5. Not verified

- The exact error Supabase Auth returns to `verifyOtp` for a banned account on prod (Auth v2.197.0). The code matches
  `code === 'user_banned'` OR the "User banned" message; the actual response was not captured against real Auth. Check it in
  the consolidated deploy checklist with 0351's existing-session test.
- Nothing has been rendered on a phone. Check after 0351/0399 are live: a suspended test account at sign-in, a paused action,
  the chat composer, in English and one longer language.
- A banned account whose refresh token fails while the app is open is signed out silently (the app shows the Login screen). It
  sees the message only on its next sign-in attempt. Recorded, not changed.
