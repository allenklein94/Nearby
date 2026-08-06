# Nearby — Project Context for Claude Code

Nearby is a proximity-based dating/social discovery app (React Native/Expo/Supabase).
This file captures known outstanding work as of early August 2026, so a fresh Claude Code
session has the same context as the chat session that built most of this.

## Outstanding: Billing / Monetization (genuinely not started)

The brand-matching business model (businesses offer targeted, quantity-limited discounts;
redemptions are tracked; a "spread"/commission is the intended revenue model) is fully built
EXCEPT for actual billing:

- `business_invoices` table exists (schema only — draft/sent/paid/failed/void status,
  stripe_invoice_id/stripe_payment_intent_id columns reserved for later). Nothing writes to
  it yet.
- `getEstimatedAmountOwed()` in `src/services/brandOffers.js` computes a PLACEHOLDER estimate
  (flat $3/redemption) for display only — not a real rate, not an actual charge.
- No real Stripe integration exists: no account connection, no webhook handler, no actual
  charging, no invoice generation, no dispute/refund handling.
- Open design decision, never resolved: WHEN does a charge actually happen — per redemption
  in real-time, or batched (e.g., monthly)? This needs deciding before implementation starts.
- Treat this as its own project needing dedicated planning, not something to fold into a
  quick feature request.

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
