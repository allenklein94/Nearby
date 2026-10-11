# Item 168: V1 category pass, apply + rollback runbook (2026-10-11)

**Status: APPLIED 2026-10-11 (owner approved; record in section 8).** Was: ready for owner sign-off. Branch `item-168-category-pass`. Production is unchanged
(taxonomy version 1, 241 live tags, no `sports_fitness`). The owner's decisions D1-D6 are in
`ITEM_168_MIGRATION_PREP_2026-10-11.md`; this file is the release gate the owner signs before anything goes live.

## 1. What ships together

| Piece | Where | Goes live by |
|---|---|---|
| Migration `20270294_v1_category_pass.sql` | `supabase/migrations/` | step 3 below (Management API, one transaction) |
| 3 edge functions: `submit-business-application`, `business-onboarding-assistant`, `screen-business-content` | `supabase/functions/` | step 5 (`supabase functions deploy`) |
| App code (groups, rail D5, D3 split, D6 paths, synonyms, max-5 UI, customer-only pickers, league format, 11 locales) | `src/` | merge to `main` (no app build is installed anywhere yet) |
| Business web: signup page `docs/business.html` + Expo export `docs/business/` | `docs/` | merge to `main` (GitHub Pages) |

**Order matters.** The new `submit-business-application` reads `customer_only`, which exists only after the migration;
the old one accepts `stay_getaway`, which the migration refuses. So: migration, then the three functions at once, then
merge. The window between steps 3 and 5 should be minutes. Rollback reverses the order.

## 2. Evidence it is ready (all re-run 2026-10-11 on this branch)

