-- Business Partner Onboarding enrichment — step 1 of the plan in CLAUDE.md
-- ("Outstanding: Business Partner Onboarding"). Purely additive schema:
-- new nullable columns on business_partner_requests, a status CHECK
-- constraint that didn't exist before, a partial unique index preventing
-- duplicate concurrent pending applications, a bare tier column on
-- brand_partners (no feature-gating logic wired to it yet), and
-- reviewed_by set on both existing review RPCs for real admin auditability.
-- Zero behavior change for the one existing row or any existing caller.

alter table public.business_partner_requests
  add column if not exists category text,
  add column if not exists website text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists requested_features text[],
  add column if not exists admin_notes text,
  add column if not exists reviewed_by uuid references public.profiles(id);

alter table public.business_partner_requests
  add constraint business_partner_requests_status_check
  check (status in ('pending', 'approved', 'denied'));

-- Prevents a user from stacking multiple concurrent pending applications —
-- nothing enforced this before.
create unique index if not exists business_partner_requests_one_pending_idx
  on public.business_partner_requests (requester_id)
  where (status = 'pending');

alter table public.brand_partners
  add column if not exists tier text default 'basic' not null,
  add constraint brand_partners_tier_check check (tier in ('basic', 'growth', 'brand'));

create or replace function public.approve_business_partner_request(request_id_param uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  req record;
  new_partner_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active)
  values (req.business_name, req.business_description, true)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param;

  return new_partner_id;
end;
$function$;

create or replace function public.deny_business_partner_request(request_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can deny business partner requests';
  end if;

  update business_partner_requests
  set status = 'denied', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param and status = 'pending';

  if not found then
    raise exception 'Request not found or already reviewed';
  end if;
end;
$function$;

revoke all on function public.approve_business_partner_request(uuid) from public, anon;
grant execute on function public.approve_business_partner_request(uuid) to authenticated;
revoke all on function public.deny_business_partner_request(uuid) from public, anon;
grant execute on function public.deny_business_partner_request(uuid) to authenticated;
