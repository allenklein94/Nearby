-- Business DNA / Goals / Availability Pulse -- response to the external
-- "Business Story" vision doc, see CLAUDE.md's own locked-plan section
-- for the full context and scope decisions. Three small, additive,
-- owner-declared signals layered on top of the already-real attributes/
-- cuisine vocabulary (20260825_dating_prefs_backfill_and_business_
-- attributes.sql) -- no new taxonomy invented, no fabricated AI-
-- suggestion engine built. Every value here is either the owner's own
-- free text or a subset of an already-CHECK-constrained vocabulary the
-- owner explicitly picks from.

-- Phase 1 -- Business DNA: a real, owner-authored "what makes you
-- different" field. Length-capped the same way this schema caps other
-- free-text fields shown prominently in a card (e.g. description-style
-- fields elsewhere), not an arbitrary number -- 280 matches a single
-- short, punchy sentence, the intended use.
alter table brand_partners
  add column if not exists differentiator text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_partners_differentiator_length_check'
  ) then
    alter table brand_partners
      add constraint brand_partners_differentiator_length_check
      check (differentiator is null or char_length(differentiator) <= 280);
  end if;
end $$;

-- Phase 2 -- Business Goals ("what we want more of"): a real subset of
-- the *same* 8-value attributes vocabulary attributes already uses -- no
-- second taxonomy. Owner-facing only this pass (see CLAUDE.md); used in
-- Phase 4 as a client-side priority-match badge, not wired into fan-out
-- ordering or shown on the public profile.
alter table brand_partners
  add column if not exists priority_attributes text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_partners_priority_attributes_check'
  ) then
    alter table brand_partners
      add constraint brand_partners_priority_attributes_check
      check (priority_attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]);
  end if;
end $$;

-- Phase 3 -- Availability Pulse: a real, coarse, fast, self-reported
-- three-state "how's business right now" signal -- deliberately NOT the
-- deeper capacity-rules business_fulfillment_policies mechanism, which
-- stays untouched. availability_pulse_updated_at backs a client-side
-- staleness cutoff (a pulse older than 24h is hidden, never shown as if
-- real-time when it isn't).
alter table brand_partners
  add column if not exists availability_pulse text,
  add column if not exists availability_pulse_note text,
  add column if not exists availability_pulse_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_partners_availability_pulse_check'
  ) then
    alter table brand_partners
      add constraint brand_partners_availability_pulse_check
      check (availability_pulse is null or availability_pulse in ('open', 'limited', 'full'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_partners_availability_pulse_note_length_check'
  ) then
    alter table brand_partners
      add constraint brand_partners_availability_pulse_note_length_check
      check (availability_pulse_note is null or char_length(availability_pulse_note) <= 140);
  end if;
end $$;

-- update_business_profile() gains differentiator_param -- an added
-- parameter changes the function's signature, so a plain CREATE OR
-- REPLACE would silently create a second, orphaned overload rather than
-- truly replacing the original (Postgres identifies a function by name +
-- argument-type list, not name alone) -- explicit DROP of the old 10-arg
-- signature first, matching this schema's own established discipline
-- (see the identical note in 20260825_dating_prefs_backfill_and_
-- business_attributes.sql for the prior param addition to this exact
-- function). Every other line is byte-for-byte the live function pulled
-- fresh via the Management API before this migration was written.
drop function if exists update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text);

create function update_business_profile(
  partner_id_param uuid,
  name_param text,
  description_param text,
  address_param text,
  latitude_param double precision,
  longitude_param double precision,
  logo_url_param text,
  category_param text default null,
  attributes_param text[] default null,
  cuisine_param text default null,
  differentiator_param text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if name_param is null or trim(name_param) = '' then
    raise exception 'Business name cannot be empty';
  end if;

  if category_param is not null and category_param not in (
    'food_drink', 'fitness_wellness', 'retail_shopping',
    'arts_entertainment', 'professional_services', 'other'
  ) then
    raise exception 'Invalid category';
  end if;

  if attributes_param is not null and not (attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  if differentiator_param is not null and char_length(differentiator_param) > 280 then
    raise exception 'Differentiator is too long';
  end if;

  update brand_partners
  set name = name_param,
      description = description_param,
      address = address_param,
      latitude = latitude_param,
      longitude = longitude_param,
      logo_url = logo_url_param,
      category = category_param,
      attributes = coalesce(attributes_param, attributes),
      cuisine = case when attributes_param is not null then cuisine_param else cuisine end,
      differentiator = coalesce(differentiator_param, differentiator)
  where id = partner_id_param;
end;
$function$;

revoke all on function update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text) from public, anon;
grant execute on function update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text) to authenticated;

-- set_business_priority_attributes() -- a real, small, dedicated RPC
-- (not folded into update_business_profile) since this is meant to be a
-- lightweight, frequently-revisited "what we want more of" toggle, not
-- part of a full identity-edit form -- matches the vision doc's own
-- "set it once" framing and this schema's precedent of giving a fast-
-- changing signal its own narrow RPC (e.g. upsert_business_fulfillment_
-- policy vs. the slower-changing profile itself).
create or replace function public.set_business_priority_attributes(
  partner_id_param uuid,
  priority_attributes_param text[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if not (priority_attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  update brand_partners
  set priority_attributes = priority_attributes_param
  where id = partner_id_param;
end;
$$;

revoke all on function public.set_business_priority_attributes(uuid, text[]) from public, anon;
grant execute on function public.set_business_priority_attributes(uuid, text[]) to authenticated;

-- set_business_availability_pulse() -- same "fast, dedicated RPC"
-- reasoning as above. note_param is optional and length-capped at the
-- table CHECK level; updated_at is always stamped server-side (never
-- client-supplied) so a business can't backdate/forge freshness.
create or replace function public.set_business_availability_pulse(
  partner_id_param uuid,
  pulse_param text,
  note_param text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if pulse_param is null or pulse_param not in ('open', 'limited', 'full') then
    raise exception 'Invalid availability pulse';
  end if;

  if note_param is not null and char_length(note_param) > 140 then
    raise exception 'Note is too long';
  end if;

  update brand_partners
  set availability_pulse = pulse_param,
      availability_pulse_note = note_param,
      availability_pulse_updated_at = now()
  where id = partner_id_param;
end;
$$;

revoke all on function public.set_business_availability_pulse(uuid, text, text) from public, anon;
grant execute on function public.set_business_availability_pulse(uuid, text, text) to authenticated;
