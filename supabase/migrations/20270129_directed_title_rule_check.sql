-- Rule-based (NO AI) check on a gathering title before a directed request shows it to a business.
-- A title that fails is simply withheld (the request still goes through with structured fields only);
-- it never blocks the host. Evaluated at read time, nothing stored.
-- Fails on: a URL/domain, an email address, a phone-number-like digit run (7+ digits after removing
-- separators), text over 120 chars, or an explicit profanity/slur from a short word-boundary list.
create or replace function public._title_safe_for_business(title_param text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $$
  select case
    when title_param is null or btrim(title_param) = '' then false
    when length(title_param) > 120 then false
    when title_param ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|co|me|app|link|ly|xyz)\y)' then false
    when title_param ~ '@' then false
    when regexp_replace(title_param, '[^0-9]', '', 'g') ~ '[0-9]{7,}' then false
    when title_param ~* '\m(fuck|fucking|shit|bitch|cunt|nigger|nigga|faggot|retard|whore|slut|dick|cock|pussy|porn|nude|nudes|sex|escort)\M' then false
    else true
  end
$$;
revoke all on function public._title_safe_for_business(text) from public, anon, authenticated;

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
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'title', case when bro.is_directed and public._title_safe_for_business(g.title) then g.title else null end,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level,
          'party_type', g.party_type
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
$function$;

revoke all on function public.get_business_opportunities(uuid) from public, anon;
grant execute on function public.get_business_opportunities(uuid) to authenticated;
