// Item 126 (2026-09-28): the internal intent funnel (intent_funnel, intent_funnel_summary) read from existing records only.
// One customer makes typed asks that end every way a real one can (redeemed, declined, expired with an offer, cancelled,
// a gathering ask that ends in Interested + attending, nothing shown, shown but never tapped) plus a refinement, a
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
      v_g1 uuid; v_g2 uuid; v_g3 uuid; v_sub uuid; v_req uuid; v_offer uuid; v_n int; v_err text;
      a_redeem uuid := gen_random_uuid(); a_decline uuid := gen_random_uuid(); a_expire uuid := gen_random_uuid();
      a_cancel uuid := gen_random_uuid(); a_gather uuid := gen_random_uuid(); a_empty uuid := gen_random_uuid();
      a_untapped uuid := gen_random_uuid(); a_retry uuid := gen_random_uuid(); a_refine uuid := gen_random_uuid();
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
  -- a refinement of the gathering ask, and a retried copy of its original (same submission, new id): still ONE row
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_refine, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_gather,
    'parent_snapshot_id', a_gather, 'refinement_key', 'friends', 'refinement_action', 'applied', 'outcome', 'results',
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g2::text))));
  perform record_typed_ask_snapshot(jsonb_build_object('id', a_retry, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_gather,
    'outcome', 'results', 'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'gathering', 'result_id', v_g1::text))));

  -- move every fixture ask into a week of its own (the milestones stay now, i.e. after the ask)
  update typed_ask_snapshots set created_at = timestamptz '2020-01-06 12:00+00' + (row_number_hack.n || ' minutes')::interval
    from (select id, row_number() over (order by created_at, id) n from typed_ask_snapshots
          where id in (a_redeem, a_decline, a_expire, a_cancel, a_gather, a_empty, a_untapped, a_retry, a_refine)) row_number_hack
    where typed_ask_snapshots.id = row_number_hack.id;
  update typed_ask_snapshots set created_at = timestamptz '2020-01-06 11:00+00' where id = a_gather;   -- the original is first
  update typed_ask_snapshots set created_at = timestamptz '2020-01-07 12:00+00' where id = a_untapped;  -- g3 was joined 2020-01-01, before this ask

  -- ---- taps (viewed): twice on the same ask, once via submission only ----
  insert into intent_outcomes (user_id, result_type, result_id, selected_at, snapshot_id, result_position, submission_id)
    values (v_u, 'gathering', v_g1, now() - interval '5 minutes', a_gather, 1, s_gather),
           (v_u, 'gathering', v_g2, now() - interval '4 minutes', a_refine, 1, s_gather);
  insert into intent_outcomes (user_id, result_type, result_id, selected_at, submission_id)
    values (v_u, 'business_availability', gen_random_uuid(), now() - interval '10 minutes', s_redeem);

  -- ---- gathering ask: Interested on g1 (kept), attending g2 ----
  perform set_gathering_interested(v_g1, true);
  perform join_gathering(v_g2);

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
  perform set_config('request.jwt.claims', '', true);

  -- ---- assertions: one row per ask ----
  log := log || jsonb_build_array(jsonb_build_object('step','one_row_per_ask','ok',
     (select count(*) from intent_funnel where ask_week = '2020-01-06') = 7
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
     and f.interested_at is not null and f.attending_at is not null and f.business_requested_at is null and f.request_outcome is null
     and f.shown_at = timestamptz '2020-01-06 11:00+00', 'data', to_jsonb(f)));

  select * into f from intent_funnel where ask_snapshot_id = a_empty;
  log := log || jsonb_build_array(jsonb_build_object('step','nothing_shown','ok',
     f.shown_at is null and not f.showed_gathering and f.viewed_at is null and f.submission_id is null and f.ask_area is null, 'data', to_jsonb(f)));

  select * into f from intent_funnel where ask_snapshot_id = a_untapped;
  log := log || jsonb_build_array(jsonb_build_object('step','join_before_ask_not_attributed','ok',
     f.shown_at is not null and f.viewed_at is null and f.attending_at is null and f.ask_week = '2020-01-06', 'data', to_jsonb(f)));

  -- Interested is lost when the same person then joins that gathering (join_gathering clears it): a known gap, asserted
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  perform join_gathering(v_g1);
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step','interested_cleared_by_join','ok',
     (select interested_at from intent_funnel where ask_snapshot_id = a_gather) is null
     and (select attending_at from intent_funnel where ask_snapshot_id = a_gather) is not null));
  -- (put the Interested row back for the summary numbers below)
  insert into gathering_interested (gathering_id, user_id, created_at) values (v_g2, v_u, now());

  -- ---- summary: the fixture week ----
  select * into w from intent_funnel_summary where dimension = 'week' and value = '2020-01-06';
  log := log || jsonb_build_array(jsonb_build_object('step','summary_counts','ok',
     w.asks = 7 and w.shown = 6 and w.viewed = 2 and w.showed_gathering = 2 and w.interested = 1 and w.attending = 1
     and w.business_requested = 4 and w.offer_received = 2 and w.offer_accepted = 1 and w.redeemed = 1, 'data', to_jsonb(w)));
  log := log || jsonb_build_array(jsonb_build_object('step','summary_rates','ok',
     w.shown_rate = round(6/7.0, 4) and w.viewed_rate = round(2/6.0, 4) and w.interested_rate = 0.5 and w.attending_rate = 0.5
     and w.business_requested_rate = round(4/7.0, 4) and w.offer_received_rate = 0.5 and w.offer_accepted_rate = 0.5 and w.redeemed_rate = 1
     and w.offer_received_drop_off = 0.5 and w.viewed_drop_off = round(1 - 2/6.0, 4)));
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
  reset role;
  set local role anon;
  begin perform 1 from intent_funnel limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from intent_funnel_summary limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','internal_only','ok', v_n = 4
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('intent_funnel', 'intent_funnel_summary')
                     and column_name in ('user_id', 'raw_text', 'requester_id', 'interpretation', 'latitude', 'longitude'))));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'one_row_per_ask', 'redeemed', 'declined', 'expired', 'cancelled', 'gathering_path', 'nothing_shown',
    'join_before_ask_not_attributed', 'interested_cleared_by_join', 'summary_counts', 'summary_rates', 'breakdowns_partition', 'internal_only',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    if (!s[name].ok) console.log(name, JSON.stringify(s[name].data));
    expect(s[name].ok).toBe(true);
  });
});
