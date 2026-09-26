-- Canonical activity dictionary (owner item 75, 2026-09-26). Synonyms (same activity) vs related activities (distinct):
-- "padel" must never become Pickleball. Adds Padel as its own leaf tag beside Pickleball (Activities & Recreation), the
-- racquet/paddle synonym rows, and makes admin_add_category_synonym refuse mapping a canonical tag's OWN name to a different
-- tag. The related-activity map itself is client-side ranking only (src/constants/activityDictionary.js). Mirrored in
-- gatheringCategories.js and categorySynonyms.js (tests keep them identical). Idempotent.
insert into public.category_tag_groups (tag, group_key) values
  ('Padel', 'activities_recreation')
on conflict (tag) do nothing;

insert into public.category_synonyms (phrase, tag) values
  ('pickle ball', 'Pickleball'),
  ('pickleball court', 'Pickleball'),
  ('paddle', 'Pickleball'),
  ('padel tenni', 'Padel'),
  ('padel court', 'Padel'),
  ('padel club', 'Padel'),
  ('tenni court', 'Tennis'),
  ('tenni club', 'Tennis'),
  ('paddleboard', 'Paddleboarding'),
  ('paddle board', 'Paddleboarding'),
  ('paddle boarding', 'Paddleboarding'),
  ('stand up paddle', 'Paddleboarding'),
  ('sup board', 'Paddleboarding'),
  ('kayak', 'Kayaking')
on conflict do nothing;

create or replace function public.admin_add_category_synonym(phrase_param text, tag_param text)
returns text language plpgsql security definer set search_path = public as $$
declare v_phrase text := public._category_search_key(phrase_param);
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only an admin can add a synonym';
  end if;
  if char_length(v_phrase) not between 2 and 60 then
    raise exception 'A synonym is 2 to 60 characters';
  end if;
  if not exists (select 1 from category_tag_groups where tag = tag_param) then
    raise exception 'Unknown category';
  end if;
  -- A canonical tag's own name only ever means that tag (related is not the same: padel is never Pickleball).
  if exists (select 1 from category_tag_groups where tag <> tag_param and public._category_search_key(tag) = v_phrase) then
    raise exception 'That phrase is already its own category';
  end if;
  insert into category_synonyms (phrase, tag) values (v_phrase, tag_param) on conflict do nothing;
  return v_phrase;
end $$;
revoke all on function public.admin_add_category_synonym(text, text) from public, anon;
grant execute on function public.admin_add_category_synonym(text, text) to authenticated;
