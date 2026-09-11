-- External UX critique item 17: real push notifications for "this matches
-- you" recommendations, with real user controls (on/off, frequency,
-- categories, distance, time preferences). Direct user request, scoped down
-- to 3 concrete architecture decisions via AskUserQuestion before building:
-- (1) reuse the existing presence pipeline's coarse location rather than add
-- any new location capability, (2) real-time pushes capped per day rather
-- than a daily digest, (3) a simple Anytime/Evenings & Weekends time control
-- rather than a custom quiet-hours picker.
--
-- notify_things_to_do / notify_nearby_opportunities (profiles, added
-- 20260913_v5_notification_taxonomy.sql) were already reserved for exactly
-- this -- that migration's own header comment calls them "honest
-- placeholders -- no consumer-facing push exists for either yet." This
-- migration is the real trigger for both, plus the frequency/categories/
-- distance/time-preference sub-controls per user's explicit ask.
--
-- Real finding that simplified this a lot: a "last known coarse location per
-- user" table already exists -- presence_reports (user_id pk, area, reported_at),
-- upserted by the report-presence Edge Function on every background presence
-- report (the same pipeline Crossed Paths already uses). It already satisfies
-- every guardrail the user asked for on this reuse: (1) same coarse rounded
-- lat/lng string, no new precision; (2) already timestamped (reported_at);
-- (3) freshness is enforced directly by this migration's own triggers
-- (reported_at > now() - interval '1 hour'), not borrowed from anywhere
-- else -- purge_expired_sightings() (baseline migration) does delete stale
-- presence_reports rows on the same 1-hour bound, but a prior session
-- confirmed live (`select * from cron.job`) that function is on no cron
-- schedule at all, so it never actually runs; this migration does not rely
-- on it and does not schedule it -- that's a real, pre-existing, unrelated
-- gap, left untouched here; (4) RLS enabled with zero policies -- confirmed
-- live via pg_policies -- so it was already unreadable by any client,
-- including the owning user's own. No new table, no Edge Function change,
-- no new permission prompt was needed for this piece at all.
--
-- A real, disclosed dependency this creates: a user only ever receives one
-- of these pushes if they have an unexpired presence_reports row, i.e. only
-- if background presence reporting is actively running for them (the same
-- real population Crossed Paths already depends on) -- silently no push
-- otherwise, never a fabricated "nearby" claim without a real coordinate.
--
-- Deliberately NOT built in this pass, disclosed here rather than silently
-- skipped: the "3 people nearby are planning X" social-proof copy variant
-- from the user's own example needs its own separate trigger on
-- gathering_interest INSERT checking a real attendee-count threshold crossed
-- (mirroring notify_group_intent_threshold()'s own threshold-crossing
-- shape) -- a brand-new gathering has zero attendees at the moment this
-- migration's own INSERT trigger fires, so that variant is a real, distinct
-- fast-follow, not something this migration can produce.

-- ==================== Preference columns ====================
-- categories: null = all of the user's own declared interests qualify (no
-- narrowing) -- same "null means unrestricted" shape already used elsewhere
-- in this schema (e.g. brand_partners.categories). max_distance_miles: null
-- = any distance; the two non-null defaults reuse this repo's own existing
-- real distance tiers (gatherings.js's LOCAL_TIER_MAX_MILES=1 /
-- WIDE_TIER_MAX_MILES=15) rather than inventing a new distance concept.
alter table profiles
  add column if not exists notify_things_to_do_frequency text not null default 'few_per_day',
  add column if not exists notify_things_to_do_categories text[],
  add column if not exists notify_things_to_do_max_distance_miles numeric default 15,
  add column if not exists notify_things_to_do_time_pref text not null default 'anytime',
  add column if not exists notify_nearby_opportunities_frequency text not null default 'few_per_day',
  add column if not exists notify_nearby_opportunities_categories text[],
  add column if not exists notify_nearby_opportunities_max_distance_miles numeric default 15,
  add column if not exists notify_nearby_opportunities_time_pref text not null default 'anytime';

