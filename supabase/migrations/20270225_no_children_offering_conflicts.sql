-- Item 86, No-children rule closed across the business OFFERING surface (owner, 2026-09-26). Canonical rule:
--   "No children" (and 21+) conflicts with any EXISTING owner-declared attribute, preference, group, occasion, experience or package
--   that EXPLICITLY welcomes or targets children/families. Never inferred (no category, photos, reviews or ordinary wording).
-- Same system as 20270222/20270224, one rule with two entry points:
--   * _family_offering_label(...)       the ONE decision of whether an experience/package row explicitly targets families
--   * _no_children_conflict(labels)      the ONE owner-facing message
--   * brand_partners trigger             saving No children / 21+ also looks at the business's existing experiences and packages
--   * experience + package triggers      saving a family experience/package looks at the business's No children / 21+
-- Explicit family designations: a Signature Experience with party type Family, or with a child quality in its own attributes
-- (Family-friendly, Kids menu, Family seating, Stroller friendly: the same four the profile rule uses); an occasion package for
-- Family Gathering. Paused (inactive) rows count: they still exist and can be switched back on. Nothing is rewritten or removed.
-- Not covered by decision: generic groups, private events, a package's free-text name/description/included items.

create or replace function public._family_offering_label(kind text, title text, party_type text, attributes text[], occasion text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when kind = 'experience' and party_type = 'family' then format('Signature Experience "%s" (for families)', title)
    when kind = 'experience' and coalesce(attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly']
      then format('Signature Experience "%s" (family-friendly)', title)
    when kind = 'package' and occasion = 'family_gathering' then format('Occasion package "%s" (Family Gathering)', title)
  end;
$$;
revoke all on function public._family_offering_label(text, text, text, text[], text) from public, anon, authenticated;

create or replace function public._no_children_conflict(labels text[])
returns void
language plpgsql
set search_path to 'public'
as $$
begin
  if cardinality(labels) > 0 then
    raise exception 'You said you don''t accommodate children, but these settings say children or families are welcome: %. Remove them first, or remove "No children" / "21+ only".', array_to_string(labels, ', ');
  end if;
end;
$$;
revoke all on function public._no_children_conflict(text[]) from public, anon, authenticated;

-- The business's existing explicit family offerings, as labels.
create or replace function public._business_family_offerings(partner_id_param uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(l order by l), '{}') from (
    select public._family_offering_label('experience', e.title, e.party_type, e.attributes, null) l from business_experiences e where e.partner_id = partner_id_param
    union all
    select public._family_offering_label('package', p.name, null, null, p.occasion_type) from business_occasion_packages p where p.partner_id = partner_id_param
  ) x where l is not null;
$$;
revoke all on function public._business_family_offerings(uuid) from public, anon, authenticated;

create or replace function public._business_says_no_children(partner_id_param uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select not_accommodated && array['no_children', 'adults_21_plus'] from brand_partners where id = partner_id_param), false);
$$;
revoke all on function public._business_says_no_children(uuid) from public, anon, authenticated;

-- Profile side: the 20270224 body, with the family offerings added to the same label list and the same message.
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public._check_business_not_accommodated()'::regprocedure);
  v_new := replace(v_def, $q$    if 'family_gathering' = any(coalesce(new.priority_occasions, '{}')) then v_kids := v_kids || 'Family Gathering (what you want more of)'::text; end if;
    if cardinality(v_kids) > 0 then
      raise exception 'You said you don''t accommodate children, but these settings say children or families are welcome: %. Remove them first, or remove "No children" / "21+ only".', array_to_string(v_kids, ', ');
    end if;$q$, $q$    if 'family_gathering' = any(coalesce(new.priority_occasions, '{}')) then v_kids := v_kids || 'Family Gathering (what you want more of)'::text; end if;
    -- 20270225: the business's existing Signature Experiences and occasion packages that explicitly target families
    if new.id is not null then v_kids := v_kids || public._business_family_offerings(new.id); end if;
    perform public._no_children_conflict(v_kids);$q$);
  if v_new = v_def then raise exception '_check_business_not_accommodated patch did not apply'; end if;
  execute v_new;
end
$mig$;

-- Offering side.
create or replace function public._check_family_offering_vs_no_children()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_label text;
begin
  if tg_table_name = 'business_experiences' then
    v_label := public._family_offering_label('experience', new.title, new.party_type, new.attributes, null);
  else
    v_label := public._family_offering_label('package', new.name, null, null, new.occasion_type);
  end if;
  if v_label is not null and public._business_says_no_children(new.partner_id) then
    perform public._no_children_conflict(array[v_label]);
  end if;
  return new;
end;
$$;
revoke all on function public._check_family_offering_vs_no_children() from public, anon, authenticated;

drop trigger if exists check_experience_vs_no_children on public.business_experiences;
create trigger check_experience_vs_no_children
  before insert or update of party_type, attributes, partner_id, title on public.business_experiences
  for each row execute function public._check_family_offering_vs_no_children();

drop trigger if exists check_package_vs_no_children on public.business_occasion_packages;
create trigger check_package_vs_no_children
  before insert or update of occasion_type, partner_id, name on public.business_occasion_packages
  for each row execute function public._check_family_offering_vs_no_children();

-- The profile trigger now calls owner-only helpers, so it runs with the owner's rights (a direct table write by a signed-in role
-- would otherwise fail on permissions instead of the rule). It reads only NEW and this business's own rows.
alter function public._check_business_not_accommodated() security definer;
