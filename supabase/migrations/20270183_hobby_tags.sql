-- Hobby tags (owner request, 2026-09-21). Hobbies are NOT a new major or a Discover category: they are ordinary leaf tags in
-- the group where a person would look for them, and the client-side related-tags map lets a
-- declared hobby lightly lift related tags in other groups. Mirrored in src/constants/gatheringCategories.js. Idempotent.
insert into public.category_tag_groups (tag, group_key) values
  ('Board Games', 'entertainment_nightlife'),
  ('D&D', 'entertainment_nightlife'),
  ('Cars', 'activities_recreation'),
  ('Collecting', 'arts_culture_learning'),
  ('Fashion', 'arts_culture_learning'),
  ('Technology', 'education_classes'),
  ('Gardening', 'outdoors_nature')
on conflict (tag) do nothing;
