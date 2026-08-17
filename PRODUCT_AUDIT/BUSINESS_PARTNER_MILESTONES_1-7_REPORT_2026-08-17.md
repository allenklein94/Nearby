# Business Partner Acquisition Experience — Milestones 1–7 Report

**Prepared:** 2026-08-17
**Purpose:** Handoff document for an independent AI review of everything built in this
initiative. Written to be self-contained — a reviewer should not need to read the full
`CLAUDE.md` history to assess this work, though every claim below traces back to it.
**Repo:** `Nearby` (React Native/Expo + Supabase dating/social-discovery app)
**Status at time of writing:** All 7 milestones DONE, build-wise. All 3 required adversarial
review passes DONE. One real bug found and fixed during review (not merely flagged).

---

## 1. What this initiative is

An external AI provided two documents in one message: (1) a strategic reflection on Nearby's
long-term differentiation ("local activity graph"), treated as read-only context, not a build
item; and (2) a concrete implementation brief for a **self-service Business Partner acquisition
and onboarding experience** — a landing page that explains Nearby to a business owner in ~5–10
seconds, funnels into search → confirm-a-match → complete profile → submit → admin review →
publish → first offer → dashboard, fully instrumented, using the app's real data model with no
mock data, reusing the app's existing design system.

The brief itself specified an audit-first, milestone-by-milestone build with a stop-and-verify
gate after each milestone, plus three adversarial review passes at the end. That structure is
what was actually followed.

## 2. Phase 0 audit — what was found before any code was written

A read-only audit of the current codebase, done specifically to check the brief's own
assumptions against reality rather than build on unverified claims. Ten findings, condensed:

1. **No web presence exists.** This is a mobile-only Expo app. `docs/index.html`/`privacy.html`/
   `terms.html`/`track.html` are a separate, unrelated static legal micro-site — no shared design
   system, no Expo involvement, no build step.
2. **No "claim an existing business" concept exists, and no external business data has ever been
   imported.** Every `brand_partners` row has always been created fresh at admin-approval time,
   simultaneously with setting the approving requester's own `profiles.managed_partner_id`. There
   is no "unclaimed business" state in this schema. **This was the single biggest reality gap
   between the brief and the app** — a product decision, not a wiring gap.
3. The existing business-search RPC (`getActivePartnersByName()`) only searches already-approved
   active partners, for the opposite use case (a host picking a business to sponsor a gathering)
   — not reusable for a claim-style flow.
4. **The business dashboard and analytics are already real and ~90% built.** 6 tabs, 12 real
   analytics RPCs already existed (`get_business_dashboard_stats`, `_growth`,
   `_member_gathering_history`, `_visit_frequency`, `_insights`, `_top_members`,
   `_follower_count`, `get_partner_avg_response_time`, `get_partner_offer_reputation`,
   `get_marketplace_reliability_rankings`, `get_aggregated_demand_for_partner`,
   `get_home_nudge_stats`). The brief's own Milestones 4/6/7 were mostly a "wire it up," not a
   from-scratch build.
5. Offers were already real, full CRUD.
6. **Deep linking was minimal** — one route only (`GatheringDetail`), no business link, no QR
   library anywhere in `package.json`.
7. The existing referral system was consumer-to-consumer only — no business-refers-business
   mechanism, confirming that part of the brief is aspirational.
8. This app already has an established analytics-funnel pattern (`intent_submissions`/
   `intent_outcomes`/`home_nudge_events` — plain owner-scoped tables, no RPC needed for writes,
   fire-and-forget client writes, one admin-gated rollup RPC) — the plan was to reuse this shape
   for the acquisition funnel rather than invent a new one.
9. `BusinessProfileScreen.js` (the existing consumer-facing profile) was identified as the real
   reference for "what a business looks like once live" — any landing-page mockup should match
   it, not invent a new design.
10. `src/theme.js` (colors/typography/spacing/radius/shadow + `useTheme()`) is the one
    universally consistent design convention in the codebase (80+ screens import it) —
    reusable directly for the web landing page's CSS.

## 3. Three decisions locked before building (given directly by the product owner)

These are restated here because they shape every milestone below and should not be
re-litigated by a reviewer as if they were the AI's own choices:

