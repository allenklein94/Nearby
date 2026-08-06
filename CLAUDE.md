# Nearby — Project Context for Claude Code

Nearby is a proximity-based dating/social discovery app (React Native/Expo/Supabase).
This file captures known outstanding work as of early August 2026, so a fresh Claude Code
session has the same context as the chat session that built most of this.

## Outstanding: Billing / Monetization (contract + invoice generation now built, Stripe still not started)

The brand-matching business model (businesses offer targeted, quantity-limited discounts;
redemptions are tracked; a "spread"/commission is the intended revenue model) now has real
per-partner billing math, but no money actually moves yet:

- The WHEN design decision is resolved: billing is monthly/batched, not per-redemption
  real-time. `supabase/migrations/20260806_partner_contracts_billing.sql` adds
  `partner_contracts` (per-partner `billing_model`: per_redemption/flat_monthly/hybrid/custom,
  with rates, contract dates, `max_monthly_spend` cap, `auto_renew`) and
  `generate_monthly_invoices()`, a SECURITY DEFINER function meant to be run manually or from
  a scheduled job once a month. It locks that partner's unbilled `offer_redemptions` rows
  (`FOR UPDATE`, following the codebase's race-condition convention), sums them per the
  contract's billing model, writes a row to `business_invoices` (status `draft`), and stamps
  each redemption with `invoice_id` so it's never double-billed. `custom` contracts insert
  with `amount_due = null` for finance to fill in by hand.
  **This migration is written but has NOT been applied to the live Supabase project yet** —
  no Supabase CLI/MCP connection was available in that session to run it. Apply it (and
  verify `business_invoices` actually has `period_start`/`period_end`/`redemption_count`/
  `amount_due` columns matching what the migration assumes — it only ALTERs that table, it
  doesn't CREATE it) before relying on any of this.
- `getEstimatedAmountOwed()` in `src/services/brandOffers.js` now calls
  `get_partner_billing_estimate()` (same math as the invoice generator, run against the
  current open month) instead of the old flat $3/redemption placeholder. Returns
  `{ redemptionCount, estimatedAmount, billingModel }`; `billingModel` is `null` when the
  partner has no active contract yet. `BusinessDashboardScreen.js` shows this in the insights
  tab, gated on `billingModel` being present and not `'custom'`.
- Still missing: no real Stripe integration (no account connection, no webhook handler, no
  actual charging, no dispute/refund handling), and no scheduled job actually invokes
  `generate_monthly_invoices()` yet (cron/pg_cron/Edge Function trigger still needed).
- Contracts have no insert/update/delete RLS policy by design — they're a finance/ops
  decision, written via the SQL editor (service role) or a future admin tool, not
  self-served by the business.

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
