// Item 133 (owner, 2026-10-16): notification -> destination continuity for a friend acceptance. A sends B a friend request,
// B accepts; A's push names B and carries B's id (user_id), which the app opens as B's profile (notificationDestination),
// not the Friends list. One rolled-back transaction; the push stays in the outbox. Migration 20270318.
// Not covered (device only): the push on a phone, the tap opening the profile, the "View profile" button.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { notificationDestination } = require('../navigation/notificationDestinations');

const d = hasToken ? describe : describe.skip;

d('journey: a friend acceptance opens that friend', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_start bigint;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  insert into auth.users (id, aud, role, email) values (v_a, 'authenticated', 'authenticated', v_a || '@fa133.test'), (v_b, 'authenticated', 'authenticated', v_b || '@fa133.test');
  insert into profiles (id, display_name, birthdate) values (v_a, 'J133 Allen', date '1990-01-01'), (v_b, 'J133 Claude', date '1990-01-01');
  select coalesce(max(id), 0) into v_start from push_outbox;
  insert into friendships (user_a, user_b, status, requested_by) values (v_a, v_b, 'pending', v_a);
  update friendships set status = 'accepted' where user_a = v_a and user_b = v_b;
  log := log || jsonb_build_array(jsonb_build_object('step', 'push', 'ok', true, 'data', (
    select jsonb_agg(jsonb_build_object('to_a', recipient_id = v_a, 'title', title, 'body', body,
      'type', data->>'type', 'user_is_b', (data->>'user_id')::uuid = v_b, 'user_id', data->>'user_id'))
    from push_outbox where id > v_start and data->>'type' = 'friend_accepted')));`);
    s = stepMap(log);
  }, 60000);

  test('the requester gets one push naming the friend, carrying the friend\'s id', () => {
    expect(s.push.data).toHaveLength(1);
    const p = s.push.data[0];
    expect(p).toMatchObject({ to_a: true, title: 'Friend request accepted', body: 'J133 Claude accepted your friend request.', type: 'friend_accepted', user_is_b: true });
  });

  test('its tap opens that friend\'s profile', async () => {
    const p = s.push.data[0];
    expect(await notificationDestination({ type: p.type, user_id: p.user_id })).toEqual({ name: 'ViewProfile', params: { userId: p.user_id } });
  });
});
