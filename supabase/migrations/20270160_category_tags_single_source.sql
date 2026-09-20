-- Category tags have ONE source of truth (20270160): public.category_tag_groups. The seven hard-coded tag CHECKs
-- and update_business_profile's two copied lists are replaced by references to it, so adding a tag is one admin-approved
-- row (admin_add_category_tag) and every surface that reads the table picks it up. Group ("major") keys are NOT
-- dynamic: adding a major stays a deliberate migration (category_major_keys() below, guarded by a Jest test).
-- Also repairs pre-existing drift: update_business_profile's copied lists lacked Florist / Party & Event Decor / Gift Shop
-- (present in the CHECKs and the seed), so a business could not save those.

alter table public.category_tag_groups add column if not exists created_at timestamptz not null default now();
alter table public.category_tag_groups add column if not exists created_by uuid references auth.users(id) on delete set null;
revoke insert, update, delete, truncate on public.category_tag_groups from anon, authenticated;

create or replace function public.category_major_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['food_drink','activities_recreation','entertainment_nightlife','dating_social','arts_culture_learning',
    'shopping','wellness_beauty','family_kids','outdoors_nature','pets','home_local_services','auto_transportation',
    'business_networking','community_volunteering','travel_experiences','stay_getaway','health_personal_care',
    'education_classes','attractions_things_to_see']
$$;
revoke all on function public.category_major_keys() from public, anon;
grant execute on function public.category_major_keys() to authenticated, service_role;

create or replace function public.is_valid_category_tag(tag_param text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.category_tag_groups where tag = tag_param)
$$;
create or replace function public.all_valid_category_tags(tags_param text[])
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from unnest(tags_param) t where not exists (select 1 from public.category_tag_groups c where c.tag = t)
  )
$$;
revoke all on function public.is_valid_category_tag(text) from public, anon;
revoke all on function public.all_valid_category_tags(text[]) from public, anon;
grant execute on function public.is_valid_category_tag(text), public.all_valid_category_tags(text[]) to authenticated, service_role;

-- Scalar columns: a real foreign key. Every existing value already passed the old CHECK, so this validates cleanly.
alter table public.brand_partners drop constraint if exists brand_partners_subcategory_check;
alter table public.business_partner_requests drop constraint if exists business_partner_requests_subcategory_check;
alter table public.business_requests drop constraint if exists business_requests_category_check;
alter table public.business_availability drop constraint if exists business_availability_category_check;
alter table public.business_priority_signals drop constraint if exists business_priority_signals_category_check;
alter table public.brand_partners add constraint brand_partners_subcategory_fkey
  foreign key (subcategory) references public.category_tag_groups(tag) on update cascade on delete restrict;
alter table public.business_partner_requests add constraint business_partner_requests_subcategory_fkey
  foreign key (subcategory) references public.category_tag_groups(tag) on update cascade on delete restrict;
alter table public.business_requests add constraint business_requests_category_fkey
  foreign key (category) references public.category_tag_groups(tag) on update cascade on delete restrict;
alter table public.business_availability add constraint business_availability_category_fkey
  foreign key (category) references public.category_tag_groups(tag) on update cascade on delete restrict;
alter table public.business_priority_signals add constraint business_priority_signals_category_fkey
  foreign key (category) references public.category_tag_groups(tag) on update cascade on delete restrict;

-- Array columns cannot use a foreign key: a trigger does the same job.
alter table public.brand_partners drop constraint if exists brand_partners_categories_check;
alter table public.business_partner_requests drop constraint if exists business_partner_requests_categories_check;
create or replace function public.enforce_category_tags_array()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.categories is not null and not public.all_valid_category_tags(new.categories) then
    raise exception 'Invalid category tag' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_category_tags_array() from public, anon, authenticated;
drop trigger if exists enforce_category_tags_array on public.brand_partners;
create trigger enforce_category_tags_array before insert or update of categories on public.brand_partners
  for each row execute function public.enforce_category_tags_array();
drop trigger if exists enforce_category_tags_array on public.business_partner_requests;
create trigger enforce_category_tags_array before insert or update of categories on public.business_partner_requests
  for each row execute function public.enforce_category_tags_array();

-- Admin action: add a NEW tag under an existing group. Never AI; never deletes or renames; never creates a group.
create or replace function public.admin_add_category_tag(tag_param text, group_key_param text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tag text := regexp_replace(btrim(coalesce(tag_param, '')), '\s+', ' ', 'g');
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only an admin can add a category';
  end if;
  if group_key_param is null or not (group_key_param = any (public.category_major_keys())) then
    raise exception 'Unknown category group';
  end if;
  if char_length(v_tag) < 2 or char_length(v_tag) > 40 or v_tag !~ '^[A-Za-z0-9][A-Za-z0-9 &''/-]*$' then
    raise exception 'A category name is 2-40 characters: letters, numbers, spaces and & / - only';
  end if;
  if exists (select 1 from category_tag_groups where lower(tag) = lower(v_tag)) then
    raise exception 'That category already exists';
  end if;
  insert into category_tag_groups (tag, group_key, created_by) values (v_tag, group_key_param, auth.uid());
  return v_tag;
end;
$$;
revoke all on function public.admin_add_category_tag(text, text) from public, anon;
grant execute on function public.admin_add_category_tag(text, text) to authenticated;

create or replace function public.update_business_profile(partner_id_param uuid, name_param text, description_param text, address_param text, latitude_param double precision, longitude_param double precision, logo_url_param text, category_param text DEFAULT NULL::text, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text, differentiator_param text DEFAULT NULL::text, subcategory_param text DEFAULT NULL::text, categories_param text[] DEFAULT NULL::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_valid_subcats text[];
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
    'food_drink', 'activities_recreation', 'entertainment_nightlife', 'dating_social',
    'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids',
    'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation',
    'business_networking', 'community_volunteering', 'travel_experiences',
    'stay_getaway', 'health_personal_care', 'education_classes', 'attractions_things_to_see',
    'other'
  ) then
    raise exception 'Invalid category';
  end if;

  if attributes_param is not null and not (attributes_param <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
    'kid_friendly', 'quiet', 'casual', 'upscale',
    'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront',
    'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events'
  ]::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  if differentiator_param is not null and char_length(differentiator_param) > 280 then
    raise exception 'Differentiator is too long';
  end if;

  if categories_param is not null and not public.all_valid_category_tags(categories_param) then
    raise exception 'Invalid secondary category';
  end if;

  select coalesce(array_agg(tag), array[]::text[]) into v_valid_subcats
  from public.category_tag_groups where group_key = category_param;
  if subcategory_param is not null and not (subcategory_param = any(v_valid_subcats)) then
    raise exception 'Invalid subcategory for this category';
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
      differentiator = coalesce(differentiator_param, differentiator),
      subcategory = subcategory_param,
      categories = coalesce(categories_param, categories)
  where id = partner_id_param;
end;
$function$;
