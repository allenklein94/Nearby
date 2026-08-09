-- Full schema pull, machine-generated via Supabase Management API introspection.
-- Generated 2026-08-09 as part of PRODUCT_AUDIT fix item 3 ('stand up a real,
-- version-controlled schema'). This is a COMPLETE snapshot of every real table,
-- function, trigger, view, policy, and index that exists in production today —
-- unlike supabase/schema.sql (the original hand-authored file, kept as-is, which
-- only ever covered ~8 of the ~53 real tables) and unlike supabase/migrations/
-- (which covers incremental changes going forward, not the historical baseline).
--
-- IMPORTANT — this file is also THE BASELINE. This exact content (minus the
-- copy at supabase/migrations/00000000000000_baseline.sql, kept in sync) is the
-- true migration zero: on a fresh empty Supabase project, running this file
-- alone recreates production's schema as of the "Patched" date below. The
-- original version of this file (generated as a one-shot snapshot, before the
-- baseline fix on 2026-08-09) was NOT actually replayable — it had already
-- flattened columns/functions that later migrations then tried to ALTER/CREATE
-- OR REPLACE a second time, which conflicts on an empty project. See CLAUDE.md's
-- "schema baseline fix" section for the concrete conflict that proved this and
-- the fix. The 31 dated migrations covering Aug 6-9 2026 were moved to
-- supabase/migrations_archive/ (changelog reading only, not meant to be
-- replayed — their effects are already folded into this file) once their
-- content was folded in here.
--
-- Patched 2026-08-09 (baseline refresh) to additionally reflect: offer_redemptions'
-- confirmation_code/confirmed_at/confirmed_by columns, confirm_offer_redemption(),
-- updated generate_monthly_invoices()/get_partner_billing_estimate() (proof-of-
-- redemption billing), send_momentum_nudges() + its cron job, and join_gathering()'s
-- invite_only enforcement — all applied to production after this file's original
-- generation, patched in from live pg_get_functiondef()/information_schema queries,
-- not copied from migration files (a migration only shows one incremental diff; the
-- live definition is the real current truth after however many migrations touched
-- an object).
--
-- Going forward: every new schema change still gets a real migration file in
-- supabase/migrations/, timestamped after this baseline — per this repo's
-- standing convention (see "Known conventions" below) — and should periodically
-- be proven to actually replay cleanly on top of this baseline, not just assumed
-- to because the file exists.
--
-- Restructured 2026-08-09 (second same-day pass) to fix a second, deeper
-- replay-order bug found by actually trying to apply this file to a truly
-- empty database (a real docker-run supabase/postgres:15.1.0.147 container,
-- not just eyeballing the SQL): tables were reordered into real FK-dependency
-- order in the first pass of this same day's baseline fix, but each table's
-- CREATE POLICY / CREATE TRIGGER statements stayed physically inline right
-- after their table, in the TABLES section — while the SECURITY DEFINER
-- helper functions many policies call (is_blocked(), is_community_visible_to(),
-- check_is_admin(), has_mutual_notice()) and the functions every trigger's
-- EXECUTE FUNCTION target names live in the separate FUNCTIONS section further
-- down the file. CREATE POLICY and CREATE TRIGGER both validate that every
-- object their expression references already exists at creation time (unlike
-- a plpgsql function body, which isn't checked against the catalog until first
-- execution) — so on a fresh project, every policy/trigger referencing a
-- not-yet-created helper function would fail immediately. Confirmed live: the
-- pre-fix file failed on the very first such policy with a real
-- "function is_blocked(uuid, uuid) does not exist"-shaped error inside a
-- from-scratch docker apply.
--
-- Fixed by deferring every CREATE POLICY and CREATE TRIGGER statement (still
-- grouped and commented per-table, in the same table order) into two new
-- sections placed after FUNCTIONS: "ROW LEVEL SECURITY POLICIES" and
-- "TRIGGERS". CREATE TABLE / ALTER TABLE .. ENABLE ROW LEVEL SECURITY /
-- CREATE INDEX statements stayed in the TABLES section, since none of those
-- depend on a function existing. This was a mechanical, content-preserving
-- reorder, not a rewrite — verified line-for-line: every non-comment content
-- line from the pre-restructure file appears exactly once in the restructured
-- file (a full multiset diff of both files' non-blank, non-marker-comment
-- lines came back empty), and every create table/policy/trigger/index
-- statement count matched exactly (52/119/36/9) before and after.
--
-- Verified by real end-to-end application, not just static analysis: spun up
-- a real supabase/postgres:15.1.0.147 docker container (the actual Supabase
-- Postgres image, with pg_cron/pg_net/supabase_vault/auth/storage schemas
-- pre-installed — not a bare vanilla postgres image), dropped and recreated
-- an empty public schema to simulate a truly fresh project, and applied this
-- exact file with `psql -v ON_ERROR_STOP=1`. Result: exit code 0, zero errors,
-- with every object landing correctly — 52 tables, 103 functions, 119
-- policies, 36 triggers, 10 cron jobs, 5 storage buckets, matching the source
-- file's own counts exactly. (Two unrelated, environment-only failures hit
-- first — auth.users missing a phone column and storage.buckets missing a
-- public column — both because this docker image ships an older GoTrue/
-- Storage schema version than current production; patched onto the test
-- container with a couple of ALTER TABLE ADD COLUMN IF NOT EXISTS statements
-- before the real run, not a change to this file or a real gap in it.)

-- ==================== EXTENSIONS ====================
create extension if not exists "pg_cron";
create extension if not exists "pg_net";
create extension if not exists "pg_stat_statements";
create extension if not exists "pgcrypto";
create extension if not exists "supabase_vault";
create extension if not exists "uuid-ossp";

-- ==================== TABLES ====================
-- ---------- BRAND_PARTNERS ----------
create table if not exists public.brand_partners (
  id uuid default uuid_generate_v4() not null,
  name text not null,
  logo_url text,
  description text,
  active boolean default true,
  created_at timestamp with time zone default now(),
  latitude double precision,
  longitude double precision,
  address text,
  constraint brand_partners_pkey PRIMARY KEY (id)
);

alter table public.brand_partners enable row level security;



-- ---------- BUSINESS_INVOICES ----------
create table if not exists public.business_invoices (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  period_start timestamp with time zone not null,
  period_end timestamp with time zone not null,
  redemption_count integer default 0 not null,
  amount_due numeric(10,2) default 0 not null,
  status text default 'draft'::text not null,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  paid_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint business_invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'paid'::text, 'failed'::text, 'void'::text]))),
  constraint business_invoices_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES brand_partners(id) ON DELETE CASCADE,
  constraint business_invoices_pkey PRIMARY KEY (id),
  constraint business_invoices_partner_period_unique UNIQUE (partner_id, period_start, period_end)
);

alter table public.business_invoices enable row level security;



-- ---------- BUSINESS_UPDATES ----------
create table if not exists public.business_updates (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  title text not null,
  body text,
  created_at timestamp with time zone default now() not null,
  constraint business_updates_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES brand_partners(id) ON DELETE CASCADE,
  constraint business_updates_pkey PRIMARY KEY (id)
);

alter table public.business_updates enable row level security;





-- ---------- PARTNER_CONTRACTS ----------
create table if not exists public.partner_contracts (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  billing_model text not null,
  monthly_fee numeric(10,2),
  redemption_fee numeric(10,2),
  contract_start date not null,
  contract_end date,
  max_monthly_spend numeric(10,2),
  auto_renew boolean default false not null,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null,
  included_units integer default 0 not null,
  constraint partner_contracts_billing_model_check CHECK ((billing_model = ANY (ARRAY['per_redemption'::text, 'flat_monthly'::text, 'hybrid'::text, 'custom'::text]))),
  constraint partner_contracts_fee_matches_model CHECK ((((billing_model = 'per_redemption'::text) AND (redemption_fee IS NOT NULL)) OR ((billing_model = 'flat_monthly'::text) AND (monthly_fee IS NOT NULL)) OR ((billing_model = 'hybrid'::text) AND (monthly_fee IS NOT NULL) AND (redemption_fee IS NOT NULL)) OR (billing_model = 'custom'::text))),
  constraint partner_contracts_included_units_non_negative CHECK ((included_units >= 0)),
  constraint partner_contracts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'expired'::text, 'cancelled'::text]))),
  constraint partner_contracts_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES brand_partners(id) ON DELETE CASCADE,
  constraint partner_contracts_pkey PRIMARY KEY (id)
);

alter table public.partner_contracts enable row level security;

CREATE INDEX idx_partner_contracts_partner_status ON public.partner_contracts USING btree (partner_id, status);



-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id uuid not null,
  display_name text not null,
  bio text,
  birthdate date not null,
  photo_url text,
  photo_verified boolean default false,
  is_premium boolean default false,
  expo_push_token text,
  created_at timestamp with time zone default now(),
  is_admin boolean default false,
  terms_accepted_at timestamp with time zone,
  interests text[] default '{}'::text[],
  pronouns text,
  gender text,
  sexual_orientation text,
  profile_hidden boolean default false,
  basics jsonb default '{}'::jsonb,
  discovery_gender text default 'Prefer not to say'::text,
  show_me text default 'Everyone'::text,
  preferred_min_age integer default 18,
  preferred_max_age integer default 99,
  notify_matches boolean default true,
  notify_messages boolean default true,
  notify_waves boolean default true,
  gender_hidden boolean default false,
  ethnicity text,
  ethnicity_hidden boolean default false,
  ethnicity_preferences text[] default '{}'::text[],
  prompts jsonb default '[]'::jsonb,
  relationship_intention text[],
  read_receipts_enabled boolean default true,
  women_message_first boolean default false,
  referral_code text,
  referred_by uuid,
  bonus_notices integer default 0,
  gender_identity text[] default '{}'::text[],
  interested_in_genders text[] default '{}'::text[],
  discovery_view_style text default 'list'::text,
  wide_area text,
  seen_browse_callout boolean default false,
  browse_views_today integer default 0,
  browse_views_date date default CURRENT_DATE,
  ai_uses_today integer default 0,
  ai_uses_date date default CURRENT_DATE,
  spotify_access_token text,
  spotify_refresh_token text,
  spotify_token_expires_at timestamp with time zone,
  favorite_tracks jsonb default '[]'::jsonb,
  quick_filter_order jsonb default '["verified", "highCompat", "online"]'::jsonb,
  quick_filter_visible jsonb default '["verified", "highCompat", "online"]'::jsonb,
  last_home_visit timestamp with time zone,
  last_activity_check timestamp with time zone,
  managed_partner_id uuid,
  connection_goal text,
  timezone text default 'UTC'::text,
  gatherings_created_today integer default 0 not null,
  gatherings_created_date date,
  communities_created_today integer default 0 not null,
  communities_created_date date,
  friend_requests_sent_today integer default 0 not null,
  friend_requests_sent_date date,
  stories_posted_today integer default 0 not null,
  stories_posted_date date,
  onboarding_motivations text[],
  social_comfort_level text,
  monthly_interests text[],
  monthly_interests_updated_at timestamp with time zone,
  constraint must_be_18_plus CHECK ((birthdate <= (CURRENT_DATE - '18 years'::interval))),
  constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint profiles_managed_partner_id_fkey FOREIGN KEY (managed_partner_id) REFERENCES brand_partners(id) ON DELETE SET NULL,
  constraint profiles_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES profiles(id) ON DELETE SET NULL,
  constraint profiles_pkey PRIMARY KEY (id),
  constraint profiles_referral_code_key UNIQUE (referral_code)
);

alter table public.profiles enable row level security;







-- ---------- BLOCKS ----------
create table if not exists public.blocks (
  id uuid default uuid_generate_v4() not null,
  blocker_id uuid,
  blocked_id uuid,
  created_at timestamp with time zone default now(),
  constraint no_self_block CHECK ((blocker_id <> blocked_id)),
  constraint blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint blocks_pkey PRIMARY KEY (id),
  constraint blocks_blocker_id_blocked_id_key UNIQUE (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;





-- ---------- BUSINESS_FOLLOWERS ----------
create table if not exists public.business_followers (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  brand_partner_id uuid not null,
  opted_in_at timestamp with time zone default now() not null,
  constraint business_followers_brand_partner_id_fkey FOREIGN KEY (brand_partner_id) REFERENCES brand_partners(id) ON DELETE CASCADE,
  constraint business_followers_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint business_followers_pkey PRIMARY KEY (id),
  constraint business_followers_user_id_brand_partner_id_key UNIQUE (user_id, brand_partner_id)
);

alter table public.business_followers enable row level security;



-- ---------- BUSINESS_MESSAGES ----------
create table if not exists public.business_messages (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  sender_id uuid not null,
  from_business boolean default false not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  conversation_with_id uuid not null,
  constraint business_messages_conversation_with_id_fkey FOREIGN KEY (conversation_with_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint business_messages_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES brand_partners(id) ON DELETE CASCADE,
  constraint business_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint business_messages_pkey PRIMARY KEY (id)
);

alter table public.business_messages enable row level security;





-- ---------- BUSINESS_PARTNER_REQUESTS ----------
create table if not exists public.business_partner_requests (
  id uuid default gen_random_uuid() not null,
  requester_id uuid not null,
  business_name text not null,
  business_description text,
  contact_info text,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  reviewed_at timestamp with time zone,
  constraint business_partner_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint business_partner_requests_pkey PRIMARY KEY (id)
);

alter table public.business_partner_requests enable row level security;






-- ---------- BUSINESS_PARTNERSHIP_REQUESTS ----------
create table if not exists public.business_partnership_requests (
  id uuid default gen_random_uuid() not null,
  requester_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  partner_id uuid not null,
  message text,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  reviewed_at timestamp with time zone,
  constraint business_partnership_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text]))),
  constraint business_partnership_requests_target_type_check CHECK ((target_type = ANY (ARRAY['gathering'::text, 'community'::text]))),
  constraint business_partnership_requests_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES brand_partners(id) ON DELETE CASCADE,
  constraint business_partnership_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint business_partnership_requests_pkey PRIMARY KEY (id)
);

alter table public.business_partnership_requests enable row level security;

CREATE INDEX business_partnership_requests_partner_idx ON public.business_partnership_requests USING btree (partner_id, status);
CREATE UNIQUE INDEX business_partnership_requests_pending_unique ON public.business_partnership_requests USING btree (target_type, target_id, partner_id) WHERE (status = 'pending'::text);



-- ---------- CHEMISTRY_DIARY_ENTRIES ----------
create table if not exists public.chemistry_diary_entries (
  id uuid default uuid_generate_v4() not null,
  user_id uuid,
  about_display_name text,
  felt_relaxed boolean,
  felt_curious boolean,
  felt_respected boolean,
  felt_laughed boolean,
  felt_like_myself boolean,
  note_text text,
  created_at timestamp with time zone default now(),
  constraint chemistry_diary_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint chemistry_diary_entries_pkey PRIMARY KEY (id)
);

alter table public.chemistry_diary_entries enable row level security;





-- ---------- COMMUNITIES ----------
create table if not exists public.communities (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  creator_id uuid not null,
  interest_tag text,
  is_public boolean default true not null,
  cover_photo_url text,
  created_at timestamp with time zone default now() not null,
  hosting_partner_id uuid,
  constraint communities_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint communities_hosting_partner_id_fkey FOREIGN KEY (hosting_partner_id) REFERENCES brand_partners(id) ON DELETE SET NULL,
  constraint communities_pkey PRIMARY KEY (id)
);

alter table public.communities enable row level security;







-- ---------- COMMUNITY_MEMBERS ----------
create table if not exists public.community_members (
  id uuid default gen_random_uuid() not null,
  community_id uuid not null,
  user_id uuid not null,
  role text default 'member'::text not null,
  joined_at timestamp with time zone default now() not null,
  constraint community_members_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
  constraint community_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint community_members_pkey PRIMARY KEY (id),
  constraint community_members_community_id_user_id_key UNIQUE (community_id, user_id)
);

alter table public.community_members enable row level security;





-- ---------- COMMUNITY_MESSAGES ----------
create table if not exists public.community_messages (
  id uuid default gen_random_uuid() not null,
  community_id uuid not null,
  sender_id uuid not null,
  body text,
  created_at timestamp with time zone default now() not null,
  constraint community_messages_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
  constraint community_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint community_messages_pkey PRIMARY KEY (id)
);

alter table public.community_messages enable row level security;




-- ---------- EMERGENCY_CONTACTS ----------
create table if not exists public.emergency_contacts (
  id uuid default uuid_generate_v4() not null,
  user_id uuid,
  name text not null,
  phone text not null,
  relationship text,
  created_at timestamp with time zone default now(),
  constraint emergency_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint emergency_contacts_pkey PRIMARY KEY (id)
);

alter table public.emergency_contacts enable row level security;



-- ---------- FRIEND_CIRCLES ----------
create table if not exists public.friend_circles (
  id uuid default uuid_generate_v4() not null,
  user_id uuid,
  name text not null,
  created_at timestamp with time zone default now(),
  constraint friend_circles_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint friend_circles_pkey PRIMARY KEY (id)
);

alter table public.friend_circles enable row level security;



-- ---------- FRIEND_CIRCLE_MEMBERS ----------
create table if not exists public.friend_circle_members (
  id uuid default uuid_generate_v4() not null,
  circle_id uuid,
  friend_user_id uuid,
  created_at timestamp with time zone default now(),
  constraint friend_circle_members_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES friend_circles(id) ON DELETE CASCADE,
  constraint friend_circle_members_friend_user_id_fkey FOREIGN KEY (friend_user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint friend_circle_members_pkey PRIMARY KEY (id),
  constraint friend_circle_members_circle_id_friend_user_id_key UNIQUE (circle_id, friend_user_id)
);

alter table public.friend_circle_members enable row level security;



-- ---------- FRIENDSHIPS ----------
create table if not exists public.friendships (
  id uuid default gen_random_uuid() not null,
  user_a uuid not null,
  user_b uuid not null,
  status text default 'pending'::text not null,
  requested_by uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint no_self_friendship CHECK ((user_a <> user_b)),
  constraint valid_friendship_status CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))),
  constraint friendships_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint friendships_user_a_fkey FOREIGN KEY (user_a) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint friendships_user_b_fkey FOREIGN KEY (user_b) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint friendships_pkey PRIMARY KEY (id),
  constraint friendships_user_a_user_b_key UNIQUE (user_a, user_b)
);

alter table public.friendships enable row level security;






