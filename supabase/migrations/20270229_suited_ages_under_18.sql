-- Item 87 lock (2026-09-26): 18+ / 21+ are business house rules only, never a descriptive gathering label. The suited-age range
-- (All ages / Kids / Teens / exact) allowed a From of 18, i.e. an "Ages 18+" label on a gathering, which is the partial descriptive
-- adult-age system the owner ruled out. Both ends are now 0..17, so every declared range includes someone under 18 (All ages = 0+,
-- Kids 0-12, Teens 13-17 unchanged). That also makes "any declared range conflicts with No children / 18+ / 21+" exactly
-- "a range including children or teens conflicts". No production row had a suited age set.
alter table public.brand_partners drop constraint if exists brand_partners_suited_age_check;
alter table public.brand_partners add constraint brand_partners_suited_age_check check (
  (suited_age_min is null or suited_age_min between 0 and 17) and (suited_age_max is null or suited_age_max between 0 and 17)
  and (suited_age_min is null or suited_age_max is null or suited_age_min <= suited_age_max));

alter table public.gatherings drop constraint if exists gatherings_suited_age_check;
alter table public.gatherings add constraint gatherings_suited_age_check check (
  (suited_age_min is null or suited_age_min between 0 and 17) and (suited_age_max is null or suited_age_max between 0 and 17)
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
  if (min_param is not null and (min_param < 0 or min_param > 17))
     or (max_param is not null and (max_param < 0 or max_param > 17))
     or (min_param is not null and max_param is not null and min_param > max_param) then
    raise exception 'Invalid age range';
  end if;
  update brand_partners set suited_age_min = min_param, suited_age_max = max_param where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_suited_ages(uuid, integer, integer) from public, anon;
grant execute on function public.set_business_suited_ages(uuid, integer, integer) to authenticated;
