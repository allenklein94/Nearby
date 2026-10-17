-- Owner idea 156 (2026-10-17): swiping is a choice, never a requirement for meeting friends. Friends discovery opens as a
-- list by default, like Dating (`discovery_view_style`, default 'list'); the swipe deck is an optional mode. Friends gets
-- its OWN column so choosing cards in Friends never changes Dating's view (and vice versa). Every existing person starts
-- on the list (the default), including anyone who used the old deck-only screen.
-- No new grants or policies: a plain column on profiles under the existing self-row UPDATE policy and table-level grants,
-- written the same way friend_quick_filter_order / discovery_view_style already are. Not in any candidate RPC or
-- another person's read; eligibility, the opt-in, the separate Friends pool and record_friend_discovery_swipe unchanged.
alter table public.profiles
  add column if not exists friend_discovery_view_style text not null default 'list';

alter table public.profiles
  drop constraint if exists profiles_friend_discovery_view_style_check;
alter table public.profiles
  add constraint profiles_friend_discovery_view_style_check
  check (friend_discovery_view_style in ('list', 'cards'));