-- ---------- GATHERINGS ----------
create table if not exists public.gatherings (
  id uuid default uuid_generate_v4() not null,
  host_id uuid,
  title text not null,
  description text,
  interest_tag text,
  area text not null,
  scheduled_at timestamp with time zone not null,
  created_at timestamp with time zone default now(),
  wide_area text,
  precise_lat numeric,
  precise_lng numeric,
  is_public boolean default true,
  show_on_map boolean default true,
  reminder_sent boolean default false,
  women_only boolean default false,
  community_id uuid,
  hosting_partner_id uuid,
  recurrence_rule text,
  recurring_series_id uuid,
  series_stopped boolean default false not null,
  energy_level smallint,
  conversation_level smallint,
  group_size_feel smallint,
  beginner_friendly boolean default true not null,
  timeline_steps jsonb,
  cover_photo_path text,
  visibility text default 'everyone'::text not null,
  capacity integer,
  constraint gatherings_capacity_check CHECK (((capacity IS NULL) OR (capacity > 0))),
  constraint gatherings_conversation_level_range CHECK (((conversation_level IS NULL) OR ((conversation_level >= 1) AND (conversation_level <= 5)))),
  constraint gatherings_energy_level_range CHECK (((energy_level IS NULL) OR ((energy_level >= 1) AND (energy_level <= 5)))),
  constraint gatherings_group_size_feel_range CHECK (((group_size_feel IS NULL) OR ((group_size_feel >= 1) AND (group_size_feel <= 5)))),
  constraint gatherings_timeline_steps_length CHECK (((timeline_steps IS NULL) OR (jsonb_array_length(timeline_steps) <= 8))),
  constraint gatherings_visibility_check CHECK ((visibility = ANY (ARRAY['everyone'::text, 'friends'::text, 'community'::text, 'invite_only'::text]))),
  constraint gatherings_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE SET NULL,
  constraint gatherings_host_id_fkey FOREIGN KEY (host_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint gatherings_hosting_partner_id_fkey FOREIGN KEY (hosting_partner_id) REFERENCES brand_partners(id) ON DELETE SET NULL,
  constraint gatherings_pkey PRIMARY KEY (id)
);

alter table public.gatherings enable row level security;







-- ---------- BRAND_OFFERS ----------
create table if not exists public.brand_offers (
  id uuid default uuid_generate_v4() not null,
  partner_id uuid,
  title text not null,
  description text,
  reward_type text not null,
  redemption_instructions text,
  active boolean default true,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  latitude double precision,
  longitude double precision,
  valid_from_time time without time zone,
  valid_to_time time without time zone,
  gathering_id uuid,
  redemption_limit integer,
  target_interest_tag text,
  unlock_scope text,
  unlock_community_id uuid,
  unlock_min_members integer,
  constraint brand_offers_unlock_min_members_check CHECK (((unlock_min_members IS NULL) OR (unlock_min_members > 0))),
  constraint brand_offers_unlock_scope_check CHECK (((unlock_scope IS NULL) OR (unlock_scope = ANY (ARRAY['community'::text, 'gathering'::text])))),
  constraint brand_offers_unlock_shape_check CHECK ((((unlock_scope IS NULL) AND (unlock_min_members IS NULL) AND (unlock_community_id IS NULL)) OR ((unlock_scope = 'community'::text) AND (unlock_min_members IS NOT NULL) AND (unlock_community_id IS NOT NULL)) OR ((unlock_scope = 'gathering'::text) AND (unlock_min_members IS NOT NULL) AND (gathering_id IS NOT NULL)))),
  constraint brand_offers_gathering_id_fkey FOREIGN KEY (gathering_id) REFERENCES gatherings(id) ON DELETE SET NULL,
  constraint brand_offers_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES brand_partners(id) ON DELETE CASCADE,
  constraint brand_offers_unlock_community_id_fkey FOREIGN KEY (unlock_community_id) REFERENCES communities(id) ON DELETE SET NULL,
  constraint brand_offers_pkey PRIMARY KEY (id)
);

alter table public.brand_offers enable row level security;






-- ---------- GATHERING_FEEDBACK ----------
create table if not exists public.gathering_feedback (
  id uuid default gen_random_uuid() not null,
  gathering_id uuid not null,
  reviewer_id uuid not null,
  felt_welcoming boolean,
  would_attend_again boolean,
  created_at timestamp with time zone default now() not null,
  satisfaction_rating text,
  great_because text[],
  constraint gathering_feedback_gathering_id_fkey FOREIGN KEY (gathering_id) REFERENCES gatherings(id) ON DELETE CASCADE,
  constraint gathering_feedback_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint gathering_feedback_pkey PRIMARY KEY (id),
  constraint gathering_feedback_gathering_id_reviewer_id_key UNIQUE (gathering_id, reviewer_id)
);

alter table public.gathering_feedback enable row level security;




-- ---------- GATHERING_INTENTS ----------
create table if not exists public.gathering_intents (
  id uuid default gen_random_uuid() not null,
  gathering_id uuid not null,
  user_id uuid not null,
  intent text not null,
  created_at timestamp with time zone default now() not null,
  constraint gathering_intents_intent_check CHECK ((intent = ANY (ARRAY['meet_someone_new'::text, 'get_out_of_house'::text, 'good_conversations'::text, 'be_active'::text, 'relax_unwind'::text]))),
  constraint gathering_intents_gathering_id_fkey FOREIGN KEY (gathering_id) REFERENCES gatherings(id) ON DELETE CASCADE,
  constraint gathering_intents_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint gathering_intents_pkey PRIMARY KEY (id),
  constraint gathering_intents_gathering_id_user_id_key UNIQUE (gathering_id, user_id)
);

alter table public.gathering_intents enable row level security;





-- ---------- GATHERING_MESSAGES ----------
create table if not exists public.gathering_messages (
  id uuid default gen_random_uuid() not null,
  gathering_id uuid not null,
  sender_id uuid not null,
  body text,
  created_at timestamp with time zone default now() not null,
  constraint gathering_messages_gathering_id_fkey FOREIGN KEY (gathering_id) REFERENCES gatherings(id) ON DELETE CASCADE,
  constraint gathering_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint gathering_messages_pkey PRIMARY KEY (id)
);

alter table public.gathering_messages enable row level security;




-- ---------- GATHERING_QUESTIONS ----------
create table if not exists public.gathering_questions (
  id uuid default gen_random_uuid() not null,
  gathering_id uuid not null,
  asker_id uuid not null,
  question_body text not null,
  answer_body text,
  answered_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint gathering_questions_asker_id_fkey FOREIGN KEY (asker_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint gathering_questions_gathering_id_fkey FOREIGN KEY (gathering_id) REFERENCES gatherings(id) ON DELETE CASCADE,
  constraint gathering_questions_pkey PRIMARY KEY (id)
);

alter table public.gathering_questions enable row level security;

CREATE INDEX idx_gathering_questions_gathering_created ON public.gathering_questions USING btree (gathering_id, created_at);





-- ---------- GOODBYE_ARCHIVE_ENTRIES ----------
create table if not exists public.goodbye_archive_entries (
  id uuid default uuid_generate_v4() not null,
  user_id uuid,
  about_display_name text,
  what_was_beautiful text,
  what_was_difficult text,
  what_you_learned text,
  what_you_want_next_time text,
  created_at timestamp with time zone default now(),
  constraint goodbye_archive_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint goodbye_archive_entries_pkey PRIMARY KEY (id)
);

alter table public.goodbye_archive_entries enable row level security;





-- ---------- ID_VERIFICATION_SUBMISSIONS ----------
create table if not exists public.id_verification_submissions (
  id uuid default uuid_generate_v4() not null,
  user_id uuid,
  selfie_path text not null,
  id_photo_path text not null,
  status text default 'pending'::text not null,
  submitted_at timestamp with time zone default now(),
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  verification_method text default 'manual'::text,
  constraint id_verification_submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL,
  constraint id_verification_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint id_verification_submissions_pkey PRIMARY KEY (id)
);

alter table public.id_verification_submissions enable row level security;





-- ---------- INTENTION_HISTORY ----------
create table if not exists public.intention_history (
  id uuid default uuid_generate_v4() not null,
  user_id uuid,
  old_intention text,
  new_intention text,
  changed_at timestamp with time zone default now(),
  constraint intention_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint intention_history_pkey PRIMARY KEY (id)
);

alter table public.intention_history enable row level security;



-- ---------- LIVE_TRACKING_SESSIONS ----------
create table if not exists public.live_tracking_sessions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  started_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  active boolean default true not null,
  current_lat double precision,
  current_lng double precision,
  updated_at timestamp with time zone default now() not null,
  constraint live_tracking_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint live_tracking_sessions_pkey PRIMARY KEY (id)
);

alter table public.live_tracking_sessions enable row level security;



-- ---------- MATCHES ----------
create table if not exists public.matches (
  id uuid default uuid_generate_v4() not null,
  user_a uuid,
  user_b uuid,
  matched_at timestamp with time zone default now(),
  icebreaker_text text,
  icebreaker_generated_at timestamp with time zone,
  source_gathering_id uuid,
  reminder_sent_at timestamp with time zone,
  disappearing_messages_enabled boolean default false,
  disappearing_mode text default 'off'::text,
  first_message_sent boolean default false,
  source_friendship_id uuid,
  constraint no_self_match CHECK ((user_a <> user_b)),
  constraint matches_source_friendship_id_fkey FOREIGN KEY (source_friendship_id) REFERENCES friendships(id) ON DELETE SET NULL,
  constraint matches_source_gathering_id_fkey FOREIGN KEY (source_gathering_id) REFERENCES gatherings(id) ON DELETE SET NULL,
  constraint matches_user_a_fkey FOREIGN KEY (user_a) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint matches_user_b_fkey FOREIGN KEY (user_b) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint matches_pkey PRIMARY KEY (id),
  constraint matches_user_a_user_b_key UNIQUE (user_a, user_b)
);

alter table public.matches enable row level security;





-- ---------- CONSTITUTION_ENTRIES ----------
create table if not exists public.constitution_entries (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  added_by uuid,
  article text not null,
  entry_text text not null,
  created_at timestamp with time zone default now(),
  constraint constitution_entries_added_by_fkey FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint constitution_entries_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint constitution_entries_pkey PRIMARY KEY (id)
);

alter table public.constitution_entries enable row level security;





-- ---------- DATE_CHECKINS ----------
create table if not exists public.date_checkins (
  id uuid default uuid_generate_v4() not null,
  user_id uuid,
  match_id uuid,
  scheduled_at timestamp with time zone not null,
  status text default 'pending'::text,
  created_at timestamp with time zone default now(),
  constraint date_checkins_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint date_checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint date_checkins_pkey PRIMARY KEY (id)
);

alter table public.date_checkins enable row level security;



-- ---------- GATHERING_INTEREST ----------
create table if not exists public.gathering_interest (
  id uuid default uuid_generate_v4() not null,
  gathering_id uuid,
  user_id uuid,
  status text default 'pending'::text,
  match_id uuid,
  created_at timestamp with time zone default now(),
  on_my_way_at timestamp with time zone,
  checked_in_at timestamp with time zone,
  constraint gathering_interest_gathering_id_fkey FOREIGN KEY (gathering_id) REFERENCES gatherings(id) ON DELETE CASCADE,
  constraint gathering_interest_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL,
  constraint gathering_interest_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint gathering_interest_pkey PRIMARY KEY (id),
  constraint gathering_interest_gathering_id_user_id_key UNIQUE (gathering_id, user_id)
);

alter table public.gathering_interest enable row level security;







-- ---------- MEMORY_VAULT_ITEMS ----------
create table if not exists public.memory_vault_items (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  added_by uuid,
  category text not null,
  memory_text text not null,
  created_at timestamp with time zone default now(),
  constraint memory_vault_items_added_by_fkey FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint memory_vault_items_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint memory_vault_items_pkey PRIMARY KEY (id)
);

alter table public.memory_vault_items enable row level security;





-- ---------- MESSAGES ----------
create table if not exists public.messages (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  sender_id uuid,
  body text not null,
  created_at timestamp with time zone default now(),
  gif_url text,
  read_at timestamp with time zone,
  audio_url text,
  media_url text,
  media_type text,
  constraint messages_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint messages_pkey PRIMARY KEY (id)
);

alter table public.messages enable row level security;






-- ---------- MESSAGE_REACTIONS ----------
create table if not exists public.message_reactions (
  id uuid default uuid_generate_v4() not null,
  message_id uuid,
  user_id uuid,
  emoji text not null,
  created_at timestamp with time zone default now(),
  constraint message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  constraint message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint message_reactions_pkey PRIMARY KEY (id),
  constraint message_reactions_message_id_user_id_key UNIQUE (message_id, user_id)
);

alter table public.message_reactions enable row level security;






-- ---------- NOTICES ----------
create table if not exists public.notices (
  id uuid default uuid_generate_v4() not null,
  from_user uuid,
  to_user uuid,
  created_at timestamp with time zone default now(),
  is_super boolean default false,
  constraint no_self_notice CHECK ((from_user <> to_user)),
  constraint notices_from_user_fkey FOREIGN KEY (from_user) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint notices_to_user_fkey FOREIGN KEY (to_user) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint notices_pkey PRIMARY KEY (id),
  constraint notices_from_user_to_user_key UNIQUE (from_user, to_user)
);

alter table public.notices enable row level security;






-- ---------- OFFER_REDEMPTIONS ----------
-- Patched 2026-08-09 (baseline refresh) to match live production: gained
-- confirmation_code/confirmed_at/confirmed_by from the proof-of-redemption
-- pass (20260809_offer_redemption_proof.sql), applied after the original
-- pull was generated. See CLAUDE.md's "schema baseline fix" section.
create table if not exists public.offer_redemptions (
  id uuid default uuid_generate_v4() not null,
  offer_id uuid,
  user_id uuid,
  redeemed_at timestamp with time zone default now(),
  invoice_id uuid,
  confirmation_code text default lpad((floor((random() * (1000000)::double precision)))::text, 6, '0'::text),
  confirmed_at timestamp with time zone,
  confirmed_by uuid,
  constraint offer_redemptions_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES business_invoices(id),
  constraint offer_redemptions_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES brand_offers(id) ON DELETE CASCADE,
  constraint offer_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint offer_redemptions_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES profiles(id),
  constraint offer_redemptions_pkey PRIMARY KEY (id),
  constraint offer_redemptions_offer_id_user_id_key UNIQUE (offer_id, user_id)
);

alter table public.offer_redemptions enable row level security;

CREATE INDEX idx_offer_redemptions_invoice_id ON public.offer_redemptions USING btree (invoice_id);
CREATE UNIQUE INDEX offer_redemptions_pending_code_key ON public.offer_redemptions USING btree (confirmation_code) WHERE (confirmed_at IS NULL);

create policy "Users can redeem offers they're eligible for"
  on public.offer_redemptions
  as permissive
  for insert
  to authenticated
  with check (((auth.uid() = user_id) AND (confirmed_at IS NULL) AND (confirmed_by IS NULL) AND (EXISTS ( SELECT 1
   FROM brand_offers bo
  WHERE ((bo.id = offer_redemptions.offer_id) AND (bo.active = true) AND ((bo.expires_at IS NULL) OR (bo.expires_at > now())) AND ((bo.gathering_id IS NULL) OR (EXISTS ( SELECT 1
           FROM gathering_interest gi
          WHERE ((gi.gathering_id = bo.gathering_id) AND (gi.user_id = auth.uid()) AND (gi.status = 'approved'::text))))))))));




-- ---------- PRESENCE_REPORTS ----------
create table if not exists public.presence_reports (
  user_id uuid not null,
  area text not null,
  reported_at timestamp with time zone default now(),
  constraint presence_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint presence_reports_pkey PRIMARY KEY (user_id)
);

alter table public.presence_reports enable row level security;


-- ---------- PROFILE_PHOTOS ----------
create table if not exists public.profile_photos (
  id uuid default uuid_generate_v4() not null,
  user_id uuid,
  photo_url text not null,
  position integer default 0 not null,
  photo_verified boolean default false,
  created_at timestamp with time zone default now(),
  constraint profile_photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint profile_photos_pkey PRIMARY KEY (id)
);

alter table public.profile_photos enable row level security;




-- ---------- REFERRAL_REDEMPTIONS ----------
create table if not exists public.referral_redemptions (
  id uuid default uuid_generate_v4() not null,
  referrer_id uuid,
  referred_id uuid,
  redeemed_at timestamp with time zone default now(),
  constraint referral_redemptions_referred_id_fkey FOREIGN KEY (referred_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint referral_redemptions_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint referral_redemptions_pkey PRIMARY KEY (id),
  constraint referral_redemptions_referred_id_key UNIQUE (referred_id)
);

alter table public.referral_redemptions enable row level security;


-- ---------- RELATIONSHIP_LEGACY_ENTRIES ----------
create table if not exists public.relationship_legacy_entries (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  submitted_by uuid,
  what_surprised_us text,
  what_almost_ended_us text,
  what_made_us_stronger text,
  what_we_wish_we_discussed_earlier text,
  created_at timestamp with time zone default now(),
  constraint relationship_legacy_entries_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint relationship_legacy_entries_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint relationship_legacy_entries_pkey PRIMARY KEY (id)
);

alter table public.relationship_legacy_entries enable row level security;




-- ---------- REPORTS ----------
create table if not exists public.reports (
  id uuid default uuid_generate_v4() not null,
  reporter_id uuid,
  reported_id uuid,
  reason text not null,
  details text,
  created_at timestamp with time zone default now(),
  resolved boolean default false,
  constraint reports_reported_id_fkey FOREIGN KEY (reported_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint reports_pkey PRIMARY KEY (id)
);

alter table public.reports enable row level security;






-- ---------- REVIEW_LOGIN_ATTEMPTS ----------
create table if not exists public.review_login_attempts (
  id uuid default gen_random_uuid() not null,
  ip_address text not null,
  attempted_at timestamp with time zone default now() not null,
  constraint review_login_attempts_pkey PRIMARY KEY (id)
);

alter table public.review_login_attempts enable row level security;

CREATE INDEX idx_review_login_attempts_ip_time ON public.review_login_attempts USING btree (ip_address, attempted_at);


-- ---------- SHARED_DECISIONS ----------
create table if not exists public.shared_decisions (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  added_by uuid,
  category text not null,
  note_text text not null,
  created_at timestamp with time zone default now(),
  constraint shared_decisions_added_by_fkey FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint shared_decisions_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint shared_decisions_pkey PRIMARY KEY (id)
);

alter table public.shared_decisions enable row level security;





-- ---------- SHARED_PLAYLIST_ITEMS ----------
create table if not exists public.shared_playlist_items (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  added_by uuid,
  song_title text not null,
  artist text,
  created_at timestamp with time zone default now(),
  spotify_track_id text,
  album_art text,
  preview_url text,
  constraint shared_playlist_items_added_by_fkey FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint shared_playlist_items_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint shared_playlist_items_pkey PRIMARY KEY (id)
);

alter table public.shared_playlist_items enable row level security;





-- ---------- SIGHTINGS ----------
create table if not exists public.sightings (
  id uuid default uuid_generate_v4() not null,
  user_a uuid,
  user_b uuid,
  approx_area text,
  first_seen_at timestamp with time zone default now(),
  last_seen_at timestamp with time zone default now(),
  expires_at timestamp with time zone default (now() + '48:00:00'::interval),
  constraint sightings_user_a_fkey FOREIGN KEY (user_a) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint sightings_user_b_fkey FOREIGN KEY (user_b) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint sightings_pkey PRIMARY KEY (id),
  constraint sightings_user_a_user_b_key UNIQUE (user_a, user_b)
);

alter table public.sightings enable row level security;



-- ---------- SOCIAL_INVITES ----------
create table if not exists public.social_invites (
  id uuid default gen_random_uuid() not null,
  inviter_id uuid not null,
  invitee_id uuid not null,
  invite_type text not null,
  target_id uuid not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  responded_at timestamp with time zone,
  constraint social_invites_invite_type_check CHECK ((invite_type = ANY (ARRAY['gathering'::text, 'community'::text]))),
  constraint social_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))),
  constraint social_invites_invitee_id_fkey FOREIGN KEY (invitee_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint social_invites_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint social_invites_pkey PRIMARY KEY (id)
);

alter table public.social_invites enable row level security;

CREATE INDEX social_invites_invitee_idx ON public.social_invites USING btree (invitee_id, status);
CREATE UNIQUE INDEX social_invites_pending_unique ON public.social_invites USING btree (inviter_id, invitee_id, invite_type, target_id) WHERE (status = 'pending'::text);



-- ---------- STORIES ----------
create table if not exists public.stories (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  media_path text not null,
  media_type text default 'image'::text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '24:00:00'::interval) not null,
  is_public boolean default false,
  latitude double precision,
  longitude double precision,
  gathering_id uuid,
  constraint stories_gathering_id_fkey FOREIGN KEY (gathering_id) REFERENCES gatherings(id) ON DELETE SET NULL,
  constraint stories_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint stories_pkey PRIMARY KEY (id)
);

alter table public.stories enable row level security;






-- ---------- STORY_VIEWS ----------
create table if not exists public.story_views (
  id uuid default gen_random_uuid() not null,
  story_id uuid not null,
  viewer_id uuid not null,
  viewed_at timestamp with time zone default now() not null,
  constraint story_views_story_id_fkey FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  constraint story_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint story_views_pkey PRIMARY KEY (id),
  constraint story_views_story_id_viewer_id_key UNIQUE (story_id, viewer_id)
);

alter table public.story_views enable row level security;




-- ---------- STRESS_TEST_NOTES ----------
create table if not exists public.stress_test_notes (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  added_by uuid,
  scenario text not null,
  note_text text not null,
  created_at timestamp with time zone default now(),
  constraint stress_test_notes_added_by_fkey FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint stress_test_notes_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint stress_test_notes_pkey PRIMARY KEY (id)
);

alter table public.stress_test_notes enable row level security;





-- ---------- TIMELINE_NOTES ----------
create table if not exists public.timeline_notes (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  added_by uuid,
  period text not null,
  note_text text not null,
  created_at timestamp with time zone default now(),
  constraint timeline_notes_added_by_fkey FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint timeline_notes_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint timeline_notes_pkey PRIMARY KEY (id)
);

alter table public.timeline_notes enable row level security;





-- ---------- TRIP_IDEAS ----------
create table if not exists public.trip_ideas (
  id uuid default uuid_generate_v4() not null,
  match_id uuid,
  added_by uuid,
  category text not null,
  idea_text text not null,
  created_at timestamp with time zone default now(),
  constraint trip_ideas_added_by_fkey FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint trip_ideas_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  constraint trip_ideas_pkey PRIMARY KEY (id)
);

alter table public.trip_ideas enable row level security;





-- ==================== FUNCTIONS (101) ====================

