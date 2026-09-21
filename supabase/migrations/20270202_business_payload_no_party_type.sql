-- Minimum-payload cleanup (owner decision, 2026-09-21): a business must not learn the SOCIAL PLAN TYPE of a gathering request
-- (friends / date / family / ...). get_business_opportunities used to return gatherings.party_type inside the request's gathering
-- object; it no longer does. Nothing replaces it. The client's party-type scoring bonus (businessOfferRecommendation) is removed in
-- the same change. Only that one key changes (patched from the live body); same signature, no new overload.
CREATE OR REPLACE FUNCTION public.get_business_opportunities(partner_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price, bro.price_is_per_person,
      bro.offer_description, bro.proposed_time, bro.created_at, bro.expires_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.viewed_at, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id, bro.is_directed,
      jsonb_build_object(
        'category', br.category,
        'party_size', br.party_size,
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'summary', public.business_safe_request_summary(br.id),
        'is_match_request', br.match_id is not null,
        'attributes', br.attributes,
        'dietary', case when cardinality(br.dietary) > 0 then to_jsonb(br.dietary) else null end,
        'cuisine', br.cuisine,
        'requested_items', case when cardinality(br.requested_items) > 0 then to_jsonb(br.requested_items) else null end,
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'note', case when bro.is_directed then br.note_for_business else null end,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'title', case when bro.is_directed and public._title_safe_for_business(g.title) then g.title else null end,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level
        ) else null end,
        'requester_display_name', case
          when bro.status in ('accepted', 'completed') and br.match_id is null
          then req.display_name
          else null
        end
      ) as business_requests,
      case when bres.id is not null then jsonb_build_object(
        'status', bres.status,
        'business_payments', case when bp.id is not null then jsonb_build_object('status', bp.status) else null end
      ) else null end as business_reservations
    from public.business_request_offers bro
    join public.business_requests br on br.id = bro.request_id
    left join public.gatherings g on g.id = br.gathering_id
    left join public.profiles req on req.id = br.requester_id
    left join public.business_reservations bres on bres.offer_id = bro.id
    left join public.business_payments bp on bp.reservation_id = bres.id
    where bro.partner_id = partner_id_param
  ) t;

  return v_result;
end;
$function$

;
