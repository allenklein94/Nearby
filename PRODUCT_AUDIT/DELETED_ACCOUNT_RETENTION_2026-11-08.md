# Deleting an account with something unresolved (2026-11-08)

**Status: 20270406 BUILT + LOCALLY VERIFIED, STAGED on `post-tier1/deletion-review-retention` (stacked on 0405's branch). NOT merged, NOT deployed, NOT legally approved, not in build 87.** Own deploy approval, after 0405. **Owner decision (2026-11-08): stays staged. The 90-day period, the Privacy Policy wording and payment-record retention (0405's doc) must have legal review before deployment.** Website re-export needed for the admin lines.

## The gap

An account with an open report, an open case or an active pause could delete and come straight back. It kept no number key, no device key and no link between its reports (20270374 covers suspended accounts only), and a case about it vanished with its history.

## What's kept, only when something is unresolved at that moment

| Kept | Why | Not kept |
|---|---|---|
| former account id (a pseudonym once the account is gone) | ties the reports and cases together | name, email, photo, birthdate |
| keyed hash of the confirmed number (20270374's key) | recognises it coming back | the number |
| device keys, only if the shared-device detector is on and already stored one | same | the token, device details |
| ids of the unresolved reports and open cases | the link that was lost | message or report text (reports keep what they already kept; nothing is copied) |
| each active pause: capability, reason, dates, linked report/case | what was in force | closed cases, lifted pauses, resolved reports |
| | | **attendee lists, gatherings, other people's anything** |

An open case about the account stays open without its subject, for an admin to finish; its history gets an `account_deleted` line. A closed case goes, as it always has.

Nothing unresolved = nothing kept: an ordinary deletion is untouched.

## Coming back

The same confirmed number (matching job, every 10 minutes) or a stored device key opens ONE private admin-review case about the new account (`prior_unresolved`). It never blocks sign-up, restricts, notifies the person or decides anything. Later matches are new evidence on that case; a closed case stays closed. The admin note says numbers get reassigned and families share phones.

## Expiry and audit

- `expires_at` = 90 days after deletion (`private.unresolved_account_settings`; changing it needs the decision's reference, applies to new records).
- Daily purge: at the date the number and device keys go, then the record and any case kept with it. A legal hold keeps the record and case, never the keys.
- `private.unresolved_account_events` is append-only: kept (counts), returned, every admin view (with who), keys removed, purged. It holds no account id; rows go 12 months after their record does.
- Records are append-only until they expire. No client access; `admin_get_deleted_account_record` is admin-only and never returns the number, a key or the former id.
- A failure never blocks a deletion: it's recorded privately and the deletion carries on.

## Limits, stated

- A different number on a different device isn't seen. An email-only account has no number key. A number changed before deleting: only the last one is kept.
- A record isn't extended when someone returns. The new-account case stays open but will read "no longer kept" after the date; an admin who needs it longer places a legal hold.
- One open report from anyone is enough to keep a record, so a malicious report causes up to 90 days of retention. It restricts nothing.
- Reports keep their own retention. The excerpt they already hold can name people; unchanged.
- A reassigned number produces a private case about an innocent new owner. An admin closes it; they never know.

## Questions for counsel (mandatory before deploy)

1. Is 90 days right, and on what basis (legitimate interest in safety, or something else)? Does it differ by jurisdiction?
2. A keyed hash of a number + a former account id is still personal data under GDPR-style law. Does keeping it after a deletion request fit the erasure exceptions? Does the person's right to know apply?
3. Is one unresolved report a sufficient trigger, or should it need more?
4. Wording. Draft, NOT published, for section 5: "If your account has an unresolved report, an open review or an active restriction when you delete it, we keep a limited record for up to 90 days so the matter isn't lost: a protected, one-way form of your phone number, the references to those reports and reviews, and what the restriction was. If that number is used again during that time, it may be reviewed privately by our team. It doesn't stop you signing up." The current branch draft's "with your account reference removed" stays true of the report itself, but not of the link in this record: counsel should read both together.
5. The deletion dialogs (11 languages, 0402) say limited records may be kept where user safety requires. Is that enough, or does this need its own line?

## Verification results (local only)

Run 2026-11-09 on an isolated local stack (Supabase Postgres 17.6.1.003, never production), top of the stack at `f5447880`. Log: `/workspaces/.nearby-verify/v407/progress.log` (not in Git).

| Check | Result |
|---|---|
| Journeys | `deletedAccountUnresolved` 32/32; all journeys 1348/1348 before and after the rollback + re-apply |
| Real function + real Auth (`held-evidence-function-local.js`) | 68 checks pass, incl. the number signing up again with nothing in the way, one private case about the new account, no restriction, suspension or notice |
| Concurrency scripts | 28/28 exit 0, incl. `deleted-account-concurrency` |
| 0406 rollback on a database holding records | **refused, exit 3** (144 records, 7 cases without a subject); schema unchanged (0 diff lines) |
| 0406 rollback on a clean database | applies; 0405's journey still passes 58/58 at that state; `deletedAccountUnresolved` fails 32/32, so it does detect the change |
| Re-apply | schema dump identical to the original (0 diff lines) |

**The rollback refuses by design once records exist,** so after real deletions it can't be used until those records have been dealt with. That path has not been written or tested.

**Not verified:** production; a real phone; a real reassigned number. The legal review is still required before deployment and has not happened; the 90 days and the wording remain unapproved drafts.

## Owner acceptance + new deploy gate (2026-11-09)

Local verification accepted; 0406 stays staged, not merged, not deployed. All gates above stand.

**New gate: before 0406 deploys, write the forward-fix and recovery procedure.** Its rollback refuses once records exist, so 0406 can't be assumed reversible in production. The procedure doesn't exist yet.
