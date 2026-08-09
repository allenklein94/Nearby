# Audit Changelog — Nearby

*This file is different from the other 13 in `PRODUCT_AUDIT/`: those are fully overwritten on
every refresh (they describe current state only); this one is kept and appended to across
refreshes, so a reader can see the audit package's own history without having to diff old git
commits. Add a new dated section at the top on each future refresh — don't rewrite prior
entries.*

---

## 2026-08-09 refresh (this pass)

**Refreshed against**: commit `a5fc80ba` (main), diffing from the 2026-08-08 original at commit
`d96f10cf` — 21 commits / 69 files / +14,443/−461 lines in between.

**Method**: two parallel background research agents (capped at 2 concurrent, per standing
practice) — Agent A did a fresh full codebase re-scan plus a claim-by-claim diff against every
item in the old audit files; Agent B did live production re-verification via the Supabase
Management API (`enmosvippabmuqslzrox`) of every RLS/ownership/security claim, plus an
independent schema-reproducibility replay check. A full 20-transition product-flywheel trace was
done directly (not delegated), extending the app's own internal `FLYWHEEL_TRACE_PROGRESS.md`.
All disposable test data created during live verification was deleted afterward and row counts
were confirmed back to pre-test baselines, matching this app's own established verification
convention.

**A codespace restart interrupted this refresh mid-pass.** Agent B's findings and the flywheel
trace both completed and were saved to disk before the restart; only Agent A's re-scan was lost
and had to be re-run from scratch on resume — recorded here so a future reader understands why
this refresh took two sessions rather than one, not because of any issue with the findings
themselves.

### Full classification of every item from the 2026-08-08 audit

**FIXED (16 items)**:
1. `ChatScreen.js` production debug overlay
2. 13-button `Alert.alert()` relationship-tools menu — turns out to have already been replaced
   with a real `ActionSheetModal.js` component at the very commit the last audit's own snapshot
   was taken from; the risk the audit flagged (needing an Android device test) was never
   actually live in the version being audited
3. Schema reproducibility (~45 of ~53 tables with no local `CREATE TABLE`) — replay-verified
   against a truly empty database via Docker, not just statically confirmed
4. `is_blocked()` historical safety bug — independently live-re-tested both directions this
   refresh, not just "reported fixed" as the last audit had to leave it
5. Business-facing RPC ownership checks (5 original + 3 new-this-session functions) —
   independently live-re-tested
6. Silent send-failure across 4 chat-style screens — centralized into one shared
   `useChatComposer` hook
7. No proof-of-redemption mechanism for business perks — a real 6-digit confirmation-code flow
8. Business dashboard profile-editing gap — plus a previously-silent, previously-unknown real
   bug found underneath it (the pre-existing address-edit path had zero UPDATE RLS policy and
   had never actually written anything for any real owner)
9. `Insights`/`Momentum`/`Rewards` dead-end screens — all three now have a real outbound CTA
   (this specific fix has no corresponding entry anywhere in the app's own internal `CLAUDE.md`
   changelog — real, confirmed by direct code read, but of undocumented provenance among the 21
   commits)
10. No path to invite a non-app-user to a specific gathering — a real share-link action
11. No nudge to join the community behind a just-attended gathering
12. `PlacesScreen.js`'s malformed `ListEmptyComponent` empty state
13. `OnboardingRecommendationsScreen.js`'s identical-card-navigation bug
14. `NoticesScreen.js` dead code (now deleted outright, not just orphaned) + the dangling
    `MatchesScreen` `RootNavigator.js` import
15. 3 of the originally-cited hardcoded backend URLs (`LoginScreen.js`,
    `RehearsalRoomScreen.js`, `ProfileScreen.js`)

**PARTIALLY FIXED (3 items)**:
16. Business self-serve onboarding — editing is fixed; *becoming* a partner is still admin-gated
17. Proactive "return" nudge — the in-app CTA half is fixed; the proactive push-notification
    half still doesn't exist
18. Hardcoded backend URLs — the 3 originally-named files are fixed, but the identical pattern
    is confirmed to exist in **12 more files**, a materially larger scope than previously known

**STILL PRESENT (7 items)**, confirmed unchanged, not touched this refresh:
19. No payment processor for business billing
20. `ChemistryDiaryListScreen.js`'s missing add-entry button
21. `FeaturesOverviewScreen.js`'s zero tap-through
22. `AdminBusinessRequestsScreen`'s Approve(RPC)/Deny(raw update) integrity asymmetry
23. No "withdraw my request" action for a pending host-approval gathering join
24. Client-side (non-indexed) search
25. `GatheringsScreen.js`/`ChatScreen.js` remaining large single-file screens (a third,
    `BusinessDashboardScreen.js`, now also crosses the same 1200+-line threshold — a new
    observation, not a new class of problem)

