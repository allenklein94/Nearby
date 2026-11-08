# Account deletion vs moderation records under legal hold (2026-11-08)

**Status: PRE-LAUNCH COMPLIANCE REQUIREMENT (owner, 2026-11-08). Correction + hardening pass STAGED as 20270402 (sha256 0ef03151ca05650e7ef4a160f1f6e51625335caa82977f8d21f95a9682563ff2), LOCALLY VERIFIED on PostgreSQL 17.6, NOT merged, NOT deployed, NOT legally reviewed, not in build 87.** Nothing here is a claim of legal compliance.

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

## The correction after the hardening pass (20270402, staged)

The owner's rules: a hold never stops a deletion and nothing reveals it; no hold = ordinary deletion; a failed copy stops the deletion.
The six issues (owner, 2026-11-08), as built:

1. **Original files.** A hold's original files stay in their private bucket, listed in `private.legal_hold_files` (bucket, size, type, hash). While
   listed and not purgeable, a trigger on `storage.objects` makes delete / move / overwrite do nothing for every role, service role included, quietly.
   An admin gets a link only after `admin_open_held_file` with a reason: every opening is in `private.legal_hold_file_access`, and the Storage policy
   needs that record. No new screen.
2. **Wording.** App dialogs + the scheduled-deletion message (11 languages, 10 machine-authored, need native review), the scheduled-deletion push
   ("being deleted", "limited records") and the Privacy Policy DRAFT (sections 5 + 6, not published) separate ordinary deletion from what may be kept. Same words for everyone,
   so they reveal no hold. Guard `src/i18n/accountDeletionWording.test.js`. The wording is a draft for counsel.
3. **Scope.** A hold keeps what it is about: the held item, linked cases and reports, decisions and pauses naming them, what a case's own signal rests on.
   The whole moderation history only if the admin says so on that hold (`scope = 'account_history'`, one checkbox in the existing form), only for
   the account the item is about. A hold on an ID submission keeps that submission. A reporter's identity is still not copied.
4. **Races.** Files are queued in the transaction that deletes the profile and removed only after the account is gone, each re-checked under the hold lock.
   A marker keeps the link from a report to its account between the two deletes, closing the earlier known limit. A hold at any point is either honoured, or (the DELETE already
   handed to Storage) answered `deleting`, never `held`. A failed copy aborts the deletion, is recorded, and admins get one private push a day (counts only).
5. **Retention.** Nothing is purged under an active hold. After a release, evidence is purged only under a recorded policy: `private.held_evidence_retention_policy` starts EMPTY and
   empty means NOTHING is purged. The 12-month placeholder is gone. Setting it needs a decision + reference (`private.set_held_evidence_retention`, SQL only).
6. **Testing.** See below.

Found and fixed while doing this:
- **Deletion left files behind.** `delete-account` sent voice-message paths to `profile-photos` (they live in `chat-media`), so voice messages, chat photos, voice intros and replaced photos
  survived deletion; a removal failure was logged and forgotten. Now the whole folder of the 3 media buckets is queued and retried hourly. **`main`'s function has the same code and its source was
  recovered verbatim from the live bundle, so production has this defect today (code reading; not tested on production).**
- `delete-account` on the 0400 branch throws after deleting (`verificationPaths`). DEPLOY GATE: never deploy that copy.
- Errors returned to the person are generic.

Unchanged from the first version: held cases keep members, history, photo references and report links; a case hold keeps linked reports; suspended-account records wait for holds.

### Verified locally (2026-11-08, PostgreSQL 17.6.1.003 from an empty database; real Auth v2.197.0)

- Fresh replay: all migrations applied, 0402 last.
- Journeys 1224/1224 (113 suites) on the final state, incl. `heldAccountEvidence` 16/16. It fails 16/16 with 0402 rolled back.
- 26 concurrency scripts pass, incl. `held-evidence-concurrency.js` with 12 races (5 new: hold vs file hand-over, vs own delete, release vs copying, a hold at a random point of a whole deletion, purge vs re-hold).
- Real `delete-account` under Supabase's edge runtime with real Auth, real Storage API, real PostgREST: `held-evidence-function-local.js` 31/31 (no hold, hold + byte-for-byte file + audited opening, failed copy + alert + retry, Storage down + hourly retry, scheduled path).
- Real Auth `held-evidence-auth-local.js` 8/8. Storage API scripts pass: photo, story, media report, ID document.
- Rollback = a separate pristine pre-0402 PG 17.6 replay, public + private, `pg_dump` 64,437 lines, 0 diff; storage policies identical. Re-apply = first apply, 0 diff.
- Jest 554/554 suites, 7479 tests + 11 todo.

