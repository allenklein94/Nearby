-- Link destination safety for public text (owner approved 2026-11-07). Staged after 20270395; own deploy approval, together
-- with the `screen-user-content` redeploy that carries the link check, the GOOGLE_WEB_RISK_API_KEY secret, and a Privacy
-- Policy sentence (links in public text are sent to Google Web Risk). Needs 20270373.
--
-- Before: 20270373 binds every public text (profile text, gathering title/description, community name/description, Q&A,
-- photo comments) to a classifier result for that exact text. A link in it is judged only by what its WORDS look like; a
-- harmless-looking address can point (directly or through a shortener / redirect) to a known phishing or malware site.
--
-- After, for any such text that contains a link (ONE detector, private.ugc_links, below; the edge function asks the same
-- function which links to check, so the two can never disagree):
--   - the write needs a screening row recorded through record_ugc_link_screening, i.e. by a screen-user-content version that
--     checked every link's destination with Google Web Risk (each hop of its redirect chain); a row from the 0373 path
--     (link_check null) no longer counts for linked text: refused, hint 'link_check_required', nothing written;
--   - a confirmed malicious destination = a 'refuse' row (link_check 'malicious', threat types only): refused, hint
--     'link_not_allowed', whatever the language calibration says (a known-bad address is not a language judgement);
--   - the edge function records NOTHING when Web Risk can't answer, a redirect chain can't be followed to its end (a shortener
--     that won't resolve, too many hops, a private or non-web address), a text has more than 5 links, or the daily lookup
--     budget is used up: the write is refused (fail closed for linked text only);
--   - text with no link is unchanged (0373's path, no Web Risk call).
-- A person's approval of held text (source 'review', 0373) still counts: it can only exist for text that first passed.
-- Budget: private.link_check_usage, per account 200 lookups a day, everyone 3000 a day (about 90,000 a month, inside Web
-- Risk's 100,000 free monthly lookups), claimed before each lookup (claim_link_checks).
-- Nothing stores a URL: a screening row keeps how many links, the verdict and the threat types only; logs keep counts.
-- Not changed: private 1:1 messages, group-plan and group chat (reports-based, owner decision), business content (0372
-- refuses links in offers outright), the review flow, the language rule.

alter table private.ugc_screenings
  add column link_check text check (link_check in ('clean', 'malicious')),
  add column link_count integer check (link_count between 0 and 5),
  add column link_threats text[] not null default '{}'
    check (link_threats <@ array['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']);

-- ---------------------------------------------------------------------------------------------------------------------
-- ONE link detector
-- ---------------------------------------------------------------------------------------------------------------------
-- Undoes the usual disguises first: Unicode compatibility forms (full-width letters and dots), invisible characters,
-- "hxxp", "[.]" / "(dot)" / "{.}", " dot " before a common ending, ideographic full stops, backslashes after a scheme.
-- Then: every scheme address (http/https, also "http:\\" and "http:/"), taken BEFORE email addresses are set aside so
-- "http://good.example@bad.example" stays a link; then "www." and bare domains (any letters, so look-alike Cyrillic or
-- accented names count; the ending must be 2-24 letters or punycode), and IPv4 addresses. Email addresses alone are not
-- links. Over-detection only costs a lookup (an unknown name checks clean); under-detection would skip the check.
create function private.ugc_links(p_text text)
returns text[]
language plpgsql
immutable
set search_path to 'private', 'public'
as $function$
declare
  s text;
  v_links text[] := '{}';
  m text[];
  c text;
  v_sep constant text := '[:space:]<>"''`(){}\[\],;!|^*';  -- not '?': a query string belongs to its link
begin
  if p_text is null or btrim(p_text) = '' then return '{}'; end if;
  s := lower(normalize(p_text, NFKC));
  s := regexp_replace(s, '[​-‏⁠-⁤﻿­͏᠎]', '', 'g');
  s := translate(s, '。｡︒', '...');
  s := regexp_replace(s, '\mhxxp(s?)', 'http\1', 'g');
  s := regexp_replace(s, '[[:space:]]*[\[\(\{][[:space:]]*(\.|dot)[[:space:]]*[\]\)\}][[:space:]]*', '.', 'g');
  s := regexp_replace(s, '[[:space:]]+dot[[:space:]]+(?=(com|net|org|io|co|biz|info|app|site|online|store|shop|link|ly|me|us|uk|ca|xyz|top|club|live|vip|cc|tk|ru|cn|de|fr|es|br|in)\M)', '.', 'g');
  s := regexp_replace(s, '\m(https?):[\\/]+', '\1://', 'g');

  -- scheme addresses (everything up to a separator), then removed so nothing below reads them twice
  for m in select regexp_matches(s, '\mhttps?://[^' || v_sep || ']+', 'g') loop
    v_links := v_links || regexp_replace(m[1], '[.:/?]+$', '');
  end loop;
  s := regexp_replace(s, '\mhttps?://[^' || v_sep || ']+', ' ', 'g');
  -- email addresses are not links
  s := regexp_replace(s, '[^' || v_sep || '@]+@[^' || v_sep || '@]+', ' ', 'g');
  -- www., bare domains (letters of any script; ending = 2-24 letters or punycode), optional port and path
  for m in select regexp_matches(s,
      '(?:^|[' || v_sep || '/@:.])((?:[^' || v_sep || './@:_]+\.)+(?:xn--[a-z0-9-]+|[^' || v_sep || './@:_0-9-]{2,24})(?::[0-9]{1,5})?(?:/[^' || v_sep || ']*)?)',
      'g') loop
    c := regexp_replace(m[1], '[.:/?]+$', '');
    -- a word.word that is really a decimal or a time ("3.5km", "7.30pm") never reaches here: the ending has no digits
    v_links := v_links || c;
  end loop;
  -- the same in plain letters, wherever it starts: "visit访问evil.com" also yields "evil.com" (the pass above reads the
  -- whole run of letters as one name)
  for m in select regexp_matches(s,
      '(?:^|[^a-z0-9-])((?:[a-z0-9-]+\.)+(?:xn--[a-z0-9-]+|[a-z]{2,24})(?::[0-9]{1,5})?(?:/[^' || v_sep || ']*)?)', 'g') loop
    v_links := v_links || regexp_replace(m[1], '[.:/?]+$', '');
  end loop;
  -- IPv4 addresses (with an optional port and path)
  for m in select regexp_matches(s, '(?:^|[^0-9])((?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]{1,5})?(?:/[^' || v_sep || ']*)?)', 'g') loop
    v_links := v_links || m[1];
  end loop;
  return coalesce((select array_agg(distinct x order by x) from unnest(v_links) x where x <> ''), '{}');
end;
$function$;
revoke all on function private.ugc_links(text) from public, anon, authenticated;

-- The edge function asks which links to check (the same detector the database enforces with).
create function public.ugc_links_for_check(p_text text)
returns text[]
language sql
immutable
security definer
set search_path to 'private', 'public'
as $function$
  select private.ugc_links(p_text);
$function$;
revoke all on function public.ugc_links_for_check(text) from public, anon, authenticated;
grant execute on function public.ugc_links_for_check(text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Lookup budget
-- ---------------------------------------------------------------------------------------------------------------------
create table private.link_check_usage (
  day date not null,
  user_id uuid not null,   -- the nil uuid row = everyone
  lookups integer not null default 0 check (lookups >= 0),
  primary key (day, user_id)
);
revoke all on table private.link_check_usage from public, anon, authenticated;

create function public.claim_link_checks(p_user uuid, p_lookups integer)
returns boolean
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_mine integer;
  v_all integer;
begin
  if p_user is null or coalesce(p_lookups, 0) < 1 or p_lookups > 50 then return false; end if;
  insert into private.link_check_usage (day, user_id) values (v_day, p_user), (v_day, '00000000-0000-0000-0000-000000000000')
  on conflict do nothing;
  -- everyone's row first, then the person's: one lock order, so two claims never deadlock
  select lookups into v_all from private.link_check_usage
   where day = v_day and user_id = '00000000-0000-0000-0000-000000000000' for update;
  select lookups into v_mine from private.link_check_usage where day = v_day and user_id = p_user for update;
  if v_all + p_lookups > 3000 or v_mine + p_lookups > 200 then return false; end if;
  update private.link_check_usage set lookups = lookups + p_lookups
   where day = v_day and user_id in (p_user, '00000000-0000-0000-0000-000000000000');
  return true;
end;
$function$;
revoke all on function public.claim_link_checks(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_link_checks(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Recording and finding a link-checked result
-- ---------------------------------------------------------------------------------------------------------------------
create function public.record_ugc_link_screening(p_user uuid, p_text_sha256 text, p_kind text, p_is_name boolean,
  p_link_check text, p_link_count integer, p_link_threats text[], p_risk text default null, p_categories text[] default '{}',
  p_languages text[] default '{}', p_reasoning text default null, p_model text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_outcome text;
  v_id uuid;
begin
  if p_link_check is null or p_link_check not in ('clean', 'malicious') or coalesce(p_link_count, 0) < 1 then
    raise exception 'A link result needs its verdict and how many links were checked' using errcode = '22023';
  end if;
  if p_link_check = 'malicious' then
    v_outcome := 'refuse';
  else
    if p_risk is null then
      raise exception 'Clean links still need the text''s own screening' using errcode = '22023';
    end if;
    v_outcome := private.ugc_outcome_for(p_risk, p_languages, p_is_name);
  end if;
  insert into private.ugc_screenings (user_id, text_sha256, is_name, kind, source, risk_tier, categories, languages, outcome,
    model, reasoning, valid_until, link_check, link_count, link_threats)
  values (p_user, p_text_sha256, p_is_name, left(coalesce(p_kind, 'text'), 40), 'classifier', p_risk,
    case when p_link_check = 'malicious' then array['spam_scam'] else coalesce(p_categories, '{}') end,
    coalesce(p_languages, '{}'), v_outcome, left(p_model, 80), left(p_reasoning, 600), now() + interval '30 minutes',
    p_link_check, p_link_count, case when p_link_check = 'malicious' then coalesce(p_link_threats, '{}') else '{}' end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'outcome', v_outcome);
end;
$function$;
revoke all on function public.record_ugc_link_screening(uuid, text, text, boolean, text, integer, text[], text, text[], text[], text, text)
  from public, anon, authenticated;
grant execute on function public.record_ugc_link_screening(uuid, text, text, boolean, text, integer, text[], text, text[], text[], text, text)
  to service_role;

-- The best still-valid result that counts for LINKED text: link-checked rows and a person's approval.
-- (The journey harness replaces this lookup like 0373's; linkSafety opts out.)
create function private.ugc_link_screening_lookup(p_user uuid, p_sha text, p_is_name boolean)
returns text
language sql
stable
security definer
set search_path to 'private', 'public'
as $function$
  select s.outcome
    from private.ugc_screenings s
   where s.user_id = p_user and s.text_sha256 = p_sha and s.is_name = p_is_name and s.valid_until > now()
     and (s.link_check is not null or s.source = 'review')
   order by case s.outcome when 'publish' then 0 when 'hold' then 1 else 2 end, s.created_at desc
   limit 1;
$function$;
revoke all on function private.ugc_link_screening_lookup(uuid, text, boolean) from public, anon, authenticated;

create function public.find_ugc_link_screening(p_user uuid, p_text_sha256 text, p_is_name boolean)
returns text
language sql
stable
security definer
set search_path to 'private', 'public'
as $function$
  select private.ugc_link_screening_lookup(p_user, p_text_sha256, p_is_name);
$function$;
revoke all on function public.find_ugc_link_screening(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.find_ugc_link_screening(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 20270373's one requirement + the link rule (every screened public text goes through here)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.ugc_require(p_text text, p_is_name boolean)
returns text
language plpgsql
stable
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_outcome text;
  v_sha text;
begin
  if private.ugc_norm(p_text) = '' then return 'none'; end if;
  v_sha := private.ugc_text_sha(p_text);
  if cardinality(private.ugc_links(p_text)) > 0 then
    -- a known-bad destination wins over any other result for the same text
    if exists (select 1 from private.ugc_screenings s
                where s.user_id = auth.uid() and s.text_sha256 = v_sha and s.is_name = p_is_name and s.valid_until > now()
                  and s.link_check = 'malicious') then
      raise exception 'This link can''t be shared on Nearby. Please remove it and try again.'
        using errcode = '42501', hint = 'link_not_allowed';
    end if;
    v_outcome := private.ugc_link_screening_lookup(auth.uid(), v_sha, p_is_name);
    if v_outcome is null then
      raise exception 'Nearby needs to check where this link goes before it can be published.'
        using errcode = '42501', hint = 'link_check_required';
    end if;
  else
    v_outcome := private.ugc_screening_lookup(auth.uid(), v_sha, p_is_name);
  end if;
  if v_outcome is null then
    raise exception 'This needs to go through Nearby''s content check before it can be published.'
      using errcode = '42501', hint = 'screening_required';
  elsif v_outcome = 'refuse' then
    raise exception 'This can''t be published on Nearby. Please change it and try again.'
      using errcode = '42501', hint = 'content_not_allowed';
  end if;
  return v_outcome;
end;
$function$;
revoke all on function private.ugc_require(text, boolean) from public, anon, authenticated;

-- usage rows: 30 days
create function private.purge_link_check_usage()
returns void
language sql
security definer
set search_path to 'private', 'public'
as $function$
  delete from private.link_check_usage where day < (now() at time zone 'utc')::date - 30;
$function$;
revoke all on function private.purge_link_check_usage() from public, anon, authenticated;
select cron.schedule('purge-link-check-usage', '17 4 * * *', $$select private.purge_link_check_usage()$$);
