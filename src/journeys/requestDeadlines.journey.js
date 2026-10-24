// Idea "394" (owner approved all three fixes, 2026-10-24; migration 20270344): a business request never stays open past the time
// it is for, and a gathering's request follows the gathering. Every actor runs under the real `authenticated` role + JWT claims;
// setup runs as the owner like the app's own server functions.
//   F1 a gathering's request closes exactly at the start (no one-hour floor), boundary 1 ms either side; none can be made once it
//      started (both creation paths), nothing written.
//   F2 rescheduling moves an unanswered open request (day, host-local time, deadline, its plan's date; the routed business's row
//      stays pending, no push); any business response (offer, decline, reply held for review) refuses the reschedule with nothing
//      changed; after the host cancels the request the time moves and the cancelled request stays as it was; a request already
//      past its deadline is left closed, and Reopen then asks for the gathering's current day/time.
//   F3 a standalone request with a stated day + time closes exactly then (start, or end when only an end is given); a time
//      already passed (incl. exactly now) is refused, nothing written; no stated time keeps the existing rule.
//   Past the deadline, before the hourly sweep, no reply lands by any path: submit, publishing a held reply, availability matching.
// One rolled-back transaction. NOT covered here: two transactions racing (reply vs reschedule): see
// scripts/replay/reschedule-reply-concurrency.js.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const note = (step, value) => `
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${value}));`;
const gIns = (v, host, when) => `
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (${host}, 'JRD ' || '${v}', ${when}, 40.0, -75.0, 'Coffee', 'journey', 10, 'everyone', true) returning id into ${v};`;
const rIns = (v, host, g, expires = "now() + interval '1 day'") => `
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, gathering_id, date)
    values (${host}, 'journey deadlines ' || '${v}', 40.0, -75.0, ${expires}, 4, 'Coffee', ${g}, current_date) returning id into ${v};
  insert into business_request_offers (request_id, partner_id) values (${v}, v_p) on conflict do nothing;`;
const askG = (g, text) => `v_out := create_business_request_for_gathering(gathering_id_param => ${g}, raw_text_param => '${text}', category_param => 'Coffee')`;
const ask = (text, extra) => `v_out := create_business_request(raw_text_param => '${text}', latitude_param => 40.0, longitude_param => -75.0, category_param => 'Coffee'${extra})`;
const reqOf = (g) => `(select id from business_requests where gathering_id = ${g} order by created_at desc limit 1)`;
const NY = `'America/New_York'`;
const pushesToBiz = `(select count(*) from push_outbox where recipient_id = v_o)`;

d('journey: request deadlines follow their time and their gathering (migration 20270344)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_h1', 'v_h2', 'v_h3', 'v_o', 'v_ad', 'v_p'])}
      g_soon uuid; g_edge uuid; g_now uuid; g_past uuid; g_route uuid; g_move uuid; g_rep uuid; g_dec uuid; g_held uuid; g_late uuid;
      r_move uuid; r_rep uuid; r_dec uuid; r_held uuid; r_late uuid; r_dead uuid; r_live uuid; r_deadh uuid;
      v_out jsonb; v_hint text; v_t timestamptz; v_l timestamp; v_p0 bigint; v_scr uuid;`, `
  ${actorsSql({ people: ['v_h1', 'v_h2', 'v_h3', 'v_o', 'v_ad'], business: { owner: 'v_o', partner: 'v_p' } })}
  update profiles set is_admin = true where id = v_ad;

  -- ===== F1: a gathering's request closes at the start =====
  ${gIns('g_soon', 'v_h1', "now() + interval '20 minutes'")}
  ${gIns('g_edge', 'v_h1', "now() + interval '1 millisecond'")}
  ${gIns('g_now', 'v_h1', 'now()')}
  ${gIns('g_past', 'v_h1', "now() - interval '1 minute'")}
  ${gIns('g_route', 'v_h1', "now() + interval '20 minutes'")}
  ${as('f1_ask_soon', 'v_h1', askG('g_soon', 'journey deadlines soon'))}
  ${note('f1_soon_deadline', `(select jsonb_build_object('exact', r.expires_at = g.scheduled_at, 'under_an_hour', r.expires_at < now() + interval '1 hour')
    from business_requests r join gatherings g on g.id = r.gathering_id where r.gathering_id = g_soon)`)}
  ${as('f1_ask_edge', 'v_h1', askG('g_edge', 'journey deadlines edge'))}
  ${note('f1_edge_deadline', `(select to_jsonb(r.expires_at = g.scheduled_at) from business_requests r join gatherings g on g.id = r.gathering_id where r.gathering_id = g_edge)`)}
  ${as('f1_ask_now', 'v_h1', askG('g_now', 'journey deadlines now'))}
  ${as('f1_ask_past', 'v_h1', askG('g_past', 'journey deadlines past'))}
  ${note('f1_started_wrote_nothing', `to_jsonb((select count(*) from business_requests where gathering_id in (g_now, g_past)))`)}
  ${note('f1_route_started', `jsonb_build_object('route_past', _route_gathering_to_partner_core(g_past, v_p, false), 'route_now', _route_gathering_to_partner_core(g_now, v_p, false))`)}
  v_out := to_jsonb(_route_gathering_to_partner_core(g_route, v_p, false) is not null);
  ${note('f1_route_upcoming', `jsonb_build_object('made', v_out,
    'exact', (select r.expires_at = g.scheduled_at from business_requests r join gatherings g on g.id = r.gathering_id where r.gathering_id = g_route))`)}

  -- ===== F2: rescheduling moves an unanswered request; any reply refuses it =====
  ${gIns('g_move', 'v_h2', "now() + interval '2 days'")}
  ${as('f2_ask_move', 'v_h2', askG('g_move', 'journey deadlines move'))}
  r_move := ${reqOf('g_move')};
  insert into business_request_offers (request_id, partner_id) values (r_move, v_p) on conflict do nothing;
  v_p0 := ${pushesToBiz};
  ${as('f2_reschedule_unanswered', 'v_h2', "update gatherings set scheduled_at = scheduled_at + interval '1 day 30 minutes' where id = g_move")}
  select scheduled_at into v_t from gatherings where id = g_move;
  ${note('f2_request_followed', `(select jsonb_build_object(
    'date', r.date = (v_t at time zone ${NY})::date, 'time', r.time_window_start = (v_t at time zone ${NY})::time,
    'expires', r.expires_at = v_t, 'status', r.status,
    'plan_date', (select p.scheduled_at = r.date::timestamptz from plans p where p.resulting_business_request_id = r.id),
    'business_row', (select status from business_request_offers where request_id = r.id and partner_id = v_p),
    'business_pushes', ${pushesToBiz} - v_p0) from business_requests r where r.id = r_move)`)}

  ${gIns('g_rep', 'v_h2', "now() + interval '2 days'")}
  ${rIns('r_rep', 'v_h2', 'g_rep')}
  ${as('f2_business_offers', 'v_o', "v_out := submit_business_offer(request_id_param => r_rep, offer_type_param => 'standard', offer_description_param => 'Journey table')")}
  select scheduled_at into v_t from gatherings where id = g_rep;
  ${as('f2_reschedule_offered', 'v_h2', "update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = g_rep")}
  ${note('f2_offered_nothing_moved', `jsonb_build_object('time_same', (select scheduled_at from gatherings where id = g_rep) = v_t,
    'request', (select jsonb_build_object('status', status, 'date', date, 'expires_same', expires_at = now() + interval '1 day') from business_requests where id = r_rep),
    'offer', (select status from business_request_offers where request_id = r_rep and partner_id = v_p))`)}

  ${gIns('g_dec', 'v_h2', "now() + interval '2 days'")}
  ${rIns('r_dec', 'v_h2', 'g_dec')}
  ${as('f2_business_declines', 'v_o', "v_out := decline_business_offer(r_dec, 'too_busy_right_now')")}
  ${as('f2_reschedule_declined', 'v_h2', "update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = g_dec")}

  ${gIns('g_held', 'v_h2', "now() + interval '2 days'")}
  ${rIns('r_held', 'v_h2', 'g_held')}
  insert into business_content_screening_results (partner_id, target_type, content_snapshot, risk_tier)
    values (v_p, 'offer_response', jsonb_build_object('requestId', r_held, 'offerType', 'standard', 'offerDescription', 'Journey held'), 'medium');
  ${as('f2_reschedule_held', 'v_h2', "update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = g_held")}

  ${as('f2_cancel_request', 'v_h2', 'v_out := cancel_business_request(r_rep)')}
  ${as('f2_reschedule_after_cancel', 'v_h2', "update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = g_rep")}
  ${note('f2_after_cancel', `jsonb_build_object('moved', (select scheduled_at from gatherings where id = g_rep) = v_t + interval '1 hour',
    'request', (select jsonb_build_object('status', status, 'date_same', date = current_date, 'expires_same', expires_at = now() + interval '1 day') from business_requests where id = r_rep))`)}

  ${gIns('g_late', 'v_h2', "now() + interval '2 days'")}
  ${rIns('r_late', 'v_h2', 'g_late', "now() - interval '1 minute'")}
  ${as('f2_reschedule_past_deadline', 'v_h2', "update gatherings set scheduled_at = scheduled_at + interval '1 day' where id = g_late")}
  ${note('f2_past_deadline_left_closed', `(select jsonb_build_object('date_same', date = current_date, 'expires_same', expires_at = now() - interval '1 minute', 'status', status)
    from business_requests where id = r_late)`)}
  ${as('f2_reopen', 'v_h2', 'v_out := reopen_business_request(r_late)', "v_out->'reopened'")}
  select scheduled_at into v_t from gatherings where id = g_late;
  ${note('f2_reopened_current_time', `(select jsonb_build_object('status', status, 'date', date = (v_t at time zone ${NY})::date,
    'time', time_window_start = (v_t at time zone ${NY})::time, 'expires', expires_at = v_t) from business_requests where id = r_late)`)}

  -- ===== F3: a stated time is the deadline =====
  v_l := now() at time zone ${NY};
  ${as('f3_past', 'v_h3', ask('journey deadlines past time', `, date_param => (v_l - interval '1 minute')::date, time_window_start_param => (v_l - interval '1 minute')::time`))}
  ${as('f3_exactly_now', 'v_h3', ask('journey deadlines now time', `, date_param => v_l::date, time_window_start_param => v_l::time`))}
  ${note('f3_refused_wrote_nothing', `to_jsonb((select count(*) from business_requests where requester_id = v_h3))`)}
  ${as('f3_soon', 'v_h3', ask('journey deadlines soon time', `, date_param => (v_l + interval '20 minutes')::date, time_window_start_param => (v_l + interval '20 minutes')::time`),
    `(select expires_at = now() + interval '20 minutes' from business_requests where id = (v_out->>'requestId')::uuid)`)}
  ${as('f3_end_only', 'v_h3', ask('journey deadlines end time', `, date_param => (v_l + interval '30 minutes')::date, time_window_end_param => (v_l + interval '30 minutes')::time`),
    `(select expires_at = now() + interval '30 minutes' from business_requests where id = (v_out->>'requestId')::uuid)`)}
  ${as('f3_day_only', 'v_h3', ask('journey deadlines day only', `, date_param => v_l::date`),
    `(select expires_at = greatest((v_l::date + time '23:59:59') at time zone ${NY}, now() + interval '1 hour') from business_requests where id = (v_out->>'requestId')::uuid)`)}
  ${as('f3_no_day', 'v_h3', ask('journey deadlines no day', ''),
    `(select expires_at = now() + interval '48 hours' from business_requests where id = (v_out->>'requestId')::uuid)`)}

  -- ===== past the deadline, before the sweep: no reply by any path =====
  ${rIns('r_dead', 'v_h1', 'null', 'now()')}
  ${rIns('r_live', 'v_h1', 'null', "now() + interval '1 millisecond'")}
  ${as('dead_submit', 'v_o', "v_out := submit_business_offer(request_id_param => r_dead, offer_type_param => 'standard', offer_description_param => 'Too late')")}
  ${as('live_submit', 'v_o', "v_out := submit_business_offer(request_id_param => r_live, offer_type_param => 'standard', offer_description_param => 'Just in time')")}
  ${rIns('r_deadh', 'v_h1', 'null', 'now()')}
  insert into business_content_screening_results (partner_id, target_type, content_snapshot, risk_tier)
    values (v_p, 'offer_response', jsonb_build_object('requestId', r_deadh, 'offerType', 'standard', 'offerDescription', 'Journey held late'), 'medium')
    returning id into v_scr;
  ${as('dead_publish_held', 'v_ad', 'perform admin_review_business_content_screening(v_scr, true)')}
  delete from business_request_offers where request_id in (r_dead, r_deadh) and partner_id = v_p;
  ${as('dead_availability', 'v_o', "v_out := post_business_availability('Coffee', 'Journey slot', null, 'standard', null, 10, now() - interval '1 hour', now() + interval '3 days')")}
  ${note('dead_nothing_landed', `jsonb_build_object(
    'dead', (select coalesce(jsonb_agg(status), '[]') from business_request_offers where request_id in (r_dead, r_deadh)),
    'live', (select status from business_request_offers where request_id = r_live and partner_id = v_p),
    'requests', (select jsonb_agg(status) from business_requests where id in (r_dead, r_deadh)))`)}`);
    s = stepMap(log);
  }, 120000);

  const refused = (step, hint) => expect(s[step].data.hint ?? null).toBe(hint);

  test('F1: a gathering request closes exactly at the start, even under an hour away (1 ms boundary)', () => {
    expect(s.f1_ask_soon.data).toBe('ok');
    expect(s.f1_soon_deadline.data).toEqual({ exact: true, under_an_hour: true });
    expect(s.f1_ask_edge.data).toBe('ok');
    expect(s.f1_edge_deadline.data).toBe(true);
  });

  test('F1: nothing can be asked once the gathering started (exactly now included), on either path', () => {
    refused('f1_ask_now', 'request_time_passed');
    refused('f1_ask_past', 'request_time_passed');
    expect(s.f1_ask_past.data.error).toBe('This gathering has already started.');
    expect(s.f1_started_wrote_nothing.data).toBe(0);
    expect(s.f1_route_started.data).toEqual({ route_past: null, route_now: null });
    expect(s.f1_route_upcoming.data).toEqual({ made: true, exact: true });
  });

  test('F2: an unanswered request follows the new time (day, local time, deadline, plan); the business row stays, no push', () => {
    expect(s.f2_ask_move.data).toBe('ok');
    expect(s.f2_reschedule_unanswered.data).toBe('ok');
    expect(s.f2_request_followed.data).toEqual({ date: true, time: true, expires: true, status: 'open', plan_date: true,
      business_row: 'pending', business_pushes: 0 });
  });

  test('F2: an offer, a decline or a held reply refuses the reschedule; nothing changes', () => {
    expect(s.f2_business_offers.data).toBe('ok');
    refused('f2_reschedule_offered', 'gathering_request_has_replies');
    expect(s.f2_reschedule_offered.data.error).toMatch(/cancel the request first/);
    expect(s.f2_offered_nothing_moved.data).toMatchObject({ time_same: true, offer: 'offered', request: { status: 'open', expires_same: true } });
    expect(s.f2_business_declines.data).toBe('ok');
    refused('f2_reschedule_declined', 'gathering_request_has_replies');
    refused('f2_reschedule_held', 'gathering_request_has_replies');
  });

  test('F2: after cancelling the request the time moves; a cancelled or closed request is left as it was; Reopen takes the current time', () => {
    expect(s.f2_cancel_request.data).toBe('ok');
    expect(s.f2_reschedule_after_cancel.data).toBe('ok');
    expect(s.f2_after_cancel.data).toEqual({ moved: true, request: { status: 'cancelled', date_same: true, expires_same: true } });
    expect(s.f2_reschedule_past_deadline.data).toBe('ok');
    expect(s.f2_past_deadline_left_closed.data).toEqual({ date_same: true, expires_same: true, status: 'open' });
    expect(s.f2_reopen.data).toBe(true);
    expect(s.f2_reopened_current_time.data).toEqual({ status: 'open', date: true, time: true, expires: true });
  });

  test('F3: a stated time is the deadline itself; passed (or exactly now) = refused, nothing written', () => {
    refused('f3_past', 'request_time_passed');
    refused('f3_exactly_now', 'request_time_passed');
    expect(s.f3_refused_wrote_nothing.data).toBe(0);
    expect(s.f3_soon.data).toBe(true);
    expect(s.f3_end_only.data).toBe(true);
  });

  test('F3: no stated time keeps the existing rule (day only = end of that day, floored; no day = 48 hours)', () => {
    expect(s.f3_day_only.data).toBe(true);
    expect(s.f3_no_day.data).toBe(true);
  });

  test('past the deadline, before the sweep: no reply lands by submit, a held reply or availability matching', () => {
    expect(s.dead_submit.data.error).toBe('This request has expired.');
    expect(s.live_submit.data).toBe('ok');
    expect(s.dead_publish_held.data.error).toBe('This request has expired -- the offer response could not be published.');
    expect(s.dead_availability.data).toBe('ok');
    expect(s.dead_nothing_landed.data).toEqual({ dead: [], live: 'offered', requests: ['open', 'open'] });
  });
});
