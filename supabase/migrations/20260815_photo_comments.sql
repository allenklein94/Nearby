-- Photo comments: a real way to comment on a specific person's picture,
-- confirmed absent anywhere in this codebase before this migration.
--
-- Attaches to a photo by (photo_owner_id, photo_ref) rather than a normal
-- FK, because a profile's "main" photo (profiles.photo_url) has no id of
-- its own to reference -- only the profile_photos table's rows do. The
-- client already treats 'main' as a stable sentinel id for the main photo
-- (see ViewProfileScreen.js's photos array construction: {id: 'main', ...}
-- for the main photo, the real profile_photos.id for every extra photo) --
-- photo_ref reuses that exact same value, so no second id scheme is
-- invented. photo_owner_id is a real FK (whose photo this is); photo_ref
-- is deliberately plain text, not a FK, since it can point at either a row
-- in profile_photos or the sentinel 'main'.
create table if not exists public.photo_comments (
  id uuid primary key default gen_random_uuid(),
  photo_owner_id uuid not null references public.profiles(id) on delete cascade,
  photo_ref text not null,
  commenter_id uuid not null references public.profiles(id) on delete cascade,
  comment_text text not null,
  created_at timestamptz not null default now()
);

alter table public.photo_comments enable row level security;

-- Visibility/write access both use the same is_blocked() SECURITY DEFINER
-- helper every other cross-user table in this schema already relies on
-- (matches, messages, notices, sightings, business_messages) -- a blocked
-- pair can neither see nor post comments on each other's photos, in
-- either direction, matching that helper's own internal
-- "only answers for a pair involving auth.uid()" guard.
create policy "Not-blocked users can view photo comments"
  on public.photo_comments
  for select
  using (not is_blocked(auth.uid(), photo_owner_id));

create policy "Not-blocked users can comment on a photo"
  on public.photo_comments
  for insert
  with check (commenter_id = auth.uid() and not is_blocked(auth.uid(), photo_owner_id));

-- Either the commenter or the photo's own owner can remove a comment --
-- the owner gets a real, if lightweight, moderation lever over their own
-- photo's comment thread, matching this schema's general posture that a
-- resource owner can manage content attached to something they own.
create policy "Commenter or photo owner can delete a comment"
  on public.photo_comments
  for delete
  using (commenter_id = auth.uid() or photo_owner_id = auth.uid());

create index if not exists photo_comments_photo_idx
  on public.photo_comments (photo_owner_id, photo_ref, created_at);

-- Same defense-in-depth posture as intent_outcomes/intent_submissions --
-- stricter than this schema's older personal-record tables, zero behavior
-- change for a real authenticated caller.
revoke all on public.photo_comments from anon;
