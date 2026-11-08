# Legal hold procedure (20270395, staged, NOT deployed)

Status: DRAFT procedure. NOT legally reviewed. No retention period is set or claimed here; the ordinary 12-month periods
still need legal review before outside users.

## Who
- Only accounts the server treats as admins (`check_is_admin`). Every function refuses anyone else (hint `admin_only`);
  no client can read or write `private.legal_holds` or the hold helpers (journey `legalHolds`, "only admins ...").
- Business owners, gathering hosts and ordinary users have no hold control and no way to see holds.

## Where
- Admin Reports (`src/screens/AdminReportsScreen.js`), no new screen:
  - every report card: "Place Legal Hold" / "Release Legal Hold" + the active hold's line (since when, reference, reason);
  - every account review case card: the same;
  - "Other legal holds": active holds whose item has no card there (e.g. a removal record held directly), so they can be released.
- A hold on a report also keeps that report's removal record (and a hold on a removal record keeps its report), so a removed
  gathering's / community's evidence is held from its report card.
- On a database without 20270395 the control does not appear.

## Place a hold
1. Confirm the request is genuine and that holding is warranted (a preservation request, litigation, a police request, an
   internal investigation that needs the evidence past normal retention). Record the decision outside the app if your process requires it.
2. Admin Reports -> the item -> Place Legal Hold.
3. Reason (10-1000 characters, required): what the hold is for. Reference (optional, max 200): ticket / request number.
4. Place Hold. The server records who, when, why. A second hold on the same item returns the existing hold ("Already on hold").
5. A reported photo released earlier but still in Storage is held again; one already deleted can't come back and the screen says so.

## Review
- Holds have no expiry. Review active holds at least as often as open review cases are reviewed (every 30 days), and whenever
  the matter that caused them closes. The list = Admin Reports, or `admin_list_legal_holds(true)` for the full history incl. released.

## Release a hold
1. Admin Reports -> the held item -> Release Legal Hold.
2. Reason (10-1000 characters, required), then confirm.
3. Nothing is deleted at that moment. The evidence goes back to its ordinary retention (the purge jobs may then remove it
   on their schedule), and another active hold on the same evidence still keeps it.
4. Released holds stay on record forever (append-only: a hold is never edited or deleted, only released once).

## When a held account is deleted (20270402, staged, NOT deployed)
- A hold never stops a deletion and the person is never told about it. What the hold covers is copied to
  `private.held_account_evidence` first, in the deletion's own transaction; if the copy fails, the deletion fails and is recorded, and admins
  get one private push a day (counts only).
- Scope: a hold keeps what it is about. Tick "Also keep this account's whole moderation history" only if the matter requires it; the choice is on the hold.
- Original files stay in their private bucket, listed in `private.legal_hold_files`, and can't be deleted, moved or overwritten while held. Check the placement answer:
  `files.kept` = safe; `files.deleting` = removal already under way, can't be recalled; `files.already_deleted` = gone.
- To open a kept file: `admin_open_held_file` with a reason first (recorded), then a link. There is no screen for the evidence store: an authorized operator exports by SQL, by `hold_id`.
- Release: nothing is purged while another hold covers the target. After release, kept evidence is purged only under a recorded policy (`private.set_held_evidence_retention`, with
  a decision + reference). None is set: until counsel decides, it is kept. A case that went with its account can't be held again after release: export first.
- A hold on a case keeps its linked reports. A hold on a report does not keep a linked case from its own 12-month purge unless the account is deleted: hold the case too.
- Don't delete an admin's account while holds are active: `admin_id` / `actor` on held records is cleared by the deletion
  (the hold's own `placed_by` / `released_by` stay).

## Audit
- `private.legal_holds`: target, reason, reference, placed_by/at, released_by/at, release_reason; trigger
  `legal_hold_immutable` refuses rewrites and deletes.

## Not covered
- Nothing is held automatically; the system never decides that content is legally held.
- CSAM / mandatory-reporting content needs its own procedure (not written; see `PUBLIC_MEDIA_AUDIT_2026-11-05.md` section 7).
