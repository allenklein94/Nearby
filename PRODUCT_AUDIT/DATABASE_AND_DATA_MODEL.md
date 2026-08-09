# Database & Data Model — Nearby

*Basis: direct read of `supabase/migrations/00000000000000_baseline.sql` (now the real,
replay-verified schema baseline — see below), the 2 other files currently live in
`supabase/migrations/`, all 31 files in `supabase/migrations_archive/`, a repo-wide grep of
every `.from('table')` / `.rpc('fn')` call in `src/`, and — new this refresh — direct live
queries against production (`enmosvippabmuqslzrox`) via the Management API to independently
confirm table/function/policy counts and re-test several previously-unverified claims.
**Refreshed 2026-08-09.** See `AUDIT_CHANGELOG.md` for the full diff against the 2026-08-08
original, whose single biggest finding (the schema was not locally reproducible) is the
headline change in this file.*

## The last audit's single biggest finding is now resolved — with one regression found and fixed during this very refresh

The last audit's headline risk was: *"~45 of ~53 real production tables have no `CREATE TABLE`
anywhere in this git repository — the schema cannot be reconstructed from source control."*
Between that audit and this refresh, a real baseline migration was built and — critically —
**verified by actually applying it to a truly empty database**, not just by reading the SQL:

- `supabase/migrations/00000000000000_baseline.sql` (6252 lines, byte-identical to
  `supabase/full_schema_pull_2026-08-09.sql`) now contains a real `create table` statement for
  **all 53 tables** — confirmed two ways: (1) a live table-name diff against production's real
  `information_schema.tables` came back empty in both directions; (2) an actual Docker replay
  against `supabase/postgres:15.1.0.147` (the real Supabase Postgres image, not a bare vanilla
  Postgres) on a truly empty `public` schema completed with exit code 0 — 52 tables, 103
  functions, 119 policies, 36 triggers, 10 cron jobs, 5 storage buckets, matching the file's own
  real counts exactly (that run predates today's 2 newest migrations; live counts today are
  53/106/120/36/10/5, an exact +1/+3/+1/0/0/0 incremental delta — see below).
- Two real, non-obvious bugs were found and fixed to get the file into this state: tables were
  originally ordered alphabetically rather than by FK dependency (`blocks` referenced `profiles`
  from ~1500 lines before `profiles` existed), and `CREATE POLICY`/`CREATE TRIGGER` statements
  were originally inline in the TABLES section, referencing SECURITY DEFINER helper functions
  that hadn't been defined yet at that point in the file — both fail hard on a truly fresh
  database (Postgres validates policy/trigger expressions against the catalog at creation time,
  unlike a plpgsql function body). Both are fixed: tables are topologically sorted, and
  policies/triggers are deferred into two dedicated sections after FUNCTIONS.
- Two harmless test-environment-only patches (an `auth.users.phone` column, a
  `storage.buckets.public` column — both real in current production, just absent from the
  pinned older test image) were applied to the Docker container only, never to the committed
  file.

**A regression was found and fixed during this refresh itself, worth stating plainly rather than
glossing over.** `supabase/migrations/20260809_social_invite_community_join.sql` — the live
migration implementing the flywheel-trace leg-4 fix (private-community invite-accept → real
membership) — was committed in the same commit that patched the baseline to bake the identical
fix directly into the baseline's own `community_members` INSERT policy, but the live migration
file was never archived. Net effect: replaying `supabase/migrations/` in filename order would
create the policy via the baseline, then hit `ERROR: policy ... already exists` on the third
file's own `create policy` for the same name — the identical conflict shape the original
baseline-fix session found and fixed once already for the `visibility`/`capacity` columns. **This
was confirmed with a real replay** (same Docker method, a truly empty `public` schema): applying
`baseline → business_customer_notes.sql → business_profile_self_edit.sql` succeeds with exit
code 0; re-applying the archived file on top of that state fails exactly as predicted, proving
the archive move (not something else) resolves it. **Fixed**: the file was moved to
`supabase/migrations_archive/` (`git mv`) — its effect was already fully present in the
baseline, so nothing is lost, only the duplicate live copy is removed from the replay path.
Independently, Agent B's live-catalog analysis (run concurrently during this same refresh) found
and confirmed the identical bug by static+live cross-check before the fix landed, corroborating
it wasn't a one-off misread.

