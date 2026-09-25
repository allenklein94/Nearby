-- Effort level live check (rolled back): column exists, the three levels + NULL accepted, unknown refused; energy_level (reused
-- for intensity) still 1-5 nullable.
begin;
do $$
declare g uuid; k text;
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='gatherings' and column_name='effort_level') then
    raise exception 'FAIL: effort_level column missing';
  end if;
  select id into g from public.gatherings limit 1;
  foreach k in array array['light','moderate','challenging'] loop update public.gatherings set effort_level = k where id = g; end loop;
  update public.gatherings set effort_level = null, energy_level = null where id = g;
  begin update public.gatherings set effort_level = 'extreme' where id = g; raise exception 'FAIL: unknown effort accepted';
  exception when check_violation then null; end;
  begin update public.gatherings set energy_level = 6 where id = g; raise exception 'FAIL: energy 6 accepted';
  exception when check_violation then null; end;
end $$;
select 'ok' as result;
rollback;
