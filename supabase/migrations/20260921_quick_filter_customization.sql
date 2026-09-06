-- Quick Filters customization (CLAUDE.md, external UX critique item 9):
-- Quick Filters used to only support reordering/showing-hiding the same
-- fixed 3 booleans -- not real customization. This adds real per-user
-- storage for (a) Dating's one configurable value (the Match % threshold)
-- and (b) Friends' own new order/visible pair, giving Friends the same
-- select+reorder customization Dating already had, via its own catalog
-- (see src/constants/quickFilterCatalog.js). No new RLS/grants needed --
-- these are plain columns on profiles, written the same way the existing
-- quick_filter_order/quick_filter_visible columns already are, under the
-- existing self-row UPDATE policy.
alter table public.profiles
  add column if not exists quick_filter_config jsonb not null default '{}'::jsonb,
  add column if not exists friend_quick_filter_order text[] not null default array['interests','distance','verified','online'],
  add column if not exists friend_quick_filter_visible text[] not null default array['interests','distance','verified','online'],
  add column if not exists friend_quick_filter_config jsonb not null default '{}'::jsonb;
