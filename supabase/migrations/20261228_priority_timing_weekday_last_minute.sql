-- "What do you want more of?" gains two timing options a business asked for: weekday customers and last-minute bookings.
-- Both are matched from the request's own date (weekday = Mon-Fri; last-minute = needed today/tomorrow, the same rule as
-- _opportunity_is_urgent), so they need no new request field. Widens the one CHECK and the one setter; signature unchanged.
alter table public.brand_partners drop constraint if exists brand_partners_priority_time_windows_check;
alter table public.brand_partners add constraint brand_partners_priority_time_windows_check
  check (priority_time_windows <@ array['morning','afternoon','evening','weekend','weekday','last_minute']::text[]);

create or replace function public.set_business_priority_time_windows(partner_id_param uuid, time_windows_param text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if not (time_windows_param <@ array['morning', 'afternoon', 'evening', 'weekend', 'weekday', 'last_minute']::text[]) then
    raise exception 'Invalid time window';
  end if;

  update brand_partners
  set priority_time_windows = time_windows_param
  where id = partner_id_param;
end;
$function$;
