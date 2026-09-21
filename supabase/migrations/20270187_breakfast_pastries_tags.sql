-- Breakfast and Pastries (owner example, 2026-09-21): what a Food & Drink business ticks under "What else describes you?"
-- in the search-first signup. Leaf tags in the one registry (category_tag_groups), so every consumer of tags (business
-- served tags, routing, interests) sees them; no case-insensitive duplicate of an existing tag. Mirrored in
-- src/constants/gatheringCategories.js (categoryMapping.test.js keeps them identical). Idempotent.
insert into public.category_tag_groups (tag, group_key) values
  ('Breakfast', 'food_drink'),
  ('Pastries', 'food_drink')
on conflict (tag) do nothing;