**RECLASSIFIED, not a fix or a regression — a correction to the prior audit's own ambiguity**:
26. Whether a business can unilaterally host its own gathering — was UNCLEAR, now confirmed a
    definite NO via direct code reading (`createGathering()` always sets `host_id` from the
    caller's own session)

**NO LONGER APPLICABLE**: none — every item from the old audit mapped to one of the categories
above; nothing was found to be based on a premise that no longer exists in the app.

**COULD NOT VERIFY**: the relationship-longevity tables' (`chemistry_diary_entries` etc.)
column-level constraints beyond what the baseline's flattened form shows — unchanged from the
last audit, still not individually reverse-engineered from each service file's query shape.

### Genuinely new findings this refresh (not fixes to a prior item)

- **A schema-reproducibility regression was introduced and then found and fixed within this same
  refresh pass.** `supabase/migrations/20260809_social_invite_community_join.sql` duplicated a
  policy already baked into the baseline (the two were committed together, but only the baseline
  side of the fix left the live migration properly archived elsewhere in the same commit family)
  — this would have broken a from-scratch `supabase/migrations/` replay with a hard `policy
  already exists` error. Found via a live catalog cross-check (Agent B) and independently via
  direct SQL replay testing; fixed by archiving the file; re-verified with a clean replay
  afterward. Disclosed here plainly because it shows the underlying discipline risk (a schema
  change landing without being properly archived/incrementalized) is still possible even
  immediately after the main schema-reproducibility fix was proven to work.
- **12 more files** carry the same hardcoded-backend-URL pattern the last audit found in 3 —
  see item 18 above.
- **`hosting_partner_id` self-edit is confirmed protected** by a dedicated `BEFORE UPDATE`
  trigger — this closes a real, previously-open question the app's own build history (`CLAUDE.md`)
  explicitly flagged as a "check before building" item and then never circled back to answer in
  writing. Live-tested directly this refresh: CONFIRMED SECURE.
- **Two small, previously-unflagged dead-code items**: `src/components/ActivityBell.js` (zero
  importers anywhere) and a stray duplicate directory
  (`src/services/src/services/textModeration.js`).
- **The flywheel trace found no new BROKEN or MISSING transition** across all 20 steps traced —
  a real, positive finding in its own right, not merely "nothing to report." The prior trace's
  two real gaps (Connection→Community, private-community invite-accept) are both confirmed
  fixed and re-verified working. Two transitions (Invite Connection→Invitation Received,
  Redemption→Return to App) are materially more reliable than at the last audit thanks to the
  cold-start push-notification fix.

### What genuinely shipped since the last audit (new capability, not corrections)

Schema-reproducibility baseline rebuild; invite-only gathering join server-side hardening;
`RelationshipHubScreen` consolidation; "Start a Community from This Gathering"; business profile
self-edit; persistent per-customer CRM notes/tags; a Business AI Assistant; a cold-start push-
notification-tap delivery fix. Each is described in full, with its own verification detail, in
the relevant file (`PRODUCT_OVERVIEW.md`, `DATABASE_AND_DATA_MODEL.md`, `SCREEN_INVENTORY.md`,
`PRODUCT_FLYWHEEL.md`).

### Package housekeeping

- All 13 pre-existing `PRODUCT_AUDIT/*.md`/`.json` files were overwritten in place with this
  refresh's findings — no second folder was created.
- `PRODUCT_AUDIT.zip` was regenerated after the user asked for it directly — now contains the
  refreshed 13 files plus this changelog (14 total), matching the original's file structure
  (each entry nested under a `PRODUCT_AUDIT/` folder inside the zip).
- `PROGRESS.md` (the original audit's own build-scratch file) was left untouched — it documents
  how the *original* audit was built, not a claim about current app state, so it doesn't need
  refreshing.
- This refresh's own scratch/intermediate files (`REFRESH_PROGRESS.md`, `.agent_a_raw_findings.md`,
  `.agent_b_raw_findings.md`, `.my_flywheel_trace_findings.md`) are deleted once this changelog
  and the other 13 files are committed — they were restart-safety and synthesis material, not
  deliverables.

---

## 2026-08-08 (original audit)

Initial audit package built at `/workspaces/Nearby/PRODUCT_AUDIT/` (13 files +
`AUDIT_SUMMARY.json`) for handoff to another AI for independent critique, at commit `d96f10cf`.
Method: direct code reading of the full repo (73 screens, 45 services, 30 components, 28 local
migrations, `schema.sql`, `RootNavigator.js`, `App.js`) plus two full-batch research agents that
independently read every screen file, with several surprising findings re-verified firsthand a
second time before inclusion. No live/production database queries were run (no credentials
available in that session); no manual device/simulator run was performed. See the 13 original
files' own text (now overwritten by this refresh) for the full original findings, or `git log`
for the commit that introduced them if the historical text itself is needed.
