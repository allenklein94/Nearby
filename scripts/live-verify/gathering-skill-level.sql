-- Item 67 live check (rolled back): column exists, all six levels accepted, NULL allowed, unknown refused.
begin;
do $$
declare g uuid; k text;
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='gatherings' and column_name='skill_level') then
    raise exception 'FAIL: skill_level column missing';
  end if;
  select id into g from public.gatherings limit 1;
  foreach k in array array['beginner','intermediate','advanced','all_levels','casual','competitive'] loop
    update public.gatherings set skill_level = k where id = g;
  end loop;
  update public.gatherings set skill_level = null where id = g;
  begin
    update public.gatherings set skill_level = 'pro' where id = g;
    raise exception 'FAIL: unknown skill level accepted';
  exception when check_violation then null;
  end;
end $$;
select 'ok' as result;
rollback;