alter table profiles
  add constraint profiles_notify_things_to_do_frequency_check
    check (notify_things_to_do_frequency in ('few_per_day', 'more_often', 'as_they_happen')),
  add constraint profiles_notify_things_to_do_time_pref_check
    check (notify_things_to_do_time_pref in ('anytime', 'evenings_weekends')),
  add constraint profiles_notify_nearby_opportunities_frequency_check
    check (notify_nearby_opportunities_frequency in ('few_per_day', 'more_often', 'as_they_happen')),
  add constraint profiles_notify_nearby_opportunities_time_pref_check
    check (notify_nearby_opportunities_time_pref in ('anytime', 'evenings_weekends'));

-- ==================== Frequency-cap log ====================
-- Shared by both notification categories (source_type distinguishes them).
-- Internal signal only -- RLS enabled, zero policies, same "never exposed to
-- the owning user, let alone anyone else" shape confirmed live on
-- presence_reports above. One row per push actually sent; the trigger
-- functions below count today's rows (in the recipient's own timezone,
-- matching this schema's existing "today in user's own tz" convention e.g.
-- ai_uses_today) against a cap derived from that user's own frequency
-- setting, so the hard-cap enforcement is a plain count query, not a
-- separate counter column needing FOR UPDATE -- these trigger firings are
-- not concurrent per-user actions the way a rate-limited user action is.
create table if not exists public.recommendation_push_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('gathering', 'business_availability')),
  source_id uuid not null,
  sent_at timestamptz not null default now()
);
create index if not exists recommendation_push_log_user_source_sent_idx
  on public.recommendation_push_log (user_id, source_type, sent_at desc);
alter table public.recommendation_push_log enable row level security;

-- Matching profiles.interests via `@>` (array contains) instead of
-- `x = any(interests)` so this can actually use a GIN index -- real,
-- disclosed indexing-ahead-of-need precedent, same reasoning as this
-- repo's own 20261003_taxonomy_aware_search.sql: production row counts are
-- still small enough that the planner will pick a seq scan regardless
-- today, but the index needs to exist now for when the table grows.
create index if not exists profiles_interests_gin_idx on public.profiles using gin (interests);

-- ==================== Gatherings: real-time match trigger ====================
-- Fires once per newly created gathering (AFTER INSERT only -- an edit to
-- an existing gathering never re-fires this, matching this repo's own
-- established "insert-only avoids re-notifying on update" precedent from
-- 20261002_crossed_paths_sighting_notification.sql). Only ever considers a
-- genuinely public, "everyone"-visibility gathering -- a friends-only/
-- invite-only/community-scoped gathering is not general discoverable
-- supply, so pushing it to an arbitrary interest-matched stranger would
-- violate this app's own no-stranger-discovery rule; that rule doesn't
-- apply to the gathering itself (real public supply), only to who it's
-- surfaced to, and "everyone" visibility is exactly the real, already-
-- established boundary for that.
create or replace function public.notify_matching_things_to_do()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_service_key text;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_scheduled_local timestamp;
  v_when_phrase text;
begin
  if new.visibility <> 'everyone' or coalesce(new.is_public, false) is not true or new.interest_tag is null
     or new.precise_lat is null or new.precise_lng is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_things_to_do_frequency, p.notify_things_to_do_max_distance_miles,
           p.notify_things_to_do_time_pref
    from profiles p
    join presence_reports pr on pr.user_id = p.id
    where p.id <> new.host_id
      and coalesce(p.notify_things_to_do, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and p.interests @> array[new.interest_tag]
      and (p.notify_things_to_do_categories is null or new.interest_tag = any(p.notify_things_to_do_categories))
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(new.precise_lat)) * cos(radians(new.precise_lng) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(new.precise_lat))
    )));
    if v_candidate.notify_things_to_do_max_distance_miles is not null
       and v_distance_miles > v_candidate.notify_things_to_do_max_distance_miles then
      continue;
    end if;

    v_scheduled_local := new.scheduled_at at time zone v_candidate.tz;
    if v_candidate.notify_things_to_do_time_pref = 'evenings_weekends'
       and extract(dow from v_scheduled_local) not in (0, 6)
       and extract(hour from v_scheduled_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'gathering'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_things_to_do_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20 -- 'as_they_happen' -- still a hard safety ceiling, not literally unlimited
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    v_when_phrase := case
      when v_scheduled_local::date = v_today_in_tz and extract(hour from v_scheduled_local) >= 17 then 'tonight'
      when v_scheduled_local::date = v_today_in_tz then 'today'
      when v_scheduled_local::date = v_today_in_tz + 1 then 'tomorrow'
      when extract(dow from v_scheduled_local) in (0, 6) and v_scheduled_local::date <= v_today_in_tz + 7 then 'this weekend'
      else to_char(v_scheduled_local, 'FMDay')
    end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_candidate.id,
        'title', '🎯 This matches you',
        'body', '"' || new.title || '" (' || new.interest_tag || ') is happening ' || v_when_phrase || ' and matches your interests.',
        'data', jsonb_build_object('type', 'recommended_gathering', 'gathering_id', new.id)
      )
    );
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'gathering', new.id);
  end loop;
  return new;
