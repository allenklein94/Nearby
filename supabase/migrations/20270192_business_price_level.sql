-- Item 40: "Free" and $/$$/$$$ as one universal price vocabulary. Gatherings and experiences already carry price_level
-- (free/$/$$/$$$); a business had none. Owner-declared only, never derived. NULL = not said = no price effect.
-- Business-level like weather_setting (item 63): one thing for the owner to say. Setter is separate (no profile-overload change).
alter table public.brand_partners add column if not exists price_level text;
alter table public.brand_partners drop constraint if exists brand_partners_price_level_check;
alter table public.brand_partners
  add constraint brand_partners_price_level_check
  check (price_level is null or price_level in ('free', '$', '$$', '$$$'));

create or replace function public.set_business_price_level(partner_id_param uuid, level_param text)
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
  if level_param is not null and level_param not in ('free', '$', '$$', '$$$') then
    raise exception 'Invalid price level';
  end if;
  update brand_partners set price_level = level_param where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_price_level(uuid, text) from public, anon;
grant execute on function public.set_business_price_level(uuid, text) to authenticated;
