-- Fixes a real double-review gap found while triaging the PRODUCT_AUDIT
-- changelog's "AdminBusinessRequestsScreen Approve/Deny integrity
-- asymmetry" item (#22, still present as of the 2026-08-09 refresh).
--
-- approve_business_partner_request() never checked the request was still
-- 'pending' before running — two admins approving the same request
-- concurrently, or a single retried call, would create a SECOND
-- brand_partners row, re-link the requester's managed_partner_id, and
-- re-attach their gatherings/communities a second time. Fixed by adding the
-- same `status = 'pending'` guard this codebase's other admin-review RPCs
-- already use (see admin_approve_id_verification).
--
-- handleDeny() on the client did a raw `.update()` directly on
-- business_partner_requests. Live RLS confirmed this was never a security
-- hole (the table's only UPDATE policy is admin-only, `is_admin = true`),
-- but it had the identical missing double-review guard and no real
-- consistency with the approve path. New deny_business_partner_request()
-- RPC gives it the same admin check + pending guard as approve, so both
-- actions go through the same shape instead of one being an RPC and the
-- other a raw table write with different guarantees.

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
  set status = 'approved', reviewed_at = now()
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
  set status = 'denied', reviewed_at = now()
  where id = request_id_param and status = 'pending';

  if not found then
    raise exception 'Request not found or already reviewed';
  end if;
end;
$function$;

revoke all on function public.deny_business_partner_request(uuid) from public, anon;
grant execute on function public.deny_business_partner_request(uuid) to authenticated;
