-- Owner item 72: how a customer comes in, so the CTA can follow it. ONE owner-declared field, NULL = not said (no CTA change):
--   walk_in                 -> "Go now"   (only while confirmed open/available; else directions or the default)
--   reservation_recommended -> "Reserve"
--   reservation_required    -> "Book"
--   request_required        -> "Request"
-- Supersedes the `reservation_required` ATTRIBUTE as the place this is said (0 live rows used it; the key stays in the shared
-- attribute vocabulary for stored-data compatibility and is read by the client only as a fallback when booking_mode is NULL).
-- Setting the mode removes that legacy attribute from the row so there is one declaration. Business-level like price_level.
alter table public.brand_partners add column if not exists booking_mode text;
alter table public.brand_partners drop constraint if exists brand_partners_booking_mode_check;
alter table public.brand_partners
  add constraint brand_partners_booking_mode_check
  check (booking_mode is null or booking_mode in ('walk_in', 'reservation_recommended', 'reservation_required', 'request_required'));

create or replace function public.set_business_booking_mode(partner_id_param uuid, mode_param text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;
  if mode_param is not null and mode_param not in ('walk_in', 'reservation_recommended', 'reservation_required', 'request_required') then
    raise exception 'Invalid booking mode';
  end if;
  update brand_partners
     set booking_mode = mode_param,
         attributes = array_remove(coalesce(attributes, '{}'::text[]), 'reservation_required')
   where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_booking_mode(uuid, text) from public, anon;
grant execute on function public.set_business_booking_mode(uuid, text) to authenticated;
