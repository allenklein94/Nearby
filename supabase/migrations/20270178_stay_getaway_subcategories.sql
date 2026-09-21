-- Stay & Getaway subcategories (owner request, 2026-09-21). Hotels/Resorts were added in 20270177; camping already lives
-- under outdoors_nature (a tag belongs to exactly one group), so it is not repeated here. Mirrored in
-- src/constants/gatheringCategories.js (categoryMapping.test.js keeps them identical). Idempotent.
insert into public.category_tag_groups (tag, group_key) values
  ('Vacation Rentals', 'stay_getaway'),
  ('Romantic Getaways', 'stay_getaway'),
  ('Spa Resorts', 'stay_getaway'),
  ('Family Resorts', 'stay_getaway'),
  ('Pet Friendly Stays', 'stay_getaway'),
  ('Glamping', 'stay_getaway')
on conflict (tag) do nothing;
