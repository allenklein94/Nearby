-- Item 204 (owner, 2026-10-04, LOCKED): Demand Market Areas, the coarse REPORTING geography for any future business-facing
-- demand statement ("25-49 people in the Boca Raton market have recently asked for Padel"). Reporting layer only.
--
--   * Operational geography is unchanged: profiles, gatherings and typed asks keep their ~7-mile wide_area cell, business
--     requests keep their coordinates and ~10-mile area_key. Nothing here is written by or read from the app.
--   * A market is a small, manually maintained, named set of EXISTING wide_area cells (0.1 degree, the app's own rounding;
--     a request or business maps through its coordinates with the same rounding, _health_area). One grid, so the mapping
--     is deterministic and auditable: demand_market_cells lists exactly which cells belong to which market.
--   * Every cell belongs to at most ONE market (primary key on the cell): no overlap, no ambiguity. A cell in no market
--     is in no market (never assigned to a nearest one).
--   * A market must be materially broader than one cell: _demand_market_for only answers for a market of at least
--     demand_market_min_cells() cells (4 cells ~ 14 x 14 miles), so a one-cell "market" can never stand in for a grid cell.
--   * Markets and cells are added by deliberate owner SQL (no setter, no admin screen, no business-chosen geography).
--     Grid ids and coordinates are never exposed to businesses; only the display name is ever meant to leave Nearby.
--   * Named "market", never "service area" (that is a business's own service radius).
-- No general geocoding / municipality / ZIP system. Internal only: no client grants.

create table if not exists public.demand_markets (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  display_name text not null check (display_name ~ ' market$' and length(display_name) between 8 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.demand_market_cells (
  cell text primary key,
  market_key text not null references public.demand_markets(key) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  -- the cell must be written exactly as the app writes wide_area (e.g. '26.4,-80.1', '40,-75'), so it can match
  constraint demand_market_cells_canonical check (
    cell ~ '^-?[0-9]{1,2}(\.[0-9])?,-?[0-9]{1,3}(\.[0-9])?$'
    and cell = public._health_area(split_part(cell, ',', 1)::float8, split_part(cell, ',', 2)::float8)
  )
);
create index if not exists demand_market_cells_market on public.demand_market_cells(market_key);

alter table public.demand_markets enable row level security;
alter table public.demand_market_cells enable row level security;
revoke all on public.demand_markets, public.demand_market_cells from public, anon, authenticated;

create or replace function public.demand_market_min_cells()
returns integer language sql immutable as $$ select 4 $$;
revoke all on function public.demand_market_min_cells() from public, anon, authenticated;

-- The market a wide_area cell reports under, or NULL (not in a market, or the market is too small to report).
create or replace function public._demand_market_for(cell_param text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select c.market_key
  from demand_market_cells c
  where c.cell = cell_param
    and (select count(*) from demand_market_cells x where x.market_key = c.market_key) >= demand_market_min_cells();
$$;
revoke all on function public._demand_market_for(text) from public, anon, authenticated;

-- Audit: every market with its cells and whether it is broad enough to report under.
create or replace view public.demand_market_coverage as
select m.key, m.display_name, count(c.cell) as cells,
       count(c.cell) >= demand_market_min_cells() as reportable,
       coalesce(array_agg(c.cell order by c.cell) filter (where c.cell is not null), '{}') as cell_list
from demand_markets m
left join demand_market_cells c on c.market_key = m.key
group by m.key, m.display_name;
revoke all on public.demand_market_coverage from public, anon, authenticated;