- **Decision 1 — Hybrid web+app.** A real, separate, informational-only web landing page (no
  auth, no forms that duplicate the app's own logic) whose only job is to explain the product and
  funnel via deep link into the already-installed app, or prompt install if not installed. The
  claim/apply logic lives in exactly one place — the mobile app.
- **Decision 2 — Streamline the existing apply flow, never call it "claim."** There is no
  pre-existing unclaimed-business directory, so using "claim" language would be dishonest.
  Primary CTA: **"Get Your Business on Nearby"**, not "Claim Your Business." A genuine
  confirm-a-match moment ("Is this your business?") is allowed at exactly one point: right after
  a real Google Places search returns a real result the owner selects. Timing copy: **"Get
  started in about 30 seconds"** (true — the application takes ~30s) with an explicit post-submit
  line that review is manual, framed as a credibility signal, not an apology. Architecturally,
  the Places search/select/prefill step must be built as a separable seam so a future genuine
  claim-workflow (with imported candidate data) could be layered on later without a rewrite — but
  that future version is explicitly **not** being built now.
- **Decision 3 — This overrides the standing feature freeze for this scope only**, per the
  freeze's own stated exception for a direct, explicit user request.

## 4. Milestone-by-milestone summary

### Milestone 1 — Funnel event table (`business_acquisition_events`)
Plain no-RPC-write table, same shape as the existing `intent_submissions` pattern. 14 named
funnel steps in a CHECK constraint. `anon`+`authenticated` can `INSERT` only (no `SELECT` grant
to either — deny by default). `WITH CHECK` enforces `(auth.uid() is null and user_id is null) or
auth.uid() = user_id`. New admin-only `get_business_acquisition_funnel_stats()` RPC.

**Verified live against production**, including a genuine mistake caught mid-verification: the
first RLS-verification pass used a technique (`asUser()`, session-JWT-claim only) that silently
runs as the Management API's table-owner connection and bypasses RLS entirely — caught when a
deliberate cross-user spoof attempt *succeeded* when it should have failed. Re-ran every
authenticated-side check under genuine `SET ROLE authenticated` instead. Also verified via a
full from-scratch migration replay (55 files, exit 0).

### Milestone 2 — Streamlined apply flow
New "Find your business" step using real Google Places **Text Search** (a genuinely different
endpoint from the Nearby Search used elsewhere in the app) ahead of the existing apply form.
Selecting a result auto-fills name/address, then enriches with phone/website/category via a
separate Place Details call. Every field stays editable — nothing auto-submits. Copy matches
Decision 2 exactly ("Get Your Business on Nearby" / "Get started in about 30 seconds" /
post-submit "reviewed before going live" line). New `businessAcquisitionEvents.js` fires 4
client-side funnel steps; the two review-outcome steps (`apply_approved`/`apply_denied`) are
fired server-side inside the existing admin approve/deny RPCs instead, since an applicant never
calls those RPCs themselves.

**Verified live against production** with two real disposable requests run through real
approve/deny branches. Verified via `npx expo export --platform ios` (clean).

### Milestone 3 — Deep link + QR code
`nearby://business/:partnerId` — deliberately **not** added to the static
`linking.config.screens` table, because routing depends on whether the opener is the business's
own owner (→ Dashboard) or anyone else (→ public Profile), which a static path→screen map can't
express. Reused the existing stash-then-consume pattern already built for a different deep link
(cold-start case), plus a new dedicated warm-tap listener to close a gap that pattern didn't
originally need to handle. Added `react-native-svg` + `react-native-qrcode-svg` (previously
absent from the app) via `expo install` for correct SDK-version resolution. New "Share Your QR
Code" surface on the dashboard.

**Verified via a clean `npx expo export --platform ios`** (2186 modules, +311 from the new
dependency tree). No schema change, so no live-production verification needed for this milestone.

### Milestone 4 — Dashboard/analytics polish (discovery source tracking)
Re-audited the dashboard rather than assuming Phase 0's findings still held — confirmed real. The
one genuine gap: no business could tell *how* a consumer found their profile. New
`business_profile_views` table (`authenticated`-insert-only, no `anon` path — a profile view only
ever happens from inside the authenticated app), `source` CHECK constrained to exactly `deep_link`
vs `in_app` (an honest, coarse two-bucket signal — the two channels genuinely can't be
distinguished further with the data available). Owner-gated `get_business_discovery_stats()` RPC
follows the established "return zeroed stats for non-owner" convention already used by sibling
RPCs, not the admin-funnel RPCs' "raise" convention. New "How People Find You" card on the
dashboard's Insights tab.

**Verified live against production** under genuine `SET ROLE authenticated` (not the
table-owner-bypass technique) — real owner call returned hand-checked-exact numbers; a genuine
non-owner call returned zeros, not a leak. Verified via a from-scratch migration replay (57
files, exit 0) and a clean `npx expo export`.

### Milestone 5 — The web landing surface itself
New `docs/business.html` — static, dependency-free HTML/CSS/JS, matching the existing
`docs/privacy.html`/`terms.html` convention (this repo's only prior static surface, confirmed
already served via GitHub Pages by existing hardcoded URLs elsewhere in the app, not a guessed
hosting location). All six sections per Decision 1: hero, value props (every claim traceable to
something the app actually does), demo (a phone-frame mockup reusing `BusinessProfileScreen.js`'s
real section shapes with clearly-labeled generic placeholder text, captioned as a preview, not
presented as real data), pricing ("Free to start," itemized real capabilities, honest note that
billing is never auto-charged — matches the real `partner_contracts` model, which requires a
manually-created contract), how-it-works (matches Milestone 2's real flow, including the
"reviewed before going live" honesty line), FAQ. Theme values were translated directly from
`theme.js` into CSS custom properties, including a real `prefers-color-scheme: dark` block.

New `nearby://business-apply` deep link — this one *does* fit the static `linking.config.screens`
table (no ownership branch needed), verified by calling React Navigation's own
`getStateFromPath()` directly against the real config object.

Funnel logging from the page itself posts directly to the PostgREST endpoint using the same
public/publishable key already compiled into the mobile app bundle (not a new exposure).
**Verified live against production** via the actual REST endpoint with the actual page's payload
shape: a real `landing_viewed` POST succeeded (201), a bogus event value was rejected (400,
CHECK constraint), a `SELECT` attempt with the same anon key was denied (401) — matching the
migration's deny-by-default posture.

**One disclosed gap in the CTA fallback**: the brief calls for falling back to an "install link"
when the app isn't installed. This app has never been published to the App Store or Google
Play — there is no real store URL to link to, and inventing one would be exactly the kind of
fabricated external link this codebase's own conventions reject. Built instead: a
`visibilitychange`-based heuristic (attempt the deep link; if the page is still visible ~1.5s
later, show a plain instructional fallback message with no embedded link). Revisit once a real
store listing exists.

### Milestone 6 — End-to-end verification
While preparing this, found 5 of the 11 named funnel steps (`profile_completed`/`published`/
`first_offer_created`/`first_consumer_interaction`/`dashboard_viewed`) were defined in the CHECK
constraint and already read by the admin rollup RPC, but **never actually fired anywhere** —
Milestones 2–5 only needed the earlier steps. Closing this was treated as a real prerequisite for
an honest end-to-end run, not scope creep.

- **`published`** — fired inside the existing admin-approval RPC, at the same moment
  `apply_approved` already fires (there's no separate "publish" step in this app's real flow —
  approval *is* going live).
- **`first_consumer_interaction`** — built as a server-side `AFTER INSERT` trigger on
  `business_profile_views` (deliberately server-side, since a consumer has no honest way to know
  whether their own view is genuinely the business's first). Verified live to fire exactly once
  per partner, not once per view.
- **`profile_completed`/`first_offer_created`/`dashboard_viewed`** — wired into dashboard client
  code, each fired at the real corresponding action. `first_offer_created` is guarded by checking
  `offers.length === 0` against the *already-loaded* list before the insert (an honest
  first-offer signal, not a post-insert re-derivation that could double-count under a race).
  **Disclosed as not yet independently live-verified with a real click-through** — this is pure
  client-side React state, which this sandbox can't exercise via direct SQL the way the two
  schema/RPC-level pieces above were.

New permanent, re-runnable script `scripts/live-verify/business-acquisition-funnel-e2e.js` (not a
one-off manual session) runs one real disposable test business through every step in order,
including a real admin approve, a real profile save, a real first offer, a real consumer's first
view (proving the trigger fires exactly once and a second viewer does not re-fire it), then
confirms every count via the admin funnel RPC and the owner's discovery-stats RPC, and confirms a
genuine non-owner gets zeroed stats. All test rows deleted; the script's own final assertion
confirms the table returns to its exact real 2-row pre-existing baseline (genuine anonymous
traffic from the live `docs/business.html` page, not test residue — identified as real by having
no test marker and a plausible recent timestamp, not assumed away).

**One real, disclosed-but-not-fixed RPC gap found while writing this script**: 
`get_business_acquisition_funnel_stats()` rolls up 12 of the 14 real CHECK-constraint event
values but never reads `profile_completed` or `dashboard_viewed` at all — confirmed by asserting
the keys are genuinely absent from the returned JSON, not just falsy. Flagged for a future pass,
not fixed in this one (out of this script's own scope).

**The from-scratch Docker migration replay could not be completed in this sandbox this
session** — three separate invocation attempts all failed identically on a genuine environment
issue (the test image's own bootstrap-phase Postgres instance only binds a Unix socket in this
specific environment, never a TCP listener, before the init script tries to connect over TCP and
is refused) — a different failure mode than any previously-documented workaround in this repo's
history. Disclosed as a real, environment-specific gap, not silently skipped. All schema changes
across Milestones 6–7 were still verified live against production with real disposable data,
meeting this repo's baseline verification bar — only the from-scratch-replay bar was not met for
these two specific migrations.

### Milestone 7 — Three adversarial review passes

**Pass 1 — hostile first-time business-owner comprehension pass.** Read `docs/business.html` as
a skeptical first-time visitor with 60 seconds and no context. Most of the page held up (concrete
value prop, honest "reviewed before going live" framing, honest demo-mockup labeling, FAQ
answering the real objections a skeptic would raise). **One real gap found and fixed**: the word
"app" never appeared anywhere in visible page copy — only inside a `hidden` fallback message that
only shows if the deep link fails. A skeptic skimming only the hero had no way to know the
primary CTA would attempt to launch a mobile app rather than open an on-page signup form. Fixed
with one added sentence at the top of the hero's lead paragraph, stating that fact plainly.

**Pass 2 — consumer-side connectivity trace, found and fixed the most significant bug in the
whole initiative.** Asked directly: does an approved business's location genuinely show up
correctly end-to-end, not just "does the screen render." Tracing the real data path found that:
- A real Google Places search result already carries real `latitude`/`longitude`, but the apply
  screen never captured them into state, and `business_partner_requests` had no columns to store
  them even if it had.
- Worse: the admin-approval RPC never copied even the real **address text** field across — only
  `name`/`description`/`category` ever crossed from the request row onto the new `brand_partners`
  row.
- **Net effect: every business approved through the built "streamlined" apply flow landed
  completely unlocated** — no address on its public profile, absent from the map layer, and —
  the most serious consequence — structurally invisible to the entire Business Fulfillment
  marketplace (which is radius/distance-based over `brand_partners.latitude`/`longitude`) —
  until the owner manually re-entered the exact same address a second time via the dashboard's
  edit-profile flow.

This is exactly the class of gap the review pass exists to catch, not a hypothetical
constructed to have something to report.

**Fixed**: `business_partner_requests` gained nullable `latitude`/`longitude` columns; the
admin-approval RPC (re-pulled fresh from its live body first, confirmed byte-identical to the
prior commit before editing, so only the intended lines changed) now carries address and
coordinates across at approval time. The apply screen now captures real coordinates from a
Places match. A related follow-on case was closed in the same pass: editing the address text
after a Places match already populated it now clears the stored coordinates, rather than
silently submitting stale coordinates attached to different text — matching an existing,
established precedent elsewhere in this codebase for exactly this situation. The manual-entry
path (no Places result at all) still submits null coordinates honestly — no fabricated geocoding
was added.

**Verified live against production**: a real disposable request with a real address and
coordinates landed correctly after approval; a second real disposable request with no address at
all correctly produced nulls, not an error or a fabricated default. Both cleaned up. Verified via
a clean `npx expo export --platform ios`.

**Pass 3 — security pass, unauthorized apply/edit/publish access.** New permanent script
`scripts/live-verify/business-acquisition-unauthorized-access.js`. A real uninvolved attacker
profile attempted: spoofing another `requester_id` on a new request (rejected by RLS); editing a
business it doesn't manage (rejected, target business confirmed genuinely untouched afterward);
inserting an offer for someone else's business (rejected by RLS); self-approving its own pending
application (rejected — admin-only); a different non-admin/non-applicant also failing to approve
it (rejected the same way); denying it (rejected — request confirmed still genuinely pending
afterward, not silently resolved by any rejected attempt); reading another business's private CRM
notes directly (zero rows, not a partial leak); spoofing another user's identity on both new
event-logging tables (`business_profile_views.viewer_id`, `business_acquisition_events.user_id`
— both rejected by their real `WITH CHECK` clauses); and pulling another business's real
discovery/funnel stats (the owner-gated RPC returns real zeroed stats for a non-owner, the
admin-only RPC flatly rejects a non-admin). The real owner's own equivalent legitimate edit was
proven to still succeed in the same run — a fix that rejects everyone isn't a real fix, and this
script proves the legitimate path stayed open.

**A real mistake was made and caught by the script itself while writing it, disclosed rather
than covered up**: the first draft only captured `name`/`description` before running the attacks
and only restored those two fields afterward — the "restore to exact pre-test state" step
silently wiped the real business's own `category` field to `null` in the process. Caught
immediately by the script's own final "back to exact pre-test state" assertion failing. Fixed by
hand (restored the real value via the real update RPC as the real owner) and then fixed in the
script itself — every editable field is now captured and compared, not a subset — so the same
mistake cannot recur on a future run. Re-run clean afterward: the real business row is confirmed
byte-for-byte back to its exact pre-test state.

## 5. What was and wasn't independently verified — read this before trusting any "done" claim

**Verified live against production with real disposable test data, cleaned up afterward** (the
repo's own established bar): every schema/RLS/RPC change across all 7 milestones.

**Verified via permanent, re-runnable scripts** (not one-off manual sessions):
`scripts/live-verify/business-acquisition-funnel-e2e.js` and
`scripts/live-verify/business-acquisition-unauthorized-access.js`, both registered in the
existing `run-all.js` suite and documented in its README.

**Verified via a clean `npx expo export --platform ios`** after every client-side change across
all 7 milestones (no bundling errors at any point).

**NOT verified — disclosed gaps, not silently omitted:**
- **No manual simulator/device run-through of any of it, anywhere in this initiative** — the
  apply flow, the deep link/QR surface, the discovery-analytics card, the dashboard's
  funnel-event wiring, or the Pass-1 hero-copy edit. This is a standing, repeatedly-disclosed
  limitation of every build session on this app to date, not specific to this initiative.
- The from-scratch Docker migration replay for the two migrations introduced in Milestones 6–7,
  due to a genuine, newly-encountered sandbox environment failure (documented above).
- `profile_completed`/`first_offer_created`/`dashboard_viewed` firing correctly on a real device
  click-through (client-side React state only — reviewed against the exact call sites, matches
  the already-verified pattern, but not independently proven the way the trigger-based and
  RPC-level pieces were).
- The docs/business.html page's actual rendering on a real deployed GitHub Pages URL (verified
  via HTML well-formedness parsing and a Node syntax check on its inline script, and via direct
  `curl` against the real REST endpoint with the real payload shape — not via an actual browser
  page load).

## 6. Known, disclosed open items (not fixed, not hidden)

1. `get_business_acquisition_funnel_stats()` never reads `profile_completed`/`dashboard_viewed` —
   found in Milestone 6, not fixed.
2. The web landing page's app-not-installed fallback has no real install link, because this app
   has never been published to the App Store or Google Play — a deliberate honesty choice over
   fabricating a store URL, revisit once a real listing exists.
3. No manual device pass, across the whole initiative (see §5).
4. The two Milestone 6/7 migrations were not run through the from-scratch replay bar this repo
   otherwise holds schema changes to, due to a genuine sandbox limitation.

## 7. Suggested focus areas for the reviewing AI

- Independently assess whether the Milestone 7 location-bug fix (§4, Milestone 7 Pass 2) is
  actually complete — check the admin-approval RPC's full body and the apply screen's coordinate-
  capture/-clearing logic directly, not just this summary.
- Check whether the `deny_business_partner_request`/`approve_business_partner_request` RPCs'
  double-review guards and the new coordinate-carrying logic interact correctly under concurrency
  (this initiative did not add a new concurrency proof for these specific RPCs beyond what
  already existed).
- Sanity-check the `docs/business.html` funnel-logging exposure of the public anon key — confirm
  it matches this app's existing pattern elsewhere and isn't a new exposure class.
- Flag anything in §6 that should be escalated to "must fix before considered done" rather than
  "disclosed and deferred."
