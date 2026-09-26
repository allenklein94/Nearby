-- Item 86, final contract (owner, 2026-09-26). Builds on 20270222 / 20270224 / 20270225; still ONE server authority.
-- 1. Availability postings: a LIVE posting (status active, not ended) with the Family Gathering bundle is an explicit family offering,
--    the same structured occasion value as a Family Gathering package. Enforced in both save directions:
--      * saving No children / 21+ looks at the business's live Family Gathering postings (profile trigger)
--      * posting a Family Gathering bundle looks at the business's No children / 21+ (new availability trigger)
--    An expired / cancelled / filled posting no longer declares anything, so it never blocks.
-- 2. Exact owner wording, one message per conflicting setting, no internal field names:
--      "<Restriction> conflicts with <Setting>. Remove one of these settings to continue."
--    The same message whichever setting was saved first. Duplicates collapse (two family experiences = one line).
--    Restriction = "No children" when set, else "21+ only" (a business that only chose 21+ is never told it chose No children).
--    21+ together with No children stays allowed.
-- 3. Structured refusal: ONE raise per save carrying EVERY conflict: MESSAGE = the lines joined by newlines, DETAIL = a JSON array of
--    the lines, HINT = 'setting_conflict', SQLSTATE P0001 (so existing 400 handling still applies). The app renders DETAIL as-is.
-- 4. check_business_setting_conflicts(partner, kind, patch): the same rule, without saving, so the app can clear a message once the
--    owner resolves it. For the profile it performs the real update inside a subtransaction and always rolls it back, so it is the
--    trigger itself answering, never a second copy of the rule.

