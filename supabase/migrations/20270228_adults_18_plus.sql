-- Owner item 87 (2026-09-26): age suitability, structured. All ages / Kids / Teens are the quick bands over the existing suited-age
-- range (no migration). 21+ already exists as a business house rule (not_accommodated 'adults_21_plus'). This adds 18+ as the same
-- kind of owner-declared house rule, 'adults_18_plus', treated EXACTLY like 21+ everywhere 21+ is read:
--   * a child/teen ask (explicit words or a stated age under 18) removes the business (_business_declines, one rule)
--   * it conflicts with every explicit child/family setting and with any declared suited-age range (same trigger, same message,
--     restriction named "18+ only")
--   * _business_says_no_children counts it (Family experiences / packages / posting bundles)
-- 18+ and 21+ are alternatives (21+ already means 18+): the setter refuses both with a plain validation error, a CHECK backs it.
-- Nearby never checks anyone's age; this gates nothing but keeps child-involving asks away. Gatherings are NOT touched: a gathering
-- age limit is an eligibility system that stays parked by owner decision.

alter table public.brand_partners drop constraint if exists brand_partners_not_accommodated_check;
alter table public.brand_partners add constraint brand_partners_not_accommodated_check
  check (not_accommodated <@ array['no_children', 'no_pets', 'adults_18_plus', 'adults_21_plus']::text[]);
alter table public.brand_partners drop constraint if exists brand_partners_one_adult_age_rule_check;
alter table public.brand_partners add constraint brand_partners_one_adult_age_rule_check
  check (not (coalesce(not_accommodated, '{}') @> array['adults_18_plus', 'adults_21_plus']::text[]));

create or replace function public._child_restriction_name(keys text[])
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case when 'no_children' = any(coalesce(keys, '{}')) then 'No children'
              when 'adults_21_plus' = any(coalesce(keys, '{}')) then '21+ only'
              when 'adults_18_plus' = any(coalesce(keys, '{}')) then '18+ only' end;
$$;
revoke all on function public._child_restriction_name(text[]) from public, anon, authenticated;

create or replace function public.set_business_not_accommodated(partner_id_param uuid, keys_param text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_keys text[];
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    raise exception 'Only the business owner can change this.';
  end if;
  v_keys := array(select distinct k from unnest(coalesce(keys_param, '{}')) k where k is not null order by k);
  if not (v_keys <@ array['no_children', 'no_pets', 'adults_18_plus', 'adults_21_plus']::text[]) then
    raise exception 'Pick from No children, No pets, 18+ only or 21+ only.';
  end if;
  if v_keys @> array['adults_18_plus', 'adults_21_plus']::text[] then
    raise exception 'Pick 18+ only or 21+ only, not both.';
  end if;
  update brand_partners set not_accommodated = v_keys where id = partner_id_param;
end;
$$;
revoke all on function public.set_business_not_accommodated(uuid, text[]) from public, anon;
grant execute on function public.set_business_not_accommodated(uuid, text[]) to authenticated;

-- _business_declines and _business_says_no_children: patched in place from their current bodies (21+ list gains 18+).
do $mig$
declare v_def text; v_new text; f text;
begin
  foreach f in array array[
    'public._business_declines(uuid, integer, boolean, boolean, boolean, boolean, boolean)',
    'public._business_says_no_children(uuid)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_new := replace(v_def, $q$array['no_children', 'adults_21_plus']$q$, $q$array['no_children', 'adults_18_plus', 'adults_21_plus']$q$);
    if v_new = v_def then raise exception '% patch did not apply', f; end if;
    execute v_new;
  end loop;
end
$mig$;
