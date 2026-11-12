-- The same website in public gatherings posted by several accounts, for admin review (owner, 2026-11-12, idea 35 follow-up).
-- Staged after 20270412; deploy only with its own approval. Needs 20270378 (review-case pattern), 20270396 (the ONE link
-- detector, private.ugc_links) and 20270406 (the latest case-signal list).
--
-- The gap: 20 accounts post public gatherings with DIFFERENT wording that all send people to one website. 20270378 matches
-- whole long texts only (different wording = no match); 20270396 refuses a link only when Google Web Risk already lists it
-- and stores nothing about links. A destination not yet listed, shared across accounts, went unnoticed.
--
-- DETECTS NOTHING until it is switched on: private.account_signal_settings.shared_link_min_accounts starts null, and while it
-- is null nothing is stored or compared. The ONE way on = scripts/trust-safety/detector-switch.js on --detector=link (owner
-- approval per run; refuses until the Privacy Policy carries the approved disclosure, marker detector-disclosure:shared-link).
-- The owner's numbers (2026-11-12): 5 distinct accounts within a rolling 30 days, a proposed starting point, not calibrated.
--
-- What it reads: ONLY the title and description of a PUBLIC gathering (visibility 'everyone') that is not held for review
-- (moderation_state 'visible'), i.e. text everyone can already read. Never messages, chats, profiles, friendships, private,
-- friends-only, community or invite-only gatherings. One host's several or recurring gatherings are ONE account.
--
-- Destination (private.shared_link_destination), from each link 20270396's detector finds (it already undoes hxxp, [.],
-- " dot ", full-width dots and invisible characters, and lower-cases):
--   * the host only: scheme, user:password@, port, path, query and fragment dropped; %XX in the host decoded; trailing dots
--     dropped; punycode labels (xn--...) decoded, so a look-alike written either way is one destination; IPv4 in decimal,
--     hex or zero-padded form = one dotted address;
--   * an ordinary site = its registrable domain ("promo.evil.com" = "evil.com"; "shop.evil.co.uk" = "evil.co.uk"), so a new
--     subdomain per account doesn't split the count;
--   * private.shared_link_platforms (server-only, editable without a migration):
--       ignore      = never recorded (shared platforms where one site hosts everyone's events: YouTube, Eventbrite, Meetup,
--                     maps, ticketing, reservations, payments, Nearby's own website);
--       per_site    = each subdomain is a different person's site ("alice.github.io" <> "bob.github.io");
--       per_path    = the account / group / invite in the path is the destination ("t.me/group-a" <> "t.me/group-b"); a bare
--                     platform address or a path that names nothing specific is not recorded;
--   * a link written without "http(s)://" or "www." counts only with a known ending (so "Port St.Lucie" isn't a website).
-- Short links and link-in-bio pages can't be posted at all (20270396 refuses a link it can't check without visiting it).
--
-- Stored: a keyed one-way hash of the destination (HMAC-SHA256 under its own server-only secret, private.link_signal_secret,
-- prefix 'link-destination:v1:'), per account and public gathering, with first and last time seen. NEVER the URL, host, path
-- or text. Kept 30 days after the account last posted it (purged daily); deleting the account deletes its rows; a known
-- legitimate destination can be listed server-side (private.exclude_shared_link(link)), which also drops what was recorded.
-- A CASE (signal 'shared_link', reason 'many_accounts', the 20270357 queue) opens only when one destination was posted by at
-- least shared_link_min_accounts distinct accounts within 30 days (>= 3 enforced). One cluster = one case (as 20270378): a
-- qualifying destination joins an existing shared-link case when at least half of its accounts are already members. A
-- closed case stays closed: a new account is "new evidence since closed" (20270369); only an admin reopens.
-- Case evidence = counts (accounts, destinations) + up to 20 public gathering ids; never a link, host or key: the admin
-- reads the link in those public gatherings.
-- NOTHING here bans, suspends, hides, restricts, limits, ranks, scores or tells anyone. Every step runs in its own exception
-- block: a failure never blocks saving a gathering (recorded in 20270378's private.text_signal_failures, step only).
-- Concurrency: one evaluation per key (advisory lock) and one cluster decision at a time; a unique index backs it up.
-- The secret lives in the database: whoever can read the private schema can test a host they already know against it
-- (same accepted limit + pre-deploy secret review as 20270374 / 20270376 / 20270378).

-- 1. Settings (off) ------------------------------------------------------------------------------------------------------
alter table private.account_signal_settings
  add column if not exists shared_link_min_accounts integer
    check (shared_link_min_accounts is null or shared_link_min_accounts >= 3);

create or replace function private.shared_link_active()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select shared_link_min_accounts is not null from private.account_signal_settings where id), false);
$function$;
revoke all on function private.shared_link_active() from public, anon, authenticated;

