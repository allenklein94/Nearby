-- Camera Shops (owner request, 2026-09-21): a shopping tag so a Photography hobby has a shop to be related to
-- (client-side related-tags map). Mirrored in src/constants/gatheringCategories.js. Idempotent.
insert into public.category_tag_groups (tag, group_key) values
  ('Camera Shops', 'shopping')
on conflict (tag) do nothing;
