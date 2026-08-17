-- Business Partner acquisition experience, Milestone 7 (see CLAUDE.md): a real,
-- previously-undiscovered gap found during the "consumer-side connectivity trace"
-- adversarial review pass -- does the applied business's profile/offer/LOCATION
-- genuinely show up correctly to a real consumer?
--
-- It didn't. `searchPlacesByText()` (Milestone 2's own real Google Places search)
-- already returns a real `latitude`/`longitude` per result, but
-- BusinessPartnerApplyScreen.js's `confirmPlace()` never captured them into
-- component state, `business_partner_requests` had no columns to store them even
-- if it had, and `approve_business_partner_request()` never copied even the real
-- `address` text field it DOES already have onto the new `brand_partners` row --
-- only `name`/`description`/`category` ever made it across. Net effect: every
-- business approved through the real, built, "streamlined" apply flow landed with
-- `address`/`latitude`/`longitude` all null -- invisible on the map layer
-- (`getNearbyBusinesses()` filters on real coordinates) and, more seriously,
-- structurally unreachable by the entire Business Fulfillment marketplace
-- (`_business_request_fanout()`/`_match_request_to_availability()` are both
-- radius/distance-based over `brand_partners.latitude/longitude`) until the owner
-- manually re-entered their address a second time via the dashboard's Edit
-- Profile flow -- the one real, honest thing a business owner had already just
-- done via a real Google Places search moments earlier.

alter table business_partner_requests
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- Pulled fresh from the live function body before editing (matching this file's
-- own established "pull live, don't assume" rule) -- every other line is
-- byte-for-byte unchanged from the version applied in the Milestone 6 commit
-- (b453313d); only the `brand_partners` insert's column list and values gained
-- `address`, `latitude`, `longitude`.
create or replace function approve_business_partner_request(request_id_param uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  new_partner_id uuid;
  service_key text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category, address, latitude, longitude)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param;

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'apply_approved', new_partner_id);

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'published', new_partner_id);

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', req.requester_id,
      'title', 'You''re approved as a partner! 🎉',
      'body', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.',
      'data', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id)
    )
  );

  return new_partner_id;
end;
$$;