create or replace function public._setting_conflict_message(restriction text, setting text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select format('%s conflicts with %s. Remove one of these settings to continue.', restriction, setting);
$$;
revoke all on function public._setting_conflict_message(text, text) from public, anon, authenticated;

create or replace function public._raise_setting_conflicts(messages text[])
returns void
language plpgsql
set search_path to 'public'
as $$
declare v text[];
begin
  select coalesce(array_agg(m order by first_pos), '{}') into v
  from (select m, min(pos) first_pos from unnest(coalesce(messages, '{}')) with ordinality u(m, pos) where m is not null group by m) d;
  if cardinality(v) > 0 then
    raise exception using message = array_to_string(v, E'\n'), detail = to_jsonb(v)::text, hint = 'setting_conflict';
  end if;
end;
$$;
revoke all on function public._raise_setting_conflicts(text[]) from public, anon, authenticated;

-- 20270225 kept its own long message; it now routes through the shared builder (kept for any caller; returns nothing new).
drop function if exists public._no_children_conflict(text[]);

-- The ONE decision of whether an offering row explicitly targets families, now as the owner-facing setting name.
create or replace function public._family_offering_label(kind text, title text, party_type text, attributes text[], occasion text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when kind = 'experience' and (party_type = 'family'
      or coalesce(attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'])
      then 'Family Signature Experience'
    when kind in ('package', 'availability') and occasion = 'family_gathering' then 'Family Gathering'
  end;
$$;
revoke all on function public._family_offering_label(text, text, text, text[], text) from public, anon, authenticated;

create or replace function public._business_family_offerings(partner_id_param uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct l), '{}') from (
    select public._family_offering_label('experience', e.title, e.party_type, e.attributes, null) l from business_experiences e where e.partner_id = partner_id_param
    union all
    select public._family_offering_label('package', p.name, null, null, p.occasion_type) from business_occasion_packages p where p.partner_id = partner_id_param
    union all
    select public._family_offering_label('availability', a.title, null, null, a.bundle_occasion) from business_availability a
      where a.partner_id = partner_id_param and a.status = 'active' and a.ends_at > now()
  ) x where l is not null;
$$;
revoke all on function public._business_family_offerings(uuid) from public, anon, authenticated;

-- "No children" / "21+ only" / null: the restriction's own name, as the owner picked it.
create or replace function public._child_restriction_name(keys text[])
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case when 'no_children' = any(coalesce(keys, '{}')) then 'No children'
              when 'adults_21_plus' = any(coalesce(keys, '{}')) then '21+ only' end;
$$;
revoke all on function public._child_restriction_name(text[]) from public, anon, authenticated;

create or replace function public._business_child_restriction(partner_id_param uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select public._child_restriction_name((select not_accommodated from brand_partners where id = partner_id_param));
$$;
revoke all on function public._business_child_restriction(uuid) from public, anon, authenticated;

-- The profile's conflicts as messages. Pure over the row values plus the business's existing offerings.
create or replace function public._business_profile_conflicts(bp public.brand_partners)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v text[] := '{}';
  r text := public._child_restriction_name(bp.not_accommodated);
  v_child_attrs constant text[] := array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'];
  v_labels constant jsonb := '{"kid_friendly": "Family-friendly", "kid_menu": "Kids menu", "family_seating": "Family seating", "stroller_friendly": "Stroller friendly"}';
  k text;
begin
  if r is not null then
    foreach k in array v_child_attrs loop
      if k = any(coalesce(bp.attributes, '{}')) then v := v || public._setting_conflict_message(r, v_labels ->> k); end if;
    end loop;
    if bp.suited_age_min is not null or bp.suited_age_max is not null then v := v || public._setting_conflict_message(r, 'Suited ages'); end if;
    if 'family' = any(coalesce(bp.accommodates_party_types, '{}')) then v := v || public._setting_conflict_message(r, 'Family'); end if;
    if 'family_gathering' = any(coalesce(bp.offered_occasions, '{}')) then v := v || public._setting_conflict_message(r, 'Group/Family'); end if;
    if (coalesce(bp.priority_attributes, '{}') && v_child_attrs) or 'family_gathering' = any(coalesce(bp.priority_occasions, '{}')) then
      v := v || public._setting_conflict_message(r, 'wanting more families');
    end if;
    if bp.id is not null then
      select v || coalesce(array_agg(public._setting_conflict_message(r, l) order by l), '{}') into v from unnest(public._business_family_offerings(bp.id)) l;
    end if;
  end if;

  if 'no_pets' = any(coalesce(bp.not_accommodated, '{}')) then
    if 'dog_friendly' = any(coalesce(bp.attributes, '{}')) then v := v || public._setting_conflict_message('No pets', 'Dog friendly'); end if;
    if 'pet_friendly' = any(coalesce(bp.attributes, '{}')) then v := v || public._setting_conflict_message('No pets', 'Pet friendly'); end if;
  end if;

  -- The outdoor area size only counts while Outdoor dining is on (a hidden leftover size never blocks).
  if bp.weather_setting = 'indoor' and 'outdoor_seating' = any(coalesce(bp.attributes, '{}')) then
    v := v || public._setting_conflict_message('Indoor only', 'Outdoor dining');
    if bp.outdoor_capacity is not null then v := v || public._setting_conflict_message('Indoor only', 'the outdoor area size'); end if;
  end if;
  return v;
end;
$$;
revoke all on function public._business_profile_conflicts(public.brand_partners) from public, anon, authenticated;

create or replace function public._check_business_not_accommodated()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public._raise_setting_conflicts(public._business_profile_conflicts(new));
  return new;
end;
$$;
revoke all on function public._check_business_not_accommodated() from public, anon, authenticated;

-- Offering side: experiences, packages and (new) live availability postings.
create or replace function public._offering_conflicts(partner_id_param uuid, kind text, title text, party_type text, attributes text[], occasion text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when l is null or r is null then '{}'::text[] else array[public._setting_conflict_message(r, l)] end
  from (select public._family_offering_label(kind, title, party_type, attributes, occasion) l,
               public._business_child_restriction(partner_id_param) r) x;
$$;
revoke all on function public._offering_conflicts(uuid, text, text, text, text[], text) from public, anon, authenticated;

create or replace function public._check_family_offering_vs_no_children()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_table_name = 'business_experiences' then
    perform public._raise_setting_conflicts(public._offering_conflicts(new.partner_id, 'experience', new.title, new.party_type, new.attributes, null));
  elsif tg_table_name = 'business_occasion_packages' then
    perform public._raise_setting_conflicts(public._offering_conflicts(new.partner_id, 'package', new.name, null, null, new.occasion_type));
  elsif new.status = 'active' and new.ends_at > now() then
    perform public._raise_setting_conflicts(public._offering_conflicts(new.partner_id, 'availability', new.title, null, null, new.bundle_occasion));
  end if;
  return new;
end;
$$;
revoke all on function public._check_family_offering_vs_no_children() from public, anon, authenticated;

drop trigger if exists check_availability_vs_no_children on public.business_availability;
create trigger check_availability_vs_no_children
  before insert or update of bundle_occasion, partner_id, status, ends_at on public.business_availability
  for each row execute function public._check_family_offering_vs_no_children();

-- Check without saving (owner only). kind: 'profile' (patch = any of the columns the rule reads), 'experience'
-- (party_type, attributes), 'package' (occasion_type), 'availability' (bundle_occasion). Returns the messages, {} when clear.
create or replace function public.check_business_setting_conflicts(partner_id_param uuid, kind_param text, patch_param jsonb)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p jsonb := coalesce(patch_param, '{}');
  v_hint text; v_detail text;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    raise exception 'Only the business owner can check this.';
  end if;
  if kind_param = 'experience' then
    return public._offering_conflicts(partner_id_param, 'experience', null, p ->> 'party_type',
      array(select jsonb_array_elements_text(coalesce(p -> 'attributes', '[]'))), null);
  elsif kind_param = 'package' then
    return public._offering_conflicts(partner_id_param, 'package', null, null, null, p ->> 'occasion_type');
  elsif kind_param = 'availability' then
    return public._offering_conflicts(partner_id_param, 'availability', null, null, null, p ->> 'bundle_occasion');
  elsif kind_param <> 'profile' then
    raise exception 'Unknown kind.';
  end if;

  begin
    update brand_partners set
      not_accommodated = case when p ? 'not_accommodated' then array(select jsonb_array_elements_text(p -> 'not_accommodated')) else not_accommodated end,
      attributes = case when p ? 'attributes' then array(select jsonb_array_elements_text(p -> 'attributes')) else attributes end,
      accommodates_party_types = case when p ? 'accommodates_party_types' then array(select jsonb_array_elements_text(p -> 'accommodates_party_types')) else accommodates_party_types end,
      offered_occasions = case when p ? 'offered_occasions' then array(select jsonb_array_elements_text(p -> 'offered_occasions')) else offered_occasions end,
      priority_attributes = case when p ? 'priority_attributes' then array(select jsonb_array_elements_text(p -> 'priority_attributes')) else priority_attributes end,
      priority_occasions = case when p ? 'priority_occasions' then array(select jsonb_array_elements_text(p -> 'priority_occasions')) else priority_occasions end,
      suited_age_min = case when p ? 'suited_age_min' then (p ->> 'suited_age_min')::int else suited_age_min end,
      suited_age_max = case when p ? 'suited_age_max' then (p ->> 'suited_age_max')::int else suited_age_max end,
      weather_setting = case when p ? 'weather_setting' then p ->> 'weather_setting' else weather_setting end,
      outdoor_capacity = case when p ? 'outdoor_capacity' then (p ->> 'outdoor_capacity')::int else outdoor_capacity end
    where id = partner_id_param;
    raise exception using errcode = 'NBDRY', message = 'dry run';
  exception
    when sqlstate 'NBDRY' then return '{}';
    when others then
      get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      if v_hint = 'setting_conflict' then return array(select jsonb_array_elements_text(v_detail::jsonb)); end if;
      raise;
  end;
end;
$$;
revoke all on function public.check_business_setting_conflicts(uuid, text, jsonb) from public, anon;
grant execute on function public.check_business_setting_conflicts(uuid, text, jsonb) to authenticated;
