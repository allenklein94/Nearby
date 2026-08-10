# Nearby — Change / Progress Report (Delta Since PRODUCT_AUDIT Refresh)

**Window:** commit `a5fc80ba` → `HEAD` (`312f0557`), spanning 2026-08-09 late evening through 2026-08-10.

**Note on baseline commits:** `a5fc80ba` is itself a mid-refresh checkpoint; the two commits immediately after it (`08682e4b`, `b3ba41f0`) are the audit-refresh finalizing itself (writing the 13 PRODUCT_AUDIT files + regenerating the zip) — no application code changed in those two. Real product/code delta starts at `5b1f2845`.

**Purpose of this document:** This is a lightweight delta report, not a full audit. It exists to let another AI update a product scorecard without re-scanning the codebase. Git history/diff was used as the primary source of truth; only changed files that needed clarification were read directly. No application code was modified to produce this report, and no full PRODUCT_AUDIT was regenerated.

---

## 1. GIT DELTA

- **Commits:** 31 (2 are audit-doc-only finalization; 29 touch application/schema code)
- **Files changed:** 62
- **Lines:** +5,098 / −3,401
- **New migrations:** 5 (`bounded_nearby_gatherings`, `business_request_review_guard`, `indexed_text_search`, `offers_indexed_search`, `business_conversations_summary`)
- **New files:** `src/hooks/usePaginatedMessages.js` (shared cursor-pagination hook)
- **Deleted files:** `src/services/src/services/textModeration.js` (stray duplicate, zero importers)

**Grouped into meaningful changes:**

1. **Audit-artifact finalization** (`08682e4b`, `b3ba41f0`) — no code, just the refresh being used as baseline.
2. **Post-refresh cleanup pass** (`5b1f2845`) — centralized 12 remaining hardcoded backend URLs onto the existing `functionUrl()` helper, added a "Withdraw Request" action for pending host-approval gathering requests, deleted the dead duplicate `textModeration.js`, and codified a migration-discipline rule in CLAUDE.md (one migration per schema change, verified via a from-scratch Docker replay before considered done).
3. **Business request integrity fix** (`09b03f04`) — real double-approval bug in `approve_business_partner_request()` (no `pending`-status guard), plus a new `deny_business_partner_request()` RPC giving Deny the same integrity shape as Approve.
4. **Indexed/server-side search rollout** (`a4b30d94`, `c91e5dc8`, `e926406f`) — gatherings, communities, and offers search all moved from full-download-then-`.includes()` to real `pg_trgm`-indexed Postgres search, wired into both Discover and Gatherings screens.
5. **`getNearbyGatherings()` SQL-bounded** (`b1e2b15b`) — the biggest single scalability fix in this window; see Section 3.
6. **Chemistry Diary profile entry point** (`15d76405`) — small, closes a stated-but-broken empty-state promise.
7. **UI polish pass** (`e0cbb5d5` → `501cb831`, 8 commits) — Home hero card, "Because You're Into" section, Home header consolidation (8→5), Inbox 5-tab→2-tab restructure, screen subtitles, first-time celebration copy, pre-join invite link, GatheringDetailScreen section consolidation.
8. **Scalability pass** (`d9a88b9a` → `796ecc7c`, 11 commits) — polling→realtime on 4 chat surfaces, shared pagination hook wired into all 4, business-conversations-summary RPC, 4 plain `.limit()` caps. See Section 3 for full detail.
9. **Create-screen tension resolution** (`312f0557`) — copy-only; confirmed keeping the activity-first grid over a type-first redesign. No functional change.

---

## 2. PRODUCT CHANGES

**CHANGE:** Inbox restructured from 5 tabs to 2
**WHAT IT DOES:** Messages / Requests / Invites / Reminders / Activity → Messages / Activity, with the other three now living as named, collapsible groups inside Activity.
**WHY IT MATTERS:** Directly closes a UX-polish-doc complaint about tab sprawl; reduces top-level navigation surface without deleting any real functionality.
**STATUS:** REWORKED

**CHANGE:** Home gained a "Your Next Thing" hero card + "Because You're Into..." section
**WHAT IT DOES:** Promotes the caller's soonest real upcoming commitment (hosting or attending) to a hero at the top; adds an interest-history-driven recommendation row.
**WHY IT MATTERS:** Home previously had no single "start here" element among 19 stacked sections — this is the first real hierarchy pass.
**STATUS:** NEW

