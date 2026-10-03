-- Owner item 178 decision 4 (2026-10-03, LOCKED): a gathering's host can explicitly declare "Pets welcome"
-- (pet_friendly) and "Dogs welcome" (dog_friendly), the same two keys a business already declares in the one
-- attribute vocabulary. A capability fix outside the item-168 taxonomy pass. Same recipe as outdoor_seating
-- (20270203): the closed gatherings.features list grows; nothing else changes. `_gathering_request_attributes`
-- (20270201) already snapshots features into the business request's attributes, and the existing attribute-overlap
-- scoring and "Customer is looking for" chips read them generically. Host-declared only: never inferred from the
-- category, title, description, place, business or AI. Communities and Google Places stay attribute-free.
alter table public.gatherings drop constraint if exists gatherings_features_check;
alter table public.gatherings add constraint gatherings_features_check check (
  features <@ array['wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'quiet', 'kid_friendly', 'stroller_friendly', 'family_seating', 'outdoor_seating', 'pet_friendly', 'dog_friendly']::text[]
);
