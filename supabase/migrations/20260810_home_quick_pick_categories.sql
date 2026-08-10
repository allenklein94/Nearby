-- Lets a user pin their own set of Home quick-pick categories, overriding
-- the auto-personalized default (top-3 real attended categories, computed
-- client-side from the already-existing getMyTopGatheringCategories()).
-- null = auto-personalize (the default, zero behavior change for every
-- existing row). Same jsonb-array shape as the existing
-- quick_filter_order/quick_filter_visible columns on this same table, for
-- an analogous "user-customizable ordered chip list" feature. Not
-- privileged (matches the existing freely-self-editable `interests`
-- column) — no trusted_update guard needed.
alter table public.profiles
  add column if not exists home_quick_pick_categories jsonb;
