# Nearby — Fast Targeted Change Delta
**Baseline:** commit `312f0557` (2026-08-10, closing point of `PRODUCT_AUDIT/DELTA_REPORT_2026-08-10.md`) → **HEAD:** `b061d3a3` (2026-08-11)
**Window:** 38 commits, 36 files changed, +6,349/−623 lines, 5 new migrations, 3 new screens, 1 new component.

This report chains onto two existing delta reports already in the repo (`DELTA_REPORT_2026-08-10.md` and `DELTA_REPORT_PHASES_6_7_8_2026-08-10.md`) rather than re-deriving their findings. No re-audit, re-scan, or new security/scalability pass was performed.

---

## 1. BASELINE RECAP (not re-verified, carried forward)

- **Full audit:** `PRODUCT_AUDIT/` refresh, commit `a5fc80ba` (2026-08-09).
- **Prior delta:** `312f0557` (2026-08-10) — scalability pass (realtime chat on 4 surfaces, cursor pagination, `getNearbyGatherings()` SQL-bounded, indexed search), business-request double-approval fix, Home hero/consolidation, Inbox 5→2 tabs.
- **No numeric scorecard exists in the repo** (confirmed again this pass — still true). All scoring below is directional (UP/HOLD/DOWN), same convention the prior delta used.
- **Previously-FIXED items:** double-approval guard, hardcoded URLs, indexed search, withdraw-request, Chemistry Diary entry point — all unaffected this window, not re-verified.
- **Previously-STILL-PRESENT items carried forward, unaffected this window:** Stripe/payment processor, AI cover photos, true skip-location in Create, 3 large-file refactors, 5-persona device QA, proactive streak/tier push, zero device testing ever performed.

---

## 2. GIT DELTA BY PRODUCT AREA

| Area | Commits touching it | Nature |
|---|---|---|
| **Home** | Quick Picks personalization + edit modal, discover-first tap, weather copy softened, IA round 3 Phases 1/2/4 (Plans link, headline) | Restructure + new capability |
| **Inbox / Activity** | IA round 3 Phase 2 (Needs Attention/Today/Earlier), Phase 3 (chat-vs-gathering naming fix) | Restructure |
| **Profile / You** | IA round 3 Phase 5 (relabel groups + Business header) | Cosmetic relabel |
| **Settings** | IA round 3 Phase 6 (regroup into 6 named sections, largest single-file rewrite this window) | Restructure |
| **Gatherings** | New `PlansScreen` (Upcoming/Hosting/Past), manage-attendees routing bug fix, dynamic category headline | New screen + bug fix |
| **Communities** | Community/business auto-link confusion fix (heads-up notice + info card) | Bug fix (real, user-reported) |
| **Business** | Business Partner Onboarding enrichment (6 steps: schema, notifications, expanded form, status screen, admin card, push routing), business category schema + grouping UI, Business Dashboard tap-target bug fix | New capability (largest area this window) |
| **AI** | **No code change** — but a real production incident diagnosed: Anthropic billing exhausted, breaking every AI feature app-wide | Critical finding, not a code delta |
| **Notifications** | Business partner approve/deny push, push-tap routing for both | New capability |
| **Backend / Database** | 5 migrations, all live-verified + Docker-replayed | Incremental |
| **Performance / Scalability, Security, Payments** | Untouched this window | No change |

---

## 3. PRODUCT / UX CHANGES

**Home → Quick Picks**
- WHAT CHANGED: Quick Picks are now personalized (real top-3 attended categories, time-flavored) with a new edit modal (`QuickPicksEditModal.js`, up to 5 categories, "Use My Activity Instead" to revert to auto). Tapping a chip now browses `Gatherings` filtered by category instead of jumping straight to `CreateGathering`.
- WHY: Closed a confirmed real gap flagged in an earlier UI-map review (hardcoded, create-only chips).
- CURRENT UX: Browse-first, personalized, editable.
- REPLACED: Static hardcoded chip list + create-first tap.
- NEW CONFLICT: None found — the create path was relocated to a "+ Start a {category} Gathering" empty-state button, not removed.

