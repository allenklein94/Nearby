-- Sponsored placement, PHASE 1 (design: PRODUCT_AUDIT/SPONSORED_PLACEMENT_DESIGN_2026-09-20.md, LOCKED item 44).
-- Schema + serving function only. There is NO payment path yet: nothing can become "paid" from a client, the category
-- allow-list ships EMPTY, and the serving predicate requires a paid payment row, so this serves nothing in production.
-- Paid status exists only in sponsored_payments (written by a future webhook). No column is added to any organic table
-- except the consumer's own profiles.show_sponsored_places suppress switch.
create extension if not exists btree_gist;

alter table public.profiles
  add column if not exists show_sponsored_places boolean not null default true;

-- One inventory cell = about 10 miles on a side at mid-latitudes, keyed on the BUSINESS address (never a viewer).
create or replace function public.sponsored_area_key(lat double precision, lng double precision)
returns text language sql immutable as $$
  select floor(lat / 0.145)::bigint::text || ':' || floor(lng / 0.19)::bigint::text;
$$;

create table if not exists public.sponsored_price (
  id boolean primary key default true check (id),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd'
);
insert into public.sponsored_price (amount_cents) values (2500) on conflict (id) do nothing;

-- Only category groups listed here can be sold. Ships EMPTY (fail closed) until the legal/policy review.
create table if not exists public.sponsorable_category_groups (
  group_key text primary key,
  added_at timestamptz not null default now()
);

create table if not exists public.sponsored_placements (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  item_kind text not null check (item_kind in ('offer', 'business')),
  item_id uuid not null,
  area_key text not null,
  category_group text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in (
    'draft', 'awaiting_payment', 'scheduled', 'active', 'completed',
    'payment_failed', 'expired_unpaid', 'cancelled', 'refunded', 'rejected', 'paused')),
  title text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) <= 200),
  media_path text,
  screening_tier text not null default 'pending' check (screening_tier in ('pending', 'low', 'review', 'blocked')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at = starts_at + interval '7 days'),
  -- 1 sponsored placement per category group per local area at a time (held or paid states)
  constraint sponsored_one_per_area_category exclude using gist (
    area_key with =, category_group with =, tstzrange(starts_at, ends_at) with &&
  ) where (status in ('awaiting_payment', 'scheduled', 'active', 'paused'))
);
-- a business holds one spotlight at a time in v1
create unique index if not exists sponsored_one_per_partner
  on public.sponsored_placements (partner_id)
  where status in ('awaiting_payment', 'scheduled', 'active', 'paused');

create table if not exists public.sponsored_payments (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.sponsored_placements(id) on delete cascade,
  stripe_payment_intent_id text unique,
  stripe_checkout_session_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in (
    'pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'disputed')),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Aggregate only: no user ids, no location.
create table if not exists public.sponsored_daily_stats (
  placement_id uuid not null references public.sponsored_placements(id) on delete cascade,
  day date not null,
  impressions integer not null default 0,
  taps integer not null default 0,
  primary key (placement_id, day)
);

-- Cap enforcement ONLY: one row per (person, business) = when it was last served. Purged after 7 days.
create table if not exists public.sponsored_seen (
  user_id uuid not null references public.profiles(id) on delete cascade,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, partner_id)
);
create index if not exists sponsored_seen_seen_at on public.sponsored_seen (seen_at);

-- The person's own "hide this sponsor" choices.
create table if not exists public.sponsored_hidden (
  user_id uuid not null references public.profiles(id) on delete cascade,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, partner_id)
);

do $$
declare t text;
begin
  foreach t in array array['sponsored_price', 'sponsorable_category_groups', 'sponsored_placements',
    'sponsored_payments', 'sponsored_daily_stats', 'sponsored_seen', 'sponsored_hidden'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- The area key and category group are DERIVED from the business, never caller-supplied; the promoted item must be the
-- business's own.
create or replace function public._sponsored_placement_before_write()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare bp record;
begin
  select id, latitude, longitude, category into bp from brand_partners where id = new.partner_id;
  if not found then raise exception 'Unknown business'; end if;
  if bp.latitude is null or bp.longitude is null then raise exception 'The business needs a located address'; end if;
  if bp.category is null or not exists (select 1 from category_tag_groups g where g.group_key = bp.category) then
    raise exception 'The business needs a category';
  end if;
  new.area_key := sponsored_area_key(bp.latitude, bp.longitude);
  new.category_group := bp.category;
  if new.item_kind = 'offer' then
    if not exists (select 1 from brand_offers o where o.id = new.item_id and o.partner_id = new.partner_id) then
      raise exception 'That offer does not belong to this business';
    end if;
  elsif new.item_id <> new.partner_id then
    raise exception 'A business placement promotes the business itself';
  end if;
  return new;
end $$;
drop trigger if exists sponsored_placement_before_write on public.sponsored_placements;
create trigger sponsored_placement_before_write
  before insert or update of partner_id, item_kind, item_id on public.sponsored_placements
  for each row execute function public._sponsored_placement_before_write();

-- THE serving predicate (fail closed): anything unknown/missing is NOT servable.
create or replace function public._sponsored_placement_servable(p public.sponsored_placements)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    p.status in ('scheduled', 'active')
    and now() >= p.starts_at and now() < p.ends_at
    and p.screening_tier = 'low'
    and exists (select 1 from sponsored_payments y where y.placement_id = p.id and y.status = 'paid')
    and exists (select 1 from sponsorable_category_groups a where a.group_key = p.category_group)
    and exists (select 1 from brand_partners b where b.id = p.partner_id and b.active = true
                and b.latitude is not null and b.longitude is not null)
    and (p.item_kind <> 'offer' or exists (
      select 1 from brand_offers o where o.id = p.item_id and o.partner_id = p.partner_id and o.active = true
        and (o.expires_at is null or o.expires_at > now()))),
    false);
