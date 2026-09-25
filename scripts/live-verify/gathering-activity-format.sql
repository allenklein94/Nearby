-- Item 66 live check (rolled back): the column exists, every vocabulary key is accepted, an unknown one refused, NULL allowed.
begin;
select column_name, data_type from information_schema.columns where table_schema='public' and table_name='gatherings' and column_name='format';
do $$
declare g uuid; k text;
begin
  select id into g from public.gatherings limit 1;
  foreach k in array array['drop_in','class','tournament','meetup','concert','show','festival','tour','workshop','appointment','reservation','open_play','competition','exhibition','market','party'] loop
    update public.gatherings set format = k where id = g;
  end loop;
  update public.gatherings set format = null where id = g;
  begin
    update public.gatherings set format = 'rave' where id = g;
    raise exception 'FAIL: unknown format accepted';
  exception when check_violation then raise notice 'ok: unknown format refused';
  end;
end $$;
select 'ok' as result;
rollback;
