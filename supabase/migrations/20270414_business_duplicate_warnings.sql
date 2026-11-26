-- Duplicate business details and identical business images, shown to an admin (owner idea 36, 2026-11-12). Staged after
-- 20270413; deploy only with its own approval, together with screen-business-content (same commit). Needs 20270369
-- (private.require_admin, private.clean_case_text) and 20270413 (private.shared_link_destination, the ONE website normalizer).
--
-- Two narrow warnings for the existing admin application review. A warning is evidence for a human, never a judgment:
-- shared ownership, franchises, agencies and licensed stock images are expected matches.
--
--   1. Contact details. Two business applications (any status: pending, needs info, approved = the business, declined) that
--      share a normalized phone number, email address or website. Read at review time from what the applications already
--      hold; NOTHING new is stored about contact details.
--        phone    phone, applicant_phone (web) and phone numbers written in contact_info; digits only, a US leading 1
--                 dropped, 10-15 digits;
--        email    applicant_email (web) and email addresses written in contact_info; lower-cased;
--        website  the website field through private.shared_link_destination (20270413): registrable domain, so
--                 "www.joes.com/menu" = "joes.com"; a shared platform (Yelp, Google Maps, Eventbrite...) is never compared;
--                 a page on Facebook / Instagram counts by its path; one person's subdomain on a site builder stays apart.
--      Same-account matches are returned too, labelled, so an accidental second application by the same person shows.
--   2. Identical images. A business logo or offer photo whose exact bytes (SHA-256, taken by screen-business-content from
--      the file it already downloads for screening, only after a successful screen) are also used by a DIFFERENT business.
--      Reuse within one business never counts. Only media a business is USING counts (its current logo; an offer photo on
--      an unarchived creative, an open or accepted offer, or an active experience). Exact copies only: a re-saved or cropped
--      copy is not detected (perceptual hashes were calibrated on profile photos, not logos or graphics). Videos are not
--      fingerprinted. Customer, profile, chat and story media are never read.
--      Stored: (business, logo/offer_photo, file reference, SHA-256, time). Kept only while that media is in use (purged
--      daily) and deleted with the business. No image, no customer data.
--   3. An admin can mark one match "expected" with a reason (shared owner, franchise, licensed stock image...). It stays
--      listed as dismissed, with who/why/when, and stops counting as a warning. A new business making a new pair shows again.
--
-- Admin only (private.require_admin). Applicants and businesses can call nothing here and never see another application's
-- details. NOTHING here rejects, blocks, delays, hides, restricts, ranks, scores or notifies anyone; approval is unchanged.

-- 1. Identical business media --------------------------------------------------------------------------------------------
create table if not exists private.business_media_fingerprints (
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  kind text not null check (kind in ('logo', 'offer_photo')),
  ref text not null check (length(ref) between 1 and 600),   -- the logo URL, or the offer photo's path in business-offer-media
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  primary key (partner_id, kind, ref)
);
create index if not exists business_media_fingerprints_sha_idx on private.business_media_fingerprints (sha256);
revoke all on private.business_media_fingerprints from public, anon, authenticated;