**Home → Social Forecast / weather**
- WHAT CHANGED: SQL copy softened ("tonight" → "right now"/"a better time"); bad-weather (`Quiet`) case now pairs with a real "🏠 N indoor gatherings today" sub-list sourced from a new static indoor/outdoor category map.
- WHY: Closed the standing "misleading current-conditions-as-forecast" gap plus made the card actionable, per plan.
- CURRENT UX: `Excellent` renders unchanged (full card); `Quiet` now optionally shows real indoor suggestions; ambiguous `Good` case still suppressed entirely (unchanged from prior window).
- NEW CONFLICT: None — genuine forecast-API integration (option "a" from the prior window) remains explicitly unbuilt.

**Home → Your Plans / "See All Plans"**
- WHAT CHANGED: "See All Plans →" now points at a brand-new dedicated `PlansScreen` (Upcoming / Hosting / Past tabs) instead of `GatheringsScreen`.
- WHY: Closed a confirmed gap — no "Past" concept existed anywhere.
- CURRENT UX: Home shows next 1–3 plans; `PlansScreen` shows the full calendar, tap-through only, no management actions.
- REPLACED: Direct link into `GatheringsScreen`'s `attending`/`hosting` tabs.
- **NEW CONFLICT — real, worth flagging (see Section 6):** `PlansScreen` and `GatheringsScreen` now both have a tab literally labeled **"Hosting"** with different capabilities (one read-only calendar, one has live approve/manage actions). This is a deliberate, documented split, not a bug, but it's a real terminology collision a device-test pass should specifically look at.

**Inbox → Activity**
- WHAT CHANGED: Flat groups (`requests`/`invitations`/`reminders` + unlabeled chronological feed) reorganized into three named clusters: **🎯 Needs Your Attention** (requests+invitations), **📅 Today**, **🕰️ Earlier**.
- WHY: Closed a UX-polish complaint about unlabeled density.
- CURRENT UX: Deep-link (`initialSubSection`) still promotes the right cluster to the front.
- NEW CONFLICT: None found. Business-update notices deliberately stayed in "Earlier" (no urgency signal exists in the data to justify moving them) — an explicit, disclosed decision, not an oversight.

**Gathering chat vs. gathering commitment naming**
- WHAT CHANGED: Two real conflations found and fixed — chat screen headers and Inbox's Group Chats chip now read "{Title} Chat" instead of the bare gathering/community title.
- WHY: Direct audit pass explicitly for this exact "Friday Soccer" vs. "Friday Soccer Chat" confusion.
- CURRENT UX: A gathering reads as itself everywhere it's the thing (Home, Plans, Detail) and "X Chat" everywhere it's the conversation.
- NEW CONFLICT: None — this closes a conflict, doesn't create one.

**Profile → You**
- WHAT CHANGED: Three groups renamed ("My Circle"→"Your Connections", "My Activity"→"Your Activity", "Profile"→"Your Profile"); the existing Business row got its own header for the first time.
- WHY: Closed the last piece of the round-3 plan's point 6.
- NEW CONFLICT: Profile now has a "Business" section header (personal — "manage my own business") and Settings also has a "Business" section header (admin-only — "review other businesses"). Functionally correctly scoped and documented as deliberate, but it's the same word meaning two different personas on two different screens (see Section 6).

**Settings**
- WHAT CHANGED: 11 loosely-organized sections + 3 unlabeled admin rows collapsed into 6 named control-center groups (Account, Preferences, Notifications, Privacy & Safety, Business, Connect, Support) — the largest single-file rewrite this window, pure reorder/relabel (verified by the building session via a sorted line-diff showing zero content loss).
- WHY: Closed round 3's largest phase.
- NEW CONFLICT: "Connect" and "Business"(admin) both ended up as headers outside the plan's original literal 6-name mapping — the building session found and disclosed this itself rather than forcing a bad fit.

**Community/business auto-link confusion**
- WHAT CHANGED: A real user-reported bug — creating a community you manage a business under silently linked it to that business, showing a nonsensical "Follow your own business" button. Fixed with a pre-create heads-up notice and a post-create explanatory info card replacing the Follow button.
- WHY: Live user report, not an audit finding — a genuine DB trigger (`set_community_hosting_partner_from_creator`) was working as designed but silently, with no UI explanation.
- NEW CONFLICT: None — the underlying trigger is unchanged and still load-bearing for Business Dashboard.

