-- Education & Classes and Health & Personal Care subcategories (owner request, 2026-09-21). Health carries ONLY
-- non-clinical tags on purpose: dental, vision, physical therapy, chiropractic, medical services and pharmacies are
-- withheld (privacy/regulatory, and a tag here feeds interests, the AI category mapping and request routing, which must
-- never infer a medical need). Music/Art/Cooking already exist under other majors (one group per tag). Mirrored in
-- src/constants/gatheringCategories.js. Idempotent.
insert into public.category_tag_groups (tag, group_key) values
  ('Language Classes', 'education_classes'),
  ('Technology Classes', 'education_classes'),
  ('Tutoring', 'education_classes'),
  ('Adult Education', 'education_classes'),
  ('Kids Education', 'education_classes'),
  ('Professional Development', 'education_classes'),
  ('Certifications', 'education_classes'),
  ('Dance Classes', 'education_classes'),
  ('General Wellness', 'health_personal_care'),
  ('Nutrition', 'health_personal_care'),
  ('Personal Care', 'health_personal_care')
on conflict (tag) do nothing;
