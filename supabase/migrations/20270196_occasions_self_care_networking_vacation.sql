-- Owner item 42: occasion as a first-class dimension. Three new occasions so "a self-care day", "a networking night" and
-- "a vacation" are real intents: self_care, networking, vacation. Same recipe as 20270182/20270186 but patched from the LIVE
-- definitions generically: every CHECK that lists first_date and every function that carries the occasion list or the
-- emoji/noun CASE is widened in place (guarded: fails loudly if nothing changed, or if any first_date carrier was missed).
-- Bundles (business_availability.bundle_occasion) keep their own narrow list.
do $mig$
declare
  r record; v_def text; v_new text; n_con int := 0; n_fn int := 0;
  v_to text := $q$'first_date'::text, 'self_care'::text, 'networking'::text, 'vacation'::text$q$;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'c' and c.connamespace = 'public'::regnamespace
      and pg_get_constraintdef(c.oid) like $q$%'first_date'::text%$q$
  loop
    v_new := replace(r.def, $q$'first_date'::text$q$, v_to);
    if v_new = r.def then raise exception 'constraint % unchanged', r.conname; end if;
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, v_new);
    n_con := n_con + 1;
  end loop;
  if n_con <> 6 then raise exception 'expected 6 occasion constraints, widened %', n_con; end if;

  for r in
    select p.oid, p.oid::regprocedure::text as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace and pg_get_functiondef(p.oid) like $q$%'first_date'%$q$
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    v_new := replace(v_new, $q$'fundraiser', 'first_date', 'milestone'$q$, $q$'fundraiser', 'first_date', 'self_care', 'networking', 'vacation', 'milestone'$q$);
    v_new := replace(v_new, $q$    when 'first_date' then '🌹'$q$, $q$    when 'first_date' then '🌹'
    when 'self_care' then '🧘'
    when 'networking' then '🤝'
    when 'vacation' then '🏖️'$q$);
    v_new := replace(v_new, $q$    when 'first_date' then 'First Date'$q$, $q$    when 'first_date' then 'First Date'
    when 'self_care' then 'Self-Care'
    when 'networking' then 'Networking'
    when 'vacation' then 'Vacation'$q$);
    if v_new = v_def then raise exception 'no occasion list found in %', r.sig; end if;
    execute v_new;
    n_fn := n_fn + 1;
  end loop;
  if n_fn <> 8 then raise exception 'expected 8 functions, patched %', n_fn; end if;

  -- Nothing may still carry first_date without the new values.
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
             and pg_get_functiondef(p.oid) like $q$%'first_date'%$q$ and pg_get_functiondef(p.oid) not like $q$%'self_care'%$q$) then
    raise exception 'a first_date carrier was not widened';
  end if;
end
$mig$;
