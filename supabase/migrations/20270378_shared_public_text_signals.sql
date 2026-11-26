-- The same public text on several accounts, for admin review (owner, 2026-11-01: cross-account copy/paste, idea 4, gap 1).
-- Staged after 20270377; deploy only with its own approval. DETECTS NOTHING until the owner approves the numbers:
-- private.account_signal_settings.shared_text_min_accounts starts null, and while it is null NOTHING is stored or compared
-- (no key is computed, no sighting is kept). Activation = a separate migration (as 0358 / 0365) that sets the numbers and
-- runs private.backfill_shared_text_sightings() once. The owner's proposed starting point is 5 accounts in 30 days: an
-- initial testing assumption, NOT a proven abuse threshold; validate it before activation against legitimate shared
-- text (a recurring meetup's announcement copied by its co-organisers, a club's standard description).
--
-- What it looks at: ONLY text other people can already read: a profile's published bio (a held edit, 20270373, keeps the
-- published bio, so it is read only once approved), and the description of a PUBLIC gathering (visibility 'everyone') that
-- is not held for review (moderation_state 'visible'; a held one is read when it is approved). Friends-only, community,
-- invite-only gatherings and every message are never read for this.
-- Recurring occurrences and several gatherings by one host are ONE account, so they never add up on their own.
--   * Stored: a keyed one-way hash of the NORMALIZED text (lower case, NFKC, every run of non-letters/digits = one space;
--     HMAC-SHA256 under a server-only secret, private.text_signal_secret), per account and source, with first and last
--     time it was posted. NEVER the text itself; no excerpt, no length, no language. An admin reads the text where it
--     is already public: the member accounts' profiles, and the gathering ids carried in the case evidence.
--   * Generic text is left out before anything is hashed: shorter than shared_text_min_chars normalized characters or
--     fewer than shared_text_min_words distinct words (defaults 80 / 12) = ignored. Known legitimate templates can be
--     listed as keys in private.shared_text_excluded_keys (server-only private.exclude_shared_text(text); no client or
--     admin-website access); a listed key is never recorded. The app offers no bio or description templates today.
--   * Kept 30 days after the account last posted that text (private.text_sightings; purged daily); deleting an account
--     deletes its sightings. Editing the text away does not delete the sighting: it was posted within the window.
-- A CASE (the 20270357 queue, signal 'shared_text', reason 'many_accounts') opens only when the same key was posted by at
-- least shared_text_min_accounts distinct accounts within 30 days (>= 3 enforced; two accounts alone never open anything).
-- One cluster = one case: a key that qualifies joins an existing shared-text case when at least half of its accounts are
-- already that case's members (the same group copying its bio AND its gathering description = one case, not two);
-- otherwise one case per key. Later accounts join the open case; on a closed case a new account is "new evidence since
-- closed" and the case stays closed (20270369's triggers); only an admin reopens. Closing a case as "no action needed" is
-- therefore how an admin dismisses a legitimate shared text: it never alerts again by itself.
-- Case evidence = counts (accounts, by source), the window, and up to 20 public gathering ids; never text or keys.
-- NOTHING here bans, suspends, hides, restricts, limits, scores or tells anyone. Every step runs in its own exception
-- block: a failure never blocks saving a profile or a gathering (recorded privately in private.text_signal_failures,
-- no detail about the person). Concurrency: one evaluation per key at a time (transaction advisory lock on the key) and
-- one cluster decision at a time (a second advisory lock); a unique index on each key's case backs it up. The secret
-- lives in the database (whoever can read the private schema can test a text they already know against it): same
-- accepted limit + the same pre-deploy secret review as 20270374 / 20270376.

-- 1. Settings (off) ------------------------------------------------------------------------------------------------------
alter table private.account_signal_settings
  add column if not exists shared_text_min_accounts integer
    check (shared_text_min_accounts is null or shared_text_min_accounts >= 3),
  add column if not exists shared_text_min_chars integer not null default 80
    check (shared_text_min_chars >= 40),
  add column if not exists shared_text_min_words integer not null default 12
    check (shared_text_min_words >= 8);

