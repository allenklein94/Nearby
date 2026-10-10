-- Business creative library uploads + logo upload (owner, 2026-10-10, LOCKED scope).
--
-- 1. "Your photos & videos": an approved business can add media it already has (photos, videos, graphics, offer images) to
--    its creative library without sending an offer. Each upload goes through the SAME screening as offer media
--    (screen-business-content, target_type 'creative'): Reviewing... -> Ready to use, or Needs changes (with the reason).
--    Only 'ready', non-archived items can be attached to an offer (offer form picker AND this database).
-- 2. Logo upload: the logo is a file Nearby stores (public bucket business-logos, write-once), never a typed external URL,
--    so the screened image cannot change after approval. Offer surfaces still show it only through
--    get_screened_business_logos (20270287), which now also requires the logo to be one of these stored files.
-- 3. Write-once offer media: the old UPDATE policy on business-offer-media let an owner overwrite a file in place, so an
--    already-screened creative could be swapped for different content. Nothing in the app overwrites (every upload uses a
--    new name), so the policy is removed.

-- ---- 1. Library status ---------------------------------------------------------------------------------------------------
alter table public.business_creatives
  add column if not exists status text not null default 'ready',
  add column if not exists matched_categories text[] not null default '{}',
  add column if not exists problem text,
  add column if not exists screening_id uuid references public.business_content_screening_results(id) on delete set null,
  add column if not exists source text not null default 'offer',
  add column if not exists reviewing_since timestamptz,
  add column if not exists frame_paths text[] not null default '{}';

alter table public.business_creatives drop constraint if exists business_creatives_status_check;
alter table public.business_creatives add constraint business_creatives_status_check
  check (status in ('reviewing', 'ready', 'needs_changes', 'retry'));
alter table public.business_creatives drop constraint if exists business_creatives_source_check;
alter table public.business_creatives add constraint business_creatives_source_check
  check (source in ('offer', 'library'));
alter table public.business_creatives drop constraint if exists business_creatives_frames_max;
alter table public.business_creatives add constraint business_creatives_frames_max check (cardinality(frame_paths) <= 3);
alter table public.business_creatives drop constraint if exists business_creatives_problem_length;
alter table public.business_creatives add constraint business_creatives_problem_length
  check (problem is null or char_length(problem) <= 300);

-- A creative is screened as target_type 'creative'.
alter table public.business_content_screening_results drop constraint if exists business_content_screening_results_target_type_check;
alter table public.business_content_screening_results add constraint business_content_screening_results_target_type_check
  check (target_type in ('business_profile', 'offer', 'experience', 'availability', 'update', 'offer_response', 'creative'));

-- A reviewer's decision on a held creative moves it out of Reviewing... (admin_review_business_content_screening only
-- records the outcome for this type; this trigger is the one place the library follows it).
create or replace function public._creative_follows_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.target_type = 'creative' and new.review_outcome is distinct from old.review_outcome and new.review_outcome is not null then
    update business_creatives
       set status = case when new.review_outcome = 'approved' then 'ready' else 'needs_changes' end,
           matched_categories = case when new.review_outcome = 'approved' then '{}'::text[] else coalesce(new.matched_categories, '{}') end
     where screening_id = new.id and status = 'reviewing';
  end if;
  return new;
end;
$$;
revoke all on function public._creative_follows_review() from public, anon, authenticated;

drop trigger if exists creative_follows_review on public.business_content_screening_results;
create trigger creative_follows_review
  after update of review_outcome on public.business_content_screening_results
  for each row execute function public._creative_follows_review();

-- Only a ready, non-archived creative of the SAME business can be attached to an offer, whatever path writes the offer.
create or replace function public._offer_creative_must_be_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  if new.creative_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.creative_id is not distinct from old.creative_id then return new; end if;
  select (c.status = 'ready' and c.archived_at is null and c.partner_id = new.partner_id) into v_ok
    from business_creatives c where c.id = new.creative_id;
  if not coalesce(v_ok, false) then
    raise exception 'That saved photo or video is not ready to use yet.';
  end if;
  return new;
end;
$$;
revoke all on function public._offer_creative_must_be_ready() from public, anon, authenticated;

drop trigger if exists offer_creative_must_be_ready on public.business_request_offers;
create trigger offer_creative_must_be_ready
  before insert or update of creative_id on public.business_request_offers
  for each row execute function public._offer_creative_must_be_ready();

-- ---- 2. Logo files -------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Business owners can upload their own logo" on storage.objects;
create policy "Business owners can upload their own logo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-logos'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.managed_partner_id::text = (storage.foldername(objects.name))[1]
    )
  );
-- No UPDATE or DELETE policy: a stored logo file never changes after it was screened (a new logo = a new file).

create or replace function public.get_screened_business_logos(partner_ids uuid[])
returns table (partner_id uuid, logo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select bp.id, bp.logo_url
  from brand_partners bp
  join lateral (
    select s.risk_tier, s.review_outcome
    from business_content_screening_results s
    where s.partner_id = bp.id
      and s.target_type = 'business_profile'
      and s.content_snapshot->>'logoScreened' = 'true'
      and s.content_snapshot->>'logoUrl' = bp.logo_url
    order by s.created_at desc, s.id desc
    limit 1
  ) latest on true
  where auth.uid() is not null
    and bp.id = any (partner_ids[1:50])
    and bp.active
    and bp.logo_url is not null
    -- a file Nearby stores for THIS business (2026-10-10 logo upload), never an external address
    and position('/storage/v1/object/public/business-logos/' || bp.id::text || '/' in bp.logo_url) > 0
    and (
      latest.review_outcome = 'approved'
      or (latest.review_outcome is null and latest.risk_tier = 'low')
    );
$$;
revoke all on function public.get_screened_business_logos(uuid[]) from public, anon;
grant execute on function public.get_screened_business_logos(uuid[]) to authenticated;

-- ---- 3. Write-once offer media -------------------------------------------------------------------------------------------
drop policy if exists "Business owners can replace their own offer media" on storage.objects;
