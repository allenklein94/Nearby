# Account deletion vs moderation records under legal hold (2026-11-08)

**Status: PRE-LAUNCH COMPLIANCE REQUIREMENT (owner, 2026-11-08). Correction STAGED as 20270402, LOCALLY VERIFIED, NOT merged, NOT
deployed, NOT legally reviewed (section "The correction", below).** Before outside users are admitted: suspension, pause and moderation
records under an active legal hold must not be erasable by account deletion.

## How this was verified

`scripts/replay/account-deletion-hold-check.sql` on an isolated local database with all 525 staged migrations applied (through
20270401, commit dcae5066). One account with a suspension, two pauses, two review cases and a report, with active legal holds on
the report and both cases. Deleted in the order the `delete-account` function uses (profile, then auth user), real triggers on,
rolled back.

Limits: local stubs instead of real Auth (`auth.mfa_factors`, `auth.sessions.not_after`, added by hand so 20270375 applies); PG 15,
production is 17.6; not run through the edge function or on production. Fixtures were written with triggers off. The staged
protections are not live on production, so this describes behaviour once they deploy. The reinstated-account and expiry lines
below come from reading the code, not this test.

## Existing behaviour

Deletion goes through while a hold is active. Nothing checks for a legal hold on this path.

| Record | After deletion, with holds active | Why |
|---|---|---|
| Report + server copy | KEPT, person reference cleared + stamped | 20270355 `reported_id` SET NULL |
| `report_actions` (who resolved, outcome, note) | KEPT | tied to the report |
| Case without a subject account (photo, shared device/text) | KEPT, history kept | no account foreign key on the case |
| ...its member row for the deleted account | **LOST** | `account_review_case_members.user_id` CASCADE |
| Case WITH a subject account (behaviour, report, prior suspension, account recovery) | **LOST with its history, even when held** | `account_review_cases.subject_user` CASCADE |
| The hold row on that case | Kept, pointing at nothing | `private.legal_holds.target_id` is a plain id |
| Pauses + their history (0399), even from a held report/case | **LOST** | `account_restrictions.user_id` CASCADE (the hold only stops the 12-month purge) |
| Suspension decisions (`account_moderation_actions`) | **LOST** from the table; copied only in the case below | `user_id` CASCADE |
| `private.suspended_account_records` copy | Kept for 12 months, only if the account's latest decision was a suspension | 20270374 trigger. Not hold-aware: the daily purge deletes at `expires_at`, held or not. A reinstated account gets no copy (code reading) |
| Content removal records (0393), recovery audit (0375), ID submission holds (0400) | Not exercised here | no account cascade found on the first two; 0400 states its hold outlives deletion |

Also: a pause or suspension made without a report or case can't be held at all (holds target reports, removal records, review
cases and ID submissions; there is no account-level hold).

**Correction to the earlier assessment (same day):** it named suspension and pause records only. Held review cases about a subject
account are lost too, which is the larger gap: the hold says it preserves the case and it doesn't.

## The correction (20270402, staged; sha256 9fc3a35273dbe6a80ea942d5844d6adf6734bf9e7bcc504247a6f0c7a7dbdbf9)

Owner's rules (2026-11-08): no hold = deletion unchanged; a hold = the account still deletes and only the covered evidence stays; the copy
must succeed before anything is destroyed; a release starts a retention schedule, never forever.

- `private.held_account_evidence`: append-only, no client access, one row per (hold, record). Only reachable by SQL (no screen).
- `delete-account` calls the preservation first, before it removes any file, and stops if that fails. BEFORE DELETE triggers on
  `public.profiles` AND `auth.users` do the same in the deletion's own transaction, so every path is covered (the Auth admin API, the
  scheduled deletion, a direct delete) and a failed copy aborts the deletion. The refusal is generic: nothing reveals a hold.
- Copied when an active hold covers the account: held cases about it (+ members, history, photo references, report links), its rows in other
  held cases + the hashes of its photos there, a held ID submission's row, and the account's suspension decisions, pauses + history,
  behaviour signals and security events. Never the profile, messages or a file.
- Coverage = a hold on a report naming the account or linked to its decisions / pauses, a removal record it owned or was reported in, a case
  where it is subject or member or that its pause came from, or its ID submission.
- Two purges fixed, because they would still lose held evidence afterwards: a case hold now keeps its linked reports (`report_on_legal_hold`,
  also after the case went); `purge_suspended_account_records` skips an expired record whose decision names a held report or whose account is
  in the store (released = next daily run; not matched against numbers while kept, as for any expired record).
