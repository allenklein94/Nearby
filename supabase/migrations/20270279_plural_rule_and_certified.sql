-- Item 182 (owner, 2026-10-03, LOCKED): resolver fixes, not a taxonomy change.
-- (1) One plural rule everywhere: a singular and its plural share one key. The old trim turned "classes" into "classe",
--     so "dance class" and "dance classes" landed in different places. Now -sses/-ches/-shes/-xes drop "es"
--     (classes = class, beaches = beach, boxes = box), and a word whose singular ends in -che/-she/-sse drops that e so
--     both forms agree (headache = headaches). Identical to the client's singular() in src/constants/categorySynonyms.js
--     and applySingular() in docs/business.html; pluralNormalization.regression.test.js keeps all four copies equal.
--     No stored key changes: no seeded synonym phrase and no dismissal (0 rows) is affected.
-- (2) Wording "certified" -> Certifications, so "I need to get CPR certified" resolves (the tag's own name already
--     covers "certification"). Stored normalized, the form the client's seedRows() produces.

create or replace function public._category_singular(w text)
returns text language sql immutable set search_path = public as $$
  select case
    when char_length(w) > 4 and w ~ '(ss|ch|sh|x)es$' then left(w, -2)
    when char_length(w) > 3 and w ~ '(ss|ch|sh)e$' then left(w, -1)
    when char_length(w) > 4 and w !~ 'ss$' then regexp_replace(w, 's$', '')
    else w
  end
$$;
-- Pure text helper with no data access, executable like the two key functions that call it (they run as the caller).

create or replace function public._category_phrase_key(t text)
returns text language sql immutable set search_path = public as $$
  select coalesce((
    select string_agg(tok, ' ' order by ord) from (
      select public._category_singular(w) as tok, ord
      from regexp_split_to_table(
        btrim(regexp_replace(regexp_replace(lower(replace(coalesce(t, ''), '&', ' and ')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')), ' '
      ) with ordinality as x(w, ord)
      where w <> ''
    ) s
    where tok not in ('court','club','studio','center','centre','place','venue','business','company','facility')
       or (select count(*) from regexp_split_to_table(btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9 ]+', ' ', 'g')), '\s+') q) = 1
  ), '')
$$;

create or replace function public._category_search_key(t text)
returns text language sql immutable set search_path = public as $$
  select coalesce((
    select string_agg(public._category_singular(w), ' ' order by ord)
    from regexp_split_to_table(
      btrim(regexp_replace(regexp_replace(lower(replace(coalesce(t, ''), '&', ' and ')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')), ' '
    ) with ordinality as x(w, ord) where w <> ''
  ), '')
$$;

insert into public.category_synonyms (phrase, tag) values
  ('certified', 'Certifications')
on conflict do nothing;
