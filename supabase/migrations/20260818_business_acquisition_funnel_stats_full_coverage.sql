-- Closes a disclosed gap named in CLAUDE.md's Milestone 6 writeup: 12 of the 14 real
-- business_acquisition_events_event_check values were rolled up by
-- get_business_acquisition_funnel_stats(), but 'profile_completed' and 'dashboard_viewed' were
-- never read at all -- confirmed both are real, client-fired event values (BusinessDashboardScreen.js
-- fires both), the RPC just never counted them. Additive only: every existing returned key and
-- percentage is unchanged, two new counts are added.
CREATE OR REPLACE FUNCTION public.get_business_acquisition_funnel_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_landing_viewed integer;
  v_demo_opened integer;
  v_cta_clicked integer;
  v_search_started integer;
  v_business_found integer;
  v_apply_started integer;
  v_apply_submitted integer;
  v_apply_approved integer;
  v_apply_denied integer;
  v_profile_completed integer;
  v_published integer;
  v_first_offer_created integer;
  v_first_consumer_interaction integer;
  v_dashboard_viewed integer;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view business acquisition funnel stats';
  end if;

  select count(*) into v_landing_viewed from business_acquisition_events where event = 'landing_viewed';
  select count(*) into v_demo_opened from business_acquisition_events where event = 'demo_opened';
  select count(*) into v_cta_clicked from business_acquisition_events where event = 'cta_clicked';
  select count(*) into v_search_started from business_acquisition_events where event = 'search_started';
  select count(*) into v_business_found from business_acquisition_events where event = 'business_found';
  select count(*) into v_apply_started from business_acquisition_events where event = 'apply_started';
  select count(*) into v_apply_submitted from business_acquisition_events where event = 'apply_submitted';
  select count(*) into v_apply_approved from business_acquisition_events where event = 'apply_approved';
  select count(*) into v_apply_denied from business_acquisition_events where event = 'apply_denied';
  select count(*) into v_profile_completed from business_acquisition_events where event = 'profile_completed';
  select count(*) into v_published from business_acquisition_events where event = 'published';
  select count(*) into v_first_offer_created from business_acquisition_events where event = 'first_offer_created';
  select count(*) into v_first_consumer_interaction from business_acquisition_events where event = 'first_consumer_interaction';
  select count(*) into v_dashboard_viewed from business_acquisition_events where event = 'dashboard_viewed';

  return jsonb_build_object(
    'landing_viewed', v_landing_viewed,
    'demo_opened', v_demo_opened,
    'cta_clicked', v_cta_clicked,
    'search_started', v_search_started,
    'business_found', v_business_found,
    'apply_started', v_apply_started,
    'apply_submitted', v_apply_submitted,
    'apply_approved', v_apply_approved,
    'apply_denied', v_apply_denied,
    'profile_completed', v_profile_completed,
    'published', v_published,
    'first_offer_created', v_first_offer_created,
    'first_consumer_interaction', v_first_consumer_interaction,
    'dashboard_viewed', v_dashboard_viewed,
    'pct_landing_to_cta', round(100.0 * v_cta_clicked / nullif(v_landing_viewed, 0), 1),
    'pct_cta_to_apply_started', round(100.0 * v_apply_started / nullif(v_cta_clicked, 0), 1),
    'pct_apply_started_to_submitted', round(100.0 * v_apply_submitted / nullif(v_apply_started, 0), 1),
    'pct_submitted_to_approved', round(100.0 * v_apply_approved / nullif(v_apply_submitted, 0), 1),
    'pct_approved_to_published', round(100.0 * v_published / nullif(v_apply_approved, 0), 1),
    'pct_approved_to_profile_completed', round(100.0 * v_profile_completed / nullif(v_apply_approved, 0), 1),
    'pct_approved_to_first_offer', round(100.0 * v_first_offer_created / nullif(v_apply_approved, 0), 1)
  );
end;
$function$;
