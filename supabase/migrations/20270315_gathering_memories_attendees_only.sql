-- Item 122 (owner, 2026-10-16, LOCKED): a completed gathering can keep "memories" (photos the host and approved attendees
-- choose to add), and ONLY the people who were there can see them. A friendship or Dating match with the poster no longer
-- grants access to a gathering-linked photo. Enforced here, in the authorization itself, not in any screen:
--   1. viewer_was_at_gathering(g): the one rule (the host, or an approved attendee). Read by the policies below.
--   2. stories SELECT: a gathering-linked story = poster + viewer_was_at_gathering only (is_public, matches, friends ignored);
--      any other story keeps its rule, now only while unexpired (so a photo whose gathering was deleted, gathering_id set
--      null by the FK, never turns into a story for the poster's friends; the purge then removes it). Blocks either way
--      via viewer_blocked_either_way (was an inline `from blocks`).
--   3. stories INSERT: a story can be attached to a gathering only by someone who was there (before: anyone, any gathering).
--   4. storage (bucket 'stories') SELECT: the media follows its row's visibility, i.e. the stories rule above, never a copy.
--   5. get_public_stories_with_fuzzed_coords: never a gathering-linked story.
--   6. notify_new_story: no "posted a new story" push to friends/matches for a gathering-linked story, and a memory never
--      counts as "already posted today" for a later ordinary story.

create or replace function public.viewer_was_at_gathering(p_gathering uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null
     and p_gathering is not null
     and (
       exists (select 1 from gatherings g where g.id = p_gathering and g.host_id = auth.uid())
       or exists (select 1 from gathering_interest gi where gi.gathering_id = p_gathering and gi.user_id = auth.uid() and gi.status = 'approved')
     );
$$;
revoke all on function public.viewer_was_at_gathering(uuid) from public, anon;
grant execute on function public.viewer_was_at_gathering(uuid) to authenticated, service_role;

drop policy if exists "Visible to poster, matches, friends, fellow attendees, host, or" on public.stories;
drop policy if exists "Stories visible to poster, connections or the people there" on public.stories;
create policy "Stories visible to poster, connections or the people there"
  on public.stories
  for select
  to authenticated
  using (
    not public.viewer_blocked_either_way(stories.user_id)
    and (
      stories.user_id = auth.uid()
      or (stories.gathering_id is not null and public.viewer_was_at_gathering(stories.gathering_id))
      or (
        stories.gathering_id is null
        and stories.expires_at > now()
        and (
          stories.is_public = true
          or stories.partner_id is not null
          or exists (select 1 from matches m where (m.user_a = auth.uid() and m.user_b = stories.user_id) or (m.user_a = stories.user_id and m.user_b = auth.uid()))
          or exists (select 1 from friendships f where f.status = 'accepted' and ((f.user_a = auth.uid() and f.user_b = stories.user_id) or (f.user_a = stories.user_id and f.user_b = auth.uid())))
        )
      )
    )
  );

drop policy if exists "Users can post their own stories" on public.stories;
create policy "Users can post their own stories"
  on public.stories
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (partner_id is null or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.managed_partner_id = stories.partner_id))
    and (gathering_id is null or public.viewer_was_at_gathering(gathering_id))
  );

drop policy if exists "Story media visible to poster, matches, friends, fellow attende" on storage.objects;
drop policy if exists "Story media follows its story's visibility" on storage.objects;
create policy "Story media follows its story's visibility"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'stories'
    and exists (select 1 from public.stories s where s.media_path = objects.name)
  );

create or replace function public.get_public_stories_with_fuzzed_coords()
returns table(id uuid, user_id uuid, media_path text, media_type text, created_at timestamp with time zone, expires_at timestamp with time zone, fuzzed_lat double precision, fuzzed_lng double precision)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    s.id, s.user_id, s.media_path, s.media_type, s.created_at, s.expires_at,
    s.latitude + (((('x' || substr(md5(s.id::text || 'lat'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lat,
    s.longitude + (((('x' || substr(md5(s.id::text || 'lng'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lng
  from stories s
  where s.is_public = true
  and s.gathering_id is null
  and s.expires_at > now()
  and s.latitude is not null
  and s.longitude is not null
  and not public.viewer_blocked_either_way(s.user_id);
$$;

create or replace function public.notify_new_story()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  poster_name text;
  recipient record;
  already_posted_today boolean;
  poster_timezone text;
  poster_today_start timestamptz;
begin
  -- Item 122: a gathering memory is seen only by the people who were there; never announced to friends or matches.
  if new.gathering_id is not null then
    return new;
  end if;

  select coalesce(timezone, 'UTC') into poster_timezone from profiles where id = new.user_id;

  -- "Today" is now computed in the poster's own timezone, not the
  -- server's UTC default — same pattern already fixed for the daily
  -- AI/browse limits and birthday reminders.
  begin
    poster_today_start := date_trunc('day', now() at time zone poster_timezone) at time zone poster_timezone;
  exception when others then
    poster_today_start := date_trunc('day', now());
  end;

  select exists(
    select 1 from stories
    where user_id = new.user_id
    and id != new.id
    and gathering_id is null
    and created_at > poster_today_start
  ) into already_posted_today;

  if already_posted_today then
    return new;
  end if;

  select display_name into poster_name from profiles where id = new.user_id;

  for recipient in
    select case when m.user_a = new.user_id then m.user_b else m.user_a end as recipient_id
    from matches m
    where m.user_a = new.user_id or m.user_b = new.user_id
    union
    select case when f.user_a = new.user_id then f.user_b else f.user_a end as recipient_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.user_id or f.user_b = new.user_id)
  loop
    if coalesce((select notify_social from profiles where id = recipient.recipient_id), true) then
      perform public._send_push(recipient.recipient_id, 'New Story', coalesce(poster_name, 'Someone') || ' posted a new story.', jsonb_build_object('type', 'new_story', 'story_user_id', new.user_id));
    end if;
  end loop;
  return new;
end;
$$;