- **Mapping cross-check:** `node PRODUCT_AUDIT/item168_prep/crosscheck.js`: 33/33 PASS (the app now equals the mapping's
  "after" side; the mapping's "before" side equals the live table).
- **Forward dry run on production, rolled back:** migration + `scripts/live-verify/v1-category-pass.sql`: ALL OK.
- **Rollback rehearsal on production, rolled back:** `node scripts/rollback/item168-rollback-dryrun.js`: snapshot ->
  migration -> post-pass activity (a group-only Sports & Fitness business, a profile interest group, an alias) -> rollback
  -> all postconditions: **ROLLBACK REHEARSAL OK** (241 live tags, Stay & Getaway back, Yoga back in Activities, Tea
  retired not deleted, 57+ audited reversal changes). Production checked afterwards: unchanged.
- **Business impact, re-run:** `sql/14_business_impact.sql` and its self-test return exactly the prep evidence: 2
  declarations, none loses coverage; Coastal Coffee (group-only Food & Drink) starts serving Tea and Distilleries.
- **Tests:** `npx jest`: 407 suites pass, including the new `src/constants/v1CategoryPass.regression.test.js`
  (19 groups, customer-only never offered or served to a business, max 5 secondary, D6 reach). `npm run journeys`: 20/20
  against today's schema AND 20/20 (234 tests) on the V1 schema:
  `JOURNEY_PRELUDE_FILE=supabase/migrations/20270294_v1_category_pass.sql npm run journeys` (the migration runs inside
  each journey's transaction, which is always rolled back). Re-run plain `npm run journeys` after the real apply (step 7).

## 3. Apply (owner present)

1. **Re-check impact** (production may have new businesses by then):
   run `PRODUCT_AUDIT/item168_prep/sql/14_business_impact.sql`. Stop if any row has a non-empty `stops_serving` or `flags`
   that the owner has not seen.
2. **Snapshot** (committed, kept until sign-off): run `scripts/rollback/20270294_v1_category_pass.snapshot.sql`. It refuses
   to run twice or after the migration. Note the counts it prints.
3. **Apply** the migration as one transaction: `begin;` + the file + `commit;` through the Management API. Its own
   preconditions abort on any drift (241 live tags, the 30 source groups, no name collisions).
4. **Verify:** run `scripts/live-verify/v1-category-pass.sql` as is (it rolls back its own probes). Expect `ALL OK`.
5. **Deploy** the three edge functions from the branch, together:
   `supabase functions deploy submit-business-application business-onboarding-assistant screen-business-content`.
6. **Merge** `item-168-category-pass` into `main` and push (business web goes live with it).
7. **Sync the code inventory:** `SUPABASE_ACCESS_TOKEN=... node scripts/taxonomy/sync-code-dependencies.js` (closes the
   code follow-ups the 31 moves opened). Then `npm run journeys`.
8. **Record** in `CLAUDE_HISTORY.md` and close item 168 in CLAUDE.md. Keep `item168_backup` until the owner signs off
   on the live result; then `drop schema item168_backup cascade;`.

## 4. Rollback (owner-ordered only)

Use when the applied pass must be undone. Needs the step-2 snapshot.

1. **Redeploy the three edge functions from `main` as it was before the merge** (or revert the merge commit first):
   the V1 `submit-business-application` reads `customer_only`, which the rollback drops.
2. **Run** `scripts/rollback/20270294_v1_category_pass.rollback.sql` as ONE transaction (`begin;` ... `commit;`).
3. **Revert the merge** on `main` (app + business web) if not done in step 1, push, and re-sync the code inventory.
4. Run `npm run journeys`.

What the rollback does: a reverse pass through the canonical engine (audited, reason "Item 168 rollback"): the 30 moves
go back, Pet Friendly Places / Stays are restored, the 24 new categories are **retired** (ids and keys are permanent and
the audit log references them, so they are never deleted), customer-only is cleared and its column dropped. Then the
stored group keys (businesses, applications, aliases, profile interest groups), the synonym table and the exact
pre-apply text of the 5 redefined functions and 3 CHECK constraints come back from the snapshot; the enforcement
trigger is dropped. Rows created after the pass with a `sports_fitness` key fold into `activities_recreation`.

It **refuses** (and changes nothing) if: there is no snapshot; the pass is not applied; any gathering uses the
`league` format; or any business, application, posting, boost, request, gathering or profile already uses one of the
24 new categories. Those are owner decisions, not something a script should guess.

Knowingly **not** reverted: the audit log (append-only; it keeps both the pass and its reversal), the widened
`change_type` CHECK (it must still admit the pass's audit rows), the taxonomy version (only goes up; clients refetch),
and the 24 retired rows.

## 5. Point of no clean return

The rollback stays clean only while nothing has adopted the new world: no gathering on `league`, no use of the 24 new
categories. Once real data uses them, undoing the pass means deciding per row what replaces it. A forward fix (one more
canonical change) is then the right tool, not this rollback.

## 6. Product decisions kept separate from the migration approval (owner, pending)

- **Places browse types** (`src/constants/placeCategories.js`): Activities -> `bowling_alley`, Sports & Fitness -> `gym`,
  Travel & Getaways -> `lodging`. Tourist attractions stay reachable: Attractions & Things to See browses
  `tourist_attraction`, and a Places `tourist_attraction` result classifies to that group (`services/places.js`).
- **Broad Travel & Getaways interest** weakly matches (the existing broad-interest weak signal, never a strong match)
  the 10 former Stay & Getaway categories. Proposed: keep as is, record for a later relevance review; not in this pass.

## 7. Open, honestly

- The journeys pass on the V1 schema in a rolled-back rehearsal; item 168 is verified only after they pass again on the
  really migrated database (step 7).
- Never run: the business web signup page in a real browser, any of it on a phone (no device exists).
- 2026-10-11 machine-authored translations for the new labels need native-speaker review (standing item).

## 8. Applied record (2026-10-11)

| Step | Result |
|---|---|
| 1 Impact re-check | identical to prep evidence: 2 declarations, none loses coverage, no flags |
| 2 Snapshot | committed: 241 tags, 5 functions, 4 constraints, 1 business, 1 application, 177 synonyms, 0 aliases |
| 3 Migration | applied in one transaction: 19 groups, 263 live tags, 7 customer-only, taxonomy version 36 |
| 4 Verify | `v1-category-pass.sql`: ALL OK, no probe rows left |
| 5 Edge functions | all 3 deployed together; signup smoke test (empty body) -> 400 "Tell us your business's name." |
| 6 Merge | `main` at f62ff7e9 |
| 7 Inventory sync | 1580 rows; 66 follow-ups resolved, 0 open |
| 8 Journeys | 20/20 suites, 234 tests, on the migrated database; Jest 408 suites pass |

`item168_backup` is kept until the owner signs off on the live result.

**Owner decision (2026-10-11): keep `item168_backup` for now.** Do not run `drop schema item168_backup cascade;` yet.
Revisit only after the four open follow-ups are done (native review of the labels in 11 languages, `docs/business.html`
in a real browser, on-device check, from-scratch migration replay on an empty DB) and the owner explicitly orders the drop.
