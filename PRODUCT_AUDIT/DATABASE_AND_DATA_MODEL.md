# Database & Data Model — Nearby

*Basis: direct read of `supabase/schema.sql` (the only full-schema file in the repo) and all
28 files in `supabase/migrations/`; a repo-wide grep of every `.from('table')` / `.rpc('fn')`
call in `src/`; targeted reads of `.select()` field lists in the busiest service files
(`gatherings.js`, `communities.js`, `friends.js`, `brandOffers.js`, `businessPartnerships.js`).
Where a table's precise column list could not be confirmed from a local file, this is stated
explicitly rather than guessed — see "A critical, verified gap" below.*

## A critical, verified gap: most of the schema does not exist in this repo

Grepping all 28 local migrations for `create table` finds exactly **8** tables:
`partner_contracts`, `friend_circles`, `friend_circle_members`, `gathering_questions`,
`business_partnership_requests`, `social_invites`, `emergency_contacts`, `gathering_intents`.
`schema.sql` itself defines 8 more (`profiles`, `presence_reports`, `sightings`, `notices`,
`matches`, `messages`, `blocks`, `reports`).

That's 16 tables with a real local source of truth. The `.from()` grep across `src/` finds
**~53 distinct tables actually queried by the app**, including foundational ones —
`gatherings`, `communities`, `community_members`, `gathering_interest`, `brand_partners`,
`brand_offers`, `offer_redemptions`, `friendships`, `business_invoices`, `business_followers`,
`business_messages`, `stories`, `memory_vault_items`, and every relationship-longevity table
(`chemistry_diary_entries`, `goodbye_archive_entries`, etc.) — **none of which have a `create
table` statement anywhere in this git repository.** They exist only in the live production
database (project ref `enmosvippabmuqslzrox`, per `src/services/supabase.js` and the in-repo
`CLAUDE.md`), created directly via the SQL editor or the Management API at some point before
this repo's own migration history begins (the oldest local migration is dated 2026-08-06).

This mirrors a pattern the repo's own `CLAUDE.md` already documents for Edge Functions (local
`supabase/functions/*/index.ts` files are empty stubs; real code only exists deployed) — but
it is more serious for the schema, because **there is no way to reconstruct this app's actual
data model from source control**, stand up a fresh dev/staging database from git, or code-review
past schema decisions for the majority of tables. Every finding below about a table not covered
by a local migration is therefore based on (a) how the app's own service/screen code queries and
writes to it, and (b) the in-repo `CLAUDE.md`'s session notes, which describe several of these
tables' columns and constraints in detail as things that were directly, live-verified against
production during past sessions — treated here as reliable secondhand evidence, not as a
substitute for the actual `CREATE TABLE` statement. Flagged explicitly per-table below.

## Core identity & connection tables (full schema known — `schema.sql`)

- **`profiles`** — `id` (=`auth.users.id`), `display_name`, `bio`, `birthdate` (18+ enforced by
  a check constraint), `photo_url`, `photo_verified`, `is_premium`, `expo_push_token`,
  `is_admin`. Per `CLAUDE.md`, in production this row has grown many more columns not in this
  file (`managed_partner_id`, `ai_uses_today`, `bonus_notices`, `interests`, `birth date` etc.)
  — **not verifiable locally**; the base file only has the 9 columns above.
  RLS: a user always sees their own row; other rows are visible only once `photo_verified =
  true` (unmoderated photos never enter discovery). No lat/lng column exists on this table —
  confirmed structurally important elsewhere in the app (no per-person map layer is possible).
- **`presence_reports`** — one row per user (`user_id` is the PK, i.e. upserted not appended),
  a coarse `area` bucket, `reported_at`. No client RLS policy at all — only the service role
  (an Edge Function) can touch it. This is the mechanism that makes "no exact GPS to any
  client" a schema-level guarantee, not just an app convention.
- **`sightings`** — coarse "crossed paths" events between two users, `approx_area` (never exact
  coords), 48-hour `expires_at`. RLS scopes SELECT to either participant, and (via a later
  policy rewrite) excludes any pair where either has blocked the other.
