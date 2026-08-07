# Nearby — Project Context for Claude Code

Nearby is a proximity-based dating/social discovery app (React Native/Expo/Supabase).
This file captures known outstanding work as of early August 2026, so a fresh Claude Code
session has the same context as the chat session that built most of this.

## Outstanding: Billing / Monetization (contract + invoice generation + scheduling now live, Stripe still not started)

The brand-matching business model (businesses offer targeted, quantity-limited discounts;
redemptions are tracked; a "spread"/commission is the intended revenue model) now has real
per-partner billing math running end-to-end on a schedule, but no money actually moves yet:

- The WHEN design decision is resolved: billing is monthly/batched, not per-redemption
  real-time. `supabase/migrations/20260806_partner_contracts_billing.sql` adds
  `partner_contracts` (per-partner `billing_model`: per_redemption/flat_monthly/hybrid/custom,
  with rates, contract dates, `max_monthly_spend` cap, `auto_renew`) and
  `generate_monthly_invoices()`, a SECURITY DEFINER function. It locks that partner's unbilled
  `offer_redemptions` rows (`FOR UPDATE`, following the codebase's race-condition convention),
  sums them per the contract's billing model, writes a row to `business_invoices` (status
  `draft`), and stamps each redemption with `invoice_id` so it's never double-billed. `custom`
  contracts insert with `amount_due = 0` (not `null` — the column is `NOT NULL`) for finance
  to correct by hand while still in `draft`.
  **Applied to production** (`enmosvippabmuqslzrox`) and verified against the live schema —
  `business_invoices` already had matching `period_start`/`period_end`/`redemption_count`/
  `amount_due` columns from an earlier session.
- `20260806_schedule_monthly_invoices.sql` schedules it via `pg_cron` (already installed and
  in use for 8 other jobs, e.g. `send-match-reminders`) as job `generate-monthly-invoices`,
  `0 6 1 * *` (06:00 UTC on the 1st, billing the just-closed prior month, the function's
  default period). Runs as `postgres`, which owns the function, so the function's own
  `revoke all` (correctly there to stop client-side calls) doesn't block the cron invocation.
  **Also applied and verified live** (`cron.job` id 9).
- `getEstimatedAmountOwed()` in `src/services/brandOffers.js` now calls
  `get_partner_billing_estimate()` (same math as the invoice generator, run against the
  current open month) instead of the old flat $3/redemption placeholder. Returns
  `{ redemptionCount, estimatedAmount, billingModel, includedUnits, billableCount }`;
  `billingModel` is `null` when the partner has no active contract yet.
  `BusinessDashboardScreen.js` shows this in the insights tab, gated on `billingModel` being
  present and not `'custom'`, and calls out how many of the included allotment have been used.
- `partner_contracts.included_units` (added in `20260807_billing_included_units.sql`, default
  0) lets `per_redemption`/`hybrid` contracts include N free redemptions before the per-unit
  rate applies — e.g. "100 included, $0.75 each after" — instead of billing from redemption
  #1. Both billing functions compute `billable_count = greatest(count - included_units, 0)`
  and multiply that by `redemption_fee`, not the raw count. `flat_monthly`/`custom` ignore it.
- Fixed a real bug in both billing functions (`20260807_billing_contract_window_bound.sql`,
  applied and verified live): the redemption lookup was bounded only by the invoicing
  period, not by the contract's own `contract_start`/`contract_end`. A contract starting
  mid-month would have swept in — and permanently stamped `invoice_id` on — redemptions
  from before it existed; one ending mid-month would do the same for redemptions after it
  lapsed. Now both clip the window with `greatest(period_start, contract_start)` /
  `least(period_end, coalesce(contract_end, period_end))` before aggregating. Didn't show
  up in the Coastal Coffee verification below since that contract is open-ended and
  predates all its redemptions — re-verified $20.00/0-redemptions unaffected after the fix.
- One test contract exists: partner **Coastal Coffee** (`67dd3d6d-f36b-4b20-8a80-ac980baecc30`),
  contract `787d5b41-...`, `hybrid` billing, `$20/month` + `$1/redemption`, `included_units: 0`,
  open-ended, `auto_renew: true`. Verified end-to-end (simulating the real caller via
  `set_config('request.jwt.claims', ...)` since the Management API has no user session) —
  returns `$20.00` with 0 redemptions so far this month, as expected.
