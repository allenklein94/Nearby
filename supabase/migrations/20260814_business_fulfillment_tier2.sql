-- Intent Layer, Tier 2 retrofit (see CLAUDE.md's "Intent Layer + Business
-- Fulfillment" plan, "Tier 2's ... naturally sequenced *after* Phase 2
-- lands" note). Phase 2's business_requests table now exists, so this
-- closes the resolver's Tier 2 gap: "do any of my accepted friends/matches
-- have an open business_requests row with an overlapping category/date
-- window right now" -- surfaced instead of silently skipping straight to
-- Tier 4 (asking a business fresh).
--
-- No new RLS policy on business_requests itself -- a friend's own open ask
-- is more personal than a gathering/perk, so this is intentionally a
-- narrow, read-only RPC returning only the fields the resolver actually
-- displays (no lat/lng/radius/budget_min/time-window), not a broadened
-- SELECT policy a client could query arbitrarily. Matches this schema's
-- established "RPC scoped to exactly what's needed" convention (e.g.
-- get_business_follower_count vs. the fuller owner-only stats RPCs).

create or replace function public.get_connected_open_business_requests(
  category_param text default null,
  date_param date default null
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
  and (date_param is null or br.date is null or br.date = date_param)
  order by br.created_at desc
  limit 4;
$$;

revoke all on function public.get_connected_open_business_requests(text, date) from public, anon;
grant execute on function public.get_connected_open_business_requests(text, date) to authenticated;