-- 2. Secret + platforms ---------------------------------------------------------------------------------------------------
create table if not exists private.link_signal_secret (
  id boolean primary key default true check (id),
  secret bytea not null check (length(secret) = 32),
  created_at timestamptz not null default now()
);
revoke all on private.link_signal_secret from public, anon, authenticated;
insert into private.link_signal_secret (secret) values (extensions.gen_random_bytes(32)) on conflict (id) do nothing;

create table if not exists private.shared_link_platforms (
  host text primary key check (host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  kind text not null check (kind in ('ignore', 'per_site', 'per_path')),
  note text
);
revoke all on private.shared_link_platforms from public, anon, authenticated;

insert into private.shared_link_platforms (host, kind, note) values
  -- shared event / media / map / ticketing / booking / payment platforms: everyone's events live on one site
  ('youtube.com', 'ignore', 'video'), ('youtu.be', 'ignore', 'video'), ('vimeo.com', 'ignore', 'video'),
  ('eventbrite.com', 'ignore', 'events'), ('eventbrite.co.uk', 'ignore', 'events'), ('eventbrite.ca', 'ignore', 'events'),
  ('eventbrite.com.au', 'ignore', 'events'), ('meetup.com', 'ignore', 'events'), ('partiful.com', 'ignore', 'events'),
  ('lu.ma', 'ignore', 'events'), ('luma.com', 'ignore', 'events'), ('allevents.in', 'ignore', 'events'),
  ('dice.fm', 'ignore', 'tickets'), ('ticketmaster.com', 'ignore', 'tickets'), ('livenation.com', 'ignore', 'tickets'),
  ('axs.com', 'ignore', 'tickets'), ('seatgeek.com', 'ignore', 'tickets'), ('stubhub.com', 'ignore', 'tickets'),
  ('universe.com', 'ignore', 'tickets'), ('opentable.com', 'ignore', 'reservations'), ('resy.com', 'ignore', 'reservations'),
  ('exploretock.com', 'ignore', 'reservations'), ('sevenrooms.com', 'ignore', 'reservations'),
  ('yelp.com', 'ignore', 'listings'), ('tripadvisor.com', 'ignore', 'listings'), ('google.com', 'ignore', 'maps, forms'),
  ('goo.gl', 'ignore', 'maps links'), ('g.page', 'ignore', 'maps'), ('apple.com', 'ignore', 'maps'),
  ('zoom.us', 'ignore', 'calls'), ('spotify.com', 'ignore', 'music'), ('wikipedia.org', 'ignore', 'reference'),
  ('reddit.com', 'ignore', 'forum'), ('nextdoor.com', 'ignore', 'neighbourhood'), ('gofundme.com', 'ignore', 'fundraising'),
  ('allenklein94.github.io', 'ignore', 'Nearby''s own website'),
  -- one subdomain = one person's own site
  ('github.io', 'per_site', null), ('gitlab.io', 'per_site', null), ('netlify.app', 'per_site', null),
  ('vercel.app', 'per_site', null), ('pages.dev', 'per_site', null), ('workers.dev', 'per_site', null),
  ('web.app', 'per_site', null), ('firebaseapp.com', 'per_site', null), ('herokuapp.com', 'per_site', null),
  ('onrender.com', 'per_site', null), ('fly.dev', 'per_site', null), ('azurewebsites.net', 'per_site', null),
  ('blogspot.com', 'per_site', null), ('wordpress.com', 'per_site', null), ('wixsite.com', 'per_site', null),
  ('weebly.com', 'per_site', null), ('squarespace.com', 'per_site', null), ('square.site', 'per_site', null),
  ('carrd.co', 'per_site', null), ('godaddysites.com', 'per_site', null), ('webflow.io', 'per_site', null),
  ('framer.website', 'per_site', null), ('notion.site', 'per_site', null), ('substack.com', 'per_site', null),
  ('tumblr.com', 'per_site', null), ('myshopify.com', 'per_site', null), ('mystrikingly.com', 'per_site', null),
  ('jimdosite.com', 'per_site', null), ('glitch.me', 'per_site', null),
  -- social / messaging / payment: the account, group or invite in the path is the destination
  ('t.me', 'per_path', null), ('telegram.me', 'per_path', null), ('wa.me', 'per_path', null),
  ('chat.whatsapp.com', 'per_path', null), ('discord.gg', 'per_path', null), ('discord.com', 'per_path', null),
  ('instagram.com', 'per_path', null), ('tiktok.com', 'per_path', null), ('x.com', 'per_path', null),
  ('twitter.com', 'per_path', null), ('facebook.com', 'per_path', null), ('fb.com', 'per_path', null),
  ('threads.net', 'per_path', null), ('linkedin.com', 'per_path', null), ('paypal.me', 'per_path', null),
  ('venmo.com', 'per_path', null), ('cash.app', 'per_path', null), ('patreon.com', 'per_path', null)
on conflict (host) do nothing;

-- 3. Destination ----------------------------------------------------------------------------------------------------------
-- RFC 3492 decoding of one punycode label (without "xn--"); null when it isn't valid punycode.
create or replace function private.punycode_decode(p text)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_out integer[] := '{}';
  v_len integer := length(coalesce(p, ''));
  v_b integer;
  v_pos integer;
  v_n bigint := 128;
  v_i bigint := 0;
  v_bias bigint := 72;
  v_oldi bigint;
  v_w bigint;
  v_k bigint;
  v_t bigint;
  v_digit integer;
  v_c text;
  v_delta bigint;
  v_cnt integer;
  v_adapt bigint;
begin
  if v_len = 0 or v_len > 63 then return null; end if;
  v_b := length(p) - position('-' in reverse(p)) + 1;   -- position of the last '-', or len+1 when none
  if position('-' in p) = 0 then v_b := 0; end if;
  if v_b > 0 then
    for j in 1 .. v_b - 1 loop
      if ascii(substr(p, j, 1)) >= 128 then return null; end if;
      v_out := v_out || ascii(substr(p, j, 1));
    end loop;
    v_pos := v_b + 1;
  else
    v_pos := 1;
  end if;
  while v_pos <= v_len loop
    v_oldi := v_i; v_w := 1; v_k := 36;
    loop
      if v_pos > v_len then return null; end if;
      v_c := substr(p, v_pos, 1); v_pos := v_pos + 1;
      if v_c between 'a' and 'z' then v_digit := ascii(v_c) - 97;
      elsif v_c between '0' and '9' then v_digit := ascii(v_c) - 22;
      else return null; end if;
      v_i := v_i + v_digit * v_w;
      if v_i > 2147483647 then return null; end if;
      v_t := case when v_k <= v_bias then 1 when v_k >= v_bias + 26 then 26 else v_k - v_bias end;
      exit when v_digit < v_t;
      v_w := v_w * (36 - v_t);
      v_k := v_k + 36;
    end loop;
    v_cnt := coalesce(array_length(v_out, 1), 0) + 1;
    -- adapt(delta, numpoints, firsttime)
    v_delta := case when v_oldi = 0 then (v_i - v_oldi) / 700 else (v_i - v_oldi) / 2 end;
    v_delta := v_delta + v_delta / v_cnt;
    v_adapt := 0;
    while v_delta > 455 loop v_delta := v_delta / 35; v_adapt := v_adapt + 36; end loop;
    v_bias := v_adapt + (36 * v_delta) / (v_delta + 38);
    v_n := v_n + v_i / v_cnt;
    v_i := v_i % v_cnt;
    if v_n > 1114111 or v_n between 55296 and 57343 then return null; end if;
    v_out := v_out[1:v_i::integer] || v_n::integer || v_out[(v_i + 1)::integer:];
    v_i := v_i + 1;
  end loop;
  return (select string_agg(chr(c), '' order by o) from unnest(v_out) with ordinality u(c, o));
end;
$function$;
revoke all on function private.punycode_decode(text) from public, anon, authenticated;

-- One link (as private.ugc_links returns it) -> the destination text that is hashed, or null when it isn't one.
create or replace function private.shared_link_destination(p_link text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  s text := lower(normalize(btrim(coalesce(p_link, '')), NFKC));
  v_explicit boolean;
  v_host text;
  v_rest text;
  v_hex text;
  v_labels text[];
  v_n integer;
  v_parts text[];
  v_num numeric;
  v_kind text;
  v_suffix text;
  v_at integer;
  v_segs text[];
  v_seg text;
  v_generic constant text[] := array['groups', 'group', 'events', 'event', 'pages', 'page', 'invite', 'p', 'reel', 'reels',
    'channel', 'channels', 'c', 'u', 'user', 'joinchat', 'share', 's', 'g', 'v', 'watch', 'story', 'stories', 'r', 'e', 'pg', 'people', 'in', 'company'];
  v_endings constant text[] := array['com', 'net', 'org', 'info', 'biz', 'io', 'co', 'app', 'dev', 'site', 'online', 'store',
    'shop', 'link', 'xyz', 'top', 'club', 'live', 'vip', 'me', 'tv', 'gg', 'ly', 'fm', 'ai', 'us', 'events', 'party', 'fun',
    'social', 'tickets', 'today', 'world', 'life', 'space', 'website', 'page', 'pro', 'one', 'win', 'bet', 'cash',
    'money', 'loan', 'click', 'lol', 'icu', 'buzz', 'cam', 'rest', 'bar', 'cafe', 'beer', 'wine', 'pizza', 'music', 'band',
    'art', 'gallery', 'studio', 'news', 'blog', 'chat', 'dating', 'date', 'love', 'sex', 'xxx', 'porn', 'casino', 'game',
    'games', 'tech', 'cloud', 'host', 'network', 'email', 'mobi', 'name', 'asia', 'tk', 'ml', 'ga', 'cf', 'gq'];
  v_sld constant text[] := array['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'ltd', 'plc', 'me', 'gob',
    'nic', 'mil', 'info', 'biz', 'nom', 'sch', 'gen', 'web', 'firm'];
begin
  if s = '' then return null; end if;
  v_explicit := s ~ '^https?://' or s ~ '^www\.';
  s := regexp_replace(s, '^[a-z][a-z0-9+.-]*://', '');
  s := regexp_replace(s, '^/+', '');
  v_host := substring(s from '^[^/?#\\]*');
  v_rest := substr(s, length(v_host) + 1);
  v_at := length(v_host) - position('@' in reverse(v_host)) + 1;
  if position('@' in v_host) > 0 then v_host := substr(v_host, v_at + 1); end if;          -- user:password@ dropped
  v_host := regexp_replace(v_host, ':[0-9]*$', '');                                          -- port dropped
  -- %XX in the host (ASCII bytes only)
  loop
    v_hex := substring(v_host from '%([0-7][0-9a-f])');
    exit when v_hex is null;
    v_host := replace(v_host, '%' || v_hex, chr(('x' || lpad(v_hex, 8, '0'))::bit(32)::int));
  end loop;
  v_host := lower(normalize(v_host, NFKC));
  v_host := translate(v_host, '。｡︒', '...');
  v_host := btrim(regexp_replace(v_host, '\.{2,}', '.', 'g'), '.');
  if v_host = '' or v_host ~ '[[:space:]/?#@:%\\]' then return null; end if;

  -- IPv4: dotted (zero-padded), one decimal number or one hex number
  if v_host ~ '^[0-9]+$' or v_host ~ '^0x[0-9a-f]{1,8}$' then
    v_num := case when v_host like '0x%' then ('x' || lpad(substr(v_host, 3), 8, '0'))::bit(32)::bigint
                  else case when length(v_host) <= 10 then v_host::numeric else null end end;
    if v_num is null or v_num > 4294967295 or v_num < 16777216 then return null; end if;
    return 'ip:' || (trunc(v_num / 16777216))::int || '.' || (trunc(v_num / 65536)::bigint % 256) || '.'
           || (trunc(v_num / 256)::bigint % 256) || '.' || (v_num::bigint % 256);
  end if;
  if v_host ~ '^[0-9]+(\.[0-9]+){3}$' then
    v_parts := string_to_array(v_host, '.');
    if exists (select 1 from unnest(v_parts) x where length(x) > 3 or x::int > 255) then return null; end if;
    return 'ip:' || (select string_agg(x::int::text, '.' order by o) from unnest(v_parts) with ordinality u(x, o));
  end if;

  -- punycode labels decoded, so "xn--80ak6aa92e.com" and its look-alike letters are one destination
  v_labels := string_to_array(v_host, '.');
  v_labels := array(select case when l like 'xn--%' then coalesce(lower(normalize(private.punycode_decode(substr(l, 5)), NFKC)), l) else l end
                      from unnest(v_labels) with ordinality u(l, o) order by o);
  v_n := cardinality(v_labels);
  if v_n < 2 or exists (select 1 from unnest(v_labels) l where l = '') then return null; end if;
  if not v_explicit and not (v_labels[v_n] = any(v_endings) or length(v_labels[v_n]) = 2) then return null; end if;

  -- the longest listed platform suffix wins
  for j in 1 .. v_n - 1 loop
    v_suffix := array_to_string(v_labels[j:v_n], '.');
    select kind into v_kind from private.shared_link_platforms where host = v_suffix;
    if v_kind is not null then
      if v_kind = 'ignore' then return null; end if;
      if v_kind = 'per_site' then
        return case when j = 1 then v_suffix else v_labels[j - 1] || '.' || v_suffix end;
      end if;
      -- per_path: the account / group / invite named in the path
      v_segs := array_remove(string_to_array(split_part(split_part(v_rest, '#', 1), '?', 1), '/'), '');
      v_seg := ltrim(coalesce(v_segs[1], ''), '@');
      if v_seg = '' or v_seg ~ '\.' then return null; end if;
      if v_seg = any(v_generic) then
        if coalesce(v_segs[2], '') = '' then return null; end if;
        v_seg := v_seg || '/' || ltrim(v_segs[2], '@');
      end if;
      return v_suffix || '/' || v_seg;
    end if;
  end loop;

  -- an ordinary site: its registrable domain
  if v_n >= 3 and length(v_labels[v_n]) = 2 and v_labels[v_n - 1] = any(v_sld) then
    return array_to_string(v_labels[v_n - 2:v_n], '.');
  end if;
  return array_to_string(v_labels[v_n - 1:v_n], '.');
end;
$function$;
revoke all on function private.shared_link_destination(text) from public, anon, authenticated;

create or replace function private._shared_link_hmac(p_destination text)
returns bytea
language sql
stable
security definer
set search_path to ''
as $function$
  select case when p_destination is null then null
              else extensions.hmac(convert_to('link-destination:v1:' || p_destination, 'UTF8'), t.secret, 'sha256') end
    from private.link_signal_secret t;
$function$;
revoke all on function private._shared_link_hmac(text) from public, anon, authenticated;

-- 4. Tables ----------------------------------------------------------------------------------------------------------------
create table if not exists private.link_sightings (
  link_key bytea not null check (length(link_key) = 32),
  user_id uuid not null references auth.users(id) on delete cascade,
  gathering_id uuid not null,           -- the public gathering it was posted on (no FK: a deleted gathering keeps nothing else)
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (link_key, user_id, gathering_id)
);
create index if not exists link_sightings_user_idx on private.link_sightings (user_id);
create index if not exists link_sightings_last_seen_idx on private.link_sightings (last_seen);

create table if not exists private.shared_link_excluded_keys (
  link_key bytea primary key check (length(link_key) = 32),
  added_at timestamptz not null default now()
);

create table if not exists private.account_review_case_link_keys (
  case_id uuid not null references private.account_review_cases(id) on delete cascade,
  link_key bytea not null check (length(link_key) = 32),
  primary key (case_id, link_key)
);
create unique index if not exists account_review_case_link_keys_one_case on private.account_review_case_link_keys (link_key);

revoke all on private.link_sightings, private.shared_link_excluded_keys, private.account_review_case_link_keys
  from public, anon, authenticated;

-- null = not a destination, an ignored platform, an excluded destination, or the detector is off
create or replace function private.shared_link_key(p_link text)
returns bytea
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_key bytea;
begin
  if not private.shared_link_active() then return null; end if;
  v_key := private._shared_link_hmac(private.shared_link_destination(p_link));
  if v_key is null or exists (select 1 from private.shared_link_excluded_keys e where e.link_key = v_key) then return null; end if;
  return v_key;
end;
$function$;
revoke all on function private.shared_link_key(text) from public, anon, authenticated;

-- server-only: a known legitimate destination is never recorded again (and what was recorded for it is dropped)
create or replace function private.exclude_shared_link(p_link text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key bytea := private._shared_link_hmac(private.shared_link_destination(p_link));
begin
  if v_key is null then return false; end if;
  insert into private.shared_link_excluded_keys (link_key) values (v_key) on conflict do nothing;
  delete from private.link_sightings where link_key = v_key;
  return true;
end;
$function$;
revoke all on function private.exclude_shared_link(text) from public, anon, authenticated;

-- 5. Case kind -------------------------------------------------------------------------------------------------------------
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'prior_unresolved',
                    'account_recovery', 'shared_device', 'shared_text', 'shared_link'));
-- (reason 'many_accounts' exists; the subject check is unchanged: a shared-link case has neither sha256 nor subject_user,
-- its accounts are its members, like shared-device and shared-text cases.)

-- 6. Evaluation ------------------------------------------------------------------------------------------------------------
create or replace function private.evaluate_shared_link(p_key bytea)
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
  if s.shared_link_min_accounts is null or p_key is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('link_case:' || encode(p_key, 'hex')));

  select coalesce(array_agg(u order by f), '{}') into v_users from (
    select l.user_id u, min(l.first_seen) f
      from private.link_sightings l
     where l.link_key = p_key and l.last_seen > now() - interval '30 days'
       and exists (select 1 from auth.users a where a.id = l.user_id)
     group by l.user_id) x;

  select c.id, c.status into v_case, v_status
    from private.account_review_case_link_keys ck join private.account_review_cases c on c.id = ck.case_id
   where ck.link_key = p_key
   for update of c;

  if v_case is null then
    if cardinality(v_users) < s.shared_link_min_accounts then return; end if;
    perform pg_advisory_xact_lock(hashtext('link_case_cluster'));
    select m.case_id into v_case
      from private.account_review_case_members m
      join private.account_review_cases c on c.id = m.case_id and c.signal = 'shared_link'
     where m.user_id = any(v_users)
     group by m.case_id
    having count(*) * 2 >= cardinality(v_users)
     order by count(*) desc, m.case_id
     limit 1;
    if v_case is null then
      insert into private.account_review_cases (signal, reason, evidence) values ('shared_link', 'many_accounts', '{}'::jsonb)
        returning id into v_case;
    end if;
    insert into private.account_review_case_link_keys (case_id, link_key) values (v_case, p_key);
    select status into v_status from private.account_review_cases where id = v_case for update;
  end if;

  -- on a closed case only a NEW account inserts a row (= new evidence, 20270369's trigger); the case stays closed
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;

  if v_status = 'open' then
    select jsonb_build_object(
             'accounts', (select count(*) from private.account_review_case_members m where m.case_id = v_case),
             'window_days', 30,
             'links', (select count(*) from private.account_review_case_link_keys ck where ck.case_id = v_case),
             'gathering_ids', coalesce((select jsonb_agg(g order by g) from (
                  select distinct l.gathering_id g from private.link_sightings l
                    join private.account_review_case_link_keys ck on ck.link_key = l.link_key and ck.case_id = v_case
                   where l.last_seen > now() - interval '30 days'
                   order by l.gathering_id limit 20) y), '[]'::jsonb))
      into v_evidence;
    update private.account_review_cases set evidence = v_evidence, updated_at = now() where id = v_case;
  end if;
end;
$function$;
revoke all on function private.evaluate_shared_link(bytea) from public, anon, authenticated;

-- 7. Recording -------------------------------------------------------------------------------------------------------------
create or replace function private.note_link_sightings(p_user uuid, p_gathering uuid, p_title text, p_description text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key bytea;
begin
  if p_user is null or p_gathering is null or not private.shared_link_active() then return; end if;
  for v_key in
    select distinct k from (
      select private.shared_link_key(l) k
        from unnest(private.ugc_links(p_title) || private.ugc_links(p_description)) l) x
     where k is not null
     limit 10
  loop
    insert into private.link_sightings (link_key, user_id, gathering_id) values (v_key, p_user, p_gathering)
    on conflict (link_key, user_id, gathering_id) do update set last_seen = now();
    perform private.evaluate_shared_link(v_key);
  end loop;
end;
$function$;
revoke all on function private.note_link_sightings(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function private._gathering_link_sighting()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- only what others can read: a public gathering that is not held for review (20270373's moderation_state)
  if new.visibility is distinct from 'everyone' or new.moderation_state is distinct from 'visible' then return null; end if;
  if tg_op = 'UPDATE' and new.title is not distinct from old.title and new.description is not distinct from old.description
     and old.visibility is not distinct from 'everyone' and old.moderation_state is not distinct from 'visible' then return null; end if;
  begin
    perform private.note_link_sightings(new.host_id, new.id, new.title, new.description);
  exception when others then
    insert into private.text_signal_failures (step, sqlstate) values ('gathering_link', sqlstate);
  end;
  return null;
end;
$function$;
revoke all on function private._gathering_link_sighting() from public, anon, authenticated;
drop trigger if exists zz_gathering_link_sighting on public.gatherings;
create trigger zz_gathering_link_sighting after insert or update of title, description, visibility, moderation_state on public.gatherings
  for each row execute function private._gathering_link_sighting();

-- 8. Activation backfill (run by detector-switch.js on, never by this migration) + retention --------------------------------
create or replace function private.backfill_link_sightings()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  if not private.shared_link_active() then return 0; end if;
  for r in select id, host_id, title, description from gatherings
            where visibility = 'everyone' and moderation_state = 'visible' and created_at > now() - interval '30 days' loop
    perform private.note_link_sightings(r.host_id, r.id, r.title, r.description);
    n := n + 1;
  end loop;
  return n;
end;
$function$;
revoke all on function private.backfill_link_sightings() from public, anon, authenticated;

create or replace function private.purge_link_sightings()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a integer;
begin
  delete from private.link_sightings where last_seen <= now() - interval '30 days';
  get diagnostics a = row_count;
  return jsonb_build_object('sightings', a);
end;
$function$;
revoke all on function private.purge_link_sightings() from public, anon, authenticated;

select cron.schedule('purge-link-sightings', '41 4 * * *', 'select private.purge_link_sightings();');
