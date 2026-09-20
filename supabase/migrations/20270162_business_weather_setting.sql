-- Item 63: a business says once whether what it offers is indoor, outdoor or weather dependent. The recommendation
-- engine then ranks (never hides) its offers with the weather: rain -> outdoor offers drop, good weather -> outdoor rises.
-- NULL = not said = no weather effect at all. Business-level, not per offer (one thing for the owner to say).
alter table public.brand_partners add column if not exists weather_setting text;
alter table public.brand_partners drop constraint if exists brand_partners_weather_setting_check;
alter table public.brand_partners
  add constraint brand_partners_weather_setting_check
  check (weather_setting is null or weather_setting in ('indoor', 'outdoor', 'weather_dependent'));

create or replace function public.set_business_weather_setting(partner_id_param uuid, setting_param text)
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

  if setting_param is not null and setting_param not in ('indoor', 'outdoor', 'weather_dependent') then
    raise exception 'Invalid weather setting';
  end if;

  update brand_partners set weather_setting = setting_param where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_weather_setting(uuid, text) from public, anon;
grant execute on function public.set_business_weather_setting(uuid, text) to authenticated;
