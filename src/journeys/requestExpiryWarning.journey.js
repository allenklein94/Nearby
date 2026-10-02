// Item 140 follow-up: "Request expires soon". Real requests reach the business, time is moved in the rolled-back
// transaction, and the 15-minute job runs: only an unanswered, still-open request whose deadline is about two hours away
// (and that reached the business with more than two hours to spare) warns, once, the owner of that business only. Then the
// tap: the owner's dashboard list is read as the owner, after the request changed state, and the real client helper says
// what is true now; a non-owner is refused the list. Not covered: the push actually arriving on a device, send-push's
// per-group mute (Jest covers the table), the dashboard rendering (parse-checked only).
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { focusedOpportunityView } = require('../utils/focusedOpportunity');

const d = hasToken ? describe : describe.skip;

// One gathering + one request addressed to the business (a pending, unanswered offer row), then times set as given.
const DAYS = { a: 3, b: 4, c: 5, dd: 6, e: 7, f: 8, g: 9, h: 10, i: 11, j: 12 }; // distinct dates: never the duplicate guard's same ask
const HOST = { a: 'v_host', b: 'v_host', c: 'v_host', dd: 'v_host', e: 'v_host', f: 'v_host2', g: 'v_host2', h: 'v_host2', i: 'v_host2', j: 'v_host2' }; // the 5-open-requests cap
const mk = (v, created, expires) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${HOST[v]}, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (${HOST[v]}, 'Expiry journey ${v}', now() + interval '${DAYS[v]} days', 40.0, -75.0, 'Coffee', 'journey', 4, 'everyone') returning id into v_g;
  ${v} := (create_business_request_for_gathering(v_g, 'Coffee for the group, case ${v}', 'Coffee', 20, 15, null, null, v_partner, null)->>'requestId')::uuid;
  if (select count(*) from business_requests where gathering_id = v_g) <> 1 then raise exception 'fixture ${v}: no request of its own'; end if;
  update business_requests set created_at = now() - interval '${created}', expires_at = now() + interval '${expires}' where id = ${v};
  update business_request_offers set created_at = now() - interval '${created}' where request_id = ${v};`;
const warned = (v) => `(select count(*) from push_outbox where data->>'type' = 'business_request_expiring' and data->>'request_id' = ${v}::text)`;

d('journey: a request about to expire warns its business once, and the tap shows the current state', () => {
  let s;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const [host, host2] = await runSql(`select id from profiles where id <> '${owner.id}' and managed_partner_id is null order by created_at limit 2;`);
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}'; v_host uuid := '${host.id}'; v_host2 uuid := '${host2.id}'; v_other uuid;
      v_g uuid; a uuid; b uuid; c uuid; dd uuid; e uuid; f uuid; g uuid; h uuid; i uuid; j uuid; v_n int; v_o record; v_err text; v_list jsonb;`, `
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  update profiles set notification_mutes = '{}' where id = v_owner;
  ${mk('a', '1 day', '110 minutes')}
  ${mk('b', '1 day', '5 hours')}
  ${mk('c', '30 minutes', '80 minutes')}
  ${mk('dd', '1 day', '100 minutes')}
  ${mk('e', '1 day', '100 minutes')}
  ${mk('f', '1 day', '100 minutes')}
  ${mk('g', '1 day', '100 minutes')}
  ${mk('h', '1 day', '-1 minutes')}

  -- before the job runs: dd the business already answered, e the customer accepted, f another business was accepted,
  -- g the customer cancelled it
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := dd, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.');
  perform submit_business_offer(request_id_param := e, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.');
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  perform accept_business_offer((select id from business_request_offers where request_id = e and partner_id = v_partner));
  insert into brand_partners (name, active) values ('Expiry journey other business', true) returning id into v_other;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, responded_at, accepted_at)
    values (f, v_other, 'accepted', 'standard', 'We can accommodate this as requested.', now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', v_host2, 'role', 'authenticated')::text, true);
  perform cancel_business_request(g);

  v_n := send_business_request_expiry_warnings();
  select * into v_o from push_outbox where data->>'type' = 'business_request_expiring' and data->>'request_id' = a::text;
  log := log || jsonb_build_array(jsonb_build_object('step','open_request_warned','ok', ${warned('a')} = 1
     and v_o.recipient_id = v_owner and v_o.title = 'Request expires soon' and v_o.body like '%Closes in about 2 hours. Reply before it expires.'
     and v_o.dedupe_key = 'request_expiring:' || (v_o.data->>'offer_id')
     and (v_o.data->>'partner_id')::uuid = v_partner and not (v_o.data ? 'requester_id'),
     'data', jsonb_build_object('body', v_o.body, 'data', v_o.data)));
  log := log || jsonb_build_array(jsonb_build_object('step','not_due_yet','ok', ${warned('b')} = 0));
  log := log || jsonb_build_array(jsonb_build_object('step','arrived_with_under_two_hours','ok', ${warned('c')} = 0));
  log := log || jsonb_build_array(jsonb_build_object('step','already_answered','ok', ${warned('dd')} = 0));
  log := log || jsonb_build_array(jsonb_build_object('step','accepted_before','ok', ${warned('e')} = 0
     and (select status from business_requests where id = e) = 'fulfilled'));
  log := log || jsonb_build_array(jsonb_build_object('step','another_business_accepted','ok', ${warned('f')} = 0
     and (select status from business_requests where id = f) = 'open'));
  log := log || jsonb_build_array(jsonb_build_object('step','cancelled_before','ok', ${warned('g')} = 0
     and (select status from business_requests where id = g) = 'cancelled'));
  log := log || jsonb_build_array(jsonb_build_object('step','already_expired','ok', ${warned('h')} = 0));
  log := log || jsonb_build_array(jsonb_build_object('step','only_the_owner','ok',
     not exists (select 1 from push_outbox where data->>'type' = 'business_request_expiring' and data->>'request_id' in (a::text) and recipient_id <> v_owner)));

  -- duplicate scheduler runs, and a retry that lost the ledger row: still one warning
  v_n := send_business_request_expiry_warnings() + send_business_request_expiry_warnings();
  delete from business_request_expiry_warnings where request_id = a;
  perform send_business_request_expiry_warnings();
  log := log || jsonb_build_array(jsonb_build_object('step','duplicate_runs','ok', ${warned('a')} = 1, 'data', jsonb_build_object('later_sent', v_n)));

  -- scheduled, not immediate: b becomes due later and is warned then
  update business_requests set expires_at = now() + interval '115 minutes' where id = b;
  perform send_business_request_expiry_warnings();
  log := log || jsonb_build_array(jsonb_build_object('step','warned_when_due','ok', ${warned('b')} = 1));

  -- item 143: the owner turned off their CUSTOMER Businesses alerts only: the owner warning still comes
  ${mk('j', '1 day', '100 minutes')}
  update profiles set notification_mutes = '{business_offers,business_responses}' where id = v_owner;
  perform send_business_request_expiry_warnings();
  log := log || jsonb_build_array(jsonb_build_object('step','customer_business_mute_keeps_owner_warning','ok', ${warned('j')} = 1));

  -- the owner's "New requests" (owner_requests) alerts off: nothing, whatever the customer switches say
  ${mk('i', '1 day', '100 minutes')}
  update profiles set notification_mutes = '{owner_requests}' where id = v_owner;
  perform send_business_request_expiry_warnings();
  log := log || jsonb_build_array(jsonb_build_object('step','owner_turned_business_notifications_off','ok', ${warned('i')} = 0));
  update profiles set notification_mutes = '{}' where id = v_owner;

  -- the tap, after the state changed: the owner answers a, b expires, then the owner's own list is read
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := a, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.');
  update business_requests set expires_at = now() - interval '1 minute' where id = b;
  v_list := get_business_opportunities(v_partner);
  log := log || jsonb_build_array(jsonb_build_object('step','owner_list','ok', true, 'data', jsonb_build_object(
     'a', a, 'b', b, 'i', i, 'g', g, 'e', e,
     'rows', (select jsonb_agg(x) from jsonb_array_elements(v_list) x where (x->>'request_id')::uuid in (a, b, i, g, e)))));

  -- a non-owner opening it is refused by the server
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  begin perform get_business_opportunities(v_partner); v_err := null; exception when others then v_err := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','non_owner_refused','ok', v_err like '%Not authorized%', 'data', v_err));
  log := log || jsonb_build_array(jsonb_build_object('step','job_not_client_callable','ok',
     not has_function_privilege('authenticated', 'public.send_business_request_expiry_warnings()', 'execute')
     and not has_function_privilege('anon', 'public.send_business_request_expiry_warnings()', 'execute')));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'open_request_warned', 'not_due_yet', 'arrived_with_under_two_hours', 'already_answered', 'accepted_before',
    'another_business_accepted', 'cancelled_before', 'already_expired', 'only_the_owner', 'duplicate_runs', 'warned_when_due',
    'customer_business_mute_keeps_owner_warning', 'owner_turned_business_notifications_off', 'non_owner_refused', 'job_not_client_callable',
  ])('%s', (step) => {
    expect(s[step]).toBeDefined();
    expect({ step, ok: s[step].ok, data: s[step].data }).toEqual(expect.objectContaining({ ok: true }));
  });

  test('the tap shows the current state, from the owner\'s real list', () => {
    const { rows, a, b, i, g, e } = s.owner_list.data;
    expect(focusedOpportunityView(rows, a)).toEqual({ kind: 'state', key: 'youReplied' }); // answered after the warning
    expect(focusedOpportunityView(rows, b)).toEqual({ kind: 'state', key: 'expired' }); // deadline passed
    expect(focusedOpportunityView(rows, g)).toEqual({ kind: 'state', key: 'customerCancelled' });
    expect(focusedOpportunityView(rows, e)).toEqual({ kind: 'state', key: 'booked' });
    expect(focusedOpportunityView(rows, i).kind).toBe('respondable'); // still open: the card's own actions apply
    expect(focusedOpportunityView([], a, { loadFailed: true })).toEqual({ kind: 'unavailable' }); // what a non-owner sees
  });
});