$$;

-- Serving function. Accepts ONLY a position and the browse category the viewer opened; no profile/behavior inputs.
-- The position is used for the distance test and discarded (not stored, logged or returned).
create or replace function public.get_sponsored_spotlight(
  lat_param double precision,
  lng_param double precision,
  category_group_param text default null
) returns table (
  placement_id uuid, partner_id uuid, partner_name text, logo_url text,
  item_kind text, item_id uuid, title text, description text, category_group text
)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_show boolean;
  v_hit boolean;
  rec record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if lat_param is null or lng_param is null
     or lat_param not between -90 and 90 or lng_param not between -180 and 180 then
    return;
  end if;
  select show_sponsored_places into v_show from profiles where id = v_uid;
  if v_show is not true then return; end if;
  if category_group_param is not null
     and not exists (select 1 from category_tag_groups g where g.group_key = category_group_param) then
    return;
  end if;

  for rec in
    select sp.id, sp.partner_id, sp.item_kind, sp.item_id, sp.title, sp.description, sp.category_group,
           bp.name as partner_name, bp.logo_url
    from sponsored_placements sp
    join brand_partners bp on bp.id = sp.partner_id
    where _sponsored_placement_servable(sp)
      and (category_group_param is null or sp.category_group = category_group_param)
      and not exists (select 1 from sponsored_hidden h where h.user_id = v_uid and h.partner_id = sp.partner_id)
      -- fixed 10-mile delivery radius, great-circle from the business's stored coordinates
      and 3958.8 * 2 * asin(sqrt(least(1.0,
            power(sin(radians(bp.latitude - lat_param) / 2), 2)
            + cos(radians(lat_param)) * cos(radians(bp.latitude))
              * power(sin(radians(bp.longitude - lng_param) / 2), 2)))) <= 10
    -- neutral tie-break: earliest payment, then id (never price, never a consumer signal)
    order by (select min(y.paid_at) from sponsored_payments y where y.placement_id = sp.id and y.status = 'paid'), sp.id
  loop
    v_hit := null;
    -- atomic 7-day cap per (person, business): insert, or update only if the last serve is 7+ days old
    insert into sponsored_seen (user_id, partner_id, seen_at) values (v_uid, rec.partner_id, now())
    on conflict (user_id, partner_id) do update set seen_at = now()
      where sponsored_seen.seen_at <= now() - interval '7 days'
    returning true into v_hit;
    if v_hit is true then
      insert into sponsored_daily_stats (placement_id, day, impressions)
      values (rec.id, (now() at time zone 'utc')::date, 1)
      on conflict (placement_id, day) do update set impressions = sponsored_daily_stats.impressions + 1;
      return query select rec.id, rec.partner_id, rec.partner_name, rec.logo_url, rec.item_kind, rec.item_id,
                          rec.title, rec.description, rec.category_group;
      return;
    end if;
  end loop;
end $$;

-- A tap is counted only for a business actually served to this person within the cap window.
create or replace function public.record_sponsored_tap(placement_id_param uuid)
returns boolean language plpgsql volatile security definer set search_path to 'public' as $$
declare v_partner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select partner_id into v_partner from sponsored_placements where id = placement_id_param;
  if v_partner is null then return false; end if;
  if not exists (select 1 from sponsored_seen s where s.user_id = auth.uid() and s.partner_id = v_partner
                 and s.seen_at > now() - interval '7 days') then
    return false;
  end if;
  insert into sponsored_daily_stats (placement_id, day, taps)
  values (placement_id_param, (now() at time zone 'utc')::date, 1)
  on conflict (placement_id, day) do update set taps = sponsored_daily_stats.taps + 1;
  return true;
end $$;

create or replace function public.hide_sponsored_partner(partner_id_param uuid)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from brand_partners where id = partner_id_param) then raise exception 'Unknown business'; end if;
  insert into sponsored_hidden (user_id, partner_id) values (auth.uid(), partner_id_param) on conflict do nothing;
end $$;

create or replace function public.clear_hidden_sponsors()
returns void language plpgsql volatile security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from sponsored_hidden where user_id = auth.uid();
end $$;

create or replace function public.purge_sponsored_seen()
returns integer language plpgsql volatile security definer set search_path to 'public' as $$
declare n integer;
begin
  delete from sponsored_seen where seen_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.sponsored_area_key(double precision, double precision) from public, anon;
revoke all on function public._sponsored_placement_before_write() from public, anon, authenticated;
revoke all on function public._sponsored_placement_servable(public.sponsored_placements) from public, anon, authenticated;
revoke all on function public.get_sponsored_spotlight(double precision, double precision, text) from public, anon;
revoke all on function public.record_sponsored_tap(uuid) from public, anon;
revoke all on function public.hide_sponsored_partner(uuid) from public, anon;
revoke all on function public.clear_hidden_sponsors() from public, anon;
revoke all on function public.purge_sponsored_seen() from public, anon, authenticated;
grant execute on function public.sponsored_area_key(double precision, double precision) to service_role;
grant execute on function public.get_sponsored_spotlight(double precision, double precision, text) to authenticated, service_role;
grant execute on function public.record_sponsored_tap(uuid) to authenticated, service_role;
grant execute on function public.hide_sponsored_partner(uuid) to authenticated, service_role;
grant execute on function public.clear_hidden_sponsors() to authenticated, service_role;
grant execute on function public.purge_sponsored_seen() to service_role;

select cron.schedule('purge-sponsored-seen', '15 3 * * *', 'select purge_sponsored_seen();');