**Business Dashboard tap targets**
- WHAT CHANGED: Gatherings/Communities tab rows were plain non-tappable `<View>`s — fixed to real `TouchableOpacity`s navigating to `GatheringDetail`/`CommunityDetail`.
- WHY: Live user report, confirmed via direct read matching exactly.
- NEW CONFLICT: None.

**Business Partner Onboarding (6-step enrichment)**
- WHAT CHANGED: Expanded apply form (category/website/phone/address/requested-features), a real "My Application" status screen, admin card shows richer context, push notifications + push-tap routing on approve/deny, partial-unique-index preventing duplicate pending applications.
- WHY: Closed the largest remaining item from the earlier self-serve-onboarding plan.
- CURRENT UX: An applicant can now see their own status (previously zero visibility after submitting).
- NEW CONFLICT: None found; "Request More Information" reviewer state remains deliberately deferred (unchanged decision).

**Business category schema + grouping**
- WHAT CHANGED: `brand_partners.category` (6-value enum matching the existing `BUSINESS_CATEGORIES`), copied onto approval, editable via `update_business_profile`; `RequestBusinessPartnerScreen` gained a category filter chip row and a default "Businesses on Nearby" browse list for empty/short queries.
- WHY: Closed a real gap — browsing required already knowing an exact business name.
- NEW CONFLICT: None — chips only ever show categories a real business actually has plus a conditional "Uncategorized," never all 6 unconditionally.

**AI (no code change — critical finding)**
- WHAT HAPPENED: While investigating a live user report ("Something Else" AI request always failing), the building session reproduced it directly against production and found the root cause is **Anthropic account billing exhausted** ("Your credit balance is too low..."), not a code defect. This silently breaks **every** AI feature sharing `ANTHROPIC_API_KEY`: Create Assistant, AI Concierge, `generate-icebreaker`, `generate-strengths`, `generate-courage-message`, `translate-message`, `generate-introduction`, `rehearsal-chat`, `business-ai-assistant`.
- WHY THIS MATTERS: This converts a long-standing "unverified end-to-end" status (noted in nearly every AI-feature build note across this file) into a confirmed, currently-broken production state. Not fixable by a code session — needs the Anthropic console account funded.

---

## 4. OPEN DECISIONS

| Decision | Status | Detail |
|---|---|---|
| New `PlansScreen` vs. extend `GatheringsScreen` | **A — Resolved** | Built as a separate screen. |
| Weather: does `Excellent` still get a full card? | **A — Resolved** | Yes, unchanged; only `Quiet` gained indoor suggestions. |
| Business-notice urgency in Activity's "Needs Attention" | **A — Resolved** | Kept in "Earlier" — no real urgency signal exists in the data to justify moving them. |
| "Connect" / "❤️ Relationship" placement in Settings | **A — Resolved** | Connect kept as its own 7th header; Relationship moved into it. |
| Settings "Business" section content | **A — Resolved** | Real gap found (no personal business row left to fold in) — resolved as admin-only rows. |
| "Request More Information" reviewer state (business apply) | **C — Still unresolved, deliberately** | Deferred per locked decision; only build if real application volume makes deny-and-reapply too costly. |
| Genuine hourly-forecast API integration (vs. current-conditions-only) | **C — Still unresolved** | Option (a) from the prior window explicitly not attempted; needs its own cost/latency scope discussion. |
| Anthropic billing funding | **New, not previously open — needs a decision now** | Not a code decision — needs the account topped up externally before any AI feature works again. |

---

## 5. SCORECARD DELTA

No numeric baseline exists in this repo (confirmed again). Directional only, same convention as the prior delta.

