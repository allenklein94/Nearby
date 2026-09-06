-- Widens brand_partners.category / business_partner_requests.category from
-- the original 6-value vertical enum (20260811_business_partner_category.sql)
-- to the 15-major-category taxonomy introduced this pass in
-- src/constants/gatheringCategories.js (CATEGORY_GROUPS) and
-- src/constants/placeCategories.js -- a direct, explicit user request for a
-- full local-discovery taxonomy, deliberately kept as its own vocabulary
-- from gatherings.interest_tag (see gatheringCategories.js's file header for
-- the full reasoning) but now aligned 1:1 with CATEGORY_GROUPS's keys so a
-- business's own vertical directly matches the same categories Discover
-- browses by.
--
-- business_partner_requests.category was captured at application time
-- (20260810_business_partner_onboarding_enrichment.sql) but never had its
-- own CHECK constraint -- only client-side validation against the same
-- BUSINESS_CATEGORIES list. Adding a real one here for the first time,
-- alongside widening brand_partners'.

-- 1) Drop the old constraint before remapping so the remapped intermediate
--    values are never rejected mid-migration.
alter table public.brand_partners drop constraint if exists brand_partners_category_check;

-- 2) Best-effort one-time remap of existing rows from the old 6 values to
--    their nearest new-taxonomy equivalent. Documented explicitly, not
--    silently guessed -- a business owner can always correct this
--    afterward via their existing Edit Profile category picker
--    (update_business_profile), same as the original migration already
--    treats category as owner-correctable.
--      food_drink             -> food_drink              (unchanged)
--      fitness_wellness       -> wellness_beauty
--      retail_shopping        -> shopping
--      arts_entertainment     -> arts_culture_learning
--      professional_services  -> business_networking
--      other                  -> other                   (unchanged)
update public.brand_partners set category = 'wellness_beauty' where category = 'fitness_wellness';
update public.brand_partners set category = 'shopping' where category = 'retail_shopping';
update public.brand_partners set category = 'arts_culture_learning' where category = 'arts_entertainment';
update public.brand_partners set category = 'business_networking' where category = 'professional_services';

update public.business_partner_requests set category = 'wellness_beauty' where category = 'fitness_wellness';
update public.business_partner_requests set category = 'shopping' where category = 'retail_shopping';
update public.business_partner_requests set category = 'arts_culture_learning' where category = 'arts_entertainment';
update public.business_partner_requests set category = 'business_networking' where category = 'professional_services';

-- 3) Add the new, wider constraints.
alter table public.brand_partners add constraint brand_partners_category_check
  check (category is null or category in (
    'food_drink', 'activities_recreation', 'entertainment_nightlife', 'dating_social',
    'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids',
    'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation',
    'business_networking', 'community_volunteering', 'travel_experiences', 'other'
  ));

alter table public.business_partner_requests add constraint business_partner_requests_category_check
  check (category is null or category in (
    'food_drink', 'activities_recreation', 'entertainment_nightlife', 'dating_social',
    'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids',
    'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation',
    'business_networking', 'community_volunteering', 'travel_experiences', 'other'
  ));

-- 4) update_business_profile()'s inline category guard. The function this
--    codebase's own client (updateBusinessProfile(), src/services/
--    brandOffers.js) actually calls day to day is the 11-arg overload
--    (partner_id, name, description, address, lat, lng, logo_url, category,
--    attributes text[], cuisine, differentiator) that
--    20260903_business_dna_goals_pulse.sql dropped-and-recreated from the
--    original 8-arg one -- NOT the 8-arg signature this migration's first
--    draft mistakenly recreated (which would have left a dead unused 8-arg
--    overload sitting alongside the real 11-arg one still enforcing the old
--    6-value category list). CREATE OR REPLACE against the real 11-arg
--    signature below so it actually targets the live function. Every line
--    other than the category check is byte-for-byte 20260903's version.
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
    'business_networking', 'community_volunteering', 'travel_experiences', 'other'
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