-- 2. The secret, normalization and the key ---------------------------------------------------------------------------------
create table if not exists private.text_signal_secret (
  id boolean primary key default true check (id),
  secret bytea not null check (length(secret) = 32),
  created_at timestamptz not null default now()
);
revoke all on private.text_signal_secret from public, anon, authenticated;
insert into private.text_signal_secret (secret) values (extensions.gen_random_bytes(32)) on conflict (id) do nothing;

create or replace function private.shared_text_normalized(p_text text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select btrim(regexp_replace(lower(normalize(coalesce(p_text, ''), NFKC)), '[^[:alnum:]]+', ' ', 'g'));
$function$;
revoke all on function private.shared_text_normalized(text) from public, anon, authenticated;

-- null = too short / too generic to mean anything (or the detector is off, or the text is an excluded template)
create or replace function private.shared_text_key(p_text text)
returns bytea
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  s private.account_signal_settings;
  v_norm text := private.shared_text_normalized(p_text);
  v_key bytea;
begin
  select * into s from private.account_signal_settings where id;
  if s.shared_text_min_accounts is null then return null; end if;
  if length(v_norm) < s.shared_text_min_chars then return null; end if;
  if (select count(distinct w) from unnest(string_to_array(v_norm, ' ')) w where w <> '') < s.shared_text_min_words then
    return null;
  end if;
  select extensions.hmac(convert_to('public-text:v1:' || v_norm, 'UTF8'), t.secret, 'sha256') into v_key
    from private.text_signal_secret t;
  if v_key is null or exists (select 1 from private.shared_text_excluded_keys e where e.text_key = v_key) then return null; end if;
  return v_key;
end;
$function$;

create or replace function private.shared_text_active()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select shared_text_min_accounts is not null from private.account_signal_settings where id), false);
$function$;
revoke all on function private.shared_text_active() from public, anon, authenticated;

