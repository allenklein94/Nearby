-- Item 50 (age range): a DESCRIPTIVE "suited ages" range for a business and a gathering ("Ages 3-8", "Ages 5+", "Up to age 12").
-- It is NOT an age restriction: nothing here changes who may join or buy (that is its own owner decision). NULL = not said.
-- Either bound may be null (5+ / up to 12). Business-level, owner-only setter (like price_level / weather_setting); a gathering's host
-- writes their own row through the existing RLS policy.
alter table public.brand_partners add column if not exists suited_age_min smallint;
alter table public.brand_partners add column if not exists suited_age_max smallint;
alter table public.brand_partners drop constraint if exists brand_partners_suited_age_check;
alter table public.brand_partners add constraint brand_partners_suited_age_check check (
  (suited_age_min is null or suited_age_min between 0 and 18) and (suited_age_max is null or suited_age_max between 0 and 18)
  and (suited_age_min is null or suited_age_max is null or suited_age_min <= suited_age_max));

alter table public.gatherings add column if not exists suited_age_min smallint;
alter table public.gatherings add column if not exists suited_age_max smallint;
alter table public.gatherings drop constraint if exists gatherings_suited_age_check;
alter table public.gatherings add constraint gatherings_suited_age_check check (
  (suited_age_min is null or suited_age_min between 0 and 18) and (suited_age_max is null or suited_age_max between 0 and 18)
  and (suited_age_min is null or suited_age_max is null or suited_age_min <= suited_age_max));

create or replace function public.set_business_suited_ages(partner_id_param uuid, min_param integer, max_param integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  if (min_param is not null and (min_param < 0 or min_param > 18))
     or (max_param is not null and (max_param < 0 or max_param > 18))
     or (min_param is not null and max_param is not null and min_param > max_param) then
    raise exception 'Invalid age range';
  end if;
  update brand_partners set suited_age_min = min_param, suited_age_max = max_param where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_suited_ages(uuid, integer, integer) from public, anon;
grant execute on function public.set_business_suited_ages(uuid, integer, integer) to authenticated;
