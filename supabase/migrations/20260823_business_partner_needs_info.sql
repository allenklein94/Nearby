-- Business Partner "Request More Information" reviewer state -- explicitly
-- deferred at build time ("skip building... for v1... flagged for later,
-- not built now") when the Business Partner acquisition experience first
-- shipped. Closing it now: a real, additive third reviewer outcome between
-- Approve and Deny, so an admin who genuinely just needs one more field
-- (a real address, a working phone number) isn't forced to deny a
-- salvageable application and make the applicant start a brand-new one.
--
-- Additive to the existing status CHECK -- 'pending'/'approved'/'denied'
-- are all completely unchanged, matching this schema's own established
-- "widen the CHECK, never repurpose a value" convention.
alter table business_partner_requests drop constraint business_partner_requests_status_check;
alter table business_partner_requests add constraint business_partner_requests_status_check
  check (status = any (array['pending', 'approved', 'denied', 'needs_info']));

-- Admin-only. Requires the row still be genuinely pending (same
-- double-review guard every sibling review RPC on this table already
-- uses) and a real, non-empty note -- an admin can't ask for "more
-- information" without saying what's actually missing.
create or replace function request_more_business_partner_info(request_id_param uuid, notes_param text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  service_key text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review business partner requests';
  end if;

  if notes_param is null or trim(notes_param) = '' then
    raise exception 'A note is required so the applicant knows what to add.';
  end if;

  update business_partner_requests
  set status = 'needs_info', reviewed_at = now(), reviewed_by = auth.uid(), admin_notes = notes_param
  where id = request_id_param and status = 'pending'
  returning * into req;

  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', req.requester_id,
      'title', 'We need a bit more information',
      'body', notes_param,
      'data', jsonb_build_object('type', 'business_partner_needs_info', 'request_id', request_id_param)
    )
  );
end;
$$;

revoke all on function request_more_business_partner_info(uuid, text) from public, anon;
grant execute on function request_more_business_partner_info(uuid, text) to authenticated;

-- Requester-only, own row only. Requires the row genuinely be in
-- 'needs_info' (never lets a still-pending or already-reviewed row be
-- silently rewritten out from under an admin mid-review). Deliberately
-- updates the SAME row rather than the deny-and-fresh-INSERT pattern the
-- original v1 deferral leaned on -- this is a genuinely different flow: the
-- application itself wasn't rejected, it just needed one more real field,
-- so preserving the original id/created_at/history is the honest behavior,
-- not a resurrection of a denied decision.
create or replace function resubmit_business_partner_request(
  request_id_param uuid,
  business_name_param text,
  business_description_param text,
  contact_info_param text,
  category_param text,
  website_param text,
  phone_param text,
  address_param text,
  requested_features_param text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update business_partner_requests
  set
    business_name = business_name_param,
    business_description = business_description_param,
    contact_info = contact_info_param,
    category = category_param,
    website = website_param,
    phone = phone_param,
    address = address_param,
    requested_features = requested_features_param,
    status = 'pending'
  where id = request_id_param
    and requester_id = auth.uid()
    and status = 'needs_info';

  if not found then
    raise exception 'Request not found or not awaiting more information';
  end if;
end;
$$;

revoke all on function resubmit_business_partner_request(uuid, text, text, text, text, text, text, text, text[]) from public, anon;
grant execute on function resubmit_business_partner_request(uuid, text, text, text, text, text, text, text, text[]) to authenticated;
