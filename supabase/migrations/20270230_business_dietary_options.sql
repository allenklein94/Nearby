-- Owner item 88 (2026-09-26): dietary options a food business DECLARES it offers. Structured, owner-declared, never inferred from a
-- menu, description, cuisine or category. It reuses the ONE dietary vocabulary a customer already puts on a request
-- (business_requests.dietary, 20261223), so a need matches an offer by the same key:
--   vegetarian / vegan / gluten_free / dairy_free = "... options"; nut_allergy / shellfish_allergy = "can accommodate ... allergies";
--   halal / kosher. Empty = not said (unknown, never "none").
-- Accessibility (wheelchair accessible, accessible parking, accessible restroom) already exists as attributes (items 49/50).
-- Matching is RANKING only: a business that declared EVERY dietary need of the request is routed it ahead of one that did not say;
-- nothing is removed (a business that did not declare vegan may still cook vegan).

alter table public.brand_partners add column if not exists dietary_options text[] not null default '{}';
alter table public.brand_partners drop constraint if exists brand_partners_dietary_options_check;
alter table public.brand_partners add constraint brand_partners_dietary_options_check
  check (dietary_options <@ array['vegetarian','vegan','gluten_free','dairy_free','nut_allergy','shellfish_allergy','halal','kosher']::text[]);

create or replace function public.set_business_dietary_options(partner_id_param uuid, keys_param text[])
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
  if not (v_keys <@ array['vegetarian','vegan','gluten_free','dairy_free','nut_allergy','shellfish_allergy','halal','kosher']::text[]) then
    raise exception 'Pick from the dietary options listed.';
  end if;
  update brand_partners set dietary_options = v_keys where id = partner_id_param;
end;
$$;
revoke all on function public.set_business_dietary_options(uuid, text[]) from public, anon;
grant execute on function public.set_business_dietary_options(uuid, text[]) to authenticated;

-- Routing: patched in place from the current body. A business covering every dietary need goes ahead (after occasion, exact tag and
-- group-size fit), before the generic attribute overlap. No need on the request = no effect.
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text)'::regprocedure);
  v_new := replace(v_def, $q$  v_req_attributes text[];$q$, $q$  v_req_attributes text[];
  v_req_dietary text[];$q$);
  v_new := replace(v_new, $q$from business_requests where id = request_id_param;$q$, $q$from business_requests where id = request_id_param;
  select dietary into v_req_dietary from business_requests where id = request_id_param;$q$);
  v_new := replace(v_new, $q$select p.id, p.attributes, p.cuisine, p.offered_occasions,$q$, $q$select p.id, p.attributes, p.dietary_options, p.cuisine, p.offered_occasions,$q$);
  v_new := replace(v_new, $q$      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))$q$,
    $q$      -- item 88: a business that declared every dietary need of the request goes ahead of one that did not say
      (cardinality(coalesce(v_req_dietary, '{}')) > 0 and coalesce(e.dietary_options, '{}') @> v_req_dietary) desc,
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))$q$);
  if v_new = v_def or position('v_req_dietary text[]' in v_new) = 0 or position('p.dietary_options' in v_new) = 0
     or position('select dietary into v_req_dietary' in v_new) = 0 or position('e.dietary_options, ''{}'') @> v_req_dietary' in v_new) = 0 then
    raise exception '_business_request_fanout dietary patch did not apply';
  end if;
  execute v_new;
end
$mig$;
