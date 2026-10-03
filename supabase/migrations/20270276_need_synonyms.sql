-- Item 161 (2026-10-03): everyday NEED wording that named no category. Seeds the same rows as the client table
-- (src/constants/categorySynonyms.js; categorySynonyms.test.js keeps them identical). Phrases are stored normalized
-- (lowercase, per-word plural trim), the form the client's seedRows() produces. Existing tags only; no new category.
insert into public.category_synonyms (phrase, tag) values
  ('haircut', 'Barbers'),
  ('haircut', 'Salons'),
  ('hair cut', 'Barbers'),
  ('hair cut', 'Salons'),
  ('flower', 'Florist'),
  ('bouquet', 'Florist'),
  ('gift', 'Gift Shop'),
  ('present', 'Gift Shop'),
  ('dog groomer', 'Grooming'),
  ('pet grooming', 'Grooming')
on conflict do nothing;
