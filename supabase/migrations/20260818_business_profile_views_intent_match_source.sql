-- C2 of "connect existing consumer-intent + business systems" (CLAUDE.md, Aug 18 2026): a real,
-- honest discovery-source bucket for a resolver tap-through, closing Gap 6 (the two-islands
-- problem) -- a business could previously only ever see "I was viewed" (deep_link/in_app), never
-- "someone found me because of what they asked Nearby for", even though the consumer side
-- already recorded exactly this fact via recordIntentSelection(). Additive only -- widens the
-- existing CHECK, matching this schema's own established "widen the CHECK, never repurpose a
-- value" convention (e.g. business_requests.status's 'merged' addition).

ALTER TABLE public.business_profile_views DROP CONSTRAINT business_profile_views_source_check;
ALTER TABLE public.business_profile_views
  ADD CONSTRAINT business_profile_views_source_check
  CHECK (source = ANY (ARRAY['deep_link'::text, 'in_app'::text, 'intent_match'::text]));

-- Re-pointed, not rewritten -- every existing key/behavior unchanged, one new bucket added.
-- Pulled the live body first to confirm this is the exact current definition before editing.
CREATE OR REPLACE FUNCTION public.get_business_discovery_stats(partner_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total integer;
  v_deep_link integer;
  v_in_app integer;
  v_intent_match integer;
  v_last_30d integer;
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return jsonb_build_object(
      'total_views', 0, 'deep_link_views', 0, 'in_app_views', 0, 'intent_match_views', 0,
      'views_last_30_days', 0, 'pct_via_deep_link', null
    );
  end if;

  select count(*) into v_total from business_profile_views where partner_id = partner_id_param;
  select count(*) into v_deep_link from business_profile_views where partner_id = partner_id_param and source = 'deep_link';
  select count(*) into v_in_app from business_profile_views where partner_id = partner_id_param and source = 'in_app';
  select count(*) into v_intent_match from business_profile_views where partner_id = partner_id_param and source = 'intent_match';
  select count(*) into v_last_30d from business_profile_views where partner_id = partner_id_param and created_at > now() - interval '30 days';

  return jsonb_build_object(
    'total_views', v_total,
    'deep_link_views', v_deep_link,
    'in_app_views', v_in_app,
    'intent_match_views', v_intent_match,
    'views_last_30_days', v_last_30d,
    'pct_via_deep_link', round(100.0 * v_deep_link / nullif(v_total, 0), 1)
  );
end;
$function$;
