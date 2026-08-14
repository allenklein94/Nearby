-- Product-critique follow-through, Aug 14 2026 (CLAUDE.md's "skeptical
-- first-time-user critique" section, recommendation 3). A Tier 2 result
-- ("{name} is also looking for this") tapped through to a bare
-- ViewProfile with no way to actually act on the shared ask --
-- ViewProfileScreen has no Message/Chat entry point of its own, only Add
-- Friend, which doesn't apply since the connection is already an
-- accepted friend or match. Rather than bolt on a "Message" button that
-- doesn't actually work for every connection (a plain accepted
-- friendship has no messages/matches row behind it at all -- only a real
-- dating match does), this closes the gap honestly: the RPC now also
-- returns whether a real matches row exists between the caller and the
-- requester, so the client can offer a real Message action only when one
-- is genuinely possible, and fall back to View Profile alone otherwise --
-- communicating what's actually available instead of a broken promise.
--
-- Same argument signature as 20260814_business_fulfillment_tier2_
-- weekend_range.sql (category_param/date_start_param/date_end_param),
-- but the return shape changes (a new match_id column), which Postgres
-- doesn't allow via a plain CREATE OR REPLACE -- drop + create, same
-- discipline as the weekend-range migration before this one.

drop function if exists public.get_connected_open_business_requests(text, date, date);

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