-- Is this media in use by this business right now?
create or replace function private.business_media_in_use(p_partner uuid, p_kind text, p_ref text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case p_kind
    when 'logo' then exists (select 1 from brand_partners b where b.id = p_partner and b.logo_url = p_ref)
    when 'offer_photo' then
      exists (select 1 from business_creatives c
               where c.partner_id = p_partner and c.media_path = p_ref and c.media_type = 'image' and c.archived_at is null)
      or exists (select 1 from business_request_offers o
                  where o.partner_id = p_partner and o.media_path = p_ref and o.status in ('offered', 'accepted'))
      or exists (select 1 from business_experiences e
                  where e.partner_id = p_partner and e.media_path = p_ref and e.active)
    else false end;
$function$;
revoke all on function private.business_media_in_use(uuid, text, text) from public, anon, authenticated;

-- Called by screen-business-content (service role) after a successful screen of a logo or offer photo.
create or replace function public.record_business_media_fingerprint(p_partner uuid, p_kind text, p_ref text, p_sha256 text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_kind not in ('logo', 'offer_photo') or p_sha256 !~ '^[0-9a-f]{64}$' or coalesce(length(p_ref), 0) not between 1 and 600 then
    raise exception 'Invalid media fingerprint' using errcode = '22023';
  end if;
  if not exists (select 1 from brand_partners where id = p_partner) then return; end if;
  insert into private.business_media_fingerprints (partner_id, kind, ref, sha256)
  values (p_partner, p_kind, p_ref, p_sha256)
  on conflict (partner_id, kind, ref) do update set sha256 = excluded.sha256, recorded_at = now();
end;
$function$;
revoke all on function public.record_business_media_fingerprint(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_business_media_fingerprint(uuid, text, text, text) to service_role;

-- 2. Contact keys of one application (normalized; nothing stored) ---------------------------------------------------------
create or replace function private.business_phone_key(p text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case when length(d) between 10 and 15 then d end
    from (select case when length(x) = 11 and left(x, 1) = '1' then substr(x, 2) else x end as d
            from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as x) a) b;
$function$;
revoke all on function private.business_phone_key(text) from public, anon, authenticated;

create or replace function private.business_application_contact_keys(p_request uuid)
returns table (kind text, key text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with r as (select * from business_partner_requests where id = p_request),
  raw as (
    select 'phone'::text as kind, private.business_phone_key(r.phone) as key from r
    union all select 'phone', private.business_phone_key(r.applicant_phone) from r
    union all select 'phone', private.business_phone_key(m[1])
      from r, regexp_matches(coalesce(r.contact_info, ''), '(\+?[0-9][0-9 ().-]{8,}[0-9])', 'g') m
    union all select 'email', lower(btrim(r.applicant_email)) from r where r.applicant_email ~ '^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$'
    union all select 'email', lower(m[1])
      from r, regexp_matches(coalesce(r.contact_info, ''), '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') m
    union all select 'website', private.shared_link_destination(r.website) from r where nullif(btrim(r.website), '') is not null
  )
  select distinct kind, key from raw where key is not null;
$function$;
revoke all on function private.business_application_contact_keys(uuid) from public, anon, authenticated;

-- 3. Dismissals ("expected, not a duplicate") -----------------------------------------------------------------------------
-- a < b; contact kinds name two applications (business_partner_requests ids), 'media' names two businesses (brand_partners).
create table if not exists private.business_duplicate_dismissals (
  kind text not null check (kind in ('phone', 'email', 'website', 'media')),
  a uuid not null,
  b uuid not null,
  dismissed_by uuid references auth.users(id) on delete set null,
  reason text not null check (length(reason) between 10 and 300),
  dismissed_at timestamptz not null default now(),
  primary key (kind, a, b),
  check (a < b)
);
revoke all on private.business_duplicate_dismissals from public, anon, authenticated;

-- 4. The admin read ------------------------------------------------------------------------------------------------------
-- One row per (subject, other, kind), both directions. subject_type 'application' (contact kinds) or 'business' (media).
create or replace function public.admin_business_duplicate_warnings()
returns table (
  subject_type text, subject_id uuid, match_kind text, subject_media text,
  other_request_id uuid, other_partner_id uuid, other_name text, other_status text, other_media text,
  same_account boolean, dismissed boolean, dismissed_reason text, dismissed_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform private.require_admin();
  return query
  with keys as (
    select r.id, r.requester_id, k.kind, k.key
      from business_partner_requests r, private.business_application_contact_keys(r.id) k
  ),
  contact as (
    select distinct x.id as subject, y.id as other, x.kind, (x.requester_id = y.requester_id) as same_acct
      from keys x join keys y on y.kind = x.kind and y.key = x.key and y.id <> x.id
  ),
  media as (
    select f.partner_id, f.kind, f.sha256 from private.business_media_fingerprints f
     where private.business_media_in_use(f.partner_id, f.kind, f.ref)
  ),
  media_pairs as (
    select x.partner_id as subject, y.partner_id as other,
           string_agg(distinct x.kind, ',') as s_media, string_agg(distinct y.kind, ',') as o_media
      from media x join media y on y.sha256 = x.sha256 and y.partner_id <> x.partner_id
     group by x.partner_id, y.partner_id
  )
  select 'application'::text, c.subject, c.kind, null::text,
         o.id, o.resulting_partner_id, o.business_name, o.status, null::text,
         c.same_acct, d.kind is not null, d.reason, d.dismissed_at
    from contact c
    join business_partner_requests o on o.id = c.other
    left join private.business_duplicate_dismissals d
      on d.kind = c.kind and d.a = least(c.subject, c.other) and d.b = greatest(c.subject, c.other)
  union all
  select 'business'::text, m.subject, 'media'::text, m.s_media,
         null::uuid, m.other, bp.name, case when bp.active then 'active' else 'inactive' end, m.o_media,
         exists (select 1 from business_partner_requests r1 join business_partner_requests r2 on r2.requester_id = r1.requester_id
                  where r1.resulting_partner_id = m.subject and r2.resulting_partner_id = m.other),
         d.kind is not null, d.reason, d.dismissed_at
    from media_pairs m
    join brand_partners bp on bp.id = m.other
    left join private.business_duplicate_dismissals d
      on d.kind = 'media' and d.a = least(m.subject, m.other) and d.b = greatest(m.subject, m.other);
end;
$function$;
revoke all on function public.admin_business_duplicate_warnings() from public, anon;
grant execute on function public.admin_business_duplicate_warnings() to authenticated;

create or replace function public.admin_dismiss_business_duplicate(p_kind text, p_subject uuid, p_other uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.clean_case_text(p_reason, 300, 'reason_too_long');
  v_match boolean;
begin
  if p_kind not in ('phone', 'email', 'website', 'media') then
    raise exception 'Unknown match' using errcode = '22023', hint = 'unknown_match_kind';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Say why this match is expected' using errcode = '22023', hint = 'reason_required';
  end if;
  -- only a real current match can be dismissed
  select exists (select 1 from public.admin_business_duplicate_warnings() w
                  where w.match_kind = p_kind and w.subject_id = p_subject
                    and coalesce(w.other_request_id, w.other_partner_id) = p_other
                    and (p_kind = 'media' or w.other_request_id = p_other)) into v_match;
  if not v_match then
    raise exception 'No such match' using errcode = '22023', hint = 'no_such_match';
  end if;
  insert into private.business_duplicate_dismissals (kind, a, b, dismissed_by, reason)
  values (p_kind, least(p_subject, p_other), greatest(p_subject, p_other), v_admin, v_reason)
  on conflict (kind, a, b) do nothing;
end;
$function$;
revoke all on function public.admin_dismiss_business_duplicate(text, uuid, uuid, text) from public, anon;
grant execute on function public.admin_dismiss_business_duplicate(text, uuid, uuid, text) to authenticated;

-- 5. Retention -------------------------------------------------------------------------------------------------------------
create or replace function private.purge_business_duplicate_records()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.business_media_fingerprints f where not private.business_media_in_use(f.partner_id, f.kind, f.ref);
  delete from private.business_duplicate_dismissals d
   where (d.kind <> 'media' and (not exists (select 1 from business_partner_requests where id = d.a)
                                 or not exists (select 1 from business_partner_requests where id = d.b)))
      or (d.kind = 'media' and (not exists (select 1 from brand_partners where id = d.a)
                                or not exists (select 1 from brand_partners where id = d.b)));
$function$;
revoke all on function private.purge_business_duplicate_records() from public, anon, authenticated;

select cron.schedule('purge-business-duplicate-records', '47 4 * * *', 'select private.purge_business_duplicate_records();');
