-- Owner item 43: "group type" as a first-class dimension. The closed party-type vocabulary (solo / friends / groups / date)
-- gains family, coworkers, new_people so "coffee with 8 coworkers" is not the same ask as "coffee". Couple = date; Kids =
-- family (+ the kid_friendly attribute); a Large group is derived from the party size (>= 7), not stored. Widened wherever it
-- is enforced: 3 CHECKs + the 3 functions carrying the list, patched from their live bodies (guarded).
do $mig$
declare
  r record; v_def text; v_new text; n int := 0;
  v_from constant text := $q$'groups'::text, 'date'::text$q$;
  v_to constant text := $q$'groups'::text, 'date'::text, 'family'::text, 'coworkers'::text, 'new_people'::text$q$;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'c' and c.connamespace = 'public'::regnamespace
      and c.conname in ('gatherings_party_type_check', 'business_experiences_party_type_check', 'brand_partners_accommodates_party_types_check')
  loop
    v_new := replace(r.def, v_from, v_to);
    if v_new = r.def then raise exception 'constraint % unchanged', r.conname; end if;
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, v_new);
    n := n + 1;
  end loop;
  if n <> 3 then raise exception 'expected 3 constraints, widened %', n; end if;

  n := 0;
  for r in
    select p.oid, p.oid::regprocedure::text as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('set_business_accommodations', 'create_business_experience', 'update_business_experience')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, $q$'groups', 'date'$q$, $q$'groups', 'date', 'family', 'coworkers', 'new_people'$q$);
    if v_new = v_def then raise exception 'no party-type list found in %', r.sig; end if;
    execute v_new;
    n := n + 1;
  end loop;
  if n <> 3 then raise exception 'expected 3 functions, patched %', n; end if;
end
$mig$;
