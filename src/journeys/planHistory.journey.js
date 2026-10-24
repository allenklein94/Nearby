// Idea "397" (owner, 2026-10-24): past plans become history. Real writers under the real `authenticated` role + JWT claims
// (create_business_request, submit_business_offer, accept_business_offer, complete_business_reservation, reopen /
// cancel_business_request; the hourly sweep's expiry as setup), the customer then reads their plan rows (RLS applies) in the
// shape Plans reads them (services/plans.js getMyStandaloneBusinessRequestPlans), and the client's ONE rule
// (utils/planHistory.js businessPlanPlacement) places them. One rolled-back transaction.
//   booked, visit ahead       Upcoming now, Past once its time has passed, still "Confirmed" (a passed time never claims a visit);
//                             completing it before the visit day is refused (nothing inferred, nothing written)
//   visit confirmed           the business's confirmation stores Completed; Past once its time has passed
//   expired, no booking       the plan row is stored 'cancelled' by the expiry trigger; the rule lists it on Past, "Request expired"
//   reopened                  request open again, plan row still 'cancelled': Upcoming, Pending (the request's state decides)
//   cancelled by the person   not listed
// NOT covered: PostgREST's embed itself (the SQL read mirrors its columns), the screen on a device, night-out / date plans
// (no server step decides their tab: Jest utils/planHistory.test.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { businessPlanPlacement } = require('../utils/planHistory');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    v_out := jsonb_build_object('error', sqlerrm);
  end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const NY = `'America/New_York'`;
const today = `(now() at time zone ${NY})::date`;
const create = (text, date, start) => `v_out := create_business_request(raw_text_param => '${text}', latitude_param => 40.0, longitude_param => -75.0,
      category_param => 'Coffee', party_size_param => 2, date_param => ${date}, time_window_start_param => ${start})`;
const route = (v) => `insert into business_request_offers (request_id, partner_id) values (${v}, v_p) on conflict do nothing;`;
const offerOf = (v) => `(select id from business_request_offers where request_id = ${v} and partner_id = v_p)`;
// The customer's own read, in Plans' shape (plan + its request + the request's replies' status / proposed_time).
const planRow = (v) => `(select jsonb_build_object('status', p.status, 'scheduled_at', p.scheduled_at,
    'business_requests', (select jsonb_build_object('status', r.status, 'date', r.date, 'time_window_start', r.time_window_start,
      'expires_at', r.expires_at, 'gatherings', null,
      'business_request_offers', coalesce((select jsonb_agg(jsonb_build_object('status', o.status, 'proposed_time', o.proposed_time))
        from business_request_offers o where o.request_id = r.id), '[]'::jsonb))
      from business_requests r where r.id = p.resulting_business_request_id))
  from plans p where p.resulting_business_request_id = ${v} and p.plan_type = 'business_request')`;

