-- Intent Layer UX walkthrough fix, finding 2 (see CLAUDE.md's "Intent
-- Layer UX walkthrough fixes" plan and
-- PRODUCT_AUDIT/INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md). "Weekend"
-- meant two different date ranges inside the same intent resolution:
-- intentResolver.js's own matchesDateWindow('weekend') (used to filter
-- gatherings) covers Saturday through Sunday, but
-- get_connected_open_business_requests's date_param was a single exact
-- date -- intentResolver.js's dateWindowToDateParam('weekend') collapsed
-- to Saturday only, so a friend's genuinely-this-weekend Sunday ask was
-- silently excluded from Tier 2 results while a Sunday gathering
-- correctly surfaced via the gatherings branch.
--
-- Fixes it the honest way: the RPC gains a real date *range*
-- (date_start_param/date_end_param) instead of a single exact date. This
-- changes the parameter shape, so it's a drop + create (not an in-place
-- CREATE OR REPLACE, which requires the same argument types) -- the old
-- single-date signature is retired outright, not left as an orphaned
-- second overload, since intentResolver.js was its only real caller.

drop function if exists public.get_connected_open_business_requests(text, date);

create or replace function public.get_connected_open_business_requests(
  category_param text default null,
  date_start_param date default null,
  date_end_param date default null
)
returns table (
  id uuid,
  requester_id uuid,
  requester_display_name text,
  requester_photo_url text,
  raw_text text,
  category text,
  date date,
  party_size integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with connected as (
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from friendships
    where status = 'accepted' and (user_a = auth.uid() or user_b = auth.uid())
    union
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from matches
    where user_a = auth.uid() or user_b = auth.uid()
  )
  select br.id, br.requester_id, p.display_name, p.photo_url, br.raw_text, br.category, br.date, br.party_size
  from business_requests br
  join connected c on c.friend_id = br.requester_id
  join profiles p on p.id = br.requester_id
  where br.status = 'open'
  and br.expires_at > now()
  and br.requester_id <> auth.uid()
  and (category_param is null or br.category = category_param)
  and (
    date_start_param is null
    or br.date is null
    or br.date between date_start_param and coalesce(date_end_param, date_start_param)
  )
  order by br.created_at desc
  limit 4;
$$;

revoke all on function public.get_connected_open_business_requests(text, date, date) from public, anon;
grant execute on function public.get_connected_open_business_requests(text, date, date) to authenticated;
