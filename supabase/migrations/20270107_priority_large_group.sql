-- "What do you want more of?" gains "Large groups" (a request with party_size >= 7, the same bucket the demand card
-- uses). Same shape as weekday / last_minute (20261228): widens the one CHECK and the one setter; signature unchanged;
-- matching reads the request's own party_size, so no new request field.
alter table public.brand_partners drop constraint if exists brand_partners_priority_time_windows_check;
alter table public.brand_partners add constraint brand_partners_priority_time_windows_check
  check (priority_time_windows <@ array['morning','afternoon','evening','weekend','weekday','last_minute','large_group']::text[]);

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

  if not (time_windows_param <@ array['morning', 'afternoon', 'evening', 'weekend', 'weekday', 'last_minute', 'large_group']::text[]) then
    raise exception 'Invalid time window';
  end if;

  update brand_partners
  set priority_time_windows = time_windows_param
  where id = partner_id_param;
end;
$function$;
