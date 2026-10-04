-- Item 204 (owner approval, 2026-10-04): the V1 launch Demand Market Area. A coarse REPORTING market, not a claim that
-- the area is the city of Boca Raton (it runs roughly from Deerfield Beach to Delray Beach). Exactly these four
-- existing wide_area cells; no other market is defined. Idempotent.
insert into public.demand_markets (key, display_name) values ('south_palm_beach', 'South Palm Beach market')
on conflict (key) do nothing;
insert into public.demand_market_cells (cell, market_key) values
  ('26.3,-80.1', 'south_palm_beach'),
  ('26.4,-80.1', 'south_palm_beach'),
  ('26.3,-80.2', 'south_palm_beach'),
  ('26.4,-80.2', 'south_palm_beach')
on conflict (cell) do nothing;
