-- 10/10 roadmap Part 6: privacy / social granular controls (see CLAUDE.md's
-- "10/10 roadmap" plan). Deliberately scoped *within* the existing locked
-- "no stranger discovery via intent, ever" principle -- this only ever
-- narrows an already-friends/matches-only surface (Tier 2 of the intent
-- resolver, get_connected_open_business_requests), never widens it.
-- Default matches current behavior exactly -- zero regression for every
-- existing user. Dating discovery (show_me/discovery_gender) is a separate,
-- unrelated surface and is not touched by this column.
alter table public.profiles
  add column if not exists intent_visibility text not null default 'friends_and_matches';

alter table public.profiles
  drop constraint if exists profiles_intent_visibility_check;

alter table public.profiles
  add constraint profiles_intent_visibility_check
  check (intent_visibility in ('friends_and_matches', 'nobody'));

-- Real, additive filter on Tier 2's own requester-profile join -- a
-- requester who has set intent_visibility to 'nobody' is now correctly
-- excluded from surfacing to a friend/match via this RPC. Same 3-arg
-- signature/return shape as the weekend-range-plus-match-id migration
-- before this one, so a plain CREATE OR REPLACE is correct here (no
-- drop needed -- the return shape is unchanged, only the WHERE clause
-- gained one more real condition).
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
  party_size integer,
  match_id uuid
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
  select
    br.id, br.requester_id, p.display_name, p.photo_url, br.raw_text, br.category, br.date, br.party_size,
    m.id as match_id
  from business_requests br
  join connected c on c.friend_id = br.requester_id
  join profiles p on p.id = br.requester_id
  left join matches m
    on (m.user_a = auth.uid() and m.user_b = br.requester_id)
    or (m.user_a = br.requester_id and m.user_b = auth.uid())
  where br.status = 'open'
  and br.expires_at > now()
  and br.requester_id <> auth.uid()
  and p.intent_visibility = 'friends_and_matches'
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
