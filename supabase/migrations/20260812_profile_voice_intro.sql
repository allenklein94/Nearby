-- Adds an optional single voice-intro clip to a profile, closing the
-- "voice/video prompt" polish gap noted against competitor dating apps
-- (Hinge-style voice prompts). Scoped deliberately narrow: one clip per
-- profile, not a full voice-prompt-per-question system, and no video
-- (video recording/storage/moderation is a materially larger feature).
--
-- Mirrors the existing `profile-photos` bucket's own RLS shape exactly:
-- own-folder-only for insert/update/delete, and select gated the same
-- way profile photos already are (own folder, or the profile's own
-- photo_verified = true) so this doesn't introduce a laxer visibility
-- rule than photos already have.

alter table public.profiles add column if not exists voice_intro_path text;

insert into storage.buckets (id, name, public)
values ('profile-audio', 'profile-audio', false)
on conflict (id) do nothing;

create policy "Users can upload their own voice intro"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own voice intro"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own voice intro"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view own or verified voice intros"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-audio'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.profiles p
        where p.id::text = (storage.foldername(objects.name))[1]
        and p.photo_verified = true
      )
    )
  );