| Category | Suggested direction | Evidence | Confidence |
|---|---|---|---|
| Navigation / IA | **UP** | 7-phase round-3 restructure landed in full (Plans screen, Activity clusters, chat-naming fix, Settings 6-group regroup) | High (code-verified); **untested on device** |
| Business Product | **UP** | Full onboarding enrichment (6 steps) + category schema/grouping + 2 live bug fixes, all closing confirmed real gaps | High (code+live-verified); UI untested on device |
| Home | **UP (slight)** | Real personalization (Quick Picks) replacing hardcoded chips; weather made more actionable | Medium — untested on device |
| Settings | **UP** | Largest single-screen reorganization this window, verified as reorder-only (no content loss) | Medium — untested on device |
| Communities | **UP (slight)** | Real, user-confirmed confusion bug fixed | High |
| Gatherings | **UP (slight)** | Manage-attendees routing bug fixed; new Plans screen adds a real "Past" view | Medium |
| Notifications | **UP (slight)** | 2 new push types + tap-routing added | Medium — push delivery itself unverified end-to-end |
| Database / Backend | **UP (slight)** | 5 migrations, each live-verified + Docker-replayed per established discipline | High |
| **AI** | **DOWN** | Not a code regression — but the true state moved from "unverified" to "confirmed broken app-wide" (Anthropic billing). This is worse information than before, even though nothing in code changed. | High (confirmed via live reproduction) |
| Launch Readiness | **DOWN (flag)** | Every AI-marketed feature (Create Assistant, AI Concierge) currently fails for real users until billing is resolved — a real go-to-market blocker | High |
| Device Readiness | **HOLD, risk trending down** | Same zero-device-tests-ever-run state as before, but surface area waiting on verification grew again (Plans screen, Settings rewrite, Quick Picks modal, category chips) | High |
| Discover, Create, Connections, Perks/Rewards, Messaging/Inbox mechanics, Payments, Safety/Privacy, Scalability, Security, Core Concept, Consumer Value Prop, Core Flywheel, Technical Architecture, Polish/UX (beyond what's counted above) | **HOLD** | Not materially touched this window | High |

---

## 6. REGRESSIONS / WATCH ITEMS

No functional regressions found. Two real **naming/surface overlaps**, both disclosed by the building sessions themselves, worth a second look:

1. **Two screens both have a tab literally called "Hosting"** — `GatheringsScreen`'s Hosting tab (management actions: approve, invite, edit) and the new `PlansScreen`'s Hosting tab (read-only, tap-through only). Deliberate split per design intent, but a user landing on the wrong one via "Manage attendees →" vs. "See All Plans →" could reasonably expect the same capabilities in both. Worth a specific device-test click-through.
2. **"Business" is now a section header on two different screens with two different meanings** — Profile's "Business" (managing your own business) and Settings' "Business" (admin reviewing other businesses' applications). Correctly scoped underneath, but the label collision is real.

No evidence found of: duplicated functionality, navigation loops, inconsistent terminology beyond the two items above, Home re-crowding (net section count still 5, per round-3's own re-confirmation), or duplicate business entry points (Phase 7 consolidation from the prior window remains intact — confirmed no new business links reintroduced into Create/Settings this window).

---

## 7. TOP 5 THINGS WORTH FIXING NEXT

1. **Resolve the Anthropic billing issue.** Every AI feature in the app is currently broken for real users. Highest impact, zero code effort, but requires the user's action (fund the console account) — flag this as urgent even though it's outside a code session's ability to fix.
2. **Device-test the "Hosting" tab overlap** (`PlansScreen` vs. `GatheringsScreen`) and the new Settings regroup — highest-risk *navigation* surfaces changed this window, and both are pure JSX reorganizations of already-complex screens with real underlying actions (approve/invite/billing/delete-account).
3. **Device-test the community/business auto-link fix and Business Dashboard tap targets** — both were live user-reported bugs; confirming the fixes actually resolved them for the real user who hit them is higher priority than further building.
4. **Decide on the deferred weather-forecast API integration** (option "a", real hourly data vs. current-conditions-only) — this has been carried as an open decision across two delta windows now without being explicitly closed either way (build it or drop it from scope).
5. **Verify the Business Partner Onboarding push notifications actually arrive** on a real device (both warm and cold-start tap) — this is a brand-new notification type this window with no end-to-end delivery confirmation yet.

Not recommended: another audit, more AI-feature building (blocked on billing), or new scalability work (untouched, unaffected this window).

---

## 8. DEVICE QA READINESS

**Yes, more urgent than the prior window** — this window shipped the single largest Settings rewrite yet, a brand-new screen (`Plans`), and a live-bug-fix batch, none device-verified.

Highest-risk flows to click through:
- **Home → Quick Pick chip → Gatherings (filtered) → "+ Start a {category} Gathering"** — new personalization + edit modal + tap-behavior change, all unverified.
- **Home → "See All Plans" → PlansScreen (Upcoming/Hosting/Past)** — brand new screen.
- **GatheringDetail → "Manage attendees →" → Gatherings/Hosting tab** — bug fix, confirm it lands correctly and doesn't get confused with PlansScreen's own Hosting tab.
- **CreateCommunity (as a business owner) → heads-up notice → CommunityDetail → info card instead of Follow** — real user-reported bug fix.
- **BusinessDashboard → tap a Gathering/Community row → lands on real Detail with host controls** — bug fix.
- **Settings, full click-through** — all 7 headers, confirm every underlying action (phone change, billing, delete account, language, dark mode) still works post-rewrite.
- **RequestBusinessPartner → category chips → filtered browse list** — new UI.
- **Business Partner apply → approve/deny → push notification → tap → lands on BusinessDashboard/MyBusinessApplication** — new notification type, cold-start and warm.
- **Do NOT bother testing any AI feature end-to-end right now** — confirmed broken at the account level, unrelated to app code; testing would just reconfirm the billing failure.

---

## 9. FINAL EXECUTIVE SUMMARY

### What materially improved
The largest coherent IA restructure yet (7-phase "round 3": a real Plans screen with Upcoming/Hosting/Past, Activity reorganized into Needs Attention/Today/Earlier, a chat-vs-gathering naming fix, and a full Settings regroup into 6 named sections) landed in full, plus Home's Quick Picks became genuinely personalized and editable. Business Partner Onboarding is now a complete self-serve loop (apply → status visibility → push notifications → admin review with richer context), and business categorization/browsing was built from schema up.

### What materially changed
The building process itself shifted from audit-driven to **live-usage-bug-driven** — 4 of the 5 fixes in the newest commit came from the user actually using the app and hitting real bugs (manage-attendees routing, business browse list, community/business auto-link confusion, Business Dashboard dead tap targets), not from re-scanning code.

### What got worse / became more confusing
Nothing regressed in code. But a real production issue was surfaced: **every AI feature in the app is confirmed broken** (Anthropic billing exhausted) — this was previously an unknown/unverified state and is now a known negative. Two label overlaps ("Hosting" tab on two screens with different capabilities; "Business" header on two screens with two different personas) were introduced as side effects of the restructure — both deliberate and disclosed, but worth a specific look.

### What is still missing
Zero manual device/simulator testing has ever been performed for any flow in this app's history — this window adds the largest batch yet of untested surface area (new Plans screen, rewritten Settings, new Quick Picks modal, new business category chips). Stripe/payment processor, AI cover photos, true skip-location in Create, and the 3 large-file refactors remain untouched, same as the prior window.

### Top 5 next actions
1. Resolve Anthropic billing (external, not code).
2. Device-test the Hosting-tab overlap and Settings regroup.
3. Device-test the 4 live-bug fixes against the users who actually reported them.
4. Decide (don't silently carry forward again) on the weather-forecast API question.
5. Verify Business Partner push notifications actually deliver, warm and cold-start.

### Updated scorecard
No numeric baseline in repo. Directional: **UP** — Navigation/IA, Business Product, Settings, Home, Communities, Gatherings, Notifications, Database/Backend. **DOWN** — AI, Launch Readiness (both due to the confirmed billing outage, not a code regression). **HOLD** — everything else, including Device Readiness in absolute terms (risk is trending down in relative terms as untested surface area grows).

### Should we build, polish, or device-test next?
**Device-test.** Two consecutive windows have now shipped substantial, unverified IA/screen changes on top of each other (scalability rewrite → this restructure). The AI billing issue also removes the option of "build more AI features" as productive next work until it's resolved externally. Device QA is now the highest-leverage next step, not another build pass.