- **`notices`** — one-directional "I'm interested" signal (`from_user`→`to_user`). RLS is the
  most structurally interesting policy in the base schema: you always see notices you sent, but
  only see a notice sent *to* you if it's already mutual (both sides sent one) **or** you're
  premium — i.e. premium's "see who noticed you" feature is enforced by RLS, not a client
  check.
- **`matches`** — created automatically by a trigger (`check_mutual_notice`) the instant a
  notice becomes mutual (`least`/`greatest` on the two user ids as a de-dupe key,
  `on conflict do nothing`). Per `CLAUDE.md`, in production `matches` also gained a
  `source_gathering_id` column (nullable, used by gathering-based matching) — not in this file.
- **`messages`** — scoped to `match_id`; RLS requires the sender be a real participant in that
  match and that neither side has blocked the other.
- **`blocks`** — one-directional, `blocker_id`/`blocked_id`. Its own SELECT policy is
  deliberately `auth.uid() = blocker_id` only (the blocked party can never see they were
  blocked) — which is exactly the RLS shape that produced this session's most serious
  historical bug (see `is_blocked()` below).
- **`reports`** — user-submitted reports, admin-only broader visibility via `profiles.is_admin`.

### `is_blocked(user_1, user_2)` — worth calling out specifically

A plain SQL helper function referenced by ~10 RLS policies (`matches`, `messages` ×2, `notices`
×2, `sightings`, `shared_playlist_items` ×2, `business_messages` ×2). Per `CLAUDE.md`, this
function was originally **not** `SECURITY DEFINER`, so it ran under the *calling* role's RLS
when reading `blocks` — and since `blocks`' own SELECT policy only lets the blocker see the row,
a **blocked user could still see and message the person who blocked them**, because from the
blocked party's own session the block row didn't appear to exist. This was fixed (made
`SECURITY DEFINER` with an internal `auth.uid()` participant guard) per that session's notes,
but the underlying pattern — a SECURITY-DEFINER-shaped need on a plain SQL function referenced
by many policies — is worth an auditor's own re-verification rather than taking on faith; this
audit did not independently re-run that live test.

## Gatherings (schema only known via `SAFE_GATHERING_FIELDS` in `gatherings.js` + migrations)

Confirmed columns (from the service layer's own field-selection constant plus the 2 local
migrations that `alter table gatherings`):
`id, host_id, title, description, interest_tag, scheduled_at, area, wide_area, precise_lat,
precise_lng, is_public, show_on_map, women_only, hosting_partner_id, recurrence_rule,
energy_level, conversation_level, group_size_feel, beginner_friendly, timeline_steps,
cover_photo_path, visibility, community_id, capacity`.

- `area`/`wide_area` are fuzzed location buckets computed client-side at creation
  (`localArea()`/`wideArea()`); `precise_lat`/`precise_lng` are the real coordinates, never
  sent to the client except via a narrow `get_gathering_meetup_point()` RPC scoped to the host
  + approved attendees.
  `visibility` (`everyone`/`friends`/`community`/`invite_only`) is a **discovery-scope** axis;
  `is_public` is a separate **auto-join-vs-approval** axis — genuinely two different concerns
  that were conflated into one boolean before this migration, per `CLAUDE.md`.
- `capacity` (nullable int, `check > 0`) governs a real waitlist queue via the `gathering_interest`
  table (see below) — `null` means unlimited, preserving all pre-existing rows' behavior.
- **RLS is deliberately wide open** (`"Anyone can view gatherings" using (true)`, per
  `CLAUDE.md`, not independently re-confirmed in this pass) — privacy for
  `friends`/`community`/`invite_only` visibility is enforced entirely client-side, in the query
  functions that decide what to *fetch*, not in the database. This is a repeated, explicit
  design choice across this schema (see `PRODUCT_RISKS.md`), not an oversight, but it means a
  direct/scripted Supabase client call bypasses all of it.

### `gathering_interest` (join table — schema not local, inferred from grep + `CLAUDE.md`)

Referenced constantly (`.from('gathering_interest')` in `gatherings.js` and elsewhere). Known
columns, from service code and RPC names: `gathering_id`, `user_id`, `status` (`'pending' |
'approved' | 'waitlisted' | 'declined'`, per `join_gathering`/`leave_gathering`/
`approve_gathering_interest` RPC behavior described in `CLAUDE.md`), `match_id`,
`on_my_way_at`, `checked_in_at`, `created_at`. The three RPCs that mutate it
(`join_gathering`, `approve_gathering_interest`, `leave_gathering`) all lock the parent
`gatherings` row `for update` first — the one place in this schema where a real concurrency
control is used, because capacity is a genuine scarce resource (unlike the rest of this app's
privacy gates, which are explicitly "RLS wide open, client is the real gate").