end;
$function$;

create trigger on_gathering_created_notify_things_to_do
  after insert on gatherings
  for each row execute function public.notify_matching_things_to_do();

-- ==================== Business availability: real-time match trigger ====================
-- Matches against the posting's own real category AND the business's own
-- standing subcategory/secondary categories (brand_partners.subcategory /
-- .categories) -- the same layered category+subcategory+secondary-category
-- match already established for ranking in intentResolverScoring.js's
-- subcategoryBonus()/secondaryCategoryBonus(), just re-expressed here in SQL
-- since a background trigger can't call client JS. Distance respects BOTH
-- the business's own stated broadcast radius (business_availability.radius_miles)
-- and the user's own notification distance preference, whichever is smaller
-- -- both are real, already-existing distance constraints, not a new one.
create or replace function public.notify_matching_business_availability()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_service_key text;
  v_partner record;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_effective_radius double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_starts_local timestamp;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select id, name, latitude, longitude, subcategory, categories
    into v_partner
    from brand_partners bp
    where bp.id = new.partner_id;
  if v_partner.latitude is null or v_partner.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_nearby_opportunities_frequency, p.notify_nearby_opportunities_max_distance_miles,
           p.notify_nearby_opportunities_time_pref
    from profiles p
    join presence_reports pr on pr.user_id = p.id
    where coalesce(p.managed_partner_id, '00000000-0000-0000-0000-000000000000'::uuid) <> new.partner_id
      and coalesce(p.notify_nearby_opportunities, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and (
        (new.category is not null and p.interests @> array[new.category])
        or (v_partner.subcategory is not null and p.interests @> array[v_partner.subcategory])
        or (v_partner.categories is not null and p.interests && v_partner.categories)
      )
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(v_partner.latitude)) * cos(radians(v_partner.longitude) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(v_partner.latitude))
    )));
    v_effective_radius := coalesce(new.radius_miles, 15);
    if v_candidate.notify_nearby_opportunities_max_distance_miles is not null then
      v_effective_radius := least(v_effective_radius, v_candidate.notify_nearby_opportunities_max_distance_miles);
    end if;
    if v_distance_miles > v_effective_radius then
      continue;
    end if;

    v_starts_local := new.starts_at at time zone v_candidate.tz;
    if v_candidate.notify_nearby_opportunities_time_pref = 'evenings_weekends'
       and extract(dow from v_starts_local) not in (0, 6)
       and extract(hour from v_starts_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'business_availability'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_nearby_opportunities_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_candidate.id,
        'title', '🌟 This matches you',
        'body', coalesce(v_partner.name, 'A nearby business') || '''s "' || new.title || '" matches your interests.',
        'data', jsonb_build_object('type', 'recommended_business_availability', 'availability_id', new.id, 'partner_id', new.partner_id)
      )
    );
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'business_availability', new.id);
  end loop;
  return new;
end;
$function$;

create trigger on_business_availability_created_notify_nearby_opportunities
  after insert on business_availability
  for each row execute function public.notify_matching_business_availability();
