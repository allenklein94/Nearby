-- Routing budget ceilings (migration 20270210). Rolled back. Proves: zero ceilings refuse everything; each ceiling (per person,
-- daily, monthly) refuses exactly at its edge and records nothing on refusal; bad input refused; clients cannot call or read.
begin;
do $$
declare u uuid[]; ok boolean; n int; e int;
begin
  select array_agg(id) into u from (select id from profiles order by created_at limit 2) x;
  delete from routing_usage_user_days; delete from routing_usage_days;

  -- shipped state: every ceiling 0 -> refused, nothing recorded
  if routing_claim_budget(u[1], 10) then raise exception 'FAIL: zero ceilings allowed a claim'; end if;
  select count(*) into n from routing_usage_days; if n <> 0 then raise exception 'FAIL: refusal recorded usage'; end if;

  -- per person: 2 asks/day
  update routing_budget_settings set monthly_element_ceiling = 1000, daily_element_ceiling = 1000, per_user_daily_asks = 2;
  if not routing_claim_budget(u[1], 10) or not routing_claim_budget(u[1], 10) then raise exception 'FAIL: under per-user limit refused'; end if;
  if routing_claim_budget(u[1], 10) then raise exception 'FAIL: per-user limit exceeded'; end if;
  if not routing_claim_budget(u[2], 10) then raise exception 'FAIL: another person blocked by the first person''s limit'; end if;

  -- daily elements: 30 used, ceiling 35 -> 5 fits, 6 does not
  update routing_budget_settings set daily_element_ceiling = 35, per_user_daily_asks = 100;
  if routing_claim_budget(u[2], 6) then raise exception 'FAIL: daily ceiling exceeded'; end if;
  if not routing_claim_budget(u[2], 5) then raise exception 'FAIL: exact daily fit refused'; end if;
  select elements into e from routing_usage_days where day = (now() at time zone 'utc')::date;
  if e <> 35 then raise exception 'FAIL: day elements % <> 35', e; end if;

  -- monthly: earlier this month already used 960 -> total 995, ceiling 1000 -> 5 fits, 6 does not
  update routing_budget_settings set daily_element_ceiling = 1000;
  if extract(day from (now() at time zone 'utc')) > 1 then
    insert into routing_usage_days (day, elements, asks) values ((now() at time zone 'utc')::date - 1, 960, 96);
    if routing_claim_budget(u[2], 6) then raise exception 'FAIL: monthly ceiling exceeded'; end if;
    if not routing_claim_budget(u[2], 5) then raise exception 'FAIL: exact monthly fit refused'; end if;
  end if;

  -- bad input
  if routing_claim_budget(u[1], 0) or routing_claim_budget(u[1], 21) or routing_claim_budget(null, 5) then raise exception 'FAIL: bad input accepted'; end if;

  -- per-person rows only for today; no mode/location columns exist
  select count(*) into n from information_schema.columns where table_schema = 'public'
    and table_name in ('routing_usage_days', 'routing_usage_user_days', 'routing_budget_settings')
    and column_name ~ '(mode|lat|lng|origin|location|candidate)';
  if n <> 0 then raise exception 'FAIL: a routing table stores ask details'; end if;

  -- access: only service_role may execute; clients have no table privileges
  if has_function_privilege('authenticated', 'public.routing_claim_budget(uuid,integer)', 'execute')
     or has_function_privilege('anon', 'public.routing_claim_budget(uuid,integer)', 'execute') then raise exception 'FAIL: client can claim'; end if;
  if has_table_privilege('authenticated', 'public.routing_budget_settings', 'select')
     or has_table_privilege('anon', 'public.routing_usage_user_days', 'select')
     or has_table_privilege('authenticated', 'public.routing_budget_settings', 'update') then raise exception 'FAIL: client table access'; end if;
  select count(*) into n from pg_proc where proname = 'routing_claim_budget';
  if n <> 1 then raise exception 'FAIL: % overloads', n; end if;
  raise notice 'PASS routing budget ceilings';
end $$;
rollback;
