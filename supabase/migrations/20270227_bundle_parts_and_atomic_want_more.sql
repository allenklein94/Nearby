-- Item 86 follow-up (owner, 2026-09-26, LOCKED). Two integrity pieces; NEITHER is a No-children rule.
-- 1. Bundle parts belong to their occasion. An availability posting's bundle components must be parts of THAT occasion's own
--    bundle (the same parts the app offers, from EXPERIENCE_TEMPLATES in src/constants/experienceTemplates.js; a Jest test keeps
--    the two identical). e.g. Family Fun only with Family Gathering, so a hand-made Birthday + Family Fun is refused as an INVALID
--    request (plain validation error, no 'setting_conflict' hint). family_fun is NOT a No-children trigger: the only trigger stays
--    the structured Family Gathering occasion (20270226). One problem function; post_business_availability raises its message and
--    a table CHECK backs every other write path. No posting in production has a bundle, so nothing existing is affected.
-- 2. "What do you want more of?" saves in ONE transaction: set_business_want_more calls the four existing setters, so a
--    conflict, an invalid value or a failure in any part persists nothing (zero partial writes).

create or replace function public._bundle_component_problem(occasion text, components text[])
returns text
language sql
immutable
set search_path to 'public'
as $$
  with parts(occ, keys) as (values
    ('date_night',       array['dinner', 'something_to_do', 'finish_the_night']),
    ('anniversary',      array['dinner', 'something_to_do', 'finish_the_night']),
    ('birthday',         array['dinner', 'something_fun', 'something_to_do', 'sweet_treat']),
    ('celebration',      array['dinner', 'something_fun', 'sweet_treat']),
    ('family_gathering', array['food', 'family_fun'])
  ),
  labels(k, label) as (values
    ('dinner', 'Dinner'), ('something_to_do', 'Something to Do'), ('finish_the_night', 'Finish the Night'),
    ('something_fun', 'Something Fun'), ('sweet_treat', 'Sweet Treat'), ('food', 'Food'), ('family_fun', 'Family Fun'),
    ('date_night', 'Date Night'), ('anniversary', 'Anniversary'), ('birthday', 'Birthday'), ('celebration', 'Celebration'),
    ('family_gathering', 'Family Gathering')
  ),
  bad as (
    select c from unnest(coalesce(components, '{}')) with ordinality u(c, pos)
    where occasion is null or not c = any(coalesce((select keys from parts where occ = occasion), '{}'))
    order by pos limit 1
  )
  select case
    when (select c from bad) is null then null
    when occasion is null then 'A bundle needs an occasion.'
    else format('%s isn''t part of a %s bundle. Pick the parts listed for %s.',
      coalesce((select label from labels where k = (select c from bad)), (select c from bad)),
      coalesce((select label from labels where k = occasion), occasion),
      coalesce((select label from labels where k = occasion), occasion))
  end;
$$;
revoke all on function public._bundle_component_problem(text, text[]) from public, anon, authenticated;

alter table public.business_availability drop constraint if exists business_availability_bundle_parts_fit_check;
alter table public.business_availability add constraint business_availability_bundle_parts_fit_check
  check (public._bundle_component_problem(bundle_occasion, bundle_components) is null);

-- post_business_availability: the clear message before the insert (patched from the live body).
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.post_business_availability(text,text,text,text,numeric,integer,timestamptz,timestamptz,double precision,text,text[],numeric)'::regprocedure);
  v_new := replace(v_def, $q$  if array_length(v_bundle_components, 1) > 0 and bundle_occasion_param is null then
    raise exception 'A bundle needs an occasion';
  end if;$q$, $q$  if array_length(v_bundle_components, 1) > 0 and bundle_occasion_param is null then
    raise exception 'A bundle needs an occasion';
  end if;
  -- 20270227: each part must belong to this occasion's bundle (Family Fun only with Family Gathering). A validation error.
  if public._bundle_component_problem(bundle_occasion_param, v_bundle_components) is not null then
    raise exception '%', public._bundle_component_problem(bundle_occasion_param, v_bundle_components);
  end if;$q$);
  if v_new = v_def then raise exception 'post_business_availability patch did not apply'; end if;
  execute v_new;
end
$mig$;

create or replace function public.set_business_want_more(
  partner_id_param uuid, priority_attributes_param text[], time_windows_param text[],
  start_param time without time zone, end_param time without time zone, occasions_param text[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Each setter keeps its own owner check and validation; one function = one transaction, so any refusal undoes all four.
  perform public.set_business_priority_attributes(partner_id_param, priority_attributes_param);
  perform public.set_business_priority_time_windows(partner_id_param, time_windows_param);
  perform public.set_business_priority_time_range(partner_id_param, start_param, end_param);
  perform public.set_business_priority_occasions(partner_id_param, occasions_param);
end;
$$;
revoke all on function public.set_business_want_more(uuid, text[], text[], time without time zone, time without time zone, text[]) from public, anon;
grant execute on function public.set_business_want_more(uuid, text[], text[], time without time zone, time without time zone, text[]) to authenticated;