- Release: kept while any hold on the same target is active, then `held_evidence_retention()` after the latest release (PROVISIONAL 12 months,
  one function to change), purged daily; the hold's own record stays. Who/when/why is in `private.legal_holds` (20270395).
- Also fixed in `delete-account`: the staged 0400 version returns `verificationPaths`, a variable 0400 removed, which throws AFTER the account
  is deleted (the person gets an error; a scheduled deletion is never marked finished). main / production don't have this. DEPLOY GATE: never
  deploy `delete-account` from the 0400 branch; use this version, which also works before 20270402 is live.

### Verified locally (2026-11-08)

Fresh replay with real Auth v2.197.0 first (525 + 0402 applied last as its own transaction); PG 15, production is 17.6.
- Journey `heldAccountEvidence` 11/11; fails 11/11 after rollback. Journeys 1219/1219 before the concurrency scripts and on the final run after them.
- 27 concurrency scripts pass, incl. `held-evidence-concurrency.js` (7 races, both orders where order matters): hold vs deletion, pause vs
  deletion, two deletions side by side, double preservation, purge vs deletion, hold vs record purge.
- Real Auth `held-evidence-auth-local.js` 8/8, three runs: held / unheld / copy failing makes Auth's deleteUser return an error with the account
  intact, retry succeeds. The delete-account ORDER is reproduced by the script; the edge function itself did not run.
- Rollback = the pristine pre-0402 schema, public + private, `pg_dump` 64,434 lines, 0 diff; re-apply = first apply, 64,794 lines, 0 diff.
- Jest 553/553 (7463 + 11 todo). No client change.

While verifying: both scripts first left suspended-account rows that broke `suspendedNumberRetention` when run afterwards (test cleanup, fixed).
`unsafeReportReason`'s queue-order test fails about 1 run in 7 WITH AND WITHOUT 0402 (2/12, 2/16): not this work, cause not established, open.
`profileAntiScraping` `mia2_signal` failed once (its known flake).

### Not run (deploy gates, `post-deploy.js` 20270402)

Prod journeys with the 0348-0402 prelude, prod aborted rollback, grants vs prod, the real `delete-account` running (no Deno here, not even
type-checked), PG 17.6, a controlled test with dedicated test accounts. Storage API scripts not rerun (no Storage change).

### Known limits (not fixed)

- A hold on a REPORT placed in the moment between `delete-account`'s two deletes: the report's person reference is already gone, so the account's
  decisions aren't linked unless they name that report. The report itself stays. A case hold in that window is covered (journey step 9).
- A failed copy blocks the person's deletion with a generic error; it is logged by the function, with no admin alert. Not expected in practice.
- A case that went with its account can't be held again after its hold is released: export first if the matter might come back.
- A hold on a report keeps a linked case only through a deletion, not from the case's own 12-month purge: hold the case too.
- After a case hold is released, a linked report's photo that a "No action needed" outcome couldn't release stays until the report's purge.
- If an ADMIN's account is deleted, `admin_id` / `actor` on held records is cleared (the hold's `placed_by` / `released_by` stay). Procedure: don't.
- A pause or suspension with no report or case, on an account no hold covers, can't be held (no account-level hold).
- Rollback destroys preserved evidence: its header says to export first and get the owner's + counsel's decision.

## Decisions still needed (counsel + owner; nothing here is legally approved)

1. **Files are not preserved.** A held photo case keeps the reference and hashes, but `delete-account` removes the profile photo itself; voice
   messages too. (Reported Story photos and ID files are already handled by 0391 / 0400.) Does the hold need the image? Building it = a file hold
   and a later deletion job, a separate change.
2. Hold stops deletion, or the account goes and covered records stay? Built as the second, per the owner.
3. Retention after release: 12 months is a placeholder. Same question for reports, pauses, suspended-account records.
4. Scope: any hold covering an account copies its WHOLE moderation history, including for a hold on one ID submission. Necessary, or narrower?
5. A REPORTER who deletes: their identity is cleared from a held report and deliberately NOT copied (they may be a victim). Is that right?
6. Should holds target an account directly (the pause / suspension gap above)?
7. A held suspended-account record keeps its number key (an HMAC) past its date. Acceptable, given it is no longer matched?
8. **Disclosure.** Privacy Policy section 5 has a legal-or-safety exception, but section 6 and the app's dialogs say "all associated data", and the
   scheduled-deletion push says "its data" was "permanently deleted". Wording for counsel; not changed.

## Decided in the same review (owner, 2026-11-08)

- Offers refused for contact details stay unlogged: nothing was published.
- No unified account timeline, screen or new audit feature.
- 12-month report retention needs legal review before launch.
