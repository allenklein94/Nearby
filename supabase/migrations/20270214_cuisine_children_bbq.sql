-- Item 76 (2026-09-26): categories have parent/child levels, group -> tag -> cuisine (src/constants/categoryTree.js). Cuisine
-- stays the business's own declared `cuisine` field (not a leaf tag). The owner's Restaurants children include BBQ, which
-- the closed cuisine vocabulary lacked; it gains bbq, korean, vietnamese, greek (15 keys incl. other). Same recipe as the
-- attribute widenings: the 4 CHECKs are widened and the 3 functions that carry the list are widened in place from their
-- live bodies, guarded to fail loudly. Only widens; no row changes.
do $mig$
declare
  new_list text := $q$'italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'bbq', 'korean', 'vietnamese', 'greek', 'other'$q$;
begin
  execute 'alter table public.brand_partners drop constraint if exists brand_partners_cuisine_check';
  execute 'alter table public.brand_partners add constraint brand_partners_cuisine_check check (cuisine is null or cuisine = any (array[' || new_list || ']::text[]))';
  execute 'alter table public.business_requests drop constraint if exists business_requests_cuisine_check';
  execute 'alter table public.business_requests add constraint business_requests_cuisine_check check (cuisine is null or cuisine = any (array[' || new_list || ']::text[]))';
  execute 'alter table public.business_partner_requests drop constraint if exists business_partner_requests_cuisine_check';
  execute 'alter table public.business_partner_requests add constraint business_partner_requests_cuisine_check check (cuisine is null or cuisine = any (array[' || new_list || ']::text[]))';
  execute 'alter table public.profiles drop constraint if exists profiles_cuisine_preferences_check';
  execute 'alter table public.profiles add constraint profiles_cuisine_preferences_check check (cuisine_preferences <@ array[' || new_list || ']::text[])';
end
$mig$;

do $mig$
declare
  v_def text; v_new text; r record; n int := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_business_request', 'update_business_profile', 'answer_preference_poll')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, $q$'thai', 'seafood', 'other'$q$, $q$'thai', 'seafood', 'bbq', 'korean', 'vietnamese', 'greek', 'other'$q$);
    if v_new = v_def then raise exception 'no cuisine list found in %', r.sig; end if;
    execute v_new;
    n := n + 1;
  end loop;
  if n <> 3 then raise exception 'expected 3 functions, patched %', n; end if;
end
$mig$;
