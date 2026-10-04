-- Item 204 (migration 20270284): Demand Market Areas. Checks: a cell belongs to one market only; cells must be written
-- exactly as the app writes wide_area; a market below the minimum size reports nothing; a request's coordinates and a
-- gathering's stored wide_area land in the same market; a cell in no market maps to nothing; no client role can read
-- or call any of it. Always rolls back: append `rollback;`. Every row must read ok = true.
begin;
create temp table out(k text, ok boolean, v text) on commit drop;

insert into demand_markets (key, display_name) values ('verify_a', 'Verify A market'), ('verify_b', 'Verify B market');
insert into demand_market_cells (cell, market_key) values ('10,-10', 'verify_a'), ('10.1,-10', 'verify_a'), ('10,-10.1', 'verify_a');

-- below the minimum (3 cells): reports nothing; the 4th cell makes it reportable
insert into out select 'too_small_reports_nothing', _demand_market_for('10,-10') is null, coalesce(_demand_market_for('10,-10'), 'null');
insert into demand_market_cells (cell, market_key) values ('10.1,-10.1', 'verify_a');
insert into out select 'four_cells_reportable', _demand_market_for('10,-10') = 'verify_a', _demand_market_for('10,-10');

-- a request at coordinates and a gathering's stored wide_area map the same way
insert into out select 'coordinates_map', _demand_market_for(_health_area(10.04, -10.03)) = 'verify_a'
  and _demand_market_for(_health_area(10.06, -10.06)) = 'verify_a', _health_area(10.06, -10.06);
insert into out select 'outside_maps_nothing', _demand_market_for('12,-12') is null, null;

-- one market per cell
do $$ begin
  insert into demand_market_cells (cell, market_key) values ('10,-10', 'verify_b');
  insert into out values ('cell_in_two_markets', false, 'accepted');
exception when unique_violation then insert into out values ('cell_in_two_markets', true, 'refused');
end $$;

-- cells must be canonical wide_area strings
do $$ declare bad text; n int := 0; begin
  foreach bad in array array['10.0,-10', '10.04,-10', '10, -10', 'abc', '10'] loop
    begin insert into demand_market_cells (cell, market_key) values (bad, 'verify_b');
    exception when check_violation or invalid_text_representation then n := n + 1; end;
  end loop;
  insert into out values ('non_canonical_cells_refused', n = 5, n::text);
end $$;

-- the name says market, never service area
do $$ begin
  insert into demand_markets (key, display_name) values ('verify_c', 'Verify service area');
  insert into out values ('name_must_say_market', false, 'accepted');
exception when check_violation then insert into out values ('name_must_say_market', true, 'refused');
end $$;

insert into out select 'coverage_audit', (select reportable and cells = 4 from demand_market_coverage where key = 'verify_a')
  and (select not reportable and cells = 0 from demand_market_coverage where key = 'verify_b'), null;

insert into out select 'no_client_access',
  not has_table_privilege('authenticated', 'public.demand_markets', 'select')
  and not has_table_privilege('anon', 'public.demand_market_cells', 'select')
  and not has_table_privilege('authenticated', 'public.demand_market_coverage', 'select')
  and not has_function_privilege('authenticated', 'public._demand_market_for(text)', 'execute')
  and not has_function_privilege('anon', 'public._demand_market_for(text)', 'execute'), null;

select k, ok, v from out order by k;
