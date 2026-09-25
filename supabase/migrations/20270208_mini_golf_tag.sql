-- Mini Golf (owner item 68 example, 2026-09-25): "Mini golf -- 90 min". "mini golf" used to be a search synonym of Golf,
-- so it inherited Golf's multi-hour length and commitment. It is now its own leaf tag under Entertainment & Nightlife
-- (beside Arcade), with its own synonyms; the old ('mini golf', 'Golf') synonym row is removed. Mirrored in
-- src/constants/gatheringCategories.js and categorySynonyms.js (tests keep them identical). Idempotent.
insert into public.category_tag_groups (tag, group_key) values
  ('Mini Golf', 'entertainment_nightlife')
on conflict (tag) do nothing;

delete from public.category_synonyms where phrase = 'mini golf' and tag = 'Golf';

insert into public.category_synonyms (phrase, tag) values
  ('miniature golf', 'Mini Golf'),
  ('putt putt', 'Mini Golf'),
  ('crazy golf', 'Mini Golf')
on conflict do nothing;