**CHANGE:** Home section headers consolidated 8 → 5
**WHAT IT DOES:** Groups banners (pending invites/perks/since-away) adjacently; folds Best Pick/Because You're Into/Trending/Friends' Activity under one "Recommended For You" header.
**WHY IT MATTERS:** Reduces perceived density without removing any signal — pure regrouping.
**STATUS:** IMPROVED

**CHANGE:** GatheringDetailScreen section consolidation
**WHAT IT DOES:** Merges Vibe+Timeline into "What to Expect" and Community Perk+linked-community card into "Community & Perks."
**WHY IT MATTERS:** Same density problem as Home, on the app's most heavily-built screen; net reduction from 9 conceptual stacked pieces to 7.
**STATUS:** IMPROVED

**CHANGE:** First-time celebration copy (gathering join, gathering host, match)
**WHAT IT DOES:** Detects a genuine first-ever occurrence (real count checks, not a flag) and shows enriched congratulatory copy.
**WHY IT MATTERS:** Onboarding-moment polish; no fabricated signal.
**STATUS:** NEW

**CHANGE:** Pre-join Invite link on GatheringDetailScreen
**WHAT IT DOES:** Adds an invite-a-friend link visible before joining, not just after.
**WHY IT MATTERS:** Closes a gap the polish audit flagged directly with the user.
**STATUS:** NEW

**CHANGE:** Business partnership request double-approval bug
**WHAT IT DOES:** `approve_business_partner_request()` now requires `status='pending'`; concurrent/retried approvals no longer create a second `brand_partners` row or re-link gatherings/communities a second time.
**WHY IT MATTERS:** Real data-integrity bug, not just a style asymmetry — was live-exploitable before this fix.
**STATUS:** FIXED

**CHANGE:** `deny_business_partner_request()` RPC added
**WHAT IT DOES:** Deny now goes through the same RPC-guarded path as Approve instead of a raw client `.update()`.
**WHY IT MATTERS:** Consistency/integrity parity, closes the audit's "Approve/Deny asymmetry" partial-feature item.
**STATUS:** FIXED

**CHANGE:** Chemistry Diary reachable from `ViewProfileScreen`
**WHAT IT DOES:** Adds the link the screen's own empty state already promised existed.
**WHY IT MATTERS:** Closes a "missing_features" line item from the baseline audit.
**STATUS:** FIXED

