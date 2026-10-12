// Item 62 (owner, 2026-10-12): several businesses reply to ONE request -> ONE notification on the phone, replaced in place.
// Every reply still pushes at once through the real senders (submit_business_offer's event handler AND
// post_business_availability); each carries collapse_key 'offers:<request id>' (send-push turns it into Expo collapseId + tag,
// sendPushReplaceInPlace.test.js). Words come from the request's LIVE open replies at each hand-off: 1 = today's text,
// 2+ = "N businesses responded", 0 = not sent. A retry / late hand-off is re-worded from the count as it is then (never an
// older one); a second request is never merged with the first. One rolled-back transaction; app.push_handoff_test_failure
// keeps every push in the outbox. Not covered (device only): the phone replacing the shown notification, and whether each
// replacement sounds/vibrates again; two replies committing at the SAME moment (one transaction cannot race itself; the
// per-request advisory lock is what serializes them, read in the migration).
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { notificationDestination } = require('../navigation/notificationDestinations');

const d = hasToken ? describe : describe.skip;

d('journey: several replies to one request -> one notification, replaced in place, with the live count (item 62)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_o1 uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid(); v_o3 uuid := gen_random_uuid();
      v_p1 uuid := gen_random_uuid(); v_p2 uuid := gen_random_uuid(); v_p3 uuid := gen_random_uuid();
      v_r1 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid(); u uuid; v_start bigint;
      v_row1 bigint; v_row2 bigint; v_row3 bigint; v_row4 bigint; v_res text;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);  -- kept in the outbox as 'retry', never handed to send-push
  perform set_config('app.trusted_update', 'on', true);
  foreach u in array array[v_c, v_o1, v_o2, v_o3] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@replypush.test');
    insert into profiles (id, display_name, birthdate) values (u, 'RP-' || left(u::text, 4), date '1990-01-01');
  end loop;
  -- three businesses far from anyone real (0.5 N, 0.5 E), each with its owner
  insert into brand_partners (id, name, active, latitude, longitude) values
    (v_p1, 'J62 Harbor Cafe', true, 0.5, 0.5), (v_p2, 'J62 Corner Roasters', true, 0.5, 0.5), (v_p3, 'J62 Dune Coffee', true, 0.5, 0.5);
  update profiles set managed_partner_id = v_p1 where id = v_o1;
  update profiles set managed_partner_id = v_p2 where id = v_o2;
  update profiles set managed_partner_id = v_p3 where id = v_o3;
  update profiles set notification_mutes = '{}', notify_business = true where id = v_c;
  -- the customer's two open requests: R1 coffee for 4 (asked P1 + P2), R2 tea (asked P1)
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
    values (v_r1, v_c, 'Coffee for 4 tonight', 0.5, 0.5, now() + interval '1 day', 'open', 'Coffee', 4, 10),
           (v_r2, v_c, 'Tea this afternoon', 0.5, 0.5, now() + interval '1 day', 'open', 'Tea', 2, 10);
  insert into business_request_offers (request_id, partner_id, status) values (v_r1, v_p1, 'pending'), (v_r1, v_p2, 'pending'), (v_r2, v_p1, 'pending');
  select coalesce(max(id), 0) into v_start from push_outbox;

  -- 1. Harbor Cafe replies to R1: one open reply -> today's words, on that offer
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r1, offer_type_param := 'standard', offer_description_param := 'A table for 4 at 7.');
  select max(id) into v_row1 from push_outbox where id > v_start and recipient_id = v_c;
  -- 2. Corner Roasters replies to R1: two open replies -> the roll-up
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r1, offer_type_param := 'standard', offer_description_param := 'Window seats for 4.');
  select max(id) into v_row2 from push_outbox where id > v_row1 and recipient_id = v_c;
  -- 3. Harbor Cafe replies to R2 (another request): its own notification, never merged with R1
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r2, offer_type_param := 'standard', offer_description_param := 'Tea for 2 at 3.');
  select max(id) into v_row3 from push_outbox where id > v_row2 and recipient_id = v_c;
  -- 4. Dune Coffee posts availability that fits R1 (the second sender): three open replies
  perform set_config('request.jwt.claims', json_build_object('sub', v_o3, 'role', 'authenticated')::text, true);
  perform post_business_availability('Coffee', 'Coffee for groups tonight', null, 'standard', null, 6, now(), now() + interval '6 hours', 15);
  select max(id) into v_row4 from push_outbox where id > v_row3 and recipient_id = v_c;
  log := log || jsonb_build_array(jsonb_build_object('step', 'sent', 'ok', true, 'data', (
    select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'data', data, 'status', status) order by id)
    from push_outbox where id > v_start and recipient_id = v_c)));

  -- 5. out of order: the FIRST push is handed off again (a retry) after all three replies: it says 3, never 1
  v_res := _push_outbox_deliver(v_row1);
  log := log || jsonb_build_array(jsonb_build_object('step', 'retry_late', 'ok', true, 'data',
    (select jsonb_build_object('title', title, 'body', body, 'data', data) from push_outbox where id = v_row1)));

  -- 6. Corner Roasters withdraws: the availability push, retried, says 2
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  perform withdraw_business_offer((select id from business_request_offers where request_id = v_r1 and partner_id = v_p2));
  v_res := _push_outbox_deliver(v_row4);
  log := log || jsonb_build_array(jsonb_build_object('step', 'after_withdraw', 'ok', true, 'data',
    (select jsonb_build_object('title', title, 'body', body, 'data', data) from push_outbox where id = v_row4)));

  -- 7. Harbor Cafe withdraws too: one open reply left (Dune). The roll-up push, retried, becomes Dune's own words
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform withdraw_business_offer((select id from business_request_offers where request_id = v_r1 and partner_id = v_p1));
  v_res := _push_outbox_deliver(v_row2);
  log := log || jsonb_build_array(jsonb_build_object('step', 'back_to_one', 'ok', true, 'data',
    (select jsonb_build_object('title', title, 'body', body, 'data', data) from push_outbox where id = v_row2)
    || jsonb_build_object('dune_offer', (select id from business_request_offers where request_id = v_r1 and partner_id = v_p3))));

  -- 8. Dune withdraws: no open reply on R1 -> a retry is not sent at all
  perform set_config('request.jwt.claims', json_build_object('sub', v_o3, 'role', 'authenticated')::text, true);
  perform withdraw_business_offer((select id from business_request_offers where request_id = v_r1 and partner_id = v_p3));
  v_res := _push_outbox_deliver(v_row1);
  log := log || jsonb_build_array(jsonb_build_object('step', 'none_left', 'ok', true, 'data',
    (select jsonb_build_object('result', v_res, 'status', status, 'last_error', last_error) from push_outbox where id = v_row1)));

  -- 9. R2's notification never moved: still its own single reply, its own key
  log := log || jsonb_build_array(jsonb_build_object('step', 'other_request', 'ok', true, 'data',
    (select jsonb_build_object('title', title, 'body', body, 'data', data) from push_outbox where id = v_row3)));
  log := log || jsonb_build_array(jsonb_build_object('step', 'meta', 'ok', true, 'data', jsonb_build_object('r1', v_r1, 'r2', v_r2,
    'harbor_r1', (select id from business_request_offers where request_id = v_r1 and partner_id = v_p1),
    'harbor_r2', (select id from business_request_offers where request_id = v_r2 and partner_id = v_p1))));`);
    s = stepMap(log);
  }, 120000);

  const key = (r) => `offers:${r}`;

  test('every reply pushed at once: four replies, four pushes, none held back', () => {
    expect(s.sent.data).toHaveLength(4);
    for (const p of s.sent.data) expect(p.data.type).toBe('business_offer_received');
  });
  test('1st reply to R1: today\'s words, on that offer, with R1\'s key', () => {
    const [p] = s.sent.data;
    expect(p.title).toBe('☕ J62 Harbor Cafe responded');
    expect(p.body).toBe('They can take you for your coffee request.'); // today's words for a reply with no price (_business_reply_kind)
    expect(p.data).toMatchObject({ request_id: s.meta.data.r1, offer_id: s.meta.data.harbor_r1, collapse_key: key(s.meta.data.r1) });
    expect(p.data).not.toHaveProperty('reply_count');
  });
  test('2nd reply to R1: one roll-up with the live count, no single offer, same key', () => {
    const p = s.sent.data[1];
    expect(p.title).toBe('☕ 2 businesses responded');
    expect(p.body).toBe('See their replies to your coffee request.');
    expect(p.data).toMatchObject({ request_id: s.meta.data.r1, reply_count: 2, collapse_key: key(s.meta.data.r1) });
    expect(p.data).not.toHaveProperty('offer_id');
  });
  test('a reply to R2 is its own notification (another key, one reply, today\'s words)', () => {
    const p = s.sent.data[2];
    expect(p.title).toMatch(/ J62 Harbor Cafe responded$/);
    expect(p.data).toMatchObject({ request_id: s.meta.data.r2, offer_id: s.meta.data.harbor_r2, collapse_key: key(s.meta.data.r2) });
    expect(p.data).not.toHaveProperty('reply_count');
  });
  test('the availability path joins R1\'s notification: 3 businesses responded', () => {
    const p = s.sent.data[3];
    expect(p.title).toBe('☕ 3 businesses responded');
    expect(p.data).toMatchObject({ request_id: s.meta.data.r1, reply_count: 3, collapse_key: key(s.meta.data.r1) });
  });
  test('a late retry of the FIRST push carries the count as it is then (3), never the older 1', () => {
    expect(s.retry_late.data.title).toBe('☕ 3 businesses responded');
    expect(s.retry_late.data.data.reply_count).toBe(3);
  });
  test('after a withdrawal, a retry says 2', () => {
    expect(s.after_withdraw.data.title).toBe('☕ 2 businesses responded');
  });
  test('down to one open reply: the roll-up becomes that reply\'s own words, on that offer', () => {
    const p = s.back_to_one.data;
    expect(p.title).toBe('☕ J62 Dune Coffee responded');
    expect(p.data.offer_id).toBe(p.dune_offer);
    expect(p.data).not.toHaveProperty('reply_count');
  });
  test('no open reply left: a retry is not sent (failed, reason stated)', () => {
    expect(s.none_left.data).toEqual({ result: 'failed', status: 'failed', last_error: 'not sent: no open reply left on this request' });
  });
  test('R2\'s notification is untouched by everything on R1', () => {
    expect(s.other_request.data.data).toMatchObject({ request_id: s.meta.data.r2, offer_id: s.meta.data.harbor_r2, collapse_key: key(s.meta.data.r2) });
    expect(s.other_request.data.title).toMatch(/J62 Harbor Cafe responded$/);
  });
  test('taps: one reply opens the request on that offer; the roll-up opens the request itself', async () => {
    const one = await notificationDestination(s.sent.data[0].data);
    expect(one).toEqual({ name: 'BusinessRequestDetail', params: expect.objectContaining({ requestId: s.meta.data.r1, focusOfferId: s.meta.data.harbor_r1 }) });
    const many = await notificationDestination(s.sent.data[1].data);
    expect(many.name).toBe('BusinessRequestDetail');
    expect(many.params.requestId).toBe(s.meta.data.r1);
    expect(many.params).not.toHaveProperty('focusOfferId');
  });
});
