// Item 126 (2026-09-28): the internal intent funnel (intent_funnel, intent_funnel_summary) read from existing records only.
// One customer makes typed asks that end every way a real one can (redeemed, declined, expired with an offer, cancelled,
// a gathering ask that ends in Interested -> attending, Interested removed without joining, attending without Interested, still
// Interested, independent requests by the same person that must stay unattributed, nothing shown, shown but never tapped) plus a refinement, a
// retried original and repeated taps; the view must give each ask exactly one row with only the milestones that really
// happened, and the summary must count and divide by the right population. Fixture asks are moved into a week of their
// own (2020-01-06) so the summary's week row is the fixture alone. Rolled back. Not covered: the app (no new client code).
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: typed asks -> each milestone -> one funnel row per ask -> summary rates', () => {
  let s;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const users = await runSql(`select id from profiles where id <> '${owner.id}' and managed_partner_id is null order by created_at limit 2;`);
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}'; v_u uuid := '${users[0].id}'; v_host uuid := '${users[1].id}';
      v_g1 uuid; v_g2 uuid; v_g3 uuid; v_g4 uuid; v_g5 uuid; v_g6 uuid; v_g7 uuid; v_ind1 uuid; v_ind2 uuid; v_sub uuid; v_req uuid; v_offer uuid; v_n int; v_err text;
      a_redeem uuid := gen_random_uuid(); a_decline uuid := gen_random_uuid(); a_expire uuid := gen_random_uuid();
      a_cancel uuid := gen_random_uuid(); a_gather uuid := gen_random_uuid(); a_empty uuid := gen_random_uuid();
      a_untapped uuid := gen_random_uuid(); a_retry uuid := gen_random_uuid(); a_refine uuid := gen_random_uuid();
      a_removed uuid := gen_random_uuid(); a_direct uuid := gen_random_uuid(); a_still uuid := gen_random_uuid();
      s_redeem uuid; s_decline uuid; s_expire uuid; s_cancel uuid; s_gather uuid; s_untapped uuid;
      f record; w record;`, `
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;

  -- three upcoming public gatherings by another person
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_host, 'Funnel walk 1', now() + interval '2 days', 40.0, -75.0, 'Walking', 'journey', 'everyone') returning id into v_g1;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_host, 'Funnel walk 2', now() + interval '2 days', 40.0, -75.0, 'Walking', 'journey', 'everyone') returning id into v_g2;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_host, 'Funnel walk 3', now() + interval '2 days', 40.0, -75.0, 'Walking', 'journey', 'everyone') returning id into v_g3;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_host, 'Funnel walk 4', now() + interval '2 days', 40.0, -75.0, 'Walking', 'journey', 'everyone') returning id into v_g4;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_host, 'Funnel walk 5', now() + interval '2 days', 40.0, -75.0, 'Walking', 'journey', 'everyone') returning id into v_g5;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_host, 'Funnel walk 6', now() + interval '2 days', 40.0, -75.0, 'Walking', 'journey', 'everyone') returning id into v_g6;

  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);

  -- ---- asks: one submission each, recorded through the real writer ----
  insert into intent_submissions (user_id, raw_text, category, intent_kind, wide_area) values (v_u, 'coffee', 'Coffee', 'gathering', '40,-75') returning id into s_redeem;
  insert into intent_submissions (user_id, raw_text, category, intent_kind, wide_area) values (v_u, 'coffee', 'Coffee', 'gathering', '40,-75') returning id into s_decline;
  insert into intent_submissions (user_id, raw_text, category, intent_kind, wide_area) values (v_u, 'coffee', 'Coffee', 'gathering', '41,-75') returning id into s_expire;
  insert into intent_submissions (user_id, raw_text, category, intent_kind, wide_area) values (v_u, 'coffee', 'Coffee', 'gathering', '41,-75') returning id into s_cancel;
  insert into intent_submissions (user_id, raw_text, category, intent_kind, wide_area) values (v_u, 'walk', 'Walking', 'gathering', '40,-75') returning id into s_gather;
  insert into intent_submissions (user_id, raw_text, category, intent_kind, wide_area) values (v_u, 'walk', 'Walking', 'gathering', null) returning id into s_untapped;

  perform record_typed_ask_snapshot(jsonb_build_object('id', a_redeem, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_redeem,
    'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Coffee'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'business_availability', 'result_id', 'x1', 'partner_id', v_partner))));
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_decline, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_decline,
    'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Coffee'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'business_availability', 'result_id', 'x2', 'partner_id', v_partner))));
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_expire, 'surface', 'discover', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_expire,
    'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Coffee'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'business_availability', 'result_id', 'x3', 'partner_id', v_partner))));
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_cancel, 'surface', 'discover', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_cancel,
    'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Coffee'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'business_availability', 'result_id', 'x4', 'partner_id', v_partner))));
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_gather, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_gather,
    'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Walking'),
    'results', jsonb_build_array(
      jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g1::text),
      jsonb_build_object('position', 2, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g2::text))));
  -- nothing shown, no submission
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_empty, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3',
    'outcome', 'no_results', 'interpretation', jsonb_build_object('category', 'Coffee'), 'results', '[]'::jsonb));
  -- shown, never tapped; g3 is joined BEFORE the ask, so it must not be attributed
  perform join_gathering(v_g3);
  update gathering_interest set created_at = timestamptz '2020-01-01 12:00+00' where gathering_id = v_g3 and user_id = v_u;
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_untapped, 'surface', 'discover', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_untapped,
    'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Walking'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g3::text))));
  -- three more gathering asks: Interested then removed (g4), joined with no Interested (g5), still Interested (g6)
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_removed, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'outcome', 'results',
    'interpretation', jsonb_build_object('category', 'Walking'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g4::text))));
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_direct, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'outcome', 'results',
    'interpretation', jsonb_build_object('category', 'Walking'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g5::text))));
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_still, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'outcome', 'results',
    'interpretation', jsonb_build_object('category', 'Walking'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g6::text))));
  -- a refinement of the gathering ask, and a retried copy of its original (same submission, new id): still ONE row
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_refine, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_gather,
    'parent_snapshot_id', a_gather, 'refinement_key', 'friends', 'refinement_action', 'applied', 'outcome', 'results',
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g2::text))));
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_retry, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_gather,
    'outcome', 'results', 'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g1::text))));

  -- move every fixture ask into a week of its own (the milestones stay now, i.e. after the ask)
  update typed_ask_snapshots set created_at = timestamptz '2020-01-06 12:00+00' + (row_number_hack.n || ' minutes')::interval
    from (select id, row_number() over (order by created_at, id) n from typed_ask_snapshots
          where id in (a_redeem, a_decline, a_expire, a_cancel, a_gather, a_empty, a_untapped, a_retry, a_refine, a_removed, a_direct, a_still)) row_number_hack
    where typed_ask_snapshots.id = row_number_hack.id;
  update typed_ask_snapshots set created_at = timestamptz '2020-01-06 11:00+00' where id = a_gather;   -- the original is first
  update typed_ask_snapshots set created_at = timestamptz '2020-01-07 12:00+00' where id = a_untapped;  -- g3 was joined 2020-01-01, before this ask

  -- ---- taps (viewed): twice on the same ask, once via submission only ----
  insert into intent_outcomes (user_id, result_type, result_id, selected_at, snapshot_id, result_position, submission_id)
    values (v_u, 'gathering', v_g1, now() - interval '5 minutes', a_gather, 1, s_gather),
           (v_u, 'gathering', v_g2, now() - interval '4 minutes', a_refine, 1, s_gather);
  insert into intent_outcomes (user_id, result_type, result_id, selected_at, submission_id)
    values (v_u, 'business_availability', gen_random_uuid(), now() - interval '10 minutes', s_redeem);

  -- ---- gathering ask: Interested on g1 then joins it (Interested -> Attending); joins g2 directly ----
  perform set_gathering_interested(v_g1, true);
  perform join_gathering(v_g1);
  perform join_gathering(v_g2);
  -- the other three: Interested then removed without joining; joined with no Interested; still Interested
  perform set_gathering_interested(v_g4, true);
  perform set_gathering_interested(v_g4, false);
  perform join_gathering(v_g5);
  perform set_gathering_interested(v_g6, true);

  -- ---- business asks ----
  -- redeemed: request -> reply -> accept -> visit completed
  v_req := (create_business_request(raw_text_param := 'coffee', latitude_param := 40.0, longitude_param := -75.0, category_param := 'Coffee',
     party_size_param := 2, submission_id_param := s_redeem, target_partner_id_param := v_partner)->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_req, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.');
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_partner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  perform accept_business_offer(v_offer);
  perform complete_business_reservation(v_offer);
  -- a second request from the same ask must not create a second row
  perform create_business_request(raw_text_param := 'coffee again', latitude_param := 40.0, longitude_param := -75.0, category_param := 'Coffee',
     party_size_param := 3, submission_id_param := s_redeem, target_partner_id_param := v_partner);

  -- declined
  v_req := (create_business_request(raw_text_param := 'coffee declined case', latitude_param := 40.0, longitude_param := -75.0, category_param := 'Coffee',
     party_size_param := 2, submission_id_param := s_decline, target_partner_id_param := v_partner)->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform decline_business_offer(v_req, 'too_busy_right_now', null);

  -- expired with an offer never accepted
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  v_req := (create_business_request(raw_text_param := 'coffee expired case', latitude_param := 40.0, longitude_param := -75.0, category_param := 'Coffee',
     party_size_param := 2, submission_id_param := s_expire, target_partner_id_param := v_partner)->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_req, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.');
  update business_requests set status = 'expired' where id = v_req;

  -- cancelled before any reply
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  v_req := (create_business_request(raw_text_param := 'coffee cancelled case', latitude_param := 40.0, longitude_param := -75.0, category_param := 'Coffee',
     party_size_param := 2, submission_id_param := s_cancel, target_partner_id_param := v_partner)->>'requestId')::uuid;
  perform cancel_business_request(v_req);

  -- independent requests by the SAME person after all those asks: a solo request with no ask, and one from a gathering
  -- they host. Neither may be attributed to an earlier ask.
  v_ind1 := (create_business_request(raw_text_param := 'independent coffee', latitude_param := 40.0, longitude_param := -75.0,
     category_param := 'Coffee', party_size_param := 2, target_partner_id_param := v_partner)->>'requestId')::uuid;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_u, 'Funnel own coffee', now() + interval '3 days', 40.0, -75.0, 'Coffee', 'journey', 4, 'everyone') returning id into v_g7;
  v_ind2 := (create_business_request_for_gathering(v_g7, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, null)->>'requestId')::uuid;
  perform set_config('request.jwt.claims', '', true);

  -- ---- assertions: one row per ask ----
  log := log || jsonb_build_array(jsonb_build_object('step','one_row_per_ask','ok',
     (select count(*) from intent_funnel where ask_week = '2020-01-06') = 10
     and (select count(*) from intent_funnel where ask_snapshot_id in (a_retry, a_refine)) = 0
     and (select count(*) from intent_funnel where submission_id = s_gather) = 1
     and (select count(*) from intent_funnel where submission_id = s_redeem) = 1,
     'data', (select jsonb_agg(ask_snapshot_id) from intent_funnel where ask_week = '2020-01-06')));

  select * into f from intent_funnel where ask_snapshot_id = a_redeem;
  log := log || jsonb_build_array(jsonb_build_object('step','redeemed','ok',
     f.shown_at is not null and f.viewed_at is not null and f.business_requested_at is not null and f.requests = 2
     and f.offer_received_at is not null and f.offer_accepted_at is not null and f.redeemed_at is not null
     and f.interested_at is null and f.attending_at is null and f.request_outcome = 'completed'
     and f.offer_received_at <= f.offer_accepted_at and f.offer_accepted_at <= f.redeemed_at
     and f.ask_area = '40,-75' and f.category = 'Coffee', 'data', to_jsonb(f)));

  select * into f from intent_funnel where ask_snapshot_id = a_decline;
  log := log || jsonb_build_array(jsonb_build_object('step','declined','ok',
     f.shown_at is not null and f.viewed_at is null and f.business_requested_at is not null
     and f.offer_received_at is null and f.offer_accepted_at is null and f.redeemed_at is null
     and f.request_outcome = 'all_declined', 'data', to_jsonb(f)));

  select * into f from intent_funnel where ask_snapshot_id = a_expire;
  log := log || jsonb_build_array(jsonb_build_object('step','expired','ok',
     f.business_requested_at is not null and f.offer_received_at is not null and f.offer_accepted_at is null and f.redeemed_at is null
     and f.request_outcome = 'expired_with_offers', 'data', to_jsonb(f)));

  select * into f from intent_funnel where ask_snapshot_id = a_cancel;
  log := log || jsonb_build_array(jsonb_build_object('step','cancelled','ok',
     f.business_requested_at is not null and f.offer_received_at is null and f.offer_accepted_at is null
     and f.request_outcome = 'request_cancelled', 'data', to_jsonb(f)));

  select * into f from intent_funnel where ask_snapshot_id = a_gather;
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_path','ok',
     f.showed_gathering and f.refinements = 2 and f.viewed_at = (select min(selected_at) from intent_outcomes where submission_id = s_gather)
     and f.attending_at is not null and f.business_requested_at is null and f.request_outcome is null
     and f.shown_at = timestamptz '2020-01-06 11:00+00', 'data', to_jsonb(f)));

  select * into f from intent_funnel where ask_snapshot_id = a_empty;
  log := log || jsonb_build_array(jsonb_build_object('step','nothing_shown','ok',
     f.shown_at is null and not f.showed_gathering and f.viewed_at is null and f.submission_id is null and f.ask_area is null, 'data', to_jsonb(f)));

  select * into f from intent_funnel where ask_snapshot_id = a_untapped;
  log := log || jsonb_build_array(jsonb_build_object('step','join_before_ask_not_attributed','ok',
     f.shown_at is not null and f.viewed_at is null and f.attending_at is null and f.ask_week = '2020-01-06', 'data', to_jsonb(f)));

  -- 1. Interested -> Attending: the mark is gone (joined = not currently Interested) but the history counts
  select * into f from intent_funnel where ask_snapshot_id = a_gather;
  log := log || jsonb_build_array(jsonb_build_object('step','interested_then_attending','ok',
     not exists (select 1 from gathering_interested where gathering_id = v_g1 and user_id = v_u)
     and exists (select 1 from gathering_interested_joins where gathering_id = v_g1 and user_id = v_u and interested_at <= joined_at)
     and f.interested_at is not null and not f.interested_now and f.interested_then_attending_at is not null
     and f.interested_at <= f.interested_then_attending_at, 'data', to_jsonb(f)));
  -- 2. Interested -> removed without joining: nothing kept, nothing counted
  select * into f from intent_funnel where ask_snapshot_id = a_removed;
  log := log || jsonb_build_array(jsonb_build_object('step','interested_removed','ok',
     f.interested_at is null and not f.interested_now and f.attending_at is null and f.interested_then_attending_at is null
     and not exists (select 1 from gathering_interested_joins where gathering_id = v_g4), 'data', to_jsonb(f)));
  -- 3. Attending without Interested: attending, never counted as a conversion from Interested
  select * into f from intent_funnel where ask_snapshot_id = a_direct;
  log := log || jsonb_build_array(jsonb_build_object('step','attending_without_interested','ok',
     f.attending_at is not null and f.interested_at is null and f.interested_then_attending_at is null
     and not exists (select 1 from gathering_interested_joins where gathering_id = v_g5), 'data', to_jsonb(f)));
  -- still Interested: current state
  select * into f from intent_funnel where ask_snapshot_id = a_still;
  log := log || jsonb_build_array(jsonb_build_object('step','still_interested','ok',
     f.interested_at is not null and f.interested_now and f.attending_at is null and f.interested_then_attending_at is null, 'data', to_jsonb(f)));
  -- 4 + 5. requests: only the ones carrying an ask's submission are the ask's; independent ones stay in request_journey unattributed
  log := log || jsonb_build_array(jsonb_build_object('step','independent_requests_not_attributed','ok',
     (select sum(requests) from intent_funnel where ask_week = '2020-01-06') = 5
     and (select ask_snapshot_id is null and submission_id is null from request_journey where request_id = v_ind1)
     and (select ask_snapshot_id is null and submission_id is null and request_source = 'gathering' from request_journey where request_id = v_ind2)
     and (select count(*) from intent_funnel where ask_week = '2020-01-06' and business_requested_at is not null) = 4));

  -- ---- summary: the fixture week ----
  select * into w from intent_funnel_summary where dimension = 'week' and value = '2020-01-06';
  log := log || jsonb_build_array(jsonb_build_object('step','summary_counts','ok',
     w.asks = 10 and w.shown = 9 and w.viewed = 2 and w.showed_gathering = 5 and w.interested = 2 and w.interested_now = 1
     and w.attending = 2 and w.interested_then_attending = 1
     and w.business_requested = 4 and w.offer_received = 2 and w.offer_accepted = 1 and w.redeemed = 1, 'data', to_jsonb(w)));
  log := log || jsonb_build_array(jsonb_build_object('step','summary_rates','ok',
     w.shown_rate = 0.9 and w.viewed_rate = round(2/9.0, 4) and w.interested_rate = 0.4 and w.attending_rate = 0.4
     and w.interested_to_attending_rate = 0.5 and w.business_requested_rate = 0.4 and w.offer_received_rate = 0.5 and w.offer_accepted_rate = 0.5 and w.redeemed_rate = 1
));
  -- drop-off is a COUNT of people who reached a stage and not the next one (20270269), never a fraction
  log := log || jsonb_build_array(jsonb_build_object('step','summary_drop_off_counts','ok',
     w.drop_off_before_shown = 1 and w.drop_off_before_viewed = 7 and w.drop_off_before_interested = 3
     and w.drop_off_before_attending_after_interested = 1 and w.drop_off_before_business_request = 6
     and w.drop_off_before_offer_received = 2 and w.drop_off_before_offer_accepted = 1 and w.drop_off_before_redeemed = 0, 'data', to_jsonb(w)));
  -- the same numbers as Stage | Reached | Drop-off before next stage; a chain's last stage has none
  log := log || jsonb_build_array(jsonb_build_object('step','stages_table','ok',
     (select jsonb_agg(jsonb_build_array(stage, reached, drop_off_before_next_stage) order by stage_order)
        from intent_funnel_stages where dimension = 'week' and value = '2020-01-06' and chain = 'gathering')
       = '[["Gathering shown", 5, 3], ["Interested", 2, 1], ["Attending after Interested", 1, null]]'::jsonb
     and (select jsonb_agg(jsonb_build_array(stage, reached, drop_off_before_next_stage) order by stage_order)
        from intent_funnel_stages where dimension = 'week' and value = '2020-01-06' and chain = 'business')
       = '[["Typed asks", 10, 6], ["Business request", 4, 2], ["Offer received", 2, 1], ["Offer accepted", 1, 0], ["Redeemed", 1, null]]'::jsonb
     and not exists (select 1 from intent_funnel_stages where drop_off_before_next_stage < 0)));
  -- breakdowns add up: every dimension partitions the same asks as the overall row
  log := log || jsonb_build_array(jsonb_build_object('step','breakdowns_partition','ok',
     (select sum(asks) from intent_funnel_summary where dimension = 'area') = (select asks from intent_funnel_summary where dimension = 'overall')
     and (select sum(asks) from intent_funnel_summary where dimension = 'category') = (select asks from intent_funnel_summary where dimension = 'overall')
     and (select sum(redeemed) from intent_funnel_summary where dimension = 'week') = (select redeemed from intent_funnel_summary where dimension = 'overall')
     and (select count(*) from intent_funnel_summary where dimension = 'overall') = 1
     and exists (select 1 from intent_funnel_summary where dimension = 'area' and value = 'unknown')
     and not exists (select 1 from intent_funnel_summary where shown_rate > 1 or viewed_rate > 1 or offer_accepted_rate > 1 or redeemed_rate > 1)));

  -- ---- internal only ----
  v_n := 0;
  set local role authenticated;
  begin perform 1 from intent_funnel limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from intent_funnel_summary limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from intent_funnel_stages limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  set local role anon;
  begin perform 1 from intent_funnel limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from intent_funnel_summary limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from intent_funnel_stages limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  set local role authenticated;
  begin perform 1 from gathering_interested_joins limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  set local role anon;
  begin perform 1 from gathering_interested_joins limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','internal_only','ok', v_n = 8
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('intent_funnel', 'intent_funnel_summary')
                     and column_name in ('user_id', 'raw_text', 'requester_id', 'interpretation', 'latitude', 'longitude'))));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'one_row_per_ask', 'redeemed', 'declined', 'expired', 'cancelled', 'gathering_path', 'nothing_shown',
    'join_before_ask_not_attributed', 'interested_then_attending', 'interested_removed', 'attending_without_interested',
    'still_interested', 'independent_requests_not_attributed', 'summary_counts', 'summary_rates', 'summary_drop_off_counts', 'stages_table', 'breakdowns_partition', 'internal_only',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    if (!s[name].ok) console.log(name, JSON.stringify(s[name].data));
    expect(s[name].ok).toBe(true);
  });
});