**CHANGE:** Indexed cross-table search for offers/gatherings/communities
**WHAT IT DOES:** Replaces client-side `.includes()` filtering over already-fetched lists with real `pg_trgm`-indexed Postgres search (offers search now also matches business name, which the old client-side filter couldn't reliably scale).
**WHY IT MATTERS:** Closes the baseline audit's "Search — still a client-side filter... unchanged" partial-feature item directly.
**STATUS:** IMPROVED

**CHANGE:** Create screen subtitle/secondary-row copy
**WHAT IT DOES:** "What would you like to do today?" → "What do you want to do?"; added a "Want to build something bigger?" label over Community/Business links.
**WHY IT MATTERS:** Confirms/closes the type-first-vs-activity-first design tension the baseline audit implicitly left open; no functional change.
**STATUS:** IMPROVED (cosmetic)

---

## 3. SCALABILITY CHANGES

**AREA:** Gathering/community/business chat delivery (4 screens: 1:1, gathering, community, business)
**BEFORE:** Gathering and community chat re-downloaded their *entire* message history on a `setInterval` every 3–4 seconds, unconditionally, for as long as the screen was open. 1:1 chat had a working realtime channel *plus* a redundant poll running at the same time, and its own message/reaction channels were never cleaned up on unmount (leak).
**NOW:** All four surfaces use real Supabase Realtime `postgres_changes` channels (matching 1:1 chat's pre-existing pattern) with `INSERT`/`UPDATE` handlers; ChatScreen's redundant poll is gone (read-receipt marking moved onto the channel's own INSERT handler instead), and both previously-leaked channels are now cleaned up on unmount.
**IMPACT:** Eliminates a fixed per-screen re-fetch cost that scaled with conversation length × time-open, independent of message volume. This was the audit's own headline scalability finding.

**AREA:** Chat message pagination (same 4 screens)
**BEFORE:** Each chat screen fetched and held the *entire* conversation history in memory/state, unbounded.
**NOW:** New shared `usePaginatedMessages` hook — DESC-ordered, cursor-based (`created_at` cursor, not offset), 50-message pages, wired into all four via inverted `FlatList` + `onEndReached`. Realtime INSERTs prepend directly; no re-fetch triggered by new messages.
**IMPACT:** Bounds per-screen memory/query cost to a constant (50 rows + however many pages a user actually scrolls), independent of total conversation length.

**AREA:** Gathering browse/discovery (`getNearbyGatherings()`)
**BEFORE:** Downloaded every future-dated row in the entire `gatherings` table, unconditionally, then did all distance/visibility filtering client-side in JS.
**NOW:** New `get_bounded_nearby_gathering_ids()` SECURITY DEFINER RPC — public gatherings still bypass distance (preserving the existing deliberate product rule), non-public rows get a real bounding-box + haversine radius filter, everything capped at a hard `row_limit` (default 500), ordered soonest-first via a new index so Postgres can stop early rather than sort the whole table.
**IMPACT:** Flagged mid-session as "a bigger issue than the search box was" — the actual unbounded-download risk in the core browse funnel, not just the search box. Now genuinely bounded at the SQL level.

**AREA:** Business conversations list (`getBusinessConversations()`)
**BEFORE:** Downloaded *every* message across *every* conversation a business ever had, just to keep the first (most recent) row per customer in JS — the worst-shaped query in the original scalability audit.
**NOW:** New `get_business_conversations_summary()` RPC does a real `DISTINCT ON (conversation_with_id) ... ORDER BY created_at DESC`, capped at 500 conversations. Also fixed a real, previously-undetected bug found while rewriting this: `loadNeedsAttention()`'s "needs a reply" count was silently always counting every conversation (an `!undefined` bug), not just unanswered ones.
**IMPACT:** Removes the worst single query shape in the whole scalability audit; also fixes a real dashboard-metric bug as a side effect.

**AREA:** Communities/business/activity browse queries (4 separate functions)
**BEFORE:** `getPublicCommunities()`, `getCommunityMembers()`, `getNearbyBusinesses()`, and `ActivityScreen`'s notices query all downloaded unconditionally, no cap.
**NOW:** Plain `.limit()` caps — 200 / 200 / 300 / 200 respectively. `getNearbyBusinesses()` also gained a real `.order('created_at', ...)` clause (a `.limit()` with no ordering returns a non-deterministic slice).
**IMPACT:** Closes the remaining four lower-tier unbounded queries from the scalability audit. Lighter fix than the RPC treatment above — deliberate, matches this app's own stated reasoning that these tables are expected to stay smaller for longer.

**AREA:** Gathering/community/offer text search
**BEFORE:** Client-side `.includes()` substring filter over an already-fully-fetched list (offers search additionally couldn't match business name at all, only title/description, due to a PostgREST cross-table `.or()` limitation).
**NOW:** `pg_trgm` GIN indexes + two-step "narrow via ILIKE RPC/query, fetch full rows after" pattern; offers search now genuinely matches business name via a new joined RPC.
**IMPACT:** Bounds the search-box path independent of the browse-path fixes above; closes the audit's "Search" partial-feature gap.

---

## 4. SECURITY / DATABASE CHANGES

**CHANGE:** `approve_business_partner_request()` guarded against double-approval (`status='pending'` check added); new `deny_business_partner_request()` RPC with the same guard.
**VERIFICATION:** Live-verified against production with real disposable test requests (non-admin rejected, admin succeeds once, re-approve/re-deny of an already-reviewed request rejected, confirmed no duplicate `brand_partners` row created on retry). Also replayed via from-scratch Docker migration.
**IMPACT:** Closes a real, previously-exploitable data-integrity bug (not just the stylistic Approve/Deny asymmetry the original audit flagged).

**CHANGE:** New `get_bounded_nearby_gathering_ids()` SECURITY DEFINER RPC.
**VERIFICATION:** Live-verified — public-bypasses-distance rule preserved, `row_limit` cap works, host-exclusion works, `anon` role rejected. Docker replay confirmed.
**IMPACT:** No new exposure — same privacy posture as the function it replaces (only ever returns `id`, never coordinates).

**CHANGE:** New `get_business_conversations_summary()` SECURITY DEFINER RPC, ownership-scoped via `managed_partner_id`.
**VERIFICATION:** Live-verified — real owner gets correct rows, non-owner gets zero. Docker replay confirmed.
**IMPACT:** Closes the worst data-exposure-adjacent query shape (previously all message content was fetched client-side, filtered in JS — now the RPC does the real query, never returning more than what's needed).

**CHANGE:** New trigram-search RPCs (`search_offer_ids`, plus indexed ILIKE search for gatherings/communities), granted `authenticated` only, revoked from `anon`/`public`.
**VERIFICATION:** Live-verified grants both directions; confirmed search results respect the same visibility/active/expiry filters plain browse already applies (no privacy widening via search).
**IMPACT:** No new exposure; closes a functional gap (business-name search) without loosening access.

Nothing else touched RLS, auth, or ownership checks in this window. No new privilege-escalation or data-exposure findings.

---

## 5. CORE FLYWHEEL IMPACT

**Discover → Gathering:** Browse path now SQL-bounded; search path now indexed. Scale/latency improvement to this transition, not a correctness change — the transition already worked at baseline.

**Chat (the node covering 1:1/gathering/community/business messaging):** Materially changed — went from poll-based (2 of 4 surfaces) or poll+redundant-realtime (1:1) to real realtime delivery + cursor pagination on all 4. This is a genuine architecture change to how messages reach a screen, not just a scale tweak, though the *correctness* of "message sent → message received" was already established at baseline (1:1 chat's realtime channel already worked).

**Business (the node covering business partnership/dashboard):** The double-approval integrity bug fix and the conversations-summary rewrite both touch this node directly — a business owner's dashboard data is now both correct (needs-attention count bug fixed) and cheaper to fetch.

**Perk:** Search discoverability improved (business-name matching now works), no change to the redemption mechanism itself.

**Create:** No functional change — copy-only.

**Join, Invite, Invitation, Attend, Connection, Community, Redemption, Return:** No code touched these transitions in this window.

**FLYWHEEL STATUS: IMPROVED (scale/robustness) — UNCHANGED (correctness).** No new end-to-end flywheel trace was performed in this window, and none of this work re-verifies a transition's *correctness* — it makes already-working transitions (chat delivery, gathering browse, business conversation list) scale, and fixes one real integrity bug (business-request double-approval) that sat adjacent to, not inside, a traced transition. Do not read this delta as "more of the flywheel is now verified" — it isn't; it's "more of the flywheel now won't fall over under real load."

---

## 6. CURRENT REMAINING ISSUES

Classified against the "genuinely-still-open list" the baseline audit itself established immediately after the refresh:

| Issue (from baseline audit) | Status |
|---|---|
| AdminBusinessRequestsScreen Approve/Deny asymmetry + underlying double-approval bug | **FIXED** |
| Stripe/payment processor not integrated | **UNCHANGED** |
| AI-generated cover photos (deferred premium feature) | **UNCHANGED** |
| True skip-location option in Create | **UNCHANGED** |
| Large-file refactors (GatheringsScreen/ChatScreen/BusinessDashboardScreen) | **UNCHANGED** |
| 5-persona device QA pass | **UNCHANGED** (still blocked — no device access) |
| ChemistryDiaryListScreen profile-entry-point gap | **FIXED** |
| Non-indexed offers search | **FIXED** |
| Hardcoded backend URLs (12 files) | **FIXED** |
| Pending-join "withdraw request" gap | **FIXED** |
| Search — client-side filter over already-fetched lists (gatherings/communities) | **FIXED** |
| Business self-serve onboarding (claiming, not editing) | **UNCHANGED** |
| Proactive return/streak/tier push notification | **UNCHANGED** |
| AI features never exercised end-to-end (real Anthropic call path) | **UNCHANGED** |

**5 most important remaining issues, in order:**
1. **No manual device/simulator testing has ever been performed for any flow in this app's entire history** — every single change in this delta (and every prior session) is verified via static export/RPC-level checks only.
2. **No payment processor exists for business billing** — invoices generate correctly but nothing collects money.
3. **AI features (ai-concierge, create-assistant, business-ai-assistant) have never had their actual model-call success path exercised end-to-end.**
4. **Business partner onboarding is still fully admin-gated** — profile editing is fixed, but there's no self-serve claim flow.
5. **Three large files (GatheringsScreen/ChatScreen/BusinessDashboardScreen) remain deliberately un-refactored**, and ChatScreen in particular just absorbed the highest-risk rewrite of this whole scalability pass (5d) without device verification.

---

## 7. DEVICE READINESS

**Yes — this window materially changes what needs testing.** The scalability pass rewrote message delivery and rendering on all four chat surfaces (the app's highest-traffic interaction), and the UI polish pass restructured two of the five bottom-tab surfaces (Home, Inbox).

**Relevant tests to run on a real device:**
- **Realtime chat delivery** — send from device A, confirm device B receives without manual refresh, on all 4 surfaces (1:1, gathering, community, business).
- **Cursor pagination / inverted FlatList** — scroll to top of a long conversation, confirm older messages load without jumping/duplicating; confirm new messages still land at the visual bottom in order; confirm empty states don't render upside-down.
- **Read receipts** — confirm they now fire immediately on message arrival (moved off the old poll) rather than after up to 3 seconds.
- **Channel cleanup** — open/close ChatScreen repeatedly, confirm no growing number of orphaned realtime subscriptions (was a real leak before this pass).
- **Inbox restructure** — badge count accuracy, deep-link routing (`initialSubSection`) lands on the right group, all three new Activity groups (Requests/Invitations/Reminders) render/hide and their actions still work.
- **Home** — hero card renders correctly for hosting/attending/no-upcoming-plans states; banner cluster (1/2/3 banners present) doesn't visually clash with the moved quick-stats row.
- **GatheringDetailScreen** — "What to Expect" and "Community & Perks" render correctly across partial-data combinations (vibe-only, timeline-only, both; perk-only, community-only, both).
- **First-time celebration copy** — needs a genuinely fresh test account for join/host/match variants.
- **Business admin Approve/Deny** — as a real admin account, confirm both actions still work post-RPC-swap.
- **Search** — confirm typing a business name (not just offer title) surfaces the right perk on Discover.
- **Scale-cap screens** — Communities browse, community member list, business map layer, Activity feed — currently unexercised by real data since production row counts are nowhere near the new 200–300 caps.

---

## 8. SCORECARD IMPACT

No numeric/lettered scorecard exists anywhere in the repo (checked `PRODUCT_AUDIT/*.md` and `AUDIT_SUMMARY.json` — no score fields present). `OLD SCORE` values below could not be populated from the repo; whatever scorecard is being tracked lives outside it. Recommendations are directional only — apply against the current tracked values.

**CATEGORY:** Scalability
**OLD SCORE:** *(not in repo — pull from tracker)*
**RECOMMENDED NEW SCORE:** UP
**CHANGE:** ↑
**REASON:** This is the one category where the delta is substantive and structural, not cosmetic — poll-based chat replaced with realtime on 4 surfaces, unbounded message history replaced with real cursor pagination on all 4, the worst unbounded query in the prior audit (business conversations) replaced with a real bounded RPC, gathering browse SQL-bounded, 4 more browse queries capped. This is exactly the category the prior audit's own scalability findings targeted.

**CATEGORY:** Database / Backend
**OLD SCORE:** *(not in repo)*
**RECOMMENDED NEW SCORE:** UP (slight)
**CHANGE:** ↑
**REASON:** 5 new migrations, all live-verified + Docker-replayed per this codebase's established discipline; one real integrity bug (double-approval) fixed with a live-proven guard. Smaller move than Scalability since these RPCs mostly serve the scalability work rather than representing new backend capability.

**CATEGORY:** Business Product
**OLD SCORE:** *(not in repo)*
**RECOMMENDED NEW SCORE:** UP (slight)
**CHANGE:** ↑
**REASON:** Real integrity bug fixed (double-approval could create duplicate partner records), a real dashboard-metric bug fixed as a byproduct (needs-attention count was always wrong), and business conversation loading no longer scales with total message history. Don't move this further — self-serve onboarding/claiming is still fully admin-gated, unchanged.

**CATEGORY:** Discover
**OLD SCORE:** *(not in repo)*
**RECOMMENDED NEW SCORE:** UP (slight)
**CHANGE:** ↑
**REASON:** Closes the baseline audit's own explicitly-flagged "Search — still client-side, unchanged" gap. Real, indexed, cross-table search now works, including the previously-impossible business-name-to-offer match.

**CATEGORY:** Messaging / Inbox
**OLD SCORE:** *(not in repo)*
**RECOMMENDED NEW SCORE:** UP
**CHANGE:** ↑
**REASON:** Both the delivery mechanism (realtime replacing polling, channel leaks fixed) and the data shape (bounded pagination replacing full-history download) changed materially. Also the Inbox 5→2 tab restructure is a real IA simplification. Hold back from a bigger jump only because none of it has been device-verified yet — this is architecturally sound but functionally unproven on a real device.

**CATEGORY:** Home
**OLD SCORE:** *(not in repo)*
**RECOMMENDED NEW SCORE:** UP (slight)
**CHANGE:** ↑
**REASON:** Real hero card + interest-based section + header consolidation (8→5) address the density complaint directly, with no signal removed. Modest move since it's UI reorganization, not new capability.

**CATEGORY:** Gatherings
**OLD SCORE:** *(not in repo)*
**RECOMMENDED NEW SCORE:** UP (slight)
**CHANGE:** ↑
**REASON:** The browse funnel (`getNearbyGatherings`) is now genuinely SQL-bounded rather than a full-table download — this is the single most consequential scalability fix outside of chat, and it's the browse path every gathering-discovery flow depends on.

**CATEGORY:** Create
**OLD SCORE:** *(not in repo)*
**RECOMMENDED NEW SCORE:** HOLD
**CHANGE:** — (no change)
**REASON:** Copy-only tension resolution. Confirms an existing decision was already correctly built; no functional change to score against.

**CATEGORY:** Device Readiness
**OLD SCORE:** *(not in repo)*
**RECOMMENDED NEW SCORE:** HOLD, possibly DOWN in relative terms
**CHANGE:** — or ↓ (relative)
**REASON:** The absolute state (zero device tests ever run) hasn't changed, but the surface area now waiting on device verification has grown — a full rewrite of message delivery on all 4 chat screens, plus two restructured tabs, are all shipped-but-unverified. If this category tracks "risk of what's unverified" rather than "was anything tested," it arguably deserves a slight down-tick, not a hold.

**All other categories (Core Concept, Consumer Value Proposition, Navigation/IA, Communities, Connections, Core Flywheel, Perks/Rewards, Monetization, Safety/Privacy, Technical Architecture, Polish/UX, Launch Readiness): HOLD.** No material change in this window. (Communities got a `.limit()` cap — real but too small to move a whole-category score. Polish/UX saw real work — Home/Inbox/GatheringDetail — but it's copy/layout reorganization on already-scored screens, not new capability; leave it to the receiving AI's judgment whether the cumulative UI-polish work across this and prior sessions crosses a threshold worth moving.)

---

## 9. EXECUTIVE SUMMARY

**BIGGEST IMPROVEMENT SINCE LAST AUDIT:** The scalability pass — polling replaced with realtime and unbounded history replaced with cursor pagination across all four chat surfaces, plus the two worst unbounded queries in the app (`getNearbyGatherings`, `getBusinessConversations`) now SQL-bounded.

**MOST IMPORTANT REMAINING TECHNICAL ISSUE:** No payment processor exists for business billing — invoices generate but nothing collects money. Second: the AI feature call paths (concierge/create-assistant/business-assistant) have never been exercised end-to-end.

**MOST IMPORTANT REMAINING PRODUCT ISSUE:** Business partner onboarding is still fully admin-gated with no self-serve claim flow — profile editing was fixed earlier, but becoming a partner in the first place still requires manual admin review.

**MOST IMPORTANT THING WE SHOULD TEST ON DEVICE:** Realtime chat delivery + cursor pagination across all four surfaces — this is a full rewrite of the app's highest-traffic interaction, shipped with zero device verification, and includes a real behavior change (read receipts moved off the poll, channel cleanup fixed) that only a live two-device test can actually prove.

**SHOULD WE BUILD MORE FEATURES RIGHT NOW? NO** — the codebase itself has now said this multiple times across sessions (device QA, not more features, is the stated next input needed); this delta reinforces rather than changes that.

**SHOULD WE MOVE TO DEVICE QA? YES** — arguably more urgently than before this window, since the highest-risk unverified surface (chat) just got materially larger.