## Communities

Confirmed columns (from `communities.js` `.select()` calls): `id, name, description,
interest_tag, is_public, cover_photo_url, creator_id, hosting_partner_id`. `community_members`
has `community_id, user_id, role (creator|leader|member), joined_at`. No location field exists
on `communities` at all — confirmed structurally (this audit independently re-confirmed via the
same grep the in-repo history used) — communities are topic-based, not place-based, by design.

**A real, previously-shipped bug worth an auditor's attention**: per `CLAUDE.md`,
`community_members`'s SELECT RLS policy and `communities`'s SELECT RLS policy were mutually
recursive (each depended on evaluating the other's RLS-protected read), which made the single
simplest possible query against `community_members` — exactly what listing "my communities"
runs — fail with a Postgres infinite-recursion error, for every real user, for an unknown
period of time before it was caught (it wasn't caught by prior "verified live" passes because
those ran as `postgres`/service-role, which bypasses RLS entirely). This audit did not
independently re-run that query against production to confirm the fix holds; flagged as worth
re-checking given the severity and how it was originally missed.

## Businesses / commerce layer

- **`brand_partners`** — `id, name, logo_url, description, address, latitude, longitude,
  active`. RLS: any active partner's row (including real coordinates) is fully public — the
  same "legitimate public business" justification used for the map layer.
- **`brand_offers`** — `id, partner_id, title, description, redemption_limit,
  target_interest_tag, gathering_id (nullable — ties an offer to a specific gathering), active,
  unlock_scope ('community'|'gathering'|null), unlock_community_id, unlock_min_members`. The
  three `unlock_*` columns were added later (per `CLAUDE.md`) with a check constraint keeping
  them internally consistent.
- **`offer_redemptions`** — per-user redemption ledger; RLS scopes SELECT to the caller's own
  rows only, so every aggregate count anywhere in the app **must** go through a SECURITY
  DEFINER RPC (`get_offer_redemption_counts`, `count_redemptions_since`,
  `get_partner_billing_estimate`, etc.) — a real, consistently-followed convention, per
  `CLAUDE.md`'s own "known conventions" note, not independently re-audited row-by-row in this
  pass.
- **`partner_contracts`** (schema known in full — local migration) — `partner_id,
  billing_model (per_redemption|flat_monthly|hybrid|custom), monthly_fee, redemption_fee,
  contract_start, contract_end, max_monthly_spend, auto_renew, status, included_units`. A check
  constraint enforces the right fee fields are present per `billing_model`.
- **`business_invoices`** — `partner_id, period_start, period_end, redemption_count,
  amount_due, status` (starts `'draft'`). Written only by `generate_monthly_invoices()`, run on
  a `pg_cron` schedule (`0 6 1 * *`, per `CLAUDE.md`) — **no downstream payment processor
  exists**; invoices sit in `draft` indefinitely today.
- **`business_partnership_requests`** (schema known — local migration) — polymorphic
  `target_type ('gathering'|'community')` + `target_id`, `partner_id`, `message`, `status
  ('pending'|'approved'|'declined')`, `reviewed_at`. Same polymorphic-target shape as
  `social_invites` below.
- **`business_followers`**, **`business_messages`**, **`business_updates`** — follow/DM/
  broadcast tables for the business-consumer relationship; schema not local, columns inferred
  from `brandOffers.js` selects (`business_messages` has `sender_id, from_business, body,
  created_at, conversation_with_id`).

## Social graph & invites

- **`friendships`** — `id, user_a, user_b, requested_by`, plus a `status` used to distinguish
  pending vs. accepted (inferred from `friends.js` query patterns, e.g. filtering by status in
  separate functions for "my friends" vs. "pending requests" — not independently confirmed at
  the exact status-string level in this pass).
- **`social_invites`** (schema known — local migration) — polymorphic `invite_type
  ('gathering'|'community')` + `target_id`, `inviter_id`, `invitee_id`, `status`. Deliberately
  friends-only to send (same "no stranger-surfacing" posture as Discover excluding People
  search), enforced inside the `send_social_invite`/`respond_to_social_invite` RPCs rather than
  RLS (no direct client INSERT/UPDATE policy exists on this table, per `CLAUDE.md`).
- **`friend_circles`** / **`friend_circle_members`** (schema known — local migration) — a
  personal-label join table over a user's own friend list (Work/Fitness/Family-style tagging);
  `friend_user_id` is intentionally not FK-constrained to an actual friendship row.

## Relationship-longevity tables (schema not local at all; existence confirmed by grep only)

`chemistry_diary_entries`, `goodbye_archive_entries`, `relationship_legacy_entries`,
`constitution_entries`, `stress_test_notes`, `shared_decisions`, `shared_playlist_items`,
`timeline_notes`, `trip_ideas`, `memory_vault_items`. These power the large relationship-tooling
surface described in `PRODUCT_OVERVIEW.md`. **This audit could not confirm their column-level
schema, foreign keys, or RLS from any local file** — no migration creates any of them, and this
pass did not have time to reverse-engineer all nine from their service files' query shapes the
way it did for `gatherings`/`communities` above. Treat their data model as **UNCLEAR** —
verifying it would need either a live Management API schema pull (as several `CLAUDE.md`
sessions did for other tables) or a dedicated reverse-engineering pass through
`src/services/{chemistryDiary,goodbyeArchive,relationshipLegacy,relationshipConstitution,
stressTest,sharedDecisions,sharedPlaylist,timelinePlanner,tripPlanning,memoryVault}.js`.

## Safety / trust / verification

- **`emergency_contacts`** (schema known — local migration) — `user_id, name, phone,
  relationship`. Simple owner-only RLS.
- **`date_checkins`**, **`id_verification_submissions`**, **`live_tracking_sessions`** —
  schema not local; existence and rough purpose confirmed via grep and `CLAUDE.md`'s account of
  the check-in/safety flow and a real admin-approval RPC
  (`admin_approve_id_verification`) for the second one.
- **`referral_redemptions`** — backs the referral-bonus system (`grant_referral_bonus` RPC).

## Storage buckets (confirmed via `storage.from()` grep)

`profile-photos`, `stories`, `chat-media`, `id-verification` — 4 buckets referenced client-side.
`schema.sql` only defines RLS for `profile-photos`; the other three buckets' policies are not
in any local file (same "production-only" pattern as the missing tables above). A private
`gathering-photos` bucket is also mentioned in `CLAUDE.md`'s prose for cover-photo uploads but
was not found in the client-side `storage.from()` grep in this pass — **UNCLEAR** whether it's
actually used under a different access path or that prose is stale.

## Suspicious/notable data modeling, gathered from the above

1. **The repo cannot reproduce its own database.** This is the single biggest data-model risk
   in this audit — see `PRODUCT_RISKS.md` and `IMPLEMENTATION_NOTES.md`.
2. **RLS is philosophically split** between "wide open, app is the real gate" (gatherings,
   most of the social/community layer) and "RLS is the real gate" (notices' premium-visibility
   rule, messages, blocks-derived exclusions). Both are real, working models elsewhere in this
   codebase, but a reader can't assume which one applies to any given table without checking —
   there's no naming convention or comment marking which posture a table uses.
3. **Two different "billing" concepts share the word loosely**: `business_invoices` (real,
   partner-owes-Nearby billing, cron-generated) and the consumer-facing subscription
   (`profiles.is_premium`, RevenueCat-driven) are entirely separate systems with no shared
   table — worth being explicit about to avoid an auditor conflating them.
4. **Polymorphic target pattern reused three times** (`social_invites`,
   `business_partnership_requests`, and — per `CLAUDE.md` — the offer/redemption target shape)
   — a consistent, deliberate convention (`target_type` + `target_id`) rather than duplicated
   one-off tables, which is a positive signal for schema discipline in the parts of the schema
   that *are* visible.
5. **No table anywhere holds a raw precise location for a person** — `profiles` has none,
   `presence_reports`/`sightings` are bucketed — a genuinely strong, consistently-enforced
   privacy posture structurally, not just documented as a promise.
