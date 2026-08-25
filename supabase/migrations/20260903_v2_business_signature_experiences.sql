-- Signature Experiences -- "Business Story" plan Phase 6, see CLAUDE.md
-- for the full context. Real, curated bundles a business shows off
-- ("Sunset Coffee Date," "Friends on the Patio") -- not another generic
-- offer, and not a fabricated AI-generation system. Expressed in the
-- *exact* same curated vocabulary this schema already uses elsewhere:
-- the 8-value attributes vocabulary (brand_partners.attributes/
-- priority_attributes), and gatherings.price_level/party_type's own
-- CHECK values -- so an experience is honestly comparable to a
-- gathering's own price/party signal, even though wiring an actual
-- intent-resolver match is explicitly out of scope for this migration.

create table if not exists public.business_experiences (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  title text not null,
  description text,
  icon text,
  attributes text[] not null default '{}',
  price_level text,
  party_type text,
  active boolean not null default true,
  -- true only for a suggestion the owner kept without editing away from
  -- its rule-derived defaults -- a real provenance flag, never presented
  -- as evidence of anything beyond "this one came from a rule."
  ai_suggested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_experiences_title_length_check'
  ) then
    alter table business_experiences
      add constraint business_experiences_title_length_check
      check (char_length(title) between 1 and 80);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_experiences_description_length_check'
  ) then
    alter table business_experiences
      add constraint business_experiences_description_length_check
      check (description is null or char_length(description) <= 200);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_experiences_attributes_check'
  ) then
    alter table business_experiences
      add constraint business_experiences_attributes_check
      check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]);
  end if;
end $$;

-- Tagged $do$ delimiter here (not bare $$) since the check itself
-- contains literal '$$'/'$$$' strings, which would otherwise prematurely
-- close a bare $$...$$ dollar-quoted block.
do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_experiences_price_level_check'
  ) then
    alter table business_experiences
      add constraint business_experiences_price_level_check
      check (price_level is null or price_level in ('free', '$', '$$', '$$$'));
  end if;
end $do$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_experiences_party_type_check'
  ) then
    alter table business_experiences
      add constraint business_experiences_party_type_check
      check (party_type is null or party_type in ('solo', 'friends', 'groups', 'date'));
  end if;
end $$;

create index if not exists business_experiences_partner_id_idx on business_experiences(partner_id);

alter table business_experiences enable row level security;

-- Real experiences are meant to be a public showcase (the actual
-- consumer-facing payoff), matching brand_partners' own "active rows are
-- public" posture -- an inactive/deactivated experience is only ever
-- visible to its own owner (e.g. while editing before reactivating).
drop policy if exists "Anyone can view active experiences, owner sees all" on business_experiences;
create policy "Anyone can view active experiences, owner sees all"
  on business_experiences for select
  using (
    active = true
    or exists (
      select 1 from profiles
      where id = auth.uid() and managed_partner_id = business_experiences.partner_id
    )
  );

-- No direct client INSERT/UPDATE/DELETE -- matching this schema's
-- established "owner-scoped table, writes only through a checked RPC"
-- convention (e.g. business_availability, business_fulfillment_policies).

create or replace function public.create_business_experience(
  partner_id_param uuid,
  title_param text,
  description_param text default null,
  icon_param text default null,
  attributes_param text[] default '{}',
  price_level_param text default null,
  party_type_param text default null,
  ai_suggested_param boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if title_param is null or char_length(trim(title_param)) = 0 then
    raise exception 'Title cannot be empty';
  end if;

  if attributes_param is not null and not (attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if price_level_param is not null and price_level_param not in ('free', '$', '$$', '$$$') then
    raise exception 'Invalid price level';
  end if;

  if party_type_param is not null and party_type_param not in ('solo', 'friends', 'groups', 'date') then
    raise exception 'Invalid party type';
  end if;

  insert into business_experiences (
    partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested
  ) values (
    partner_id_param, trim(title_param), nullif(trim(coalesce(description_param, '')), ''),
    icon_param, coalesce(attributes_param, '{}'), price_level_param, party_type_param, coalesce(ai_suggested_param, false)
  )
  returning id into v_id;

  return v_id;
end;
$func$;

revoke all on function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean) from public, anon;
grant execute on function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean) to authenticated;

create or replace function public.update_business_experience(
  experience_id_param uuid,
  title_param text,
  description_param text default null,
  icon_param text default null,
  attributes_param text[] default '{}',
  price_level_param text default null,
  party_type_param text default null,
  active_param boolean default true
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_partner_id uuid;
begin
  select partner_id into v_partner_id from business_experiences where id = experience_id_param;

  if v_partner_id is null then
    raise exception 'Experience not found';
  end if;

  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = v_partner_id
  ) then
    raise exception 'You do not manage this business';
  end if;

  if title_param is null or char_length(trim(title_param)) = 0 then
    raise exception 'Title cannot be empty';
  end if;

  if attributes_param is not null and not (attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if price_level_param is not null and price_level_param not in ('free', '$', '$$', '$$$') then
    raise exception 'Invalid price level';
  end if;

  if party_type_param is not null and party_type_param not in ('solo', 'friends', 'groups', 'date') then
    raise exception 'Invalid party type';
  end if;

  -- Editing a kept suggestion at all means it's no longer "kept
  -- unmodified" -- ai_suggested drops to false the moment a real edit is
  -- saved, matching this migration's own stated provenance rule.
  update business_experiences
  set title = trim(title_param),
      description = nullif(trim(coalesce(description_param, '')), ''),
      icon = icon_param,
      attributes = coalesce(attributes_param, '{}'),
      price_level = price_level_param,
      party_type = party_type_param,
      active = coalesce(active_param, true),
      ai_suggested = false,
      updated_at = now()
  where id = experience_id_param;
end;
$func$;

revoke all on function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean) from public, anon;
grant execute on function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean) to authenticated;

create or replace function public.delete_business_experience(experience_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_partner_id uuid;
begin
  select partner_id into v_partner_id from business_experiences where id = experience_id_param;

  if v_partner_id is null then
    raise exception 'Experience not found';
  end if;

  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = v_partner_id
  ) then
    raise exception 'You do not manage this business';
  end if;

  delete from business_experiences where id = experience_id_param;
end;
$$;

revoke all on function public.delete_business_experience(uuid) from public, anon;
grant execute on function public.delete_business_experience(uuid) to authenticated;
