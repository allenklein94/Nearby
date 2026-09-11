-- Item 49 (CLAUDE.md, "don't notify users about things they can't
-- actually act on"): closes the one real violation a live-schema audit
-- found. notify_matching_business_availability() (20261004_recommended_
-- for_you_push.sql) already carries a real availability_id + partner_id
-- in its push payload, and a real consumer action already exists for a
-- specific business_availability row (AskBusinessScreen's "matchedAvailability"
-- banner + bound submit, built for the intent-search path in
-- intentResolver.js's resolveBusinessAvailability()) -- but the push tap
-- itself (src/services/notifications.js) just dumped the user on the
-- generic Discover tab, because business_availability has owner-only
-- SELECT RLS and there was no consumer-safe way to fetch one posting by
-- id from a cold tap. "Restaurant X has availability" led nowhere
-- specific to act on -- exactly the failure mode this item names.
--
-- This is that lookup: same SECURITY DEFINER shape and same real column
-- set as search_active_business_availability() (verified live via
-- pg_get_functiondef before writing this), narrowed to one row by id.
-- Filtered to status = 'active' and ends_at > now() -- a stale
-- notification tapped after the slot's already gone correctly returns no
-- row (an honest empty state on the client), never dead/expired
-- inventory presented as live.
create or replace function public.get_business_availability_by_id(availability_id_param uuid)
returns table(
  id uuid, partner_id uuid, partner_name text, title text, description text,
  offer_type text, price numeric, attributes text[], cuisine text, remaining_capacity integer
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    ba.id, ba.partner_id, p.name as partner_name, ba.title, ba.description,
    ba.offer_type, ba.price, p.attributes, p.cuisine, ba.remaining_capacity
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true
  where ba.id = availability_id_param
    and ba.status = 'active'
    and ba.ends_at > now();
$function$;

revoke all on function public.get_business_availability_by_id(uuid) from public, anon;
grant execute on function public.get_business_availability_by_id(uuid) to authenticated;
