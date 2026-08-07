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
