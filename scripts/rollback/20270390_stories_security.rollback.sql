-- Rollback of 20270390 (Stories security + launch media policy). Reopens the file-ownership and expiry defects and shows
-- unreviewed covers to viewers again, so it is only for a defect in this migration itself; owner decides. Stories it ended stay
-- ended; the bucket limits return to none.
drop trigger if exists ac_story_rules on public.stories;
drop trigger if exists zz_require_verified_phone on public.stories;
drop function if exists private._story_rules();
drop table if exists private.story_media_settings;
alter table public.stories drop constraint if exists stories_media_type_check;
grant update on public.stories to authenticated;

drop policy if exists "Story media follows its story's visibility" on storage.objects;
create policy "Story media follows its story's visibility" on storage.objects
  for select to authenticated
  using (bucket_id = 'stories' and exists (select 1 from public.stories s where s.media_path = objects.name));

drop policy if exists "Gathering covers visible to the host until screening exists" on storage.objects;
create policy "Gathering cover photos visible to who may see the gathering" on storage.objects
  for select
  using (bucket_id = 'gathering-photos' and exists (
    select 1 from public.gatherings g where g.id = public._uuid_or_null((storage.foldername(objects.name))[1])));

update storage.buckets set file_size_limit = null, allowed_mime_types = null where id in ('stories', 'gathering-photos');
