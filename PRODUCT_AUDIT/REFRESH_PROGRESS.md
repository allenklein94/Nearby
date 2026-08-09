# PRODUCT_AUDIT refresh — progress tracker

(Restart-safety file, same convention as `AUDIT_FIXES_PROGRESS.md` / `FLYWHEEL_TRACE_PROGRESS.md`
at the repo root. If a codespace restart hits mid-refresh, check this file + `git status` +
which of the 14 target files have a fresh mtime before assuming anything is lost. This file
itself is scratch, not a deliverable — safe to delete once the refresh is committed.)

Started: 2026-08-09, ~19:30, in direct response to the user's explicit request to fully refresh
`PRODUCT_AUDIT/` against the CURRENT repo — not trusting the previous audit (built same day,
commit `d96f10cf`) as evidence anything still holds. **21 commits / 69 files / +14443/-461 lines
have landed since that audit was written** (`git log --oneline d96f10cf..HEAD`) — this is a
real, substantial refresh, not a rubber-stamp.

## Ground rules for this pass (from the user's instructions, restated so they survive a restart)
- Current repo is the sole source of truth. Do not cite the old audit as evidence something
  still exists/is broken — only as a diffing baseline for the changelog.
- Every previously-identified issue gets a real classification: FIXED / STILL PRESENT /
  PARTIALLY FIXED / NO LONGER APPLICABLE / COULD NOT VERIFY — verified against current
  implementation, not assumed from a commit message or the old audit's own "DONE" claims.
- No application code changes. Read-only.
- Overwrite the 13 existing `PRODUCT_AUDIT/*.md` + `AUDIT_SUMMARY.json` files in place. Do not
  create a second folder. Add one new file, `AUDIT_CHANGELOG.md` (14th file) — kept going
  forward on future refreshes, unlike the other 13 which get fully overwritten each time.
- Max 2 concurrent agents for this pass (explicit user cap, matches this session's own standing
  practice for large tasks).

## Plan
1. [x] Recon: confirm scope of change since the audit (21 commits, 69 files), confirm live
   Supabase Management API token still present (`.claude/mcp.json`).