-- 3. Tables ----------------------------------------------------------------------------------------------------------------
create table if not exists private.text_sightings (
  text_key bytea not null check (length(text_key) = 32),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('bio', 'gathering_description')),
  gathering_id uuid,                    -- the public gathering it was posted on (no FK: a deleted gathering keeps nothing)
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  check ((source = 'bio') = (gathering_id is null))
);
create unique index if not exists text_sightings_one on private.text_sightings
  (text_key, user_id, source, coalesce(gathering_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists text_sightings_user_idx on private.text_sightings (user_id);
create index if not exists text_sightings_last_seen_idx on private.text_sightings (last_seen);

create table if not exists private.shared_text_excluded_keys (
  text_key bytea primary key check (length(text_key) = 32),
  added_at timestamptz not null default now()
);

-- which text a shared-text case is about (one case per key; deleted with the case)
create table if not exists private.account_review_case_texts (
  case_id uuid not null references private.account_review_cases(id) on delete cascade,
  text_key bytea not null check (length(text_key) = 32),
  primary key (case_id, text_key)
);
create unique index if not exists account_review_case_texts_one_case on private.account_review_case_texts (text_key);

create table if not exists private.text_signal_failures (
  id bigint generated always as identity primary key,
  step text not null,
  sqlstate text,
  at timestamptz not null default now()
);
revoke all on private.text_sightings, private.shared_text_excluded_keys, private.account_review_case_texts,
  private.text_signal_failures from public, anon, authenticated;
revoke all on function private.shared_text_key(text) from public, anon, authenticated;

-- server-only: list a known legitimate template so it is never recorded (and drop what was recorded for it)
create or replace function private.exclude_shared_text(p_text text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_norm text := private.shared_text_normalized(p_text);
  v_key bytea;
begin
  if v_norm = '' then return false; end if;
  select extensions.hmac(convert_to('public-text:v1:' || v_norm, 'UTF8'), t.secret, 'sha256') into v_key
    from private.text_signal_secret t;
  insert into private.shared_text_excluded_keys (text_key) values (v_key) on conflict do nothing;
  delete from private.text_sightings where text_key = v_key;
  return true;
end;
$function$;
revoke all on function private.exclude_shared_text(text) from public, anon, authenticated;

-- 4. Case kind -------------------------------------------------------------------------------------------------------------
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'account_recovery',
                    'shared_device', 'shared_text'));
-- (reason 'many_accounts' already exists; account_review_cases_subject_check is unchanged: a shared-text case has
-- neither sha256 nor subject_user, its accounts are its members, like a shared-device case.)

-- 5. Evaluation ------------------------------------------------------------------------------------------------------------
-- Opens / extends the shared-text case for one key when the approved rule holds. Never touches an account.
create or replace function private.evaluate_shared_text(p_key bytea)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.account_signal_settings;
  v_users uuid[];
  v_case uuid;
  v_status text;
  v_evidence jsonb;
begin
  select * into s from private.account_signal_settings where id;
  if s.shared_text_min_accounts is null or p_key is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('text_case:' || encode(p_key, 'hex')));

  select coalesce(array_agg(u order by f), '{}') into v_users from (
    select t.user_id u, min(t.first_seen) f
      from private.text_sightings t
     where t.text_key = p_key and t.last_seen > now() - interval '30 days'
       and exists (select 1 from auth.users a where a.id = t.user_id)
     group by t.user_id) x;

  select c.id, c.status into v_case, v_status
    from private.account_review_case_texts ct join private.account_review_cases c on c.id = ct.case_id
   where ct.text_key = p_key
   for update of c;

  if v_case is null then
    if cardinality(v_users) < s.shared_text_min_accounts then return; end if;
    -- one cluster decision at a time: the same group's bio and description keys qualifying together join one case
    perform pg_advisory_xact_lock(hashtext('text_case_cluster'));
    select m.case_id into v_case
      from private.account_review_case_members m
      join private.account_review_cases c on c.id = m.case_id and c.signal = 'shared_text'
     where m.user_id = any(v_users)
     group by m.case_id
    having count(*) * 2 >= cardinality(v_users)
     order by count(*) desc, m.case_id
     limit 1;
    if v_case is null then
      insert into private.account_review_cases (signal, reason, evidence) values ('shared_text', 'many_accounts', '{}'::jsonb)
        returning id into v_case;
    end if;
    insert into private.account_review_case_texts (case_id, text_key) values (v_case, p_key);
    select status into v_status from private.account_review_cases where id = v_case for update;
  end if;

  -- on a closed case only a NEW account inserts a row (= new evidence, 20270369's trigger); the case stays closed
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;

  if v_status = 'open' then
    -- evidence over every text of the case: counts by source + up to 20 public gathering ids (never text or keys)
    select jsonb_build_object(
             'accounts', (select count(*) from private.account_review_case_members m where m.case_id = v_case),
             'window_days', 30,
             'texts', (select count(*) from private.account_review_case_texts ct where ct.case_id = v_case),
             'bio_accounts', (select count(distinct t.user_id) from private.text_sightings t
                                join private.account_review_case_texts ct on ct.text_key = t.text_key and ct.case_id = v_case
                               where t.source = 'bio' and t.last_seen > now() - interval '30 days'),
             'gathering_accounts', (select count(distinct t.user_id) from private.text_sightings t
                                join private.account_review_case_texts ct on ct.text_key = t.text_key and ct.case_id = v_case
                               where t.source = 'gathering_description' and t.last_seen > now() - interval '30 days'),
             'gathering_ids', coalesce((select jsonb_agg(g order by g) from (
                  select distinct t.gathering_id g from private.text_sightings t
                    join private.account_review_case_texts ct on ct.text_key = t.text_key and ct.case_id = v_case
                   where t.source = 'gathering_description' and t.last_seen > now() - interval '30 days'
                   order by t.gathering_id limit 20) y), '[]'::jsonb))
      into v_evidence;
    update private.account_review_cases set evidence = v_evidence, updated_at = now() where id = v_case;
  end if;
end;
$function$;
revoke all on function private.evaluate_shared_text(bytea) from public, anon, authenticated;

-- 6. Recording -------------------------------------------------------------------------------------------------------------
create or replace function private.note_text_sighting(p_user uuid, p_source text, p_gathering uuid, p_text text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key bytea;
begin
  if p_user is null or not private.shared_text_active() then return; end if;
  v_key := private.shared_text_key(p_text);
  if v_key is null then return; end if;
  insert into private.text_sightings (text_key, user_id, source, gathering_id) values (v_key, p_user, p_source, p_gathering)
  on conflict (text_key, user_id, source, coalesce(gathering_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set last_seen = now();
  perform private.evaluate_shared_text(v_key);
end;
$function$;
revoke all on function private.note_text_sighting(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function private._profile_bio_sighting()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.bio is not distinct from old.bio then return null; end if;
  begin
    perform private.note_text_sighting(new.id, 'bio', null, new.bio);
  exception when others then
    insert into private.text_signal_failures (step, sqlstate) values ('bio', sqlstate);
  end;
  return null;
end;
$function$;
revoke all on function private._profile_bio_sighting() from public, anon, authenticated;
drop trigger if exists zz_profile_bio_sighting on public.profiles;
create trigger zz_profile_bio_sighting after insert or update of bio on public.profiles
  for each row execute function private._profile_bio_sighting();

create or replace function private._gathering_description_sighting()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- only what others can read: a public gathering that is not held for review (20270373's moderation_state)
  if new.visibility is distinct from 'everyone' or new.moderation_state is distinct from 'visible' then return null; end if;
  if tg_op = 'UPDATE' and new.description is not distinct from old.description
     and old.visibility is not distinct from 'everyone' and old.moderation_state is not distinct from 'visible' then return null; end if;
  begin
    perform private.note_text_sighting(new.host_id, 'gathering_description', new.id, new.description);
  exception when others then
    insert into private.text_signal_failures (step, sqlstate) values ('gathering', sqlstate);
  end;
  return null;
end;
$function$;
revoke all on function private._gathering_description_sighting() from public, anon, authenticated;
drop trigger if exists zz_gathering_description_sighting on public.gatherings;
create trigger zz_gathering_description_sighting after insert or update of description, visibility, moderation_state on public.gatherings
  for each row execute function private._gathering_description_sighting();

-- 7. Activation backfill (run by the activation migration, never by this one) + retention --------------------------------
-- Current bios, and public gatherings created in the last 30 days.
create or replace function private.backfill_shared_text_sightings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  if not private.shared_text_active() then return 0; end if;
  for r in select id, bio from profiles where nullif(btrim(bio), '') is not null loop
    perform private.note_text_sighting(r.id, 'bio', null, r.bio);
    n := n + 1;
  end loop;
  for r in select id, host_id, description from gatherings
            where visibility = 'everyone' and moderation_state = 'visible' and created_at > now() - interval '30 days' and nullif(btrim(description), '') is not null loop
    perform private.note_text_sighting(r.host_id, 'gathering_description', r.id, r.description);
    n := n + 1;
  end loop;
  return n;
end;
$function$;
revoke all on function private.backfill_shared_text_sightings() from public, anon, authenticated;

create or replace function private.purge_text_sightings()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a integer;
begin
  delete from private.text_sightings where last_seen <= now() - interval '30 days';
  get diagnostics a = row_count;
  delete from private.text_signal_failures where at <= now() - interval '90 days';
  return jsonb_build_object('sightings', a);
end;
$function$;
revoke all on function private.purge_text_sightings() from public, anon, authenticated;

select cron.schedule('purge-text-sightings', '58 4 * * *', 'select private.purge_text_sightings();');
