# Account deletion vs moderation records under legal hold (2026-11-08)

**Status: PRE-LAUNCH COMPLIANCE REQUIREMENT (owner, 2026-11-08). Documented only. Nothing built, nothing deployed.**
Before outside users are admitted: suspension, pause and moderation records under an active legal hold must not be erasable
by account deletion. The correction below is a proposal, subject to legal review of retention requirements.

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

## Smallest necessary correction (proposal, not built)

One staged migration, after 20270401, own approval:

1. A `BEFORE DELETE` trigger on `auth.users`, following 20270374's retention trigger: when an active hold covers a report or case
   involving this account, copy the affected records (suspension decisions, pauses + history, held cases + members + history) into
   one append-only private table keyed by the hold. Failures are logged and never block the deletion, unless legal says otherwise.
   It must also fire `BEFORE DELETE` on `public.profiles`: `delete-account` deletes the profile first, which already clears the
   report's person reference, so a trigger on `auth.users` alone could no longer find the held report.
2. `purge` for that table + `suspended_account_records`: nothing covered by an active hold is deleted; a release restarts the normal
   retention clock.
3. Accounts with no hold: behaviour unchanged, nothing extra kept. No foreign key or constraint changes.
4. Admin reads: only through the existing hold listing, if legal needs them shown. No new screen, timeline or feature.
5. Tests: this check as a journey (must fail without the migration), a hold-vs-delete race script, rollback round trip.

## Questions for legal review (must be answered before building)

1. Does a hold stop the deletion, or does the account go and only the covered records stay? The proposal assumes the second: the
   person's deletion request is honoured apart from the records legally required.
2. Should holds be able to target an account directly, so a pause or suspension with no report or case can be held?
3. What retention applies with no hold: 12 months after resolve for reports, after end for pauses, for suspended-account records?
   Indefinite retention is not assumed to be appropriate.
4. How is this disclosed in the Privacy Policy (deletion exceptions)?

## Decided in the same review (owner, 2026-11-08)

- Offers refused for contact details stay unlogged: nothing was published.
- No unified account timeline, screen or new audit feature.
- 12-month report retention needs legal review before launch.