d('journey: past plans become history: bookings by their visit time, expired requests on Past (idea 397)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_c', 'v_o', 'v_p'])}
      r_book uuid; r_done uuid; r_exp uuid; r_cancel uuid; v_out jsonb;`, `
  ${actorsSql({ people: ['v_c', 'v_o'], business: { owner: 'v_o', partner: 'v_p' } })}
  update profiles set timezone = ${NY} where id = v_c;

  -- booked, visit two days ahead at 19:00 New York
  ${as('book_create', 'v_c', create('journey history booked', `${today} + 2`, "time '19:00'"))}
  r_book := (select id from business_requests where requester_id = v_c and raw_text = 'journey history booked');
  ${route('r_book')}
  ${as('book_offer', 'v_o', `v_out := submit_business_offer(request_id_param => r_book, offer_type_param => 'standard',
      offer_description_param => 'Journey table', proposed_time_param => ((${today} + 2) + time '19:00') at time zone ${NY})`)}
  ${as('book_accept', 'v_c', `v_out := accept_business_offer(${offerOf('r_book')}, null, 0::smallint)`)}
  ${as('book_complete_early', 'v_c', `v_out := complete_business_reservation(${offerOf('r_book')})`)}
  ${as('book_row', 'v_c', 'null', planRow('r_book'))}

  -- visit confirmed: its day reached (setup moves the request to today 00:01 New York, as if time had passed), no offered time
  ${as('done_create', 'v_c', create('journey history done', `${today} + 2`, "time '19:00'"))}
  r_done := (select id from business_requests where requester_id = v_c and raw_text = 'journey history done');
  ${route('r_done')}
  ${as('done_offer', 'v_o', `v_out := submit_business_offer(request_id_param => r_done, offer_type_param => 'standard', offer_description_param => 'Journey visit')`)}
  ${as('done_accept', 'v_c', `v_out := accept_business_offer(${offerOf('r_done')}, null, 0::smallint)`)}
  update business_requests set date = ${today}, time_window_start = time '00:01' where id = r_done;
  ${as('done_complete', 'v_o', `v_out := complete_business_reservation(${offerOf('r_done')})`)}
  ${as('done_row', 'v_c', 'null', planRow('r_done'))}

  -- expired with no booking (the hourly sweep's write), then reopened
  ${as('exp_create', 'v_c', create('journey history expired', 'null', 'null'))}
  r_exp := (select id from business_requests where requester_id = v_c and raw_text = 'journey history expired');
  update business_requests set status = 'expired', expires_at = now() - interval '1 minute' where id = r_exp;
  ${as('exp_row', 'v_c', 'null', planRow('r_exp'))}
  ${as('exp_reopen', 'v_c', 'v_out := reopen_business_request(r_exp)', "v_out->'reopened'")}
  ${as('reopened_row', 'v_c', 'null', planRow('r_exp'))}

  -- cancelled by the person
  ${as('cancel_create', 'v_c', create('journey history cancelled', 'null', 'null'))}
  r_cancel := (select id from business_requests where requester_id = v_c and raw_text = 'journey history cancelled');
  ${as('cancel', 'v_c', 'v_out := cancel_business_request(r_cancel)')}
  ${as('cancel_row', 'v_c', 'null', planRow('r_cancel'))}`);
    s = stepMap(log);
  }, 120000);

  const NOW = new Date();
  const LATER = new Date(NOW.getTime() + 4 * 24 * 3600 * 1000);

  test('the writers ran under real roles', () => {
    for (const k of ['book_create', 'book_offer', 'book_accept', 'done_create', 'done_offer', 'done_accept', 'done_complete', 'exp_create', 'cancel_create', 'cancel']) {
      expect([k, s[k].data?.error]).toEqual([k, undefined]);
    }
  });

  test('booked, visit ahead: Upcoming now; Past once its time has passed, still Confirmed (no visit inferred)', () => {
    const row = s.book_row.data;
    expect(row.status).toBe('confirmed');
    expect(businessPlanPlacement(row, NOW)).toEqual({ tab: 'upcoming', status: 'confirmed', closed: false });
    expect(businessPlanPlacement(row, LATER)).toEqual({ tab: 'past', status: 'confirmed', closed: false });
    expect(s.book_complete_early.data.error).toBe('You can mark this as completed on the day of the visit.');
  });

  test('visit confirmed by the business: Completed, on Past once its time has passed', () => {
    const row = s.done_row.data;
    expect(row.status).toBe('completed');
    expect(businessPlanPlacement(row, LATER)).toEqual({ tab: 'past', status: 'completed', closed: false });
  });

  test('expired, no booking: stored cancelled, listed on Past as "Request expired"; reopened: Upcoming, Pending', () => {
    expect(s.exp_row.data.status).toBe('cancelled');
    expect(s.exp_row.data.business_requests.status).toBe('expired');
    expect(businessPlanPlacement(s.exp_row.data, NOW)).toEqual({ tab: 'past', status: null, closed: true });
    expect(s.exp_reopen.data).toBe(true);
    expect(s.reopened_row.data.status).toBe('cancelled'); // why the request's own state decides, never the plan's
    expect(businessPlanPlacement(s.reopened_row.data, NOW)).toEqual({ tab: 'upcoming', status: 'pending', closed: false });
  });

  test('cancelled by the person: not listed', () => {
    expect(s.cancel_row.data.business_requests.status).toBe('cancelled');
    expect(businessPlanPlacement(s.cancel_row.data, NOW)).toBeNull();
  });
});
