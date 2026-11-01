# Account recovery runbook (DRAFT, 2026-11-01)

Status: DRAFT for owner review. Not rehearsed. Nothing here is live: it depends on migration 20270375 (staged, not deployed).
Design + owner decisions: `ACCOUNT_RECOVERY_DESIGN_2026-11-01.md`.

## Who may act

- A **recovery admin** = an admin (`private.require_admin`, 0369) who is ALSO listed in `private.account_recovery_admins`. The
  owner adds rows by SQL only; no client or website can add one. If the admin has a second factor, they must be at aal2.
- An admin can never act on their own account, nor use their own account as a "proof account".
- Every action needs a written note (case/hold: 30+ characters) and is written to `private.account_recovery_audit`
  (append-only; kept 24 months). Every action also notifies the account.
- Single-admin review is a recorded limit until a second recovery admin exists. Until then the owner reviews every recovery
  within 24 h of it (see Escalation).

## 1. Intake (works while signed out)

- Channel: the support address on the sign-in help link, in the "number changed" notice, and on the website. (Address to be
  chosen by the owner; not yet published.)
- Ask for: the account's phone number, the approximate date it stopped working, and whether a device is still signed in.
  Never ask for a password, an SMS code, or ID documents by email.
- Knowing the account's content (friends, messages, plans) is **never** evidence: an intruder can read it.

## 2. Open a case and decide on a hold (same day)

1. `admin_open_account_recovery(user, note)`: opens (or reuses) the one open `account_recovery` case.
2. Look at `admin_get_account_recovery(user)` / `admin_get_account_security_events(user)`: a number change, refused change,
   new sign-in elsewhere or failed step-up in the last 30 days = a takeover signal.
3. Signal present and the claim is credible: `admin_place_recovery_hold(user, case, reason)`.
   - Ends every session at once, refuses sign-in, number change, step-ups and deletion. Never a suspension, never public.
   - Lasts **14 days**. `admin_extend_recovery_hold(user, reason)` adds up to 14 days at a time, never beyond **42 days**
     from placement. It is never renewed silently; it expires on its own (`expire-recovery-holds`, every 15 min).
   - `admin_release_recovery_hold(user, reason)` ends it early (e.g. the claim was mistaken).
   - A hold never shortens a suspension.
4. No signal: the server refuses a recovery (`no_takeover_signal`). Tell the claimant nothing about the account beyond "we
   can't act on this request"; do not confirm whether the number has an account.

Abuse: anyone can ask for a hold, so a false request can freeze an account for up to 14 days. Mitigation: a hold only with a
signal, a note, and the account is notified; the real owner can reply to that notice (Appeal).

## 3. Evidence (all enforced by `admin_recover_account`)

Required, every time:
- an open recovery case for that account, a takeover signal in the last 30 days, a note (30+ characters);
- **at least one independent item**:
  - `carrier_confirmation`: the carrier's written confirmation of a SIM swap / port-out on that number, dates matching the
    record;
  - `prior_passkey`: a passkey/second factor the owner registered before the event (D4; none exist yet);
  - `prior_id_match`: only if the person had voluntarily passed an ID check (0350) BEFORE the event; never asked of anyone
    else.
- `pre_event_device` (a device still signed in from before the event) **supports but never decides**: alone it is refused
  (`evidence_insufficient`).
- To **restore the number** (required when the number was changed in the last 30 days): the claimant proves they control the
  original number again by signing in with it in the app (after the carrier has fixed the SIM). Auth creates a fresh,
  empty account for it: that is the **proof account**. The server accepts it only if it is new (created after the last
  number change and within 7 days), has a confirmed phone, hosts nothing and has no friends. It is deleted and the number
  goes back to the original account.

Never enough on its own: a support request, knowing account content, a recycled number, a trusted device.

## 4. Recover

`admin_recover_account(user, case, evidence[], note, proof_account)`:
- restores the number (proof account deleted), ends every session, consumes any open step-ups;
- cancels a scheduled deletion and restores the profile's visibility as it was (suspension unaffected);
- releases the hold, lifts the sign-in ban (unless suspended), records + notifies.

Afterwards: tell the owner to sign in with their number, check Settings, and Sign Out everywhere if anything looks wrong.

## 5. Decline

Note why on the case and release the hold (or let it expire). The account stays as it is. Tell the claimant only that the
request couldn't be verified and what evidence would change that (carrier confirmation).

## Appeal and escalation

- The account holder (or the claimant) can reply to the notice / the support thread to contest a hold or a decision.
- Any appeal, any recovery done by a single admin, and any hold extended beyond 14 days goes to the **owner** for review
  within 24 h; the owner can release the hold or reverse a recovery (a second recovery with its own evidence).
- A pattern of false claims against one account = note it on the case; repeated holds on the same account need the owner.

## Not covered (recorded limits)

- An intruder holding the SIM can read the account and sign the owner out until the carrier fixes the SIM; the hold ends
  that once reported.
- Session age alone is never treated as proof of ownership; a 7-day-old intruder session plus the SIM can still move the
  number (proven on real Auth; residual of SMS sign-in).
- Rehearsal (tabletop) not done; support address not chosen; Privacy Policy sentences not published.
