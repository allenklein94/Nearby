-- Category-aware request routing (2026-09-20). _business_request_fanout used to send every request to the 10
-- best-ranked businesses within the radius WITHOUT looking at the request's category, so in a town with many
-- restaurants a coffee request could miss every coffee shop. Now a request whose category maps to a group
-- (category_tag_groups, migration 20270118) reaches only businesses in that group -- one that declared a tag in
-- the group, or whose major is the group -- ranked with an exact-tag match first (coffee shop before restaurant),
-- then the old ordering (occasion, attributes/cuisine, reputation, distance), still capped at 10. A request with
-- no category, or one that maps to nothing, is routed exactly as before. Rules only: no AI, no fuzzy matching.

create or replace function public.request_category_group(category_param text)
 returns text
 language sql
 stable
 set search_path to 'public'
as $$
  select coalesce(
    (select group_key from public.category_tag_groups where tag = category_param),
    (select group_key from public.category_tag_groups where group_key = category_param limit 1)
  )
$$;
revoke all on function public.request_category_group(text) from public, anon, authenticated;

create or replace function public.business_in_category_group(partner_id_param uuid, group_param text)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $$
  select exists (select 1 from public.brand_partners p where p.id = partner_id_param and p.category = group_param)
      or exists (
        select 1 from unnest(coalesce(public.business_served_tags(partner_id_param), '{}'::text[])) t
        join public.category_tag_groups g on g.tag = t
        where g.group_key = group_param
      )
$$;
revoke all on function public.business_in_category_group(uuid, text) from public, anon, authenticated;

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
  v_req_category text;
  v_req_group text;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, attributes, cuisine, occasion, category into v_raw_text, v_req_attributes, v_req_cuisine, v_req_occasion, v_req_category from business_requests where id = request_id_param;
  -- Category-aware routing (20270130): a request whose category maps to a group only reaches businesses in that
  -- group (declared tags or major). No category / unmapped category = unfiltered, as before. Deterministic, no AI.
  v_req_group := public.request_category_group(v_req_category);
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
      and (v_req_group is null or public.business_in_category_group(p.id, v_req_group))
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
      -- a business that serves the exact requested tag (a coffee shop for a coffee request) goes ahead of group-only matches
      (v_req_category is not null and v_req_category = any(public.business_served_tags(e.id))) desc,
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
$function$;

revoke all on function public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text) from public, anon, authenticated;
