-- Same-day follow-up to 20260922_business_category_taxonomy_expansion.sql:
-- a direct user follow-up request added 4 more major categories to the
-- taxonomy (src/constants/gatheringCategories.js / placeCategories.js) --
-- Stay & Getaway, Health & Personal Care, Education & Classes, Attractions
-- & Things to See -- bringing the shared taxonomy from 15 to 19 major
-- categories. This widens brand_partners.category /
-- business_partner_requests.category's CHECK constraints to accept the 4
-- new keys and updates update_business_profile()'s inline guard to match.
-- No data remap needed -- these are pure additions, no existing category
-- value is renamed or removed this pass.
--
-- health_personal_care is real here (a business can self-classify as a
-- dentist/chiropractor/etc.) even though it deliberately has zero
-- gathering leaf tags -- per direct user guidance, this category should
-- never power an algorithmic recommendation surface the way a restaurant
-- does, but self-directed business classification is a different thing
-- entirely and this migration doesn't change anything about how/whether
-- the recommendation engine surfaces a given category.

alter table public.brand_partners drop constraint if exists brand_partners_category_check;
alter table public.brand_partners add constraint brand_partners_category_check
  check (category is null or category in (
    'food_drink', 'activities_recreation', 'entertainment_nightlife', 'dating_social',
    'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids',
    'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation',
    'business_networking', 'community_volunteering', 'travel_experiences',
    'stay_getaway', 'health_personal_care', 'education_classes', 'attractions_things_to_see',
    'other'
  ));

alter table public.business_partner_requests drop constraint if exists business_partner_requests_category_check;
alter table public.business_partner_requests add constraint business_partner_requests_category_check
  check (category is null or category in (
    'food_drink', 'activities_recreation', 'entertainment_nightlife', 'dating_social',
    'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids',
    'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation',
    'business_networking', 'community_volunteering', 'travel_experiences',
    'stay_getaway', 'health_personal_care', 'education_classes', 'attractions_things_to_see',
    'other'
  ));

-- update_business_profile()'s real live signature is the 11-arg one
-- (partner_id, name, description, address, lat, lng, logo_url, category,
-- attributes text[], cuisine, differentiator) -- see 20260922's own
-- migration and CLAUDE_HISTORY.md's "Category/place/business taxonomy
-- expansion" entry for the full story of why this must target that exact
-- signature (a prior pass in this same taxonomy expansion mistakenly
-- targeted a stale 8-arg one, leaving the real function un-updated). Every
-- line other than the category check is byte-for-byte 20260922's version.
create or replace function public.update_business_profile(
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
set search_path = public
as $$
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
$$;

revoke all on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text) from public, anon;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text) to authenticated;