-- ---------- FUNCTION: admin_approve_id_verification (oid 20395, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.admin_approve_id_verification(submission_id_param uuid, approved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review verification submissions';
  end if;

  update id_verification_submissions
  set status = case when approved then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = submission_id_param and status = 'pending'
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Submission not found or already reviewed';
  end if;

  if approved then
    perform set_config('app.trusted_update', 'true', true);
    update profiles set photo_verified = true where id = v_user_id;
  end if;
end;
$function$
;

-- ---------- FUNCTION: approve_business_partner_request (oid 19833, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.approve_business_partner_request(request_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  new_partner_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param;
  if req is null then
    raise exception 'Request not found';
  end if;

  insert into brand_partners (name, description, active)
  values (req.business_name, req.business_description, true)
  returning id into new_partner_id;

  -- Required now that managed_partner_id is protected against
  -- self-editing — this legitimate, admin-approved update needs to
  -- go through the same trusted path other server-side writes to
  -- protected profile fields already use.
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now()
  where id = request_id_param;

  return new_partner_id;
end;
$function$
;

-- ---------- FUNCTION: approve_gathering_interest (oid 20454, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.approve_gathering_interest(interest_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gathering_id uuid;
  v_interested_user_id uuid;
  v_host_id uuid;
  v_women_only boolean;
  v_capacity integer;
  v_interested_gender text;
  v_new_match_id uuid;
  v_is_blocked boolean;
  v_approved_count integer;
begin
  select gathering_id, user_id into v_gathering_id, v_interested_user_id
  from gathering_interest where id = interest_id;

  select host_id, women_only, capacity into v_host_id, v_women_only, v_capacity
  from gatherings where id = v_gathering_id for update;

  if v_host_id != auth.uid() then
    raise exception 'Only the host can approve interest';
  end if;
  if v_host_id = v_interested_user_id then
    raise exception 'Cannot match with yourself';
  end if;
  if v_women_only then
    select gender into v_interested_gender from profiles where id = v_interested_user_id;
    if lower(coalesce(v_interested_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_interested_user_id)
    or (blocker_id = v_interested_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot approve interest from a blocked user';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = v_gathering_id and status = 'approved';

  if v_capacity is not null and v_approved_count >= v_capacity then
    update gathering_interest set status = 'waitlisted' where id = interest_id;
    return jsonb_build_object('status', 'waitlisted', 'match_id', null);
  end if;

  update gathering_interest set status = 'approved' where id = interest_id;
  insert into matches (user_a, user_b, source_gathering_id)
  values (least(v_host_id, v_interested_user_id), greatest(v_host_id, v_interested_user_id), v_gathering_id)
  on conflict (user_a, user_b) do update
    set source_gathering_id = v_gathering_id
    where matches.source_gathering_id is null
  returning id into v_new_match_id;
  if v_new_match_id is null then
    select id into v_new_match_id from matches
    where user_a = least(v_host_id, v_interested_user_id) and user_b = greatest(v_host_id, v_interested_user_id);
  end if;
  return jsonb_build_object('status', 'approved', 'match_id', v_new_match_id);
end;
$function$
;

-- ---------- FUNCTION: block_and_unmatch (oid 18779, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.block_and_unmatch(blocked_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_blocker_id uuid := auth.uid();
begin
  insert into blocks (blocker_id, blocked_id)
  values (v_blocker_id, blocked_user_id)
  on conflict do nothing;

  delete from matches
  where (user_a = v_blocker_id and user_b = blocked_user_id)
     or (user_a = blocked_user_id and user_b = v_blocker_id);

  -- Same reasoning as unmatch: clear notice history too, so stale
  -- mutual-notice records can't linger and cause confusing state if
  -- this person is ever unblocked later.
  delete from notices
  where (from_user = v_blocker_id and to_user = blocked_user_id)
     or (from_user = blocked_user_id and to_user = v_blocker_id);
end;
$function$
;

-- ---------- FUNCTION: check_and_increment_ai_use (oid 19456, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.check_and_increment_ai_use(user_id_param uuid, daily_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
begin
  if auth.uid() is not null and auth.uid() <> user_id_param then
    return false;
  end if;
  select ai_uses_today, ai_uses_date, coalesce(timezone, 'UTC') into v_current_count, v_current_date, v_timezone
  from profiles where id = user_id_param for update;
  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;
  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;
  if v_current_count >= daily_limit then
    return false;
  end if;
  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set ai_uses_today = v_current_count + 1, ai_uses_date = v_today_in_user_tz
  where id = user_id_param;
  return true;
end;
$function$
;

-- ---------- FUNCTION: check_in_to_gathering (oid 20275, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.check_in_to_gathering(gathering_id_param uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update gathering_interest
  set checked_in_at = coalesce(checked_in_at, now())
  where gathering_id = gathering_id_param
    and user_id = auth.uid()
    and status = 'approved';
$function$
;

-- ---------- FUNCTION: check_is_admin (oid 18391, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.check_is_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(is_admin, false) from profiles where id = uid;
$function$
;

-- ---------- FUNCTION: check_mutual_notice (oid 18293, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.check_mutual_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  matched_user_a uuid;
  matched_user_b uuid;
  new_match_id uuid;
  sender_name text;
  recipient_name text;
  to_user_wants_notif boolean;
  from_user_wants_notif boolean;
begin
  if exists (
    select 1 from notices
    where from_user = new.to_user and to_user = new.from_user
  ) then
    matched_user_a := least(new.from_user, new.to_user);
    matched_user_b := greatest(new.from_user, new.to_user);
    insert into matches (user_a, user_b)
    values (matched_user_a, matched_user_b)
    on conflict do nothing
    returning id into new_match_id;
    if new_match_id is not null then
      select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      select display_name into sender_name from profiles where id = new.from_user;
      select display_name into recipient_name from profiles where id = new.to_user;

      -- Respect each person's own notify_matches preference — this
      -- previously sent unconditionally regardless of opt-out.
      select coalesce(notify_matches, true) into to_user_wants_notif from profiles where id = new.to_user;
      select coalesce(notify_matches, true) into from_user_wants_notif from profiles where id = new.from_user;

      if to_user_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', new.to_user,
            'title', 'It''s a Match! 🎉',
            'body', 'You and ' || coalesce(sender_name, 'someone') || ' noticed each other.',
            'data', jsonb_build_object('type', 'new_match', 'match_id', new_match_id)
          )
        );
      end if;

      if from_user_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', new.from_user,
            'title', 'It''s a Match! 🎉',
            'body', 'You and ' || coalesce(recipient_name, 'someone') || ' noticed each other.',
            'data', jsonb_build_object('type', 'new_match', 'match_id', new_match_id)
          )
        );
      end if;
    end if;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: confirm_offer_redemption (oid unknown, SECURITY DEFINER) ----------
-- Added 2026-08-09 (baseline refresh) — new since the original pull was generated. See CLAUDE.md's "schema baseline fix" section.
CREATE OR REPLACE FUNCTION public.confirm_offer_redemption(code_param text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_redemption record;
  v_offer record;
begin
  select r.* into v_redemption
  from offer_redemptions r
  where r.confirmation_code = code_param and r.confirmed_at is null;

  if v_redemption is null then
    return jsonb_build_object('success', false, 'error', 'No pending redemption found with that code.');
  end if;

  select o.*, bp.name as partner_name into v_offer
  from brand_offers o
  join brand_partners bp on bp.id = o.partner_id
  where o.id = v_redemption.offer_id;

  if not exists (
    select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = v_offer.partner_id
  ) then
    return jsonb_build_object('success', false, 'error', 'That code isn''t for one of your offers.');
  end if;

  update offer_redemptions
  set confirmed_at = now(), confirmed_by = auth.uid()
  where id = v_redemption.id;

  return jsonb_build_object(
    'success', true,
    'offerTitle', v_offer.title,
    'redeemedByName', (select display_name from profiles where id = v_redemption.user_id)
  );
end;
$function$
;

-- ---------- FUNCTION: count_gatherings_near (oid 20009, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.count_gatherings_near(lat_param double precision, lng_param double precision)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::integer
  from gatherings
  where scheduled_at >= now()
  and precise_lat between lat_param - 0.001 and lat_param + 0.001
  and precise_lng between lng_param - 0.001 and lng_param + 0.001;
$function$
;

-- ---------- FUNCTION: count_gatherings_near_batch (oid 20010, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.count_gatherings_near_batch(lats double precision[], lngs double precision[])
 RETURNS TABLE(idx integer, gathering_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    q.idx,
    (
      select count(*)::integer
      from gatherings g
      where g.scheduled_at >= now()
      and g.precise_lat between q.lat - 0.001 and q.lat + 0.001
      and g.precise_lng between q.lng - 0.001 and q.lng + 0.001
    ) as gathering_count
  from unnest(lats, lngs) with ordinality as q(lat, lng, idx)
$function$
;

-- ---------- FUNCTION: count_redemptions_since (oid 20059, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.count_redemptions_since(offer_ids uuid[], since_time timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::integer
  from offer_redemptions r
  where r.offer_id = any(offer_ids)
  and r.redeemed_at >= since_time;
$function$
;

-- ---------- FUNCTION: create_match_on_friendship_accepted (oid 19629, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.create_match_on_friendship_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    insert into matches (user_a, user_b, source_friendship_id)
    values (least(new.user_a, new.user_b), greatest(new.user_a, new.user_b), new.id)
    on conflict (user_a, user_b) do update
      -- If a match already existed from a different source (e.g.
      -- they'd matched romantically first, then later became
      -- friends), reflect the new friendship rather than silently
      -- leaving the existing row permanently misclassified as
      -- purely romantic.
      set source_friendship_id = new.id
      where matches.source_friendship_id is null;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: deactivate_offer_on_gathering_delete (oid 20001, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.deactivate_offer_on_gathering_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Preserves redemption history (the offer row itself survives via
  -- SET NULL), but explicitly deactivates it too — otherwise an
  -- attendance-gated offer would silently become a general,
  -- unrestricted, publicly redeemable offer the moment its
  -- gathering_id goes null, bypassing the whole point of attaching
  -- it to a specific gathering in the first place.
  update brand_offers set active = false where gathering_id = old.id;
  return old;
end;
$function$
;

-- ---------- FUNCTION: delete_expired_disappearing_messages (oid 19402, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.delete_expired_disappearing_messages()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- 24-hour mode: delete based on when the message was sent.
  delete from messages
  where match_id in (select id from matches where disappearing_mode = '24h')
    and created_at < now() - interval '24 hours';

  -- Instant mode: delete a short 10 seconds after the recipient
  -- actually read it — enough time to genuinely see the message,
  -- but not relying on the app staying open at the exact moment.
  delete from messages
  where match_id in (select id from matches where disappearing_mode = 'instant')
    and read_at is not null
    and read_at < now() - interval '10 seconds';
end;
$function$
;

-- ---------- FUNCTION: delete_expired_stories (oid 19546, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.delete_expired_stories()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  expired_paths text[];
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  -- Gathering-linked stories are deliberately excluded — they're
  -- meant to persist as archived memories of the experience, not
  -- expire on the normal 24-hour personal-story timer. If the
  -- gathering itself is ever deleted, gathering_id goes null via
  -- the foreign key, and the story naturally becomes subject to
  -- normal expiry on the next run.
  select array_agg(media_path) into expired_paths
  from stories
  where expires_at <= now()
  and gathering_id is null;

  if expired_paths is not null and array_length(expired_paths, 1) > 0 then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/storage/v1/object/stories',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object('prefixes', expired_paths)
    );
  end if;

  delete from stories where expires_at <= now() and gathering_id is null;
end;
$function$
;

-- ---------- FUNCTION: enforce_community_daily_limit (oid 20029, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.enforce_community_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 3;
begin
  select communities_created_today, communities_created_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.creator_id for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can create up to % communities per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set communities_created_today = v_current_count + 1, communities_created_date = v_today_in_user_tz
  where id = new.creator_id;

  return new;
end;
$function$
;

-- ---------- FUNCTION: enforce_friend_request_daily_limit (oid 20032, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.enforce_friend_request_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 15;
begin
  select friend_requests_sent_today, friend_requests_sent_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.requested_by for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can send up to % friend requests per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set friend_requests_sent_today = v_current_count + 1, friend_requests_sent_date = v_today_in_user_tz
  where id = new.requested_by;

  return new;
end;
$function$
;

-- ---------- FUNCTION: enforce_gathering_daily_limit (oid 20027, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.enforce_gathering_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 10;
begin
  select gatherings_created_today, gatherings_created_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.host_id for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can create up to % gatherings per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set gatherings_created_today = v_current_count + 1, gatherings_created_date = v_today_in_user_tz
  where id = new.host_id;

  return new;
end;
$function$
;

-- ---------- FUNCTION: enforce_notice_daily_limit (oid 18774, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.enforce_notice_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_user_premium boolean;
  today_notice_count integer;
begin
  select is_premium into is_user_premium from profiles where id = new.from_user;

  if not is_user_premium then
    select count(*) into today_notice_count
    from notices
    where from_user = new.from_user
      and created_at > now() - interval '24 hours';

    if today_notice_count >= 5 then
      raise exception 'Free users can send up to 5 Notices per day. Upgrade to Premium for unlimited Notices.';
    end if;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: enforce_offer_redemption_limit (oid 20054, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.enforce_offer_redemption_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_limit integer;
  v_current_count integer;
begin
  -- select ... for update locks the brand_offers row for the
  -- duration of this transaction, forcing concurrent redemption
  -- attempts on the same offer to wait their turn rather than both
  -- reading the same stale count under READ COMMITTED isolation —
  -- without this, two simultaneous redemptions right at the limit
  -- could both slip through.
  select redemption_limit into v_limit from brand_offers where id = new.offer_id for update;

  if v_limit is not null then
    select count(*) into v_current_count from offer_redemptions where offer_id = new.offer_id;
    if v_current_count >= v_limit then
      raise exception 'REDEMPTION_LIMIT_REACHED';
    end if;
  end if;

  return new;
end;
$function$
;

-- ---------- FUNCTION: enforce_offer_unlock_threshold (oid 20352, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.enforce_offer_unlock_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope text;
  v_community_id uuid;
  v_min_members integer;
  v_gathering_id uuid;
  v_current_count integer;
begin
  select unlock_scope, unlock_community_id, unlock_min_members, gathering_id
    into v_scope, v_community_id, v_min_members, v_gathering_id
    from brand_offers
    where id = new.offer_id;

  if v_scope is null then
    return new;
  end if;

  if v_scope = 'community' then
    select count(*) into v_current_count
      from community_members
      where community_id = v_community_id;
  else
    select count(*) into v_current_count
      from gathering_interest
      where gathering_id = v_gathering_id and status = 'approved';
  end if;

  if v_current_count < v_min_members then
    raise exception 'OFFER_LOCKED';
  end if;

  return new;
end;
$function$
;

-- ---------- FUNCTION: enforce_story_daily_limit (oid 20035, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.enforce_story_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 20;
begin
  select stories_posted_today, stories_posted_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.user_id for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can post up to % stories per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set stories_posted_today = v_current_count + 1, stories_posted_date = v_today_in_user_tz
  where id = new.user_id;

  return new;
end;
$function$
;

-- ---------- FUNCTION: enforce_super_notice_limit (oid 18685, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.enforce_super_notice_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_user_premium boolean;
  recent_super_count integer;
begin
  if new.is_super = true then
    select is_premium into is_user_premium from profiles where id = new.from_user;
    if not is_user_premium then
      select count(*) into recent_super_count
      from notices
      where from_user = new.from_user
        and is_super = true
        and created_at > now() - interval '7 days';
      if recent_super_count >= 1 then
        raise exception 'Free users can only send 1 Super Notice per week. Upgrade to Premium for unlimited.';
      end if;
    end if;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: expire_live_tracking_sessions (oid 19427, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.expire_live_tracking_sessions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update live_tracking_sessions
  set active = false
  where active = true and expires_at <= now();
end;
$function$
;

-- ---------- FUNCTION: generate_monthly_invoices (oid 20210, SECURITY DEFINER) ----------
-- Patched 2026-08-09 (baseline refresh) to match live production, reflecting changes applied after the original pull was generated. See CLAUDE.md's "schema baseline fix" section.
CREATE OR REPLACE FUNCTION public.generate_monthly_invoices(period_start_param date DEFAULT NULL::date, period_end_param date DEFAULT NULL::date)
 RETURNS SETOF business_invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_period_start date;
  v_period_end date;
  v_contract record;
  v_effective_start date;
  v_effective_end date;
  v_redemption_ids uuid[];
  v_redemption_count int;
  v_billable_count int;
  v_amount numeric(10,2);
  v_invoice business_invoices%rowtype;
begin
  v_period_start := coalesce(period_start_param, date_trunc('month', now() - interval '1 month')::date);
  v_period_end := coalesce(period_end_param, (date_trunc('month', now()) - interval '1 day')::date);

  for v_contract in
    select distinct on (partner_id) *
    from partner_contracts
    where status = 'active'
      and contract_start <= v_period_end
      and (contract_end is null or contract_end >= v_period_start)
    order by partner_id, created_at desc
  loop
    if exists (
      select 1 from business_invoices
      where partner_id = v_contract.partner_id
        and period_start = v_period_start
        and period_end = v_period_end
    ) then
      continue;
    end if;

    v_effective_start := greatest(v_period_start, v_contract.contract_start);
    v_effective_end := least(v_period_end, coalesce(v_contract.contract_end, v_period_end));

    with locked as (
      select r.id
      from offer_redemptions r
      join brand_offers o on o.id = r.offer_id
      where o.partner_id = v_contract.partner_id
        and r.invoice_id is null
        and r.confirmed_at is not null
        and r.redeemed_at >= v_effective_start
        and r.redeemed_at < v_effective_end + interval '1 day'
      for update of r
    )
    select array_agg(id) into v_redemption_ids from locked;

    v_redemption_count := coalesce(array_length(v_redemption_ids, 1), 0);
    v_billable_count := greatest(v_redemption_count - v_contract.included_units, 0);

    v_amount := case v_contract.billing_model
      when 'per_redemption' then v_billable_count * v_contract.redemption_fee
      when 'flat_monthly' then v_contract.monthly_fee
      when 'hybrid' then v_contract.monthly_fee + (v_billable_count * v_contract.redemption_fee)
      else 0
    end;

    if v_contract.max_monthly_spend is not null then
      v_amount := least(v_amount, v_contract.max_monthly_spend);
    end if;

    insert into business_invoices (partner_id, period_start, period_end, redemption_count, amount_due, status)
    values (v_contract.partner_id, v_period_start, v_period_end, v_redemption_count, v_amount, 'draft')
    returning * into v_invoice;

    if v_redemption_ids is not null then
      update offer_redemptions set invoice_id = v_invoice.id where id = any(v_redemption_ids);
    end if;

    if v_contract.contract_end is not null and v_contract.contract_end <= v_period_end then
      if v_contract.auto_renew then
        update partner_contracts
          set contract_end = contract_end + interval '1 month'
          where id = v_contract.id;
      else
        update partner_contracts set status = 'expired' where id = v_contract.id;
      end if;
    end if;

    return next v_invoice;
  end loop;
end;
$function$
;

-- ---------- FUNCTION: generate_next_recurring_gathering (oid 19857, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.generate_next_recurring_gathering()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  past_recurring record;
  next_scheduled_at timestamptz;
  interval_step interval;
  new_gathering_id uuid;
  service_key text;
  past_attendee record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for past_recurring in
    select g.*
    from gatherings g
    where g.recurring_series_id is not null
    and g.scheduled_at < now()
    and g.series_stopped = false
    and not exists (
      select 1 from gatherings g2
      where g2.recurring_series_id = g.recurring_series_id
      and g2.scheduled_at >= now()
    )
    and not exists (
      select 1 from gatherings g4
      where g4.recurring_series_id = g.recurring_series_id
      and g4.series_stopped = true
    )
    and g.id = (
      select g3.id from gatherings g3
      where g3.recurring_series_id = g.recurring_series_id
      order by g3.scheduled_at desc
      limit 1
    )
  loop
    interval_step := case past_recurring.recurrence_rule
      when 'weekly' then interval '7 days'
      when 'biweekly' then interval '14 days'
      when 'monthly' then interval '1 month'
      else null
    end;

    if interval_step is not null then
      -- Keep advancing by the interval until we land on a genuinely
      -- future date — if an instance was cancelled and this cron
      -- didn't run for a while, blindly adding one interval to the
      -- last known date could still land in the past.
      next_scheduled_at := past_recurring.scheduled_at + interval_step;
      while next_scheduled_at <= now() loop
        next_scheduled_at := next_scheduled_at + interval_step;
      end loop;

      insert into gatherings (
        host_id, title, description, interest_tag, area, scheduled_at, wide_area,
        is_public, show_on_map, women_only, community_id, hosting_partner_id,
        recurrence_rule, recurring_series_id
      )
      values (
        past_recurring.host_id, past_recurring.title, past_recurring.description, past_recurring.interest_tag,
        past_recurring.area, next_scheduled_at, past_recurring.wide_area,
        past_recurring.is_public, past_recurring.show_on_map, past_recurring.women_only,
        past_recurring.community_id, past_recurring.hosting_partner_id,
        past_recurring.recurrence_rule, past_recurring.recurring_series_id
      )
      returning id into new_gathering_id;

      for past_attendee in
        select distinct gi.user_id
        from gathering_interest gi
        where gi.gathering_id = past_recurring.id
        and gi.status = 'approved'
      loop
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', past_attendee.user_id,
            'title', '🔁 ' || past_recurring.title,
            'body', 'It''s happening again — tap to rejoin.',
            'data', jsonb_build_object('type', 'recurring_gathering', 'gathering_id', new_gathering_id)
          )
        );
      end loop;
    end if;
  end loop;
end;
$function$
;

-- ---------- FUNCTION: get_business_dashboard_stats (oid 19773, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_business_dashboard_stats(partner_id_param uuid)
 RETURNS TABLE(total_followers bigint, followers_this_month bigint, total_redemptions bigint, redemptions_this_month bigint, repeat_redeemers bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return query select 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  return query
  select
    (select count(*) from business_followers where brand_partner_id = partner_id_param) as total_followers,
    (select count(*) from business_followers where brand_partner_id = partner_id_param and opted_in_at >= date_trunc('month', now())) as followers_this_month,
    (select count(*) from offer_redemptions r join brand_offers o on o.id = r.offer_id where o.partner_id = partner_id_param) as total_redemptions,
    (select count(*) from offer_redemptions r join brand_offers o on o.id = r.offer_id where o.partner_id = partner_id_param and r.redeemed_at >= date_trunc('month', now())) as redemptions_this_month,
    (
      select count(*) from (
        select r.user_id
        from offer_redemptions r
        join brand_offers o on o.id = r.offer_id
        where o.partner_id = partner_id_param
        group by r.user_id
        having count(*) > 1
      ) repeat_users
    ) as repeat_redeemers;
end;
$function$
;

-- ---------- FUNCTION: get_business_follower_count (oid 20290, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_business_follower_count(partner_id_param uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*) from business_followers where brand_partner_id = partner_id_param;
$function$
;

-- ---------- FUNCTION: get_business_growth (oid 19859, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_business_growth(partner_id_param uuid)
 RETURNS TABLE(redemptions_growth_pct numeric, followers_growth_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return query select null::numeric, null::numeric;
    return;
  end if;

  return query
  with this_month as (
    select count(*) as cnt from offer_redemptions r
    join brand_offers o on o.id = r.offer_id
    where o.partner_id = partner_id_param
    and r.redeemed_at >= date_trunc('month', now())
  ),
  last_month as (
    select count(*) as cnt from offer_redemptions r
    join brand_offers o on o.id = r.offer_id
    where o.partner_id = partner_id_param
    and r.redeemed_at >= date_trunc('month', now()) - interval '1 month'
    and r.redeemed_at < date_trunc('month', now())
  ),
  followers_this_month as (
    select count(*) as cnt from business_followers
    where brand_partner_id = partner_id_param
    and opted_in_at >= date_trunc('month', now())
  ),
  followers_last_month as (
    select count(*) as cnt from business_followers
    where brand_partner_id = partner_id_param
    and opted_in_at >= date_trunc('month', now()) - interval '1 month'
    and opted_in_at < date_trunc('month', now())
  )
  select
    case when lm.cnt > 0 then round(100.0 * (tm.cnt - lm.cnt) / lm.cnt, 0) else null end as redemptions_growth_pct,
    case when flm.cnt > 0 then round(100.0 * (ftm.cnt - flm.cnt) / flm.cnt, 0) else null end as followers_growth_pct
  from this_month tm, last_month lm, followers_this_month ftm, followers_last_month flm;
end;
$function$
;

-- ---------- FUNCTION: get_business_insights (oid 19834, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_business_insights(partner_id_param uuid)
 RETURNS TABLE(top_interests text[], best_hour_of_day integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return query select array[]::text[], null::integer;
    return;
  end if;

  return query
  select
    coalesce(
      (
        select array_agg(interest order by cnt desc)
        from (
          select interest, count(*) as cnt
          from business_followers bf
          join profiles p on p.id = bf.user_id
          cross join unnest(coalesce(p.interests, array[]::text[])) as interest
          where bf.brand_partner_id = partner_id_param
          group by interest
          order by cnt desc
          limit 5
        ) sub
      ),
      array[]::text[]
    ) as top_interests,
    (
      select extract(hour from g.scheduled_at)::int
      from gatherings g
      join gathering_interest gi on gi.gathering_id = g.id and gi.status = 'approved'
      where g.hosting_partner_id = partner_id_param
      group by extract(hour from g.scheduled_at)
      order by count(*) desc
      limit 1
    ) as best_hour_of_day;
end;
$function$
;

-- ---------- FUNCTION: get_business_member_gathering_history (oid 20291, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_business_member_gathering_history(partner_id_param uuid, member_id_param uuid)
 RETURNS TABLE(gathering_id uuid, title text, scheduled_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;

  return query
  select g.id, g.title, g.scheduled_at
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  where g.hosting_partner_id = partner_id_param
  and gi.status = 'approved'
  and gi.user_id = member_id_param
  order by g.scheduled_at desc;
end;
$function$
;

-- ---------- FUNCTION: get_business_top_members (oid 19901, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_business_top_members(partner_id_param uuid)
 RETURNS TABLE(user_id uuid, display_name text, gatherings_attended bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;

  return query
  select p.id, p.display_name, count(*) as gatherings_attended
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  join profiles p on p.id = gi.user_id
  where g.hosting_partner_id = partner_id_param
  and gi.status = 'approved'
  group by p.id, p.display_name
  order by gatherings_attended desc
  limit 5;
end;
$function$
;

-- ---------- FUNCTION: get_business_visit_frequency (oid 19902, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_business_visit_frequency(partner_id_param uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return null;
  end if;

  return (
    select round(avg(cnt), 1) from (
      select gi.user_id, count(*) as cnt
      from gathering_interest gi
      join gatherings g on g.id = gi.gathering_id
      where g.hosting_partner_id = partner_id_param
      and gi.status = 'approved'
      group by gi.user_id
    ) sub
  );
end;
$function$
;

-- ---------- FUNCTION: get_gathering_attendee_breakdown (oid 19858, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_gathering_attendee_breakdown(gathering_id_param uuid)
 RETURNS TABLE(total_attending bigint, new_attendees bigint, returning_attendees bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with this_gathering as (
    select gi.user_id, gi.created_at, g.host_id, g.recurring_series_id
    from gathering_interest gi
    join gatherings g on g.id = gi.gathering_id
    where gi.gathering_id = gathering_id_param and gi.status = 'approved'
  )
  select
    count(*) as total_attending,
    count(*) filter (
      where not exists (
        select 1 from gathering_interest gi2
        join gatherings g2 on g2.id = gi2.gathering_id
        where gi2.user_id = tg.user_id
        and g2.host_id = tg.host_id
        and gi2.status = 'approved'
        and gi2.created_at < tg.created_at
      )
    ) as new_attendees,
    count(*) filter (
      where exists (
        select 1 from gathering_interest gi2
        join gatherings g2 on g2.id = gi2.gathering_id
        where gi2.user_id = tg.user_id
        and g2.host_id = tg.host_id
        and gi2.status = 'approved'
        and gi2.created_at < tg.created_at
      )
    ) as returning_attendees
  from this_gathering tg;
$function$
;

-- ---------- FUNCTION: get_gathering_distances (oid 19400, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_gathering_distances(my_lat double precision, my_lng double precision, gathering_ids uuid[])
 RETURNS TABLE(id uuid, distance_miles double precision, fuzzed_lat double precision, fuzzed_lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    g.id,
    (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(my_lat)) * cos(radians(g.precise_lat)) * cos(radians(g.precise_lng) - radians(my_lng)) +
        sin(radians(my_lat)) * sin(radians(g.precise_lat))
      ))
    )) as distance_miles,
    g.precise_lat + (((('x' || substr(md5(g.id::text || 'lat'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lat,
    g.precise_lng + (((('x' || substr(md5(g.id::text || 'lng'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lng
  from gatherings g
  where g.id = any(gathering_ids)
    and g.precise_lat is not null
    and g.precise_lng is not null;
$function$
;

-- ---------- FUNCTION: get_gathering_meetup_point (oid 20276, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_gathering_meetup_point(gathering_id_param uuid)
 RETURNS TABLE(latitude numeric, longitude numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.precise_lat, g.precise_lng
  from gatherings g
  where g.id = gathering_id_param
    and (
      g.host_id = auth.uid()
      or exists (
        select 1 from gathering_interest gi
        where gi.gathering_id = g.id
          and gi.user_id = auth.uid()
          and gi.status = 'approved'
      )
    );
$function$
;

-- ---------- FUNCTION: get_host_reputation (oid 19856, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_host_reputation(host_id_param uuid)
 RETURNS TABLE(welcoming_pct numeric, would_return_pct numeric, feedback_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    round(100.0 * count(*) filter (where gf.felt_welcoming = true) / nullif(count(*) filter (where gf.felt_welcoming is not null), 0), 0) as welcoming_pct,
    round(100.0 * count(*) filter (where gf.would_attend_again = true) / nullif(count(*) filter (where gf.would_attend_again is not null), 0), 0) as would_return_pct,
    count(*) as feedback_count
  from gathering_feedback gf
  join gatherings g on g.id = gf.gathering_id
  where g.host_id = host_id_param;
$function$
;

-- ---------- FUNCTION: get_host_stats (oid 19661, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_host_stats(host_id_param uuid)
 RETURNS TABLE(gatherings_hosted bigint, avg_attendance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(distinct g.id) as gatherings_hosted,
    coalesce(avg(attendee_counts.cnt), 0) as avg_attendance
  from gatherings g
  left join (
    select gathering_id, count(*) as cnt
    from gathering_interest
    where status = 'approved'
    group by gathering_id
  ) attendee_counts on attendee_counts.gathering_id = g.id
  where g.host_id = host_id_param
  and g.scheduled_at < now();
$function$
;

-- ---------- FUNCTION: get_intention_change_count (oid 18818, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_intention_change_count(target_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  change_count integer;
begin
  select count(*) into change_count
  from intention_history
  where user_id = target_user_id
    and changed_at >= now() - interval '30 days';
  return change_count;
end;
$function$
;

-- ---------- FUNCTION: get_live_tracking_session (oid 19917, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_live_tracking_session(session_id_param uuid)
 RETURNS TABLE(current_lat double precision, current_lng double precision, active boolean, expires_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select current_lat, current_lng, active, expires_at, updated_at
  from live_tracking_sessions
  where id = session_id_param
  and active = true
  and expires_at > now();
$function$
;

-- ---------- FUNCTION: get_mutual_friends (oid 19659, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_mutual_friends(other_user_id uuid)
 RETURNS TABLE(id uuid, display_name text, photo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with my_friends as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = auth.uid() or f.user_b = auth.uid())
  ),
  their_friends as (
    select case when f.user_a = other_user_id then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = other_user_id or f.user_b = other_user_id)
  )
  select p.id, p.display_name, p.photo_url
  from profiles p
  where p.id in (select friend_id from my_friends)
  and p.id in (select friend_id from their_friends);
$function$
;

-- ---------- FUNCTION: get_nearby_offer_ids (oid 20056, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_nearby_offer_ids(my_lat double precision, my_lng double precision, radius_miles double precision DEFAULT 50)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id
  from brand_offers o
  join brand_partners p on p.id = o.partner_id
  where coalesce(o.latitude, p.latitude) is not null
  and coalesce(o.longitude, p.longitude) is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(my_lat)) * cos(radians(coalesce(o.latitude, p.latitude))) * cos(radians(coalesce(o.longitude, p.longitude)) - radians(my_lng)) +
      sin(radians(my_lat)) * sin(radians(coalesce(o.latitude, p.latitude)))
    ))
  )) <= radius_miles;
$function$
;

-- ---------- FUNCTION: get_newcomer_count (oid 19662, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_newcomer_count(gathering_id_param uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::integer
  from gathering_interest gi
  where gi.gathering_id = gathering_id_param
  and gi.status = 'approved'
  and not exists (
    select 1 from gathering_interest gi2
    where gi2.user_id = gi.user_id
    and gi2.status = 'approved'
    and gi2.id != gi.id
    and gi2.created_at < gi.created_at
  );
$function$
;

-- ---------- FUNCTION: get_offer_redemption_counts (oid 20058, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_offer_redemption_counts(offer_ids uuid[])
 RETURNS TABLE(offer_id uuid, redemption_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.offer_id, count(*) as redemption_count
  from offer_redemptions r
  where r.offer_id = any(offer_ids)
  group by r.offer_id;
$function$
;

-- ---------- FUNCTION: get_partner_billing_estimate (oid 20214, SECURITY DEFINER) ----------
-- Patched 2026-08-09 (baseline refresh) to match live production, reflecting changes applied after the original pull was generated. See CLAUDE.md's "schema baseline fix" section.
CREATE OR REPLACE FUNCTION public.get_partner_billing_estimate(partner_id_param uuid)
 RETURNS TABLE(redemption_count integer, estimated_amount numeric, billing_model text, included_units integer, billable_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contract record;
  v_count int;
  v_billable_count int;
  v_amount numeric(10,2);
  v_period_start date := date_trunc('month', now())::date;
  v_effective_start date;
begin
  if not exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.managed_partner_id = partner_id_param
  ) then
    raise exception 'not authorized';
  end if;

  select * into v_contract
  from partner_contracts
  where partner_id = partner_id_param
    and status = 'active'
    and contract_start <= now()::date
    and (contract_end is null or contract_end >= now()::date)
  order by created_at desc
  limit 1;

  if v_contract is null then
    return query select 0, 0::numeric, null::text, 0, 0;
    return;
  end if;

  v_effective_start := greatest(v_period_start, v_contract.contract_start);

  select count(*) into v_count
  from offer_redemptions r
  join brand_offers o on o.id = r.offer_id
  where o.partner_id = partner_id_param
    and r.confirmed_at is not null
    and r.redeemed_at >= v_effective_start;

  v_billable_count := greatest(v_count - v_contract.included_units, 0);

  v_amount := case v_contract.billing_model
    when 'per_redemption' then v_billable_count * v_contract.redemption_fee
    when 'flat_monthly' then v_contract.monthly_fee
    when 'hybrid' then v_contract.monthly_fee + (v_billable_count * v_contract.redemption_fee)
    else 0
  end;

  if v_contract.max_monthly_spend is not null then
    v_amount := least(v_amount, v_contract.max_monthly_spend);
  end if;

  return query select v_count, v_amount, v_contract.billing_model, v_contract.included_units, v_billable_count;
end;
$function$
;

-- ---------- FUNCTION: get_public_stories_with_fuzzed_coords (oid 19605, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_public_stories_with_fuzzed_coords()
 RETURNS TABLE(id uuid, user_id uuid, media_path text, media_type text, created_at timestamp with time zone, expires_at timestamp with time zone, fuzzed_lat double precision, fuzzed_lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id, s.user_id, s.media_path, s.media_type, s.created_at, s.expires_at,
    s.latitude + (((('x' || substr(md5(s.id::text || 'lat'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lat,
    s.longitude + (((('x' || substr(md5(s.id::text || 'lng'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lng
  from stories s
  where s.is_public = true
  and s.expires_at > now()
  and s.latitude is not null
  and s.longitude is not null
  and not exists (
    select 1 from blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
    or (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
  );
$function$
;

-- ---------- FUNCTION: get_sighting_fuzzed_coords (oid 19505, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_sighting_fuzzed_coords(sighting_ids uuid[])
 RETURNS TABLE(id uuid, fuzzed_lat double precision, fuzzed_lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id,
    split_part(s.approx_area, ',', 1)::double precision + (((('x' || substr(md5(s.id::text || 'lat'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lat,
    split_part(s.approx_area, ',', 2)::double precision + (((('x' || substr(md5(s.id::text || 'lng'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lng
  from sightings s
  where s.id = any(sighting_ids)
  and s.approx_area is not null;
$function$
;

-- ---------- FUNCTION: get_social_forecast (oid 19660, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_social_forecast(my_lat double precision, my_lng double precision)
 RETURNS TABLE(condition text, temp_f numeric, forecast_label text, forecast_detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  api_key text;
  request_id bigint;
  response_content text;
  response jsonb;
  weather_main text;
  weather_temp numeric;
  weather_condition_id integer;
  attempts integer := 0;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'openweather_api_key';

  select net.http_get(
    url := format(
      'https://api.openweathermap.org/data/2.5/weather?lat=%s&lon=%s&appid=%s&units=imperial',
      my_lat, my_lng, api_key
    )
  ) into request_id;

  loop
    select content into response_content from net._http_response where id = request_id;
    exit when response_content is not null or attempts >= 40;
    attempts := attempts + 1;
    perform pg_sleep(0.5);
  end loop;

  if response_content is null then
    raise exception 'Weather request timed out after % attempts', attempts;
  end if;

  response := response_content::jsonb;
  weather_main := response -> 'weather' -> 0 ->> 'main';
  weather_temp := (response -> 'main' ->> 'temp')::numeric;
  weather_condition_id := (response -> 'weather' -> 0 ->> 'id')::integer;

  return query select
    weather_main,
    weather_temp,
    case
      when weather_condition_id < 700 then 'Quiet'
      when weather_temp < 45 or weather_temp > 95 then 'Quiet'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Excellent'
      else 'Good'
    end,
    case
      when weather_condition_id < 700 then 'Rain or storms expected — a better night for something indoors.'
      when weather_temp < 45 then 'Cold out — outdoor plans might be a harder sell tonight.'
      when weather_temp > 95 then 'Very hot — outdoor plans are better earlier or later in the day.'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Clear skies and comfortable temps — good conditions for outdoor plans.'
      else 'Decent conditions out there tonight.'
    end;
end;
$function$
;

-- ---------- FUNCTION: get_suggested_friends (oid 19658, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_suggested_friends()
 RETURNS TABLE(suggested_id uuid, display_name text, photo_url text, mutual_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with my_friends as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = auth.uid() or f.user_b = auth.uid())
  ),
  friends_of_friends as (
    select case when f.user_a = mf.friend_id then f.user_b else f.user_a end as suggested_id
    from friendships f
    join my_friends mf on (f.user_a = mf.friend_id or f.user_b = mf.friend_id)
    where f.status = 'accepted'
  )
  select
    fof.suggested_id,
    p.display_name,
    p.photo_url,
    count(*) as mutual_count
  from friends_of_friends fof
  join profiles p on p.id = fof.suggested_id
  where fof.suggested_id != auth.uid()
  and fof.suggested_id not in (select friend_id from my_friends)
  and not exists (
    select 1 from blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = fof.suggested_id)
    or (b.blocker_id = fof.suggested_id and b.blocked_id = auth.uid())
  )
  and not exists (
    select 1 from friendships f2
    where (f2.user_a = auth.uid() and f2.user_b = fof.suggested_id)
    or (f2.user_a = fof.suggested_id and f2.user_b = auth.uid())
  )
  group by fof.suggested_id, p.display_name, p.photo_url
  order by mutual_count desc
  limit 10;
$function$
;

-- ---------- FUNCTION: get_trending_gathering_ids (oid 20008, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_trending_gathering_ids(area_param text)
 RETURNS TABLE(id uuid, interest_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.id, count(gi.id) as interest_count
  from gatherings g
  join gathering_interest gi on gi.gathering_id = g.id and gi.status = 'approved'
  where g.wide_area = area_param
  and g.scheduled_at > now()
  group by g.id
  order by interest_count desc
  limit 20;
$function$
;

-- ---------- FUNCTION: get_weather_result (oid 19664, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.get_weather_result(request_id_param bigint)
 RETURNS TABLE(condition text, temp_f numeric, forecast_label text, forecast_detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  response_content text;
  response jsonb;
  weather_main text;
  weather_temp numeric;
  weather_condition_id integer;
begin
  select content into response_content from net._http_response where id = request_id_param;

  if response_content is null then
    return;
  end if;

  response := response_content::jsonb;
  weather_main := response -> 'weather' -> 0 ->> 'main';
  weather_temp := (response -> 'main' ->> 'temp')::numeric;
  weather_condition_id := (response -> 'weather' -> 0 ->> 'id')::integer;

  return query select
    weather_main,
    weather_temp,
    case
      when weather_condition_id < 700 then 'Quiet'
      when weather_temp < 45 or weather_temp > 95 then 'Quiet'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Excellent'
      else 'Good'
    end,
    case
      when weather_condition_id < 700 then 'Rain or storms expected — a better night for something indoors.'
      when weather_temp < 45 then 'Cold out — outdoor plans might be a harder sell tonight.'
      when weather_temp > 95 then 'Very hot — outdoor plans are better earlier or later in the day.'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Clear skies and comfortable temps — good conditions for outdoor plans.'
      else 'Decent conditions out there tonight.'
    end;
end;
$function$
;

-- ---------- FUNCTION: grant_referral_bonus (oid 20397, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.grant_referral_bonus(code_param text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_referrer_id uuid;
begin
  select id into v_referrer_id from profiles where referral_code = upper(trim(code_param));
  if v_referrer_id is null then
    raise exception 'That code doesn''t match any account.';
  end if;
  if v_referrer_id = auth.uid() then
    raise exception 'You can''t use your own referral code.';
  end if;

  -- Unique constraint on referred_id raises 23505 (propagated to the
  -- caller as-is) if this user has already redeemed a code -- same
  -- anti-fraud gate the old client code relied on.
  insert into referral_redemptions (referrer_id, referred_id) values (v_referrer_id, auth.uid());

  perform set_config('app.trusted_update', 'true', true);
  update profiles set referred_by = v_referrer_id where id = auth.uid();
  update profiles set bonus_notices = coalesce(bonus_notices, 0) + 3 where id = v_referrer_id;
  update profiles set bonus_notices = coalesce(bonus_notices, 0) + 3 where id = auth.uid();
end;
$function$
;

-- ---------- FUNCTION: has_mutual_notice (oid 19002, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.has_mutual_notice(from_id uuid, to_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from notices
    where from_user = to_id and to_user = from_id
  );
$function$
;

-- ---------- FUNCTION: increment_browse_views (oid 19446, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.increment_browse_views(user_id_param uuid, count_param integer, daily_limit integer)
 RETURNS TABLE(allowed boolean, current_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
begin
  select browse_views_today, browse_views_date, coalesce(timezone, 'UTC') into v_current_count, v_current_date, v_timezone
  from profiles where id = user_id_param for update;
  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;
  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;
  if v_current_count >= daily_limit then
    return query select false, v_current_count;
    return;
  end if;
  v_current_count := v_current_count + count_param;
  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set browse_views_today = v_current_count, browse_views_date = v_today_in_user_tz
  where id = user_id_param;
  return query select true, v_current_count;
end;
$function$
;

-- ---------- FUNCTION: invite_friend_to_gathering (oid 19502, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.invite_friend_to_gathering(gathering_id_param uuid, friend_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_inviter_name text;
  v_gathering_title text;
  v_gathering_host_id uuid;
  v_women_only boolean;
  v_friend_gender text;
  v_is_friend boolean;
  v_is_blocked boolean;
begin
  select exists(
    select 1 from friendships
    where status = 'accepted'
    and ((user_a = auth.uid() and user_b = friend_id_param) or (user_a = friend_id_param and user_b = auth.uid()))
  ) into v_is_friend;
  if not v_is_friend then
    raise exception 'You can only invite accepted friends';
  end if;

  select exists(
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = friend_id_param)
    or (blocker_id = friend_id_param and blocked_id = auth.uid())
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'This person cannot be invited';
  end if;

  select host_id, title, women_only into v_gathering_host_id, v_gathering_title, v_women_only from gatherings where id = gathering_id_param;

  if v_women_only then
    select gender into v_friend_gender from profiles where id = friend_id_param;
    if lower(coalesce(v_friend_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;

  select exists(
    select 1 from blocks
    where (blocker_id = v_gathering_host_id and blocked_id = friend_id_param)
    or (blocker_id = friend_id_param and blocked_id = v_gathering_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'This person cannot be invited to this gathering';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), friend_id_param, 'gathering', gathering_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_inviter_name from profiles where id = auth.uid();
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', friend_id_param,
      'title', coalesce(v_inviter_name, 'A friend') || ' invited you to a gathering',
      'body', coalesce(v_gathering_title, 'Check it out') || ' — tap to see the details.',
      'data', jsonb_build_object('type', 'gathering_invite', 'gathering_id', gathering_id_param)
    )
  );
end;
$function$
;

-- ---------- FUNCTION: is_blocked (oid 18260, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.is_blocked(user_1 uuid, user_2 uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is distinct from user_1 and auth.uid() is distinct from user_2 then
    return false;
  end if;

  return exists (
    select 1 from blocks
    where (blocker_id = user_1 and blocked_id = user_2)
       or (blocker_id = user_2 and blocked_id = user_1)
  );
end;
$function$
;

-- ---------- FUNCTION: is_community_visible_to (oid 20444, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.is_community_visible_to(community_id_param uuid, user_id_param uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when auth.uid() = user_id_param then exists (
    select 1 from communities c
    where c.id = community_id_param
      and (c.is_public = true or c.creator_id = user_id_param)
  ) else false end;
$function$
;

-- ---------- FUNCTION: join_gathering (oid 20453, SECURITY DEFINER) ----------
-- Patched 2026-08-09 (baseline refresh) to match live production, reflecting changes applied after the original pull was generated. See CLAUDE.md's "schema baseline fix" section.
CREATE OR REPLACE FUNCTION public.join_gathering(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_host_id uuid;
  v_is_public boolean;
  v_women_only boolean;
  v_capacity integer;
  v_visibility text;
  v_user_id uuid := auth.uid();
  v_gender text;
  v_is_blocked boolean;
  v_has_invite boolean;
  v_approved_count integer;
  v_status text;
  v_new_match_id uuid;
  v_row_count integer;
begin
  -- Locks the gathering row so two concurrent joiners can't both read
  -- "one spot left" and both get approved.
  select host_id, is_public, women_only, capacity, visibility
  into v_host_id, v_is_public, v_women_only, v_capacity, v_visibility
  from gatherings where id = gathering_id_param for update;

  if v_host_id is null then
    raise exception 'Gathering not found';
  end if;
  if v_host_id = v_user_id then
    raise exception 'Cannot express interest in your own gathering';
  end if;

  if v_visibility = 'invite_only' then
    select exists(
      select 1 from social_invites
      where invite_type = 'gathering'
        and target_id = gathering_id_param
        and invitee_id = v_user_id
        and status = 'accepted'
    ) into v_has_invite;
    if not v_has_invite then
      raise exception 'This gathering is invite-only. Ask the host for an invite.';
    end if;
  end if;

  if v_women_only then
    select gender into v_gender from profiles where id = v_user_id;
    if lower(coalesce(v_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_user_id)
    or (blocker_id = v_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot express interest in this gathering';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';

  -- At/over capacity always waitlists, regardless of public/host-approval —
  -- "no spot available" is the same fact either way. Under capacity keeps
  -- today's exact behavior: public auto-approves, host-approval stays
  -- pending for the host to review.
  if v_capacity is not null and v_approved_count >= v_capacity then
    v_status := 'waitlisted';
  elsif v_is_public then
    v_status := 'approved';
  else
    v_status := 'pending';
  end if;

  insert into gathering_interest (gathering_id, user_id, status)
  values (gathering_id_param, v_user_id, v_status)
  on conflict (gathering_id, user_id) do nothing;
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    -- Already had an active request (pending/approved/waitlisted) —
    -- idempotent, return their existing status rather than erroring.
    select status into v_status from gathering_interest
    where gathering_id = gathering_id_param and user_id = v_user_id;
    return jsonb_build_object('status', v_status, 'match_id', null);
  end if;

  if v_status = 'approved' then
    insert into matches (user_a, user_b, source_gathering_id)
    values (least(v_host_id, v_user_id), greatest(v_host_id, v_user_id), gathering_id_param)
    on conflict (user_a, user_b) do update
      set source_gathering_id = gathering_id_param
      where matches.source_gathering_id is null
    returning id into v_new_match_id;
    if v_new_match_id is null then
      select id into v_new_match_id from matches
      where user_a = least(v_host_id, v_user_id) and user_b = greatest(v_host_id, v_user_id);
    end if;
  end if;

  return jsonb_build_object('status', v_status, 'match_id', v_new_match_id);
end;
$function$
;

-- ---------- FUNCTION: leave_gathering (oid 20455, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.leave_gathering(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_host_id uuid;
  v_capacity integer;
  v_scheduled_at timestamptz;
  v_my_row_id uuid;
  v_my_status text;
  v_promoted_interest_id uuid;
  v_promoted_user_id uuid;
  v_new_match_id uuid;
begin
  select host_id, capacity, scheduled_at into v_host_id, v_capacity, v_scheduled_at
  from gatherings where id = gathering_id_param for update;

  if v_host_id is null then
    raise exception 'Gathering not found';
  end if;
  if v_scheduled_at < now() then
    raise exception 'This gathering has already happened';
  end if;

  select id, status into v_my_row_id, v_my_status
  from gathering_interest where gathering_id = gathering_id_param and user_id = v_user_id;

  if v_my_row_id is null then
    raise exception 'You are not part of this gathering';
  end if;

  delete from gathering_interest where id = v_my_row_id;

  if v_my_status = 'approved' and v_capacity is not null then
    select id into v_promoted_interest_id from gathering_interest
    where gathering_id = gathering_id_param and status = 'waitlisted'
    order by created_at asc
    limit 1
    for update;

    if v_promoted_interest_id is not null then
      update gathering_interest set status = 'approved' where id = v_promoted_interest_id
      returning user_id into v_promoted_user_id;

      insert into matches (user_a, user_b, source_gathering_id)
      values (least(v_host_id, v_promoted_user_id), greatest(v_host_id, v_promoted_user_id), gathering_id_param)
      on conflict (user_a, user_b) do update
        set source_gathering_id = gathering_id_param
        where matches.source_gathering_id is null
      returning id into v_new_match_id;
    end if;
  end if;

  return jsonb_build_object('left', true, 'promoted_user_id', v_promoted_user_id);
end;
$function$
;

-- ---------- FUNCTION: log_intention_change (oid 18816, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.log_intention_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.relationship_intention is distinct from new.relationship_intention then
    insert into intention_history (user_id, old_intention, new_intention)
    values (new.id, old.relationship_intention, new.relationship_intention);
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: match_contacts_to_users (oid 19487, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.match_contacts_to_users(phone_numbers text[])
 RETURNS TABLE(id uuid, display_name text, photo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.display_name, p.photo_url
  from profiles p
  join auth.users u on u.id = p.id
  where u.phone = any(phone_numbers)
  and p.id != auth.uid();
$function$
;

-- ---------- FUNCTION: notify_business_update (oid 19805, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_business_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  partner_name text;
  follower record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into partner_name from brand_partners where id = new.partner_id;

  for follower in
    select user_id from business_followers where brand_partner_id = new.partner_id
  loop
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', follower.user_id,
        'title', coalesce(partner_name, 'Business') || ': ' || new.title,
        'body', coalesce(new.body, ''),
        'data', jsonb_build_object('type', 'business_update', 'partner_id', new.partner_id)
      )
    );
  end loop;

  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_constitution_addition (oid 19320, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_constitution_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_messages into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '📜 New entry added',
        'body', adder_name || ' added something to your Constitution',
        'data', jsonb_build_object('type', 'constitution_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_friend_request (oid 19498, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_friend_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_requester_name text;
  v_recipient uuid;
begin
  if new.status = 'pending' then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_requester_name from profiles where id = new.requested_by;
    v_recipient := case when new.user_a = new.requested_by then new.user_b else new.user_a end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_recipient,
        'title', 'New friend request',
        'body', coalesce(v_requester_name, 'Someone') || ' wants to be friends on Nearby.',
        'data', jsonb_build_object('type', 'friend_request')
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_friend_request_accepted (oid 19500, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_friend_request_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_accepter_name text;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_accepter_name from profiles where id = (case when new.requested_by = new.user_a then new.user_b else new.user_a end);

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.requested_by,
        'title', 'Friend request accepted',
        'body', coalesce(v_accepter_name, 'Someone') || ' accepted your friend request.',
        'data', jsonb_build_object('type', 'friend_accepted')
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_gathering_approved (oid 18754, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_gathering_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_title text;
  interested_user_wants_notif boolean;
  service_key text;
begin
  if new.status = 'approved' and old.status in ('pending', 'waitlisted') then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select notify_matches into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', case when old.status = 'waitlisted' then 'A spot opened up!' else 'You''re approved!' end,
          'body', case when old.status = 'waitlisted'
            then 'A spot opened up in "' || gathering_title || '" and you''re in! Start chatting!'
            else 'The host of "' || gathering_title || '" approved your interest. Start chatting!' end,
          'data', jsonb_build_object('type', 'gathering_approved', 'match_id', new.match_id)
        )
      );
    end if;
  elsif new.status = 'waitlisted' and old.status = 'pending' then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select notify_matches into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', 'Added to the waitlist',
          'body', '"' || gathering_title || '" is full, but you''re on the waitlist — we''ll let you know if a spot opens.',
          'data', jsonb_build_object('type', 'gathering_waitlisted', 'gathering_id', new.gathering_id)
        )
      );
    end if;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_gathering_cancelled (oid 19406, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_gathering_cancelled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  attendee record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for attendee in
    select user_id from gathering_interest where gathering_id = old.id and status = 'approved'
  loop
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', attendee.user_id,
        'title', 'A gathering was cancelled',
        'body', '"' || old.title || '" has been cancelled by the host.',
        'data', jsonb_build_object('type', 'gathering_cancelled')
      )
    );
  end loop;
  return old;
end;
$function$
;

-- ---------- FUNCTION: notify_gathering_interest (oid 18752, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_gathering_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_host_id uuid;
  gathering_title text;
  interested_user_name text;
  host_wants_notif boolean;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select host_id, title into gathering_host_id, gathering_title from gatherings where id = new.gathering_id;
  select display_name into interested_user_name from profiles where id = new.user_id;
  select notify_matches into host_wants_notif from profiles where id = gathering_host_id;

  if host_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', gathering_host_id,
        'title', 'New interest in your gathering',
        'body', interested_user_name || ' is interested in "' || gathering_title || '"',
        'data', jsonb_build_object('type', 'gathering_interest')
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_gathering_updated (oid 19895, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_gathering_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  attendee record;
  time_changed boolean;
begin
  time_changed := old.scheduled_at is distinct from new.scheduled_at;

  -- Only notify for changes that actually matter to someone who's
  -- already committed to attending — a title tweak alone doesn't
  -- need to interrupt someone, but a time change genuinely does.
  if not time_changed and old.title = new.title then
    return new;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for attendee in
    select gi.user_id from gathering_interest gi
    where gi.gathering_id = new.id and gi.status = 'approved'
  loop
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', attendee.user_id,
        'title', 'Gathering Updated',
        'body', case
          when time_changed then '"' || new.title || '" changed to a new time — tap to see details.'
          else '"' || new.title || '" was updated — tap to see details.'
        end,
        'data', jsonb_build_object('type', 'gathering_updated', 'gathering_id', new.id)
      )
    );
  end loop;

  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_memory_addition (oid 19316, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_memory_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_messages into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '💫 New memory added',
        'body', adder_name || ' added something to your Memory Vault',
        'data', jsonb_build_object('type', 'memory_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_new_match (oid 18295, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_new_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a_wants_notif boolean;
  b_wants_notif boolean;
  a_name text;
  b_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select notify_matches, display_name into a_wants_notif, a_name from profiles where id = new.user_a;
  select notify_matches, display_name into b_wants_notif, b_name from profiles where id = new.user_b;

  if a_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.user_a,
        'title', 'New match!',
        'body', 'You and ' || coalesce(b_name, 'someone') || ' noticed each other. Say hi!',
        'data', jsonb_build_object('type', 'match', 'match_id', new.id)
      )
    );
  end if;

  if b_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.user_b,
        'title', 'New match!',
        'body', 'You and ' || coalesce(a_name, 'someone') || ' noticed each other. Say hi!',
        'data', jsonb_build_object('type', 'match', 'match_id', new.id)
      )
    );
  end if;

  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_new_message (oid 18297, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  service_key text;
  sender_name text;
  notif_body text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;
  select notify_messages into recipient_wants_notif from profiles where id = recipient;
  select display_name into sender_name from profiles where id = new.sender_id;

  notif_body := case
    when new.audio_url is not null then 'Sent a voice message'
    when new.media_url is not null then 'Sent a photo'
    when new.gif_url is not null then 'Sent a GIF'
    when new.body is not null and new.body != '' then left(new.body, 100)
    else 'Sent a message'
  end;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', coalesce(sender_name, 'New message'),
        'body', notif_body,
        'data', jsonb_build_object('type', 'message', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_new_story (oid 19606, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_new_story()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  poster_name text;
  recipient record;
  already_posted_today boolean;
  poster_timezone text;
  poster_today_start timestamptz;
begin
  select coalesce(timezone, 'UTC') into poster_timezone from profiles where id = new.user_id;

  -- "Today" is now computed in the poster's own timezone, not the
  -- server's UTC default — same pattern already fixed for the daily
  -- AI/browse limits and birthday reminders.
  begin
    poster_today_start := date_trunc('day', now() at time zone poster_timezone) at time zone poster_timezone;
  exception when others then
    poster_today_start := date_trunc('day', now());
  end;

  select exists(
    select 1 from stories
    where user_id = new.user_id
    and id != new.id
    and created_at > poster_today_start
  ) into already_posted_today;

  if already_posted_today then
    return new;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into poster_name from profiles where id = new.user_id;

  for recipient in
    select case when m.user_a = new.user_id then m.user_b else m.user_a end as recipient_id
    from matches m
    where m.user_a = new.user_id or m.user_b = new.user_id
    union
    select case when f.user_a = new.user_id then f.user_b else f.user_a end as recipient_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.user_id or f.user_b = new.user_id)
  loop
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient.recipient_id,
        'title', 'New Story',
        'body', coalesce(poster_name, 'Someone') || ' posted a new story.',
        'data', jsonb_build_object('type', 'new_story', 'story_user_id', new.user_id)
      )
    );
  end loop;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_playlist_addition (oid 19028, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_playlist_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_messages into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🎵 New song added',
        'body', adder_name || ' added "' || new.song_title || '" to your shared playlist',
        'data', jsonb_build_object('type', 'playlist_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_screenshot_taken (oid 19497, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_screenshot_taken(match_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_taker_id uuid := auth.uid();
  v_recipient uuid;
  v_taker_name text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = v_taker_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = match_id_param and (m.user_a = v_taker_id or m.user_b = v_taker_id);

  if v_recipient is null then
    return;
  end if;

  select display_name into v_taker_name from profiles where id = v_taker_id;

  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_recipient,
      'title', 'Screenshot taken',
      'body', coalesce(v_taker_name, 'Someone') || ' took a screenshot of your conversation.',
      'data', jsonb_build_object('type', 'screenshot', 'match_id', match_id_param)
    )
  );
end;
$function$
;

-- ---------- FUNCTION: notify_shared_decision_addition (oid 19030, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_shared_decision_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_messages into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧭 New thought shared',
        'body', adder_name || ' shared a thought in your Big Picture conversation',
        'data', jsonb_build_object('type', 'shared_decision_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_stress_test_addition (oid 19318, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_stress_test_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_messages into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧪 New "What If" thought',
        'body', adder_name || ' shared a thought on one of your scenarios',
        'data', jsonb_build_object('type', 'stress_test_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_super_notice (oid 18687, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_super_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient_wants_notif boolean;
  service_key text;
  sender_name text;
begin
  if new.is_super = true then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select notify_waves into recipient_wants_notif from profiles where id = new.to_user;
    select display_name into sender_name from profiles where id = new.from_user;
    if recipient_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.to_user,
          'title', coalesce(sender_name, 'Someone') || ' waved at you! 👋',
          'body', 'Open the app to see their profile.',
          'data', jsonb_build_object('type', 'wave')
        )
      );
    end if;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_timeline_addition (oid 19314, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_timeline_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_messages into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🗓️ New timeline thought',
        'body', adder_name || ' added a thought to your Timeline',
        'data', jsonb_build_object('type', 'timeline_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: notify_trip_idea_addition (oid 19032, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.notify_trip_idea_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_messages into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧳 New trip idea',
        'body', adder_name || ' added an idea to your trip plan',
        'data', jsonb_build_object('type', 'trip_idea_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: prevent_hosting_partner_self_edit (oid 20398, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.prevent_hosting_partner_self_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.hosting_partner_id is distinct from old.hosting_partner_id then
      new.hosting_partner_id := old.hosting_partner_id;
    end if;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: prevent_self_interest (oid 18985, SECURITY INVOKER) ----------
CREATE OR REPLACE FUNCTION public.prevent_self_interest()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if exists (
    select 1 from gatherings where id = new.gathering_id and host_id = new.user_id
  ) then
    raise exception 'Cannot express interest in your own gathering';
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: prevent_self_premium_edit (oid 19569, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.prevent_self_premium_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.is_premium is distinct from old.is_premium then
      new.is_premium := old.is_premium;
    end if;
    if new.is_admin is distinct from old.is_admin then
      new.is_admin := old.is_admin;
    end if;
    if new.bonus_notices is distinct from old.bonus_notices then
      new.bonus_notices := old.bonus_notices;
    end if;
    if new.referred_by is distinct from old.referred_by then
      new.referred_by := old.referred_by;
    end if;
    if new.ai_uses_today is distinct from old.ai_uses_today then
      new.ai_uses_today := old.ai_uses_today;
    end if;
    if new.ai_uses_date is distinct from old.ai_uses_date then
      new.ai_uses_date := old.ai_uses_date;
    end if;
    if new.browse_views_today is distinct from old.browse_views_today then
      new.browse_views_today := old.browse_views_today;
    end if;
    if new.browse_views_date is distinct from old.browse_views_date then
      new.browse_views_date := old.browse_views_date;
    end if;
    if new.managed_partner_id is distinct from old.managed_partner_id then
      new.managed_partner_id := old.managed_partner_id;
    end if;
    if new.gatherings_created_today is distinct from old.gatherings_created_today then
      new.gatherings_created_today := old.gatherings_created_today;
    end if;
    if new.gatherings_created_date is distinct from old.gatherings_created_date then
      new.gatherings_created_date := old.gatherings_created_date;
    end if;
    if new.communities_created_today is distinct from old.communities_created_today then
      new.communities_created_today := old.communities_created_today;
    end if;
    if new.communities_created_date is distinct from old.communities_created_date then
      new.communities_created_date := old.communities_created_date;
    end if;
    if new.friend_requests_sent_today is distinct from old.friend_requests_sent_today then
      new.friend_requests_sent_today := old.friend_requests_sent_today;
    end if;
    if new.friend_requests_sent_date is distinct from old.friend_requests_sent_date then
      new.friend_requests_sent_date := old.friend_requests_sent_date;
    end if;
    if new.stories_posted_today is distinct from old.stories_posted_today then
      new.stories_posted_today := old.stories_posted_today;
    end if;
    if new.stories_posted_date is distinct from old.stories_posted_date then
      new.stories_posted_date := old.stories_posted_date;
    end if;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: purge_expired_sightings (oid 18299, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.purge_expired_sightings()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from sightings where expires_at < now();
  delete from presence_reports where reported_at < now() - interval '1 hour';
end;
$function$
;

-- ---------- FUNCTION: request_business_partnership (oid 20427, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.request_business_partnership(target_type_param text, target_id_param uuid, partner_id_param uuid, message_param text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request_id uuid;
  v_owns_target boolean;
begin
  if target_type_param not in ('gathering', 'community') then
    raise exception 'Invalid target type';
  end if;

  if target_type_param = 'gathering' then
    select exists(select 1 from gatherings where id = target_id_param and host_id = auth.uid()) into v_owns_target;
  else
    select exists(select 1 from community_members where community_id = target_id_param and user_id = auth.uid() and role in ('creator', 'leader')) into v_owns_target;
  end if;

  if not v_owns_target then
    raise exception 'You can only request a business partner for a gathering you host or a community you lead';
  end if;

  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    raise exception 'That business could not be found';
  end if;

  insert into business_partnership_requests (requester_id, target_type, target_id, partner_id, message)
  values (auth.uid(), target_type_param, target_id_param, partner_id_param, nullif(trim(coalesce(message_param, '')), ''))
  on conflict (target_type, target_id, partner_id) where status = 'pending' do nothing
  returning id into v_request_id;

  if v_request_id is null then
    raise exception 'A request for this business is already pending';
  end if;

  return v_request_id;
end;
$function$
;

-- ---------- FUNCTION: respond_to_business_partnership_request (oid 20428, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.respond_to_business_partnership_request(request_id_param uuid, approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  service_key text;
  v_business_name text;
  v_target_title text;
begin
  select * into v_request from business_partnership_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found';
  end if;

  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = v_request.partner_id) then
    raise exception 'Only the target business owner can respond to this request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  update business_partnership_requests
  set status = case when approve then 'approved' else 'declined' end, reviewed_at = now()
  where id = request_id_param;

  if approve then
    perform set_config('app.trusted_update', 'true', true);
    if v_request.target_type = 'gathering' then
      update gatherings set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    else
      update communities set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    end if;
  end if;

  select name into v_business_name from brand_partners where id = v_request.partner_id;
  if v_request.target_type = 'gathering' then
    select title into v_target_title from gatherings where id = v_request.target_id;
  else
    select name into v_target_title from communities where id = v_request.target_id;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_request.requester_id,
      'title', case when approve then coalesce(v_business_name, 'A business') || ' accepted your partnership request' else coalesce(v_business_name, 'A business') || ' declined your partnership request' end,
      'body', coalesce(v_target_title, 'Your gathering'),
      'data', jsonb_build_object('type', 'business_partnership_response', 'target_type', v_request.target_type, 'target_id', v_request.target_id)
    )
  );
end;
$function$
;

-- ---------- FUNCTION: respond_to_social_invite (oid 20390, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.respond_to_social_invite(invite_id_param uuid, accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update social_invites
  set status = case when accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = invite_id_param and invitee_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'Invite not found or already responded to';
  end if;
end;
$function$
;

-- ---------- FUNCTION: rls_auto_enable (oid 17596, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

-- ---------- FUNCTION: send_birthday_reminders (oid 19657, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.send_birthday_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  birthday_person record;
  connection record;
  v_today_in_their_tz date;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for birthday_person in
    select id, display_name, birthdate, coalesce(timezone, 'UTC') as timezone from profiles
    where birthdate is not null
  loop
    -- Each person's "today" is computed in their own timezone, not
    -- the server's — otherwise this cron could fire a day early or
    -- late depending on how far someone's local time differs from
    -- wherever the database server actually runs.
    begin
      v_today_in_their_tz := (now() at time zone birthday_person.timezone)::date;
    exception when others then
      v_today_in_their_tz := current_date;
    end;

    if extract(month from birthday_person.birthdate) = extract(month from v_today_in_their_tz)
    and extract(day from birthday_person.birthdate) = extract(day from v_today_in_their_tz) then

      for connection in
        select case when m.user_a = birthday_person.id then m.user_b else m.user_a end as connection_id
        from matches m
        where m.user_a = birthday_person.id or m.user_b = birthday_person.id
        union
        select case when f.user_a = birthday_person.id then f.user_b else f.user_a end as connection_id
        from friendships f
        where f.status = 'accepted' and (f.user_a = birthday_person.id or f.user_b = birthday_person.id)
      loop
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', connection.connection_id,
            'title', '🎂 Birthday Today',
            'body', 'It''s ' || coalesce(birthday_person.display_name, 'a connection') || '''s birthday today!',
            'data', jsonb_build_object('type', 'birthday', 'birthday_user_id', birthday_person.id)
          )
        );
      end loop;
    end if;
  end loop;
end;
$function$
;

-- ---------- FUNCTION: send_first_mission_reminders (oid 20053, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.send_first_mission_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  candidate record;
  v_today_in_their_tz date;
  v_signup_date_in_their_tz date;
  v_days_since_signup integer;
  v_has_said_yes boolean;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for candidate in
    select id, display_name, created_at, coalesce(timezone, 'UTC') as timezone from profiles
  loop
    begin
      v_today_in_their_tz := (now() at time zone candidate.timezone)::date;
      v_signup_date_in_their_tz := (candidate.created_at at time zone candidate.timezone)::date;
    exception when others then
      v_today_in_their_tz := current_date;
      v_signup_date_in_their_tz := candidate.created_at::date;
    end;

    v_days_since_signup := v_today_in_their_tz - v_signup_date_in_their_tz;

    -- A narrow 3-4 day window, checked daily — fires exactly once
    -- per person rather than repeating every day someone remains
    -- inactive, which would feel naggy rather than encouraging.
    if v_days_since_signup in (3, 4) then
      select exists (
        select 1 from gathering_interest gi
        where gi.user_id = candidate.id
        and gi.status = 'approved'
        and gi.created_at >= candidate.created_at
      ) into v_has_said_yes;

      if not v_has_said_yes then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', candidate.id,
            'title', 'Your mission is still waiting',
            'body', 'Say yes to one thing this week — there''s still time.',
            'data', jsonb_build_object('type', 'first_mission_reminder')
          )
        );
      end if;
    end if;
  end loop;
end;
$function$
;

-- ---------- FUNCTION: send_gathering_reminders (oid 19504, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.send_gathering_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  g record;
  attendee record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for g in
    select id, host_id, title, scheduled_at
    from gatherings
    where reminder_sent = false
      and scheduled_at > now()
      and scheduled_at <= now() + interval '2 hours'
  loop
    -- Notify the host
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', g.host_id,
        'title', 'Your gathering starts soon',
        'body', '"' || g.title || '" starts in about 2 hours.',
        'data', jsonb_build_object('type', 'gathering_reminder', 'gathering_id', g.id)
      )
    );

    -- Notify every approved attendee
    for attendee in
      select user_id from gathering_interest where gathering_id = g.id and status = 'approved'
    loop
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', attendee.user_id,
          'title', 'Gathering starting soon',
          'body', '"' || g.title || '" starts in about 2 hours.',
          'data', jsonb_build_object('type', 'gathering_reminder', 'gathering_id', g.id)
        )
      );
    end loop;

    update gatherings set reminder_sent = true where id = g.id;
  end loop;
end;
$function$
;

-- ---------- FUNCTION: send_match_reminders (oid 19398, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.send_match_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  m record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for m in
    select mt.id, mt.user_a, mt.user_b, mt.matched_at,
           a.display_name as a_name, b.display_name as b_name,
           a.notify_messages as a_wants_notif, b.notify_messages as b_wants_notif
    from matches mt
    join profiles a on a.id = mt.user_a
    join profiles b on b.id = mt.user_b
    where mt.matched_at < now() - interval '24 hours'
      and mt.reminder_sent_at is null
      and not exists (select 1 from messages msg where msg.match_id = mt.id)
  loop
    if m.a_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', m.user_a,
          'title', 'Say hi to ' || coalesce(m.b_name, 'your match') || '! 👋',
          'body', 'You matched a day ago — send the first message.',
          'data', jsonb_build_object('type', 'match_reminder', 'match_id', m.id)
        )
      );
    end if;

    if m.b_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', m.user_b,
          'title', 'Say hi to ' || coalesce(m.a_name, 'your match') || '! 👋',
          'body', 'You matched a day ago — send the first message.',
          'data', jsonb_build_object('type', 'match_reminder', 'match_id', m.id)
        )
      );
    end if;

    update matches set reminder_sent_at = now() where id = m.id;
  end loop;
end;
$function$
;

-- ---------- FUNCTION: send_momentum_nudges (oid unknown, SECURITY DEFINER) ----------
-- Added 2026-08-09 (baseline refresh) — new since the original pull was generated. See CLAUDE.md's "schema baseline fix" section.
CREATE OR REPLACE FUNCTION public.send_momentum_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  u record;
  wk int;
  week_has_activity boolean;
  streak int;
  current_week_activity boolean;
  redemption_count int;
  next_tier_min int;
  next_tier_name text;
  next_tier_emoji text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for u in select id, display_name from profiles loop
    -- ---------- streak signal (mirrors getMomentumStats' weekly-bucket logic) ----------
    -- Consecutive completed weeks (not counting the current, still-in-progress
    -- week) with at least one attended-or-hosted gathering, counting back up
    -- to 8 weeks — same lookback window the Momentum screen itself uses.
    streak := 0;
    for wk in 1..8 loop
      select exists (
        select 1 from gathering_interest gi
        join gatherings g on g.id = gi.gathering_id
        where gi.user_id = u.id and gi.status = 'approved'
          and g.scheduled_at >= date_trunc('week', now()) - (wk || ' weeks')::interval
          and g.scheduled_at < date_trunc('week', now()) - ((wk - 1) || ' weeks')::interval
        union
        select 1 from gatherings g2
        where g2.host_id = u.id
          and g2.scheduled_at >= date_trunc('week', now()) - (wk || ' weeks')::interval
          and g2.scheduled_at < date_trunc('week', now()) - ((wk - 1) || ' weeks')::interval
      ) into week_has_activity;

      exit when not week_has_activity;
      streak := streak + 1;
    end loop;

    select exists (
      select 1 from gathering_interest gi
      join gatherings g on g.id = gi.gathering_id
      where gi.user_id = u.id and gi.status = 'approved' and g.scheduled_at >= date_trunc('week', now())
      union
      select 1 from gatherings g2
      where g2.host_id = u.id and g2.scheduled_at >= date_trunc('week', now())
    ) into current_week_activity;

    if streak >= 2 and not current_week_activity then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', u.id,
          'title', '🔥 Keep your streak going',
          'body', 'You''ve been active ' || streak || ' weeks in a row — join or host something this week to keep it up.',
          'data', jsonb_build_object('type', 'momentum_streak_nudge')
        )
      );
      continue; -- one nudge per person per run; don't also send the tier nudge below
    end if;

    -- ---------- reward-tier-proximity signal (mirrors getMyRewardStatus) ----------
    select count(*) into redemption_count from offer_redemptions where user_id = u.id;

    select min, name, emoji into next_tier_min, next_tier_name, next_tier_emoji
    from (values (5, 'Bronze', '🥉'), (15, 'Silver', '🥈'), (30, 'Gold', '🥇')) as tiers(min, name, emoji)
    where tiers.min > redemption_count
    order by tiers.min asc
    limit 1;

    if next_tier_min is not null and (next_tier_min - redemption_count) <= 2 then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', u.id,
          'title', next_tier_emoji || ' Almost at ' || next_tier_name,
          'body', (next_tier_min - redemption_count) || ' more redemption' || (case when (next_tier_min - redemption_count) = 1 then '' else 's' end) || ' and you''re ' || next_tier_name || '.',
          'data', jsonb_build_object('type', 'reward_tier_nudge')
        )
      );
    end if;
  end loop;
end;
$function$
;

-- ---------- FUNCTION: send_social_invite (oid 20389, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.send_social_invite(invite_type_param text, target_id_param uuid, invitee_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if invite_type_param not in ('gathering', 'community') then
    raise exception 'Invalid invite type';
  end if;

  if invitee_id_param = auth.uid() then
    raise exception 'Cannot invite yourself';
  end if;

  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and ((user_a = auth.uid() and user_b = invitee_id_param)
        or (user_a = invitee_id_param and user_b = auth.uid()))
  ) then
    raise exception 'You can only invite friends';
  end if;

  if exists (
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = invitee_id_param)
       or (blocker_id = invitee_id_param and blocked_id = auth.uid())
  ) then
    raise exception 'This person cannot be invited';
  end if;

  if invite_type_param = 'gathering' and not exists (select 1 from gatherings where id = target_id_param) then
    raise exception 'Gathering not found';
  end if;

  if invite_type_param = 'community' and not exists (select 1 from communities where id = target_id_param) then
    raise exception 'Community not found';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), invitee_id_param, invite_type_param, target_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing;
end;
$function$
;

-- ---------- FUNCTION: set_community_hosting_partner_from_creator (oid 19812, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.set_community_hosting_partner_from_creator()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  partner_id_val uuid;
begin
  select managed_partner_id into partner_id_val from profiles where id = new.creator_id;
  if partner_id_val is not null then
    new.hosting_partner_id := partner_id_val;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: set_community_member_role (oid 20292, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.set_community_member_role(community_id_param uuid, member_id_param uuid, new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new_role not in ('leader', 'member') then
    raise exception 'Invalid role';
  end if;

  if not exists (select 1 from communities where id = community_id_param and creator_id = auth.uid()) then
    raise exception 'Only the community creator can change member roles';
  end if;

  if not exists (select 1 from community_members where community_id = community_id_param and user_id = member_id_param and role <> 'creator') then
    raise exception 'That member could not be found, or is the creator';
  end if;

  update community_members
  set role = new_role
  where community_id = community_id_param and user_id = member_id_param;
end;
$function$
;

-- ---------- FUNCTION: set_gathering_on_my_way (oid 20274, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.set_gathering_on_my_way(gathering_id_param uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update gathering_interest
  set on_my_way_at = coalesce(on_my_way_at, now())
  where gathering_id = gathering_id_param
    and user_id = auth.uid()
    and status = 'approved';
$function$
;

-- ---------- FUNCTION: set_hosting_partner_from_host (oid 19787, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.set_hosting_partner_from_host()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  partner_id_val uuid;
begin
  select managed_partner_id into partner_id_val from profiles where id = new.host_id;
  if partner_id_val is not null then
    new.hosting_partner_id := partner_id_val;
  end if;
  return new;
end;
$function$
;

-- ---------- FUNCTION: set_premium_status (oid 19918, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.set_premium_status(user_id_param uuid, new_status boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Only callable with the service role key (via SECURITY DEFINER +
  -- restricted execute grant below), so this being "trusted" is
  -- enforced by who can call it at all, not by a flag that could
  -- fail to persist across separate requests.
  perform set_config('app.trusted_update', 'true', true);
  update profiles set is_premium = new_status where id = user_id_param;
end;
$function$
;

-- ---------- FUNCTION: spend_bonus_notice (oid 20396, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.spend_bonus_notice()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows integer;
begin
  perform set_config('app.trusted_update', 'true', true);
  update profiles set bonus_notices = bonus_notices - 1
  where id = auth.uid() and coalesce(bonus_notices, 0) > 0;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$
;

-- ---------- FUNCTION: submit_weather_request (oid 19663, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.submit_weather_request(my_lat double precision, my_lng double precision)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  api_key text;
  request_id bigint;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'openweather_api_key';

  select net.http_get(
    url := format(
      'https://api.openweathermap.org/data/2.5/weather?lat=%s&lon=%s&appid=%s&units=imperial',
      my_lat, my_lng, api_key
    )
  ) into request_id;

  return request_id;
end;
$function$
;

-- ---------- FUNCTION: unmatch (oid 18866, SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.unmatch(target_match_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
begin
  select user_a, user_b into v_user_a, v_user_b
  from matches
  where id = target_match_id
    and (user_a = v_user_id or user_b = v_user_id);

  if v_user_a is null then
    return;
  end if;

  delete from matches where id = target_match_id;

  -- Also clear the notice history between these two people, so
  -- unmatching genuinely lets them start fresh if they cross paths
  -- again — otherwise old notices silently block new ones and can
  -- leave a stale entry in Notices even after unmatching.
  delete from notices
  where (from_user = v_user_a and to_user = v_user_b)
     or (from_user = v_user_b and to_user = v_user_a);
end;
$function$
;

-- ==================== ROW LEVEL SECURITY POLICIES ====================
-- (Deferred to after FUNCTIONS: several policies call SECURITY DEFINER
-- helper functions like is_blocked()/is_community_visible_to()/check_is_admin(),
-- which must already exist for CREATE POLICY to validate the expression
-- against a fresh empty database.)
-- ---------- BRAND_PARTNERS ----------
create policy "Anyone can view active partners"
  on public.brand_partners
  as permissive
  for select
  to public
  using ((active = true));
-- ---------- BUSINESS_INVOICES ----------
create policy "Business owners can view their own invoices"
  on public.business_invoices
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_invoices.partner_id)))));
-- ---------- BUSINESS_UPDATES ----------
create policy "Business owners can post updates for their business"
  on public.business_updates
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_updates.partner_id)))));
create policy "Followers can view updates from businesses they follow"
  on public.business_updates
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM business_followers bf
  WHERE ((bf.brand_partner_id = business_updates.partner_id) AND (bf.user_id = auth.uid())))));
-- ---------- PARTNER_CONTRACTS ----------
create policy "Business owners can view their own contract"
  on public.partner_contracts
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = partner_contracts.partner_id)))));
-- ---------- PROFILES ----------
create policy "Admins can view all profiles regardless of verification"
  on public.profiles
  as permissive
  for select
  to public
  using (check_is_admin(auth.uid()));
create policy "Users can insert own profile"
  on public.profiles
  as permissive
  for insert
  to public
  with check ((auth.uid() = id));
create policy "Users can update own profile"
  on public.profiles
  as permissive
  for update
  to public
  using ((auth.uid() = id));
create policy "Users can view own or verified profiles"
  on public.profiles
  as permissive
  for select
  to public
  using (((auth.uid() = id) OR ((photo_verified = true) AND (profile_hidden = false))));
-- ---------- BLOCKS ----------
create policy "Users can create their own blocks"
  on public.blocks
  as permissive
  for insert
  to public
  with check ((auth.uid() = blocker_id));
create policy "Users can remove their own blocks"
  on public.blocks
  as permissive
  for delete
  to public
  using ((auth.uid() = blocker_id));
create policy "Users can view their own blocks"
  on public.blocks
  as permissive
  for select
  to public
  using ((auth.uid() = blocker_id));
-- ---------- BUSINESS_FOLLOWERS ----------
create policy "Users can view, update, and delete their own opt-ins"
  on public.business_followers
  as permissive
  for all
  to authenticated
  using ((user_id = auth.uid()))
  with check (((user_id = auth.uid()) AND (opted_in_at > (now() - '00:05:00'::interval))));
-- ---------- BUSINESS_MESSAGES ----------
create policy "Business owners can reply within an existing conversation"
  on public.business_messages
  as permissive
  for insert
  to authenticated
  with check (((sender_id = auth.uid()) AND (from_business = true) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_messages.partner_id)))) AND (NOT is_blocked(auth.uid(), conversation_with_id))));
create policy "Followers can message a business they follow"
  on public.business_messages
  as permissive
  for insert
  to authenticated
  with check (((sender_id = auth.uid()) AND (from_business = false) AND (conversation_with_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM business_followers bf
  WHERE ((bf.brand_partner_id = business_messages.partner_id) AND (bf.user_id = auth.uid())))) AND (NOT (EXISTS ( SELECT 1
   FROM profiles p2
  WHERE ((p2.managed_partner_id = business_messages.partner_id) AND is_blocked(auth.uid(), p2.id)))))));
create policy "Only the follower and business owner can see this conversation,"
  on public.business_messages
  as permissive
  for select
  to authenticated
  using ((((conversation_with_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_messages.partner_id))))) AND (NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE (((b.blocker_id = auth.uid()) AND (b.blocked_id = business_messages.sender_id)) OR ((b.blocker_id = business_messages.sender_id) AND (b.blocked_id = auth.uid()))))))));
-- ---------- BUSINESS_PARTNER_REQUESTS ----------
create policy "Admins can update requests"
  on public.business_partner_requests
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
create policy "Admins can view all requests"
  on public.business_partner_requests
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
create policy "Users can submit a request"
  on public.business_partner_requests
  as permissive
  for insert
  to authenticated
  with check ((requester_id = auth.uid()));
create policy "Users can view their own requests"
  on public.business_partner_requests
  as permissive
  for select
  to authenticated
  using ((requester_id = auth.uid()));
-- ---------- BUSINESS_PARTNERSHIP_REQUESTS ----------
create policy "Requester or target business owner can view requests"
  on public.business_partnership_requests
  as permissive
  for select
  to public
  using (((requester_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.managed_partner_id = business_partnership_requests.partner_id))))));
-- ---------- CHEMISTRY_DIARY_ENTRIES ----------
create policy "Users can create their own diary entries"
  on public.chemistry_diary_entries
  as permissive
  for insert
  to public
  with check ((auth.uid() = user_id));
create policy "Users can delete their own diary entries"
  on public.chemistry_diary_entries
  as permissive
  for delete
  to public
  using ((auth.uid() = user_id));
create policy "Users can view their own diary entries"
  on public.chemistry_diary_entries
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));
-- ---------- COMMUNITIES ----------
create policy "Anyone can create a community"
  on public.communities
  as permissive
  for insert
  to authenticated
  with check ((creator_id = auth.uid()));
create policy "Creator can delete their community"
  on public.communities
  as permissive
  for delete
  to authenticated
  using ((creator_id = auth.uid()));
create policy "Creator can update or delete their community"
  on public.communities
  as permissive
  for update
  to authenticated
  using ((creator_id = auth.uid()));
create policy "Public communities visible to everyone, private only to members"
  on public.communities
  as permissive
  for select
  to authenticated
  using (((is_public = true) OR (creator_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM community_members cm
  WHERE ((cm.community_id = communities.id) AND (cm.user_id = auth.uid()))))));
-- ---------- COMMUNITY_MEMBERS ----------
create policy "Members visible to other members and the public if community is"
  on public.community_members
  as permissive
  for select
  to public
  using ((is_community_visible_to(community_id, auth.uid()) OR (user_id = auth.uid())));
create policy "Users can join public communities, or their own community regar"
  on public.community_members
  as permissive
  for insert
  to authenticated
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM communities c
  WHERE ((c.id = community_members.community_id) AND ((c.is_public = true) OR (c.creator_id = auth.uid()))))) AND (((role = 'creator'::text) AND (EXISTS ( SELECT 1
   FROM communities c
  WHERE ((c.id = community_members.community_id) AND (c.creator_id = auth.uid()))))) OR (role = 'member'::text))));
create policy "Users can leave communities themselves"
  on public.community_members
  as permissive
  for delete
  to authenticated
  using ((user_id = auth.uid()));
-- ---------- COMMUNITY_MESSAGES ----------
create policy "Members can send community chat"
  on public.community_messages
  as permissive
  for insert
  to authenticated
  with check (((auth.uid() = sender_id) AND (EXISTS ( SELECT 1
   FROM community_members cm
  WHERE ((cm.community_id = community_messages.community_id) AND (cm.user_id = auth.uid()))))));
create policy "Members can view community chat, excluding blocked senders"
  on public.community_messages
  as permissive
  for select
  to authenticated
  using (((EXISTS ( SELECT 1
   FROM community_members cm
  WHERE ((cm.community_id = community_messages.community_id) AND (cm.user_id = auth.uid())))) AND (NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE (((b.blocker_id = auth.uid()) AND (b.blocked_id = community_messages.sender_id)) OR ((b.blocker_id = community_messages.sender_id) AND (b.blocked_id = auth.uid()))))))));
-- ---------- EMERGENCY_CONTACTS ----------
create policy "Users manage their own emergency contacts"
  on public.emergency_contacts
  as permissive
  for all
  to public
  using ((auth.uid() = user_id));
-- ---------- FRIEND_CIRCLES ----------
create policy "Users manage their own friend circles"
  on public.friend_circles
  as permissive
  for all
  to public
  using ((auth.uid() = user_id));
-- ---------- FRIEND_CIRCLE_MEMBERS ----------
create policy "Users manage members of their own circles"
  on public.friend_circle_members
  as permissive
  for all
  to public
  using ((EXISTS ( SELECT 1
   FROM friend_circles
  WHERE ((friend_circles.id = friend_circle_members.circle_id) AND (friend_circles.user_id = auth.uid())))));
-- ---------- FRIENDSHIPS ----------
create policy "Only the non-requester can respond to a friend request"
  on public.friendships
  as permissive
  for update
  to authenticated
  using ((((auth.uid() = user_a) OR (auth.uid() = user_b)) AND (auth.uid() <> requested_by)))
  with check ((((auth.uid() = user_a) OR (auth.uid() = user_b)) AND (auth.uid() <> requested_by)));
create policy "Participants can view their own friendships"
  on public.friendships
  as permissive
  for select
  to authenticated
  using (((auth.uid() = user_a) OR (auth.uid() = user_b)));
create policy "Users can request friendships"
  on public.friendships
  as permissive
  for insert
  to authenticated
  with check (((auth.uid() = requested_by) AND ((auth.uid() = user_a) OR (auth.uid() = user_b))));
-- ---------- GATHERINGS ----------
create policy "Anyone can view gatherings"
  on public.gatherings
  as permissive
  for select
  to public
  using (true);
create policy "Hosts can delete own gatherings"
  on public.gatherings
  as permissive
  for delete
  to public
  using ((auth.uid() = host_id));
create policy "Hosts can update their own gatherings"
  on public.gatherings
  as permissive
  for update
  to authenticated
  using ((host_id = auth.uid()))
  with check ((host_id = auth.uid()));
create policy "Users can create own gatherings"
  on public.gatherings
  as permissive
  for insert
  to public
  with check ((auth.uid() = host_id));
-- ---------- BRAND_OFFERS ----------
create policy "Anyone can view active offers"
  on public.brand_offers
  as permissive
  for select
  to public
  using ((active = true));
create policy "Business owners can create offers for their business"
  on public.brand_offers
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = brand_offers.partner_id)))));
create policy "Business owners can delete their own offers"
  on public.brand_offers
  as permissive
  for delete
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = brand_offers.partner_id)))));
create policy "Business owners can update their own offers"
  on public.brand_offers
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = brand_offers.partner_id)))));
-- ---------- GATHERING_FEEDBACK ----------
create policy "Anyone can view feedback"
  on public.gathering_feedback
  as permissive
  for select
  to authenticated
  using (true);
create policy "Attendees can leave feedback for gatherings they attended"
  on public.gathering_feedback
  as permissive
  for insert
  to authenticated
  with check (((reviewer_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM gathering_interest gi
  WHERE ((gi.gathering_id = gathering_feedback.gathering_id) AND (gi.user_id = auth.uid()) AND (gi.status = 'approved'::text))))));
-- ---------- GATHERING_INTENTS ----------
create policy "Users can record their own gathering intent"
  on public.gathering_intents
  as permissive
  for insert
  to public
  with check ((auth.uid() = user_id));
create policy "Users can update their own gathering intent"
  on public.gathering_intents
  as permissive
  for update
  to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "Users can view their own gathering intent"
  on public.gathering_intents
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));
-- ---------- GATHERING_MESSAGES ----------
create policy "Host and approved attendees can send gathering chat"
  on public.gathering_messages
  as permissive
  for insert
  to authenticated
  with check (((auth.uid() = sender_id) AND ((EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.id = gathering_messages.gathering_id) AND (g.host_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM gathering_interest gi
  WHERE ((gi.gathering_id = gathering_messages.gathering_id) AND (gi.user_id = auth.uid()) AND (gi.status = 'approved'::text)))))));
create policy "Host and approved attendees can view gathering chat, excluding "
  on public.gathering_messages
  as permissive
  for select
  to authenticated
  using ((((EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.id = gathering_messages.gathering_id) AND (g.host_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM gathering_interest gi
  WHERE ((gi.gathering_id = gathering_messages.gathering_id) AND (gi.user_id = auth.uid()) AND (gi.status = 'approved'::text))))) AND (NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE (((b.blocker_id = auth.uid()) AND (b.blocked_id = gathering_messages.sender_id)) OR ((b.blocker_id = gathering_messages.sender_id) AND (b.blocked_id = auth.uid()))))))));
-- ---------- GATHERING_QUESTIONS ----------
create policy "Anyone can view gathering questions"
  on public.gathering_questions
  as permissive
  for select
  to public
  using (true);
create policy "Hosts can answer questions on their own gatherings"
  on public.gathering_questions
  as permissive
  for update
  to public
  using ((auth.uid() = ( SELECT gatherings.host_id
   FROM gatherings
  WHERE (gatherings.id = gathering_questions.gathering_id))))
  with check ((auth.uid() = ( SELECT gatherings.host_id
   FROM gatherings
  WHERE (gatherings.id = gathering_questions.gathering_id))));
create policy "Users can ask their own gathering questions"
  on public.gathering_questions
  as permissive
  for insert
  to public
  with check ((auth.uid() = asker_id));
-- ---------- GOODBYE_ARCHIVE_ENTRIES ----------
create policy "Users can create their own reflections"
  on public.goodbye_archive_entries
  as permissive
  for insert
  to public
  with check ((auth.uid() = user_id));
create policy "Users can delete their own reflections"
  on public.goodbye_archive_entries
  as permissive
  for delete
  to public
  using ((auth.uid() = user_id));
create policy "Users can view their own reflections"
  on public.goodbye_archive_entries
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));
-- ---------- ID_VERIFICATION_SUBMISSIONS ----------
create policy "Admins can review submissions"
  on public.id_verification_submissions
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
create policy "Admins can view all submissions"
  on public.id_verification_submissions
  as permissive
  for select
  to authenticated
  using (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))));
create policy "Users can create their own submissions"
  on public.id_verification_submissions
  as permissive
  for insert
  to public
  with check ((auth.uid() = user_id));
-- ---------- INTENTION_HISTORY ----------
create policy "Users can view own intention history"
  on public.intention_history
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));
-- ---------- LIVE_TRACKING_SESSIONS ----------
create policy "Users can create their own sessions"
  on public.live_tracking_sessions
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));
create policy "Users can update their own sessions"
  on public.live_tracking_sessions
  as permissive
  for update
  to authenticated
  using ((auth.uid() = user_id));
create policy "Users can view their own session's non-coordinate fields"
  on public.live_tracking_sessions
  as permissive
  for select
  to authenticated
  using ((user_id = auth.uid()));


-- ---------- MATCHES ----------
create policy "Match participants can update their own match"
  on public.matches
  as permissive
  for update
  to authenticated
  using (((auth.uid() = user_a) OR (auth.uid() = user_b)))
  with check (((auth.uid() = user_a) OR (auth.uid() = user_b)));
create policy "Users can view their own matches"
  on public.matches
  as permissive
  for select
  to public
  using ((((auth.uid() = user_a) OR (auth.uid() = user_b)) AND (NOT is_blocked(user_a, user_b))));
-- ---------- CONSTITUTION_ENTRIES ----------
create policy "Match participants can add constitution entries"
  on public.constitution_entries
  as permissive
  for insert
  to public
  with check (((auth.uid() = added_by) AND (EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = constitution_entries.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())))))));
create policy "Match participants can view constitution entries"
  on public.constitution_entries
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = constitution_entries.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid()))))));
-- ---------- DATE_CHECKINS ----------
create policy "Users manage their own check-ins"
  on public.date_checkins
  as permissive
  for all
  to public
  using ((auth.uid() = user_id));
-- ---------- GATHERING_INTEREST ----------
create policy "Anyone can see approved attendees"
  on public.gathering_interest
  as permissive
  for select
  to public
  using ((status = 'approved'::text));
create policy "Hosts can approve interest, respecting the same safety checks a"
  on public.gathering_interest
  as permissive
  for update
  to authenticated
  using ((auth.uid() = ( SELECT gatherings.host_id
   FROM gatherings
  WHERE (gatherings.id = gathering_interest.gathering_id))))
  with check (((auth.uid() = ( SELECT gatherings.host_id
   FROM gatherings
  WHERE (gatherings.id = gathering_interest.gathering_id))) AND (status = ANY (ARRAY['approved'::text, 'denied'::text])) AND (NOT (EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.id = gathering_interest.gathering_id) AND (g.women_only = true) AND (NOT (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = gathering_interest.user_id) AND (lower(COALESCE(p.gender, ''::text)) = ANY (ARRAY['female'::text, 'woman'::text])))))))))) AND (NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE (((b.blocker_id = auth.uid()) AND (b.blocked_id = gathering_interest.user_id)) OR ((b.blocker_id = gathering_interest.user_id) AND (b.blocked_id = auth.uid()))))))));
create policy "Users can express interest, respecting women-only gatherings"
  on public.gathering_interest
  as permissive
  for insert
  to public
  with check (((auth.uid() = user_id) AND (status = 'pending'::text) AND (NOT (EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.id = gathering_interest.gathering_id) AND (g.women_only = true) AND (NOT (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.gender, ''::text)) = ANY (ARRAY['female'::text, 'woman'::text]))))))))))));
create policy "Users see own interest or gatherings they host"
  on public.gathering_interest
  as permissive
  for select
  to public
  using (((auth.uid() = user_id) OR (auth.uid() = ( SELECT gatherings.host_id
   FROM gatherings
  WHERE (gatherings.id = gathering_interest.gathering_id)))));
-- ---------- MEMORY_VAULT_ITEMS ----------
create policy "Match participants can add memories"
  on public.memory_vault_items
  as permissive
  for insert
  to public
  with check (((auth.uid() = added_by) AND (EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = memory_vault_items.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())))))));
create policy "Match participants can view memories"
  on public.memory_vault_items
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = memory_vault_items.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid()))))));
-- ---------- MESSAGES ----------
create policy "Match participants can mark messages as read"
  on public.messages
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = messages.match_id) AND ((m.user_a = auth.uid()) OR (m.user_b = auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = messages.match_id) AND ((m.user_a = auth.uid()) OR (m.user_b = auth.uid()))))));
create policy "Users can send messages in their own matches"
  on public.messages
  as permissive
  for insert
  to public
  with check (((auth.uid() = sender_id) AND (EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = messages.match_id) AND ((m.user_a = auth.uid()) OR (m.user_b = auth.uid())) AND (NOT is_blocked(m.user_a, m.user_b)))))));
create policy "Users can view messages in their own matches"
  on public.messages
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = messages.match_id) AND ((m.user_a = auth.uid()) OR (m.user_b = auth.uid())) AND (NOT is_blocked(m.user_a, m.user_b))))));
-- ---------- MESSAGE_REACTIONS ----------
create policy "Match participants can react"
  on public.message_reactions
  as permissive
  for insert
  to public
  with check (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM (messages m
     JOIN matches ma ON ((ma.id = m.match_id)))
  WHERE ((m.id = message_reactions.message_id) AND ((ma.user_a = auth.uid()) OR (ma.user_b = auth.uid())))))));
create policy "Match participants can view reactions"
  on public.message_reactions
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM (messages m
     JOIN matches ma ON ((ma.id = m.match_id)))
  WHERE ((m.id = message_reactions.message_id) AND ((ma.user_a = auth.uid()) OR (ma.user_b = auth.uid()))))));
create policy "Users can remove their own reaction"
  on public.message_reactions
  as permissive
  for delete
  to public
  using ((auth.uid() = user_id));
create policy "Users can update their own reaction"
  on public.message_reactions
  as permissive
  for update
  to public
  using ((auth.uid() = user_id));
-- ---------- NOTICES ----------
create policy "See notices sent to you only if mutual, premium, or super"
  on public.notices
  as permissive
  for select
  to public
  using (((auth.uid() = to_user) AND (NOT is_blocked(from_user, to_user)) AND ((is_super = true) OR has_mutual_notice(from_user, to_user) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_premium = true)))))));
create policy "See notices you sent"
  on public.notices
  as permissive
  for select
  to public
  using (((auth.uid() = from_user) AND (NOT is_blocked(from_user, to_user))));
create policy "Users can send notices as themselves"
  on public.notices
  as permissive
  for insert
  to public
  with check ((auth.uid() = from_user));
-- ---------- OFFER_REDEMPTIONS ----------
create policy "Users can view their own redemptions"
  on public.offer_redemptions
  as permissive
  for select
  to public
  using ((auth.uid() = user_id));
-- ---------- PROFILE_PHOTOS ----------
create policy "Users can delete own extra photos"
  on public.profile_photos
  as permissive
  for delete
  to public
  using ((auth.uid() = user_id));
create policy "Users can insert own extra photos"
  on public.profile_photos
  as permissive
  for insert
  to public
  with check ((auth.uid() = user_id));
create policy "Users can update own extra photos"
  on public.profile_photos
  as permissive
  for update
  to public
  using ((auth.uid() = user_id));
create policy "Users can view own or verified user's extra photos"
  on public.profile_photos
  as permissive
  for select
  to public
  using (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = profile_photos.user_id) AND (p.photo_verified = true))))));


-- ---------- REFERRAL_REDEMPTIONS ----------
create policy "Users can create their own redemption"
  on public.referral_redemptions
  as permissive
  for insert
  to public
  with check ((auth.uid() = referred_id));
create policy "Users can view redemptions they're part of"
  on public.referral_redemptions
  as permissive
  for select
  to public
  using (((auth.uid() = referrer_id) OR (auth.uid() = referred_id)));


-- ---------- RELATIONSHIP_LEGACY_ENTRIES ----------
create policy "Anyone can read legacy entries"
  on public.relationship_legacy_entries
  as permissive
  for select
  to public
  using (true);
create policy "Match participants can submit their own entry"
  on public.relationship_legacy_entries
  as permissive
  for insert
  to public
  with check (((auth.uid() = submitted_by) AND (EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = relationship_legacy_entries.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())))))));
-- ---------- REPORTS ----------
create policy "Admins can resolve reports"
  on public.reports
  as permissive
  for update
  to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
create policy "Admins can view all reports"
  on public.reports
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
create policy "Users can create reports"
  on public.reports
  as permissive
  for insert
  to public
  with check ((auth.uid() = reporter_id));
create policy "Users can view their own submitted reports"
  on public.reports
  as permissive
  for select
  to public
  using ((auth.uid() = reporter_id));
-- ---------- SHARED_DECISIONS ----------
create policy "Match participants can add shared decisions"
  on public.shared_decisions
  as permissive
  for insert
  to public
  with check (((auth.uid() = added_by) AND (EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = shared_decisions.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())))))));
create policy "Match participants can view shared decisions"
  on public.shared_decisions
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = shared_decisions.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid()))))));
-- ---------- SHARED_PLAYLIST_ITEMS ----------
create policy "Match participants can add songs"
  on public.shared_playlist_items
  as permissive
  for insert
  to authenticated
  with check (((auth.uid() = added_by) AND (EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = shared_playlist_items.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())) AND (NOT is_blocked(matches.user_a, matches.user_b)))))));
create policy "Match participants can view playlist"
  on public.shared_playlist_items
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = shared_playlist_items.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())) AND (NOT is_blocked(matches.user_a, matches.user_b))))));
-- ---------- SIGHTINGS ----------
create policy "Users can view their own sightings only"
  on public.sightings
  as permissive
  for select
  to public
  using ((((auth.uid() = user_a) OR (auth.uid() = user_b)) AND (NOT is_blocked(user_a, user_b))));
-- ---------- SOCIAL_INVITES ----------
create policy "Users can view invites they sent or received"
  on public.social_invites
  as permissive
  for select
  to public
  using (((auth.uid() = inviter_id) OR (auth.uid() = invitee_id)));
-- ---------- STORIES ----------
create policy "Users can delete their own stories"
  on public.stories
  as permissive
  for delete
  to authenticated
  using ((auth.uid() = user_id));
create policy "Users can post their own stories"
  on public.stories
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));
create policy "Visible to poster, matches, friends, fellow attendees, host, or"
  on public.stories
  as permissive
  for select
  to authenticated
  using (((NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE (((b.blocker_id = auth.uid()) AND (b.blocked_id = stories.user_id)) OR ((b.blocker_id = stories.user_id) AND (b.blocked_id = auth.uid())))))) AND ((is_public = true) OR (user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM matches m
  WHERE (((m.user_a = auth.uid()) AND (m.user_b = stories.user_id)) OR ((m.user_a = stories.user_id) AND (m.user_b = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM friendships f
  WHERE ((f.status = 'accepted'::text) AND (((f.user_a = auth.uid()) AND (f.user_b = stories.user_id)) OR ((f.user_a = stories.user_id) AND (f.user_b = auth.uid())))))) OR ((gathering_id IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM gathering_interest gi
  WHERE ((gi.gathering_id = stories.gathering_id) AND (gi.user_id = auth.uid()) AND (gi.status = 'approved'::text)))) OR (EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.id = stories.gathering_id) AND (g.host_id = auth.uid())))))))));
-- ---------- STORY_VIEWS ----------
create policy "Story owner and viewer can see view records"
  on public.story_views
  as permissive
  for select
  to authenticated
  using (((auth.uid() = viewer_id) OR (EXISTS ( SELECT 1
   FROM stories s
  WHERE ((s.id = story_views.story_id) AND (s.user_id = auth.uid()))))));
create policy "Viewers can record their own views"
  on public.story_views
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = viewer_id));
-- ---------- STRESS_TEST_NOTES ----------
create policy "Match participants can add stress test notes"
  on public.stress_test_notes
  as permissive
  for insert
  to public
  with check (((auth.uid() = added_by) AND (EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = stress_test_notes.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())))))));
create policy "Match participants can view stress test notes"
  on public.stress_test_notes
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = stress_test_notes.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid()))))));
-- ---------- TIMELINE_NOTES ----------
create policy "Match participants can add timeline notes"
  on public.timeline_notes
  as permissive
  for insert
  to public
  with check (((auth.uid() = added_by) AND (EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = timeline_notes.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())))))));
create policy "Match participants can view timeline notes"
  on public.timeline_notes
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = timeline_notes.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid()))))));
-- ---------- TRIP_IDEAS ----------
create policy "Match participants can add trip ideas"
  on public.trip_ideas
  as permissive
  for insert
  to public
  with check (((auth.uid() = added_by) AND (EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = trip_ideas.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid())))))));
create policy "Match participants can view trip ideas"
  on public.trip_ideas
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM matches
  WHERE ((matches.id = trip_ideas.match_id) AND ((matches.user_a = auth.uid()) OR (matches.user_b = auth.uid()))))));
-- ==================== TRIGGERS ====================
-- (Deferred to after FUNCTIONS for the same reason as policies above --
-- CREATE TRIGGER requires its EXECUTE FUNCTION target to already exist.)
-- ---------- BUSINESS_UPDATES ----------
CREATE TRIGGER on_business_update_created AFTER INSERT ON public.business_updates FOR EACH ROW EXECUTE FUNCTION notify_business_update();
-- ---------- PROFILES ----------
CREATE TRIGGER block_client_premium_self_edit BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_self_premium_edit();
CREATE TRIGGER on_intention_change AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION log_intention_change();
-- ---------- COMMUNITIES ----------
CREATE TRIGGER on_community_created_enforce_limit BEFORE INSERT ON public.communities FOR EACH ROW EXECUTE FUNCTION enforce_community_daily_limit();
CREATE TRIGGER on_community_created_set_partner BEFORE INSERT ON public.communities FOR EACH ROW EXECUTE FUNCTION set_community_hosting_partner_from_creator();
CREATE TRIGGER on_community_updated_protect_partner BEFORE UPDATE ON public.communities FOR EACH ROW EXECUTE FUNCTION prevent_hosting_partner_self_edit();
-- ---------- FRIENDSHIPS ----------
CREATE TRIGGER on_friend_request_accepted AFTER UPDATE ON public.friendships FOR EACH ROW EXECUTE FUNCTION notify_friend_request_accepted();
CREATE TRIGGER on_friend_request_created AFTER INSERT ON public.friendships FOR EACH ROW EXECUTE FUNCTION notify_friend_request();
CREATE TRIGGER on_friend_request_enforce_limit BEFORE INSERT ON public.friendships FOR EACH ROW EXECUTE FUNCTION enforce_friend_request_daily_limit();
CREATE TRIGGER on_friendship_accepted_create_match AFTER UPDATE ON public.friendships FOR EACH ROW EXECUTE FUNCTION create_match_on_friendship_accepted();
-- ---------- GATHERINGS ----------
CREATE TRIGGER on_gathering_created_enforce_limit BEFORE INSERT ON public.gatherings FOR EACH ROW EXECUTE FUNCTION enforce_gathering_daily_limit();
CREATE TRIGGER on_gathering_created_set_partner BEFORE INSERT ON public.gatherings FOR EACH ROW EXECUTE FUNCTION set_hosting_partner_from_host();
CREATE TRIGGER on_gathering_deleted BEFORE DELETE ON public.gatherings FOR EACH ROW EXECUTE FUNCTION notify_gathering_cancelled();
CREATE TRIGGER on_gathering_deleted_deactivate_offer BEFORE DELETE ON public.gatherings FOR EACH ROW EXECUTE FUNCTION deactivate_offer_on_gathering_delete();
CREATE TRIGGER on_gathering_updated_notify AFTER UPDATE ON public.gatherings FOR EACH ROW EXECUTE FUNCTION notify_gathering_updated();
CREATE TRIGGER on_gathering_updated_protect_partner BEFORE UPDATE ON public.gatherings FOR EACH ROW EXECUTE FUNCTION prevent_hosting_partner_self_edit();
-- ---------- MATCHES ----------
CREATE TRIGGER on_match_created AFTER INSERT ON public.matches FOR EACH ROW EXECUTE FUNCTION notify_new_match();
-- ---------- CONSTITUTION_ENTRIES ----------
CREATE TRIGGER on_constitution_entry_added AFTER INSERT ON public.constitution_entries FOR EACH ROW EXECUTE FUNCTION notify_constitution_addition();
-- ---------- GATHERING_INTEREST ----------
CREATE TRIGGER no_self_gathering_interest BEFORE INSERT ON public.gathering_interest FOR EACH ROW EXECUTE FUNCTION prevent_self_interest();
CREATE TRIGGER on_gathering_interest_approved AFTER UPDATE ON public.gathering_interest FOR EACH ROW EXECUTE FUNCTION notify_gathering_approved();
CREATE TRIGGER on_gathering_interest_created AFTER INSERT ON public.gathering_interest FOR EACH ROW EXECUTE FUNCTION notify_gathering_interest();
-- ---------- MEMORY_VAULT_ITEMS ----------
CREATE TRIGGER on_memory_item_added AFTER INSERT ON public.memory_vault_items FOR EACH ROW EXECUTE FUNCTION notify_memory_addition();
-- ---------- MESSAGES ----------
CREATE TRIGGER on_message_created AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_new_message();
-- ---------- NOTICES ----------
CREATE TRIGGER enforce_notice_daily_limit_trigger BEFORE INSERT ON public.notices FOR EACH ROW EXECUTE FUNCTION enforce_notice_daily_limit();
CREATE TRIGGER enforce_super_notice_limit_trigger BEFORE INSERT ON public.notices FOR EACH ROW EXECUTE FUNCTION enforce_super_notice_limit();
CREATE TRIGGER on_notice_created AFTER INSERT ON public.notices FOR EACH ROW EXECUTE FUNCTION check_mutual_notice();
CREATE TRIGGER on_super_notice_created AFTER INSERT ON public.notices FOR EACH ROW EXECUTE FUNCTION notify_super_notice();
-- ---------- OFFER_REDEMPTIONS ----------
CREATE TRIGGER on_offer_redemption_enforce_limit BEFORE INSERT ON public.offer_redemptions FOR EACH ROW EXECUTE FUNCTION enforce_offer_redemption_limit();
CREATE TRIGGER trg_enforce_offer_unlock_threshold BEFORE INSERT ON public.offer_redemptions FOR EACH ROW EXECUTE FUNCTION enforce_offer_unlock_threshold();
-- ---------- SHARED_DECISIONS ----------
CREATE TRIGGER notify_shared_decision_addition_trigger AFTER INSERT ON public.shared_decisions FOR EACH ROW EXECUTE FUNCTION notify_shared_decision_addition();
-- ---------- SHARED_PLAYLIST_ITEMS ----------
CREATE TRIGGER notify_playlist_addition_trigger AFTER INSERT ON public.shared_playlist_items FOR EACH ROW EXECUTE FUNCTION notify_playlist_addition();
-- ---------- STORIES ----------
CREATE TRIGGER on_story_created AFTER INSERT ON public.stories FOR EACH ROW EXECUTE FUNCTION notify_new_story();
CREATE TRIGGER on_story_created_enforce_limit BEFORE INSERT ON public.stories FOR EACH ROW EXECUTE FUNCTION enforce_story_daily_limit();
-- ---------- STRESS_TEST_NOTES ----------
CREATE TRIGGER on_stress_test_note_added AFTER INSERT ON public.stress_test_notes FOR EACH ROW EXECUTE FUNCTION notify_stress_test_addition();
-- ---------- TIMELINE_NOTES ----------
CREATE TRIGGER on_timeline_note_added AFTER INSERT ON public.timeline_notes FOR EACH ROW EXECUTE FUNCTION notify_timeline_addition();
-- ---------- TRIP_IDEAS ----------
CREATE TRIGGER notify_trip_idea_addition_trigger AFTER INSERT ON public.trip_ideas FOR EACH ROW EXECUTE FUNCTION notify_trip_idea_addition();
-- ==================== FUNCTION GRANTS (informational snapshot) ====================
-- anon / authenticated / service_role / public EXECUTE privilege, as of the pull.
-- Not re-executable SQL (informational only) — re-derive actual grant/revoke
-- statements from this if reconstructing a function's access from scratch.
-- admin_approve_id_verification (20395): authenticated, service_role
-- approve_business_partner_request (19833): authenticated, service_role
-- approve_gathering_interest (20454): authenticated, service_role
-- block_and_unmatch (18779): authenticated, service_role
-- check_and_increment_ai_use (19456): service_role
-- check_in_to_gathering (20275): authenticated, service_role
-- check_is_admin (18391): authenticated, service_role
-- check_mutual_notice (18293): authenticated, service_role
-- confirm_offer_redemption (added 2026-08-09): authenticated, service_role
-- count_gatherings_near (20009): authenticated, service_role
-- count_gatherings_near_batch (20010): authenticated, service_role
-- count_redemptions_since (20059): authenticated, service_role
-- create_match_on_friendship_accepted (19629): authenticated, service_role
-- deactivate_offer_on_gathering_delete (20001): authenticated, service_role
-- delete_expired_disappearing_messages (19402): authenticated, service_role
-- delete_expired_stories (19546): authenticated, service_role
-- enforce_community_daily_limit (20029): authenticated, service_role
-- enforce_friend_request_daily_limit (20032): authenticated, service_role
-- enforce_gathering_daily_limit (20027): authenticated, service_role
-- enforce_notice_daily_limit (18774): authenticated, service_role
-- enforce_offer_redemption_limit (20054): authenticated, service_role
-- enforce_offer_unlock_threshold (20352): service_role
-- enforce_story_daily_limit (20035): authenticated, service_role
-- enforce_super_notice_limit (18685): authenticated, service_role
-- expire_live_tracking_sessions (19427): authenticated, service_role
-- generate_monthly_invoices (20210): service_role
-- generate_next_recurring_gathering (19857): authenticated, service_role
-- get_business_dashboard_stats (19773): authenticated, service_role
-- get_business_follower_count (20290): authenticated, service_role
-- get_business_growth (19859): authenticated, service_role
-- get_business_insights (19834): authenticated, service_role
-- get_business_member_gathering_history (20291): authenticated, service_role
-- get_business_top_members (19901): authenticated, service_role
-- get_business_visit_frequency (19902): authenticated, service_role
-- get_gathering_attendee_breakdown (19858): authenticated, service_role
-- get_gathering_distances (19400): authenticated, service_role
-- get_gathering_meetup_point (20276): authenticated, service_role
-- get_host_reputation (19856): authenticated, service_role
-- get_host_stats (19661): authenticated, service_role
-- get_intention_change_count (18818): authenticated, service_role
-- get_live_tracking_session (19917): anon, authenticated, service_role, public(PUBLIC pseudo-role)
-- get_mutual_friends (19659): authenticated, service_role
-- get_nearby_offer_ids (20056): authenticated, service_role
-- get_newcomer_count (19662): authenticated, service_role
-- get_offer_redemption_counts (20058): authenticated, service_role
-- get_partner_billing_estimate (20214): authenticated, service_role
-- get_public_stories_with_fuzzed_coords (19605): authenticated, service_role
-- get_sighting_fuzzed_coords (19505): authenticated, service_role
-- get_social_forecast (19660): authenticated, service_role
-- get_suggested_friends (19658): authenticated, service_role
-- get_trending_gathering_ids (20008): authenticated, service_role
-- get_weather_result (19664): authenticated, service_role
-- grant_referral_bonus (20397): authenticated, service_role
-- has_mutual_notice (19002): authenticated, service_role
-- increment_browse_views (19446): authenticated, service_role
-- invite_friend_to_gathering (19502): authenticated, service_role
-- is_blocked (18260): authenticated, service_role
-- is_community_visible_to (20444): authenticated, service_role
-- join_gathering (20453): authenticated, service_role
-- leave_gathering (20455): authenticated, service_role
-- log_intention_change (18816): authenticated, service_role
-- match_contacts_to_users (19487): authenticated, service_role
-- notify_business_update (19805): authenticated, service_role
-- notify_constitution_addition (19320): authenticated, service_role
-- notify_friend_request (19498): authenticated, service_role
-- notify_friend_request_accepted (19500): authenticated, service_role
-- notify_gathering_approved (18754): authenticated, service_role
-- notify_gathering_cancelled (19406): authenticated, service_role
-- notify_gathering_interest (18752): authenticated, service_role
-- notify_gathering_updated (19895): authenticated, service_role
-- notify_memory_addition (19316): authenticated, service_role
-- notify_new_match (18295): authenticated, service_role
-- notify_new_message (18297): authenticated, service_role
-- notify_new_story (19606): authenticated, service_role
-- notify_playlist_addition (19028): authenticated, service_role
-- notify_screenshot_taken (19497): authenticated, service_role
-- notify_shared_decision_addition (19030): authenticated, service_role
-- notify_stress_test_addition (19318): authenticated, service_role
-- notify_super_notice (18687): authenticated, service_role
-- notify_timeline_addition (19314): authenticated, service_role
-- notify_trip_idea_addition (19032): authenticated, service_role
-- prevent_hosting_partner_self_edit (20398): anon, authenticated, service_role, public(PUBLIC pseudo-role)
-- prevent_self_interest (18985): anon, authenticated, service_role, public(PUBLIC pseudo-role)
-- prevent_self_premium_edit (19569): authenticated, service_role
-- purge_expired_sightings (18299): authenticated, service_role
-- request_business_partnership (20427): authenticated, service_role
-- respond_to_business_partnership_request (20428): authenticated, service_role
-- respond_to_social_invite (20390): authenticated, service_role
-- rls_auto_enable (17596): authenticated, service_role
-- send_birthday_reminders (19657): authenticated, service_role
-- send_first_mission_reminders (20053): authenticated, service_role
-- send_gathering_reminders (19504): authenticated, service_role
-- send_match_reminders (19398): authenticated, service_role
-- send_momentum_nudges (added 2026-08-09): service_role
-- send_social_invite (20389): authenticated, service_role
-- set_community_hosting_partner_from_creator (19812): authenticated, service_role
-- set_community_member_role (20292): authenticated, service_role
-- set_gathering_on_my_way (20274): authenticated, service_role
-- set_hosting_partner_from_host (19787): authenticated, service_role
-- set_premium_status (19918): service_role
-- spend_bonus_notice (20396): authenticated, service_role
-- submit_weather_request (19663): authenticated, service_role
-- unmatch (18866): authenticated, service_role

-- ==================== TABLE GRANTS (informational snapshot) ====================
-- blocks -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- brand_offers -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- brand_partners -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- business_followers -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- business_invoices -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- business_messages -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- business_partner_requests -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- business_partnership_requests -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- business_updates -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- chemistry_diary_entries -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- communities -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- community_members -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- community_messages -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- constitution_entries -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- date_checkins -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- emergency_contacts -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- friend_circle_members -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- friend_circles -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- friendships -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- gathering_feedback -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- gathering_intents -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- gathering_interest -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- gathering_messages -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- gathering_questions -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- gatherings -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- goodbye_archive_entries -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- id_verification_submissions -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- intention_history -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- live_tracking_sessions -> anon: DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- matches -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- memory_vault_items -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- message_reactions -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- messages -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- notices -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- offer_redemptions -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- partner_contracts -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- presence_reports -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- profile_photos -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- profiles -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- referral_redemptions -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- relationship_legacy_entries -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- reports -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- review_login_attempts -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- shared_decisions -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- shared_playlist_items -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- sightings -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- social_invites -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- stories -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- story_views -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- stress_test_notes -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- timeline_notes -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- trip_ideas -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | service_role: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

-- ==================== STORAGE BUCKETS ====================

insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('gathering-photos', 'gathering-photos', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('id-verification', 'id-verification', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('profile-photos', 'profile-photos', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('stories', 'stories', false)
  on conflict (id) do nothing;

-- ---------- storage.objects RLS policies ----------
create policy "Anyone can view gathering cover photos"
  on storage.objects
  for select
  to public
  using ((bucket_id = 'gathering-photos'::text));

create policy "Hosts can replace their own gathering cover photos"
  on storage.objects
  for update
  to public
  using (((bucket_id = 'gathering-photos'::text) AND (EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.host_id = auth.uid()) AND ((storage.foldername(objects.name))[1] = (g.id)::text))))));

create policy "Hosts can upload their own gathering cover photos"
  on storage.objects
  for insert
  to public
  with check (((bucket_id = 'gathering-photos'::text) AND (EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.host_id = auth.uid()) AND ((storage.foldername(objects.name))[1] = (g.id)::text))))));

create policy "Only match participants can view chat media"
  on storage.objects
  for select
  to authenticated
  using (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM (messages m
     JOIN matches ma ON ((ma.id = m.match_id)))
  WHERE (((m.media_url = objects.name) OR (m.audio_url = objects.name)) AND ((ma.user_a = auth.uid()) OR (ma.user_b = auth.uid())))))));

create policy "Story media visible to poster, matches, friends, fellow attende"
  on storage.objects
  for select
  to authenticated
  using (((bucket_id = 'stories'::text) AND (EXISTS ( SELECT 1
   FROM stories s
  WHERE ((s.media_path = objects.name) AND (NOT (EXISTS ( SELECT 1
           FROM blocks b
          WHERE (((b.blocker_id = auth.uid()) AND (b.blocked_id = s.user_id)) OR ((b.blocker_id = s.user_id) AND (b.blocked_id = auth.uid())))))) AND ((s.is_public = true) OR (s.user_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM matches m
          WHERE (((m.user_a = auth.uid()) AND (m.user_b = s.user_id)) OR ((m.user_a = s.user_id) AND (m.user_b = auth.uid()))))) OR (EXISTS ( SELECT 1
           FROM friendships f
          WHERE ((f.status = 'accepted'::text) AND (((f.user_a = auth.uid()) AND (f.user_b = s.user_id)) OR ((f.user_a = s.user_id) AND (f.user_b = auth.uid())))))) OR ((s.gathering_id IS NOT NULL) AND ((EXISTS ( SELECT 1
           FROM gathering_interest gi
          WHERE ((gi.gathering_id = s.gathering_id) AND (gi.user_id = auth.uid()) AND (gi.status = 'approved'::text)))) OR (EXISTS ( SELECT 1
           FROM gatherings g
          WHERE ((g.id = s.gathering_id) AND (g.host_id = auth.uid()))))))))))));

create policy "Users can delete their own profile photos"
  on storage.objects
  for delete
  to authenticated
  using (((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy "Users can update their own profile photo"
  on storage.objects
  for update
  to public
  using (((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy "Users can upload their own profile photo"
  on storage.objects
  for insert
  to public
  with check (((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy "Users can upload their own verification photos"
  on storage.objects
  for insert
  to authenticated
  with check (((bucket_id = 'id-verification'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy "Users can view own or verified profile photos"
  on storage.objects
  for select
  to public
  using (((bucket_id = 'profile-photos'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE (((p.id)::text = (storage.foldername(objects.name))[1]) AND (p.photo_verified = true)))))));

create policy "Users can view their own verification photos, admins can view a"
  on storage.objects
  for select
  to authenticated
  using (((bucket_id = 'id-verification'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))))));

create policy "chat_media_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (((bucket_id = 'chat-media'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy "story_media_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (((bucket_id = 'stories'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


-- ==================== SCHEDULED JOBS (pg_cron) ====================
-- Re-derived as executable select cron.schedule(...) calls (must run as
-- postgres, which owns these functions and is who pg_cron actually
-- invokes them as at run time).
select cron.schedule('send-match-reminders', '0 * * * *', 'select send_match_reminders();');
select cron.schedule('delete-expired-disappearing-messages', '* * * * *', 'select delete_expired_disappearing_messages();');
select cron.schedule('expire-live-tracking-sessions', '*/5 * * * *', 'select expire_live_tracking_sessions();');
select cron.schedule('send-gathering-reminders', '*/15 * * * *', 'select send_gathering_reminders();');
select cron.schedule('delete-expired-stories', '0 * * * *', 'select delete_expired_stories();');
select cron.schedule('send-birthday-reminders', '0 9 * * *', 'select send_birthday_reminders();');
select cron.schedule('generate-recurring-gatherings', '0 * * * *', 'select generate_next_recurring_gathering();');
select cron.schedule('send-first-mission-reminders', '0 10 * * *', 'select send_first_mission_reminders();');
select cron.schedule('generate-monthly-invoices', '0 6 1 * *', 'select generate_monthly_invoices();');
select cron.schedule('send-momentum-reward-nudges', '0 15 * * 3', 'select send_momentum_nudges();'); -- added 2026-08-09
