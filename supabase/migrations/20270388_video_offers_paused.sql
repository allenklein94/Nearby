-- Video offers paused for the first launch (owner, 2026-11-02: Option A, a TEMPORARY safeguard, never a removal).
-- Staged after 20270387; deploy only with its own approval, and live + verified BEFORE any outside business is onboarded.
--
-- Why: a business video is screened only through 1-3 still frames the business's own phone supplies (never extracted by
-- the server), with no audio check, and a reviewer sees only the first frame. A modified client can pair harmless frames
-- with any video. Until real video moderation exists (server-generated frames, audio transcription + screening, OCR /
-- contact-detail checks on both, full playback with audio for admin review), no NEW business video may reach a customer.
--
-- What: ONE switch `private.business_video_settings.enabled` (false; no client access). While it is false the database
-- refuses a video on every customer-facing business write path, whoever calls (app, screening function, direct API,
-- admin review function):
--   * business_request_offers: a reply gaining a video (insert, or an update that sets / changes a video);
--   * business_creatives: a video library item (insert, or an update that sets / changes a video, or makes one 'ready');
--   * business_experiences: an experience gaining a video;
--   * stories with a partner_id (Business Moments): the app inserts these directly, with no screening at all, and every
--     signed-in user can read them, so without this row the pause would not hold. A person's own story (partner_id null) is
--     not a business video and is unchanged.
-- Refusal: P0001 'Video offers aren''t available yet. Attach a photo instead.' (moments: 'Video moments aren''t available
-- yet. Post a photo instead.') HINT 'business_video_paused'.
-- Kept, untouched: images, text, every video column, the 30 s length gate (20270289), business_video_checks, storage,
-- the client video picker and player (a later build may hide the picker; not required for enforcement). Existing rows:
-- production holds 0 business videos on all four tables (read-only check 2026-11-05), so nothing existing is refused or
-- hidden; an unrelated update of a row that already carries a video is never refused.
-- Re-enabling = a separate, owner-approved migration setting enabled = true, only after the moderation above is built and
-- tested. `public.business_video_enabled()` lets the screening function refuse early (service role only).

create table if not exists private.business_video_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.business_video_settings (id, enabled) values (true, false) on conflict (id) do nothing;
revoke all on private.business_video_settings from public, anon, authenticated;

create or replace function public.business_video_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select enabled from private.business_video_settings where id), false);
$$;
revoke all on function public.business_video_enabled() from public, anon, authenticated;
grant execute on function public.business_video_enabled() to service_role;

create or replace function private._refuse_paused_business_video()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.media_type is distinct from 'video' then
    return new;
  end if;
  if tg_table_name = 'stories' and to_jsonb(new)->>'partner_id' is null then
    return new;
  end if;
  -- an update that doesn't add or change the video (or make a creative ready, or turn a story into a moment) is never refused
  if tg_op = 'UPDATE'
     and new.media_type is not distinct from old.media_type
     and new.media_path is not distinct from old.media_path
     and (tg_table_name <> 'business_creatives' or to_jsonb(new)->>'status' is not distinct from to_jsonb(old)->>'status')
     and (tg_table_name <> 'stories' or to_jsonb(new)->>'partner_id' is not distinct from to_jsonb(old)->>'partner_id') then
    return new;
  end if;
  if public.business_video_enabled() then
    return new;
  end if;
  if tg_table_name = 'stories' then
    raise exception 'Video moments aren''t available yet. Post a photo instead.' using hint = 'business_video_paused';
  end if;
  raise exception 'Video offers aren''t available yet. Attach a photo instead.' using hint = 'business_video_paused';
end;
$function$;
revoke all on function private._refuse_paused_business_video() from public, anon, authenticated;

drop trigger if exists aa_business_video_paused on public.business_request_offers;
create trigger aa_business_video_paused
  before insert or update of media_type, media_path on public.business_request_offers
  for each row execute function private._refuse_paused_business_video();

drop trigger if exists aa_business_video_paused on public.business_creatives;
create trigger aa_business_video_paused
  before insert or update of media_type, media_path, status on public.business_creatives
  for each row execute function private._refuse_paused_business_video();

drop trigger if exists aa_business_video_paused on public.business_experiences;
create trigger aa_business_video_paused
  before insert or update of media_type, media_path on public.business_experiences
  for each row execute function private._refuse_paused_business_video();

drop trigger if exists aa_business_video_paused on public.stories;
create trigger aa_business_video_paused
  before insert or update of media_type, media_path, partner_id on public.stories
  for each row execute function private._refuse_paused_business_video();