- No other `partner_contracts` rows exist, and there's deliberately no self-serve UI to
  create one (finance/ops decision, written via the SQL editor/service role or a future admin
  tool). Nothing will actually get invoiced for other partners until a contract is created by
  hand.
- Pricing philosophy note (from a strategy discussion, not yet decided as final policy):
  billing by raw redemption count is what's actually instrumented today; a "verified visits"
  metric (join gathering + GPS/check-in + dwell time or QR scan) was floated as a better
  long-term metric but requires building attendance/check-in verification that doesn't exist
  yet — treat that as a distinct future feature, not a pricing tweak.
- Still missing before this is real billing: no Stripe integration at all (no account
  connection, no webhook handler, no actual charging, no dispute/refund handling). Invoices
  will sit in `draft` with nothing downstream until that's built.
- A Supabase Management API access token lives in `.claude/mcp.json` (gitignored) — that's
  what made direct schema inspection and migration application against the live project
  possible from inside a Claude Code session; project ref is `enmosvippabmuqslzrox`
  (see `src/services/supabase.js`).

## Recently completed, for context (do not re-build)

- Home screen "dream redesign" gaps, closed against a user-supplied vision doc (checked
  feature-by-feature against actual code first — several items in the doc were already partly
  built under different names, e.g. "Continue Your Story" ≈ existing "Continue Your Community"):
  - **Happening Now**: `getHomeDashboard()` in `homeDashboard.js` now also returns
    `happeningNow` — gatherings from the same already-fetched `nearbyGatherings` list whose
    `scheduled_at` falls in [-30min, +2h] around now (no end-time field exists on gatherings,
    so "in progress" is approximated). Rendered as a horizontal chip row using
    `categoryStyleFor()` for icons, no extra query.
  - **Time-of-day quick actions**: `getQuickPrompts()` (already existed in `timeContext.js`,
    previously only surfaced one layer deep inside `StartSomethingModal`) is now also rendered
    directly on Home as a visible chip row under a period-aware header (`Good Morning` /
    `This Afternoon` / `Tonight` / `This Weekend`). Tapping a chip either deep-links straight to
    `CreateGathering` with a prefilled title/category, or — for the one prompt with sub-options
    (`Dinner` → Pizza/Mexican/etc.) — opens `StartSomethingModal` pre-set to that category via
    a new `initialCategory` prop, reusing the modal's existing decision tree instead of
    duplicating it. `StartSomethingModal`'s `SUB_OPTIONS` map is now exported so Home can check
    membership without hardcoding which labels have sub-menus.
  - **One AI sentence**: deliberately **not** a real LLM call — `getHomeInsight()` in
    `homeDashboard.js` is a pure, no-I/O function that picks one honest sentence from signals
    the dashboard already computed (friends making plans → best pick exists → good weather
    forecast → things happening now), in that priority order, returning `null` if none apply.
    This was an explicit tradeoff discussed with the user: no new Edge Function, no API key,
    no per-request cost, and it matches this file's existing "no invented numbers" convention
    (see `getHomeDashboard()`'s own comments on `bestPick`/`weeklyRecap`/`sinceAway`) rather than
    introducing a genuinely novel-but-untethered-from-reality text generator.
  - **"You have N opportunities" greeting line**: reuses the already-computed
    `gatheringsTodayCount`, not a new number — only shown when > 0, period-aware wording
    ("today" / "tonight" / "this weekend").
  - **Floating action button**: the "+ Start Something" button moved from an inline
    scroll-flow button to a real `position: 'absolute'` FAB pinned bottom-right over the
    ScrollView (matching the existing bottom-anchored-bar pattern already used in
    `DiscoveryScreen.js`), with extra `paddingBottom` added to the scroll content so the last
    card isn't hidden behind it.
  - Deliberately left alone: the "92% Match" hero-card framing and "unlocked because 8 members
    joined" perk copy from the original vision doc were **not** built — both would require
    fabricating numbers the codebase has no real signal for, which conflicts with the
    established convention throughout `homeDashboard.js` of never inventing a metric.
- Gathering detail redesign: three schema pieces (`20260807_gathering_detail_vibe_and_photo.sql`,
  `20260807_gathering_questions.sql`, `20260807_gathering_intents.sql`, all applied and
  verified live) plus full frontend wiring, built in one pass after a codespace restart
  interrupted the session partway through (schema files existed but were unapplied and
  completely unwired — this closed that gap):
  - `gatherings` gained `energy_level`/`conversation_level`/`group_size_feel` (1-5, nullable),
    `beginner_friendly` (default `true`), `timeline_steps` (jsonb array, max 8, `{time, label}`),
    and `cover_photo_path` (private `gathering-photos` storage bucket, host-only upload,
    `${gatheringId}/cover-*.jpg` path convention matching the `profile-photos`/`stories`
    RLS-by-folder pattern). Editable via `EditGatheringScreen.js` (1-5 tap-to-select scale
    pickers, a beginner-friendly `Switch`, an add/remove timeline step list, a cover photo
    picker reusing the `photos.js` base64-upload pattern — `fetch().blob()` silently produces
    0-byte files on iOS for local file URIs, so this stays on `FileSystem.readAsStringAsync`
    + a hand-rolled base64 decoder like the other upload paths). Displayed on gathering cards
    in `GatheringsScreen.js` (cover photo always shown when present; vibe/timeline behind a
    new "Details & questions" expand toggle on nearby cards, folded into the existing expand
    section on attending cards, always-visible on hosting cards).
  - `gathering_questions`: public Q&A, anyone can ask, only the host can answer (`GatheringQnA.js`,
    a shared component mounted with `isHost` toggled per tab — `nearby`/`attending` pass `false`,
    `hosting` passes `true` unconditionally since that list is already scoped to the caller's
    own gatherings). Both ask and answer run through `checkTextModeration` first, matching the
    rest of the codebase's text-input conventions.
  - `gathering_intents`: the private pre-join "what are you hoping for tonight?" signal —
    deliberately **never surfaced to the host**, not even in aggregate (no such RPC exists;
    don't add one without a separate explicit review, per the migration's own comment).
    `GatheringIntentModal.js` intercepts both "I'm Interested" entry points (the nearby-tab
    button and the map-view marker alert) before the existing `handleExpressInterest` fires,
    and pre-fills a user's previous answer via `getMyGatheringIntent` so re-opening it isn't
    a blank slate. Saving the intent never blocks joining — failures are swallowed with a
    console log, same as the existing post-gathering feedback modal's philosophy.
- Full security audit: RLS on every table, all Edge Functions, all storage buckets, 38+
  functions found with unintended PUBLIC/anon execute access (fixed), several race conditions
  in rate-limiting triggers fixed with `SELECT ... FOR UPDATE`.
- Navigation restructure: Profile → "You", Places (Google Places-powered), real Trending,
  Inbox split into Requests/Invitations/Reminders, two-step quick-create flow.
- Stories redesign: gathering-linked stories, differentiated expiry, host + fellow-attendee
  visibility on both the table and storage bucket RLS.
- Full onboarding redesign: landing screen, preference questions, immediate recommendations,
  post-gathering feedback loop, "first mission" + real scheduled follow-up reminder, earned
  profile stats.
- Brand-matching vision: quantity-limited offers (`redemption_limit`), interest targeting
  (`target_interest_tag`), location scoping (`brand_partners.latitude/longitude`, 50-mile
  radius via `get_nearby_offer_ids`), real shared-interest suggestions for both 1-on-1
  matches (`ChatScreen.js`) and group gatherings (`GatheringChatScreen.js`), scarcity count
  display, business-side redemption visibility.

## Known conventions in this codebase

- `trusted_update` pattern: privileged profile columns (is_premium, managed_partner_id,
  *_created_today/date counters, etc.) are protected by `prevent_self_premium_edit()` trigger;
  legitimate server-side writes must call
  `perform set_config('app.trusted_update', 'true', true)` first.
- Rate-limit triggers use `SELECT ... FOR UPDATE` on the profiles row to avoid race conditions.
- New Postgres functions default to PUBLIC execute access — always explicitly
  `revoke ... from public, anon` unless intentionally public.
- Direct SELECT on `offer_redemptions` is scoped to each user's own rows only (RLS) — always
  go through a SECURITY DEFINER RPC (e.g., `get_offer_redemption_counts`,
  `count_redemptions_since`) to get true aggregate counts.
