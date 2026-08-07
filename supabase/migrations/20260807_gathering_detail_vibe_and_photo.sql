-- Gathering detail redesign, part 1: vibe attributes, a simple timeline, and a
-- host-uploadable cover photo.
--
-- Cover photo is a stored column, not purely derived from `stories` as
-- originally sketched — `stories` are hourly-purged once expired
-- (cron job `delete-expired-stories`), so a gathering more than a day past
-- its last occurrence would have nothing left to derive a hero image from.
-- A host-set cover photo is the reliable primary source; a live (unexpired)
-- story tagged to the gathering/series is still used as a bonus enrichment
-- at read time when present, falling back to a category placeholder.

alter table public.gatherings add column if not exists energy_level smallint;
alter table public.gatherings add column if not exists conversation_level smallint;
alter table public.gatherings add column if not exists group_size_feel smallint;
alter table public.gatherings add column if not exists beginner_friendly boolean not null default true;
alter table public.gatherings add column if not exists timeline_steps jsonb;
alter table public.gatherings add column if not exists cover_photo_path text;

alter table public.gatherings
  drop constraint if exists gatherings_energy_level_range;
alter table public.gatherings
  add constraint gatherings_energy_level_range check (energy_level is null or energy_level between 1 and 5);

alter table public.gatherings
  drop constraint if exists gatherings_conversation_level_range;
alter table public.gatherings
  add constraint gatherings_conversation_level_range check (conversation_level is null or conversation_level between 1 and 5);

alter table public.gatherings
  drop constraint if exists gatherings_group_size_feel_range;
alter table public.gatherings
  add constraint gatherings_group_size_feel_range check (group_size_feel is null or group_size_feel between 1 and 5);

alter table public.gatherings
  drop constraint if exists gatherings_timeline_steps_length;
alter table public.gatherings
  add constraint gatherings_timeline_steps_length check (
    timeline_steps is null or jsonb_array_length(timeline_steps) <= 8
  );

-- No new RLS policy needed: the existing "Hosts can update their own
-- gatherings" policy (using/with check host_id = auth.uid()) already covers
-- every column on the table, these new ones included.

insert into storage.buckets (id, name, public)
values ('gathering-photos', 'gathering-photos', false)
on conflict (id) do nothing;

drop policy if exists "Hosts can upload their own gathering cover photos" on storage.objects;
create policy "Hosts can upload their own gathering cover photos"
  on storage.objects for insert
  with check (
    bucket_id = 'gathering-photos'
    and exists (
      select 1 from public.gatherings g
      where g.host_id = auth.uid()
        and (storage.foldername(name))[1] = g.id::text
    )
  );

drop policy if exists "Hosts can replace their own gathering cover photos" on storage.objects;
create policy "Hosts can replace their own gathering cover photos"
  on storage.objects for update
  using (
    bucket_id = 'gathering-photos'
    and exists (
      select 1 from public.gatherings g
      where g.host_id = auth.uid()
        and (storage.foldername(name))[1] = g.id::text
    )
  );

drop policy if exists "Anyone can view gathering cover photos" on storage.objects;
create policy "Anyone can view gathering cover photos"
  on storage.objects for select
  using (bucket_id = 'gathering-photos');
