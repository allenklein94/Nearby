-- Business logos on offer surfaces (owner, 2026-10-10): the offer card, the arrival pill and the owner's customer preview
-- show the business's logo, but ONLY a logo whose image was actually classified by screen-business-content and approved.
--
-- Why a function and not a plain read of brand_partners.logo_url: that column alone does not prove screening.
--   * update_business_profile is client-executable for the owner, so a logo can be written without the edge function;
--   * screen-business-content classifies the image only when the logo CHANGED, so a later text-only edit records a
--     screening row that carries the same logoUrl without the image ever having been looked at.
-- From this migration on, screen-business-content records "logoScreened": true in the audit snapshot exactly when it ran
-- the image classifier on that logoUrl. A logo is shown only when the LATEST such classified row for that exact URL is
-- approved: risk tier low with no review outcome, or a reviewer's 'approved'. Pending (medium/uncertain), denied and
-- auto_blocked mean no logo. Rows written before this migration carry no marker, so older logos stay hidden until the
-- owner saves the logo again (production: 1 business, 0 logos).
--
-- Known limit, inherited from the existing design: the logo is an owner-supplied URL, so what the host serves could change
-- after it was classified. Nothing here changes that.
--
-- No table or column change. Returns only (partner_id, logo_url); never screening details.

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
    and (
      latest.review_outcome = 'approved'
      or (latest.review_outcome is null and latest.risk_tier = 'low')
    );
$$;

revoke all on function public.get_screened_business_logos(uuid[]) from public, anon;
grant execute on function public.get_screened_business_logos(uuid[]) to authenticated;
