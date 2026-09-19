-- "Occasions we offer": an explicit, separate business setting (NOT "want more" -- priority_occasions is an
-- appetite/ranking signal, this is a capability: "we do birthday packages"). Six business-facing choices, all
-- existing occasion keys: birthday, anniversary, date_night, celebration, graduation, family_gathering (the
-- business UI labels that last one "Group/Family" -- no new "group events" key is invented).
--
-- Routing reuses the existing machinery, no second engine:
--   * package path unchanged: an occasion request is still matched to a business's ACTIVE PACKAGE for that
--     occasion and receives that package as an offer;
--   * NEW: _business_request_fanout ranks a business that offers the request's occasion first, so it is
--     among the (max 10) businesses the request reaches even with no package. It then gets an ordinary
--     pending opportunity to respond to -- no package or offer is invented for it.
-- No demand-privacy change: business-facing occasion demand stays get_occasion_demand_for_partner, which
-- already withholds anything under demand_min_people() (5 distinct people).

alter table public.brand_partners
  add column if not exists offered_occasions text[] not null default '{}';
alter table public.brand_partners drop constraint if exists brand_partners_offered_occasions_check;
alter table public.brand_partners
  add constraint brand_partners_offered_occasions_check
  check (offered_occasions <@ array['birthday', 'anniversary', 'date_night', 'celebration', 'graduation', 'family_gathering']::text[]);

create or replace function public.set_business_offered_occasions(partner_id_param uuid, occasions_param text[])
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

  if not (coalesce(occasions_param, '{}') <@ array['birthday', 'anniversary', 'date_night', 'celebration', 'graduation', 'family_gathering']::text[]) then
    raise exception 'Invalid occasion';
  end if;

  update brand_partners
  set offered_occasions = coalesce(occasions_param, '{}')
  where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_offered_occasions(uuid, text[]) from public, anon;
grant execute on function public.set_business_offered_occasions(uuid, text[]) to authenticated;

CREATE OR REPLACE FUNCTION public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_filter_param text[] DEFAULT NULL::text[], business_major_filter_param text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_raw_text text;
  v_req_attributes text[];
  v_req_cuisine text;
  v_req_occasion text;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, attributes, cuisine, occasion into v_raw_text, v_req_attributes, v_req_cuisine, v_req_occasion from business_requests where id = request_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_row in
    with eligible as (
      select p.id, p.attributes, p.cuisine, p.offered_occasions, (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      )) as distance_miles
      from brand_partners p
      where p.active = true
      and p.latitude is not null
      and p.longitude is not null
      and (category_filter_param is null or p.subcategory = any(category_filter_param) or p.categories && category_filter_param)
      and (business_major_filter_param is null or p.category = business_major_filter_param)
    ),
    reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, e.id
    from eligible e
    left join reputation r on r.partner_id = e.id
    where e.distance_miles <= radius_miles_param
    order by
      -- a business that explicitly says it offers this occasion is routed the request first
      (v_req_occasion is not null and v_req_occasion = any(e.offered_occasions)) desc,
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) desc,
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      e.distance_miles asc
    limit 10
    returning partner_id
  loop
    v_notified_count := v_notified_count + 1;

    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_row.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        -- Only urgent requests ping immediately; the rest are gathered into the hourly digest (send_business_opportunity_digests).
        continue when not public._opportunity_is_urgent(request_id_param);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'New opportunity nearby!',
            'body', 'New request: ' || public.business_safe_request_summary(request_id_param),
            'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
          )
        );
      end loop;
    end if;
  end loop;

  return v_notified_count;
end;
$function$
;
