-- Item 86, save-time contradictions completed (owner, 2026-09-26). The SAME trigger as 20270222 (no second validation system);
-- the client no longer pre-checks, so the owner sees exactly the server's message.
--
-- NO CHILDREN (no_children, and 21+ which already excludes children) conflicts with every EXPLICIT owner-selected positive
-- child/family signal on the business profile (vocabulary audit, 2026-09-26):
--   attributes         kid_friendly (Family-friendly), kid_menu, family_seating, stroller_friendly
--   suited ages        suited_age_min / suited_age_max
--   groups we take     accommodates_party_types 'family'
--   occasions offered  offered_occasions 'family_gathering' (shown as Group/Family)
--   want more          priority_attributes (the four child qualities), priority_occasions 'family_gathering'
-- Deliberately NOT conflicts: baby_shower (an adult event), generic groups / large groups / private events / quiet / date-friendly,
-- the business's own category tags (Family & Kids, Kids Museums, Family Resorts: classification, not a capability), and per-offer
-- content (Signature Experiences, occasion packages) which lives on other tables.
--
-- INDOOR ONLY (weather_setting 'indoor') conflicts with Outdoor dining (outdoor_seating) and the outdoor area size while it counts.
-- An outdoor size counts only while Outdoor dining is declared (item 81) and the owner cannot see or clear it otherwise, so a
-- stale hidden size never blocks.
--
-- 21+ together with No children stays allowed (redundant, not contradictory); neither is rewritten.

create or replace function public._check_business_not_accommodated()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_kids text[] := '{}';
  v_indoor text[] := '{}';
  v_child_attrs constant text[] := array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'];
  v_labels constant jsonb := '{"kid_friendly": "Family-friendly", "kid_menu": "Kids menu", "family_seating": "Family seating", "stroller_friendly": "Stroller friendly"}';
  k text;
begin
  if coalesce(new.not_accommodated, '{}') && array['no_children', 'adults_21_plus'] then
    foreach k in array v_child_attrs loop
      if k = any(coalesce(new.attributes, '{}')) then v_kids := v_kids || (v_labels ->> k); end if;
    end loop;
    if new.suited_age_min is not null or new.suited_age_max is not null then v_kids := v_kids || 'Suited ages'::text; end if;
    if 'family' = any(coalesce(new.accommodates_party_types, '{}')) then v_kids := v_kids || 'Family (groups you take)'::text; end if;
    if 'family_gathering' = any(coalesce(new.offered_occasions, '{}')) then v_kids := v_kids || 'Group/Family (occasions you offer)'::text; end if;
    foreach k in array v_child_attrs loop
      if k = any(coalesce(new.priority_attributes, '{}')) then v_kids := v_kids || ((v_labels ->> k) || ' (what you want more of)'); end if;
    end loop;
    if 'family_gathering' = any(coalesce(new.priority_occasions, '{}')) then v_kids := v_kids || 'Family Gathering (what you want more of)'::text; end if;
    if cardinality(v_kids) > 0 then
      raise exception 'You said you don''t accommodate children, but these settings say children or families are welcome: %. Remove them first, or remove "No children" / "21+ only".', array_to_string(v_kids, ', ');
    end if;
  end if;

  if 'no_pets' = any(coalesce(new.not_accommodated, '{}'))
     and coalesce(new.attributes, '{}') && array['dog_friendly', 'pet_friendly'] then
    raise exception 'You said you don''t allow pets, so Dog friendly and Pet friendly can''t be on too. Remove one of them first.';
  end if;

  if new.weather_setting = 'indoor' and 'outdoor_seating' = any(coalesce(new.attributes, '{}')) then
    v_indoor := v_indoor || 'Outdoor dining'::text;
    if new.outdoor_capacity is not null then v_indoor := v_indoor || 'Outdoor area size'::text; end if;
    raise exception 'You said your business is indoor only, but you also have % selected. Remove % first, or choose a different weather setting.', array_to_string(v_indoor, ' and '), case when cardinality(v_indoor) > 1 then 'them' else 'it' end;
  end if;
  return new;
end;
$$;
revoke all on function public._check_business_not_accommodated() from public, anon, authenticated;

drop trigger if exists check_business_not_accommodated on public.brand_partners;
create trigger check_business_not_accommodated
  before insert or update of not_accommodated, attributes, suited_age_min, suited_age_max, accommodates_party_types,
    offered_occasions, priority_attributes, priority_occasions, weather_setting, outdoor_capacity
  on public.brand_partners
  for each row execute function public._check_business_not_accommodated();
