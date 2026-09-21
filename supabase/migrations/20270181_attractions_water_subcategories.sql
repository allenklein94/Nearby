-- Attractions & Things to See and water-activity subcategories (owner request, 2026-09-21). Beach & Water is NOT a new
-- major: Beaches/Kayaking/Paddleboarding/Fishing already sit under Outdoors & Nature and Swimming/Boating/Water Sports
-- under Activities (one group per tag). Mirrored in src/constants/gatheringCategories.js. Idempotent.
insert into public.category_tag_groups (tag, group_key) values
  ('Historic Sites', 'attractions_things_to_see'),
  ('Observation Decks', 'attractions_things_to_see'),
  ('Exhibits', 'attractions_things_to_see'),
  ('Tourist Attractions', 'attractions_things_to_see'),
  ('Local Attractions', 'attractions_things_to_see'),
  ('Surfing', 'outdoors_nature'),
  ('Snorkeling', 'outdoors_nature'),
  ('Diving', 'outdoors_nature')
on conflict (tag) do nothing;
