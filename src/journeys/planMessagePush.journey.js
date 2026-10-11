// Plan group chat push (owner, 2026-10-11): a plan participant writes in the plan's chat -> every OTHER participant gets
// one push through _send_push, except someone blocked either way with the writer and someone who muted Messages; a stranger
// never does; a burst from one writer is one push per person per plan per 2 minutes. The tap opens that plan's chat
// (notificationDestinations.js), from exactly the payload the database queued.
// One rolled-back transaction; app.push_handoff_test_failure keeps every push in the outbox (never handed to send-push).
// Not covered (device only): the push arriving on a phone, the Reply button's look, the tap on a real device.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { notificationDestination } = require('../navigation/notificationDestinations');
const { notificationGroupOf } = require('../constants/notificationPreferences');
const { notificationPriority } = require('../constants/notificationTier');
const { NOTIFICATION_ACTION_BY_TYPE } = require('../constants/notificationActions');

const d = hasToken ? describe : describe.skip;

d('journey: a plan chat message -> a push to the other participants -> the tap opens the plan chat', () => {
  let s;
  let ids;
  beforeAll(async () => {
    const log = await runJourney(`
      v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_c uuid := gen_random_uuid();
      v_m uuid := gen_random_uuid(); v_x uuid := gen_random_uuid(); u uuid;
      v_start bigint; v_plan uuid; v_req uuid;`, `
  -- five throwaway people (rolled back with everything else)
  foreach u in array array[v_a, v_b, v_c, v_m, v_x] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@planmsg.test');
    insert into profiles (id, display_name, birthdate) values (u, 'PM-' || left(u::text, 4), date '1990-01-01');
  end loop;
  perform set_config('app.push_handoff_test_failure', 'on', true);  -- kept in the outbox as 'retry', never handed to send-push
  perform set_config('app.trusted_update', 'on', true);
  select coalesce(max(id), 0) into v_start from push_outbox;

  -- setup: a plan hosted by A with organizers B, C, M; X is not on it. C blocked A. M muted Messages.
  delete from blocks where blocker_id in (v_a, v_b, v_c, v_m, v_x) or blocked_id in (v_a, v_b, v_c, v_m, v_x);
  update profiles set notification_mutes = '{}' where id in (v_a, v_b, v_c, v_x);
  update profiles set notification_mutes = '{messages}' where id = v_m;
  insert into blocks (blocker_id, blocked_id) values (v_c, v_a);
  select id into v_req from business_requests limit 1;
  insert into plans (plan_type, created_by, title, status, resulting_business_request_id)
    values ('business_request', v_a, 'J-PM Saturday dinner', 'draft', v_req) returning id into v_plan;
  insert into plan_organizers (plan_id, user_id, added_by) values (v_plan, v_b, v_a), (v_plan, v_c, v_a), (v_plan, v_m, v_a);

  -- 1. the roster the chat header shows (one source with the push recipients)
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', 'roster', 'ok', true, 'data', get_plan_participants(v_plan)));
  reset role;

  -- 2. A writes twice in a row (the app's own insert, under RLS)
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into plan_messages (plan_id, sender_id, body) values (v_plan, v_a, 'Table for 4 at 7?');
  insert into plan_messages (plan_id, sender_id, body) values (v_plan, v_a, 'Or 7:30');
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'fromA', 'ok', true, 'data', (
    select coalesce(jsonb_agg(jsonb_build_object('to', o.recipient_id, 'title', o.title, 'body', o.body, 'data', o.data, 'status', o.status)), '[]')
    from push_outbox o where o.id > v_start and o.data->>'plan_id' = v_plan::text)));

  -- 3. B answers: A and C hear it (C's block is with A only), M stays muted
  select coalesce(max(id), 0) into v_start from push_outbox;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into plan_messages (plan_id, sender_id, body) values (v_plan, v_b, '7 works');
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'fromB', 'ok', true, 'data', (
    select coalesce(jsonb_agg(o.recipient_id), '[]') from push_outbox o where o.id > v_start and o.data->>'plan_id' = v_plan::text)));

  -- 4. a stranger cannot write into the chat, so cannot trigger a push
  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into plan_messages (plan_id, sender_id, body) values (v_plan, v_x, 'hi');
    log := log || jsonb_build_array(jsonb_build_object('step', 'stranger', 'ok', false));
  exception when others then
    log := log || jsonb_build_array(jsonb_build_object('step', 'stranger', 'ok', true));
  end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'meta', 'ok', true, 'data', jsonb_build_object('plan', v_plan, 'req', v_req, 'ids', jsonb_build_array(v_a, v_b, v_c, v_m, v_x))));`);
    s = stepMap(log);
    ids = s.meta.data.ids;
  }, 90000);

  test('the chat header roster: host + the three organizers (one source with the recipients)', () => {
    const [a, b, c, m] = ids;
    const roster = s.roster.data.participants;
    expect(roster.map((p) => p.role)).toEqual(['host', 'organizer', 'organizer', 'organizer']);
    expect(roster[0].id).toBe(a);
    expect(roster.map((p) => p.id).sort()).toEqual([a, b, c, m].sort());
  });
  test('A writes twice: only B gets a push, once (C blocked A, M muted Messages, A is the writer, X is not on the plan)', () => {
    const [, b] = ids;
    expect(s.fromA.data.map((p) => p.to)).toEqual([b]);
    const [p] = s.fromA.data;
    expect(p.title).toBe('J-PM Saturday dinner');
    expect(p.body).toMatch(/: Table for 4 at 7\?$/);
    expect(Object.keys(p.data).sort()).toEqual(['business_request_id', 'plan_id', 'type']);
    expect(p.data.type).toBe('plan_message');
    expect(p.data.business_request_id).toBe(s.meta.data.req);
    expect(p.status).toBe('retry'); // the test switch: kept in the outbox, never sent
  });
  test('B answers: A and C get it (a block is between two people), M stays muted', () => {
    const [a, , c] = ids;
    expect([...s.fromB.data].sort()).toEqual([a, c].sort());
  });
  test('a stranger cannot write into the plan chat', () => {
    expect(s.stranger.ok).toBe(true);
  });
  test('the queued payload opens that plan\'s chat; Messages switch, high priority, Reply button', async () => {
    const dest = await notificationDestination(s.fromA.data[0].data);
    expect(dest).toEqual({ name: 'PlanChat', params: { businessRequestId: s.meta.data.req } });
    expect(notificationGroupOf('plan_message')).toBe('messages');
    expect(notificationPriority('plan_message')).toBe('high');
    expect(NOTIFICATION_ACTION_BY_TYPE.plan_message).toBe('reply');
  });
});
