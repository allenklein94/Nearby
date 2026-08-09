-- Business self-serve profile editing (closes PRODUCT_AUDIT item 11).
--
-- brand_partners had zero UPDATE RLS policy of any kind before this migration
-- (confirmed live via pg_policies: exactly one policy existed, a SELECT-only
-- "Anyone can view active partners" for active = true rows). That means the
-- pre-existing updateBusinessAddress() client-side raw `.update()` call in
-- services/brandOffers.js has never actually written anything for any real
-- owner -- RLS silently no-ops an UPDATE with no matching policy. Fixing
-- this the same way this session's other business-RPC ownership fixes were
-- built: a real SECURITY DEFINER RPC that checks the caller actually owns
-- the partner via profiles.managed_partner_id, not a broad client UPDATE
-- policy opened on the table.
create or replace function public.update_business_profile(
  partner_id_param uuid,
  name_param text,
  description_param text,
  address_param text,
  latitude_param double precision,
  longitude_param double precision,
  logo_url_param text
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

  update brand_partners
  set name = name_param,
      description = description_param,
      address = address_param,
      latitude = latitude_param,
      longitude = longitude_param,
      logo_url = logo_url_param
  where id = partner_id_param;
end;
$$;

revoke all on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text) from public, anon;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text) to authenticated;
