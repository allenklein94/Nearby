-- Item 82: a business's price, coarse on purpose. The tier widens from $/$$/$$$ to $ / $$ / $$$ / $$$$ (business-only; gatherings
-- and experiences keep their own free/$/$$/$$$ list). 'free' is no longer a business tier (no live row used it). Optional
-- typical_spend_per_person = whole dollars per person, owner-typed, NULL = not said, never derived from the tier or anything else.
update public.brand_partners set price_level = null where price_level = 'free';
alter table public.brand_partners drop constraint if exists brand_partners_price_level_check;
alter table public.brand_partners
  add constraint brand_partners_price_level_check
  check (price_level is null or price_level in ('$', '$$', '$$$', '$$$$'));

alter table public.brand_partners add column if not exists typical_spend_per_person integer;
alter table public.brand_partners drop constraint if exists brand_partners_typical_spend_check;
alter table public.brand_partners
  add constraint brand_partners_typical_spend_check
  check (typical_spend_per_person is null or typical_spend_per_person between 1 and 1000);

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
  if level_param is not null and level_param not in ('$', '$$', '$$$', '$$$$') then
    raise exception 'Invalid price level';
  end if;
  update brand_partners set price_level = level_param where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_price_level(uuid, text) from public, anon;
grant execute on function public.set_business_price_level(uuid, text) to authenticated;

create or replace function public.set_business_typical_spend(partner_id_param uuid, amount_param integer)
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
  if amount_param is not null and (amount_param < 1 or amount_param > 1000) then
    raise exception 'Typical spend must be between $1 and $1000 per person';
  end if;
  update brand_partners set typical_spend_per_person = amount_param where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_typical_spend(uuid, integer) from public, anon;
grant execute on function public.set_business_typical_spend(uuid, integer) to authenticated;
