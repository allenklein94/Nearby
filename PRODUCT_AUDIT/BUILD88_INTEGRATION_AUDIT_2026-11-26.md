# Build 88 integration audit (2026-11-26)

Branch: `integ/build-88-full` = `integ/build88-trial` (5561a512c) + the merges below. PREPARATION ONLY: not merged to
main, nothing deployed, no build submitted. Every remote branch with commits not in `integ/build-88` was checked (21);
"contained" = an ancestor of another branch listed; "superseded" = its changes already reached the trial by another path.

## Already in the trial (`integ/build88-trial`, prepared 2026-11-25)
`integ/build-88` (deploy branch 0348-0432 incl. 0417's migration + visit confirmation 0430-0432 + Option A website source),
`integ/business-website` + `integ/business-website-release` (business Home request preview, 0428 business message alerts,
email reply-to), `post-tier1/category-picker-collapsed`, `post-tier1/multi-location`, `post-tier1/onboarding-fixes`,
`staging/environment-config`, `post-tier1/dating-appearance-ranking`, `fix/main-tabs-back`.

## Merged now
| Branch | What | Result |
|---|---|---|
| `deploy/catchup-0348-0432` (latest) | backup scripts, approval packet updates | clean |
| `fix/friend-swipe-history` | migration **20270433** + journey | clean |
| `fix/native-back-prevent-remove` | Edit Profile / header Back fix (full upstream react-native-screens PR #3173 patch + `useLeaveGuard`) | conflicted with `fix/main-tabs-back` (the SAME bug fixed twice, in parallel). Took native-back's version in the 5 conflicted files: it is the documented one (owner-approved staging test build `test/back-fix-staging` was made from it) and carries the fuller patch. Neither is device-verified. |

## NOT merged: needs an owner decision or real work
| Branch | Why not | What it needs |
|---|---|---|
| `post-tier1/dating-card-reasons` (contains `browse-global-ranking`, i.e. **0417's tattoo/piercing client**, card reasons, appearance double-count fix) | **Design conflict with staged 0382** (idea 9, anti-scraping): 0382 moved Browse to `browse_dating_candidates` (capped page + daily limit, `services/datingBrowse.js`); the branch reads the view in 300-row windows and ranks the whole pool on the phone. Both cannot hold: under 0382 the 300-row reads are exactly what the cap prevents. Also: "within 35 feet" vs the trial's newer "crossed nearby" wording. 0417's client commit alone (f243c674c) does not cherry-pick: it sits on the global-ranking Browse code. | Owner choice: (a) keep 0382's server-capped Browse and port card reasons + tattoo/piercing preferences onto it (ranking within each capped page only), or (b) change 0382's design (a security migration: its own approval). Recommended: (a). 0417's migration alone is harmless without its client (new optional columns nothing reads). |
| `post-tier1/offer-preview-compact` (accepted Make an Offer dock) | Conflict in `BusinessDashboardScreen.js`: since the dock was built, the trial's preview gained shared card styles (`offerCardStyles`) and the never-live preview button (`previewAcceptAction`); the dock replaces that preview with an older copy. | Port: put the trial's current preview body inside `OfferPreviewDock`; then its headless width checks again. Small, but it is UI work, not a merge. |

## Excluded
| Branch | Reason |
|---|---|
| `post-tier1/offer-preview-dock` | Superseded alternative of the dock (one commit); `offer-preview-compact` is the version recorded as coding closed. |
| `post-tier1/business-web-only` | Superseded: its request preview + 0428 pieces reached the trial (newer versions) via `integ/business-website*`; the remaining diffs are the trial being AHEAD (0375/0387 push types). |
| `post-tier1/custom-domain` | Merging it IS the custom-domain cutover (app.json/app.config links, docs CNAME, policy pages -> support@thisisnearby.com). Separate owner gate; it also carries the support@ address switch the policy wording now relies on. Decide with the policy publish. |
| `test/back-fix-staging` | Test build branch = native-back fix (merged above) + staging config (already in trial). |
| `fix/main-tabs-back` | Already in trial; overridden in its conflicted files by native-back (above). |
| `claude/peaceful-dijkstra-6326u8` | Stale (2026-09-26): its migration `20270219_vibe_attributes.sql` collides with main's different `20270219_business_vibes.sql`. Abandoned. |
| `main`, `staging/environment-config` | Docs only / already in. |

## Dependencies still to reconcile before a build 88 is made
- Edge functions, env vars, flags: unchanged from `MIGRATION_CATCHUP_PLAN_2026-11-23.md` §8.8 (edge-function plan with live versions) on the deploy branch; nothing in the merges above adds a function or secret.
- `package.json` now runs patch-package on install (native-back): a clean `npm ci` must apply the react-native-screens patch before the iOS build (checked on `test/back-fix-staging` 2026-11-22).
- Staging rehearsal of real content screening: blocked until the separate Anthropic organization is funded and its key is set on staging only.