2. [ ] Launch 2 parallel background research agents:
   - **Agent A — codebase re-scan**: fresh read of current `src/screens/` (count + inventory),
     `src/navigation/RootNavigator.js`, `src/services/`, `src/components/`, `supabase/migrations/`
     + `supabase/migrations_archive/` + `supabase/full_schema_pull_2026-08-09.sql`. Produces raw
     material for PRODUCT_OVERVIEW / NAVIGATION_AND_IA / SCREEN_INVENTORY / FEATURE_MATRIX /
     DATABASE_AND_DATA_MODEL, plus the full Part 5 technical-debt scan (TODO/FIXME/console/dead
     code/mock data/duplicate logic/etc.) and a real diff against the old audit's screen/nav/
     feature claims (classify each).
   - **Agent B — live production + security recheck**: re-verify against the live
     `enmosvippabmuqslzrox` project (Management API) — RLS on gatherings/communities/messages/
     business_messages/social_invites/business_customer_notes/storage buckets, is_blocked(),
     business RPC ownership checks (including the two newest ones from today's session —
     `update_business_profile`, CRM note RPCs, `business-ai-assistant`'s ownership gate),
     invite-only join enforcement, precise-location exposure, auth/session handling, and whether
     the schema baseline is still actually reproducible given migrations added since Aug 9
     (`20260809_join_gathering_invite_only_check.sql`,
     `20260809_offer_redemption_proof.sql`, `20260809_momentum_reward_nudges.sql`,
     `20260809_business_profile_self_edit.sql`, `20260809_business_customer_notes.sql` — are
     these archived/baked into the baseline, or live on top of it unarchived?). Read-only
     verification only; any test row created must be cleaned up immediately, same convention as
     every other live-verification pass in this repo.
3. [ ] While agents run: I do the flywheel trace re-verification myself (Part 3) — cannot be
   delegated, needs direct judgment across many files. Base: `FLYWHEEL_TRACE_PROGRESS.md` (8 legs,
   already fairly recent) — but re-verify anything that changed since it was written: invite-only
   hardening, "Start a Community from This Gathering," business profile self-edit, CRM notes,
   Business AI Assistant, and today's push-notification cold-start fix (changes the INVITATION
   RECEIVED step's real-world reliability).
4. [ ] Compile all 14 files from agents' findings + my own direct verification + the flywheel
   trace. Overwrite the 13 existing files in place; write new `AUDIT_CHANGELOG.md`.
5. [ ] Update `AUDIT_SUMMARY.json` to match the new findings.
6. [ ] Leave `PROGRESS.md` (the original audit's own scratch file) and `PRODUCT_AUDIT.zip`
   alone — not part of the 14 requested deliverables; flag in the changelog that the zip is now
   stale rather than silently regenerating it unasked.
7. [ ] Delete this file once everything above is committed (it's scratch, not a deliverable).

## Status
Plan written. **Both agents launched (background)**:
- Agent A (codebase re-scan + old-audit diff/classification + Part 5 tech-debt scan) →
  writing to `PRODUCT_AUDIT/.agent_a_raw_findings.md` when done. **Still running as of the
  note below — did NOT survive to complete before the user's usage/restart warning.**
- Agent B (live Supabase security/RLS recheck + schema-reproducibility recheck) → **DONE**,
  findings written to `PRODUCT_AUDIT/.agent_b_raw_findings.md` (now committed to git, safe).
  Headline: independently confirmed the same schema-reproducibility regression found and
  already fixed above (cross-validates the fix); confirmed schema reproducibility is otherwise
  solid (53/53 tables, 106/106 functions match live exactly via the baseline alone); all
  RLS/ownership checks CONFIRMED SECURE with real live tests, cleaned up afterward; found one
  undocumented-but-real protection (`prevent_hosting_partner_self_edit()` trigger, answers an
  open question CLAUDE.md's business-partnership section had left unconfirmed).
Both are scratch/intermediate files, not deliverables — delete once synthesized into the real
14 files.

Now doing the flywheel trace re-verification directly (step 3, not delegated) while the two
agents run. Nothing in `PRODUCT_AUDIT/`'s 13 real files has been overwritten yet — all still
the Aug 9 00:xx originals as of this writing. If a restart hits before the agents' output files
exist, just re-launch them — nothing they've done is persisted elsewhere yet.

### Major finding, confirmed directly (not yet cross-checked against Agent B's own replay —
### Agent B appears to independently be running a real Docker replay right now, `audit_pg_test`
### container; did not touch it, will reconcile once its findings land)

**The schema-reproducibility claim ("Part 1 DONE") has regressed since the Aug 9 baseline fix —
a fresh replay of `supabase/migrations/` in order would now fail.**
`supabase/migrations/20260809_social_invite_community_join.sql` is still sitting in the live,
un-archived `migrations/` folder — but the exact same fix (verbatim, same policy name "Users can
join public communities, invited communities, or thei") is *also* already baked directly into
`supabase/migrations/00000000000000_baseline.sql` (confirmed at baseline line ~5193-5205, commit
`428ae572` touched both files together — the baseline was patched AND the live migration copy
was left in place, instead of moving the live copy to `migrations_archive/` the way this exact
class of problem was supposed to be handled per the Aug 9 baseline-fix section's own stated
convention). On a fresh replay: the baseline creates the policy directly; the incremental
migration then runs `create policy "Users can join public communities, invited communities, or
thei" ...` a second time — Postgres's `CREATE POLICY` has no `IF NOT EXISTS` clause, so this
would raise `policy ... already exists` and abort the replay. This is the exact same conflict
class the original baseline-fix session found and fixed once already (the `visibility`/
`capacity` double-add) — it crept back in via this one migration. **This directly contradicts
CLAUDE.md's "Part 1 is now genuinely complete" claim for the schema-baseline section** — that
claim was true at the moment it was verified (before this migration existed) but a later commit
the same day silently broke it again. `20260809_business_customer_notes.sql` and
`20260809_business_profile_self_edit.sql` (the other two live post-baseline migrations) were
checked too and are genuinely fine — neither table/function exists in the baseline, so they're
correctly incremental, no conflict.

### Step 3 (flywheel trace) — DONE, written to `PRODUCT_AUDIT/.my_flywheel_trace_findings.md`
All 20 requested transitions traced directly. Headline: no BROKEN/MISSING transitions found this
pass (the prior trace's two real gaps — Connection→Community, private-community invite-accept —
are both since fixed and re-confirmed working); the one real new finding is the schema-repro
regression above, not a flow bug. Two transitions materially improved by today's push-notification
cold-start fix (Invite Connection→Invitation Received, Redemption→Return to App).

Waiting on Agent A and Agent B now (both still running as of this note). Next: once both land,
synthesize all 14 files (step 4).

## >>> IF YOU ARE READING THIS AFTER A CODESPACE RESTART, START HERE <<<

The user's codespace restarted (or is about to) while Agent A and Agent B were still running.
**Background agents do not survive a codespace restart** — they're local processes tied to this
session's compute, not a persisted cloud job, and neither had written its output file yet at the
time of the restart warning (checked directly: no `PRODUCT_AUDIT/.agent_a_raw_findings.md` or
`.agent_b_raw_findings.md` existed after ~14 minutes of runtime). There is no partial checkpoint
to recover — treat both agents as gone and just re-launch them fresh. This costs ~15-20 minutes
of research time, nothing else — they're pure read-only investigation with no unique data to
lose.

**Exactly what to do**:
1. Confirm nothing already landed: `ls PRODUCT_AUDIT/.agent_*_raw_findings.md` — if either file
   exists, that agent actually finished before the restart and its findings are real and usable;
   only re-launch whichever one is missing.
2. Re-launch any missing agent(s) using the same prompts as before (see git history of this
   file / the conversation — the two prompts covered: **Agent A** = fresh codebase re-scan +
   classify every old-audit claim FIXED/STILL PRESENT/PARTIALLY FIXED/NO LONGER APPLICABLE/
   COULD NOT VERIFY + Part 5 tech-debt scan, writing to
   `PRODUCT_AUDIT/.agent_a_raw_findings.md`; **Agent B** = live Supabase Management API
   recheck of RLS/ownership/security claims + schema-reproducibility recheck, writing to
   `PRODUCT_AUDIT/.agent_b_raw_findings.md`. Cap at 2 concurrent agents, per the user's explicit
   instruction.
3. Everything else needed to finish is already safe and does NOT need to be redone:
   - **The schema-reproducibility bug is already fixed, verified, committed, and pushed**
     (commit `6a1db0b3` — `git log` will show it). Don't re-investigate this, it's done.
   - **The full 20-transition flywheel trace is already done**, written to
     `PRODUCT_AUDIT/.my_flywheel_trace_findings.md` (a real file on disk, survives restart same
     as any other repo file) — headline: no BROKEN/MISSING transitions found, two improved by
     the push-notification fix. Don't re-run this, just read the file.
   - This plan file itself.
4. Once both agent output files exist, do step 4 below: synthesize all 14 target files from
   (a) Agent A's findings, (b) Agent B's findings, (c)
   `PRODUCT_AUDIT/.my_flywheel_trace_findings.md`, overwrite the 13 existing `PRODUCT_AUDIT/*`
   files in place, write the new `AUDIT_CHANGELOG.md`, update `AUDIT_SUMMARY.json`. Then delete
   the three scratch files in this list (`.agent_a_raw_findings.md`, `.agent_b_raw_findings.md`,
   this file, `.my_flywheel_trace_findings.md`) since they're intermediate, not deliverables.
5. Commit and push the finished refresh when done — the user asked for this to be a normal,
   trackable change like everything else in this repo's history.
