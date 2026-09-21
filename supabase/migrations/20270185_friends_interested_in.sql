-- "Friends who like Coffee" (owner sign-off, 2026-09-21). For each requested interest tag, how many of the CALLER'S accepted
-- friends declared it (profiles.interests), plus up to two names. Accepted friendships only (never a dating match or a stranger),
-- never across a block in either direction, never the caller. Returns only tags with at least one friend. Counts and first
-- names only -- no ids, no other interests, no location. Input is capped (20 tags).
create or replace function public.get_friends_interested_in(tags_param text[])
returns table (tag text, friend_count integer, sample_names text[])
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as id),
  friends as (
    select case when f.user_a = me.id then f.user_b else f.user_a end as fid
    from friendships f, me
    where me.id is not null and f.status = 'accepted' and (f.user_a = me.id or f.user_b = me.id)
  ),
  ok as (
    select fr.fid, p.display_name, p.interests
    from friends fr
    join profiles p on p.id = fr.fid
    where not exists (
      select 1 from blocks b, me
      where (b.blocker_id = me.id and b.blocked_id = fr.fid) or (b.blocker_id = fr.fid and b.blocked_id = me.id)
    )
  ),
  wanted as (select distinct t from (select t from unnest(coalesce(tags_param, array[]::text[])) as t limit 20) x)
  select w.t as tag,
         count(*)::integer as friend_count,
         (array_agg(o.display_name order by o.display_name) filter (where nullif(btrim(o.display_name), '') is not null))[1:2] as sample_names
  from wanted w
  join ok o on w.t = any (coalesce(o.interests, array[]::text[]))
  group by w.t;
$$;
revoke all on function public.get_friends_interested_in(text[]) from public, anon;
grant execute on function public.get_friends_interested_in(text[]) to authenticated;