**Current, post-fix state**: `supabase/migrations/` now contains exactly 3 files —
`00000000000000_baseline.sql`, `20260809_business_customer_notes.sql` (a genuinely new table,
confirmed absent from the baseline via grep), and `20260809_business_profile_self_edit.sql` (a
genuinely new RPC, confirmed absent from the baseline). Both are confirmed clean, non-conflicting
incremental deltas — their only dependencies (`profiles`, `brand_partners`) already exist in the
baseline. **A fresh empty Supabase project really can be rebuilt from committed files alone,
end to end, replaying the full live `supabase/migrations/` folder in filename order** — the
strong claim the last audit couldn't make, now genuinely true and replay-verified, not just
asserted.

## Core identity & connection tables

- **`profiles`** — real column count confirmed live: **66 columns**, including
  `managed_partner_id`, `ai_uses_today`, `bonus_notices`, `interests`, `is_admin`,
  `is_premium`, `photo_verified`, `expo_push_token`, `timezone`. **Zero lat/lng-shaped columns**
  — independently re-confirmed live this refresh via a properly-scoped `information_schema`
  query (an earlier, unscoped version of this same check produced false positives from other
  tables' columns — corrected before being reported here). No per-person map layer is possible
  by construction, not by convention.
- **`presence_reports`**, **`sightings`**, **`notices`**, **`matches`**, **`messages`**,
  **`blocks`**, **`reports`** — all now have a real, committed `CREATE TABLE` in the baseline.
  Unchanged in shape from the last audit's inferred description.

### `is_blocked(user_1, user_2)` — re-verified live, not just re-read

Referenced by ~10 RLS policies. **Live-tested this refresh, both directions, using a real
disposable block row**: the blocker gets `true` (unchanged); the **blocked party** — the exact
historical failure mode, where this function used to run under the calling role's own RLS and so
couldn't see a block row it wasn't the blocker on — now also correctly gets `true`; an uninvolved
third party probing the same pair correctly gets `false` (the anti-probing guard, added alongside
the original fix, still holds). Downstream consumers (`matches` SELECT, `messages` SELECT+INSERT)
were also re-confirmed live to actually drop/reject for a blocked pair, not just that the helper
function itself returns the right boolean in isolation. **Classification: CONFIRMED SECURE**,
upgraded from the last audit's "reported fixed, not independently re-verified."

## Gatherings

Confirmed columns (live-verified against the baseline, unchanged from the last audit's list):
`id, host_id, title, description, interest_tag, scheduled_at, area, wide_area, precise_lat,
precise_lng, is_public, show_on_map, women_only, hosting_partner_id, recurrence_rule,
energy_level, conversation_level, group_size_feel, beginner_friendly, timeline_steps,
cover_photo_path, visibility, community_id, capacity`.

- `visibility`/`is_public` remain the two distinct axes described in the last audit
  (discovery-scope vs. auto-join-vs-approval).
- **`join_gathering()`'s `invite_only` enforcement — new since the last audit, live-verified
  both directions.** A caller who isn't the host now needs a real accepted `social_invites` row
  or the call is rejected with an honest message, before it ever reaches the
  capacity/women-only/blocks checks. Tested live with a real disposable `invite_only` gathering:
  an uninvited caller is rejected; the same caller with a real accepted invite succeeds
  (correctly as `pending`, since `invite_only` still implies host-approval). This closes what
  the last audit's `PRODUCT_RISKS.md` explicitly flagged as an accepted-but-unhardened risk.
- **RLS is still deliberately wide open** (`"Anyone can view gatherings" using (true)`,
  re-confirmed live and unchanged) — the app-layer-is-the-real-gate design posture is unchanged,
  see `PRODUCT_RISKS.md`.
- **`hosting_partner_id` self-edit — a real open question from the last audit's own build
  history, now confirmed resolved.** The last audit's session notes flagged, as a "check before
  building" item, whether a host could self-set `hosting_partner_id` to an arbitrary business id
  with no consent — and never circled back with a documented answer. Live-tested directly this
  refresh on a real, non-test gathering: the attempted self-edit is silently reverted by a
  `BEFORE UPDATE` trigger (`prevent_hosting_partner_self_edit()`, present on both `gatherings`
  and `communities`), the same guarded-column pattern used for `is_admin`/`is_premium`. The
  legitimate approval path (`respond_to_business_partnership_request()`) still works via the
  same `app.trusted_update` escape hatch. **CONFIRMED SECURE** — a positive, previously-open
  finding this refresh closes, not a new problem.

### `gathering_interest`

Unchanged from the last audit's description; the three mutating RPCs
(`join_gathering`/`approve_gathering_interest`/`leave_gathering`) still lock the parent
`gatherings` row `for update` first.

## Communities

Confirmed columns unchanged from the last audit. **The `community_members`/`communities` RLS
mutual-recursion bug — re-verified live, not just re-read this time.** The last audit flagged
this as "reported fixed, not independently re-run against production." This refresh ran the
exact simplest-case query that used to fail (`select * from community_members where user_id =
auth.uid()`, as a real `authenticated`-role session) across three different real caller
identities against a real disposable private community: the creator sees both membership rows;
a regular non-creator member sees only their own row (correct, matches the documented private-
community constraint); an uninvolved stranger sees zero rows; flipping the community to public
correctly reveals both rows to the stranger — and critically, **none of these queries raised the
historical infinite-recursion error.** **CONFIRMED SECURE.** The new `social_invites`-based
`community_members` INSERT path (added by the same migration whose duplicate-effect copy was
archived above) was also live-tested: an invited-and-accepted user's self-insert succeeds; an
uninvited third party's identical attempt is correctly rejected by RLS.

## Businesses / commerce layer

- **`brand_partners`**, **`brand_offers`**, **`offer_redemptions`** — unchanged in shape from
  the last audit.
- **`offer_redemptions` now carries real proof-of-redemption columns** (new since the last
  audit): `confirmation_code` (6-digit, auto-generated), `confirmed_at`, `confirmed_by`, plus a
  `confirm_offer_redemption(code_param)` RPC (`revoke all ... from public, anon`). Billing math
  (`generate_monthly_invoices`) now only counts `confirmed_at is not null` redemptions — closing
  the last audit's "no proof-of-redemption mechanism, billing math inherits that trust gap"
  finding.
- **`partner_contracts`**, **`business_invoices`** — unchanged. Still no downstream payment
  processor; invoices still sit in `draft` indefinitely — **confirmed STILL PRESENT** this
  refresh, no code found anywhere resembling Stripe or any other payment rail.
- **`business_partnership_requests`** — unchanged.
- **`business_customer_notes`** — **new table since the last audit**. `partner_id,
  customer_user_id, note, tags text[]`, `unique(partner_id, customer_user_id)`. Exactly one
  SELECT policy exists (owner-scoped via `profiles.managed_partner_id`) — **confirmed live: no
  INSERT/UPDATE/DELETE policy of any kind exists on this table**; writes only happen through two
  new SECURITY DEFINER RPCs (`upsert_business_customer_note`/`delete_business_customer_note`),
  both confirmed to carry the same ownership check and correctly grant-restricted
  (`anon=false, authenticated=true`).
- **`update_business_profile(partner_id, name, description, address, latitude, longitude,
  logo_url)`** — new RPC, ownership-checked (confirmed live via `pg_get_functiondef`), also
  validates `name` isn't null/empty server-side. Closes a real, previously-silent bug the last
  audit didn't catch: the *pre-existing* address-edit path (`updateBusinessAddress()`) had
  always done a raw client `.update()` against `brand_partners`, which had **zero UPDATE RLS
  policy of any kind** — meaning it had never actually written anything for any real owner. Both
  the address field and the new profile fields now route through this one real RPC.
- **Business RPC ownership checks (`get_business_dashboard_stats` and its 4 siblings, plus the
  3 new-this-session functions) — re-verified live, not just re-read.** All 8 confirmed to still
  open with the same `exists (select 1 from profiles where id = auth.uid() and
  managed_partner_id = partner_id_param)` guard, and all 8 confirmed correctly grant-restricted
  (`anon=false`, `authenticated=true`, `service_role=true`). **CONFIRMED SECURE**, upgraded from
  the last audit's "reported fixed, not independently re-verified."
- **`business_messages`** — the `is_blocked()` check on both INSERT policies is confirmed
  present live, unchanged.
- **`business_followers`**, **`business_updates`** — unchanged.

## Social graph & invites

- **`friendships`**, **`social_invites`**, **`friend_circles`**/**`friend_circle_members`** —
  unchanged in shape. `social_invites`' RLS is confirmed live to still have exactly one policy
  (SELECT, `inviter_id`/`invitee_id`-scoped) — no direct client INSERT/UPDATE path exists,
  confirmed not assumed.

## Relationship-longevity tables

Unchanged from the last audit: `chemistry_diary_entries`, `goodbye_archive_entries`,
`relationship_legacy_entries`, `constitution_entries`, `stress_test_notes`, `shared_decisions`,
`shared_playlist_items`, `timeline_notes`, `trip_ideas`, `memory_vault_items`. All now have a
real `CREATE TABLE` in the baseline (resolved by the general schema-reproducibility fix above),
but their column-level constraints beyond what the baseline's flattened form shows were not
individually re-derived from each service file's query shape this pass — **still classified
COULD NOT VERIFY** for that deeper level of detail, same as the last audit.

## Safety / trust / verification

- **`emergency_contacts`**, **`date_checkins`**, **`id_verification_submissions`**,
  **`live_tracking_sessions`**, **`referral_redemptions`** — unchanged, all now have a real
  `CREATE TABLE` in the baseline.
- **`is_admin` / `is_premium` / `bonus_notices` guarded-column protection — re-verified live,
  both directions, with a real self-escalation attempt.** As a real, genuinely non-admin
  profile, `update profiles set is_admin = true where id = self returning is_admin` succeeds at
  the RLS layer (no policy blocks it) but the `RETURNING` clause shows `false` — the trigger
  silently reverted it inside the same statement, confirmed via an immediate re-query as
  ground truth. Identical result for a combined `bonus_notices = 9999, is_premium = true`
  attempt on an unrelated real profile. **CONFIRMED SECURE**, both directly re-tested this
  refresh, not just re-read.
- **`check_and_increment_ai_use` — confirmed still `service_role`-only.** A real authenticated
  session directly calling it (even with its own id) is rejected at the grant level before
  reaching the function body.

## Storage buckets

**Now fully resolved and locally reproducible** — all 5 buckets (`chat-media`,
`gathering-photos`, `id-verification`, `profile-photos`, `stories`) have their `CREATE` +
policies in the baseline. The last audit's specific "UNCLEAR whether `gathering-photos` actually
exists" question is resolved — it does. Live-confirmed: all 5 buckets are `public: false`; all
13 `storage.objects` policies scope by folder-ownership or a real relationship check; one
bucket's SELECT policy (`gathering-photos`) is intentionally broad (cover photos visible to
anyone browsing a gathering listing) — a deliberate design choice, not a flaw.

## Suspicious/notable data modeling — updated

1. **The repo can now reproduce its own database.** The last audit's single biggest data-model
   risk is resolved — replay-verified against a truly empty database, with one real regression
   found and fixed during this very refresh (see the top of this file).
2. **RLS is still philosophically split** between "wide open, app is the real gate" and "RLS is
   the real gate" — unchanged, still no naming convention distinguishing which applies to a
   given table.
3. **Two different "billing" concepts still share the word loosely** — unchanged.
4. **The polymorphic target pattern is now used at least four times** (`social_invites`,
   `business_partnership_requests`, the offer/redemption target shape, and — new this refresh —
   nothing structurally new was added to this list, but it's reconfirmed consistent across the
   two new tables added since the last audit).
5. **No table anywhere holds a raw precise location for a person** — independently re-confirmed
   live this refresh via a properly-scoped column query. Still a genuinely strong, structurally
   enforced privacy posture.
