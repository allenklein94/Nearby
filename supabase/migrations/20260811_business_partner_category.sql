-- Real category data for brand_partners, closing the gap flagged while
-- fixing RequestBusinessPartnerScreen.js's default business browse list
-- (Aug 11 2026 session): business_partner_requests.category is captured at
-- application time but was never copied onto the approved brand_partners
-- row, so there was no real, stored category to group or filter businesses
-- by anywhere in the app -- a "group by category, like Discover Hub" UI
-- would otherwise have had to fake it. Category keys mirror
-- BusinessPartnerApplyScreen.js's exported BUSINESS_CATEGORIES exactly --
-- keep both lists in sync if this ever changes.

alter table public.brand_partners add column category text;

alter table public.brand_partners add constraint brand_partners_category_check
  check (category is null or category in (
    'food_drink', 'fitness_wellness', 'retail_shopping',
    'arts_entertainment', 'professional_services', 'other'
  ));

-- Existing rows (today: just the one real "Coastal Coffee" test partner)
-- stay null -- there's no business_partner_requests row for it to backfill
-- from (checked live: it predates the real apply flow), and guessing a
-- category from the business name would be fabricating data this codebase's
-- own convention avoids. Left null ("Uncategorized" in the UI) until the
-- real owner sets one via the new Edit Profile category picker.

-- Unchanged from the live function except the one new `category` column in
-- the insert -- pulled via pg_get_functiondef() immediately before writing
-- this migration so the pending-guard, reviewed_by stamp, and push
-- notification added by 20260809_business_request_review_guard.sql /
-- 20260810_business_partner_review_notifications.sql are preserved exactly,
-- not reconstructed from the older baseline copy of this function.
CREATE OR REPLACE FUNCTION public.approve_business_partner_request(request_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into brand_partners (name, description, active, category)
  values (req.business_name, req.business_description, true, req.category)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param;

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
$function$;

-- update_business_profile gains a category_param -- an added parameter
-- changes the function's signature, so CREATE OR REPLACE alone would leave
-- the old 7-arg overload orphaned rather than replacing it; drop it
-- explicitly first.
drop function if exists public.update_business_profile(uuid, text, text, text, double precision, double precision, text);

create or replace function public.update_business_profile(
  partner_id_param uuid,
  name_param text,
  description_param text,
  address_param text,
  latitude_param double precision,
  longitude_param double precision,
  logo_url_param text,
  category_param text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if name_param is null or trim(name_param) = '' then
    raise exception 'Business name cannot be empty';
  end if;

  if category_param is not null and category_param not in (
    'food_drink', 'fitness_wellness', 'retail_shopping',
    'arts_entertainment', 'professional_services', 'other'
  ) then
    raise exception 'Invalid category';
  end if;

  update brand_partners
  set name = name_param,
      description = description_param,
      address = address_param,
      latitude = latitude_param,
      longitude = longitude_param,
      logo_url = logo_url_param,
      category = category_param
  where id = partner_id_param;
end;
$$;

revoke all on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text) from public, anon;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text) to authenticated;
