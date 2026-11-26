-- Stories security + launch media policy (owner, 2026-11-05; PRODUCT_AUDIT/PUBLIC_MEDIA_AUDIT_2026-11-05.md). Staged after
-- 20270389; own deploy approval. TEMPORARY restrictions, never a removal: every column, viewer and map path is kept.
--
-- Defects fixed whatever the policy:
--  1. Ownership: a Story could name another person's file, and the storage read rule then followed that Story, so the file
--     opened to its audience; delete_expired_stories would also have deleted that file at expiry. media_path must now sit in the
--     poster's own folder (hint story_media_not_yours), and the storage read rule itself requires it, so an older row can't.
--  2. Expiry: created_at and expires_at are set by the server, always 24 h; a sent value is ignored.
--  3. Media type: image or video only (check constraint). Both buckets take photos only, at most 10 MB. This is the declared
--     type: mislabelled bytes pass the bucket but aren't playable, because viewers play only media_type 'video'.
--  4. Phone: posting needs a verified phone (the 20270352 trigger).
--  5. Clients lose the UPDATE grant: no policy allowed an update anyway.
--
-- Launch policy, ONE settings row, all off, no client access (owner decisions 1 + 3):
--  public Stories refused, friends-only Stories refused (both hint stories_paused), every Story video refused, gathering
--  memories included (hint story_video_paused). Friends-only photos turn on only by a separate approved migration, after these
--  protections are verified and a working report path exists. Gathering memory PHOTOS stay on (host + approved attendees only).
--  A memory is never public (is_public forced false). Business Moments keep 20270388 + 20270389.
--  Live personal Stories are ended now. The migration refuses to run if a video memory exists, since those never expire
--  (production held 0 stories, read-only check 2026-11-05).
--
-- Gathering covers (owner decision 4): kept as a feature, never shown unreviewed. Only the host can read the file until
-- screening exists; anyone else gets a refused signed URL, which every surface already treats as "no cover": the existing
-- category imagery. Showing covers again = a separate approved migration after screening exists.

do $$
begin
  if exists (select 1 from public.stories where gathering_id is not null and media_type <> 'image') then
    raise exception 'A non-photo gathering memory exists: review it before applying 20270390.';
  end if;
end $$;

create table if not exists private.story_media_settings (
  id boolean primary key default true check (id),
  public_stories_enabled boolean not null default false,
  friends_stories_enabled boolean not null default false,
  story_video_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.story_media_settings (id) values (true) on conflict (id) do nothing;
revoke all on private.story_media_settings from public, anon, authenticated;

alter table public.stories add constraint stories_media_type_check check (media_type in ('image', 'video'));

create or replace function private._story_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v private.story_media_settings%rowtype;
begin
  select * into v from private.story_media_settings where id;

  new.created_at := now();
  new.expires_at := now() + interval '24 hours';

  if new.media_path !~ ('^' || new.user_id::text || '/[^/]+$') then
    raise exception 'That file can''t be used for this story.' using hint = 'story_media_not_yours';
  end if;

  if new.gathering_id is not null then
    new.is_public := false;
  end if;

  -- Business Moments are decided by 20270388 + 20270389
  if new.partner_id is not null then
    return new;
  end if;

  if new.media_type = 'video' and not coalesce(v.story_video_enabled, false) then
    raise exception 'Video stories aren''t available yet.' using hint = 'story_video_paused';
  end if;

  if new.gathering_id is null then
    if coalesce(new.is_public, false) then
      if not coalesce(v.public_stories_enabled, false) then
        raise exception 'Public stories aren''t available yet.' using hint = 'stories_paused';
      end if;
    elsif not coalesce(v.friends_stories_enabled, false) then
      raise exception 'Stories aren''t available yet.' using hint = 'stories_paused';
    end if;
  end if;

  return new;
end;
$function$;
revoke all on function private._story_rules() from public, anon, authenticated;

drop trigger if exists ac_story_rules on public.stories;
create trigger ac_story_rules before insert on public.stories
  for each row execute function private._story_rules();

drop trigger if exists zz_require_verified_phone on public.stories;
create trigger zz_require_verified_phone before insert on public.stories
  for each row execute function public._require_verified_phone();

revoke update on public.stories from authenticated, anon;

drop policy if exists "Story media follows its story's visibility" on storage.objects;
create policy "Story media follows its story's visibility" on storage.objects
  for select to authenticated
  using (bucket_id = 'stories' and exists (
    select 1 from public.stories s
    where s.media_path = objects.name and s.user_id::text = (storage.foldername(objects.name))[1]));

drop policy if exists "Gathering cover photos visible to who may see the gathering" on storage.objects;
drop policy if exists "Gathering covers visible to the host until screening exists" on storage.objects;
create policy "Gathering covers visible to the host until screening exists" on storage.objects
  for select to authenticated
  using (bucket_id = 'gathering-photos' and exists (
    select 1 from public.gatherings g
    where g.id = public._uuid_or_null((storage.foldername(objects.name))[1]) and g.host_id = auth.uid()));

update storage.buckets
  set file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  where id in ('stories', 'gathering-photos');

update public.stories set expires_at = now()
  where gathering_id is null and partner_id is null and expires_at > now();