Test defects fixed on the way (product unchanged): 3 stale journey expectations (the new `scope` argument, `retention_set`, a held case's own "opened" event); script cleanup. `media-report-storage-api` failed once when run straight after `story-storage-api`, whose queued files it picked up; alone it passes. Worth fixing the ordering if these are ever chained.
`unsafeReportReason`'s queue-order flake (with and without 0402) and `profileAntiScraping` `mia2_signal` did not appear in these runs; causes still not established.

### Not run (deploy gates, `post-deploy.js` 20270402)

Prod journeys with the 0348-0402 prelude, prod aborted rollback, grants vs prod, a controlled test with dedicated test accounts on production. Local images are stand-ins: Storage API v1.11.13 and the edge runtime are not confirmed to be production's versions. No real phone.

### Known limits (not fixed)

- Evidence kept with no retention policy stays INDEFINITELY after release. Safe for a hold, but keeping data with no end date is its own privacy question: counsel must set it before launch.
- A case that went with its account can't be held again after its hold is released: export first.
- A hold on a report does not keep a linked case from the case's own 12-month purge unless the account is deleted: hold the case too.
- After a case hold is released, a linked report's photo that a "No action needed" outcome couldn't release stays until the report's purge.
- If an ADMIN's account is deleted, `admin_id` / `actor` on held records is cleared (the hold's `placed_by` / `released_by` stay). Procedure: don't.
- A pause or suspension with no report or case, on an account no hold covers, can't be held (no account-level hold).
- A file already handed to Storage for deletion can't be recalled: the hold says `deleting`.
- A held file is protected at the database. Anyone with direct access to the storage backend or the database superuser can still remove it.
- Rollback refuses while evidence exists; once it runs, nothing protects kept files. Redeploy the previous `delete-account` FIRST: this version refuses to delete without the migration.

## Owner decision (2026-11-08)

0402 ACCEPTED as staged and locally verified. NOT approved to merge or deploy. MANDATORY PRE-LAUNCH REVIEW ITEMS: actual image preservation (decision 1),
deletion wording (8), retention scope (4), the deletion/hold race (Known limits, first item). The provisional 12 months (3) is NOT legally approved.
The real `delete-account` under Deno and PostgreSQL 17.6 remain unverified. Passing automated tests is not launch readiness: the real-device session,
production integration checks and legal review are separate gates. Feature development stopped; next = build 87 + Tier 1.

## Hardening pass ordered (owner, 2026-11-08, same day)

The owner reopened the six issues above before build 87: fix them technically, staged, no merge / deploy / build, no claim of legal approval. Built as above; acceptance of the result is the owner's. The "provisional 12 months" and "files are not preserved" statements earlier that day are superseded.

## Decisions still needed (counsel + owner; nothing here is legally approved)

1. Retention after release: how long, for which matters (`set_held_evidence_retention`). Until set, kept indefinitely. Same question for reports, pauses, suspended-account records (12 months today).
2. A hold lets the account delete and keeps covered records, per the owner. Is that the right rule?
3. Item-only scope by default, whole history by admin choice: is the default right, and who may choose it?
4. A REPORTER who deletes: identity cleared from a held report and NOT copied (they may be a victim). Is that right?
5. Should holds target an account directly (the pause / suspension gap above)?
6. A held suspended-account record keeps its number key (an HMAC) past its date. Acceptable, given it is no longer matched?
7. The deletion wording + Privacy Policy draft (counsel), then native review of 10 languages. Not published.
8. CSAM / mandatory-reporting content still has no procedure (`LEGAL_HOLD_PROCEDURE_2026-11-07.md`, "Not covered").

## Decided in the same review (owner, 2026-11-08)

- Offers refused for contact details stay unlogged: nothing was published.
- No unified account timeline, screen or new audit feature.
- 12-month report retention needs legal review before launch.
