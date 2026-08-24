-- "Business moments" (CLAUDE.md, 14-item UX review item 11 + item 13's
-- honest scoped-down version of "going live"): a business can post a real
-- photo/video moment reusing the exact existing `stories` infrastructure
-- (storage bucket, signed-URL pattern, 24h expiry) rather than a new
-- schema/table -- the underlying job ("what's actually happening near me
-- right now") is the same one gathering-linked stories already serve, so
-- this is additive to the same object, not a parallel system. Deliberately
-- NOT real live video streaming (needs a real paid CDN/ingest vendor, out
-- of scope, see CLAUDE.md) -- a business moment is a real photo/video post
-- with a real, honest expiry, the same shape a person's own public story
-- already has.

alter table stories add column if not exists partner_id uuid references brand_partners(id) on delete cascade;

create index if not exists stories_partner_id_idx on stories(partner_id) where partner_id is not null;

-- INSERT: still "auth.uid() = user_id" (the business owner uploads as
-- themself, into their own storage folder, unchanged) -- but now also
-- requires, when partner_id is set, that the caller genuinely manages
-- that business. Without this, any authenticated user could set
-- partner_id to an arbitrary business and post on its behalf.
drop policy if exists "Users can post their own stories" on stories;
create policy "Users can post their own stories" on stories
  for insert
  with check (
    auth.uid() = user_id
    and (
      partner_id is null
      or exists (select 1 from profiles where profiles.id = auth.uid() and profiles.managed_partner_id = stories.partner_id)
    )
  );

-- SELECT: a business moment is a real promotional/public post -- visible
-- to everyone nearby, the same "is_public" semantic a person's own public
-- story already has, additive to the existing friends/matches/gathering
-- visibility rules (none of those are removed).
drop policy if exists "Visible to poster, matches, friends, fellow attendees, host, or" on stories;
create policy "Visible to poster, matches, friends, fellow attendees, host, or" on stories
  for select
  using (
    not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = stories.user_id)
         or (b.blocker_id = stories.user_id and b.blocked_id = auth.uid())
    )
    and (
      is_public = true
      or partner_id is not null
      or user_id = auth.uid()
      or exists (select 1 from matches m where (m.user_a = auth.uid() and m.user_b = stories.user_id) or (m.user_a = stories.user_id and m.user_b = auth.uid()))
      or exists (select 1 from friendships f where f.status = 'accepted' and ((f.user_a = auth.uid() and f.user_b = stories.user_id) or (f.user_a = stories.user_id and f.user_b = auth.uid())))
      or (
        gathering_id is not null
        and (
          exists (select 1 from gathering_interest gi where gi.gathering_id = stories.gathering_id and gi.user_id = auth.uid() and gi.status = 'approved')
          or exists (select 1 from gatherings g where g.id = stories.gathering_id and g.host_id = auth.uid())
        )
      )
    )
  );

-- storage.objects independently re-checks the same visibility logic
-- against the matching `stories` row (the actual media file's own SELECT
-- policy), so it needs the identical partner_id addition or a business
-- moment's row would be visible while its media stayed unreachable.
drop policy if exists "Story media visible to poster, matches, friends, fellow attende" on storage.objects;
create policy "Story media visible to poster, matches, friends, fellow attende" on storage.objects
  for select
  using (
    bucket_id = 'stories'
    and exists (
      select 1 from stories s
      where s.media_path = objects.name
        and not exists (
          select 1 from blocks b
          where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
             or (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
        )
        and (
          s.is_public = true
          or s.partner_id is not null
          or s.user_id = auth.uid()
          or exists (select 1 from matches m where (m.user_a = auth.uid() and m.user_b = s.user_id) or (m.user_a = s.user_id and m.user_b = auth.uid()))
          or exists (select 1 from friendships f where f.status = 'accepted' and ((f.user_a = auth.uid() and f.user_b = s.user_id) or (f.user_a = s.user_id and f.user_b = auth.uid())))
          or (
            s.gathering_id is not null
            and (
              exists (select 1 from gathering_interest gi where gi.gathering_id = s.gathering_id and gi.user_id = auth.uid() and gi.status = 'approved')
              or exists (select 1 from gatherings g where g.id = s.gathering_id and g.host_id = auth.uid())
            )
          )
        )
    )
  );
